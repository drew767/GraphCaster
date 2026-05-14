# Copyright GraphCaster. All Rights Reserved.

"""F101 — Variables with lifecycle (run / session / tenant / env)."""

from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

import pytest

from graph_caster.expression import ExpressionEvaluator
from graph_caster.expression.templates import render_template
from graph_caster.variables import (
    FileVariableStore,
    InMemoryVariableStore,
    VariableContext,
    VariableScope,
)
from graph_caster.variables.expressions import merge_variable_context_into_expr_ctx


# ---------------------------------------------------------------------------
# Helpers


def make_ctx(store, *, run_id="r1", session_id="s1", tenant_id="t1", system=None):
    return VariableContext(
        store,
        run_id=run_id,
        session_id=session_id,
        tenant_id=tenant_id,
        system=system,
    )


def run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# InMemoryVariableStore: set/get/delete round-trip per scope


class TestInMemoryStore:
    def test_set_get_run(self):
        store = InMemoryVariableStore()
        ctx = make_ctx(store)
        run(ctx.set(VariableScope.RUN, "x", 42))
        assert run(ctx.get(VariableScope.RUN, "x")) == 42

    def test_set_get_session(self):
        store = InMemoryVariableStore()
        ctx = make_ctx(store)
        run(ctx.set(VariableScope.SESSION, "history", ["a", "b"]))
        assert run(ctx.get(VariableScope.SESSION, "history")) == ["a", "b"]

    def test_set_get_tenant(self):
        store = InMemoryVariableStore()
        ctx = make_ctx(store)
        run(ctx.set(VariableScope.TENANT, "api_endpoint", "https://api.example.com"))
        assert run(ctx.get(VariableScope.TENANT, "api_endpoint")) == "https://api.example.com"

    def test_delete_run(self):
        store = InMemoryVariableStore()
        ctx = make_ctx(store)
        run(ctx.set(VariableScope.RUN, "tmp", "v"))
        run(ctx.delete(VariableScope.RUN, "tmp"))
        assert run(ctx.get(VariableScope.RUN, "tmp")) is None

    def test_delete_tenant(self):
        store = InMemoryVariableStore()
        ctx = make_ctx(store)
        run(ctx.set(VariableScope.TENANT, "k", "old"))
        run(ctx.delete(VariableScope.TENANT, "k"))
        assert run(ctx.get(VariableScope.TENANT, "k")) is None

    def test_default_for_missing(self):
        store = InMemoryVariableStore()
        ctx = make_ctx(store)
        assert run(ctx.get(VariableScope.RUN, "nonexistent", "fallback")) == "fallback"

    def test_list_scope(self):
        store = InMemoryVariableStore()
        ctx = make_ctx(store)
        run(ctx.set(VariableScope.TENANT, "a", 1))
        run(ctx.set(VariableScope.TENANT, "b", 2))
        result = run(ctx.list_scope(VariableScope.TENANT))
        assert result == {"a": 1, "b": 2}

    def test_conv_alias_to_session(self):
        store = InMemoryVariableStore()
        ctx = make_ctx(store)
        run(ctx.set(VariableScope.CONVERSATION, "msg", "hello"))
        assert run(ctx.get(VariableScope.SESSION, "msg")) == "hello"

    def test_system_scope_read_only(self):
        store = InMemoryVariableStore()
        ctx = make_ctx(store)
        with pytest.raises(ValueError):
            run(ctx.set(VariableScope.SYSTEM, "run_id", "hack"))

    def test_env_scope_read_only(self):
        store = InMemoryVariableStore()
        ctx = make_ctx(store)
        with pytest.raises(ValueError):
            run(ctx.set(VariableScope.ENV, "FOO", "bar"))

    def test_system_vars_populated_at_construction(self):
        store = InMemoryVariableStore()
        ctx = make_ctx(store, run_id="my-run", session_id="my-sess", tenant_id="my-tenant")
        assert run(ctx.get(VariableScope.SYSTEM, "run_id")) == "my-run"
        assert run(ctx.get(VariableScope.SYSTEM, "session_id")) == "my-sess"
        assert run(ctx.get(VariableScope.SYSTEM, "tenant_id")) == "my-tenant"

    def test_custom_system_vars_merged(self):
        store = InMemoryVariableStore()
        ctx = make_ctx(store, system={"user_id": "u42", "graph_id": "g1"})
        assert run(ctx.get(VariableScope.SYSTEM, "user_id")) == "u42"

    def test_run_scope_isolated_between_contexts(self):
        store = InMemoryVariableStore()
        ctx_a = make_ctx(store, run_id="r1")
        ctx_b = make_ctx(store, run_id="r2")
        run(ctx_a.set(VariableScope.RUN, "foo", "from_a"))
        assert run(ctx_b.get(VariableScope.RUN, "foo")) is None

    def test_tenant_scope_shared_between_contexts_with_same_tenant(self):
        store = InMemoryVariableStore()
        ctx_a = make_ctx(store, run_id="r1", tenant_id="shared")
        ctx_b = make_ctx(store, run_id="r2", tenant_id="shared")
        run(ctx_a.set(VariableScope.TENANT, "shared_key", "shared_val"))
        assert run(ctx_b.get(VariableScope.TENANT, "shared_key")) == "shared_val"


# ---------------------------------------------------------------------------
# FileVariableStore: persistence and hot-reload


class TestFileStore:
    def test_tenant_persistence_across_instances(self, tmp_path):
        store1 = FileVariableStore(tmp_path, tenant_id="t1")
        ctx1 = make_ctx(store1, tenant_id="t1")
        run(ctx1.set(VariableScope.TENANT, "endpoint", "https://x.com"))

        store2 = FileVariableStore(tmp_path, tenant_id="t1")
        ctx2 = make_ctx(store2, tenant_id="t1")
        assert run(ctx2.get(VariableScope.TENANT, "endpoint")) == "https://x.com"

    def test_session_persistence(self, tmp_path):
        store = FileVariableStore(tmp_path, tenant_id="t1")
        ctx = make_ctx(store, session_id="sess-1", tenant_id="t1")
        run(ctx.set(VariableScope.SESSION, "history", [1, 2, 3]))

        store2 = FileVariableStore(tmp_path, tenant_id="t1")
        ctx2 = make_ctx(store2, session_id="sess-1", tenant_id="t1")
        assert run(ctx2.get(VariableScope.SESSION, "history")) == [1, 2, 3]

    def test_session_isolation_by_session_id(self, tmp_path):
        store = FileVariableStore(tmp_path, tenant_id="t1")
        ctx_a = make_ctx(store, session_id="sess-a", tenant_id="t1")
        ctx_b = make_ctx(store, session_id="sess-b", tenant_id="t1")
        run(ctx_a.set(VariableScope.SESSION, "key", "for_a"))
        assert run(ctx_b.get(VariableScope.SESSION, "key")) is None

    def test_delete_tenant_var(self, tmp_path):
        store = FileVariableStore(tmp_path, tenant_id="t1")
        ctx = make_ctx(store, tenant_id="t1")
        run(ctx.set(VariableScope.TENANT, "tmp", "v"))
        run(ctx.delete(VariableScope.TENANT, "tmp"))
        assert run(ctx.get(VariableScope.TENANT, "tmp")) is None

    def test_env_hot_reload(self, tmp_path):
        store = FileVariableStore(tmp_path, tenant_id="t1")
        env_path = tmp_path / "tenants" / "t1" / "env.json"
        env_path.parent.mkdir(parents=True, exist_ok=True)

        env_path.write_text(json.dumps({"SLACK_WEBHOOK": "https://hook1.example.com"}), encoding="utf-8")
        ctx = make_ctx(store, tenant_id="t1")
        assert run(ctx.get(VariableScope.ENV, "SLACK_WEBHOOK")) == "https://hook1.example.com"

        # Touch the file with new content, forcing mtime change
        time.sleep(0.01)
        env_path.write_text(json.dumps({"SLACK_WEBHOOK": "https://hook2.example.com"}), encoding="utf-8")
        assert run(ctx.get(VariableScope.ENV, "SLACK_WEBHOOK")) == "https://hook2.example.com"

    def test_env_missing_file_returns_default(self, tmp_path):
        store = FileVariableStore(tmp_path, tenant_id="t1")
        ctx = make_ctx(store, tenant_id="t1")
        assert run(ctx.get(VariableScope.ENV, "NONEXISTENT", "default_val")) == "default_val"

    def test_run_scope_not_persisted(self, tmp_path):
        store = FileVariableStore(tmp_path, tenant_id="t1")
        ctx = make_ctx(store, tenant_id="t1")
        run(ctx.set(VariableScope.RUN, "scratch", "yes"))
        # A new context instance should not see run-scope vars from the old one
        store2 = FileVariableStore(tmp_path, tenant_id="t1")
        ctx2 = make_ctx(store2, tenant_id="t1")
        assert run(ctx2.get(VariableScope.RUN, "scratch")) is None

    def test_atomic_write_produces_valid_json(self, tmp_path):
        store = FileVariableStore(tmp_path, tenant_id="t1")
        ctx = make_ctx(store, tenant_id="t1")
        run(ctx.set(VariableScope.TENANT, "k", {"nested": [1, 2, 3]}))
        tenant_file = tmp_path / "tenants" / "t1" / "tenant.json"
        assert tenant_file.exists()
        data = json.loads(tenant_file.read_text(encoding="utf-8"))
        assert "t1/k" in data
        assert data["t1/k"] == {"nested": [1, 2, 3]}


# ---------------------------------------------------------------------------
# VariableContext.to_expression_dict shape


class TestToExpressionDict:
    def test_shape_has_all_scopes(self):
        store = InMemoryVariableStore()
        ctx = make_ctx(store, system={"user_id": "u1"})
        d = run(ctx.to_expression_dict())
        assert set(d.keys()) == {"sys", "run", "session", "tenant", "env"}

    def test_sys_includes_run_id(self):
        store = InMemoryVariableStore()
        ctx = make_ctx(store, run_id="run-xyz")
        d = run(ctx.to_expression_dict())
        assert d["sys"]["run_id"] == "run-xyz"

    def test_tenant_reflects_set_values(self):
        store = InMemoryVariableStore()
        ctx = make_ctx(store, tenant_id="t1")
        run(ctx.set(VariableScope.TENANT, "foo", "bar"))
        d = run(ctx.to_expression_dict())
        assert d["tenant"]["foo"] == "bar"

    def test_run_scope_in_dict(self):
        store = InMemoryVariableStore()
        ctx = make_ctx(store)
        run(ctx.set(VariableScope.RUN, "scratch", 99))
        d = run(ctx.to_expression_dict())
        assert d["run"]["scratch"] == 99


# ---------------------------------------------------------------------------
# Expression integration: render_template uses variable scopes


class TestExpressionIntegration:
    def _make_expr_ctx(self, var_ctx: VariableContext) -> dict:
        from graph_caster.expression import ExpressionContext
        base = ExpressionContext.empty()
        return merge_variable_context_into_expr_ctx(base, var_ctx)

    def test_tenant_var_in_template(self):
        store = InMemoryVariableStore()
        ctx = make_ctx(store, tenant_id="t1")
        run(ctx.set(VariableScope.TENANT, "endpoint", "https://api.example.com"))
        expr_ctx = self._make_expr_ctx(ctx)
        result = render_template("{{ tenant.endpoint }}", expr_ctx)
        assert result == "https://api.example.com"

    def test_sys_var_in_template(self):
        store = InMemoryVariableStore()
        ctx = make_ctx(store, run_id="my-run-id", system={"graph_id": "g42"})
        expr_ctx = self._make_expr_ctx(ctx)
        result = render_template("{{ sys.run_id }}", expr_ctx)
        assert result == "my-run-id"

    def test_session_var_in_expression(self):
        store = InMemoryVariableStore()
        ctx = make_ctx(store, session_id="s1")
        run(ctx.set(VariableScope.SESSION, "counter", 7))
        expr_ctx = self._make_expr_ctx(ctx)
        ev = ExpressionEvaluator()
        assert ev.evaluate("session.counter == 7", expr_ctx) is True

    def test_dollar_prefix_aliases(self):
        store = InMemoryVariableStore()
        ctx = make_ctx(store, tenant_id="t1")
        run(ctx.set(VariableScope.TENANT, "key", "value"))
        expr_ctx = self._make_expr_ctx(ctx)
        ev = ExpressionEvaluator()
        result = ev.evaluate('$tenant["key"]', expr_ctx)
        assert result == "value"

    def test_env_var_in_template(self, tmp_path):
        env_path = tmp_path / "tenants" / "t1" / "env.json"
        env_path.parent.mkdir(parents=True, exist_ok=True)
        env_path.write_text(json.dumps({"SLACK_WEBHOOK": "https://hooks.slack.com/test"}), encoding="utf-8")
        store = FileVariableStore(tmp_path, tenant_id="t1")
        ctx = make_ctx(store, tenant_id="t1")
        expr_ctx = self._make_expr_ctx(ctx)
        result = render_template("{{ env.SLACK_WEBHOOK }}", expr_ctx)
        assert result == "https://hooks.slack.com/test"

    def test_existing_json_and_nodes_untouched(self):
        store = InMemoryVariableStore()
        ctx = make_ctx(store, tenant_id="t1")
        run(ctx.set(VariableScope.TENANT, "foo", "bar"))
        from graph_caster.expression import ExpressionContext
        base = ExpressionContext.from_run_state(
            "node1",
            {"node1": {"processResult": {"exitCode": 0}}},
            run_id="r1",
        )
        merged = merge_variable_context_into_expr_ctx(base, ctx)
        assert "node1" in merged["nodes"]
        assert merged["tenant"]["foo"] == "bar"


# ---------------------------------------------------------------------------
# CLI integration tests


class TestCLI:
    def _run_main(self, args: list[str], workspace: Path) -> tuple[int, str]:
        from io import StringIO
        from unittest.mock import patch

        buf = StringIO()
        with patch("sys.stdout", buf), patch("sys.argv", ["graph-caster"] + args):
            from graph_caster.__main__ import main
            code = main(args)
        return code, buf.getvalue()

    def test_vars_set_and_get_tenant(self, tmp_path):
        ws = str(tmp_path)
        from graph_caster.__main__ import main

        # set
        rc = main(["vars", "set", "tenant.api_endpoint", "https://api.example.com", "--workspace", ws])
        assert rc == 0

        # get
        import io
        buf = io.StringIO()
        import sys as _sys
        old = _sys.stdout
        _sys.stdout = buf
        try:
            rc2 = main(["vars", "get", "tenant.api_endpoint", "--workspace", ws])
        finally:
            _sys.stdout = old
        assert rc2 == 0
        assert "https://api.example.com" in buf.getvalue()

    def test_vars_list_tenant(self, tmp_path):
        ws = str(tmp_path)
        from graph_caster.__main__ import main
        main(["vars", "set", "tenant.x", "1", "--workspace", ws])
        main(["vars", "set", "tenant.y", "2", "--workspace", ws])

        import io, sys as _sys
        buf = io.StringIO()
        old = _sys.stdout
        _sys.stdout = buf
        try:
            rc = main(["vars", "list", "--scope", "tenant", "--workspace", ws])
        finally:
            _sys.stdout = old
        assert rc == 0
        data = json.loads(buf.getvalue())
        assert "x" in data
        assert "y" in data

    def test_vars_delete_tenant(self, tmp_path):
        ws = str(tmp_path)
        from graph_caster.__main__ import main
        main(["vars", "set", "tenant.to_delete", "bye", "--workspace", ws])
        rc = main(["vars", "delete", "tenant.to_delete", "--workspace", ws])
        assert rc == 0

        import io, sys as _sys
        buf = io.StringIO()
        err = io.StringIO()
        old_out, old_err = _sys.stdout, _sys.stderr
        _sys.stdout, _sys.stderr = buf, err
        try:
            rc2 = main(["vars", "get", "tenant.to_delete", "--workspace", ws])
        finally:
            _sys.stdout, _sys.stderr = old_out, old_err
        assert rc2 == 1

    def test_vars_set_bad_ref(self, tmp_path):
        ws = str(tmp_path)
        from graph_caster.__main__ import main
        import io, sys as _sys
        err = io.StringIO()
        old = _sys.stderr
        _sys.stderr = err
        try:
            rc = main(["vars", "set", "badref", "value", "--workspace", ws])
        finally:
            _sys.stderr = old
        assert rc == 2

    def test_vars_set_json_value(self, tmp_path):
        ws = str(tmp_path)
        from graph_caster.__main__ import main
        rc = main(["vars", "set", "tenant.num", "42", "--workspace", ws])
        assert rc == 0

        import io, sys as _sys
        buf = io.StringIO()
        old = _sys.stdout
        _sys.stdout = buf
        try:
            main(["vars", "get", "tenant.num", "--workspace", ws])
        finally:
            _sys.stdout = old
        assert json.loads(buf.getvalue()) == 42
