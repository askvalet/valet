#!/usr/bin/env python3
"""Valet agent: lets Valet read how this machine is doing, its systemd services and its containers.

One file, Python's standard library, nothing to install. It can only look: it has no way to start, stop or change
anything. It answers only with a token, and only about what you list. Everything is off until you turn it on.
Read it; it's short.

  VALET_AGENT_TOKEN        required, at least 24 characters
  VALET_AGENT_BIND         address:port to listen on (default 127.0.0.1:7576); a private address, never a public one
  VALET_AGENT_ALLOW        who may ask, as addresses or networks: "10.0.0.5,172.17.0.0/16" (default: anyone with the token)
  VALET_AGENT_UNITS        comma-separated services; user:name for a user service, e.g. "radarr,sonarr,user:ninfer"
  VALET_AGENT_METRICS      1 to report CPU, memory, load, temperatures and uptime, read from /proc and /sys
  VALET_AGENT_MOUNTS       with metrics, the mount points whose free space to report: "/,/mnt/media"
  VALET_AGENT_DOCKER       a read-only socket proxy ("http://127.0.0.1:2375") or a socket ("/var/run/docker.sock")
  VALET_AGENT_CONTAINERS   with Docker, the containers to answer about: "plex,immich_*" (default: all of them)

GET /health                        alive, no token needed
GET /v1/machine                    what this agent can report, and with metrics: CPU, memory, disks, temperatures, uptime
GET /v1/units                      each listed service: state, since when, restarts, last result, memory
GET /v1/containers?usage=1         each container: state and image; with usage, CPU and memory of those running
GET /v1/logs?unit=radarr&lines=300&minutes=60&match=error      or container=plex
GET /services, /logs?unit=         the same as /v1/units and /v1/logs, as before there were versions
"""
import fnmatch, functools, hmac, http.client, ipaddress, json, os, re, socket, subprocess, sys, threading, time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

API = 1   # goes up when Valet needs something an older agent can't answer; Valet then says to update this file
env = lambda name, default="": os.environ.get(f"VALET_AGENT_{name}", default).strip()
listed = lambda name: [x.strip() for x in env(name).split(",") if x.strip()]
TOKEN, BIND = env("TOKEN"), env("BIND", "127.0.0.1:7576")
UNITS, MOUNTS, CONTAINERS, ALLOW = listed("UNITS"), listed("MOUNTS"), listed("CONTAINERS"), listed("ALLOW")
METRICS, DOCKER = env("METRICS").lower() in ("1", "true", "yes", "on"), env("DOCKER")
ROOT = env("ROOT").rstrip("/")   # for the tests: a made-up /proc, /sys and /etc under another directory
VALID = re.compile(r"^(user:)?[A-Za-z0-9@_.:-]{1,100}$")
MOUNT = re.compile(r"^/[A-Za-z0-9_.@/ -]{0,200}$")
FIELDS = ["ActiveState", "SubState", "Result", "NRestarts", "ExecMainStatus", "ActiveEnterTimestamp", "InactiveEnterTimestamp", "MemoryCurrent", "Description"]
# everything this agent ever asks Docker, all of it GET; the ids come from Docker's own list, the numbers from int()
DOCKER_READS = re.compile(r"^/containers/(json\?all=1|[a-f0-9]{12,64}/(json|stats\?stream=false|logs\?stdout=1&stderr=1&timestamps=1&tail=\d{1,4}(&since=\d{1,12})?))$")
NOT_TEXT = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]|[\x00-\x08\x0b-\x1f\x7f]")


def run(cmd):
    """No shell, a time limit, and a cap on what's read back."""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, errors="replace", timeout=15)
    except subprocess.TimeoutExpired:
        return ""
    return r.stdout[:4_000_000]


def read(path, cap=65536):
    """A file under /proc, /sys or /etc, read-only and capped; empty when it isn't there."""
    try:
        with open(ROOT + path, "rb") as f:
            return f.read(cap).decode("utf-8", "replace")
    except OSError:
        return ""


def text(lines, count, match):
    """Logs leave as plain text: no colour codes or control characters, long lines cut, the last `count` kept."""
    out = [NOT_TEXT.sub("", l).rstrip()[:1000] for l in lines]
    return [l for l in out if l and (not match or match.lower() in l.lower())][-count:]


# ── systemd

def scope(unit):
    return ["--user"] if unit.startswith("user:") else [], unit[5:] if unit.startswith("user:") else unit


def units():
    """One systemctl for the system's services and one for the user's, however many are listed."""
    out = {}
    for flags in ([], ["--user"]):
        mine = [u for u in UNITS if scope(u)[0] == flags]
        if not mine:
            continue
        raw = run(["systemctl", *flags, "show", *[scope(u)[1] for u in mine], "--no-pager", "--property=" + ",".join(FIELDS)])
        blocks = [dict(line.split("=", 1) for line in b.splitlines() if "=" in line) for b in raw.split("\n\n") if b.strip()]
        for i, unit in enumerate(mine):
            info = blocks[i] if i < len(blocks) else {}
            memory = info.get("MemoryCurrent", "")
            out[unit] = {"unit": unit, "name": scope(unit)[1], "description": info.get("Description"), "state": info.get("ActiveState", "unknown"), "sub": info.get("SubState"),
                         "result": info.get("Result"), "restarts": int(info["NRestarts"]) if info.get("NRestarts", "").isdigit() else None,
                         "exitStatus": int(info["ExecMainStatus"]) if info.get("ExecMainStatus", "").isdigit() else None,
                         "since": info.get("ActiveEnterTimestamp") or None, "stopped": info.get("InactiveEnterTimestamp") or None,
                         "memoryBytes": int(memory) if memory.isdigit() else None}
    return [out[u] for u in UNITS]


def unit_logs(unit, lines, minutes, match):
    flags, name = scope(unit)
    cmd = ["journalctl", *flags, "-u", name, "-n", str(lines), "--no-pager", "-o", "short-iso"]
    if minutes:
        cmd += ["--since", f"{minutes} minutes ago"]
    return text(run(cmd).splitlines(), lines, match)


# ── the machine itself, from /proc and /sys

cpu_lock, cpu_last = threading.Lock(), {"busy": 0, "total": 0, "pct": None}


def cpu():
    """Share of CPU time used since the last look, so no request ever waits to take a second sample."""
    lines = read("/proc/stat").splitlines()
    cores = sum(1 for l in lines if re.match(r"cpu\d", l)) or 1
    n = [int(x) for x in lines[0].split()[1:9]] if lines and lines[0].startswith("cpu ") else []
    if len(n) < 5:
        return None, cores
    total, busy = sum(n), sum(n) - n[3] - n[4]   # idle and waiting on a disk aren't work
    with cpu_lock:
        # two looks within half a second would be all noise: the earlier answer stands
        if not cpu_last["total"] or total - cpu_last["total"] >= 50 * cores:
            if cpu_last["total"]:
                cpu_last["pct"] = round(100 * (busy - cpu_last["busy"]) / (total - cpu_last["total"]), 1)
            cpu_last["busy"], cpu_last["total"] = busy, total
        return cpu_last["pct"], cores


def ls(path):
    try:
        return sorted(os.listdir(ROOT + path))
    except OSError:
        return []


def temperatures():
    out = []

    def add(name, raw):
        if raw.strip().lstrip("-").isdigit() and len(out) < 32:
            out.append({"name": name[:60], "c": round(int(raw) / 1000, 1)})
    for h in ls("/sys/class/hwmon"):
        base = f"/sys/class/hwmon/{h}"
        chip = read(f"{base}/name", 100).strip()
        for f in ls(base):
            if re.fullmatch(r"temp\d+_input", f):
                add(" ".join(x for x in (chip, read(f"{base}/{f[:-6]}_label", 100).strip()) if x) or h, read(f"{base}/{f}", 32))
    if not out:   # a board with no hwmon chip still has its thermal zones
        for z in ls("/sys/class/thermal"):
            if z.startswith("thermal_zone"):
                add(read(f"/sys/class/thermal/{z}/type", 100).strip() or z, read(f"/sys/class/thermal/{z}/temp", 32))
    return out


def disks():
    out = []
    for m in MOUNTS:
        try:
            s = os.statvfs(ROOT + m)
        except OSError:
            continue
        out.append({"mount": m, "total": s.f_blocks * s.f_frsize, "free": s.f_bavail * s.f_frsize, "used": (s.f_blocks - s.f_bfree) * s.f_frsize})
    return out


@functools.cache
def model():
    """Read once: x86 names the processor, a Pi names the board."""
    chip = [l.split(":", 1) for l in read("/proc/cpuinfo").splitlines() if ":" in l]
    return next((v.strip()[:80] for want in ("model name", "Model", "Hardware") for k, v in chip if k.strip() == want), None)


def machine():
    host = read("/proc/sys/kernel/hostname", 256).strip() or os.uname().nodename
    out = {"api": API, "host": host, "can": {"metrics": METRICS, "units": len(UNITS), "docker": bool(DOCKER)}}
    if not METRICS:
        return out
    mem = {k: int(v.split()[0]) * 1024 for k, v in (l.split(":", 1) for l in read("/proc/meminfo").splitlines() if ":" in l) if v.split()[:1] and v.split()[0].isdigit()}
    release = dict(l.split("=", 1) for l in read("/etc/os-release").splitlines() if "=" in l)
    pct, cores = cpu()
    uptime, load = read("/proc/uptime", 64).split(), read("/proc/loadavg", 64).split()
    number = lambda parts, i: float(parts[i]) if len(parts) > i and re.fullmatch(r"\d+(\.\d+)?", parts[i]) else None
    return {**out, "os": release.get("PRETTY_NAME", "").strip('"')[:80] or None, "osId": release.get("ID", "").strip('"')[:40] or None,
            "kernel": read("/proc/sys/kernel/osrelease", 100).strip() or None, "arch": os.uname().machine, "uptime": number(uptime, 0),
            "cpu": {"pct": pct, "cores": cores, "model": model()}, "load": [x for x in (number(load, i) for i in range(3)) if x is not None],
            "memory": {"total": mem.get("MemTotal"), "available": mem.get("MemAvailable")}, "swap": {"total": mem.get("SwapTotal"), "free": mem.get("SwapFree")},
            "disks": disks(), "temperatures": temperatures()}


# ── Docker, read-only

class UnixSocket(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__("localhost", timeout=10)
        self.unix = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(10)
        self.sock.connect(self.unix)


def docker(path):
    """The only door to Docker: one GET, to a path on the list above, and a cap on what's read back."""
    if not DOCKER_READS.match(path):
        raise ValueError("not something this agent reads")
    at = urlparse(DOCKER)
    conn = http.client.HTTPConnection(at.hostname, at.port or 2375, timeout=10) if at.scheme == "http" else UnixSocket(DOCKER.removeprefix("unix://"))
    try:
        conn.request("GET", path)
        r = conn.getresponse()
        return r.status, r.read(4_000_000)
    except OSError:
        return 0, b""
    finally:
        conn.close()


def containers():
    """What Docker lists, down to what Valet shows. Environment, mounts and ports never leave this machine."""
    status, body = docker("/containers/json?all=1")
    if status != 200:
        raise RuntimeError(f"Docker answered {status}" if status else "Docker didn't answer")
    out = []
    for c in json.loads(body)[:500]:
        name, labels = str((c.get("Names") or [c.get("Id", "")])[0]).lstrip("/"), c.get("Labels") or {}
        if re.fullmatch(r"[a-f0-9]{12,64}", str(c.get("Id"))) and (not CONTAINERS or any(fnmatch.fnmatchcase(name, p) for p in CONTAINERS)):
            out.append({"id": c["Id"], "name": name[:200], "state": c.get("State"), "status": c.get("Status"), "image": str(c.get("Image", ""))[:300],
                        "project": labels.get("com.docker.compose.project"), "source": labels.get("org.opencontainers.image.source")})
    return sorted(out, key=lambda c: c["name"])


def usage(c):
    status, body = docker(f"/containers/{c['id']}/stats?stream=false")
    if status != 200:
        return {}
    s = json.loads(body)
    now, before, mem = s.get("cpu_stats") or {}, s.get("precpu_stats") or {}, s.get("memory_stats") or {}
    used = (now.get("cpu_usage") or {}).get("total_usage", 0) - (before.get("cpu_usage") or {}).get("total_usage", 0)
    whole = now.get("system_cpu_usage", 0) - before.get("system_cpu_usage", 0)
    return {"cpuPct": round(used / whole * (now.get("online_cpus") or 1) * 100, 1) if whole > 0 else 0,
            "memoryBytes": mem.get("usage", 0) - (mem.get("stats") or {}).get("inactive_file", 0), "memoryLimit": mem.get("limit")}


def with_usage(found):
    running = [c for c in found if c["state"] == "running"][:60]
    with ThreadPoolExecutor(max_workers=8) as pool:
        for c, u in zip(running, pool.map(usage, running)):
            c.update(u)
    return found


def container_logs(c, lines, minutes, match):
    since = f"&since={int(time.time()) - minutes * 60}" if minutes else ""
    status, raw = docker(f"/containers/{c['id']}/logs?stdout=1&stderr=1&timestamps=1&tail={lines}{since}")
    if status != 200:
        raise RuntimeError(f"Docker answered {status}" if status else "Docker didn't answer")
    # Docker frames each chunk with an 8-byte header, unless the container has a TTY, then it's plain text
    if len(raw) >= 8 and raw[0] <= 2 and raw[1:4] == b"\0\0\0":
        parts, at = [], 0
        while at + 8 <= len(raw):
            size = int.from_bytes(raw[at + 4:at + 8], "big")
            parts.append(raw[at + 8:at + 8 + size])
            at += 8 + size
        raw = b"".join(parts)
    state = {}
    status, body = docker(f"/containers/{c['id']}/json")
    if status == 200:   # how it last ended and how often it restarted, and nothing else from the inspect answer
        whole = json.loads(body)
        s = whole.get("State") or {}
        state = {"killedForMemory": s.get("OOMKilled"), "exitCode": s.get("ExitCode"), "restarts": whole.get("RestartCount"), "started": s.get("StartedAt"), "finished": s.get("FinishedAt")}
    return {"container": c["name"], "state": c["state"], "status": c["status"], **state, "lines": text(raw.decode("utf-8", "replace").splitlines(), lines, match)}


# ── the door

NETWORKS = []


class Agent(BaseHTTPRequestHandler):
    server_version = "valet-agent"
    sys_version = ""
    timeout = 20   # a caller that stops talking doesn't keep a thread

    def send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        try:
            self.answer()
        except OSError:   # the caller hung up, or there's no systemctl here
            self.close_connection = True
        except Exception as e:   # Docker gone or talking nonsense: said plainly, and the agent stays up
            self.send(502, {"error": str(e)[:200] or type(e).__name__})

    def answer(self):
        url = urlparse(self.path)
        if NETWORKS:
            who = ipaddress.ip_address(self.client_address[0])
            who = getattr(who, "ipv4_mapped", None) or who
            if not any(who in n for n in NETWORKS):
                return self.send(403, {"error": "not from this address"})
        if url.path == "/health":
            return self.send(200, {"ok": True})
        given = self.headers.get("Authorization", "").removeprefix("Bearer ").encode()
        if not hmac.compare_digest(given, TOKEN.encode()):
            return self.send(401, {"error": "bad token"})
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        if url.path == "/v1/machine":
            return self.send(200, machine())
        if url.path in ("/v1/units", "/services"):
            return self.send(200, {"host": os.uname().nodename, "services": units()})
        if url.path == "/v1/containers":
            if not DOCKER:
                return self.send(404, {"error": "containers are off on this agent"})
            found = containers()
            return self.send(200, {"containers": [{**c, "id": c["id"][:12]} for c in (with_usage(found) if q.get("usage") else found)]})
        if url.path in ("/v1/logs", "/logs"):
            try:
                lines = min(max(int(q.get("lines", 300)), 1), 2000)
                minutes = min(max(int(q.get("minutes", 0)), 0), 43200)
            except ValueError:
                return self.send(400, {"error": "lines and minutes are numbers"})
            match = q.get("match", "")[:100]
            if "container" in q and url.path == "/v1/logs":
                # the name must be one Docker listed and this agent may show: what was typed never reaches a path
                found = containers() if DOCKER else []
                c = next((c for c in found if c["name"] == q["container"]), None)
                if not c:
                    return self.send(404, {"error": "not a listed container", "listed": [c["name"] for c in found][:200]})
                return self.send(200, container_logs(c, lines, minutes, match))
            # listed services only, matched exactly: nothing here reaches journalctl unchecked
            unit = next((u for u in UNITS if u == q.get("unit") or scope(u)[1] == q.get("unit")), None)
            if not unit:
                return self.send(404, {"error": "not a listed service", "listed": UNITS})
            return self.send(200, {"unit": unit, "lines": unit_logs(unit, lines, minutes, match)})
        self.send(404, {"error": "no such path"})

    def do_POST(self):
        self.send(405, {"error": "this agent only reads"})
    do_PUT = do_DELETE = do_PATCH = do_POST

    def log_message(self, *args):
        pass


def main():
    if len(TOKEN) < 24:
        sys.exit("valet-agent: set VALET_AGENT_TOKEN to at least 24 characters")
    bad = [u for u in UNITS if not VALID.match(u)] + [m for m in MOUNTS if not MOUNT.match(m) or ".." in m]
    if bad:
        sys.exit(f"valet-agent: these aren't service names or mount points: {bad}")
    if DOCKER and not re.fullmatch(r"http://[A-Za-z0-9.\[\]:-]+/?|(unix://)?/[^\s?#]+", DOCKER):
        sys.exit("valet-agent: VALET_AGENT_DOCKER is http://host:port (a read-only socket proxy) or the path of a socket")
    if not (UNITS or METRICS or DOCKER):
        sys.exit("valet-agent: nothing to report. Set VALET_AGENT_UNITS, VALET_AGENT_METRICS=1 or VALET_AGENT_DOCKER")
    try:
        NETWORKS.extend(ipaddress.ip_network(a, strict=False) for a in ALLOW)
    except ValueError as e:
        sys.exit(f"valet-agent: VALET_AGENT_ALLOW: {e}")
    cpu()   # the first look, so the first answer has something to compare with
    host, port = BIND.rsplit(":", 1)
    on = [f"{len(UNITS)} services" if UNITS else "", "metrics" if METRICS else "", "containers" if DOCKER else ""]
    server = ThreadingHTTPServer((host, int(port)), Agent)
    print(f"valet-agent on {BIND}: {', '.join(x for x in on if x)}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
