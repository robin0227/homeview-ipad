#!/usr/bin/env python3
"""Serves the glass benchmark to the LAN and records what the iPad posts back.

GET  /          index.html (and other files in this folder)
POST /result    JSON from the page, appended to results.jsonl and printed
"""
import json
import os
import socket
import sys
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8770
LOG = os.path.join(HERE, "results.jsonl")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        if self.path.rstrip("/") != "/result":
            self.send_error(404)
            return
        n = min(int(self.headers.get("Content-Length", 0)), 1 << 20)
        raw = self.rfile.read(n)
        try:
            body = json.loads(raw)
        except ValueError:
            self.send_error(400)
            return
        body["from"] = self.client_address[0]
        body["received"] = datetime.now().isoformat(timespec="seconds")
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(body, ensure_ascii=False) + "\n")
        print("RESULT", json.dumps(body, ensure_ascii=False), flush=True)
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        print("%s %s" % (self.client_address[0], fmt % args), flush=True)


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


if __name__ == "__main__":
    print("open on iPad: http://%s:%d/" % (lan_ip(), PORT), flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
