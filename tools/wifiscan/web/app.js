/* ============================================================
   WiFi Scanner Tool — App JS
   Tool-specific WebSocket handlers, UI logic
   ============================================================ */

let networks = [];
let scanInterval = 10;

// --- SVG icons -----------------------------------------------------------

const LOCK_SVG = '<svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z"/></svg>';
const OPEN_SVG = '<svg viewBox="0 0 24 24"><path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z"/></svg>';

// --- base.js hooks -------------------------------------------------------

function onConnected() {
    wsSend({ cmd: 'status' });
    wsSend({ cmd: 'settings' });
    wsSend({ cmd: 'scan' });
}

function onSettingsOpen() {
    wsSend({ cmd: 'settings' });
}

function onMessage(data) {
    if (data.type === 'status') {
        document.getElementById('uptime').textContent = formatUptime(data.uptime);
        document.getElementById('freeHeap').textContent = (data.heap || 0) + ' bytes';
        document.getElementById('deviceMac').textContent = data.mac || '-';
        if (data.scanning) {
            document.getElementById('scanBtn').disabled = true;
            document.getElementById('scanBtn').textContent = 'Scanning...';
        } else {
            document.getElementById('scanBtn').disabled = false;
            document.getElementById('scanBtn').textContent = 'Scan Now';
        }
    } else if (data.type === 'scan') {
        networks = data.networks || [];
        document.getElementById('networkCount').textContent = data.count || networks.length;
        document.getElementById('lastScanTime').textContent = new Date().toLocaleTimeString('en-GB', {
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        document.getElementById('scanBtn').disabled = false;
        document.getElementById('scanBtn').textContent = 'Scan Now';
        renderNetworks();
    } else if (data.type === 'settings') {
        document.getElementById('ssid').value = data.ssid || '';
        document.getElementById('pass').value = '';
        scanInterval = data.interval || 10;
        document.getElementById('scanInterval').value = scanInterval;
    } else if (data.type === 'error') {
        showToast(data.msg || 'Error', 'error');
        document.getElementById('scanBtn').disabled = false;
        document.getElementById('scanBtn').textContent = 'Scan Now';
    }
}

// --- Signal helpers ------------------------------------------------------

function rssiToBars(rssi) {
    if (rssi > -50) return 4;
    if (rssi > -60) return 3;
    if (rssi > -70) return 2;
    if (rssi > -80) return 1;
    return 0;
}

function renderSignalBars(bars) {
    let html = '<div class="network-signal signal-bars-' + bars + '">';
    for (let i = 1; i <= 4; i++) {
        html += '<div class="signal-bar' + (i <= bars ? ' filled' : '') + '"></div>';
    }
    html += '</div>';
    return html;
}

// --- Render networks -----------------------------------------------------

function renderNetworks() {
    const container = document.getElementById('networkList');

    if (networks.length === 0) {
        container.innerHTML = '<div class="card" style="text-align:center;color:var(--text-muted);padding:40px 16px;">No networks found</div>';
        return;
    }

    let html = '';
    networks.forEach(net => {
        const bars = rssiToBars(net.rssi);
        const ssid = net.ssid ? escapeHtml(net.ssid) : '';
        const isHidden = !net.ssid || net.ssid.length === 0;
        const isOpen = net.encryption === 'Open';
        const secIcon = isOpen
            ? '<span class="open-icon">' + OPEN_SVG + '</span>'
            : '<span class="lock-icon">' + LOCK_SVG + '</span>';

        html += '<div class="network-card">';
        html += renderSignalBars(bars);
        html += '<div class="network-info">';
        html += '<div class="network-ssid' + (isHidden ? ' hidden-ssid' : '') + '">' + (isHidden ? '[Hidden]' : ssid) + '</div>';
        html += '<div class="network-details">';
        html += '<span class="network-detail">' + secIcon + ' ' + escapeHtml(net.encryption) + '</span>';
        html += '<span class="network-detail">Ch ' + net.channel + '</span>';
        html += '<span class="network-detail">' + escapeHtml(net.bssid) + '</span>';
        html += '</div>';
        html += '</div>';
        html += '<div class="network-rssi">' + net.rssi + ' dBm</div>';
        html += '</div>';
    });

    container.innerHTML = html;
}

// --- Actions -------------------------------------------------------------

function triggerScan() {
    document.getElementById('scanBtn').disabled = true;
    document.getElementById('scanBtn').textContent = 'Scanning...';
    wsSend({ cmd: 'scan' });
}

function saveSettings() {
    const interval = parseInt(document.getElementById('scanInterval').value);
    if (isNaN(interval) || interval < 5 || interval > 300) {
        showToast('Interval must be 5-300 seconds', 'error');
        return;
    }
    wsSend({ cmd: 'savesettings', interval: interval });
    showToast('Settings saved', 'success');
}

function saveWifi() {
    const ssid = document.getElementById('ssid').value.trim();
    const pass = document.getElementById('pass').value;
    if (ssid.length < 1 || ssid.length > 32) { showToast('SSID must be 1-32 chars', 'error'); return; }
    if (pass.length > 0 && pass.length < 8) { showToast('Password must be 8+ chars or empty', 'error'); return; }
    wsSend({ cmd: 'savewifi', ssid: ssid, pass: pass });
    showToast('Settings saved! Restarting...', 'success');
    setTimeout(() => location.reload(), 3000);
}
