#!/usr/bin/env python3
"""Local preview of web/ on the Mac (127.0.0.1 only).

/dev-config.js is generated from ../config.json plus the HA token in
~/.config/homeview/ha_token, so the page behaves as in the app (where the
native shell injects the same object). The token never leaves this machine.
"""
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8780


def dev_config():
    with open(os.path.join(ROOT, "config.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    tok = os.path.expanduser("~/.config/homeview/ha_token")
    if os.path.exists(tok):
        cfg["token"] = open(tok).read().strip()
    return "window.HV_CONFIG = " + json.dumps(cfg, ensure_ascii=False) + ";\n"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/dev-config.js":
            body = dev_config().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    print("preview: http://127.0.0.1:%d/" % PORT, flush=True)
    class Server(ThreadingHTTPServer):
        request_queue_size = 64        # the default (5) drops parallel script requests
        daemon_threads = True
    Server(("127.0.0.1", PORT), Handler).serve_forever()
