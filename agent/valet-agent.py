#!/usr/bin/env python3
"""Valet agent: lets Valet read the status and logs of systemd services on this machine.

One file, Python's standard library, nothing to install. It can only look: it has no way to start, stop or change
anything. It answers only with a token, and only about the services you list. Read it; it's short.

  VALET_AGENT_TOKEN   required, at least 24 characters
  VALET_AGENT_UNITS   comma-separated services; user:name for a user service, e.g. "radarr,sonarr,user:ninfer"
  VALET_AGENT_BIND    address:port to listen on (default 127.0.0.1:7576)

GET /health                                    alive, no token needed
GET /services                                  each listed service: state, since when, restarts, last result, memory
GET /logs?unit=radarr&lines=300&minutes=60&match=error
"""
import hmac, json, os, re, subprocess, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

TOKEN = os.environ.get("VALET_AGENT_TOKEN", "")
UNITS = [u.strip() for u in os.environ.get("VALET_AGENT_UNITS", "").split(",") if u.strip()]
BIND = os.environ.get("VALET_AGENT_BIND", "127.0.0.1:7576")
VALID = re.compile(r"^(user:)?[A-Za-z0-9@_.:-]{1,100}$")
FIELDS = ["ActiveState", "SubState", "Result", "NRestarts", "ExecMainStatus", "ActiveEnterTimestamp", "InactiveEnterTimestamp", "MemoryCurrent", "Description"]


def run(cmd):
    """No shell, a time limit, and a cap on what's read back."""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, errors="replace", timeout=15)
    except subprocess.TimeoutExpired:
        return ""
    return r.stdout[:4_000_000]


def scope(unit):
    return ["--user"] if unit.startswith("user:") else [], unit[5:] if unit.startswith("user:") else unit


def status(unit):
    flags, name = scope(unit)
    raw = run(["systemctl", *flags, "show", name, "--no-pager", "--property=" + ",".join(FIELDS)])
    info = dict(line.split("=", 1) for line in raw.splitlines() if "=" in line)
    memory = info.get("MemoryCurrent", "")
    return {"unit": unit, "name": name, "description": info.get("Description"), "state": info.get("ActiveState", "unknown"), "sub": info.get("SubState"),
            "result": info.get("Result"), "restarts": int(info["NRestarts"]) if info.get("NRestarts", "").isdigit() else None,
            "exitStatus": int(info["ExecMainStatus"]) if info.get("ExecMainStatus", "").isdigit() else None,
            "since": info.get("ActiveEnterTimestamp") or None, "stopped": info.get("InactiveEnterTimestamp") or None,
            "memoryBytes": int(memory) if memory.isdigit() else None}


def logs(unit, lines, minutes, match):
    flags, name = scope(unit)
    cmd = ["journalctl", *flags, "-u", name, "-n", str(lines), "--no-pager", "-o", "short-iso"]
    if minutes:
        cmd += ["--since", f"{minutes} minutes ago"]
    out = run(cmd).splitlines()
    if match:
        out = [l for l in out if match.lower() in l.lower()]
    return [l[:1000] for l in out[-lines:]]


class Agent(BaseHTTPRequestHandler):
    server_version = "valet-agent"
    sys_version = ""

    def send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/health":
            return self.send(200, {"ok": True})
        given = self.headers.get("Authorization", "").removeprefix("Bearer ").encode()
        if not hmac.compare_digest(given, TOKEN.encode()):
            return self.send(401, {"error": "bad token"})
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        if url.path == "/services":
            return self.send(200, {"host": os.uname().nodename, "services": [status(u) for u in UNITS]})
        if url.path == "/logs":
            # listed services only, matched exactly: nothing here reaches journalctl unchecked
            unit = next((u for u in UNITS if u == q.get("unit") or scope(u)[1] == q.get("unit")), None)
            if not unit:
                return self.send(404, {"error": "not a listed service", "listed": UNITS})
            try:
                lines = min(max(int(q.get("lines", 300)), 1), 2000)
                minutes = min(max(int(q.get("minutes", 0)), 0), 43200)
            except ValueError:
                return self.send(400, {"error": "lines and minutes are numbers"})
            return self.send(200, {"unit": unit, "lines": logs(unit, lines, minutes, q.get("match", "")[:100])})
        self.send(404, {"error": "no such path"})

    def do_POST(self):
        self.send(405, {"error": "this agent only reads"})
    do_PUT = do_DELETE = do_PATCH = do_POST

    def log_message(self, *args):
        pass


def main():
    if len(TOKEN) < 24:
        sys.exit("valet-agent: set VALET_AGENT_TOKEN to at least 24 characters")
    bad = [u for u in UNITS if not VALID.match(u)]
    if not UNITS or bad:
        sys.exit(f"valet-agent: VALET_AGENT_UNITS needs service names (bad: {bad})")
    host, port = BIND.rsplit(":", 1)
    print(f"valet-agent on {BIND}: {', '.join(UNITS)}", flush=True)
    ThreadingHTTPServer((host, int(port)), Agent).serve_forever()


if __name__ == "__main__":
    main()
