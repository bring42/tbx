# Toolbox Base — Project Guidelines

## What This Is

A reusable framework for building ESP32 web-UI tools. Shared firmware headers (`firmware/toolbox_*.h`), a web template system (`web/`), and build tooling (`build/`) let you scaffold new hardware tools quickly. Each tool lives in `tools/<toolname>/`.

## Architecture

```
firmware/toolbox_*.h    → Shared C++ headers (WiFi, web server, OTA, LED)
web/base.css + base.js  → Shared dark-theme UI framework
web/template.html       → HTML skeleton with placeholder markers
build/build_web.py      → Assembles template + tool files → gzipped C header
build/dev_server.py     → Local dev server with mock WebSocket
tools/<tool>/           → Each tool: platformio.ini, src/main.cpp, web/app.*
```

## Code Conventions

- **Firmware**: Header-only (`inline` functions). All shared functions use `tb` prefix (e.g. `tbWifiBegin`, `tbWebLoop`). Private helpers use `_tb` prefix.
- **Web UI**: Vanilla JS, no frameworks. Tools implement three hooks: `onConnected()`, `onMessage(data)`, `onSettingsOpen()`. Use `wsSend({cmd: '...'})` for WebSocket commands.
- **WebSocket protocol**: JSON messages with `"cmd"` field (client→device) and `"type"` field (device→client).
- **CSS**: Use CSS variables from `base.css` (e.g. `var(--primary)`, `var(--success)`). Dark theme only.
- **HTML sections**: `app.html` uses `<!-- TABS -->`, `<!-- BODY -->`, `<!-- SETTINGS -->` markers to split content.

## Build & Test

```bash
# Dev server (no hardware needed)
pip install websockets
python build/dev_server.py --tool-dir tools/userial

# Build & flash
cd tools/userial
pio run -e xiao_esp32c3 -t upload        # USB
pio run -e xiao_esp32c3_ota -t upload    # OTA
```

## Key Patterns

- Every tool's `main.cpp` follows: init LED → init WiFi → init web server → init OTA → loop all four.
- `handleToolWS()` is the callback that dispatches WebSocket commands via `strcmp(cmd, "...")`.
- Settings are persisted via ESP32 `Preferences` library with a tool-specific namespace.
- `build_web.py` runs as a PlatformIO pre-build script automatically.
- `mock_data.json` provides fake WebSocket responses for the dev server — keep it in sync with firmware responses.
- **WiFi settings** (AP/STA mode, scanning, mDNS) are shared via `template.html` + `base.js`. Tools only need `wifiscan` and `savewifi` WS handlers in firmware — the web UI is automatic.
- **When changing shared code**, update README.md and this file if the change affects the developer-facing API or patterns.

## Hardware Target

Primary: Seeed XIAO ESP32-C3. Also supports XIAO ESP32-S3. LED on GPIO 10 (active low). Override with `#define TB_LED_PIN <n>` before including headers.
