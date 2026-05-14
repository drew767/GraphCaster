// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { HasScope } from "./HasScope";
import { getScopes, hasScope, useScopes, type Scope } from "./scopes";

function setStoredScopes(scopes: Scope[]): void {
  window.localStorage.setItem("gc.user.scopes", JSON.stringify(scopes));
}

function ScopesProbe({ onSet }: { onSet: (s: Set<Scope>) => void }) {
  const set = useScopes();
  onSet(set);
  return null;
}

describe("scopes", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("useScopes returns parsed set from localStorage", () => {
    setStoredScopes(["workflow:read", "workflow:write"]);
    let captured!: Set<Scope>;
    render(<ScopesProbe onSet={(s) => (captured = s)} />);
    expect(captured.has("workflow:read")).toBe(true);
    expect(captured.has("workflow:write")).toBe(true);
    expect(captured.has("admin")).toBe(false);
  });

  it("getScopes drops unknown scope strings", () => {
    setStoredScopes(["workflow:read", "bogus:scope" as Scope]);
    const set = getScopes();
    expect(set.has("workflow:read")).toBe(true);
    expect(set.has("bogus:scope" as Scope)).toBe(false);
  });

  it("hasScope honors admin implication", () => {
    const adminOnly = new Set<Scope>(["admin"]);
    expect(hasScope(adminOnly, "workflow:write")).toBe(true);
    expect(hasScope(adminOnly, ["credential:write", "user:invite"])).toBe(true);
  });

  it("hasScope requires every scope in array", () => {
    const set = new Set<Scope>(["workflow:read", "credential:read"]);
    expect(hasScope(set, "workflow:read")).toBe(true);
    expect(hasScope(set, ["workflow:read", "credential:read"])).toBe(true);
    expect(hasScope(set, ["workflow:read", "credential:write"])).toBe(false);
  });

  it("hasScope treats empty configured set as permissive (backward-compat)", () => {
    const empty = new Set<Scope>();
    expect(hasScope(empty, "workflow:write")).toBe(true);
  });
});

describe("HasScope", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders children when scope is matched", () => {
    setStoredScopes(["workflow:write"]);
    render(
      <HasScope scope="workflow:write">
        <span data-testid="child">ok</span>
      </HasScope>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("renders fallback when scope is missing", () => {
    setStoredScopes(["workflow:read"]);
    render(
      <HasScope
        scope="workflow:write"
        fallback={<span data-testid="fallback">nope</span>}
      >
        <span data-testid="child">ok</span>
      </HasScope>,
    );
    expect(screen.queryByTestId("child")).toBeNull();
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
  });

  it("renders null fallback by default when scope is missing", () => {
    setStoredScopes(["workflow:read"]);
    const { container } = render(
      <HasScope scope="credential:write">
        <span data-testid="child">ok</span>
      </HasScope>,
    );
    expect(screen.queryByTestId("child")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders children for admin scope regardless of required", () => {
    setStoredScopes(["admin"]);
    render(
      <HasScope scope={["credential:write", "user:invite"]}>
        <span data-testid="child">ok</span>
      </HasScope>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});
