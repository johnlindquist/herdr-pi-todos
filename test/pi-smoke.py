"""Run real Pi and an offline provider in a private tmux server. No desktop access."""

import json
import os
import re
import shutil
import subprocess as sp
import tempfile
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PI = shutil.which("pi")
assert PI, "Put Pi on PATH first."


def until(check, limit=12):
    end = time.monotonic() + limit
    while time.monotonic() < end:
        value = check()
        if value:
            return value
        time.sleep(0.08)
    raise AssertionError("timed out waiting for the expected state")


def main():
    with tempfile.TemporaryDirectory(prefix="board-pi-") as tmp:
        d = Path(tmp)
        agent = d / "agent"
        agent.mkdir()
        session = d / "work.jsonl"
        (agent / "settings.json").write_text(
            '{"defaultProjectTrust":"always","quietStartup":true,"enableInstallTelemetry":false}'
        )
        tmux = ["tmux", "-L", "pt-" + uuid.uuid4().hex[:10]]
        env = {
            **os.environ,
            "PI_CODING_AGENT_DIR": str(agent),
            "PI_SKIP_VERSION_CHECK": "1",
            "DO_NOT_TRACK": "1",
        }
        package = os.environ.get("HPT_TEST_PACKAGE")
        flags = ["-ne", "-e", str(ROOT / "index.mjs")]
        if package:
            # Exercise package discovery, not an explicit -e pointing at our entry.
            sp.run([PI, "install", package], cwd=tmp, env=env, check=True, timeout=120)
            flags = []

        def t(*args):
            return sp.check_output([*tmux, *args], env=env, text=True)

        def screen():
            return t("capture-pane", "-p", "-t", "board")

        def wait(text, absent=False):
            try:
                return until(
                    lambda: screen()
                    if (text not in screen() if absent else text in screen())
                    else None
                )
            except AssertionError:
                raise AssertionError(
                    f"waiting for {text!r} (absent={absent})\n{screen()}"
                )

        def keys(*args):
            t("send-keys", "-t", "board", *args)

        def typein(line):
            keys("-l", line)

        def submit(line):
            typein(line)
            keys("Enter")

        def start():
            t(
                "new-session",
                "-d",
                "-s",
                "board",
                "-x",
                "92",
                "-y",
                "28",
                "-c",
                tmp,
                "env",
                f"PI_CODING_AGENT_DIR={agent}",
                PI,
                *flags,
                "-e",
                str(ROOT / "test/fixture-provider.mjs"),
                "--model",
                "board-fixture/check",
                "--session",
                str(session),
            )

        def wire(id, q):
            return json.loads(
                sp.check_output(
                    ["node", str(ROOT / "bin/todos.mjs"), "request", id, json.dumps(q)],
                    text=True,
                )
            )

        try:
            start()
            wait("check")
            submit("Create the fixture task")
            wait("Fixture turn finished.")
            assert "Search tasks…" not in screen()
            assert any(
                e.get("customType") == "herdr-pi-todos/v1"
                for e in map(json.loads, session.read_text().splitlines())
            )
            submit("/todos add Review the guide")
            wait("Review the guide")
            typein("/todos sta")
            wait("Mark work in progress")
            keys("Tab")
            wait("/todos start")
            typein(" Review")
            wait("#2 Review the guide")
            keys("Tab")
            wait("/todos start #2")
            keys("Enter")
            wait("doing  Review the guide")
            submit("/todos share")
            output = wait("Local board connection:")
            id = re.search(r"connection: ([0-9a-f]{32})", output).group(1)
            submit("/todos")
            wait("Search tasks…")
            typein("release")
            wait("> release")
            keys("Enter")
            wait("Prerequisites")
            old = wire(id, {"action": "list"})
            wire(
                id,
                {
                    "action": "update",
                    "id": 1,
                    "owner": "Sam",
                    "expectedRevision": old["revision"],
                },
            )
            keys("Enter")
            wait("Session tasks")
            assert (
                wire(id, {"action": "get", "id": 1})["tasks"][0]["status"] == "pending"
            ), "stale action overwrote external edit"
            keys("Enter")
            wait("Prerequisites")
            keys("Enter")
            wait("doing  Inspect the release")
            keys("Escape")
            wait("Search tasks…", True)
            submit("/reload")
            wait("Reloaded")
            assert "Search tasks…" not in screen()
            gone = sp.run(
                [
                    "node",
                    str(ROOT / "bin/todos.mjs"),
                    "request",
                    id,
                    '{"action":"list"}',
                ],
                capture_output=True,
                text=True,
            )
            assert gone.returncode and "OFFLINE" in gone.stderr
            submit("/todos show #1")
            wait("doing  Inspect the release  @Sam")
            t("kill-session", "-t", "board")
            start()
            wait("check")
            submit("/todos list in_progress")
            out = wait("doing  Review the guide")
            assert "doing  Inspect the release" in out
            print(
                "Pi TUI: actual tool, add, slash completion, filtered selection, stale action refused, fresh action applied, reload, restart and link revocation passed."
            )
        finally:
            sp.run([*tmux, "kill-server"], capture_output=True)


if __name__ == "__main__":
    main()
