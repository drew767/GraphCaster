# Copyright GraphCaster. All Rights Reserved.

"""Source control operations via git CLI subprocess (UX57 / F49 extension).

SourceControlManager wraps a local git repository rooted at *workspace_root*.
All git commands are invoked via subprocess (most reliable cross-platform).
Authentication credentials are stored via F8 secrets (workspace .env).
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass
class Commit:
    sha: str
    message: str
    author: str
    date: str
    files_changed: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_log_line(cls, line: str) -> "Commit":
        parts = line.split("\x00")
        sha = parts[0] if len(parts) > 0 else ""
        author = parts[1] if len(parts) > 1 else ""
        date = parts[2] if len(parts) > 2 else ""
        message = parts[3] if len(parts) > 3 else ""
        return cls(sha=sha, author=author, date=date, message=message)


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class GitNotFoundError(RuntimeError):
    """Raised when git executable is not available."""


class GitCommandError(RuntimeError):
    """Raised when a git subprocess returns a non-zero exit code."""

    def __init__(self, returncode: int, stderr: str, cmd: list[str]) -> None:
        self.returncode = returncode
        self.stderr = stderr
        self.cmd = cmd
        super().__init__(f"git {' '.join(cmd[1:])} exited {returncode}: {stderr.strip()[:200]}")


class SourceControlManager:
    """Manage a git repository in *workspace_root* for workflow versioning."""

    def __init__(self, workspace_root: Path) -> None:
        self._root = Path(workspace_root)
        self._git = shutil.which("git") or "git"

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _run(self, *args: str, check: bool = True, capture_output: bool = True) -> subprocess.CompletedProcess:
        cmd = [self._git, *args]
        loop = asyncio.get_event_loop()
        proc = await loop.run_in_executor(
            None,
            lambda: subprocess.run(
                cmd,
                cwd=str(self._root),
                capture_output=capture_output,
                text=True,
                encoding="utf-8",
                errors="replace",
                env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
            ),
        )
        if check and proc.returncode != 0:
            raise GitCommandError(proc.returncode, proc.stderr, cmd)
        return proc

    def _is_repo(self) -> bool:
        return (self._root / ".git").exists()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def get_status(self) -> dict[str, Any]:
        """Return repository status: connected, branch, ahead/behind, pending changes."""
        if not self._is_repo():
            return {
                "connected": False,
                "branch": "",
                "ahead": 0,
                "behind": 0,
                "pending_changes": [],
            }
        try:
            branch_proc = await self._run("rev-parse", "--abbrev-ref", "HEAD")
            branch = branch_proc.stdout.strip()

            ahead = 0
            behind = 0
            try:
                rev_proc = await self._run("rev-list", "--left-right", "--count", f"@{{u}}...HEAD")
                parts = rev_proc.stdout.strip().split()
                if len(parts) == 2:
                    behind = int(parts[0])
                    ahead = int(parts[1])
            except (GitCommandError, ValueError):
                pass

            status_proc = await self._run("status", "--porcelain")
            pending: list[dict[str, str]] = []
            for line in status_proc.stdout.splitlines():
                if len(line) >= 3:
                    xy = line[:2]
                    filepath = line[3:]
                    pending.append({"status": xy.strip(), "file": filepath})

            return {
                "connected": True,
                "branch": branch,
                "ahead": ahead,
                "behind": behind,
                "pending_changes": pending,
            }
        except GitCommandError as exc:
            return {
                "connected": False,
                "branch": "",
                "ahead": 0,
                "behind": 0,
                "pending_changes": [],
                "error": str(exc),
            }

    async def connect(self, repo_url: str, branch: str, auth: dict[str, Any]) -> None:
        """Initialise or re-initialise the workspace git repo and add/update remote."""
        self._root.mkdir(parents=True, exist_ok=True)
        if not self._is_repo():
            await self._run("init")

        remote_proc = await self._run("remote", check=False)
        if "origin" not in remote_proc.stdout.splitlines():
            await self._run("remote", "add", "origin", repo_url)
        else:
            await self._run("remote", "set-url", "origin", repo_url)

        try:
            await self._run("fetch", "origin", branch)
            await self._run("checkout", "-B", branch, f"origin/{branch}")
        except GitCommandError:
            await self._run("checkout", "-B", branch)

        if auth:
            self._store_auth(auth)

    async def disconnect(self) -> None:
        """Remove the git remote; leaves local history intact."""
        if not self._is_repo():
            return
        await self._run("remote", "remove", "origin", check=False)

    async def list_branches(self) -> list[str]:
        if not self._is_repo():
            return []
        proc = await self._run("branch", "-a")
        branches = []
        for line in proc.stdout.splitlines():
            b = line.strip().lstrip("* ")
            if b and not b.startswith("HEAD"):
                branches.append(b)
        return branches

    async def pull(self, *, force: bool = False) -> dict[str, Any]:
        if not self._is_repo():
            raise GitCommandError(1, "Not a git repository", [self._git])
        if force:
            await self._run("fetch", "origin")
            branch_proc = await self._run("rev-parse", "--abbrev-ref", "HEAD")
            branch = branch_proc.stdout.strip()
            await self._run("reset", "--hard", f"origin/{branch}")
            return {"applied": ["force-reset"], "conflicts": []}

        proc = await self._run("pull", "--rebase", check=False)
        if proc.returncode == 0:
            applied = [l.strip() for l in proc.stdout.splitlines() if l.strip()]
            return {"applied": applied, "conflicts": []}
        conflicts_proc = await self._run("diff", "--name-only", "--diff-filter=U", check=False)
        conflicts = [l.strip() for l in conflicts_proc.stdout.splitlines() if l.strip()]
        await self._run("rebase", "--abort", check=False)
        return {"applied": [], "conflicts": conflicts}

    async def push(self, message: str, files: list[str], *, force: bool = False) -> dict[str, int]:
        if not self._is_repo():
            raise GitCommandError(1, "Not a git repository", [self._git])
        if not files:
            proc = await self._run("add", "-A", check=False)
        else:
            for f in files:
                await self._run("add", "--", f, check=False)

        diff_proc = await self._run("diff", "--cached", "--name-only", check=False)
        staged = [l.strip() for l in diff_proc.stdout.splitlines() if l.strip()]
        if not staged:
            return {"pushed": 0}

        await self._run("commit", "-m", message or "chore: graph-caster sync")
        push_args = ["push", "origin"]
        if force:
            push_args.append("--force")
        await self._run(*push_args)
        return {"pushed": len(staged)}

    async def get_history(self, limit: int = 50) -> list[Commit]:
        if not self._is_repo():
            return []
        fmt = "--pretty=format:%H%x00%an%x00%aI%x00%s"
        proc = await self._run("log", fmt, f"-{limit}", check=False)
        commits = []
        for line in proc.stdout.splitlines():
            if line.strip():
                commits.append(Commit.from_log_line(line))
        return commits

    async def diff(self, commit_a: str, commit_b: str) -> dict[str, Any]:
        if not self._is_repo():
            return {"diff": "", "files": []}
        proc = await self._run("diff", "--stat", commit_a, commit_b, check=False)
        files_proc = await self._run("diff", "--name-only", commit_a, commit_b, check=False)
        files = [l.strip() for l in files_proc.stdout.splitlines() if l.strip()]
        return {"diff": proc.stdout, "files": files, "a": commit_a, "b": commit_b}

    # ------------------------------------------------------------------
    # Auth helpers
    # ------------------------------------------------------------------

    def _store_auth(self, auth: dict[str, Any]) -> None:
        """Persist git credentials via git config (credential.helper = store is not used;
        we write a .netrc-style file inside the workspace .graphcaster dir)."""
        token = auth.get("token") or auth.get("password") or ""
        username = auth.get("username") or "oauth2"
        if not token:
            return
        netrc_path = self._root / ".graphcaster" / ".git-credentials"
        netrc_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            remote_proc = subprocess.run(
                [self._git, "remote", "get-url", "origin"],
                cwd=str(self._root),
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            remote_url = remote_proc.stdout.strip()
            if remote_url.startswith("https://"):
                from urllib.parse import urlparse, urlunparse
                parsed = urlparse(remote_url)
                cred_url = urlunparse(parsed._replace(netloc=f"{username}:{token}@{parsed.hostname}"))
                netrc_path.write_text(cred_url + "\n", encoding="utf-8")
                subprocess.run(
                    [self._git, "config", "credential.helper", f"store --file={netrc_path}"],
                    cwd=str(self._root),
                    capture_output=True,
                )
        except Exception:
            pass
