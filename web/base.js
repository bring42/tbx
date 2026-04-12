/* ============================================================
   Toolbox Base — Shared JavaScript
   WebSocket, tabs, toast, status, utility functions
   ============================================================ */

let ws;
let _reconnectTimer;
const _statusPollInterval = 5000;

// --- WebSocket -----------------------------------------------------------

function tbConnect() {
    ws = new WebSocket('ws://' + location.host + '/ws');
    ws.onopen = () => {
        document.getElementById('statusDot').classList.remove('offline');
        document.getElementById('statusText').textContent = 'Connected';
        clearInterval(_reconnectTimer);
        // Call tool-specific hook if defined
        if (typeof onConnected === 'function') onConnected();
    };
    ws.onclose = () => {
        document.getElementById('statusDot').classList.add('offline');
        document.getElementById('statusText').textContent = 'Disconnected';
        _reconnectTimer = setInterval(() => {
            if (!ws || ws.readyState === WebSocket.CLOSED) tbConnect();
        }, 3000);
    };
    ws.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            _tbHandleMessage(data);
            // Call tool-specific hook if defined
            if (typeof onMessage === 'function') onMessage(data);
        } catch (err) {
            console.error('WS parse error:', err);
        }
    };
}

function wsSend(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
    }
}

// --- Tabs ----------------------------------------------------------------

function initTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const target = document.getElementById(tab.dataset.tab);
            if (target) target.classList.add('active');
        });
    });
}

// --- Toast ---------------------------------------------------------------

function showToast(msg, type) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = 'toast show ' + (type || '');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// --- Settings modal ------------------------------------------------------

function openSettings() {
    const m = document.getElementById('settingsModal');
    if (m) m.classList.add('show');
    if (typeof onSettingsOpen === 'function') onSettingsOpen();
}

function closeSettings() {
    const m = document.getElementById('settingsModal');
    if (m) m.classList.remove('show');
}

function _initSettingsModal() {
    const overlay = document.getElementById('settingsModal');
    if (overlay) {
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSettings(); });
    }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });
}

// --- Utilities -----------------------------------------------------------

function formatUptime(s) {
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

function formatTimestamp(ts) {
    // Device timestamps are in millis() uptime, not Unix epoch
    if (ts === undefined || ts === null) {
        return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    if (ts < 1000000000000) {
        const total = Math.floor(ts / 1000);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }
    return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// --- Status poll ---------------------------------------------------------

function _startStatusPoll() {
    setInterval(() => {
        wsSend({ cmd: 'status' });
    }, _statusPollInterval);
}

// --- Toggle helper -------------------------------------------------------

function toggleSwitch(id, callback) {
    const el = document.getElementById(id);
    if (!el) return;
    const active = el.classList.toggle('active');
    if (typeof callback === 'function') callback(active);
}

// --- Escape helpers -----------------------------------------------------

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Download helper -----------------------------------------------------

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// --- Shared message handling ---------------------------------------------

function _tbHandleMessage(data) {
    if (data.type === 'settings') {
        _tbPopulateWifiSettings(data);
    } else if (data.type === 'wifiscan') {
        _tbRenderScanResults(data.networks);
    } else if (data.type === 'status') {
        _tbPopulateDeviceInfo(data);
    }
}

// --- WiFi settings -------------------------------------------------------

function _tbPopulateWifiSettings(data) {
    const el = (id) => document.getElementById(id);
    if (el('wifiMode'))    el('wifiMode').value = data.wifiMode ?? 0;
    if (el('wifiApSSID'))  el('wifiApSSID').value = data.ssid || '';
    if (el('wifiApPass'))  el('wifiApPass').value = '';
    if (el('wifiStaSSID')) el('wifiStaSSID').value = data.staSSID || '';
    if (el('wifiStaPass')) el('wifiStaPass').value = '';
    if (el('wifiMdns'))    el('wifiMdns').value = data.mdnsHost || '';
    tbUpdateWifiModeUI();
}

function _tbPopulateDeviceInfo(data) {
    const el = (id) => document.getElementById(id);
    if (data.mac && el('deviceMac'))   el('deviceMac').textContent = data.mac;
    if (data.heap && el('freeHeap'))   el('freeHeap').textContent = data.heap + ' bytes';
    // Show best available IP
    const ip = data.staIP || data.apIP || '';
    if (ip && el('deviceIp')) el('deviceIp').textContent = ip;
}

function tbUpdateWifiModeUI() {
    const mode = parseInt(document.getElementById('wifiMode').value);
    const apCard = document.getElementById('apCard');
    const staCard = document.getElementById('staCard');
    const desc = document.getElementById('wifiModeDesc');

    if (apCard) apCard.style.display = (mode === 2) ? 'none' : '';
    if (staCard) staCard.style.display = (mode === 0) ? 'none' : '';

    if (desc) {
        if (mode === 0) desc.textContent = 'Device creates its own WiFi network.';
        else if (mode === 1) desc.textContent = 'Creates AP and connects to existing WiFi. AP turns off when connected.';
        else desc.textContent = 'Connects to existing WiFi only. Falls back to AP if connection fails.';
    }

    // Update mDNS preview
    const mdnsInput = document.getElementById('wifiMdns');
    const preview = document.getElementById('mdnsPreview');
    if (mdnsInput && preview) preview.textContent = mdnsInput.value || 'hostname';
}

function tbScanWifi() {
    const btn = document.getElementById('scanBtn');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    document.getElementById('scanResults').style.display = 'none';
    wsSend({ cmd: 'wifiscan' });
    setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = 'Scan'; } }, 10000);
}

function _tbRenderScanResults(networks) {
    const btn = document.getElementById('scanBtn');
    if (btn) { btn.disabled = false; btn.textContent = 'Scan'; }
    const el = document.getElementById('scanResults');
    if (!el) return;

    if (!networks || networks.length === 0) {
        el.innerHTML = '<div style="font-size:0.8rem;color:var(--text-muted);padding:8px;">No networks found</div>';
        el.style.display = 'block';
        return;
    }
    // Sort by signal strength, deduplicate
    networks.sort((a, b) => b.rssi - a.rssi);
    const seen = new Set();
    const unique = networks.filter(n => {
        if (!n.ssid || seen.has(n.ssid)) return false;
        seen.add(n.ssid);
        return true;
    });
    el.innerHTML = unique.map(n => {
        const bars = n.rssi > -50 ? '\u2582\u2584\u2586\u2588' : n.rssi > -65 ? '\u2582\u2584\u2586' : n.rssi > -75 ? '\u2582\u2584' : '\u2582';
        const lock = n.enc ? ' \uD83D\uDD12' : '';
        return '<div class="scan-item" onclick="tbSelectNetwork(\'' + escapeHtml(n.ssid).replace(/'/g, "\\'") + '\')">' +
            '<span>' + escapeHtml(n.ssid) + lock + '</span>' +
            '<span style="color:var(--text-muted);font-size:0.75rem;">' + bars + ' ' + n.rssi + 'dBm</span></div>';
    }).join('');
    el.style.display = 'block';
}

function tbSelectNetwork(ssid) {
    document.getElementById('wifiStaSSID').value = ssid;
    document.getElementById('scanResults').style.display = 'none';
    document.getElementById('wifiStaPass').focus();
}

function tbSaveWifi() {
    const mode = parseInt(document.getElementById('wifiMode').value);
    const ssid = document.getElementById('wifiApSSID').value.trim();
    const pass = document.getElementById('wifiApPass').value;
    const staSSID = document.getElementById('wifiStaSSID').value.trim();
    const staPass = document.getElementById('wifiStaPass').value;
    const mdns = document.getElementById('wifiMdns').value.trim();

    if (mdns.length > 0 && !/^[a-zA-Z0-9-]{1,63}$/.test(mdns)) {
        showToast('mDNS name: use only a-z, 0-9, and -', 'error');
        return;
    }
    // Validate AP settings if AP is enabled
    if (mode !== 2) {
        if (ssid.length < 1 || ssid.length > 32) { showToast('AP SSID must be 1-32 chars', 'error'); return; }
        if (pass.length > 0 && pass.length < 8) { showToast('AP password must be 8+ chars', 'error'); return; }
    }
    // Validate STA settings if client is enabled
    if (mode !== 0) {
        if (staSSID.length < 1) { showToast('Enter a WiFi network name', 'error'); return; }
    }

    wsSend({
        cmd: 'savewifi',
        ssid: ssid,
        pass: pass,
        wifiMode: mode,
        staSSID: staSSID,
        staPass: staPass,
        mdnsHost: mdns
    });
    showToast('Settings saved! Restarting...', 'success');
    setTimeout(() => location.reload(), 5000);
}

// --- Boot ----------------------------------------------------------------

function tbInit() {
    initTabs();
    _initSettingsModal();
    _initWifiListeners();
    tbConnect();
    _startStatusPoll();
}

function _initWifiListeners() {
    const mdnsInput = document.getElementById('wifiMdns');
    if (mdnsInput) {
        mdnsInput.addEventListener('input', () => {
            const preview = document.getElementById('mdnsPreview');
            if (preview) preview.textContent = mdnsInput.value || 'hostname';
        });
    }
}

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tbInit);
} else {
    tbInit();
}
