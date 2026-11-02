"""Actual Herdr terminals. --app also tests pane.split in a *private Linux display*."""

import json
import os
import re
import shutil
import subprocess as sp
import sys
import tempfile
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = "--app" in sys.argv
if APP and not (
    sys.platform.startswith("linux")
    and os.environ.get("HERDR_TODOS_SANDBOX_DISPLAY") == "1"
    and os.environ.get("DISPLAY")
):
    raise SystemExit(
        "--app needs an explicitly disposable Linux display; do not run it on your desktop."
    )


def main():
    with tempfile.TemporaryDirectory(prefix="hpt-", dir="/tmp") as tmp:
        d = Path(tmp)
        e = {**os.environ}
        for k in (
            "HC_TERMINAL_ID",
            "HC_PARENT",
            "HERDR_PANE_ID",
            "HERDR_ENV",
            "HERDR_APP_SOCKET",
        ):
            e.pop(k, None)
        e.update(
            HC_SESSION="pt-" + uuid.uuid4().hex[:8],
            HC_SOCKET=tmp + "/r/hc.sock",
            HERDR_APP_HOME=tmp + "/app",
            XDG_RUNTIME_DIR=tmp + "/r",
            XDG_STATE_HOME=tmp + "/s",
            XDG_CONFIG_HOME=tmp + "/c",
            PI_CODING_AGENT_DIR=tmp + "/pi",
            PI_SKIP_VERSION_CHECK="1",
            HERDR_APP_NO_SOUND="1",
            HERDR_TELEMETRY="0",
            DO_NOT_TRACK="1",
        )
        for name in ("r", "pi", "app"):
            (d / name).mkdir(mode=0o700)
        (d / "pi/settings.json").write_text(
            '{"defaultProjectTrust":"always","quietStartup":true,"enableInstallTelemetry":false}'
        )

        def run(*args, check=True):
            p = sp.run(args, env=e, cwd=tmp, capture_output=True, text=True, timeout=25)
            if check and p.returncode:
                raise RuntimeError(f"{args[:3]}: {p.stdout} {p.stderr}")
            return p.stdout.strip()

        def j(*a):
            return json.loads(run(*a))

        def until(fn, label):
            end = time.monotonic() + 25
            last = None
            while time.monotonic() < end:
                try:
                    last = fn()
                    if last:
                        return last
                except (
                    RuntimeError,
                    ValueError,
                    KeyError,
                    StopIteration,
                    IndexError,
                ) as ex:
                    last = str(ex)
                time.sleep(0.15)
            raise AssertionError(f"Timed out: {label}; {last}")

        def screen(term):
            return run("hc", "read", term)

        def see(term, text):
            try:
                return until(lambda: (s if text in (s := screen(term)) else None), text)
            except AssertionError:
                raise AssertionError(f"{text!r} missing from {term}:\n{screen(term)}")

        def send(term, text):
            run("hc", "send", term, text)

        def panes(space):
            return [
                p
                for s in j("herdr-app", "ls")["spaces"]
                if s["id"] == space
                for t in s["tabs"]
                for p in t["terminals"]
            ]

        # The core starts the new processes, not this Python interpreter. Explicitly carry
        # the private home and test PATH into Pi, including across login-shell environments.
        carry = [
            "PI_CODING_AGENT_DIR",
            "PI_SKIP_VERSION_CHECK",
            "HC_SOCKET",
            "HC_SESSION",
            "HERDR_APP_HOME",
            "XDG_RUNTIME_DIR",
            "XDG_STATE_HOME",
            "XDG_CONFIG_HOME",
            "PATH",
            "DO_NOT_TRACK",
        ]
        argv = [
            "/usr/bin/env",
            *[f"{k}={e[k]}" for k in carry],
            shutil.which("pi"),
            "-ne",
            "-e",
            str(ROOT / "index.mjs"),
            "-e",
            str(ROOT / "test/fixture-provider.mjs"),
            "--model",
            "board-fixture/check",
            "--session",
            tmp + "/fixture.jsonl",
        ]
        win = None
        channel = None
        parent = None
        child = None
        run("hc", "server", "start")
        try:
            if APP:
                with open(d / "window.log", "w") as log:
                    win = sp.Popen(
                        ["herdr-app"], env=e, cwd=tmp, stdout=log, stderr=log
                    )
                until(lambda: j("herdr-app", "status"), "private app startup")
                info = j(
                    "herdr-app",
                    "do",
                    "space.new",
                    json.dumps(
                        {
                            "name": "Task boards",
                            "tab": "Release review",
                            "folder": tmp,
                            "argv": argv,
                        }
                    ),
                )
                space = info["space"]
                parent = info["terminal"]
            else:
                parent = j("hc", "run", "--bg", "--no-notify", "--", *argv)["address"]
            see(parent, "Fixture ready")
            send(parent, "Add the fixture task")
            see(parent, "Fixture turn finished.")

            def get_channel():
                send(parent, "/todos share")
                s = see(parent, "Local board connection:")
                # A narrow split can wrap the connection ID across terminal rows.
                compact = "".join(s.split())
                return re.search(r"Localboardconnection:([a-f0-9]{32})", compact)[1]

            if APP:
                send(parent, "/todos herdr")
                see(parent, "Opened tasks in Herdr pane")
                child = until(
                    lambda: next(
                        p["terminal"]
                        for p in panes(space)
                        if p.get("terminal") and p["terminal"] != parent
                    ),
                    "new sibling pane",
                )
            else:
                channel = get_channel()
                child = j(
                    "hc",
                    "run",
                    "--bg",
                    "--no-notify",
                    "--",
                    shutil.which("node"),
                    str(ROOT / "bin/todos.mjs"),
                    "watch",
                    channel,
                )["address"]
            see(child, "Inspect the release")
            send(child, "start #1")
            see(child, "doing  Inspect the release")
            send(parent, "/todos show #1")
            see(parent, "doing  Inspect the release")
            send(parent, "/todos add Check the changelog")
            see(child, "Check the changelog")
            send(child, "done #1")
            see(child, "done  Inspect the release")
            if APP:
                # Return to the test space in case the first-run welcome sits above it.
                status = j("herdr-app", "status")
                if status.get("overlays"):
                    run("herdr-app", "do", "overlay.close", check=False)
                shot = os.environ.get("HERDR_TODOS_TEST_SHOT")
                if shot:
                    run("herdr-app", "shot", str(Path(shot).absolute()))
                channel = get_channel()
            send(parent, "/todos unshare")
            see(parent, "External access closed")
            gone = sp.run(
                [
                    "node",
                    str(ROOT / "bin/todos.mjs"),
                    "request",
                    channel,
                    '{"action":"list"}',
                ],
                env=e,
                capture_output=True,
                text=True,
            )
            assert gone.returncode and "OFFLINE" in gone.stderr
            print(
                ("Herdr desktop split" if APP else "Herdr core terminals")
                + ": Pi tool → companion, edit → Pi, live refresh and revocation passed."
            )
        finally:
            if win:
                if win.poll() is None:
                    win.terminate()
                    win.wait(timeout=10)
                if sys.exc_info()[0]:
                    print((d / "window.log").read_text()[-2000:], file=sys.stderr)
            for terminal in (child, parent):
                if terminal:
                    run("hc", "kill", terminal, check=False)
            run("hc", "server", "stop", check=False)


if __name__ == "__main__":
    main()
