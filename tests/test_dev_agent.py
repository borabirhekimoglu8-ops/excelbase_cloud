"""Tests for the in-app development agent.

The agent's whole value proposition is that it can change this application's
code, so the tests that matter are the ones about what it *cannot* do: it
cannot run on a deployment the internet can reach, it cannot touch the files
the live process is serving, and its work cannot reach the operator's branch
without passing the test gate and an explicit apply.
"""

from __future__ import annotations

import asyncio
import subprocess
import sys
from pathlib import Path
from types import ModuleType

import pytest
from fastapi.testclient import TestClient

from backend.config import DevAgentSettings, dev_agent_settings
from backend.devagent import service as devagent
from backend.devagent.service import (
    WORKTREE_BRANCH,
    WORKTREE_DIRNAME,
    DevAgentError,
    DevAgentUnavailableError,
    DevRunResult,
    TestOutcome,
    apply_run,
    collect_changes,
    commit_changes,
    dev_agent_state,
    prepare_worktree,
    run_test_gate,
    stream_development,
)
from backend.main import app


def _git(repository: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=repository,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


@pytest.fixture()
def repository(tmp_path: Path) -> Path:
    """A throwaway git repository standing in for the operator's checkout."""
    root = tmp_path / "checkout"
    root.mkdir()
    _git(root, "init", "-b", "main")
    _git(root, "config", "user.name", "Test Operator")
    _git(root, "config", "user.email", "operator@excelbase.test")
    (root / "app.py").write_text("VERSION = 1\n", encoding="utf-8")
    _git(root, "add", "-A")
    _git(root, "commit", "-m", "initial")
    return root


def _settings(repository: Path, **overrides) -> DevAgentSettings:
    base = {
        "enabled": True,
        "closed_deployment": True,
        "repository": str(repository),
        "api_key": "sk-ant-test",
    }
    base.update(overrides)
    return DevAgentSettings(**base)


# --- availability ---------------------------------------------------------


def test_dev_agent_stays_off_until_it_is_deliberately_switched_on(monkeypatch, repository):
    monkeypatch.delenv("EXCELBASE_DEV_AGENT", raising=False)
    monkeypatch.setenv("EXCELBASE_DEV_AGENT_REPOSITORY", str(repository))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")

    assert dev_agent_state(dev_agent_settings()) == "disabled"


def test_dev_agent_refuses_a_deployment_the_internet_can_reach(monkeypatch, repository):
    """Code-writing authority plus open access is a backdoor, not a feature."""
    monkeypatch.setenv("EXCELBASE_DEV_AGENT", "1")
    monkeypatch.setenv("EXCELBASE_DEV_AGENT_REPOSITORY", str(repository))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_OPEN_ACCESS", "1")
    monkeypatch.delenv("EXCELBASE_ASSISTANT_ALLOWED_IPS", raising=False)

    settings = dev_agent_settings()
    assert settings.closed_deployment is False
    assert dev_agent_state(settings) == "blocked_open_network"


def test_open_access_scoped_to_named_networks_still_counts_as_closed(monkeypatch, repository):
    """The operator's own network is the closure; an access code is not the only one."""
    monkeypatch.setenv("EXCELBASE_DEV_AGENT", "1")
    monkeypatch.setenv("EXCELBASE_DEV_AGENT_REPOSITORY", str(repository))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_OPEN_ACCESS", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_ALLOWED_IPS", "100.64.0.0/10")

    assert dev_agent_state(dev_agent_settings()) == "ready"


def test_dev_agent_never_reports_ready_without_the_sdk_it_runs_on(repository, monkeypatch):
    """"Ready" followed by a failure on first use is an undiagnosable outage."""
    monkeypatch.delitem(sys.modules, "claude_agent_sdk", raising=False)
    monkeypatch.setattr(
        devagent.importlib.util,
        "find_spec",
        lambda name: None if name == "claude_agent_sdk" else object(),
    )

    assert dev_agent_state(_settings(repository)) == "sdk_missing"


def test_a_malformed_sdk_installation_is_not_an_installation(repository, monkeypatch):
    """The status endpoint answers; it does not propagate an import error."""
    monkeypatch.delitem(sys.modules, "claude_agent_sdk", raising=False)

    def _broken(name: str):
        raise ValueError("claude_agent_sdk.__spec__ is None")

    monkeypatch.setattr(devagent.importlib.util, "find_spec", _broken)

    assert dev_agent_state(_settings(repository)) == "sdk_missing"


def test_dev_agent_names_a_missing_key_and_a_missing_repository(tmp_path, repository):
    assert dev_agent_state(_settings(repository, api_key="")) == "api_key_missing"
    assert (
        dev_agent_state(_settings(tmp_path / "not-a-checkout")) == "not_a_repository"
    )
    assert dev_agent_state(_settings(repository)) == "ready"


# --- isolation ------------------------------------------------------------


def test_the_agent_works_on_a_copy_while_the_live_code_keeps_serving(repository):
    settings = _settings(repository)
    worktree = prepare_worktree(settings)

    (worktree / "app.py").write_text("VERSION = 2\n", encoding="utf-8")

    # The running process reads the operator's checkout, which is untouched.
    assert (repository / "app.py").read_text(encoding="utf-8") == "VERSION = 1\n"
    assert worktree.resolve() != repository.resolve()
    assert _git(repository, "rev-parse", "--abbrev-ref", "HEAD").strip() == "main"


def test_the_worktree_is_hidden_from_git_without_touching_a_tracked_file(repository):
    """A local scratch directory belongs in .git/info/exclude, not .gitignore."""
    prepare_worktree(_settings(repository))

    assert not (repository / ".gitignore").exists()
    exclude = (repository / ".git" / "info" / "exclude").read_text(encoding="utf-8")
    assert f"/{WORKTREE_DIRNAME}/" in exclude.splitlines()
    # Nothing the agent set up may look like the operator's uncommitted work.
    assert _git(repository, "status", "--porcelain").strip() == ""


def test_each_run_starts_from_the_code_the_operator_is_running(repository):
    settings = _settings(repository)
    worktree = prepare_worktree(settings)
    (worktree / "app.py").write_text("half-finished\n", encoding="utf-8")
    (worktree / "scratch.txt").write_text("left behind\n", encoding="utf-8")

    prepare_worktree(settings)

    assert (worktree / "app.py").read_text(encoding="utf-8") == "VERSION = 1\n"
    assert not (worktree / "scratch.txt").exists()


def test_preparing_a_worktree_twice_is_not_an_error(repository):
    settings = _settings(repository)
    assert prepare_worktree(settings) == prepare_worktree(settings)


# --- the test gate --------------------------------------------------------


def test_a_suite_that_could_not_run_is_reported_as_failed_not_skipped(repository, monkeypatch):
    """Silence from an absent runner must never read as a pass."""
    worktree = prepare_worktree(_settings(repository))

    outcomes = {outcome.name: outcome for outcome in run_test_gate(worktree)}

    # There is no tests/ directory and no node_modules in this fixture.
    assert outcomes["pytest"].passed is False
    assert outcomes["frontend"].passed is False
    assert "node_modules" in outcomes["frontend"].detail


def test_the_gate_uses_this_servers_interpreter_not_whatever_python_resolves_to(
    repository, monkeypatch
):
    """The server runs in the project virtualenv, which is where pytest lives.
    A bare "python" picked up the system interpreter on Windows and reported
    "No module named pytest" -- a gate failure that said nothing about the code
    it was supposed to be judging."""
    worktree = prepare_worktree(_settings(repository))
    commands: list[list[str]] = []

    monkeypatch.setattr(
        devagent,
        "_run_suite",
        lambda wt, name, command, cwd: (
            commands.append(command),
            TestOutcome(name=name, passed=True, detail=""),
        )[1],
    )
    monkeypatch.setattr(devagent, "_npm_executable", lambda: "/usr/bin/npm")
    monkeypatch.setattr(devagent, "_link_node_modules", lambda wt: True)

    run_test_gate(worktree)

    assert commands[0][0] == sys.executable
    assert commands[0][1:] == ["-m", "pytest", "tests", "-q"]


def test_a_missing_pytest_is_reported_as_a_missing_tool_not_a_failing_test(
    repository, monkeypatch
):
    """pytest was never a declared dependency, so the gate stayed red on a
    machine where the agent's code was fine -- failing because of its own
    missing tool rather than the code it was judging. The operator's next move
    is to install it, so the message has to say that."""
    worktree = prepare_worktree(_settings(repository))

    def fake_suite(wt, name, command, cwd):
        if name == "pytest":
            return TestOutcome(
                name="pytest",
                passed=False,
                detail="C:\\...\\.venv\\Scripts\\python.exe: No module named pytest",
            )
        return TestOutcome(name=name, passed=True, detail="")

    monkeypatch.setattr(devagent, "_run_suite", fake_suite)
    monkeypatch.setattr(devagent, "_npm_executable", lambda: "/usr/bin/npm")
    monkeypatch.setattr(devagent, "_link_node_modules", lambda wt: True)

    outcomes = {outcome.name: outcome for outcome in run_test_gate(worktree)}

    assert outcomes["pytest"].passed is False
    assert "pytest kurulu değil" in outcomes["pytest"].detail
    assert "run.ps1" in outcomes["pytest"].detail


def test_the_gate_resolves_npm_rather_than_trusting_the_bare_name(
    repository, monkeypatch
):
    """"npm" is npm.cmd on Windows and subprocess will not find it without a
    shell: both frontend suites came back "Çalıştırıcı bulunamadı" on a machine
    where npm was installed and working."""
    worktree = prepare_worktree(_settings(repository))
    commands: list[list[str]] = []

    monkeypatch.setattr(
        devagent,
        "_run_suite",
        lambda wt, name, command, cwd: (
            commands.append(command),
            TestOutcome(name=name, passed=True, detail=""),
        )[1],
    )
    monkeypatch.setattr(devagent, "_npm_executable", lambda: "C:/npm/npm.cmd")
    monkeypatch.setattr(devagent, "_link_node_modules", lambda wt: True)

    run_test_gate(worktree)

    assert commands[1] == ["C:/npm/npm.cmd", "run", "lint"]
    assert commands[2] == ["C:/npm/npm.cmd", "test"]


def test_the_gate_reports_a_missing_npm_rather_than_skipping_the_frontend(
    repository, monkeypatch
):
    worktree = prepare_worktree(_settings(repository))
    monkeypatch.setattr(devagent, "_npm_executable", lambda: None)
    monkeypatch.setattr(
        devagent,
        "_run_suite",
        lambda wt, name, command, cwd: TestOutcome(name=name, passed=True, detail=""),
    )

    outcomes = {outcome.name: outcome for outcome in run_test_gate(worktree)}

    assert outcomes["frontend"].passed is False
    assert "npm" in outcomes["frontend"].detail


def test_the_worktree_borrows_node_modules_from_the_main_checkout(repository):
    """A fresh worktree has no node_modules and reinstalling it per run would
    dominate every gate, so it is linked from the checkout beside it."""
    (repository / "frontend").mkdir(exist_ok=True)
    (repository / "frontend" / "node_modules").mkdir(exist_ok=True)
    (repository / "frontend" / "node_modules" / "marker.txt").write_text("x", encoding="utf-8")
    worktree = prepare_worktree(_settings(repository))
    (worktree / "frontend").mkdir(exist_ok=True)

    assert devagent._link_node_modules(worktree) is True
    assert (worktree / "frontend" / "node_modules" / "marker.txt").exists()


def test_a_missing_runner_fails_the_suite_instead_of_raising(repository):
    worktree = prepare_worktree(_settings(repository))

    outcome = devagent._run_suite(
        worktree, "kayip", ["excelbase-command-that-does-not-exist"], worktree
    )

    assert outcome.passed is False
    assert "bulunamadı" in outcome.detail


def test_a_run_is_applicable_only_when_it_changed_something_and_is_green():
    green = TestOutcome(name="pytest", passed=True, detail="")
    red = TestOutcome(name="pytest", passed=False, detail="1 failed")

    assert DevRunResult(changed_files=["app.py"], tests=[green]).applicable is True
    assert DevRunResult(changed_files=["app.py"], tests=[green, red]).applicable is False
    assert DevRunResult(changed_files=[], tests=[green]).applicable is False


# --- applying -------------------------------------------------------------


def test_applying_fast_forwards_the_operators_branch_onto_the_agents_commit(repository):
    settings = _settings(repository)
    worktree = prepare_worktree(settings)
    (worktree / "app.py").write_text("VERSION = 2\n", encoding="utf-8")
    commit = commit_changes(worktree, "bump the version")
    assert commit

    # Before applying, the live checkout is still on the old code.
    assert (repository / "app.py").read_text(encoding="utf-8") == "VERSION = 1\n"

    head = apply_run(settings)

    assert head == commit
    assert (repository / "app.py").read_text(encoding="utf-8") == "VERSION = 2\n"


def test_applying_the_same_run_twice_is_reported_as_nothing_to_apply(repository):
    settings = _settings(repository)
    worktree = prepare_worktree(settings)
    (worktree / "app.py").write_text("VERSION = 2\n", encoding="utf-8")
    commit_changes(worktree, "bump the version")
    apply_run(settings)

    with pytest.raises(DevAgentError):
        apply_run(settings)


def test_applying_refuses_while_the_operator_has_uncommitted_work(repository):
    settings = _settings(repository)
    worktree = prepare_worktree(settings)
    (worktree / "app.py").write_text("VERSION = 2\n", encoding="utf-8")
    commit_changes(worktree, "bump the version")

    # The operator was editing at the same time.
    (repository / "app.py").write_text("VERSION = 1  # elle düzenlendi\n", encoding="utf-8")

    with pytest.raises(DevAgentError):
        apply_run(settings)

    # Their edit survives untouched; nothing was merged over it.
    assert "elle düzenlendi" in (repository / "app.py").read_text(encoding="utf-8")


def test_applying_refuses_before_anything_has_been_run(repository):
    with pytest.raises(DevAgentError):
        apply_run(_settings(repository))


def test_committing_nothing_produces_no_commit(repository):
    settings = _settings(repository)
    worktree = prepare_worktree(settings)

    assert commit_changes(worktree, "boş") == ""
    assert collect_changes(worktree)[0] == []


# --- the run itself -------------------------------------------------------


def test_a_run_is_refused_before_the_agent_is_available(repository):
    async def consume():
        return [
            event
            async for event in stream_development("bir şey yap", _settings(repository, enabled=False))
        ]

    with pytest.raises(DevAgentUnavailableError) as excinfo:
        asyncio.run(consume())

    assert str(excinfo.value) == "disabled"


def _install_fake_sdk(monkeypatch, on_run, raise_after: Exception | None = None) -> dict:
    """Stand in for claude-agent-sdk, recording the options it was handed.

    ``raise_after`` reproduces how the real SDK ends a run it stopped early: it
    raises a bare Exception whose text is the CLI's result string, after the
    agent has already written files.
    """
    recorded: dict = {}

    class ClaudeAgentOptions:
        def __init__(self, **kwargs):
            recorded.update(kwargs)

    class TextBlock:
        def __init__(self, text: str):
            self.text = text

    class ToolUseBlock:
        def __init__(self, name: str):
            self.name = name

    class AssistantMessage:
        def __init__(self, content):
            self.content = content

    class ResultMessage:
        def __init__(self, total_cost_usd: float):
            self.total_cost_usd = total_cost_usd

    async def query(prompt: str, options):
        recorded["prompt"] = prompt
        on_run(Path(recorded["cwd"]))
        yield AssistantMessage([TextBlock("Sürümü yükselttim."), ToolUseBlock("Edit")])
        if raise_after is not None:
            raise raise_after
        yield ResultMessage(0.42)

    module = ModuleType("claude_agent_sdk")
    module.ClaudeAgentOptions = ClaudeAgentOptions
    module.TextBlock = TextBlock
    module.ToolUseBlock = ToolUseBlock
    module.AssistantMessage = AssistantMessage
    module.ResultMessage = ResultMessage
    module.query = query
    monkeypatch.setitem(sys.modules, "claude_agent_sdk", module)
    return recorded


def test_a_run_edits_the_worktree_and_commits_only_when_the_gate_is_green(
    repository, monkeypatch
):
    recorded = _install_fake_sdk(
        monkeypatch,
        lambda cwd: (cwd / "app.py").write_text("VERSION = 2\n", encoding="utf-8"),
    )
    monkeypatch.setattr(
        devagent,
        "run_test_gate",
        lambda worktree: [TestOutcome(name="pytest", passed=True, detail="ok")],
    )
    settings = _settings(repository)

    async def consume():
        return [event async for event in stream_development("sürümü yükselt", settings)]

    events = asyncio.run(consume())
    kinds = [event["type"] for event in events]
    finished = events[-1]

    assert kinds[0] == "started"
    assert "testing" in kinds
    # The agent was pointed at the worktree, never at the live checkout.
    assert Path(recorded["cwd"]).name == WORKTREE_DIRNAME
    assert recorded["max_budget_usd"] == settings.max_budget_usd
    assert finished["type"] == "finished"
    assert finished["files"] == ["app.py"]
    assert finished["applicable"] is True
    assert finished["committed"]
    assert finished["cost_usd"] == 0.42
    # Committed on the agent's branch only; applying is a separate decision.
    assert (repository / "app.py").read_text(encoding="utf-8") == "VERSION = 1\n"


def test_running_out_of_turns_still_reviews_and_tests_what_was_written(
    repository, monkeypatch
):
    """Hitting a ceiling we set is an expected end to a large request, not a
    crash. Letting it propagate threw away everything the agent had already
    written -- no diff, no test gate, nothing to review -- so the work was paid
    for and then discarded. Observed against the real SDK, which reports it as
    a bare Exception."""
    recorded = _install_fake_sdk(
        monkeypatch,
        lambda cwd: (cwd / "app.py").write_text("VERSION = 2\n", encoding="utf-8"),
        raise_after=Exception(
            "Claude Code returned an error result: Reached maximum number of turns (40)"
        ),
    )
    assert recorded is not None
    monkeypatch.setattr(
        devagent,
        "run_test_gate",
        lambda worktree: [TestOutcome(name="pytest", passed=True, detail="ok")],
    )
    settings = _settings(repository)

    async def consume():
        return [event async for event in stream_development("büyük iş", settings)]

    events = asyncio.run(consume())
    kinds = [event["type"] for event in events]
    finished = events[-1]

    assert "limit" in kinds
    assert next(e for e in events if e["type"] == "limit")["reason"] == "turns"
    # The gate still ran, and a green run is still applicable.
    assert "testing" in kinds
    assert finished["files"] == ["app.py"]
    assert finished["applicable"] is True
    assert finished["committed"]
    assert finished["stopped_early"] == "turns"


def test_a_genuine_sdk_failure_is_not_reported_as_a_tidy_stop(repository, monkeypatch):
    """Only the two limits we configured are recognised; anything else is a
    real failure and must not be dressed up as a clean early finish."""
    _install_fake_sdk(
        monkeypatch,
        lambda cwd: None,
        raise_after=Exception("Claude Code returned an error result: ENOENT node"),
    )
    settings = _settings(repository)

    async def consume():
        return [event async for event in stream_development("bir şey", settings)]

    with pytest.raises(Exception, match="ENOENT"):
        asyncio.run(consume())


def test_a_red_test_gate_leaves_nothing_to_apply(repository, monkeypatch):
    _install_fake_sdk(
        monkeypatch,
        lambda cwd: (cwd / "app.py").write_text("VERSION = boom\n", encoding="utf-8"),
    )
    monkeypatch.setattr(
        devagent,
        "run_test_gate",
        lambda worktree: [TestOutcome(name="pytest", passed=False, detail="1 failed")],
    )
    settings = _settings(repository)

    async def consume():
        return [event async for event in stream_development("bozuk değişiklik", settings)]

    finished = asyncio.run(consume())[-1]

    assert finished["applicable"] is False
    assert finished["committed"] == ""
    with pytest.raises(DevAgentError):
        # Nothing was committed, so there is nothing to fast-forward onto.
        apply_run(settings)


def test_the_prompt_requires_an_edit_rather_than_a_report():
    """A real run spent $2.15 exploring the repository and wrote an analysis
    instead of code: no files changed, no gate, APPLY dark, nothing to show
    for it. The instruction to implement has to be explicit, so it is asserted
    rather than left to drift out of the prompt."""
    prompt = devagent._SYSTEM_PROMPT

    assert "GÖREVİN KOD YAZMAK" in prompt
    assert "BAŞARISIZDIR" in prompt
    assert "Analiz raporu" in prompt


def test_a_run_that_changed_nothing_never_reaches_the_test_gate(repository, monkeypatch):
    _install_fake_sdk(monkeypatch, lambda cwd: None)

    def _must_not_run(worktree):  # pragma: no cover - asserted by not being called
        raise AssertionError("boş çalışma için test kapısı çalıştırılmamalı")

    monkeypatch.setattr(devagent, "run_test_gate", _must_not_run)
    settings = _settings(repository)

    async def consume():
        return [event async for event in stream_development("hiçbir şey yapma", settings)]

    events = asyncio.run(consume())

    assert "testing" not in [event["type"] for event in events]
    assert events[-1]["applicable"] is False


def test_an_empty_instruction_is_rejected_before_any_spend(repository):
    async def consume():
        return [event async for event in stream_development("   ", _settings(repository))]

    with pytest.raises(DevAgentError):
        asyncio.run(consume())


# --- running in the background --------------------------------------------


def test_a_run_outlives_the_request_that_started_it(repository, monkeypatch):
    """The whole point: the operator starts a run and goes back to using the
    application. If the run were tied to the request, closing the panel or
    moving to another screen would cancel work already paid for and possibly
    half-applied to files."""
    from backend.devagent import runner

    released = asyncio.Event()

    async def slow_stream(instruction, settings=None):
        yield {"type": "started", "worktree": "/x"}
        await released.wait()
        yield {"type": "finished", "summary": "", "files": [], "committed": "",
               "cost_usd": 0.0, "applicable": False}

    monkeypatch.setattr(runner, "stream_development", slow_stream)

    async def scenario():
        runner.reset_for_tests()
        run = runner.start_run("bir şey yap", _settings(repository))
        # The starting call has already returned while the run continues.
        assert run.status == "running"
        await asyncio.sleep(0)
        assert runner.is_running() is True
        assert runner.current_run()["events"][0]["type"] == "started"

        released.set()
        for _ in range(100):
            await asyncio.sleep(0.01)
            if not runner.is_running():
                break
        snapshot = runner.current_run()
        assert snapshot["status"] == "finished"
        assert [event["type"] for event in snapshot["events"]] == ["started", "finished"]

    asyncio.run(scenario())


def test_a_second_run_is_refused_while_one_is_going(repository, monkeypatch):
    """Two runs would share one worktree, and the second would reset the
    first one's files out from under it mid-edit."""
    from backend.devagent import runner

    released = asyncio.Event()

    async def slow_stream(instruction, settings=None):
        yield {"type": "started", "worktree": "/x"}
        await released.wait()

    monkeypatch.setattr(runner, "stream_development", slow_stream)

    async def scenario():
        runner.reset_for_tests()
        runner.start_run("ilk", _settings(repository))
        await asyncio.sleep(0)
        with pytest.raises(DevAgentError):
            runner.start_run("ikinci", _settings(repository))
        released.set()
        await runner.cancel_run()

    asyncio.run(scenario())


def test_starting_without_an_event_loop_fails_without_wedging_the_slot(repository):
    """FastAPI runs a `def` endpoint on a worker thread, where create_task has
    no loop. Publishing the run before scheduling it left a run recorded as
    in-flight that nothing would ever finish, so every later run was refused
    with 409 until the process restarted -- an unrecoverable state produced by
    a wiring mistake. Caught in a browser, not by the async tests, because
    those always had a loop."""
    from backend.devagent import runner

    runner.reset_for_tests()

    with pytest.raises(DevAgentError):
        runner.start_run("bir şey yap", _settings(repository))

    # The failure must leave nothing behind that blocks the next attempt.
    assert runner.is_running() is False
    assert runner.current_run() is None


def test_a_run_whose_task_died_does_not_block_the_next_one(repository, monkeypatch):
    """Defence in depth for the same failure mode: a status left at "running"
    with no live task must not refuse every future run."""
    from backend.devagent import runner

    async def scenario():
        runner.reset_for_tests()

        async def instant(instruction, settings=None):
            yield {"type": "started", "worktree": "/x"}

        monkeypatch.setattr(runner, "stream_development", instant)
        runner.start_run("ilk", _settings(repository))
        for _ in range(100):
            await asyncio.sleep(0.01)
            if runner._task.done():
                break
        # Simulate a task that ended without its own bookkeeping running.
        runner._current.status = "running"

        assert runner.is_running() is False
        runner.start_run("ikinci", _settings(repository))
        await runner.cancel_run()

    asyncio.run(scenario())


def test_an_unexpected_failure_names_its_type_without_leaking_its_message(
    repository, monkeypatch
):
    """The type tells the operator where to look; the message may quote the
    instruction, a file or the model's output, so it stays in the log."""
    from backend.devagent import runner

    secret = "yolcu pasaport numarasi 12345"

    async def exploding_stream(instruction, settings=None):
        yield {"type": "started", "worktree": "/x"}
        raise FileNotFoundError(secret)

    monkeypatch.setattr(runner, "stream_development", exploding_stream)

    async def scenario():
        runner.reset_for_tests()
        runner.start_run("bir şey yap", _settings(repository))
        for _ in range(100):
            await asyncio.sleep(0.01)
            if not runner.is_running():
                break
        snapshot = runner.current_run()
        assert snapshot["status"] == "error"
        assert "FileNotFoundError" in snapshot["error"]
        assert secret not in snapshot["error"]

    asyncio.run(scenario())


def test_a_failed_run_is_recorded_rather_than_lost(repository, monkeypatch):
    """Nobody is awaiting the run, so a failure has to be readable afterwards."""
    from backend.devagent import runner

    async def failing_stream(instruction, settings=None):
        yield {"type": "started", "worktree": "/x"}
        raise DevAgentError("git başarısız")

    monkeypatch.setattr(runner, "stream_development", failing_stream)

    async def scenario():
        runner.reset_for_tests()
        runner.start_run("bozuk", _settings(repository))
        for _ in range(100):
            await asyncio.sleep(0.01)
            if not runner.is_running():
                break
        snapshot = runner.current_run()
        assert snapshot["status"] == "error"
        assert "git başarısız" in snapshot["error"]

    asyncio.run(scenario())


def test_cancelling_marks_the_run_and_frees_the_slot(repository, monkeypatch):
    from backend.devagent import runner

    async def endless_stream(instruction, settings=None):
        yield {"type": "started", "worktree": "/x"}
        await asyncio.Event().wait()

    monkeypatch.setattr(runner, "stream_development", endless_stream)

    async def scenario():
        runner.reset_for_tests()
        runner.start_run("uzun", _settings(repository))
        await asyncio.sleep(0)
        await runner.cancel_run()
        assert runner.is_running() is False
        assert runner.current_run()["status"] == "cancelled"
        # The slot is free again.
        runner.start_run("yeni", _settings(repository))
        await asyncio.sleep(0)
        await runner.cancel_run()

    asyncio.run(scenario())


# --- the endpoints --------------------------------------------------------


def test_the_dev_agent_endpoints_require_a_session():
    with TestClient(app) as client:
        assert client.get("/api/dev-agent/v1/status").status_code == 401
        assert client.post(
            "/api/dev-agent/v1/run", json={"instruction": "bir şey yap"}
        ).status_code == 401
        assert client.post("/api/dev-agent/v1/apply").status_code == 401
