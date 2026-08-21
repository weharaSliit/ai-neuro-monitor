// #include <SPI.h>
// #include <WiFi.h>
// #include <PubSubClient.h>

// /* ================= WIFI ================= */

// const char* WIFI_SSID = "Hiruni";
// const char* WIFI_PASS = "Hiruni2022";

// const char* MQTT_BROKER = "192.168.1.4";
// const int   MQTT_PORT   = 1883;
// const char* MQTT_TOPIC  = "eeg/t7t8/raw";

// /* ================= ADS1292R PINS ================= */

// #define CS     D4
// #define RESET  D2
// #define START  D3
// #define DRDY   D6

// /* ================= ADS COMMANDS ================= */

// #define ADS_START   0x08
// #define ADS_RDATAC  0x10
// #define ADS_SDATAC  0x11
// #define ADS_WREG    0x40
// #define ADS_RREG    0x20

// /* ================= GLOBALS ================= */

// WiFiClient wifiClient;
// PubSubClient mqtt(wifiClient);

// SPISettings adsSPI(100000, MSBFIRST, SPI_MODE1);

// volatile bool drdyFlag = false;

// void IRAM_ATTR onDrdy() {
//   drdyFlag = true;
// }

// /* ================================================= */
// /* SPI HELPERS                                       */
// /* ================================================= */

// void sendCommand(byte cmd) {

//   SPI.beginTransaction(adsSPI);

//   digitalWrite(CS, LOW);
//   delayMicroseconds(10);

//   SPI.transfer(cmd);

//   digitalWrite(CS, HIGH);

//   SPI.endTransaction();

//   delay(2);
// }

// void writeReg(byte reg, byte val) {

//   SPI.beginTransaction(adsSPI);

//   digitalWrite(CS, LOW);
//   delayMicroseconds(10);

//   SPI.transfer(ADS_WREG | reg);
//   SPI.transfer(0x00);
//   SPI.transfer(val);

//   digitalWrite(CS, HIGH);

//   SPI.endTransaction();

//   delay(10);
// }

// byte readReg(byte reg) {

//   SPI.beginTransaction(adsSPI);

//   digitalWrite(CS, LOW);
//   delayMicroseconds(10);

//   SPI.transfer(ADS_RREG | reg);
//   SPI.transfer(0x00);

//   byte val = SPI.transfer(0x00);

//   digitalWrite(CS, HIGH);

//   SPI.endTransaction();

//   delay(5);

//   return val;
// }

// bool verifiedWrite(byte reg, byte value) {

//   writeReg(reg, value);

//   byte check = readReg(reg);

//   if (check != value) {

//     Serial.print("WRITE FAIL REG 0x");
//     Serial.print(reg, HEX);
//     Serial.print(" expected ");
//     Serial.print(value, HEX);
//     Serial.print(" got ");
//     Serial.println(check, HEX);

//     return false;
//   }

//   return true;
// }

// /* ================================================= */
// /* SIGNED 24 BIT                                     */
// /* ================================================= */

// int32_t s24(byte a, byte b, byte c) {

//   int32_t v = ((int32_t)a << 16) |
//               ((int32_t)b << 8) |
//                c;

//   if (v & 0x800000)
//       v |= 0xFF000000;

//   return v;
// }

// /* ================================================= */
// /* WIFI                                              */
// /* ================================================= */

// void connectWiFi() {

//   Serial.println("Connecting WiFi...");

//   WiFi.mode(WIFI_STA);
//   WiFi.begin(WIFI_SSID, WIFI_PASS);

//   while (WiFi.status() != WL_CONNECTED) {
//     delay(500);
//     Serial.print(".");
//   }

//   Serial.println();
//   Serial.println("WiFi connected");
//   Serial.print("IP: ");
//   Serial.println(WiFi.localIP());
// }

// /* ================================================= */
// /* MQTT                                              */
// /* ================================================= */

// void connectMQTT() {

//   mqtt.setServer(MQTT_BROKER, MQTT_PORT);

//   while (!mqtt.connected()) {

//     Serial.print("Connecting MQTT...");

//     if (mqtt.connect("ESP32_EEG")) {
//       Serial.println("connected");
//     }
//     else {
//       Serial.println("retry");
//       delay(2000);
//     }
//   }
// }

// /* ================================================= */
// /* ADS INIT                                          */
// /* ================================================= */

// void initADS() {

//   Serial.println("Configuring ADS1292R...");

//   sendCommand(ADS_SDATAC);
//   delay(100);

//   sendCommand(ADS_SDATAC);
//   delay(100);

//   verifiedWrite(0x01, 0x01);   // 250 SPS
//   verifiedWrite(0x02, 0xA0);   // internal ref ON
//   verifiedWrite(0x04, 0x60);   // CH1 EEG
//   verifiedWrite(0x05, 0x60);   // CH2 EEG
//   verifiedWrite(0x06, 0x2C);   // bias

//   delay(100);

//   Serial.print("CONFIG1 = ");
//   Serial.println(readReg(0x01), HEX);

//   Serial.print("CONFIG2 = ");
//   Serial.println(readReg(0x02), HEX);

//   Serial.print("CH1SET = ");
//   Serial.println(readReg(0x04), HEX);

//   Serial.print("CH2SET = ");
//   Serial.println(readReg(0x05), HEX);

//   Serial.print("RLD = ");
//   Serial.println(readReg(0x06), HEX);

//   attachInterrupt(
//       digitalPinToInterrupt(DRDY),
//       onDrdy,
//       FALLING
//   );

//   sendCommand(ADS_RDATAC);

//   delay(50);

//   sendCommand(ADS_START);

//   digitalWrite(START, HIGH);

//   Serial.println("ADS STREAMING");
// }

// /* ================================================= */
// /* SETUP                                             */
// /* ================================================= */

// void setup() {

//   Serial.begin(115200);
//   delay(2000);

//   Serial.println("EEG PRE-STRESS SYSTEM");

//   pinMode(CS, OUTPUT);
//   pinMode(RESET, OUTPUT);
//   pinMode(START, OUTPUT);
//   pinMode(DRDY, INPUT);

//   digitalWrite(CS, HIGH);
//   digitalWrite(START, LOW);

//   SPI.begin(D8, D7, D10, CS);

//   /* HARD RESET */

//   digitalWrite(RESET, LOW);
//   delay(300);

//   digitalWrite(RESET, HIGH);
//   delay(1000);

//   /* ADS FIRST */

//   initADS();

//   /* WIFI SECOND */

//   connectWiFi();

//   /* MQTT THIRD */

//   connectMQTT();
// }

// /* ================================================= */
// /* LOOP                                              */
// /* ================================================= */

// void loop() {

//   if (!mqtt.connected())
//       connectMQTT();

//   mqtt.loop();

//   if (!drdyFlag)
//       return;

//   drdyFlag = false;

//   byte r[9];

//   SPI.beginTransaction(adsSPI);

//   digitalWrite(CS, LOW);

//   for (int i = 0; i < 9; i++) {
//     r[i] = SPI.transfer(0x00);
//   }

//   digitalWrite(CS, HIGH);

//   SPI.endTransaction();

//   int32_t ch1 = s24(r[3], r[4], r[5]);
//   int32_t ch2 = s24(r[6], r[7], r[8]);

//   char payload[64];

//   sprintf(
//       payload,
//       "%lu,%ld,%ld",
//       millis(),
//       ch1,
//       ch2
//   );

//   mqtt.publish(MQTT_TOPIC, payload);
// }

// // void loop() {

// //   if (!drdyFlag)
// //       return;

// //   drdyFlag = false;

// //   byte r[9];

// //   SPI.beginTransaction(adsSPI);
// //   digitalWrite(CS, LOW);

// //   for (int i = 0; i < 9; i++) {
// //     r[i] = SPI.transfer(0x00);
// //   }

// //   digitalWrite(CS, HIGH);
// //   SPI.endTransaction();

// //   int32_t ch1 = s24(r[3], r[4], r[5]);
// //   int32_t ch2 = s24(r[6], r[7], r[8]);

// //   Serial.print("CH1=");
// //   Serial.print(ch1);
// //   Serial.print(" CH2=");
// //   Serial.println(ch2);
// // }
// // void loop() {

// //   if (WiFi.status() != WL_CONNECTED) {
// //       Serial.println("WiFi reconnect");
// //       WiFi.begin(WIFI_SSID, WIFI_PASS);
// //       delay(2000);
// //       return;
// //   }

// //   if (!mqtt.connected()) {
// //       connectMQTT();
// //   }

// //   mqtt.loop();

// //   char payload[20];

// //   sprintf(payload,"%d", random(400,600));

// //   Serial.print("Sending: ");
// //   Serial.println(payload);

// //   bool ok = mqtt.publish("test/eeg", payload);

// //   Serial.print("Publish=");
// //   Serial.println(ok);

// //   delay(500);
// // }
#include <SPI.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <PubSubClient.h>

/* ================= WIFI ================= */

const char* WIFI_SSID = "Hiruni";
const char* WIFI_PASS = "Hiruni2022";

// The broker is resolved by mDNS hostname, not a hardcoded IP -- the dev
// Mac's IP changes every time it switches networks (it did once already,
// requiring a re-flash), but its Bonjour name (Hirunis-MacBook-Pro-2.local,
// from `scutil --get LocalHostName` on that Mac) stays stable regardless.
// MDNS.queryHost() below appends ".local" itself, so no suffix here.
const char* MQTT_HOSTNAME = "Hirunis-MacBook-Pro-2";
const int   MQTT_PORT   = 1883;
const char* MQTT_TOPIC  = "eeg/t7t8/raw";

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

  // Starts the mDNS responder/resolver -- required before queryHost() below
  // works. The name here is this DEVICE's own advertised hostname
  // (wearable02-eeg.local), unrelated to MQTT_HOSTNAME (the Mac we resolve).
  if (MDNS.begin("wearable02-eeg")) {
    Serial.println("mDNS resolver started");
  } else {
    Serial.println("mDNS resolver failed to start");
  }
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

  // Re-resolved on every attempt (not cached once at boot) -- if the Mac
  // gets a new DHCP lease while this device stays connected, the next
  // reconnect attempt picks it up automatically instead of needing a
  // re-flash. Costs one mDNS query (up to ~2s timeout) only while
  // disconnected, which this function already gates to once per
  // MQTT_RETRY_INTERVAL_MS.
  IPAddress brokerIP = MDNS.queryHost(MQTT_HOSTNAME);
  if (brokerIP == IPAddress(0, 0, 0, 0)) {
    Serial.print("mDNS lookup failed for ");
    Serial.print(MQTT_HOSTNAME);
    Serial.println(".local -- retry in 2s");
    return;
  }

  mqtt.setServer(brokerIP, MQTT_PORT);

  Serial.print("Connecting MQTT (");
  Serial.print(brokerIP);
  Serial.print(")...");

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
  // Server is resolved by mDNS hostname and set inside maintainMQTT()
  // itself (re-resolved on every reconnect attempt), not here.
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