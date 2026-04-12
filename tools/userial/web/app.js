/* ============================================================
   RS-232 Serial Tool — App JS
   Tool-specific WebSocket handlers, UI logic
   ============================================================ */

const log = document.getElementById('log');
let logEntries = [];
let appendCrlf = true;
let localEcho = true;
let termAddCrlf = true;
let termHistory = [];
let termHistoryIdx = -1;
let termCurrentInput = '';

// --- base.js hooks -------------------------------------------------------

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
        document.getElementById('rxBytes').textContent = data.rxBytes || 0;
        document.getElementById('txBytes').textContent = data.txBytes || 0;
        document.getElementById('uptime').textContent = formatUptime(data.uptime);
        document.getElementById('baudRate').textContent = data.baud || 9600;
    } else if (data.type === 'rx') {
        addLogEntry({ ...data, dir: 'RX' });
        document.getElementById('rxBytes').textContent = data.total || 0;
        terminalAppend(data.ascii || '', 'rx-line');
    } else if (data.type === 'sent') {
        addLogEntry({ ...data, dir: 'TX' });
        document.getElementById('txBytes').textContent = data.total || 0;
        // Terminal TX shown via local echo, skip here
    } else if (data.type === 'history') {
        loadHistory(data);
    } else if (data.type === 'settings') {
        document.getElementById('baudSelect').value = data.baud || 9600;
        document.getElementById('databitsSelect').value = data.databits || 8;
        document.getElementById('paritySelect').value = data.parity || 'N';
        document.getElementById('stopbitsSelect').value = data.stopbits || 1;
    } else if (data.type === 'serialConfig') {
        document.getElementById('baudRate').textContent = data.baud;
        showToast('Serial configured: ' + data.baud + ' ' + data.config, 'success');
    } else if (data.type === 'cleared') {
        log.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 40px 0;">Waiting for data...</div>';
        logEntries = [];
        document.getElementById('rxBytes').textContent = '0';
        document.getElementById('txBytes').textContent = '0';
    } else if (data.type === 'error') {
        showToast(data.msg || 'Error', 'error');
    }
}

// --- Log -----------------------------------------------------------------

function addLogEntry(data, prepend) {
    if (prepend === undefined) prepend = true;
    if (logEntries.length === 0) log.innerHTML = '';

    const time = data.timeStr || formatTimestamp(data.ts);
    const isRx = data.dir === 'RX';
    const showTime = document.getElementById('showTimestamp').checked;
    const showDir = document.getElementById('showDirection').checked;
    const showCtrl = document.getElementById('showControlChars').checked;
    const mode = document.getElementById('displayMode').value;

    let ascii = data.ascii || '';
    if (!showCtrl) ascii = ascii.replace(/\\r/g, '').replace(/\\n/g, '').replace(/\\t/g, '');

    let html = '';
    if (showTime) html += '<span class="log-time">' + time + '</span>';
    if (showDir) html += '<span class="log-dir ' + (isRx ? 'rx' : 'tx') + '">' + data.dir + '</span> ';
    if (mode === 'both' || mode === 'hex') {
        html += '<span class="log-hex">' + (data.hex || '') + '</span>';
    }
    if (mode === 'both') {
        html += ' <span class="log-ascii">[' + ascii + ']</span>';
    } else if (mode === 'ascii') {
        html += '<span class="log-ascii">' + ascii + '</span>';
    }

    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = html;

    if (prepend) {
        log.insertBefore(entry, log.firstChild);
        logEntries.unshift(data);
        if (logEntries.length > 200) {
            logEntries.pop();
            if (log.lastChild) log.removeChild(log.lastChild);
        }
    } else {
        log.appendChild(entry);
        logEntries.push(data);
    }
}

function loadHistory(data) {
    logEntries = [];
    log.innerHTML = '';
    if (!data.items || data.items.length === 0) {
        log.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 40px 0;">Waiting for data...</div>';
        return;
    }
    data.items.forEach(item => {
        item.dir = item.rx ? 'RX' : 'TX';
        item.timeStr = formatTimestamp(item.ts);
        addLogEntry(item, false);
    });
}

function clearLog() {
    logEntries = [];
    log.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 40px 0;">Waiting for data...</div>';
}

function refreshLogDisplay() {
    const entries = [...logEntries];
    logEntries = [];
    log.innerHTML = '';
    if (entries.length === 0) {
        log.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 40px 0;">Waiting for data...</div>';
    } else {
        entries.forEach(e => addLogEntry(e, false));
    }
}

function clearHistory() {
    if (confirm('Clear all history and statistics?')) {
        wsSend({ cmd: 'clearHistory' });
    }
}

// --- Download / Export ---------------------------------------------------

function downloadLog() {
    if (logEntries.length === 0) {
        showToast('No data to download', 'error');
        return;
    }
    const fmt = document.getElementById('exportFormat').value;
    const incTime = document.getElementById('exportTimestamp').checked;
    const incDir = document.getElementById('exportDirection').checked;
    const incCtrl = document.getElementById('exportControlChars').checked;

    let text = 'RS-232 Serial Log - ' + new Date().toISOString() + '\n';
    text += '='.repeat(60) + '\n\n';

    logEntries.forEach(entry => {
        const time = entry.timeStr || formatTimestamp(entry.ts);
        const dir = entry.dir || (entry.rx ? 'RX' : 'TX');
        let ascii = entry.ascii || '';
        if (!incCtrl) ascii = ascii.replace(/\\r/g, '').replace(/\\n/g, '').replace(/\\t/g, '');
        let line = '';
        if (incTime) line += '[' + time + '] ';
        if (incDir) line += dir + ' ';
        if (fmt === 'hex') {
            line += (entry.hex || '');
        } else if (fmt === 'ascii') {
            line += ascii;
        } else {
            line += 'HEX: ' + (entry.hex || '') + ' ASCII: ' + ascii;
        }
        text += line + '\n';
    });

    const blob = new Blob([text], { type: 'text/plain' });
    downloadBlob(blob, 'serial_log_' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt');
    showToast('Log downloaded', 'success');
}

// --- Send ----------------------------------------------------------------

function toggleCRLF() {
    toggleSwitch('crlfToggle', (active) => { appendCrlf = active; });
}

function sendAscii() {
    const data = document.getElementById('asciiData').value;
    if (!data) { showToast('Enter text to send', 'error'); return; }
    wsSend({ cmd: 'sendAscii', data: data, crlf: appendCrlf });
}

function sendQuickAscii(text) {
    const processed = text
        .replace(/\\r/g, '\r')
        .replace(/\\n/g, '\n')
        .replace(/\\x([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
    wsSend({ cmd: 'sendAscii', data: processed, crlf: false });
}

function sendHex() {
    const data = document.getElementById('hexData').value.trim();
    if (!data) { showToast('Enter hex bytes to send', 'error'); return; }
    if (!/^[0-9a-fA-F\s,]+$/.test(data)) { showToast('Invalid hex format', 'error'); return; }
    wsSend({ cmd: 'sendHex', data: data });
}

function sendQuickHex(hex) {
    wsSend({ cmd: 'sendHex', data: hex });
}

// --- Terminal ------------------------------------------------------------

function toggleLocalEcho() {
    toggleSwitch('localEchoToggle', (active) => { localEcho = active; });
}

function toggleTermCrlf() {
    toggleSwitch('termCrlfToggle', (active) => {
        termAddCrlf = active;
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
    // Clean control chars for display, keep newlines
    span.textContent = text.replace(/\r/g, '').replace(/\\r/g, '');
    output.appendChild(span);
    output.scrollTop = output.scrollHeight;
}

function termSend(text) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast('Not connected', 'error');
        return;
    }
    const lineEnding = getLineEnding();
    const fullText = text + lineEnding;

    // Local echo
    if (localEcho) {
        terminalAppend(text + '\n', 'tx-line');
    }

    // Command history
    if (text && (termHistory.length === 0 || termHistory[termHistory.length - 1] !== text)) {
        termHistory.push(text);
        if (termHistory.length > 50) termHistory.shift();
    }
    termHistoryIdx = -1;

    wsSend({ cmd: 'sendAscii', data: fullText, crlf: false });
}

function termSendQuick(text) {
    const input = document.getElementById('termInput');
    input.value = text;
    termSend(text);
    input.value = '';
    input.focus();
}

function termClear() {
    document.getElementById('termOutput').innerHTML = '<span class="sys-line">--- Cleared ---\n</span>';
}

// --- Terminal input key handling -----------------------------------------

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
    termAddCrlf = e.target.value !== 'none';
    document.getElementById('termCrlfToggle').classList.toggle('active', termAddCrlf);
});

// --- Settings ------------------------------------------------------------

function saveSerialConfig() {
    wsSend({
        cmd: 'setSerial',
        baud: parseInt(document.getElementById('baudSelect').value),
        databits: parseInt(document.getElementById('databitsSelect').value),
        parity: document.getElementById('paritySelect').value,
        stopbits: parseInt(document.getElementById('stopbitsSelect').value)
    });
}


