#include <SPI.h>
#include <WiFi.h>
#include <PubSubClient.h>

/* ================= WIFI ================= */

const char* WIFI_SSID = "Wehara's A07";
const char* WIFI_PASS = "wehara1216";
// Direct IP for now instead of MQTT_HOSTNAME's mDNS lookup -- see
// iot_firmware/wearable01/wearable01.ino's identical comment. Matches
// MQTT_BROKER in backend/common/config.py / EEG_MQTT_BROKER for
// backend/psychological/mqtt_bridge.py and API_BASE in StressApp's
// config.js -- all four need to point at whichever machine is actually
// running the broker + backends.
const char* MQTT_BROKER = "10.180.48.56";
const int   MQTT_PORT   = 1883;
const char* MQTT_TOPIC  = "mindpulse/wearable02/sensors";

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

WiFiClient wifiClient;
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
  Serial.println("Connecting WiFi...");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi connected");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  WiFi.setSleep(false);
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

  if (mqtt.connect("ESP32_EEG")) {
    Serial.println("connected");
  }
  else {
    Serial.println("retry in 2s");
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

    mqtt.publish(MQTT_TOPIC, payload);
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
  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setBufferSize(1024);
  maintainMQTT();
}

/* ================================================= */
/* LOOP                                              */
/* ================================================= */

void loop() {
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