#!/usr/bin/env python3
"""Launch the local Einstein application, wait for readiness, and own its shutdown.

No downloads, provider configuration, or other processes are changed. Existing
listeners are never terminated. Use --no-browser for command-line testing.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import urlopen
import webbrowser

ROOT = Path(__file__).resolve().parent.parent


def read_health(url: str):
    try:
        with urlopen(url + "/api/health", timeout=2) as response:
            result = json.load(response)
        if result.get("mode") == "local-only" and result.get("paid_services_enabled") is False and "avatar_hardware_verified" in result:
            return result
    except (URLError, TimeoutError, OSError, ValueError):
        pass
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--legacy", action="store_true", help="Run the preserved C2 local backend instead of the character-first service")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        raise SystemExit("Choose a port between 1024 and 65535")
    url = f"http://127.0.0.1:{args.port}"
    existing = read_health(url)
    if existing:
        print(f"Einstein is already ready: {url}", flush=True)
        if not args.no_browser:
            webbrowser.open(url)
        return
    probe = socket.socket()
    try:
        probe.bind(("127.0.0.1", args.port))
    except OSError:
        raise SystemExit(f"Port {args.port} is occupied by another service; no process was changed.")
    finally:
        probe.close()
    required = [".einstein-venv/bin/python", "lab_backend/data/lab.json", "rehearsal/dist/index.html",
                "rehearsal/dist/assets/einstein.glb"]
    missing = [name for name in required if not (ROOT / name).is_file()]
    if missing:
        raise SystemExit("Missing local assets: " + ", ".join(missing) + ". See docs/LIVE_DEMO.md.")
    runtime = ROOT / ".einstein-venv/bin/python"
    environment = {**os.environ, "TOKENIZERS_PARALLELISM": "false"}
    child = subprocess.Popen([str(runtime), "-m", "uvicorn", ("lab_backend.app:app" if args.legacy else "lab_backend.presence_service:app"), "--host", "127.0.0.1",
                              "--port", str(args.port), "--no-access-log", "--log-level", "warning"], cwd=ROOT, env=environment)
    stopping = False

    def stop(signum=None, frame=None):
        nonlocal stopping
        stopping = True
        if child.poll() is None:
            child.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        print("Preparing local models and the authored opening. No paid API is used.", flush=True)
        deadline = time.monotonic() + 240
        health = None
        while time.monotonic() < deadline and not stopping:
            if child.poll() is not None:
                raise SystemExit(f"Einstein stopped during startup (exit {child.returncode}).")
            health = read_health(url)
            if health:
                break
            time.sleep(.5)
        if stopping:
            return
        if health is None:
            raise SystemExit("Readiness timeout. The owned server will be stopped; inspect its startup output.")
        print("READY " + json.dumps({"url": url, "pid": child.pid, "pages": health["pages"],
                                     "voice": health["voice"], "warmup": health.get("warmup")}), flush=True)
        if not args.no_browser:
            webbrowser.open(url)
        child.wait()
    finally:
        stop()
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()


if __name__ == "__main__":
    main()
