#include <SPI.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>

/* ================= WIFI ================= */

// Tried in order in connectWiFi() -- add more pairs here as needed rather
// than re-flashing every time the device needs a different network.
const int WIFI_NETWORK_COUNT = 2;
const char* WIFI_SSIDS[WIFI_NETWORK_COUNT]     = { "Wehara's A07", "Hiruni" };
const char* WIFI_PASSWORDS[WIFI_NETWORK_COUNT] = { "wehara1216",   "Hiruni2022" };
// EMQX Cloud Serverless broker (mindpulse-broker, Asia-Pacific) -- see
// iot_firmware/wearable01/wearable01.ino's identical comment. Serverless
// only accepts TLS on 8883 (see EMQX_CA_CERT below) with username/password
// auth, unlike the old local Mosquitto's plain-TCP/allow_anonymous setup.
const char* MQTT_BROKER = "ob1f0f10.ala.asia-southeast1.emqxsl.com";
const int   MQTT_PORT   = 8883;
const char* MQTT_USER   = "wearable02";
const char* MQTT_PASS   = "wearable02";
const char* MQTT_TOPIC  = "mindpulse/wearable02/sensors";

// EMQX Cloud's CA (DigiCert Global Root G2, expires 2031-11-10) -- see
// wearable01.ino's identical cert / comment, also saved standalone at
// iot_firmware/emqxsl-ca.crt.
const char* EMQX_CA_CERT = R"EOF(
-----BEGIN CERTIFICATE-----
MIIDjjCCAnagAwIBAgIQAzrx5qcRqaC7KGSxHQn65TANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0xMzA4MDExMjAwMDBaFw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
b20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IEcyMIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuzfNNNx7a8myaJCtSnX/RrohCgiN9RlUyfuI
2/Ou8jqJkTx65qsGGmvPrC3oXgkkRLpimn7Wo6h+4FR1IAWsULecYxpsMNzaHxmx
1x7e/dfgy5SDN67sH0NO3Xss0r0upS/kqbitOtSZpLYl6ZtrAGCSYP9PIUkY92eQ
q2EGnI/yuum06ZIya7XzV+hdG82MHauVBJVJ8zUtluNJbd134/tJS7SsVQepj5Wz
tCO7TG1F8PapspUwtP1MVYwnSlcUfIKdzXOS0xZKBgyMUNGPHgm+F6HmIcr9g+UQ
vIOlCsRnKPZzFBQ9RnbDhxSJITRNrw9FDKZJobq7nMWxM4MphQIDAQABo0IwQDAP
BgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNVHQ4EFgQUTiJUIBiV
5uNu5g/6+rkS7QYXjzkwDQYJKoZIhvcNAQELBQADggEBAGBnKJRvDkhj6zHd6mcY
1Yl9PMWLSn/pvtsrF9+wX3N3KjITOYFnQoQj8kVnNeyIv/iPsGEMNKSuIEyExtv4
NeF22d+mQrvHRAiGfzZ0JFrabA0UWTW98kndth/Jsw1HKj2ZL7tcu7XUIOGZX1NG
Fdtom/DzMNU+MeKNhJ7jitralj41E6Vf8PlwUHBHQRFXGU7Aj64GxJUTFy8bJZ91
8rGOmaFvE7FBcf6IKshPECBV1/MUReXgRPTqh5Uykw7+U0b6LJ3/iyK5S9kJRaTe
pLiaWN0bfVKfjllDiIGknibVb63dDcY3fe0Dkhvld1927jyNxF1WW6LZZm6zNTfl
MrY=
-----END CERTIFICATE-----
)EOF";

/* ================= ADS1292R PINS ================= */

#define CS     D4
#define RESET  D2
#define START  D3
#define DRDY   D6

/* ================= ADS COMMANDS ================= */

#define ADS_START   0x08
#define ADS_RDATAC  0x10
#define ADS_SDATAC  0x11
#define ADS_WREG    0x40
#define ADS_RREG    0x20

/* ================= BATCHING ================= */

#define BATCH_SIZE 25

uint32_t batchTime[BATCH_SIZE];
int32_t  batchCh1[BATCH_SIZE];
int32_t  batchCh2[BATCH_SIZE];
uint8_t  batchCount = 0;

uint32_t corruptFrameCount = 0;

/* ================= GLOBALS ================= */

WiFiClientSecure wifiClient;
PubSubClient mqtt(wifiClient);

SPISettings adsSPI(100000, MSBFIRST, SPI_MODE1);

volatile bool drdyFlag = false;

void IRAM_ATTR onDrdy() {
  drdyFlag = true;
}

/* ================================================= */
/* SPI HELPERS                                       */
/* ================================================= */

void sendCommand(byte cmd) {
  SPI.beginTransaction(adsSPI);
  digitalWrite(CS, LOW);
  delayMicroseconds(10);

  SPI.transfer(cmd);

  digitalWrite(CS, HIGH);
  SPI.endTransaction();
  delay(2);
}

void writeReg(byte reg, byte val) {
  SPI.beginTransaction(adsSPI);
  digitalWrite(CS, LOW);
  delayMicroseconds(10);

  SPI.transfer(ADS_WREG | reg);
  SPI.transfer(0x00);
  SPI.transfer(val);

  digitalWrite(CS, HIGH);
  SPI.endTransaction();
  delay(10);
}

byte readReg(byte reg) {
  SPI.beginTransaction(adsSPI);
  digitalWrite(CS, LOW);
  delayMicroseconds(10);

  SPI.transfer(ADS_RREG | reg);
  SPI.transfer(0x00);

  byte val = SPI.transfer(0x00);

  digitalWrite(CS, HIGH);
  SPI.endTransaction();
  delay(5);

  return val;
}

bool verifiedWrite(byte reg, byte value) {
  writeReg(reg, value);
  byte check = readReg(reg);

  if (check != value) {
    Serial.print("WRITE FAIL REG 0x");
    Serial.print(reg, HEX);
    Serial.print(" expected ");
    Serial.print(value, HEX);
    Serial.print(" got ");
    Serial.println(check, HEX);
    return false;
  }
  return true;
}

/* ================================================= */
/* SIGNED 24 BIT                                     */
/* ================================================= */

int32_t s24(byte a, byte b, byte c) {
  int32_t v = ((int32_t)a << 16) |
              ((int32_t)b << 8) |
               c;

  if (v & 0x800000)
      v |= 0xFF000000;

  return v;
}

bool statusValid(byte s0) {
  return (s0 & 0xF0) == 0xC0;
}

/* ================================================= */
/* WIFI                                              */
/* ================================================= */

void connectWiFi() {
  WiFi.mode(WIFI_STA);

  for (int i = 0; i < WIFI_NETWORK_COUNT; i++) {
    // Without this, falling through from a failed attempt straight into
    // the next WiFi.begin() hits the driver mid-state-machine and throws
    // "E wifi:sta is connecting, cannot set config" -- that reconfigure
    // is then silently dropped, so the "next network" attempt never
    // actually takes. Also run before the very first attempt: a WiFi
    // reconnect (called again from loop() after a drop, not just setup())
    // can find the driver already mid-connecting from the prior failure.
    WiFi.disconnect(true, true);
    delay(100);

    Serial.print("Connecting WiFi: ");
    Serial.println(WIFI_SSIDS[i]);
    WiFi.begin(WIFI_SSIDS[i], WIFI_PASSWORDS[i]);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 40) {
      delay(500);
      Serial.print(".");
      attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
      Serial.println();
      Serial.println("WiFi connected to " + String(WIFI_SSIDS[i]));
      Serial.print("IP: ");
      Serial.println(WiFi.localIP());
      WiFi.setSleep(false);
      return;
    }
    Serial.println();
    Serial.println("Failed to connect to " + String(WIFI_SSIDS[i]) + " after 20s -- trying next network");
  }
  Serial.println("WiFi connection FAILED for all known networks");
}

/* ================================================= */
/* MQTT (non-blocking)                               */
/* ================================================= */

unsigned long lastMqttAttempt = 0;
const unsigned long MQTT_RETRY_INTERVAL_MS = 2000;

void maintainMQTT() {
  if (mqtt.connected())
      return;

  unsigned long now = millis();

  if (now - lastMqttAttempt < MQTT_RETRY_INTERVAL_MS)
      return;

  lastMqttAttempt = now;

  Serial.print("Connecting MQTT...");

  // Client ID matches the "wearable02" username/topic convention (see
  // wearable01.ino's identical DEVICE_ID pattern) -- was hardcoded to the
  // unrelated "ESP32_EEG" before, which is worth ruling out if the broker's
  // ACL/authorization rules are scoped per client ID.
  if (mqtt.connect("wearable02", MQTT_USER, MQTT_PASS)) {
    Serial.println("connected");
  }
  else {
    Serial.print("failed, rc=");
    Serial.print(mqtt.state());
    Serial.println(" -- retry in 2s");
  }
}

/* ================================================= */
/* ADS INIT                                          */
/* ================================================= */

void initADS(bool internalShort = false) {
  Serial.println("Configuring ADS1292R...");

  sendCommand(ADS_SDATAC);
  delay(100);

  sendCommand(ADS_SDATAC);
  delay(100);

  // CONFIG1: 250 SPS
  verifiedWrite(0x01, 0x01);   

  // CONFIG2: 0xE0 -> PDB_REFBUF = 1 (Ref Buffer ON), VREF_4V = 1 (4V Ref)
  // Fixes floating reference drift and DC offset (~-4200uV / ~-6100uV)
  verifiedWrite(0x02, 0xE0);   

  if (internalShort) {
    // CH1SET & CH2SET: Gain 12 (0x60) | MUX Shorted (0x01) -> 0x61
    verifiedWrite(0x04, 0x61);   
    verifiedWrite(0x05, 0x61);   
    Serial.println("MODE: ADS1292R Internal Short Test");
  } else {
    // CH1SET & CH2SET: Gain 12 (0x60) | MUX Normal Electrodes (0x00) -> 0x60
    verifiedWrite(0x04, 0x60);   
    verifiedWrite(0x05, 0x60);   
    Serial.println("MODE: Normal Electrode Acquisition");
  }

  // RLD / Bias configuration
  verifiedWrite(0x06, 0x2C);   

  delay(100);

  Serial.print("CONFIG1 = 0x");
  Serial.println(readReg(0x01), HEX);

  Serial.print("CONFIG2 = 0x");
  Serial.println(readReg(0x02), HEX);

  Serial.print("CH1SET  = 0x");
  Serial.println(readReg(0x04), HEX);

  Serial.print("CH2SET  = 0x");
  Serial.println(readReg(0x05), HEX);

  Serial.print("RLD     = 0x");
  Serial.println(readReg(0x06), HEX);

  attachInterrupt(
      digitalPinToInterrupt(DRDY),
      onDrdy,
      FALLING
  );

  sendCommand(ADS_RDATAC);
  delay(50);

  sendCommand(ADS_START);
  digitalWrite(START, HIGH);

  Serial.println("ADS STREAMING");
}

/* ================================================= */
/* PUBLISH                                           */
/* ================================================= */

void publishBatch() {
  if (mqtt.connected()) {
    static char payload[900];
    int offset = 0;

    for (uint8_t i = 0; i < batchCount; i++) {
      int n = snprintf(
          payload + offset, sizeof(payload) - offset,
          "%lu,%ld,%ld;",
          batchTime[i], batchCh1[i], batchCh2[i]
      );

      if (n < 0 || offset + n >= (int)sizeof(payload))
          break;

      offset += n;
    }

    // Previously ignored -- for QoS0 this only confirms the write to the
    // socket succeeded, not that the broker accepted it (an ACL rejection
    // or oversized packet is silent either way), but it at least rules out
    // the local, checkable half of "connected but no data arrives".
    bool published = mqtt.publish(MQTT_TOPIC, payload);
    Serial.print("Publish ");
    Serial.print(published ? "OK" : "FAILED");
    Serial.print(" (");
    Serial.print(batchCount);
    Serial.print(" samples, ");
    Serial.print(offset);
    Serial.println(" bytes)");
  } else {
    Serial.println("Skipped batch publish -- MQTT not connected");
  }

  batchCount = 0;
}

/* ================================================= */
/* SETUP                                             */
/* ================================================= */

void setup() {
  Serial.begin(115200);
  delay(2000);

  Serial.println("EEG PRE-STRESS SYSTEM");

  pinMode(CS, OUTPUT);
  pinMode(RESET, OUTPUT);
  pinMode(START, OUTPUT);
  pinMode(DRDY, INPUT);

  digitalWrite(CS, HIGH);
  digitalWrite(START, LOW);

  SPI.begin(D8, D7, D10, CS);

  /* HARD RESET */
  digitalWrite(RESET, LOW);
  delay(300);

  digitalWrite(RESET, HIGH);
  delay(1000);

  /* ADS FIRST */
  // Pass true to run internal short test, false for live electrode data
  initADS(false); 

  /* WIFI SECOND */
  connectWiFi();

  /* MQTT THIRD */
  wifiClient.setCACert(EMQX_CA_CERT);
  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setBufferSize(1024);
  maintainMQTT();
}

/* ================================================= */
/* LOOP                                              */
/* ================================================= */

void loop() {
  // connectWiFi() was previously only ever called once, from setup() --
  // a WiFi drop mid-session (router hiccup, range, AP reboot) had no
  // recovery path at all and would silently kill data collection until
  // the device was power-cycled. Matches wearable01.ino's same check.
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi dropped, reconnecting...");
    connectWiFi();
  }

  maintainMQTT();
  mqtt.loop();

  if (!drdyFlag)
      return;

  drdyFlag = false;

  byte r[9];

  SPI.beginTransaction(adsSPI);
  digitalWrite(CS, LOW);

  for (int i = 0; i < 9; i++) {
    r[i] = SPI.transfer(0x00);
  }

  digitalWrite(CS, HIGH);
  SPI.endTransaction();

  if (!statusValid(r[0])) {
    corruptFrameCount++;
    // Was tallied but never surfaced -- if the ADS is wired/seated wrong,
    // every frame fails this check, batchCount never reaches BATCH_SIZE,
    // and publishBatch() silently never runs, looking identical to an MQTT
    // problem from the Serial monitor.
    if (corruptFrameCount % 250 == 0) {
      Serial.print("WARNING: ");
      Serial.print(corruptFrameCount);
      Serial.println(" corrupt ADS frames so far -- check SPI wiring/DRDY");
    }
    return;
  }

  int32_t ch1 = s24(r[3], r[4], r[5]);
  int32_t ch2 = s24(r[6], r[7], r[8]);

  batchTime[batchCount] = millis();
  batchCh1[batchCount]  = ch1;
  batchCh2[batchCount]  = ch2;
  batchCount++;

  if (batchCount >= BATCH_SIZE) {
    publishBatch();
  }
}