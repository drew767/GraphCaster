# Copyright GraphCaster. All Rights Reserved.

"""OAuth2 / OIDC SSO provider package (F85)."""

from graph_caster.auth.oauth.base import OAuthConfig, OAuthIdentity, OAuthProvider
from graph_caster.auth.oauth.state_store import FileStateStore, InMemoryStateStore, StateStore
from graph_caster.auth.oauth.flow import OAuthFlow
from graph_caster.auth.oauth.google import GoogleOAuthProvider
from graph_caster.auth.oauth.github import GitHubOAuthProvider
from graph_caster.auth.oauth.microsoft import MicrosoftOAuthProvider
from graph_caster.auth.oauth.generic_oidc import GenericOIDCProvider

__all__ = [
    "OAuthConfig",
    "OAuthIdentity",
    "OAuthProvider",
    "StateStore",
    "InMemoryStateStore",
    "FileStateStore",
    "OAuthFlow",
    "GoogleOAuthProvider",
    "GitHubOAuthProvider",
    "MicrosoftOAuthProvider",
    "GenericOIDCProvider",
]
