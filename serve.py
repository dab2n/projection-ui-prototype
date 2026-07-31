#!/usr/bin/env python3
"""Same as `python3 -m http.server`, minus the caching, plus byte ranges.

python3 -m http.server only sends Last-Modified, so Chrome happily serves app.js and
style.css from its own cache — hit refresh and you can be looking at old code without
knowing it. Every edit needed a hard reload. no-store makes a plain refresh honest.

It also answers every request with the whole file. Chrome's media loader wants Range for
a <video> of any size: without it the desk footage never gets past readyState 0, and even
once it plays there is no way to seek — which is the whole point of the transport and the
cut controls. GitHub Pages does ranges on its own; this is only for the local server.
"""
import http.server
import os
import re
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5555


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()

    def do_GET(self):
        m = re.fullmatch(r'bytes=(\d*)-(\d*)', self.headers.get('Range', '').strip())
        path = self.translate_path(self.path)
        if not m or not os.path.isfile(path):
            return super().do_GET()

        size = os.path.getsize(path)
        first, last = m.group(1), m.group(2)
        # "bytes=-500" is the last 500 bytes, not a range starting at zero
        start = int(first) if first else max(0, size - int(last or 0))
        end = min(int(last), size - 1) if last and first else size - 1
        if start > end or start >= size:
            self.send_response(416)
            self.send_header('Content-Range', f'bytes */{size}')
            self.end_headers()
            return

        self.send_response(206)
        self.send_header('Content-type', self.guess_type(path))
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(end - start + 1))
        self.end_headers()
        with open(path, 'rb') as f:
            f.seek(start)
            self.wfile.write(f.read(end - start + 1))


# HTTP/1.1 so the connection is reused — a video pulls a lot of small ranges
http.server.test(HandlerClass=NoCache, port=PORT, bind='127.0.0.1', protocol='HTTP/1.1')
