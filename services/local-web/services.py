#!/usr/bin/env python3
"""Manage two Docker web services and a host Playwright MCP user service."""
import argparse
import json
from pathlib import Path
import secrets
import shutil
import socket
import subprocess

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / "runtime"
LABEL = "io.rhubarb.local-web"
IMAGES = {
    "searxng": "searxng/searxng@sha256:547fdc19b45510ea1c0bc65ffadab3fcdde1ab1efd7fe696602284ba54d795ca",
    "crawl4ai": "unclecode/crawl4ai@sha256:84751dab794259db05d5bd4e5c766a8041a65f0554326e4516e620abdf2fa18b",
}
PORTS = {"searxng": (8088, 8080), "crawl4ai": (11235, 11235)}
BROWSER_UNIT = "pi-local-web-playwright.service"
BROWSER_DESCRIPTION = f"Pi local web browser ({ROOT})"


def browser_status():
    result = subprocess.run([
        "systemctl", "--user", "show", BROWSER_UNIT,
        "--property=LoadState,ActiveState,MainPID,Description,WorkingDirectory",
    ], capture_output=True, text=True)
    state = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    if state.get("LoadState") == "not-found":
        return None
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    if (state.get("Description") != BROWSER_DESCRIPTION
            or state.get("WorkingDirectory") != str(RUNTIME / "playwright")):
        raise RuntimeError(f"Refusing to manage unrelated systemd unit {BROWSER_UNIT}")
    return state


def browser_command():
    executable = shutil.which("node")
    cli = ROOT / "node_modules/@playwright/mcp/cli.js"
    if not executable or not cli.is_file():
        raise RuntimeError(f"Install Node and run npm --prefix {ROOT} ci first")
    return [
        str(Path(executable).resolve()), str(cli),
        "--headless", "--browser", "chromium", "--sandbox", "--isolated",
        "--port", "8931", "--host", "127.0.0.1",
        "--allowed-hosts", "127.0.0.1:8931,localhost:8931", "--no-webmcp",
        "--output-dir", str(RUNTIME / "playwright"),
    ]


def manage_browser(action):
    state = browser_status()
    if action == "start" and state is None:
        command = browser_command()
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", 8931)) == 0:
                raise RuntimeError("Port 8931 is already occupied; refusing to replace its process")
        (RUNTIME / "playwright").mkdir(mode=0o700, exist_ok=True)
        subprocess.run([
            "systemd-run", "--user", "--collect", "--service-type=exec",
            f"--unit={BROWSER_UNIT}", f"--description={BROWSER_DESCRIPTION}",
            f"--working-directory={RUNTIME / 'playwright'}", "--property=UMask=0077",
            *command,
        ], check=True, capture_output=True, text=True)
        state = browser_status()
    elif action == "start" and state["ActiveState"] != "active":
        subprocess.run(["systemctl", "--user", "start", BROWSER_UNIT], check=True)
        state = browser_status()
    elif action == "stop" and state is not None:
        subprocess.run(["systemctl", "--user", "stop", BROWSER_UNIT], check=True)
        state = browser_status()
    if action == "start" and (state is None or state["ActiveState"] != "active"):
        raise RuntimeError(f"Browser service did not stay active; inspect journalctl --user -u {BROWSER_UNIT}")
    status = state["ActiveState"] if state else "stopped"
    pid = state["MainPID"] if state else "0"
    print(f"{BROWSER_UNIT}: {status}; PID={pid}; http://127.0.0.1:8931/mcp (host)")


def docker(*args):
    return subprocess.run(["docker", *args], check=True, capture_output=True, text=True).stdout.strip()


def inspect(name):
    result = subprocess.run(["docker", "inspect", name], capture_output=True, text=True)
    if result.returncode:
        if "no such object" in result.stderr.lower():
            return None
        raise RuntimeError(result.stderr.strip())
    value = json.loads(result.stdout)[0]
    if value["Config"].get("Labels", {}).get(LABEL) != str(ROOT):
        raise RuntimeError(f"Refusing to manage unrelated container {name}")
    return value


def configure():
    RUNTIME.mkdir(mode=0o700, exist_ok=True)
    env = RUNTIME / "crawl4ai.env"
    if not env.exists():
        with env.open("x") as handle:
            env.chmod(0o600)
            handle.write(f"CRAWL4AI_API_TOKEN={secrets.token_hex(32)}\nGUNICORN_BIND=0.0.0.0:11235\n")
    settings = RUNTIME / "searxng"
    settings.mkdir(exist_ok=True)
    config = settings / "settings.yml"
    if not config.exists():
        config.write_text(
            "use_default_settings: true\n"
            "server:\n  bind_address: 0.0.0.0\n  port: 8080\n"
            f"  secret_key: '{secrets.token_hex(32)}'\n"
            "  limiter: false\n  image_proxy: false\n"
            "search:\n  formats:\n    - html\n    - json\n"
        )
        config.chmod(0o600)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["start", "stop", "status"])
    args = parser.parse_args()
    if args.action == "start":
        configure()
    for service, image in IMAGES.items():
        name = f"pi-local-web-{service}"
        value = inspect(name)
        if args.action == "start":
            if value is None:
                host, container = PORTS[service]
                command = ["run", "-d", "--init", "--name", name,
                           "--label", f"{LABEL}={ROOT}", "--publish", f"127.0.0.1:{host}:{container}"]
                if service == "searxng":
                    command += ["--volume", f"{RUNTIME / 'searxng'}:/etc/searxng"]
                elif service == "crawl4ai":
                    command += ["--shm-size=1g", "--env-file", str(RUNTIME / "crawl4ai.env")]
                command.append(image)
                docker(*command)
            elif not value["State"]["Running"]:
                docker("start", name)
            value = inspect(name)
        elif args.action == "stop" and value and value["State"]["Running"]:
            docker("stop", name)
            value = inspect(name)
        if value:
            print(f"{name}: {value['State']['Status']}; PID={value['State']['Pid']}; http://127.0.0.1:{PORTS[service][0]}")
        else:
            print(f"{name}: not created")
    manage_browser(args.action)


if __name__ == "__main__":
    main()
