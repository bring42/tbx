#ifndef TOOLBOX_OTA_H
#define TOOLBOX_OTA_H

/*
 * Toolbox Base — OTA Firmware Updates
 * Provides two upload methods:
 *   1. ArduinoOTA — PlatformIO wireless upload (`pio run -t upload` with espota)
 *   2. HTTP browser upload — navigate to http://<device-ip>/ota
 *
 * Usage:
 *   #include "toolbox_ota.h"
 *
 *   // in setup(), after tbWifiBegin() and tbWebBegin():
 *   tbOtaBegin();             // no password
 *   tbOtaBegin("s3cr3t");     // with ArduinoOTA password
 *
 *   // in loop():
 *   tbOtaLoop();
 *
 * PlatformIO OTA upload — add to your platformio.ini env:
 *   upload_protocol = espota
 *   upload_port     = <device-ip>  ; or <mdns-name>.local
 *   ; upload_flags = --auth=s3cr3t    ; if using a password
 */

#include <Arduino.h>
#include <ArduinoOTA.h>
#include <Update.h>
#include "toolbox_web.h"   // for tbServer()

// ---------------------------------------------------------------------------
// Browser OTA upload page — minimal dark-themed, drag-and-drop
// ---------------------------------------------------------------------------
static const char _tbOtaPage[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Firmware Update</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,sans-serif;background:#111827;color:#e5e7eb;display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{background:#1f2937;border:1px solid #374151;border-radius:12px;padding:2rem;width:100%;max-width:400px;text-align:center}
h2{margin:0 0 .25rem;color:#60a5fa;font-size:1.25rem}
.sub{color:#6b7280;font-size:.8rem;margin:0 0 1.5rem}
.drop{border:2px dashed #4b5563;border-radius:8px;padding:2rem 1rem;cursor:pointer;transition:border-color .2s,background .2s;margin-bottom:.75rem;color:#9ca3af;font-size:.9rem}
.drop.over,.drop:hover{border-color:#60a5fa;background:#1a2840;color:#e5e7eb}
input[type=file]{display:none}
.fname{font-size:.82rem;color:#6b7280;margin-bottom:.75rem;min-height:1.1em}
button{background:#2563eb;color:#fff;border:none;border-radius:8px;padding:.65rem 0;font-size:1rem;cursor:pointer;width:100%;transition:background .2s}
button:hover:not(:disabled){background:#3b82f6}
button:disabled{opacity:.45;cursor:not-allowed}
#status{margin-top:1rem;font-size:.88rem;min-height:1.4em;color:#9ca3af}
#status.ok{color:#34d399}
#status.err{color:#f87171}
progress{display:none;width:100%;margin-top:.75rem;height:6px;border-radius:3px;overflow:hidden;appearance:none;-webkit-appearance:none;border:none}
progress::-webkit-progress-bar{background:#374151;border-radius:3px}
progress::-webkit-progress-value{background:#2563eb;transition:width .1s;border-radius:3px}
</style>
</head>
<body>
<div class="card">
  <h2>Firmware Update</h2>
  <p class="sub">Upload a compiled .bin file</p>
  <label>
    <div class="drop" id="drop">&#x1F4E6; Drop .bin here<br>or click to browse</div>
    <input type="file" id="file" accept=".bin">
  </label>
  <div class="fname" id="fname"></div>
  <button id="btn" disabled>Upload Firmware</button>
  <div id="status"></div>
  <progress id="prog" max="1" value="0"></progress>
</div>
<script>
const drop=document.getElementById('drop'),fileIn=document.getElementById('file'),
      btn=document.getElementById('btn'),status=document.getElementById('status'),
      prog=document.getElementById('prog'),fname=document.getElementById('fname');
let file=null;
function setFile(f){
  file=f;fname.textContent=f?f.name+' ('+Math.round(f.size/1024)+' KB)':'';
  btn.disabled=!f;status.textContent='';status.className='';
}
fileIn.addEventListener('change',()=>setFile(fileIn.files[0]));
drop.addEventListener('click',()=>fileIn.click());
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('over')});
drop.addEventListener('dragleave',()=>drop.classList.remove('over'));
drop.addEventListener('drop',e=>{
  e.preventDefault();drop.classList.remove('over');
  const f=e.dataTransfer.files[0];
  if(f&&f.name.endsWith('.bin'))setFile(f);
  else{status.textContent='Please drop a .bin file';status.className='err';}
});
btn.addEventListener('click',()=>{
  if(!file)return;
  btn.disabled=true;prog.style.display='block';prog.value=0;
  status.textContent='Uploading\u2026';status.className='';
  const xhr=new XMLHttpRequest();
  xhr.open('POST','/update');
  xhr.upload.onprogress=e=>{if(e.lengthComputable)prog.value=e.loaded/e.total;};
  xhr.onload=()=>{
    prog.style.display='none';
    if(xhr.status===200){
      status.textContent='Upload complete \u2014 device rebooting\u2026';status.className='ok';
    } else {
      status.textContent='Upload failed: '+xhr.responseText;status.className='err';btn.disabled=false;
    }
  };
  xhr.onerror=()=>{prog.style.display='none';status.textContent='Connection error';status.className='err';btn.disabled=false;};
  xhr.send(file);
});
</script>
</body>
</html>
)rawliteral";

// ---------------------------------------------------------------------------
// HTTP OTA upload handler (receives binary in chunks)
// ---------------------------------------------------------------------------
static void _tbOtaUploadHandler(AsyncWebServerRequest* /*req*/,
                                const String& filename, size_t index,
                                uint8_t* data, size_t len, bool final) {
    if (!index) {
        Serial.printf("[OTA] Upload start: %s\n", filename.c_str());
        if (!Update.begin(UPDATE_SIZE_UNKNOWN)) {
            Update.printError(Serial);
        }
    }
    if (Update.isRunning() && Update.write(data, len) != len) {
        Update.printError(Serial);
    }
    if (final) {
        if (Update.end(true)) {
            Serial.printf("[OTA] Upload complete: %u bytes\n", index + len);
        } else {
            Update.printError(Serial);
        }
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise OTA firmware updates.
 * Call in setup() after tbWifiBegin() (and before or after tbWebBegin()).
 *
 * @param otaPassword  Password for ArduinoOTA (nullptr = no auth)
 * @param hostname     mDNS hostname for OTA discovery (nullptr = use default)
 */
inline void tbOtaBegin(const char* otaPassword = nullptr, const char* hostname = nullptr) {

    // — ArduinoOTA —
    if (hostname)    ArduinoOTA.setHostname(hostname);
    if (otaPassword) ArduinoOTA.setPassword(otaPassword);

    ArduinoOTA.onStart([]() {
        Serial.printf("[OTA] Starting %s update\n",
            ArduinoOTA.getCommand() == U_FLASH ? "firmware" : "filesystem");
    });
    ArduinoOTA.onEnd([]() {
        Serial.println("\n[OTA] Complete");
    });
    ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
        Serial.printf("[OTA] Progress: %u%%\r", progress * 100 / total);
    });
    ArduinoOTA.onError([](ota_error_t err) {
        const char* msg = "Unknown error";
        if      (err == OTA_AUTH_ERROR)    msg = "Auth failed";
        else if (err == OTA_BEGIN_ERROR)   msg = "Begin failed";
        else if (err == OTA_CONNECT_ERROR) msg = "Connect failed";
        else if (err == OTA_RECEIVE_ERROR) msg = "Receive failed";
        else if (err == OTA_END_ERROR)     msg = "End failed";
        Serial.printf("[OTA] Error: %s\n", msg);
    });

    ArduinoOTA.begin();
    Serial.println("  ArduinoOTA ready");

    // — HTTP OTA page at /ota —
    tbServer().on("/ota", HTTP_GET, [](AsyncWebServerRequest* req) {
        req->send_P(200, "text/html", _tbOtaPage);
    });

    // — HTTP POST /update — receives raw binary —
    tbServer().on("/update", HTTP_POST,
        [](AsyncWebServerRequest* req) {
            bool ok = !Update.hasError();
            AsyncWebServerResponse* r = req->beginResponse(
                200, "text/plain", ok ? "OK" : Update.errorString());
            r->addHeader("Connection", "close");
            req->send(r);
            if (ok) {
                delay(100);
                ESP.restart();
            }
        },
        _tbOtaUploadHandler
    );

    Serial.println("  HTTP OTA at /ota");
}

/**
 * Call in loop() to service ArduinoOTA network requests.
 */
inline void tbOtaLoop() {
    ArduinoOTA.handle();
}

#endif // TOOLBOX_OTA_H
