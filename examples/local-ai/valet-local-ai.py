#!/usr/bin/env python3
"""Serves Valet's Local AI format from what's already on the machine: the GPU from nvidia-smi, and the loaded model from
Ollama. Standard library only. Run it next to the GPU, then point Valet's `aimonitor` integration at it.

    python3 valet-local-ai.py                 # port 8097; Ollama at http://localhost:11434
    OLLAMA=http://ollama:11434 PORT=8097 python3 valet-local-ai.py

It answers /api/live only, so Valet shows the GPU and the model without the day's graphs or the electricity cost.
Counting requests and tokens needs something that sees each request (a proxy in front of the model); this doesn't, so
today's numbers stay at zero. The full format is at https://askvalet.dev/integrations/aimonitor/
"""
import json, os, subprocess, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OLLAMA = os.environ.get("OLLAMA", "http://localhost:11434").rstrip("/")
PORT = int(os.environ.get("PORT", "8097"))


def gpu():
    fields = "utilization.gpu,power.draw,temperature.gpu,memory.used,memory.total"
    out = subprocess.run(["nvidia-smi", f"--query-gpu={fields}", "--format=csv,noheader,nounits"],
                         capture_output=True, text=True, timeout=5).stdout.splitlines()[0]
    util, power, temp, mem, total = (float(v) if v.strip() not in ("", "[N/A]") else 0.0 for v in out.split(","))
    return {"util": util, "power": power, "temp": temp, "mem": mem, "mem_total": total}


def model():
    try:
        with urllib.request.urlopen(f"{OLLAMA}/api/ps", timeout=3) as r:
            loaded = json.load(r).get("models", [])
        return {"name": loaded[0]["name"] if loaded else "nothing loaded", "swapping": None}
    except Exception:
        return {"name": "unknown", "swapping": None}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/api/live":
            self.send_error(404)
            return
        body = json.dumps({"gpu": gpu(), "model": model(), "running": [], "today": {"requests": 0, "tokens": 0}}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print(f"Valet Local AI on :{PORT} (Ollama at {OLLAMA})")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
