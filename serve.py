#!/usr/bin/env python3
"""Same as `python3 -m http.server`, minus the caching.

python3 -m http.server only sends Last-Modified, so Chrome happily serves app.js and
style.css from its own cache — hit refresh and you can be looking at old code without
knowing it. Every edit needed a hard reload. no-store makes a plain refresh honest.
"""
import http.server
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5555


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


http.server.test(HandlerClass=NoCache, port=PORT, bind='127.0.0.1')
