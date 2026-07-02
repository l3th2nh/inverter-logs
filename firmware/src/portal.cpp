// ============================================================================
//  portal.cpp - Captive portal: chon WiFi + brand/model + MQTT, luu NVS
// ============================================================================
#include "portal.h"
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include "app_config.h"

static WebServer server(80);
static DNSServer dns;
static const byte DNS_PORT = 53;

// ---- Danh sach brand + model (them hang moi chi can sua o day) ----
// JS se loc model theo brand. "custom" -> dung o custom_name.
static const char* MODELS_JS =
  "const MODELS={"
  "solis:['S6-EH1P Hybrid','S6 String','S5-GR String','RHI Hybrid'],"
  "deye:['SUN Hybrid 1P','SUN Hybrid 3P','SUN String'],"
  "growatt:['MIN Hybrid','MOD Hybrid','MIC String'],"
  "lux:['LXP Hybrid'],"
  "custom:[]};";

static String htmlEscape(const String& s) {
  String o; o.reserve(s.length() + 8);
  for (char c : s) {
    if (c == '"') o += "&quot;";
    else if (c == '<') o += "&lt;";
    else if (c == '>') o += "&gt;";
    else o += c;
  }
  return o;
}

static String scanSsidOptions() {
  int n = WiFi.scanNetworks();
  String opts;
  for (int i = 0; i < n; i++) {
    String ssid = WiFi.SSID(i);
    if (ssid.length() == 0) continue;
    String sel = (ssid == g_cfg.wifi_ssid) ? " selected" : "";
    opts += "<option value=\"" + htmlEscape(ssid) + "\"" + sel + ">" +
            htmlEscape(ssid) + " (" + String(WiFi.RSSI(i)) + "dBm)</option>";
  }
  return opts;
}

static String brandOption(const char* val, const char* label) {
  String sel = (String(val) == g_cfg.brand) ? " selected" : "";
  return "<option value=\"" + String(val) + "\"" + sel + ">" + String(label) + "</option>";
}

static String buildPage() {
  String p;
  p.reserve(6000);
  p += "<!DOCTYPE html><html><head><meta charset='utf-8'>"
       "<meta name='viewport' content='width=device-width,initial-scale=1'>"
       "<title>Inverter Bridge</title><style>"
       "body{font-family:sans-serif;max-width:480px;margin:0 auto;padding:16px;background:#f4f6f8}"
       "h2{color:#1565c0}fieldset{border:1px solid #cfd8dc;border-radius:8px;margin:12px 0;padding:12px}"
       "legend{color:#37474f;font-weight:bold}label{display:block;margin:8px 0 3px;font-size:14px}"
       "input,select{width:100%;padding:9px;box-sizing:border-box;border:1px solid #b0bec5;border-radius:6px;font-size:15px}"
       "button{width:100%;padding:13px;margin-top:14px;background:#1565c0;color:#fff;border:0;border-radius:8px;font-size:16px}"
       ".hint{font-size:12px;color:#78909c;margin-top:3px}</style></head><body>"
       "<h2>&#9889; Inverter Bridge</h2><form method='POST' action='/save'>";

  // WiFi
  p += "<fieldset><legend>WiFi nha</legend>";
  p += "<label>Chon mang WiFi</label><select name='ssid'>" + scanSsidOptions() + "</select>";
  p += "<label>Hoac nhap ten WiFi (uu tien neu dien)</label><input name='ssid_manual' placeholder='SSID' value=''>";
  p += "<label>Mat khau WiFi</label><input name='wifi_pass' type='password' value='" + htmlEscape(g_cfg.wifi_pass) + "'>";
  p += "</fieldset>";

  // Inverter
  p += "<fieldset><legend>Bien tan</legend>";
  p += "<label>Hang</label><select name='brand' id='brand' onchange='fillModels()'>";
  p += brandOption("solis", "Solis");
  p += brandOption("deye", "Deye / Sunsynk");
  p += brandOption("growatt", "Growatt");
  p += brandOption("lux", "Luxpower");
  p += brandOption("custom", "Khac (custom)");
  p += "</select>";
  p += "<label>Dong may (model)</label><select name='model' id='model'></select>";
  p += "<label>Ten tuy chinh (khi chon Khac / khong co trong list)</label>";
  p += "<input name='custom_name' id='cname' value='" + htmlEscape(g_cfg.custom_name) + "'>";
  p += "<div class='hint'>De trong = tu dong nhan dien khi cam vao bien tan.</div>";
  p += "</fieldset>";

  // MQTT
  p += "<fieldset><legend>MQTT (Home Assistant)</legend>";
  p += "<label>Broker host</label><input name='mqtt_host' value='" + htmlEscape(g_cfg.mqtt_host) + "'>";
  p += "<label>Port</label><input name='mqtt_port' type='number' value='" + String(g_cfg.mqtt_port ? g_cfg.mqtt_port : 1883) + "'>";
  p += "<label>User</label><input name='mqtt_user' value='" + htmlEscape(g_cfg.mqtt_user) + "'>";
  p += "<label>Pass</label><input name='mqtt_pass' type='password' value='" + htmlEscape(g_cfg.mqtt_pass) + "'>";
  p += "</fieldset>";

  p += "<button type='submit'>Luu &amp; khoi dong lai</button></form>";

  // JS: loc model theo brand + prefill model da luu
  p += "<script>" + String(MODELS_JS) +
       "const SAVED_MODEL='" + String(g_cfg.model) + "';"
       "function fillModels(){var b=document.getElementById('brand').value;"
       "var m=document.getElementById('model');m.innerHTML='';"
       "(MODELS[b]||[]).forEach(function(x){var o=document.createElement('option');"
       "o.value=x;o.text=x;if(x==SAVED_MODEL)o.selected=true;m.add(o);});"
       "var o2=document.createElement('option');o2.value='';o2.text='(khac / tu dong)';m.add(o2);"
       "document.getElementById('cname').parentNode.style.display=(b=='custom')?'block':'block';}"
       "fillModels();</script></body></html>";
  return p;
}

static void handleRoot()  { server.send(200, "text/html", buildPage()); }

static void handleSave() {
  String ssid = server.arg("ssid_manual");
  if (ssid.length() == 0) ssid = server.arg("ssid");
  strlcpy(g_cfg.wifi_ssid, ssid.c_str(), sizeof(g_cfg.wifi_ssid));
  strlcpy(g_cfg.wifi_pass, server.arg("wifi_pass").c_str(), sizeof(g_cfg.wifi_pass));
  strlcpy(g_cfg.brand,     server.arg("brand").c_str(),     sizeof(g_cfg.brand));
  strlcpy(g_cfg.model,     server.arg("model").c_str(),     sizeof(g_cfg.model));
  strlcpy(g_cfg.custom_name, server.arg("custom_name").c_str(), sizeof(g_cfg.custom_name));
  strlcpy(g_cfg.mqtt_host, server.arg("mqtt_host").c_str(), sizeof(g_cfg.mqtt_host));
  g_cfg.mqtt_port = (uint16_t)server.arg("mqtt_port").toInt();
  if (g_cfg.mqtt_port == 0) g_cfg.mqtt_port = 1883;
  strlcpy(g_cfg.mqtt_user, server.arg("mqtt_user").c_str(), sizeof(g_cfg.mqtt_user));
  strlcpy(g_cfg.mqtt_pass, server.arg("mqtt_pass").c_str(), sizeof(g_cfg.mqtt_pass));
  g_cfg.configured = true;
  appConfigSave();

  server.send(200, "text/html",
    "<html><head><meta charset='utf-8'></head><body style='font-family:sans-serif;text-align:center;padding:40px'>"
    "<h2>&#9989; Da luu!</h2><p>Thiet bi dang khoi dong lai va ket noi WiFi <b>" + htmlEscape(g_cfg.wifi_ssid) +
    "</b>.</p><p>Ban co the dong trang nay.</p></body></html>");
  delay(1200);
  ESP.restart();
}

void startPortal() {
  String apName = "InverterBridge-";
  uint8_t mac[6]; WiFi.macAddress(mac);
  char suf[5]; snprintf(suf, sizeof(suf), "%02X%02X", mac[4], mac[5]);
  apName += suf;

  WiFi.mode(WIFI_AP);
  WiFi.softAP(apName.c_str());
  IPAddress apIP = WiFi.softAPIP();
  dns.start(DNS_PORT, "*", apIP);   // captive: moi domain -> ve minh

  server.on("/", handleRoot);
  server.on("/save", HTTP_POST, handleSave);
  server.onNotFound(handleRoot);    // bat captive portal
  server.begin();

  Serial.printf("\n[PORTAL] AP: \"%s\"  ->  http://%s\n", apName.c_str(), apIP.toString().c_str());
  Serial.println(F("[PORTAL] Dien thoai bat WiFi nay -> trang cau hinh tu bung ra."));

  while (true) {                    // blocking cho toi khi Luu -> restart
    dns.processNextRequest();
    server.handleClient();
    delay(5);
  }
}
