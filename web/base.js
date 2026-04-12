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
            // Tool-specific handler (must be defined by each tool)
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

// --- Boot ----------------------------------------------------------------

function tbInit() {
    initTabs();
    _initSettingsModal();
    tbConnect();
    _startStatusPoll();
}

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tbInit);
} else {
    tbInit();
}
