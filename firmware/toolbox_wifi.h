#ifndef TOOLBOX_WIFI_H
#define TOOLBOX_WIFI_H

/*
 * Toolbox Base — WiFi Manager
 * Shared WiFi AP/STA setup, mDNS, Preferences storage
 *
 * Usage in your tool's main.cpp:
 *   #include "toolbox_wifi.h"
 *   // In setup():
 *   tbWifiBegin("MyTool", "password1");
 *   // In loop():
 *   tbWifiLoop();
 */

#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <Preferences.h>

// WiFi modes
#define TB_WIFI_AP_ONLY   0
#define TB_WIFI_AP_STA    1
#define TB_WIFI_STA_ONLY  2

// Internal state — exposed for read access in tool code
struct TbWifiState {
    String apSSID;
    String apPass;
    String mdnsHost;
    bool   mdnsActive;
    int    wifiMode;
    String staSSID;
    String staPass;
    bool   staConnected;
    bool   apEnabled;
    unsigned long staLastAttempt;
    Preferences preferences;
};

static TbWifiState _tbw;

// ---- Helpers ----

static String _tbSanitizeMdnsHost(const String& raw, const char* fallback) {
    String host;
    host.reserve(63);
    for (size_t i = 0; i < raw.length(); i++) {
        char c = raw[i];
        if (isalnum((unsigned char)c) || c == '-') {
            host += (char)tolower((unsigned char)c);
            if (host.length() >= 63) break;
        }
    }
    while (host.length() > 0 && host[0] == '-') host.remove(0, 1);
    while (host.length() > 0 && host[host.length() - 1] == '-') host.remove(host.length() - 1);
    if (host.length() == 0) host = fallback;
    return host;
}

static bool _tbStartAP() {
    bool ok;
    if (_tbw.apPass.length() >= 8) {
        ok = WiFi.softAP(_tbw.apSSID.c_str(), _tbw.apPass.c_str(), 1, 0, 4);
    } else {
        ok = WiFi.softAP(_tbw.apSSID.c_str(), NULL, 1, 0, 4);
    }
    _tbw.apEnabled = ok;
    return ok;
}

static void _tbStartMdns() {
    _tbw.mdnsActive = false;
    MDNS.end();
    if (_tbw.mdnsHost.length() > 0 && MDNS.begin(_tbw.mdnsHost.c_str())) {
        MDNS.addService("http", "tcp", 80);
        _tbw.mdnsActive = true;
        Serial.printf("  mDNS: http://%s.local\n", _tbw.mdnsHost.c_str());
    }
}

// ---- Public API ----

/**
 * Initialize WiFi from saved preferences.
 *
 * @param defaultSSID  Default AP name if nothing saved
 * @param defaultPass  Default AP password if nothing saved
 * @param prefsNS      Preferences namespace (e.g. "serial", "mytool")
 * @param defaultMdns  Default mDNS hostname (empty string to disable)
 */
inline void tbWifiBegin(const char* defaultSSID, const char* defaultPass,
                        const char* prefsNS = "tool", const char* defaultMdns = "") {
    // Load saved settings
    _tbw.preferences.begin(prefsNS, true);
    _tbw.apSSID     = _tbw.preferences.getString("ssid", defaultSSID);
    _tbw.apPass     = _tbw.preferences.getString("pass", defaultPass);
    _tbw.wifiMode   = _tbw.preferences.getInt("wifimode", TB_WIFI_AP_ONLY);
    _tbw.staSSID    = _tbw.preferences.getString("sta_ssid", "");
    _tbw.staPass    = _tbw.preferences.getString("sta_pass", "");
    _tbw.mdnsHost   = _tbSanitizeMdnsHost(
        _tbw.preferences.getString("mdns", defaultMdns), defaultMdns);
    _tbw.preferences.end();

    _tbw.staConnected  = false;
    _tbw.apEnabled     = false;
    _tbw.staLastAttempt = 0;

    // Validate
    if (_tbw.wifiMode < 0 || _tbw.wifiMode > 2) _tbw.wifiMode = TB_WIFI_AP_ONLY;
    if ((_tbw.wifiMode == TB_WIFI_STA_ONLY || _tbw.wifiMode == TB_WIFI_AP_STA) &&
        _tbw.staSSID.length() == 0) {
        _tbw.wifiMode = TB_WIFI_AP_ONLY;
    }

    // Configure radio
    WiFi.setTxPower(WIFI_POWER_8_5dBm);
    if (_tbw.wifiMode == TB_WIFI_AP_ONLY) WiFi.mode(WIFI_AP);
    else if (_tbw.wifiMode == TB_WIFI_AP_STA) WiFi.mode(WIFI_AP_STA);
    else WiFi.mode(WIFI_STA);

    // Start AP if needed
    if (_tbw.wifiMode != TB_WIFI_STA_ONLY) {
        _tbStartAP();
    }

    // Connect STA if needed
    if (_tbw.wifiMode != TB_WIFI_AP_ONLY && _tbw.staSSID.length() > 0) {
        WiFi.begin(_tbw.staSSID.c_str(),
                   _tbw.staPass.length() > 0 ? _tbw.staPass.c_str() : NULL);
        Serial.printf("  Connecting to WiFi: %s", _tbw.staSSID.c_str());
        int attempts = 0;
        while (WiFi.status() != WL_CONNECTED && attempts < 20) {
            delay(500);
            Serial.print(".");
            attempts++;
        }
        Serial.println();
        if (WiFi.status() == WL_CONNECTED) {
            _tbw.staConnected = true;
            Serial.printf("  Connected! IP: %s\n", WiFi.localIP().toString().c_str());
        } else {
            Serial.println("  WiFi connect failed");
            if (_tbw.wifiMode == TB_WIFI_STA_ONLY) {
                Serial.println("  Starting AP as fallback...");
                WiFi.mode(WIFI_AP_STA);
                _tbStartAP();
            }
        }
        _tbw.staLastAttempt = millis();
    }

    // mDNS
    if (strlen(defaultMdns) > 0) {
        _tbStartMdns();
    }

    // Print info
    const char* modeStr[] = {"AP Only", "AP + Client", "Client Only"};
    Serial.printf("  WiFi Mode: %s\n", modeStr[_tbw.wifiMode]);
    if (_tbw.wifiMode != TB_WIFI_STA_ONLY || !_tbw.staConnected) {
        Serial.printf("  AP SSID: %s\n", _tbw.apSSID.c_str());
        Serial.printf("  AP IP:   http://%s\n", WiFi.softAPIP().toString().c_str());
    }
    if (_tbw.staConnected) {
        Serial.printf("  STA IP:  http://%s\n", WiFi.localIP().toString().c_str());
    }
}

/**
 * Call in loop() — handles STA reconnection.
 */
inline void tbWifiLoop() {
    if (_tbw.wifiMode == TB_WIFI_AP_ONLY || _tbw.staSSID.length() == 0) return;

    unsigned long now = millis();
    bool connected = (WiFi.status() == WL_CONNECTED);

    if (connected != _tbw.staConnected) {
        _tbw.staConnected = connected;
        if (connected) {
            Serial.printf("WiFi connected: %s\n", WiFi.localIP().toString().c_str());
        } else {
            Serial.println("WiFi disconnected");
            if (_tbw.wifiMode != TB_WIFI_AP_ONLY && !_tbw.apEnabled) {
                WiFi.mode(WIFI_AP_STA);
                _tbStartAP();
                Serial.println("AP restored as fallback");
            }
        }
    }

    // Retry every 30 seconds
    if (!connected && (now - _tbw.staLastAttempt) > 30000) {
        Serial.printf("Retrying WiFi: %s\n", _tbw.staSSID.c_str());
        WiFi.reconnect();
        _tbw.staLastAttempt = now;
    }
}

/**
 * Save WiFi settings and restart. Call from your WS handler for "savewifi" cmd.
 *
 * @param prefsNS   Preferences namespace (must match tbWifiBegin)
 * @param ssid      New AP SSID
 * @param pass      New AP password (empty = open)
 * @param wifiMode  WiFi mode (0/1/2), -1 to keep current
 * @param staSSID   STA SSID, NULL to keep current
 * @param staPass   STA password, NULL to keep current
 * @param mdnsHost  mDNS hostname, NULL to keep current
 */
inline void tbWifiSave(const char* prefsNS, const char* ssid, const char* pass,
                       int wifiMode = -1, const char* staSSID = NULL,
                       const char* staPass = NULL, const char* mdnsHost = NULL) {
    Preferences p;
    p.begin(prefsNS, false);
    if (ssid && strlen(ssid) > 0) p.putString("ssid", ssid);
    if (pass && strlen(pass) >= 8)  p.putString("pass", pass);
    else if (pass && strlen(pass) == 0) p.putString("pass", "");
    if (wifiMode >= 0 && wifiMode <= 2) p.putInt("wifimode", wifiMode);
    if (staSSID) p.putString("sta_ssid", staSSID);
    if (staPass && strlen(staPass) > 0) p.putString("sta_pass", staPass);
    if (mdnsHost) {
        String sanitized = _tbSanitizeMdnsHost(mdnsHost, "tool");
        p.putString("mdns", sanitized);
    }
    p.end();
    delay(500);
    ESP.restart();
}

// ---- Convenience accessors ----

inline const String& tbWifiAPSSID()    { return _tbw.apSSID; }
inline const String& tbWifiAPPass()    { return _tbw.apPass; }
inline const String& tbWifiMdnsHost()  { return _tbw.mdnsHost; }
inline bool   tbWifiMdnsActive()       { return _tbw.mdnsActive; }
inline int    tbWifiMode()             { return _tbw.wifiMode; }
inline bool   tbWifiSTAConnected()     { return _tbw.staConnected; }
inline const String& tbWifiSTASSID()   { return _tbw.staSSID; }

/**
 * Populate a JSON doc with WiFi status fields.
 * Call this from your "status" WS handler.
 */
template <typename TDoc>
inline void tbWifiStatusJson(TDoc& doc) {
    doc["mac"] = WiFi.softAPmacAddress();
    doc["wifiMode"] = _tbw.wifiMode;
    doc["mdnsHost"] = _tbw.mdnsHost;
    doc["mdnsActive"] = _tbw.mdnsActive;
    doc["staConnected"] = _tbw.staConnected;
    if (_tbw.staConnected) {
        doc["staIP"] = WiFi.localIP().toString();
        doc["staRSSI"] = WiFi.RSSI();
    }
    if (_tbw.apEnabled) {
        doc["apIP"] = WiFi.softAPIP().toString();
    }
}

/**
 * Populate a JSON doc with WiFi settings fields.
 * Call this from your "settings" WS handler.
 */
template <typename TDoc>
inline void tbWifiSettingsJson(TDoc& doc) {
    doc["ssid"] = _tbw.apSSID;
    doc["apHasPass"] = (_tbw.apPass.length() >= 8);
    doc["wifiMode"] = _tbw.wifiMode;
    doc["staSSID"] = _tbw.staSSID;
    doc["staHasPass"] = (_tbw.staPass.length() > 0);
    doc["mdnsHost"] = _tbw.mdnsHost;
}

#endif // TOOLBOX_WIFI_H
