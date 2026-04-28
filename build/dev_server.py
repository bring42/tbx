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
import re
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


def _preview_ascii(data: bytes) -> str:
    out = []
    for value in data[:32]:
        if 32 <= value < 127:
            out.append(chr(value))
        elif value == 13:
            out.append("\\r")
        elif value == 10:
            out.append("\\n")
        elif value == 9:
            out.append("\\t")
        else:
            out.append(".")
    return "".join(out)


def _preview_hex(data: bytes) -> str:
    return " ".join(f"{value:02X}" for value in data[:32])


def _parse_hex_bytes(raw: str) -> bytes:
    tokens = re.findall(r"[0-9A-Fa-f]{1,2}", raw or "")
    if not tokens:
        return b""
    return bytes(int(token, 16) for token in tokens)


def _normalize_mock_state():
    status = _mock_data.setdefault("status", {"type": "status"})
    settings = _mock_data.setdefault("settings", {"type": "settings"})
    history = _mock_data.setdefault("history", {"type": "history", "items": []})

    status.setdefault("rxBytes", 0)
    status.setdefault("txBytes", 0)
    status.setdefault("uptime", 0)
    status.setdefault("heap", 180000)
    status.setdefault("baud", 9600)
    status.setdefault("databits", 8)
    status.setdefault("parity", "N")
    status.setdefault("stopbits", 1)
    status.setdefault("config", "8N1")
    status.setdefault("passthroughMode", "both")
    status.setdefault("wifiMode", 0)
    status.setdefault("mdnsHost", "tool")
    status.setdefault("mdnsActive", True)
    status.setdefault("apIP", "192.168.4.1")

    ports = status.setdefault("ports", [
        {"id": "A", "label": "Channel A", "rxPin": 4, "txPin": 5, "rxBytes": 0, "txBytes": 0},
        {"id": "B", "label": "Channel B", "rxPin": 6, "txPin": 7, "rxBytes": 0, "txBytes": 0},
    ])
    for port in ports:
        port.setdefault("label", f"Channel {port.get('id', 'A')}")
        port.setdefault("rxPin", 4 if port.get("id") == "A" else 6)
        port.setdefault("txPin", 5 if port.get("id") == "A" else 7)
        port.setdefault("rxBytes", 0)
        port.setdefault("txBytes", 0)

    settings.update({
        "type": "settings",
        "ssid": settings.get("ssid", "ToolAP"),
        "apHasPass": settings.get("apHasPass", True),
        "wifiMode": settings.get("wifiMode", status["wifiMode"]),
        "staSSID": settings.get("staSSID", ""),
        "staHasPass": settings.get("staHasPass", False),
        "mdnsHost": settings.get("mdnsHost", status["mdnsHost"]),
        "baud": settings.get("baud", status["baud"]),
        "databits": settings.get("databits", status["databits"]),
        "parity": settings.get("parity", status["parity"]),
        "stopbits": settings.get("stopbits", status["stopbits"]),
        "config": settings.get("config", status["config"]),
        "passthroughMode": settings.get("passthroughMode", status["passthroughMode"]),
        "ports": ports,
    })
    history.setdefault("type", "history")
    history.setdefault("items", [])


def _port_state(port_id: str):
    port_id = (port_id or "A").upper()
    for port in _mock_data["status"]["ports"]:
        if port["id"] == port_id:
            return port
    return _mock_data["status"]["ports"][0]


def _append_history(entry):
    items = _mock_data.setdefault("history", {"type": "history", "items": []})["items"]
    items.append(entry)
    del items[:-80]

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
    _normalize_mock_state()


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
                port = _port_state(msg.get("port", "A"))
                payload = data.encode("utf-8", "ignore")
                port["txBytes"] += len(payload)
                _mock_data["status"]["txBytes"] = sum(item["txBytes"] for item in _mock_data["status"]["ports"])
                _append_history({
                    "ts": int(time.time() * 1000),
                    "port": port["id"],
                    "dir": "TX",
                    "hex": _preview_hex(payload),
                    "ascii": _preview_ascii(payload),
                })
                await websocket.send(json.dumps({
                    "type": "sent",
                    "port": port["id"],
                    "len": len(payload),
                    "hex": _preview_hex(payload),
                    "ascii": _preview_ascii(payload),
                    "total": _mock_data["status"]["txBytes"],
                    "portTxBytes": port["txBytes"],
                    "ts": int(time.time() * 1000)
                }))
            elif cmd == "sendHex":
                port = _port_state(msg.get("port", "A"))
                payload = _parse_hex_bytes(msg.get("data", ""))
                port["txBytes"] += len(payload)
                _mock_data["status"]["txBytes"] = sum(item["txBytes"] for item in _mock_data["status"]["ports"])
                _append_history({
                    "ts": int(time.time() * 1000),
                    "port": port["id"],
                    "dir": "TX",
                    "hex": _preview_hex(payload),
                    "ascii": _preview_ascii(payload),
                })
                await websocket.send(json.dumps({
                    "type": "sent",
                    "port": port["id"],
                    "len": len(payload),
                    "hex": _preview_hex(payload),
                    "ascii": _preview_ascii(payload),
                    "total": _mock_data["status"]["txBytes"],
                    "portTxBytes": port["txBytes"],
                    "ts": int(time.time() * 1000)
                }))
            elif cmd == "setSerial":
                baud = int(msg.get("baud", _mock_data["status"]["baud"]))
                databits = int(msg.get("databits", _mock_data["status"]["databits"]))
                parity = str(msg.get("parity", _mock_data["status"]["parity"]))
                stopbits = int(msg.get("stopbits", _mock_data["status"]["stopbits"]))
                config = f"{databits}{parity}{stopbits}"
                for section in ("status", "settings"):
                    _mock_data[section]["baud"] = baud
                    _mock_data[section]["databits"] = databits
                    _mock_data[section]["parity"] = parity
                    _mock_data[section]["stopbits"] = stopbits
                    _mock_data[section]["config"] = config
                await websocket.send(json.dumps({
                    "type": "serialConfig",
                    "baud": baud,
                    "databits": databits,
                    "parity": parity,
                    "stopbits": stopbits,
                    "config": config
                }))
            elif cmd == "setPassthrough":
                mode = msg.get("mode", "both")
                _mock_data["status"]["passthroughMode"] = mode
                _mock_data["settings"]["passthroughMode"] = mode
                await websocket.send(json.dumps({"type": "passthroughConfig", "mode": mode}))
            elif cmd == "savesettings" or cmd == "savewifi":
                await websocket.send(json.dumps({"type": "saved"}))
            elif cmd == "clearHistory":
                for port in _mock_data["status"]["ports"]:
                    port["rxBytes"] = 0
                    port["txBytes"] = 0
                _mock_data["status"]["rxBytes"] = 0
                _mock_data["status"]["txBytes"] = 0
                _mock_data.setdefault("history", {"type": "history", "items": []})["items"] = []
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
