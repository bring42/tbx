const log = document.getElementById('log');
let logEntries = [];
let appendCrlf = true;
let localEcho = true;
let termHistory = [];
let termHistoryIdx = -1;
let termCurrentInput = '';

function onConnected() {
    wsSend({ cmd: 'status' });
    wsSend({ cmd: 'settings' });
    wsSend({ cmd: 'getHistory' });
}

function onSettingsOpen() {
    wsSend({ cmd: 'settings' });
}

function onMessage(data) {
    if (data.type === 'status') {
        renderStatus(data);
    } else if (data.type === 'settings') {
        populateToolSettings(data);
    } else if (data.type === 'rx') {
        const entry = normalizeEntry({ ...data, dir: 'RX' });
        addLogEntry(entry);
        updateTrafficStats(data, true);
        terminalAppend('[' + entry.port + '] ' + decodeDisplayText(entry.ascii) + '\n', 'rx-line');
    } else if (data.type === 'sent') {
        const entry = normalizeEntry({ ...data, dir: 'TX' });
        addLogEntry(entry);
        updateTrafficStats(data, false);
    } else if (data.type === 'history') {
        loadHistory(data);
    } else if (data.type === 'serialConfig') {
        document.getElementById('serialConfigValue').textContent = data.baud + ' ' + data.config;
        populateToolSettings(data);
        showToast('Serial configured: ' + data.baud + ' ' + data.config, 'success');
    } else if (data.type === 'passthroughConfig') {
        updatePassthroughBadge(data.mode || 'off');
        document.getElementById('passthroughModeSelect').value = data.mode || 'off';
        showToast('Passthrough updated: ' + (data.mode || 'off'), 'success');
    } else if (data.type === 'cleared') {
        clearLog();
        document.getElementById('rxBytes').textContent = '0';
        document.getElementById('txBytes').textContent = '0';
        setPortValue('A', 'Rx', 0);
        setPortValue('A', 'Tx', 0);
        setPortValue('B', 'Rx', 0);
        setPortValue('B', 'Tx', 0);
        termClear('--- Cleared ---\n');
    } else if (data.type === 'error') {
        showToast(data.msg || 'Error', 'error');
    }
}

function normalizeEntry(data) {
    const port = (data.port || 'A').toUpperCase();
    const dir = data.dir || (data.rx ? 'RX' : 'TX');
    return {
        port,
        dir,
        ts: data.ts,
        len: data.len || 0,
        hex: data.hex || '',
        ascii: data.ascii || '',
        forwardedTo: data.forwardedTo || '',
        timeStr: data.timeStr || formatTimestamp(data.ts)
    };
}

function renderStatus(data) {
    document.getElementById('rxBytes').textContent = data.rxBytes || 0;
    document.getElementById('txBytes').textContent = data.txBytes || 0;
    document.getElementById('uptime').textContent = formatUptime(data.uptime || 0);
    document.getElementById('serialConfigValue').textContent = (data.baud || 9600) + ' ' + (data.config || '8N1');
    updatePassthroughBadge(data.passthroughMode || 'off');
    (data.ports || []).forEach(port => {
        document.getElementById('port' + port.id + 'Pins').textContent = 'RX GPIO' + port.rxPin + ' · TX GPIO' + port.txPin;
        setPortValue(port.id, 'Rx', port.rxBytes || 0);
        setPortValue(port.id, 'Tx', port.txBytes || 0);
    });
}

function populateToolSettings(data) {
    if (data.baud) document.getElementById('baudSelect').value = data.baud;
    if (data.databits) document.getElementById('databitsSelect').value = data.databits;
    if (data.parity) document.getElementById('paritySelect').value = data.parity;
    if (data.stopbits) document.getElementById('stopbitsSelect').value = data.stopbits;
    if (data.passthroughMode) document.getElementById('passthroughModeSelect').value = data.passthroughMode;
}

function updatePassthroughBadge(mode) {
    document.getElementById('passthroughBadge').textContent = 'Passthrough: ' + mode;
}

function setPortValue(port, kind, value) {
    const el = document.getElementById('port' + port + kind);
    if (el) el.textContent = value;
}

function updateTrafficStats(data, isRx) {
    if (isRx) {
        document.getElementById('rxBytes').textContent = data.total || 0;
        if (data.port) setPortValue(data.port, 'Rx', data.portRxBytes || 0);
        if (data.forwardedTo) setPortValue(data.forwardedTo, 'Tx', data.peerTxBytes || 0);
    } else {
        document.getElementById('txBytes').textContent = data.total || 0;
        if (data.port) setPortValue(data.port, 'Tx', data.portTxBytes || 0);
    }
}

function addLogEntry(data, prepend = true) {
    const entryData = normalizeEntry(data);
    if (logEntries.length === 0) log.innerHTML = '';

    if (prepend) {
        logEntries.unshift(entryData);
        if (logEntries.length > 200) logEntries.pop();
    } else {
        logEntries.push(entryData);
    }
    refreshLogDisplay();
}

function entryMatchesFilter(entry) {
    const filter = document.getElementById('monitorFilter').value;
    return filter === 'all' || entry.port === filter;
}

function renderLogEntry(entry) {
    const showTime = document.getElementById('showTimestamp').checked;
    const showDir = document.getElementById('showDirection').checked;
    const showPort = document.getElementById('showPort').checked;
    const showCtrl = document.getElementById('showControlChars').checked;
    const mode = document.getElementById('displayMode').value;
    let ascii = entry.ascii || '';
    if (!showCtrl) ascii = ascii.replace(/\\r/g, '').replace(/\\n/g, '').replace(/\\t/g, '');

    const parts = [];
    if (showTime) parts.push('<span class="log-time">' + entry.timeStr + '</span>');
    if (showPort) parts.push('<span class="port-badge port-' + entry.port.toLowerCase() + '">' + entry.port + '</span>');
    if (showDir) parts.push('<span class="log-dir ' + entry.dir.toLowerCase() + '">' + entry.dir + '</span>');
    if (entry.forwardedTo) parts.push('<span class="forward-badge">→ ' + entry.forwardedTo + '</span>');
    if (mode === 'both' || mode === 'hex') parts.push('<span class="log-hex">' + escapeHtml(entry.hex || '') + '</span>');
    if (mode === 'both') parts.push('<span class="log-ascii">[' + escapeHtml(ascii) + ']</span>');
    else if (mode === 'ascii') parts.push('<span class="log-ascii">' + escapeHtml(ascii) + '</span>');
    return '<div class="log-entry"><div class="log-line">' + parts.join(' ') + '</div></div>';
}

function loadHistory(data) {
    logEntries = [];
    if (!data.items || data.items.length === 0) {
        clearLog();
        return;
    }
    data.items.forEach(item => logEntries.push(normalizeEntry(item)));
    refreshLogDisplay();
}

function clearLog() {
    logEntries = [];
    log.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 40px 0;">Waiting for traffic...</div>';
}

function refreshLogDisplay() {
    const filtered = logEntries.filter(entryMatchesFilter);
    if (filtered.length === 0) {
        log.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 40px 0;">Waiting for traffic...</div>';
        return;
    }
    log.innerHTML = filtered.map(renderLogEntry).join('');
}

function clearHistory() {
    if (confirm('Clear captured history and counters on the device?')) {
        wsSend({ cmd: 'clearHistory' });
    }
}

function decodeDisplayText(text) {
    return String(text || '').replace(/\\r/g, '\r').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

function downloadLog() {
    if (logEntries.length === 0) {
        showToast('No data to download', 'error');
        return;
    }
    const fmt = document.getElementById('exportFormat').value;
    const incTime = document.getElementById('exportTimestamp').checked;
    const incDir = document.getElementById('exportDirection').checked;
    const incPort = document.getElementById('exportPort').checked;
    const incCtrl = document.getElementById('exportControlChars').checked;

    let text = 'Dual UART Serial Log - ' + new Date().toISOString() + '\n';
    text += '='.repeat(60) + '\n\n';

    logEntries.forEach(entry => {
        let ascii = entry.ascii || '';
        if (!incCtrl) ascii = ascii.replace(/\\r/g, '').replace(/\\n/g, '').replace(/\\t/g, '');
        const line = [];
        if (incTime) line.push('[' + entry.timeStr + ']');
        if (incPort) line.push(entry.port);
        if (incDir) line.push(entry.dir);
        if (entry.forwardedTo) line.push('→ ' + entry.forwardedTo);
        if (fmt === 'hex') line.push(entry.hex || '');
        else if (fmt === 'ascii') line.push(ascii);
        else line.push('HEX: ' + (entry.hex || '') + ' ASCII: ' + ascii);
        text += line.join(' ') + '\n';
    });

    const blob = new Blob([text], { type: 'text/plain' });
    downloadBlob(blob, 'dual_uart_log_' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt');
    showToast('Log downloaded', 'success');
}

function selectedPort(selectId) {
    return document.getElementById(selectId).value || 'A';
}

function processEscapes(text) {
    return text
        .replace(/\\r/g, '\r')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\x([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function toggleCRLF() {
    toggleSwitch('crlfToggle', (active) => { appendCrlf = active; });
}

function sendAscii() {
    const data = document.getElementById('asciiData').value;
    if (!data) { showToast('Enter text to send', 'error'); return; }
    wsSend({ cmd: 'sendAscii', port: selectedPort('asciiPortSelect'), data: processEscapes(data), crlf: appendCrlf });
}

function sendQuickAscii(text) {
    wsSend({ cmd: 'sendAscii', port: selectedPort('asciiPortSelect'), data: processEscapes(text), crlf: appendCrlf });
}

function sendHex() {
    const data = document.getElementById('hexData').value.trim();
    if (!data) { showToast('Enter hex bytes to send', 'error'); return; }
    if (!/^[0-9a-fA-F\s,]+$/.test(data)) { showToast('Invalid hex format', 'error'); return; }
    wsSend({ cmd: 'sendHex', port: selectedPort('hexPortSelect'), data });
}

function sendQuickHex(hex) {
    wsSend({ cmd: 'sendHex', port: selectedPort('hexPortSelect'), data: hex });
}

function toggleLocalEcho() {
    toggleSwitch('localEchoToggle', (active) => { localEcho = active; });
}

function toggleTermCrlf() {
    toggleSwitch('termCrlfToggle', (active) => {
        document.getElementById('termLineEnding').value = active ? 'crlf' : 'none';
    });
}

function getLineEnding() {
    const sel = document.getElementById('termLineEnding').value;
    switch (sel) {
        case 'crlf': return '\r\n';
        case 'cr': return '\r';
        case 'lf': return '\n';
        default: return '';
    }
}

function terminalAppend(text, className) {
    const output = document.getElementById('termOutput');
    const span = document.createElement('span');
    span.className = className || 'rx-line';
    span.textContent = text;
    output.appendChild(span);
    output.scrollTop = output.scrollHeight;
}

function termSend(text) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast('Not connected', 'error');
        return;
    }

    const fullText = text + getLineEnding();
    if (localEcho) terminalAppend('[' + selectedPort('termPortSelect') + '] ' + text + '\n', 'tx-line');
    if (text && (termHistory.length === 0 || termHistory[termHistory.length - 1] !== text)) {
        termHistory.push(text);
        if (termHistory.length > 50) termHistory.shift();
    }
    termHistoryIdx = -1;

    wsSend({ cmd: 'sendAscii', port: selectedPort('termPortSelect'), data: fullText, crlf: false });
}

function termSendQuick(text) {
    const input = document.getElementById('termInput');
    input.value = text;
    termSend(text);
    input.value = '';
    input.focus();
}

function termClear(message) {
    document.getElementById('termOutput').innerHTML = '<span class="sys-line">' + (message || '--- Cleared ---\n') + '</span>';
}

document.getElementById('termInput').addEventListener('keydown', (e) => {
    const input = e.target;
    if (e.key === 'Enter') {
        termSend(input.value);
        input.value = '';
        e.preventDefault();
    } else if (e.key === 'ArrowUp') {
        if (termHistory.length > 0) {
            if (termHistoryIdx === -1) {
                termCurrentInput = input.value;
                termHistoryIdx = termHistory.length - 1;
            } else if (termHistoryIdx > 0) {
                termHistoryIdx--;
            }
            input.value = termHistory[termHistoryIdx];
            setTimeout(() => input.selectionStart = input.selectionEnd = input.value.length, 0);
        }
        e.preventDefault();
    } else if (e.key === 'ArrowDown') {
        if (termHistoryIdx !== -1) {
            if (termHistoryIdx < termHistory.length - 1) {
                termHistoryIdx++;
                input.value = termHistory[termHistoryIdx];
            } else {
                termHistoryIdx = -1;
                input.value = termCurrentInput;
            }
            setTimeout(() => input.selectionStart = input.selectionEnd = input.value.length, 0);
        }
        e.preventDefault();
    }
});

document.getElementById('termLineEnding').addEventListener('change', (e) => {
    document.getElementById('termCrlfToggle').classList.toggle('active', e.target.value !== 'none');
});

function saveSerialConfig() {
    wsSend({
        cmd: 'setSerial',
        baud: parseInt(document.getElementById('baudSelect').value, 10),
        databits: parseInt(document.getElementById('databitsSelect').value, 10),
        parity: document.getElementById('paritySelect').value,
        stopbits: parseInt(document.getElementById('stopbitsSelect').value, 10)
    });
}

function savePassthroughMode() {
    wsSend({
        cmd: 'setPassthrough',
        mode: document.getElementById('passthroughModeSelect').value
    });
}
