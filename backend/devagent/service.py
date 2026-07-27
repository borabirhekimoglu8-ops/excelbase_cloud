"""A Claude that develops Excelbase from inside Excelbase.

Built on the Claude Agent SDK -- the same harness Claude Code runs on -- rather
than on hand-rolled file and shell tools, so the permission model, the agent
loop and the built-in editing tools are the ones Anthropic maintains.

The architecture exists to keep one promise: **the running application never
edits itself.** The agent works in a git worktree, which is a separate checkout
sharing the same object store, so the live process keeps serving the code it
started with while the agent changes a copy. Nothing reaches the running app
until the operator applies it, and nothing can be applied that does not pass
the test suite.

That matters more here than in an ordinary codebase: this app holds real
passengers' passport data in browser vaults, and a defect in the encryption
path would make existing data unreadable. Git can revert the code; it cannot
revert data that can no longer be decrypted.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import subprocess
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path

from backend.config import DevAgentSettings, dev_agent_settings

logger = logging.getLogger(__name__)

# The branch the agent commits to. Kept off the working branch so a review can
# happen before anything the operator runs is affected.
WORKTREE_BRANCH = "excelbase/dev-agent"
WORKTREE_DIRNAME = ".dev-worktree"

# Tools the agent may use. Read/search/edit plus the shell it needs to run
# tests; anything not listed is refused by the SDK.
ALLOWED_TOOLS = ("Read", "Write", "Edit", "Glob", "Grep", "Bash", "TodoWrite")

_SYSTEM_PROMPT = """\
Excelbase Operations deposunda çalışan bir geliştiricisin.

Bu uygulama gerçek yolcuların pasaport verisini tarayıcıdaki şifreli kasada
tutuyor. Kasa şifreleme kodundaki bir hata mevcut verileri kalıcı olarak
okunamaz hale getirir; git kodu geri alır, veriyi geri almaz. Bu yüzden:

- Değişikliğini yaptıktan sonra ilgili testleri çalıştır ve geçtiğini gör.
- Şifreleme, kasa ve kimlik doğrulama kodunda değişiklik yapman istenirse
  önce ne değiştireceğini açıkça söyle, sonra en küçük değişikliği yap.
- Var olan testleri silme veya zayıflatma. Bir test engel oluyorsa sebebini
  açıkla.
- Sır (API anahtarı, parola) yazma; .env dosyalarına dokunma.
- Türkçe yanıt ver ve ne yaptığını kısaca özetle.

Çalışma dizinin ayrı bir git worktree'sidir; canlı uygulama etkilenmez.
"""


class DevAgentUnavailableError(RuntimeError):
    """Raised when the deployment has not opened this door."""


class DevAgentError(RuntimeError):
    """Raised for a sanitized development-run failure."""


@dataclass(frozen=True, slots=True)
class TestOutcome:
    # Not a pytest test class, despite the name pytest matches on.
    __test__ = False

    name: str
    passed: bool
    detail: str


@dataclass(slots=True)
class DevRunResult:
    """What one development run produced, before anything is applied."""

    summary: str = ""
    changed_files: list[str] = field(default_factory=list)
    diff: str = ""
    tests: list[TestOutcome] = field(default_factory=list)
    committed: str = ""
    cost_usd: float = 0.0

    @property
    def applicable(self) -> bool:
        """A run may only be applied when it changed something and is green."""
        return bool(self.changed_files) and all(test.passed for test in self.tests)


def dev_agent_state(settings: DevAgentSettings | None = None) -> str:
    """Why the development agent is or is not available, in one word."""
    resolved = settings or dev_agent_settings()
    if not resolved.enabled:
        return "disabled"
    if not resolved.closed_deployment:
        # An internet-reachable deployment with code-writing authority is a
        # backdoor, not a feature, however it is labelled.
        return "blocked_open_network"
    if not resolved.api_key:
        return "api_key_missing"
    if not (Path(resolved.repository) / ".git").exists():
        return "not_a_repository"
    return "ready"


def _git(repository: Path, *args: str, check: bool = True) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=repository,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if check and result.returncode != 0:
        # stderr can name paths but never file contents.
        raise DevAgentError(f"git {args[0]} başarısız: {result.stderr.strip()[:300]}")
    return result.stdout


def prepare_worktree(settings: DevAgentSettings) -> Path:
    """Create or refresh the isolated checkout the agent works in.

    Reusing one worktree keeps successive runs cheap; resetting it to the
    current branch first means each run starts from what the operator is
    actually running, not from whatever the previous run left behind.
    """
    repository = Path(settings.repository).resolve()
    worktree = repository / WORKTREE_DIRNAME

    if worktree.exists():
        _git(worktree, "reset", "--hard", "HEAD")
        _git(worktree, "clean", "-fd")
        _git(worktree, "checkout", "-B", WORKTREE_BRANCH, "HEAD")
        return worktree

    # The worktree lives inside the repository, so git would otherwise report
    # it as an untracked directory and every later cleanliness check would see
    # a dirty tree. Writing the ignore entry here keeps a fresh clone working
    # without a manual step.
    _ensure_ignored(repository)
    head = _git(repository, "rev-parse", "HEAD").strip()
    _git(repository, "worktree", "add", "-B", WORKTREE_BRANCH, str(worktree), head)
    return worktree


def _ensure_ignored(repository: Path) -> None:
    """Hide the worktree from git status without touching a tracked file.

    ``.git/info/exclude`` is git's per-checkout ignore list: it is never
    committed and never shows up as a change, which is exactly right for a
    directory that is an artefact of this machine rather than of the project.
    Writing to the tracked ``.gitignore`` instead would make every operator's
    repository carry our local scratch path.
    """
    common = _git(repository, "rev-parse", "--git-common-dir").strip()
    exclude = (repository / common if not Path(common).is_absolute() else Path(common)) / "info" / "exclude"
    entry = f"/{WORKTREE_DIRNAME}/"
    existing = exclude.read_text(encoding="utf-8") if exclude.exists() else ""
    if entry in existing.splitlines():
        return
    exclude.parent.mkdir(parents=True, exist_ok=True)
    exclude.write_text(f"{existing.rstrip()}\n{entry}\n".lstrip("\n"), encoding="utf-8")


def remove_worktree(settings: DevAgentSettings) -> None:
    """Drop the worktree, e.g. to recover from a wedged checkout."""
    repository = Path(settings.repository).resolve()
    worktree = repository / WORKTREE_DIRNAME
    if not worktree.exists():
        return
    _git(repository, "worktree", "remove", "--force", str(worktree), check=False)
    shutil.rmtree(worktree, ignore_errors=True)


def _run_suite(worktree: Path, name: str, command: list[str], cwd: Path) -> TestOutcome:
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=900,
        )
    except FileNotFoundError:
        # A suite whose runner is absent cannot vouch for anything, so it is
        # reported rather than silently counted as a pass.
        return TestOutcome(name=name, passed=False, detail="Çalıştırıcı bulunamadı.")
    except subprocess.TimeoutExpired:
        return TestOutcome(name=name, passed=False, detail="Zaman aşımı.")
    tail = (result.stdout or result.stderr or "").strip().splitlines()[-12:]
    return TestOutcome(
        name=name,
        passed=result.returncode == 0,
        detail="\n".join(tail)[:1200],
    )


def run_test_gate(worktree: Path) -> list[TestOutcome]:
    """Everything that must be green before a run may be applied."""
    outcomes = [
        _run_suite(worktree, "pytest", ["python", "-m", "pytest", "tests", "-q"], worktree),
    ]
    frontend = worktree / "frontend"
    # The frontend suites need an installed node_modules; skipping them
    # honestly beats reporting a pass that never ran.
    if (frontend / "node_modules").exists():
        outcomes.append(
            _run_suite(worktree, "tsc", ["npm", "run", "lint"], frontend),
        )
        outcomes.append(
            _run_suite(worktree, "vitest", ["npm", "test"], frontend),
        )
    else:
        outcomes.append(
            TestOutcome(
                name="frontend",
                passed=False,
                detail="frontend/node_modules yok; `npm ci` çalıştırın.",
            )
        )
    return outcomes


def collect_changes(worktree: Path) -> tuple[list[str], str]:
    """Files the agent touched, and the diff an operator will review."""
    _git(worktree, "add", "-A")
    names = [
        line.strip()
        for line in _git(worktree, "diff", "--cached", "--name-only").splitlines()
        if line.strip()
    ]
    diff = _git(worktree, "diff", "--cached", "--stat")
    return names, diff


def commit_changes(worktree: Path, message: str) -> str:
    if not collect_changes(worktree)[0]:
        return ""
    _git(worktree, "-c", "user.name=Excelbase Dev Agent",
         "-c", "user.email=dev-agent@excelbase.local",
         "commit", "-m", message[:2000])
    return _git(worktree, "rev-parse", "HEAD").strip()


async def stream_development(
    instruction: str,
    settings: DevAgentSettings | None = None,
) -> AsyncIterator[dict]:
    """Run one development request, yielding progress as it happens.

    Every yielded event is a small dict the transport can serialize; the
    caller decides how to present it.
    """
    resolved = settings or dev_agent_settings()
    state = dev_agent_state(resolved)
    if state != "ready":
        raise DevAgentUnavailableError(state)

    cleaned = instruction.strip()
    if not cleaned:
        raise DevAgentError("Boş istek.")

    try:
        from claude_agent_sdk import (
            AssistantMessage,
            ClaudeAgentOptions,
            ResultMessage,
            TextBlock,
            ToolUseBlock,
            query,
        )
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise DevAgentError(
            "claude-agent-sdk kurulu değil. `pip install claude-agent-sdk` çalıştırın."
        ) from exc

    worktree = await asyncio.to_thread(prepare_worktree, resolved)
    yield {"type": "started", "worktree": str(worktree)}

    options = ClaudeAgentOptions(
        cwd=str(worktree),
        model=resolved.model,
        system_prompt=_SYSTEM_PROMPT,
        allowed_tools=list(ALLOWED_TOOLS),
        # The worktree is the whole world for this run.
        permission_mode="acceptEdits",
        max_turns=resolved.max_turns,
        # A hard ceiling the model cannot talk its way past, unlike a prompt.
        max_budget_usd=resolved.max_budget_usd,
        env={"ANTHROPIC_API_KEY": resolved.api_key},
    )

    summary_parts: list[str] = []
    cost = 0.0
    async for message in query(prompt=cleaned, options=options):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock) and block.text.strip():
                    summary_parts.append(block.text.strip())
                    yield {"type": "text", "text": block.text.strip()}
                elif isinstance(block, ToolUseBlock):
                    yield {"type": "tool", "name": block.name}
        elif isinstance(message, ResultMessage):
            cost = float(getattr(message, "total_cost_usd", 0.0) or 0.0)

    changed, diff = await asyncio.to_thread(collect_changes, worktree)
    yield {"type": "changes", "files": changed, "diff": diff}

    tests: list[TestOutcome] = []
    if changed:
        yield {"type": "testing"}
        tests = await asyncio.to_thread(run_test_gate, worktree)
        for outcome in tests:
            yield {
                "type": "test",
                "name": outcome.name,
                "passed": outcome.passed,
                "detail": outcome.detail,
            }

    committed = ""
    if changed and all(test.passed for test in tests):
        committed = await asyncio.to_thread(
            commit_changes, worktree, f"{cleaned[:72]}\n\nExcelbase dev agent."
        )

    yield {
        "type": "finished",
        "summary": "\n\n".join(summary_parts)[:8000],
        "files": changed,
        "committed": committed,
        "cost_usd": round(cost, 4),
        "applicable": bool(changed) and all(test.passed for test in tests),
    }


def apply_run(settings: DevAgentSettings | None = None) -> str:
    """Fast-forward the operator's branch onto the agent's commit.

    Deliberately separate from the run itself: reviewing a diff and choosing to
    take it is the step that keeps this a development tool rather than a
    program that rewrites itself while running.
    """
    resolved = settings or dev_agent_settings()
    repository = Path(resolved.repository).resolve()
    worktree = repository / WORKTREE_DIRNAME
    if not worktree.exists():
        raise DevAgentError("Uygulanacak bir çalışma yok.")

    # A run that failed the test gate is never committed, so the agent's branch
    # still points at the operator's own HEAD. `merge --ff-only` would happily
    # succeed on that -- merging nothing -- and the operator would be told the
    # change was applied. Refusing here is the difference between "applied" and
    # "there was nothing to apply".
    head = _git(repository, "rev-parse", "HEAD").strip()
    branch = _git(repository, "rev-parse", "--verify", WORKTREE_BRANCH, check=False).strip()
    if not branch or branch == head:
        raise DevAgentError("Uygulanacak yeni bir değişiklik yok.")

    # The agent's own worktree must not count as the operator's uncommitted
    # work, even on a checkout whose .gitignore predates this feature.
    dirty = [
        line
        for line in _git(repository, "status", "--porcelain").splitlines()
        if line.strip() and WORKTREE_DIRNAME not in line
    ]
    if dirty:
        # Merging over uncommitted edits would mix the operator's work with the
        # agent's, and neither would be cleanly revertable afterwards.
        raise DevAgentError(
            "Çalışma dizininde kaydedilmemiş değişiklik var; önce onları işleyin."
        )
    _git(repository, "merge", "--ff-only", WORKTREE_BRANCH)
    return _git(repository, "rev-parse", "HEAD").strip()
