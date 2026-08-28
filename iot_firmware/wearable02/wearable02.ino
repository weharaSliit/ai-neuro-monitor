#include <SPI.h>
#include <WiFi.h>
#include <WiFiClientSecure.h> 
#include <PubSubClient.h>

/* ================= HARDWARE PIN DEFINITIONS (XIAO ESP32-C3) ================= */
// Reverted to raw GPIO integers for generic ESP32-C3 board compatibility
constexpr int8_t ADS_PIN_RESET = 2;   // GPIO2 (D0)
constexpr int8_t ADS_PIN_START = 3;   // GPIO3 (D1)
constexpr int8_t ADS_PIN_DRDY  = 4;   // GPIO4 (D2)
constexpr int8_t ADS_PIN_CS    = 7;   // GPIO7 (D5)

constexpr int8_t SPI_PIN_SCK   = 8;   // GPIO8 (D8)
constexpr int8_t SPI_PIN_MISO  = 9;   // GPIO9 (D9)
constexpr int8_t SPI_PIN_MOSI  = 10;  // GPIO10 (D10)

/* ================= WIFI CONFIGURATION ================= */

const int WIFI_NETWORK_COUNT = 2;
const char* WIFI_SSIDS[WIFI_NETWORK_COUNT]     = { "Wehara's A07", "Hiruni" };
const char* WIFI_PASSWORDS[WIFI_NETWORK_COUNT] = { "wehara1216",   "Hiruni2022" };

// --- EMQX CLOUD BROKER CONFIGURATION ---
const char* MQTT_BROKER = "ob1f0f10.ala.asia-southeast1.emqxsl.com";
const int   MQTT_PORT   = 8883;
const char* MQTT_USER   = "wearable02";
const char* MQTT_PASS   = "wearable02";
const char* MQTT_TOPIC  = "mindpulse/wearable02/sensors";
const char* MQTT_STATUS = "mindpulse/wearable02/status";

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

/* ================= ADS1292R COMMANDS & CONFIG ================= */

#define ADS_CMD_START   0x08
#define ADS_CMD_STOP    0x0A
#define ADS_CMD_RDATAC  0x10
#define ADS_CMD_SDATAC  0x11
#define ADS_CMD_WREG    0x40
#define ADS_CMD_RREG    0x20

#define BATCH_SIZE 25

uint32_t batchTime[BATCH_SIZE];
int32_t  batchCh2[BATCH_SIZE];
uint8_t  batchCount = 0;
uint32_t corruptFrameCount = 0;

/* ================= SYSTEM OBJECTS ================= */

WiFiClientSecure wifiClient;
PubSubClient mqtt(wifiClient);

SPISettings adsSPI(100000, MSBFIRST, SPI_MODE1); // Kept at 100kHz for stability
volatile bool drdyFlag = false;
unsigned long lastDrdyTimestamp = 0;
unsigned long lastHeartbeatTime = 0;

void IRAM_ATTR onDrdy() {
  drdyFlag = true;
}

/* ================= SPI HELPERS ================= */

void sendCommand(byte cmd) {
  SPI.beginTransaction(adsSPI);
  digitalWrite(ADS_PIN_CS, LOW);
  delayMicroseconds(10);
  SPI.transfer(cmd);
  digitalWrite(ADS_PIN_CS, HIGH);
  SPI.endTransaction();
  delay(2);
}

void writeReg(byte reg, byte val) {
  SPI.beginTransaction(adsSPI);
  digitalWrite(ADS_PIN_CS, LOW);
  delayMicroseconds(10);
  SPI.transfer(ADS_CMD_WREG | reg);
  SPI.transfer(0x00);
  SPI.transfer(val);
  digitalWrite(ADS_PIN_CS, HIGH);
  SPI.endTransaction();
  delay(10);
}

byte readReg(byte reg) {
  SPI.beginTransaction(adsSPI);
  digitalWrite(ADS_PIN_CS, LOW);
  delayMicroseconds(10);
  SPI.transfer(ADS_CMD_RREG | reg);
  SPI.transfer(0x00);
  byte val = SPI.transfer(0x00);
  digitalWrite(ADS_PIN_CS, HIGH);
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
    Serial.print(" expected 0x");
    Serial.print(value, HEX);
    Serial.print(" got 0x");
    Serial.println(check, HEX);
    return false;
  }
  return true;
}

int32_t parseSigned24(byte msb, byte mid, byte lsb) {
  int32_t val = ((int32_t)msb << 16) | ((int32_t)mid << 8) | lsb;
  if (val & 0x800000) {
    val |= 0xFF000000;
  }
  return val;
}

bool isStatusValid(byte s0) {
  return (s0 & 0xF0) == 0xC0;
}

/* ================= NETWORK SERVICES ================= */

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  for (int i = 0; i < WIFI_NETWORK_COUNT; i++) {
    WiFi.disconnect(true, true);
    delay(100);

    Serial.print("Connecting WiFi: ");
    Serial.println(WIFI_SSIDS[i]);
    WiFi.begin(WIFI_SSIDS[i], WIFI_PASSWORDS[i]);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
      delay(300);
      Serial.print(".");
      attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
      Serial.println();
      Serial.println("WiFi connected: " + String(WIFI_SSIDS[i]));
      Serial.print("IP Address: ");
      Serial.println(WiFi.localIP());
      WiFi.setSleep(false);
      return;
    }
    Serial.println();
  }
  Serial.println("WiFi connection failed across all configurations.");
}

unsigned long lastMqttAttempt = 0;
const unsigned long MQTT_RETRY_INTERVAL_MS = 2000;

void maintainMQTT() {
  if (mqtt.connected()) return;
  unsigned long now = millis();
  if (now - lastMqttAttempt < MQTT_RETRY_INTERVAL_MS) return;
  lastMqttAttempt = now;

  Serial.print("Connecting to EMQX MQTT Broker...");
  if (mqtt.connect("wearable02", MQTT_USER, MQTT_PASS)) {
    Serial.println(" Connected");
    mqtt.publish(MQTT_STATUS, "{\"status\":\"ONLINE\",\"mode\":\"BIPOLAR_T7_T8\"}");
  } else {
    Serial.print(" Failed, rc=");
    Serial.println(mqtt.state());
  }
}

/* ================= ADS1292R OPTION B CONFIGURATION ================= */

bool initADS() {
  Serial.println("Configuring ADS1292R for Option B (1-Channel Bipolar T7-T8)...");

  // --- NEW: Wake up the chip before doing anything ---
  sendCommand(0x02); // WAKEUP Command
  delay(100);

  sendCommand(ADS_CMD_SDATAC);
  delay(100);

  // CONFIG1 (0x01): 250 SPS data rate -> 0x01
  if (!verifiedWrite(0x01, 0x01)) return false;

  // CONFIG2 (0x02): PDB_REFBUF = 1, VREF = 2.42V -> 0xA0
  if (!verifiedWrite(0x02, 0xA0)) return false;

  // CH1SET (0x04): Power-down Ch1 & short input -> 0x81
  if (!verifiedWrite(0x04, 0x81)) return false;

  // CH2SET (0x05): Gain = 6 (0x50), Normal Electrode MUX (0x00) -> 0x50
  if (!verifiedWrite(0x05, 0x50)) return false;

  if (!verifiedWrite(0x06, 0x2C)) return false;

  // RESP1 (0x09): Disable respiration circuitry -> 0x00
  if (!verifiedWrite(0x09, 0x00)) return false;

  // RESP2 (0x0A): Set internal RLD reference to midsupply (RLDREF_INT = 1) -> 0x02
  if (!verifiedWrite(0x0A, 0x02)) return false;
  delay(100);

  attachInterrupt(digitalPinToInterrupt(ADS_PIN_DRDY), onDrdy, FALLING);

  sendCommand(ADS_CMD_RDATAC);
  delay(50);

  sendCommand(ADS_CMD_START);
  digitalWrite(ADS_PIN_START, HIGH);

  Serial.println("Option B Streaming Initialized.");
  return true;
}

/* ================= MQTT TRANSMISSION ================= */

void publishBatch() {
  if (mqtt.connected()) {
    static char payload[600];
    int offset = 0;

    for (uint8_t i = 0; i < batchCount; i++) {
      int n = snprintf(
          payload + offset, sizeof(payload) - offset,
          "%lu,%ld;",
          batchTime[i], batchCh2[i]
      );
      if (n < 0 || offset + n >= (int)sizeof(payload)) break;
      offset += n;
    }

    bool ok = mqtt.publish(MQTT_TOPIC, payload);
    if (!ok) {
      Serial.println("[MQTT] Publish batch drop");
    }
  }
  batchCount = 0;
}

/* ================= SETUP ================= */

void setup() {
  Serial.begin();

  unsigned long startWait = millis();
  while (!Serial && (millis() - startWait < 2000));

  Serial.println("\n=================================");
  Serial.println("  OPTION B: BIPOLAR T7-T8 EEG    ");
  Serial.println("=================================");

  pinMode(ADS_PIN_CS, OUTPUT);
  pinMode(ADS_PIN_RESET, OUTPUT);
  pinMode(ADS_PIN_START, OUTPUT);
  pinMode(ADS_PIN_DRDY, INPUT_PULLUP);

  digitalWrite(ADS_PIN_CS, HIGH);
  digitalWrite(ADS_PIN_START, LOW);

  SPI.begin(SPI_PIN_SCK, SPI_PIN_MISO, SPI_PIN_MOSI, -1);

  // Hardware Reset Pulse
  digitalWrite(ADS_PIN_RESET, LOW);
  delay(300);
  digitalWrite(ADS_PIN_RESET, HIGH);
  delay(1000);

  connectWiFi();

  // Restored Certificate for secure connection
  wifiClient.setCACert(EMQX_CA_CERT);
  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setBufferSize(1024);
  maintainMQTT();

  if (!initADS()) {
    Serial.println("[FATAL] ADS1292R initialization failed! Checking SPI lines.");
    while (true) {
      delay(100);
    }
  }

  lastDrdyTimestamp = millis();
}

/* ================= LOOP ================= */

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  maintainMQTT();
  mqtt.loop();

  // 5-second Watchdog & Heartbeat
  if (millis() - lastHeartbeatTime > 5000) {
    lastHeartbeatTime = millis();
    bool drdyActive = (millis() - lastDrdyTimestamp < 1000);
    if (!drdyActive) {
      Serial.println("[WARNING] DRDY interrupt stopped pulsing!");
    }
    if (mqtt.connected()) {
      char hb[64];
      snprintf(hb, sizeof(hb), "{\"uptime_ms\":%lu,\"drdy_ok\":%d}", millis(), drdyActive ? 1 : 0);
      mqtt.publish(MQTT_STATUS, hb);
    }
  }

  if (!drdyFlag) return;
  drdyFlag = false;
  lastDrdyTimestamp = millis();

  byte r[9];
  SPI.beginTransaction(adsSPI);
  digitalWrite(ADS_PIN_CS, LOW);
  for (int i = 0; i < 9; i++) {
    r[i] = SPI.transfer(0x00);
  }
  digitalWrite(ADS_PIN_CS, HIGH);
  SPI.endTransaction();

  if (!isStatusValid(r[0])) {
    corruptFrameCount++;
    if (corruptFrameCount % 250 == 0) {
      Serial.print("Corrupted ADS frames: ");
      Serial.println(corruptFrameCount);
    }
    return;
  }

  // Channel 2 (T7 - T8 Differential)
  int32_t raw_t7_t8 = parseSigned24(r[6], r[7], r[8]);
  uint32_t now = millis();

  // Gain 6, VREF 2.42V: (2 * 2.42V / 6) / 8388607 * 1e6 = 0.0961538 uV/count
  float t7_t8_uV = raw_t7_t8 * 0.0961538f;

  /* =========================================== */
  /* --- MODIFIED FOR ARDUINO SERIAL PLOTTER --- */
  /* =========================================== */
  // Only printing the microvolt value with a label. 
  
  Serial.print("EEG(uV):");
  Serial.println(t7_t8_uV, 2);

  /* =========================================== */

  batchTime[batchCount] = now;
  batchCh2[batchCount]  = raw_t7_t8;
  batchCount++;

  if (batchCount >= BATCH_SIZE) {
    publishBatch();
  }
}