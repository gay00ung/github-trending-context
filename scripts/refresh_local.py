"""Refresh all three snapshots in an existing unpacked local extension."""

import argparse
import fcntl
import os
import plistlib
import shutil
import subprocess
import sys
from datetime import datetime, time, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parent.parent
LABEL = "io.github.trending-context.refresh"
DAILY_TIME = time(9, 17)
FILES = ("latest.json", "weekly.json", "monthly.json")


def latest_due(now):
    today = datetime.combine(now.date(), DAILY_TIME)
    return (today if now >= today else today - timedelta(days=1)).timestamp()


def collector_env():
    env = os.environ.copy()
    if not env.get("GITHUB_TOKEN") and (gh := shutil.which("gh")):
        try:
            result = subprocess.run(
                [gh, "auth", "token", "--hostname", "github.com"],
                capture_output=True, text=True, timeout=15,
            )
            if result.returncode == 0 and result.stdout.strip():
                env["GITHUB_TOKEN"] = result.stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            pass
    return env


def refresh(extension, if_due):
    with (extension.parent / f".{extension.name}-refresh.lock").open("a+") as state:
        try:
            fcntl.flock(state, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("A snapshot refresh is already running.", flush=True)
            return
        started = datetime.now()
        state.seek(0)
        try:
            previous = float(state.read())
        except ValueError:
            previous = 0
        has_all_snapshots = all((extension / name).is_file() for name in FILES)
        if if_due and previous >= latest_due(started) and has_all_snapshots:
            return

        print(f"{started.astimezone().isoformat(timespec='seconds')}: Refreshing all three periods", flush=True)
        with TemporaryDirectory(dir=extension.parent, prefix=".trending-refresh-") as staging:
            subprocess.run(
                [sys.executable, "-m", "collector", "--period", "all", "--output", staging],
                cwd=ROOT, env=collector_env(), check=True, timeout=900,
            )
            for name in FILES:
                if not (Path(staging) / name).is_file():
                    raise ValueError(f"Collector did not produce {name}")
            for name in FILES:
                (Path(staging) / name).replace(extension / name)
        state.seek(0)
        state.truncate()
        state.write(str(started.timestamp()) + "\n")
        print("Updated Today, This week and This month.", flush=True)


def install_macos(extension):
    if sys.platform != "darwin":
        raise ValueError("The LaunchAgent installer requires macOS.")
    agents = Path.home() / "Library" / "LaunchAgents"
    agents.mkdir(parents=True, exist_ok=True)
    plist = agents / f"{LABEL}.plist"
    log = ROOT / "build" / "local-refresh" / "refresh.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    domain = f"gui/{os.getuid()}"
    job = f"{domain}/{LABEL}"
    if subprocess.run(["launchctl", "print", job], capture_output=True).returncode == 0:
        subprocess.run(["launchctl", "bootout", job], check=True)
    config = {
        "Label": LABEL,
        "ProgramArguments": [sys.executable, str(Path(__file__).resolve()), str(extension), "--if-due"],
        "WorkingDirectory": str(ROOT),
        "RunAtLoad": True,
        "StartCalendarInterval": {"Hour": DAILY_TIME.hour, "Minute": DAILY_TIME.minute},
        "StartInterval": 60 * 60,
        "EnvironmentVariables": {
            "PATH": os.pathsep.join(dict.fromkeys([
                *os.get_exec_path(), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin",
            ])),
        },
        "StandardOutPath": str(log),
        "StandardErrorPath": str(log),
    }
    with plist.open("wb") as file:
        plistlib.dump(config, file)
    subprocess.run(["launchctl", "bootstrap", domain, str(plist)], check=True)
    print(f"Installed {LABEL} (daily at {DAILY_TIME:%H:%M} local time). Log: {log}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("extension_dir", type=Path, help="The directory already loaded in Chrome")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--install-macos", action="store_true", help="Install and start a macOS LaunchAgent")
    modes.add_argument("--if-due", action="store_true", help="Skip if this day's scheduled collection already succeeded")
    args = parser.parse_args()
    extension = args.extension_dir.resolve()
    config = extension / "config.js"
    try:
        if not (
            (extension / "manifest.json").is_file()
            and config.is_file()
            and config.read_text(encoding="utf-8").strip() == 'globalThis.TrendingContextConfig = {"mode": "local"};'
        ):
            raise ValueError("Choose an unpacked local build created with --snapshot-dir.")
        if args.install_macos:
            install_macos(extension)
        else:
            refresh(extension, args.if_due)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        parser.exit(1, f"Local refresh failed: {error}\n")


if __name__ == "__main__":
    main()
