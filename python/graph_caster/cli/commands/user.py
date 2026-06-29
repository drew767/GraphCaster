"""`tenant`, `user`, `member`, `auth` commands.

Note: the original `__main__.py` referenced `_cmd_tenant`, `_cmd_user`, and
`_cmd_member` from `main()`, but never defined those handlers. Invoking those
subcommands would raise `NameError` at runtime. We preserve that latent
behavior with an explicit "not implemented" message so the surface stays
identical from a CLI perspective; only `auth` has an actual handler.
"""
from __future__ import annotations

import argparse
from pathlib import Path


def register(sub: argparse._SubParsersAction) -> None:
    # --- tenant ---
    ten = sub.add_parser("tenant", help="Manage tenants (F83 multi-tenant model)")
    ten_sub = ten.add_subparsers(dest="tenant_cmd", required=True)

    ten_create = ten_sub.add_parser("create", help="Create a new tenant")
    ten_create.add_argument("--name", required=True, help="Tenant display name")
    ten_create.add_argument("--plan", default="default", help="Plan name (default: default)")

    ten_sub.add_parser("list", help="List all tenants in the default store")

    ten_info = ten_sub.add_parser("info", help="Show tenant details")
    ten_info.add_argument("tenant_id", help="Tenant ID")

    # --- user ---
    usr = sub.add_parser("user", help="Manage users (F83 multi-tenant model)")
    usr_sub = usr.add_subparsers(dest="user_cmd", required=True)

    usr_create = usr_sub.add_parser("create", help="Create a new user")
    usr_create.add_argument("--email", required=True, help="User email")
    usr_create.add_argument("--name", required=True, help="User display name")
    usr_create.add_argument("--password", default=None, help="Password (omit for SSO-only)")

    usr_sub.add_parser("list", help="List all users in the default store")

    # --- member ---
    mem = sub.add_parser("member", help="Manage tenant memberships (F83 multi-tenant model)")
    mem_sub = mem.add_subparsers(dest="member_cmd", required=True)

    mem_add = mem_sub.add_parser("add", help="Add a member to a tenant")
    mem_add.add_argument("tenant_id", help="Tenant ID")
    mem_add.add_argument("--email", required=True, help="User email")
    mem_add.add_argument("--role", default="viewer",
                         choices=["owner", "admin", "editor", "viewer", "dataset_operator"])

    mem_list = mem_sub.add_parser("list", help="List members of a tenant")
    mem_list.add_argument("tenant_id", help="Tenant ID")

    mem_remove = mem_sub.add_parser("remove", help="Remove a member from a tenant")
    mem_remove.add_argument("tenant_id", help="Tenant ID")
    mem_remove.add_argument("--email", required=True, help="User email")

    # --- auth sso ---
    auth_cmd = sub.add_parser("auth", help="Authentication utilities (SSO/OAuth2 providers)")
    auth_sub = auth_cmd.add_subparsers(dest="auth_command", required=True)

    auth_sso = auth_sub.add_parser("sso", help="SSO / OAuth2 provider management")
    auth_sso_sub = auth_sso.add_subparsers(dest="sso_command", required=True)

    auth_sso_sub.add_parser("providers", help="List configured SSO providers")

    auth_cfg = auth_sso_sub.add_parser("configure", help="Persist OAuth provider credentials to ~/.graphcaster/oauth.json")
    auth_cfg.add_argument("provider", choices=["google", "github", "microsoft", "oidc"], help="Provider name")
    auth_cfg.add_argument("--client-id", required=True, dest="client_id", help="OAuth client ID")
    auth_cfg.add_argument("--client-secret", required=True, dest="client_secret", help="OAuth client secret")
    auth_cfg.add_argument("--redirect-uri", required=True, dest="redirect_uri", help="Redirect URI")
    auth_cfg.add_argument("--scopes", default="", help="Comma-separated list of scopes")
    auth_cfg.add_argument("--issuer", default=None, help="OIDC issuer URL (for generic OIDC provider only)")

    auth_test = auth_sso_sub.add_parser("test", help="Generate authorization URL for manual testing")
    auth_test.add_argument("provider", choices=["google", "github", "microsoft", "oidc"], help="Provider name")


def execute(args: argparse.Namespace) -> int:
    import sys

    if args.command == "auth":
        return _exec_auth(args)
    # tenant/user/member never had handlers in the original __main__.py; keep that
    # surface explicit instead of crashing with NameError.
    if args.command in ("tenant", "user", "member"):
        print(
            f"graph-caster {args.command}: handler not implemented",
            file=sys.stderr,
        )
        return 2
    print(f"user: unknown command {args.command!r}", file=sys.stderr)
    return 2


def _exec_auth(args: argparse.Namespace) -> int:
    import asyncio as _asyncio_auth
    import json
    import os
    import sys

    _oauth_config_path = Path.home() / ".graphcaster" / "oauth.json"

    def _load_oauth_configs() -> dict:
        if not _oauth_config_path.exists():
            return {}
        try:
            return json.loads(_oauth_config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

    def _save_oauth_configs(cfgs: dict) -> None:
        _oauth_config_path.parent.mkdir(parents=True, exist_ok=True)
        _oauth_config_path.write_text(json.dumps(cfgs, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    if args.auth_command != "sso":
        print("auth: unknown subcommand", file=sys.stderr)
        return 2

    sso_cmd = args.sso_command

    if sso_cmd == "providers":
        cfgs = _load_oauth_configs()
        env_providers = []
        for pname in ("google", "github", "microsoft", "oidc"):
            prefix = f"GC_OAUTH_{pname.upper()}"
            cid = os.environ.get(f"{prefix}_CLIENT_ID", "").strip()
            if cid:
                env_providers.append({"provider": pname, "source": "env", "client_id": cid})
        file_providers = [
            {"provider": k, "source": "file", "client_id": v.get("client_id", "")}
            for k, v in cfgs.items()
        ]
        providers = env_providers + file_providers
        if not providers:
            print("No SSO providers configured.")
            print("Set GC_OAUTH_<PROVIDER>_CLIENT_ID / _CLIENT_SECRET / _REDIRECT_URI env vars,")
            print("or run: python -m graph_caster auth sso configure <provider> --client-id ... --client-secret ... --redirect-uri ...")
        else:
            print(json.dumps(providers, indent=2, ensure_ascii=False))
        return 0

    if sso_cmd == "configure":
        provider = args.provider
        scopes_raw = str(args.scopes or "").strip()
        scopes = [s.strip() for s in scopes_raw.split(",") if s.strip()]
        cfg: dict = {
            "client_id": args.client_id,
            "client_secret": args.client_secret,
            "redirect_uri": args.redirect_uri,
            "scopes": scopes,
        }
        if args.issuer:
            cfg["issuer"] = args.issuer
        cfgs = _load_oauth_configs()
        cfgs[provider] = cfg
        _save_oauth_configs(cfgs)
        print(f"auth sso configure: saved {provider} config to {_oauth_config_path}")
        return 0

    if sso_cmd == "test":
        provider = args.provider
        from graph_caster.auth.oauth.base import OAuthConfig
        from graph_caster.auth.oauth.flow import OAuthFlow
        from graph_caster.auth.oauth.state_store import InMemoryStateStore

        cfgs = _load_oauth_configs()
        file_cfg = cfgs.get(provider, {})
        prefix = f"GC_OAUTH_{provider.upper()}"
        client_id = os.environ.get(f"{prefix}_CLIENT_ID", "").strip() or file_cfg.get("client_id", "")
        client_secret = os.environ.get(f"{prefix}_CLIENT_SECRET", "").strip() or file_cfg.get("client_secret", "")
        redirect_uri = os.environ.get(f"{prefix}_REDIRECT_URI", "").strip() or file_cfg.get("redirect_uri", "")

        if not client_id or not client_secret:
            print(f"auth sso test: {provider} not configured (no client_id/client_secret)", file=sys.stderr)
            return 2

        scopes_raw = os.environ.get(f"{prefix}_SCOPES", "").strip()
        scopes = [s.strip() for s in scopes_raw.split(",") if s.strip()] if scopes_raw else file_cfg.get("scopes", [])

        oauth_config = OAuthConfig(
            client_id=client_id,
            client_secret=client_secret,
            redirect_uri=redirect_uri,
            scopes=scopes,
        )

        if provider == "google":
            from graph_caster.auth.oauth.google import GoogleOAuthProvider
            prov = GoogleOAuthProvider()
        elif provider == "github":
            from graph_caster.auth.oauth.github import GitHubOAuthProvider
            prov = GitHubOAuthProvider()
        elif provider == "microsoft":
            from graph_caster.auth.oauth.microsoft import MicrosoftOAuthProvider
            tenant = os.environ.get("GC_OAUTH_MICROSOFT_TENANT", "common").strip()
            prov = MicrosoftOAuthProvider(tenant=tenant)
        else:
            issuer = os.environ.get("GC_OIDC_ISSUER", "").strip() or file_cfg.get("issuer", "")
            if not issuer:
                print("auth sso test: GC_OIDC_ISSUER not set for generic OIDC provider", file=sys.stderr)
                return 2
            from graph_caster.auth.oauth.generic_oidc import GenericOIDCProvider
            prov = GenericOIDCProvider(issuer=issuer)

        state_store = InMemoryStateStore()
        flow = OAuthFlow(prov, oauth_config, state_store)
        auth_url, state = _asyncio_auth.run(flow.start())
        print(f"Provider   : {provider}")
        print(f"State      : {state}")
        print(f"Authorize URL:")
        print(f"  {auth_url}")
        return 0

    return 2
