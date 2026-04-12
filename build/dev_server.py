#!/usr/bin/env python3
"""
Toolbox Base — Development Server

Serves the assembled web UI on localhost with a mock WebSocket so you can
iterate on the UI in a browser without flashing firmware.

Usage:
    python dev_server.py --tool-dir tools/userial
    python dev_server.py --tool-dir /path/to/your/tool --port 8080

Features:
  - Assembles HTML on the fly from template + tool files
  - Auto-reloads when any source file changes (polls every 1s)
  - Mock WebSocket sends fake data matching your tool's protocol
  - Tool can provide a mock_data.json for custom mock responses

Requires: pip install websockets  (only dependency beyond stdlib)
"""

import asyncio
import json
import time
import hashlib
import argparse
import sys
import os
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
import threading

# Add parent so we can import build_web
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_web import assemble, read_text

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------

_base_dir = None
_tool_dir = None
_assembled_html = ""
_last_hash = ""
_mock_data = {}

# ---------------------------------------------------------------------------
# File watching
# ---------------------------------------------------------------------------

def _source_files():
    """Collect all source files that should trigger rebuild."""
    files = []
    for d in [_base_dir / "web", _tool_dir / "web"]:
        if d.is_dir():
            for f in d.rglob("*"):
                if f.is_file() and f.suffix in (".html", ".css", ".js", ".json"):
                    files.append(f)
    return files


def _compute_hash():
    h = hashlib.md5()
    for f in sorted(_source_files()):
        try:
            h.update(f.read_bytes())
        except OSError:
            pass
    return h.hexdigest()


def _rebuild_if_needed():
    global _assembled_html, _last_hash
    current = _compute_hash()
    if current != _last_hash:
        _last_hash = current
        _assembled_html = assemble(_base_dir, _tool_dir)
        # Inject auto-reload snippet
        reload_script = """
<script>
(function(){
    let lastCheck = Date.now();
    setInterval(async () => {
        try {
            const r = await fetch('/__reload_check');
            const data = await r.json();
            if (data.hash !== document.documentElement.dataset.buildHash) {
                location.reload();
            }
        } catch(e) {}
    }, 1000);
})();
</script>
"""
        _assembled_html = _assembled_html.replace(
            "</body>",
            f'{reload_script}\n<script>document.documentElement.dataset.buildHash = "{current}";</script>\n</body>'
        )
        print(f"[dev] Rebuilt ({len(_assembled_html)} bytes)")
    return current


# ---------------------------------------------------------------------------
# HTTP server
# ---------------------------------------------------------------------------

class DevHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/" or self.path == "/index.html":
            _rebuild_if_needed()
            content = _assembled_html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(content)
        elif self.path == "/__reload_check":
            h = _rebuild_if_needed()
            body = json.dumps({"hash": h}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, fmt, *args):
        # Suppress access logs for reload checks
        if "/__reload_check" not in (args[0] if args else ""):
            super().log_message(fmt, *args)


# ---------------------------------------------------------------------------
# Mock WebSocket
# ---------------------------------------------------------------------------

def _load_mock_data():
    """Load mock responses from tool-dir/web/mock_data.json if it exists."""
    global _mock_data
    p = _tool_dir / "web" / "mock_data.json"
    if p.exists():
        try:
            _mock_data = json.loads(p.read_text(encoding="utf-8"))
            print(f"[dev] Loaded mock data from {p}")
        except Exception as e:
            print(f"[dev] Warning: failed to parse mock_data.json: {e}")
    else:
        # Default mock data
        _mock_data = {
            "status": {
                "type": "status",
                "rxBytes": 1024,
                "txBytes": 256,
                "uptime": 3661,
                "heap": 180000,
                "mac": "AA:BB:CC:DD:EE:FF",
                "baud": 9600,
                "config": "8N1",
                "wifiMode": 0,
                "mdnsHost": "tool",
                "mdnsActive": True,
                "apIP": "192.168.4.1"
            },
            "settings": {
                "type": "settings",
                "ssid": "ToolAP",
                "apHasPass": True,
                "baud": 9600,
                "databits": 8,
                "parity": "N",
                "stopbits": 1,
                "mdnsHost": "tool",
                "wifiMode": 0,
                "staSSID": "",
                "staHasPass": False
            },
            "history": {
                "type": "history",
                "items": []
            }
        }


async def _mock_ws_handler(websocket):
    """Handle a single WebSocket client with mock responses."""
    print(f"[dev] WS client connected")
    try:
        async for message in websocket:
            try:
                msg = json.loads(message)
                cmd = msg.get("cmd", "")
            except json.JSONDecodeError:
                continue

            # Check for exact match in mock_data
            if cmd in _mock_data:
                await websocket.send(json.dumps(_mock_data[cmd]))
            elif cmd == "getHistory":
                await websocket.send(json.dumps(_mock_data.get("history", {"type": "history", "items": []})))
            elif cmd == "wifiscan":
                await websocket.send(json.dumps({
                    "type": "wifiscan",
                    "networks": [
                        {"ssid": "HomeWiFi", "rssi": -45, "enc": True},
                        {"ssid": "OfficeNet", "rssi": -62, "enc": True},
                        {"ssid": "OpenNet", "rssi": -78, "enc": False}
                    ]
                }))
            elif cmd in ("send", "sendAscii"):
                data = msg.get("data", "")
                await websocket.send(json.dumps({
                    "type": "sent",
                    "len": len(data),
                    "hex": " ".join(f"{ord(c):02X}" for c in data[:32]),
                    "ascii": data[:32],
                    "total": 256 + len(data)
                }))
            elif cmd == "sendHex":
                await websocket.send(json.dumps({
                    "type": "sent",
                    "len": 4,
                    "hex": msg.get("data", "00"),
                    "ascii": "....",
                    "total": 260
                }))
            elif cmd == "savesettings" or cmd == "savewifi":
                await websocket.send(json.dumps({"type": "saved"}))
            elif cmd == "clearHistory":
                await websocket.send(json.dumps({"type": "cleared"}))
            else:
                print(f"[dev] Unhandled WS command: {cmd}")

    except Exception as e:
        if "close" not in str(e).lower() and "1000" not in str(e):
            print(f"[dev] WS error: {e}")
    finally:
        print(f"[dev] WS client disconnected")


async def _run_ws_server(host, port):
    """Run WebSocket server on ws://host:port/ws."""
    import websockets
    async with websockets.serve(_mock_ws_handler, host, port):
        print(f"[dev] Mock WebSocket running on ws://{host}:{port}/ws")
        await asyncio.Future()  # run forever


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    global _base_dir, _tool_dir

    parser = argparse.ArgumentParser(description="Toolbox Base dev server")
    parser.add_argument("--base-dir", type=Path, default=Path(__file__).resolve().parent.parent,
                        help="Path to toolbox-base root")
    parser.add_argument("--tool-dir", type=Path, required=True,
                        help="Path to tool project (with web/ folder)")
    parser.add_argument("--port", type=int, default=8080, help="HTTP port (default 8080)")
    parser.add_argument("--ws-port", type=int, default=0, help="WS port (default: same as HTTP)")
    args = parser.parse_args()

    _base_dir = args.base_dir.resolve()
    _tool_dir = args.tool_dir.resolve()
    http_port = args.port

    if not (_base_dir / "web" / "template.html").exists():
        print(f"Error: template.html not found in {_base_dir / 'web'}")
        return 1
    if not (_tool_dir / "web").is_dir():
        print(f"Error: web/ folder not found in {_tool_dir}")
        return 1

    _load_mock_data()
    _rebuild_if_needed()

    # The trick: we serve HTTP and WS on the same port by using a combined approach
    # HTTP serves the page, WS runs on the same port with /ws path
    # We'll use separate ports for simplicity: HTTP on --port, WS on --port+1
    ws_port = args.ws_port or (http_port + 1)

    # Patch the assembled HTML to point WS to the dev server port
    global _assembled_html
    _assembled_html = _assembled_html.replace(
        "ws://' + location.host + '/ws",
        f"ws://' + location.hostname + ':{ws_port}/ws"
    )

    # Start HTTP server in a thread
    httpd = HTTPServer(("0.0.0.0", http_port), DevHandler)
    http_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    http_thread.start()
    print(f"[dev] HTTP server on http://localhost:{http_port}")
    print(f"[dev] Open this URL in your browser (or on your phone on the same network)")
    print(f"[dev] Files watched: {_base_dir / 'web'}, {_tool_dir / 'web'}")
    print(f"[dev] Auto-reloads on file changes. Press Ctrl+C to stop.\n")

    # Run WS server in the main asyncio loop
    try:
        asyncio.run(_run_ws_server("0.0.0.0", ws_port))
    except KeyboardInterrupt:
        print("\n[dev] Shutting down...")
        httpd.shutdown()

    return 0


if __name__ == "__main__":
    sys.exit(main())
