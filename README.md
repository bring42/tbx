# Toolbox Base

[![Build](https://github.com/bring42/tbx/actions/workflows/build.yml/badge.svg)](https://github.com/bring42/tbx/actions/workflows/build.yml)

Shared template system for ESP32 embedded tool web UIs. Each tool gets a small web app served directly from the ESP32 — dark theme, WebSocket-based, with WiFi config and OTA updates built in.

<img width="1024" height="591" alt="Screenshot 2026-04-13 at 01 17 13" src="https://github.com/user-attachments/assets/c2de9047-4e91-4987-a128-8d37723153c5" />


```
platformio_base.ini      ← shared PlatformIO configuration
firmware/
  toolbox_common.h       ← LED, common helpers
  toolbox_wifi.h         ← WiFi AP/STA, auto-reconnect, mDNS
  toolbox_web.h          ← ESPAsyncWebServer + WebSocket setup
  toolbox_ota.h          ← ArduinoOTA + browser /ota upload
web/
  base.css               ← shared dark theme
  base.js                ← WebSocket, tabs, toast, settings utilities
  template.html          ← HTML skeleton with placeholders
build/
  build_web.py           ← assembles template + tool files → gzip C header
  dev_server.py          ← HTTP + mock WebSocket dev server, auto-reload
tools/
  userial/               ← RS-232 serial monitor/sender
  wifiscan/              ← WiFi network scanner
```

## How It Works

Configure your home WiFi through the built-in settings panel (device starts as an AP on first boot). Once connected, it auto-reconnects on power-up and is reachable at `http://<toolname>.local`. Add it to your iOS/Android home screen and it feels like a native app.

## Dev Server

Iterate on the web UI without hardware. Serves the assembled HTML with a mock WebSocket — data comes from `mock_data.json`.

```bash
pip install websockets
python build/dev_server.py --tool-dir tools/userial
# → http://localhost:8080
```

Auto-reloads on file changes.

## Build & Flash

```bash
cd tools/userial
pio run -e xiao_esp32c3 -t upload        # USB
pio run -e xiao_esp32c3_ota -t upload    # OTA (after initial flash)
```

`build_web.py` runs automatically as a PlatformIO pre-script — assembles the web UI into `src/web_ui_gz.h`.

Boards: Seeed XIAO ESP32-C3, XIAO ESP32-S3. OTA via PlatformIO or browser at `http://<ip>/ota`.

## Creating a New Tool

### With Copilot

The repo includes a `@new-tool` agent (`.github/agents/new-tool.agent.md`). In VS Code with GitHub Copilot Chat:

```
@new-tool Create a tool called "gpiomon" that monitors GPIO pin states and displays them as a live pin map
```

It reads the existing patterns, scaffolds all 7 files, and runs the dev server to verify. There's also a `@debug-tool` agent for when things don't work.

### Manually

1. Copy `tools/userial/` to `tools/mytool/`
2. Edit `web/config.json` — set `"title"`
3. Build your UI in `web/app.html`, `app.css`, `app.js`
4. Implement firmware in `src/main.cpp`
5. Update `web/mock_data.json` for the dev server
6. Test: `python build/dev_server.py --tool-dir tools/mytool`

Each tool's JS implements three hooks:

```js
function onConnected()      { /* WebSocket connected — request initial data */ }
function onMessage(data)    { /* handle incoming JSON messages */ }
function onSettingsOpen()   { /* settings drawer opened */ }
```

Firmware follows a simple pattern — `handleToolWS()` for commands, `tb*Begin()` in setup, `tb*Loop()` in loop.

## Template Placeholders

`build/build_web.py` injects content into `web/template.html` using these markers:

| Placeholder | Source |
|---|---|
| `<!-- TOOL_TITLE -->` | `config.json` → `title` |
| `/* {{BASE_CSS}} */` | `web/base.css` |
| `/* {{TOOL_CSS}} */` | `web/app.css` |
| `// {{BASE_JS}}` | `web/base.js` |
| `// {{TOOL_JS}}` | `web/app.js` |
| `<!-- {{TOOL_TABS}} -->` | `app.html` `<!-- TABS -->` section |
| `<!-- {{TOOL_BODY}} -->` | `app.html` `<!-- BODY -->` section |
| `<!-- {{SETTINGS_BODY}} -->` | `app.html` `<!-- SETTINGS -->` section |

## Shared JS API (`base.js`)

Functions available to every tool's `app.js`:

| Function | Description |
|---|---|
| `tbConnect()` | Initiate WebSocket connection |
| `wsSend(obj)` | Send JSON object over WebSocket |
| `showToast(msg, type)` | Show a toast notification (`info`/`ok`/`warn`/`error`) |
| `openSettings()` / `closeSettings()` | Open/close the settings drawer |
| `formatUptime(s)` | Format seconds as `Xd Xh Xm Xs` |
| `formatTimestamp(ts)` | Format a Unix timestamp as local time |
| `toggleSwitch(id, cb)` | Wire up a toggle switch element |
| `downloadBlob(blob, fn)` | Trigger a file download |
| `escapeHtml(str)` | Escape HTML special characters |
| `tbInit()` | Called once on page load (auto-invoked) |

## Shared WiFi Settings (`base.js` + `template.html`)

Every tool automatically gets a WiFi configuration panel in the settings modal — no tool-specific code needed for basic WiFi.

| Feature | Details |
|---|---|
| WiFi mode | AP Only, AP + Client, Client Only — with smart fallback |
| AP config | SSID + password |
| Client config | Network scan with signal bars, click-to-select, password |
| mDNS | Configurable `.local` hostname |
| Device info | IP, MAC, free heap |

**Firmware side**: your `handleToolWS()` needs to handle `"wifiscan"` and pass WiFi fields in `"savewifi"`. The shared helpers do the heavy lifting:

```cpp
// In handleToolWS():
if (strcmp(cmd, "wifiscan") == 0) {
    JsonDocument resp;
    tbWifiScanJson(resp);          // populates type + networks array
    tbWsReply(client, resp);
}
else if (strcmp(cmd, "savewifi") == 0) {
    tbWifiSave(PREFS_NS, doc["ssid"], doc["pass"] | "",
               doc["wifiMode"] | -1,
               doc["staSSID"] | (const char*)NULL,
               doc["staPass"] | (const char*)NULL,
               doc["mdnsHost"] | (const char*)NULL);
}
```

**Web side**: `base.js` handles `settings`, `wifiscan`, and `status` messages internally before passing them to your `onMessage()` hook — you don't need to populate WiFi fields yourself.

## Dependencies

| Library | Version |
|---|---|
| mathieucarbou/AsyncTCP | ^3.2.14 |
| mathieucarbou/ESPAsyncWebServer | ^3.4.5 |
| bblanchon/ArduinoJson | ^7.0.0 |
