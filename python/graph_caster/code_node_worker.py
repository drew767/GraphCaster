# Copyright GraphCaster. All Rights Reserved.

"""Isolated Python worker for ``python_code`` nodes (stdin JSON line → stdout JSON line)."""

from __future__ import annotations

import json
import sys
import traceback


def _safe_builtins_dict() -> dict[str, object]:
    def _no_print(*_a: object, **_k: object) -> None:
        raise RuntimeError("print is disabled; set result or __result__")

    return {
        "abs": abs,
        "all": all,
        "any": any,
        "bin": bin,
        "bool": bool,
        "bytes": bytes,
        "chr": chr,
        "dict": dict,
        "divmod": divmod,
        "enumerate": enumerate,
        "filter": filter,
        "float": float,
        "format": format,
        "frozenset": frozenset,
        "hash": hash,
        "hex": hex,
        "int": int,
        "isinstance": isinstance,
        "issubclass": issubclass,
        "iter": iter,
        "len": len,
        "list": list,
        "map": map,
        "max": max,
        "min": min,
        "next": next,
        "oct": oct,
        "ord": ord,
        "pow": pow,
        "range": range,
        "repr": repr,
        "reversed": reversed,
        "round": round,
        "set": set,
        "slice": slice,
        "sorted": sorted,
        "str": str,
        "sum": sum,
        "tuple": tuple,
        "zip": zip,
        "True": True,
        "False": False,
        "None": None,
        "ArithmeticError": ArithmeticError,
        "AssertionError": AssertionError,
        "Exception": Exception,
        "KeyError": KeyError,
        "TypeError": TypeError,
        "ValueError": ValueError,
        "RuntimeError": RuntimeError,
        "StopIteration": StopIteration,
        "print": _no_print,
    }


def main() -> None:
    raw = sys.stdin.buffer.readline()
    if not raw:
        sys.stdout.write(json.dumps({"ok": False, "error": "no_stdin"}) + "\n")
        sys.stdout.flush()
        return
    try:
        payload: object = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        sys.stdout.write(json.dumps({"ok": False, "error": f"stdin_json:{e}"}, ensure_ascii=False) + "\n")
        sys.stdout.flush()
        return

    if not isinstance(payload, dict):
        sys.stdout.write(json.dumps({"ok": False, "error": "payload_not_object"}) + "\n")
        sys.stdout.flush()
        return

    code = payload.get("code")
    if not isinstance(code, str):
        sys.stdout.write(json.dumps({"ok": False, "error": "missing_code"}) + "\n")
        sys.stdout.flush()
        return

    ctx_in = payload.get("context")
    if not isinstance(ctx_in, dict):
        ctx_in = {}

    ns: dict[str, object] = {"__builtins__": _safe_builtins_dict(), "context": ctx_in, "json": json}

    try:
        exec(compile(code, "<python_code>", "exec"), ns, ns)
    except BaseException as e:
        sys.stdout.write(
            json.dumps(
                {"ok": False, "error": str(e), "traceback": traceback.format_exc()},
                ensure_ascii=False,
                default=str,
            )
            + "\n"
        )
        sys.stdout.flush()
        return

    res = ns.get("__result__")
    if res is None and "result" in ns:
        res = ns.get("result")

    rv_out = ns.get("__run_variables__")
    if rv_out is not None and not isinstance(rv_out, dict):
        sys.stdout.write(
            json.dumps(
                {"ok": False, "error": "__run_variables__ must be a dict if set"},
                ensure_ascii=False,
            )
            + "\n"
        )
        sys.stdout.flush()
        return

    out_obj: dict[str, object] = {"ok": True, "result": res}
    if isinstance(rv_out, dict) and rv_out:
        out_obj["run_variables"] = rv_out
    try:
        line_out = json.dumps(out_obj, ensure_ascii=False, default=str) + "\n"
    except (TypeError, ValueError) as ser_e:
        sys.stdout.write(
            json.dumps({"ok": False, "error": f"result_not_jsonable:{ser_e}"}, ensure_ascii=False, default=str)
            + "\n"
        )
        sys.stdout.flush()
        return

    sys.stdout.write(line_out)
    sys.stdout.flush()


if __name__ == "__main__":
    main()
