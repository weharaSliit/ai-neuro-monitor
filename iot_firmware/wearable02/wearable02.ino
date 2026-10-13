// // #include <SPI.h>
// // #include <WiFi.h>
// // #include <WiFiClientSecure.h>
// // #include <PubSubClient.h>
// // #include "esp_system.h"

// // /* ================= HARDWARE PIN DEFINITIONS (XIAO ESP32-C3) ================= */
// // // Reverted to raw GPIO integers for generic ESP32-C3 board compatibility
// // constexpr int8_t ADS_PIN_RESET = 2;   // GPIO2 (D0)
// // constexpr int8_t ADS_PIN_START = 3;   // GPIO3 (D1)
// // constexpr int8_t ADS_PIN_DRDY  = 4;   // GPIO4 (D2)
// // constexpr int8_t ADS_PIN_CS    = 7;   // GPIO7 (D5)

// // constexpr int8_t SPI_PIN_SCK   = 8;   // GPIO8 (D8)
// // constexpr int8_t SPI_PIN_MISO  = 20;  // GPIO9 (D9)
// // constexpr int8_t SPI_PIN_MOSI  = 10;  // GPIO10 (D10)

// // /* ================= WIFI CONFIGURATION ================= */

// // const int WIFI_NETWORK_COUNT = 2;
// // const char* WIFI_SSIDS[WIFI_NETWORK_COUNT]     = { "Wehara's A07", "Hiruni" };
// // const char* WIFI_PASSWORDS[WIFI_NETWORK_COUNT] = { "wehara1216",   "Hiruni2022" };

// // // --- EMQX CLOUD BROKER CONFIGURATION ---
// // const char* MQTT_BROKER = "ob1f0f10.ala.asia-southeast1.emqxsl.com";
// // const int   MQTT_PORT   = 8883;
// // const char* MQTT_USER   = "wearable02";
// // const char* MQTT_PASS   = "wearable02";
// // const char* MQTT_TOPIC  = "mindpulse/wearable02/eeg";
// // const char* MQTT_STATUS = "mindpulse/wearable02/status";

// // const char* EMQX_CA_CERT = R"EOF(
// // -----BEGIN CERTIFICATE-----
// // MIIDjjCCAnagAwIBAgIQAzrx5qcRqaC7KGSxHQn65TANBgkqhkiG9w0BAQsFADBh
// // MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
// // d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
// // MjAeFw0xMzA4MDExMjAwMDBaFw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVT
// // MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
// // b20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IEcyMIIBIjANBgkqhkiG
// // 9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuzfNNNx7a8myaJCtSnX/RrohCgiN9RlUyfuI
// // 2/Ou8jqJkTx65qsGGmvPrC3oXgkkRLpimn7Wo6h+4FR1IAWsULecYxpsMNzaHxmx
// // 1x7e/dfgy5SDN67sH0NO3Xss0r0upS/kqbitOtSZpLYl6ZtrAGCSYP9PIUkY92eQ
// // q2EGnI/yuum06ZIya7XzV+hdG82MHauVBJVJ8zUtluNJbd134/tJS7SsVQepj5Wz
// // tCO7TG1F8PapspUwtP1MVYwnSlcUfIKdzXOS0xZKBgyMUNGPHgm+F6HmIcr9g+UQ
// // vIOlCsRnKPZzFBQ9RnbDhxSJITRNrw9FDKZJobq7nMWxM4MphQIDAQABo0IwQDAP
// // BgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNVHQ4EFgQUTiJUIBiV
// // 5uNu5g/6+rkS7QYXjzkwDQYJKoZIhvcNAQELBQADggEBAGBnKJRvDkhj6zHd6mcY
// // 1Yl9PMWLSn/pvtsrF9+wX3N3KjITOYFnQoQj8kVnNeyIv/iPsGEMNKSuIEyExtv4
// // NeF22d+mQrvHRAiGfzZ0JFrabA0UWTW98kndth/Jsw1HKj2ZL7tcu7XUIOGZX1NG
// // Fdtom/DzMNU+MeKNhJ7jitralj41E6Vf8PlwUHBHQRFXGU7Aj64GxJUTFy8bJZ91
// // 8rGOmaFvE7FBcf6IKshPECBV1/MUReXgRPTqh5Uykw7+U0b6LJ3/iyK5S9kJRaTe
// // pLiaWN0bfVKfjllDiIGknibVb63dDcY3fe0Dkhvld1927jyNxF1WW6LZZm6zNTfl
// // MrY=
// // -----END CERTIFICATE-----
// // )EOF";

// // /* ================= ADS1292R COMMANDS & CONFIG ================= */

// // #define ADS_CMD_START   0x08
// // #define ADS_CMD_STOP    0x0A
// // #define ADS_CMD_RDATAC  0x10
// // #define ADS_CMD_SDATAC  0x11
// // #define ADS_CMD_WREG    0x40
// // #define ADS_CMD_RREG    0x20

// // #define BATCH_SIZE 25

// // // CH2SET (0x05) gain field, bits 6:4 -- ADS1292R datasheet: 000=6, 001=1,
// // // 010=2, 011=3, 100=4, 101=8, 110=12. The backend's BIPOLAR_GAIN
// // // (backend/psychological/realtime/adc.py) MUST equal CH2_GAIN; it converts
// // // the raw codes this device sends into microvolts with it.
// // #define CH2_GAIN       8
// // #define CH2SET_VALUE   0x50   // gain 8 (101 << 4), normal electrode input (MUX 000)
// // #define UV_PER_COUNT   (2.42f / (CH2_GAIN * 8388607.0f) * 1e6f)   // 0.0360608 uV/count

// // // Lead-off: DC current (6 nA) injected into IN2P/IN2N; the comparators
// // // flag an input whose voltage drifts past 95% of the rail, i.e. an electrode
// // // that is off or has no contact. Status bits arrive with every sample.
// // #define CONFIG2_VALUE  0xE0   // bit7=1 (required), PDB_LOFF_COMP=1, PDB_REFBUF=1, VREF 2.42 V
// // #define LOFF_VALUE     0x10   // COMP_TH=95%, bit4=1 (required), ILEAD_OFF=6 nA, DC lead-off
// // #define LOFF_SENS_VALUE 0x0C  // LOFF2N | LOFF2P -- sense channel 2's inputs only
// // // Status byte 0 = 1100 + LOFF_STAT[4:1]  ->  bit3 = RLD off, bit2 = IN2N off, bit1 = IN2P off
// // #define STAT_RLD_OFF   0x08
// // #define STAT_IN2N_OFF  0x04
// // #define STAT_IN2P_OFF  0x02
// // // RLD_SENS (0x06): PDB_RLD=1 (RLD buffer on), RLD_LOFF_SENS=1 (bias
// // // electrode lead-off sensing -> RLD_STAT), RLD derived from IN2P + IN2N.
// // // UNVERIFIED on this board: if loff_rld reads 1.00 with the bias electrode
// // // firmly on, or stays 0.00 with it removed, RLD sensing isn't working in
// // // continuous mode -- set this back to 0x2C and check the bias contact by hand.
// // #define RLD_SENS_VALUE 0x3C

// // // Share of samples with each EEG input flagged off since the last
// // // heartbeat -- reported in the 5 s status message.
// // uint32_t loffFrames = 0, loffIn2pOff = 0, loffIn2nOff = 0, loffRldOff = 0;

// // uint32_t batchTime[BATCH_SIZE];
// // int32_t  batchCh2[BATCH_SIZE];
// // uint8_t  batchCount = 0;
// // uint32_t corruptFrameCount = 0;

// // /* ================= SYSTEM OBJECTS ================= */

// // WiFiClientSecure wifiClient;
// // PubSubClient mqtt(wifiClient);

// // SPISettings adsSPI(100000, MSBFIRST, SPI_MODE1); // Kept at 100kHz for stability
// // volatile bool drdyFlag = false;
// // unsigned long lastDrdyTimestamp = 0;
// // unsigned long lastHeartbeatTime = 0;

// // // MQTT client id is kept fixed as "wearable02" (not a per-boot unique id) --
// // // deliberate, to keep exactly one entry for this device in the EMQX client
// // // dashboard rather than a new one every reboot (same reasoning as not
// // // spinning up a new calibration client per attempt, elsewhere in this
// // // system). See maintainMQTT()'s comment for the tradeoff this implies.

// // void IRAM_ATTR onDrdy() {
// //   drdyFlag = true;
// //   // DIAGNOSIS ("drdy issue"): this used to be set in loop() instead, at the
// //   // point the flag got processed -- but loop() can be blocked for seconds
// //   // at a time inside connectWiFi() (or, before the mqtt.connect() timeout
// //   // fix above, inside a hung TLS handshake), during which this timestamp
// //   // never advanced even though the ADS1292R itself kept pulsing DRDY the
// //   // whole time. The 5s heartbeat's "[WARNING] DRDY interrupt stopped
// //   // pulsing!" check reads this timestamp, so any long-enough loop() stall
// //   // was making that warning fire as a FALSE POSITIVE -- reporting "DRDY
// //   // stopped" when really it was just loop() that stopped reading it. Timing
// //   // it here instead measures the real hardware signal, independent of
// //   // whatever loop() is doing. If the warning still appears with no
// //   // WiFi/MQTT reconnect happening nearby, that points at a genuine
// //   // ADS1292R/SPI/power issue instead of this false-positive mechanism.
// //   lastDrdyTimestamp = millis();
// // }

// // /* ================= SPI HELPERS ================= */

// // void sendCommand(byte cmd) {
// //   SPI.beginTransaction(adsSPI);
// //   digitalWrite(ADS_PIN_CS, LOW);
// //   delayMicroseconds(10);
// //   SPI.transfer(cmd);
// //   digitalWrite(ADS_PIN_CS, HIGH);
// //   SPI.endTransaction();
// //   delay(2);
// // }

// // void writeReg(byte reg, byte val) {
// //   SPI.beginTransaction(adsSPI);
// //   digitalWrite(ADS_PIN_CS, LOW);
// //   delayMicroseconds(10);
// //   SPI.transfer(ADS_CMD_WREG | reg);
// //   SPI.transfer(0x00);
// //   SPI.transfer(val);
// //   digitalWrite(ADS_PIN_CS, HIGH);
// //   SPI.endTransaction();
// //   delay(10);
// // }

// // byte readReg(byte reg) {
// //   SPI.beginTransaction(adsSPI);
// //   digitalWrite(ADS_PIN_CS, LOW);
// //   delayMicroseconds(10);
// //   SPI.transfer(ADS_CMD_RREG | reg);
// //   SPI.transfer(0x00);
// //   byte val = SPI.transfer(0x00);
// //   digitalWrite(ADS_PIN_CS, HIGH);
// //   SPI.endTransaction();
// //   delay(5);
// //   return val;
// // }

// // bool verifiedWrite(byte reg, byte value) {
// //   writeReg(reg, value);
// //   byte check = readReg(reg);
// //   if (check != value) {
// //     Serial.print("WRITE FAIL REG 0x");
// //     Serial.print(reg, HEX);
// //     Serial.print(" expected 0x");
// //     Serial.print(value, HEX);
// //     Serial.print(" got 0x");
// //     Serial.println(check, HEX);
// //     return false;
// //   }
// //   return true;
// // }

// // int32_t parseSigned24(byte msb, byte mid, byte lsb) {
// //   int32_t val = ((int32_t)msb << 16) | ((int32_t)mid << 8) | lsb;
// //   if (val & 0x800000) {
// //     val |= 0xFF000000;
// //   }
// //   return val;
// // }

// // bool isStatusValid(byte s0) {
// //   return (s0 & 0xF0) == 0xC0;
// // }

// // /* ================= NETWORK SERVICES ================= */

// // void connectWiFi() {
// //   WiFi.mode(WIFI_STA);
// //   // Lets the driver silently reassociate on its own after a brief drop --
// //   // see WIFI_RECONNECT_GRACE_MS's comment below for why this matters.
// //   WiFi.setAutoReconnect(true);
// //   // Lower TX power -- confirmed working over USB (ample current) but not on
// //   // battery, which points at the WiFi radio's TX current spike (default max
// //   // is ~19.5dBm, drawing several hundred mA in bursts) browning out a
// //   // battery that can't source that peak. Dropped further to 8.5dBm from an
// //   // earlier 11dBm -- still browning out on a 600mAh/3.7V LiPo (small cell,
// //   // unknown discharge rating -- likely can't source even the reduced spike
// //   // without voltage sag), so cutting the peak further. Raise this back up
// //   // (max WIFI_POWER_19_5dBm) if range turns out to be a problem once
// //   // brownouts are ruled out; if 8.5dBm still browns out, the battery itself
// //   // (charge level or discharge/C rating) is the limiting factor, not TX
// //   // power -- a bulk capacitor across the battery rail or a better-rated
// //   // cell would be the next step, not a further firmware change.
// //   WiFi.setTxPower(WIFI_POWER_8_5dBm);
// //   for (int i = 0; i < WIFI_NETWORK_COUNT; i++) {
// //     WiFi.disconnect(true, true);
// //     delay(100);

// //     Serial.print("Connecting WiFi: ");
// //     Serial.println(WIFI_SSIDS[i]);
// //     WiFi.begin(WIFI_SSIDS[i], WIFI_PASSWORDS[i]);

// //     int attempts = 0;
// //     while (WiFi.status() != WL_CONNECTED && attempts < 30) {
// //       delay(300);
// //       Serial.print(".");
// //       attempts++;
// //     }

// //     if (WiFi.status() == WL_CONNECTED) {
// //       Serial.println();
// //       Serial.println("WiFi connected: " + String(WIFI_SSIDS[i]));
// //       Serial.print("IP Address: ");
// //       Serial.println(WiFi.localIP());
// //       // Was setSleep(false) -- fine on USB, but on battery that keeps the
// //       // radio fully awake between transmissions instead of using WiFi's own
// //       // modem-sleep power saving, raising sustained average draw for no
// //       // benefit this app needs (samples publish in ~1s batches, not
// //       // latency-critical). true re-enables modem sleep.
// //       WiFi.setSleep(true);
// //       return;
// //     }
// //     Serial.println();
// //   }
// //   Serial.println("WiFi connection failed across all configurations.");
// // }

// // unsigned long lastMqttAttempt = 0;
// // const unsigned long MQTT_RETRY_INTERVAL_MS = 2000;

// // // loop() used to call the full blocking connectWiFi() (up to ~9s of
// // // delay()-spinning PER configured SSID) on every single iteration where
// // // WiFi wasn't connected -- during which mqtt.loop(), the heartbeat, and
// // // DRDY sample draining all stall completely. A brief drop (AP roam,
// // // momentary RF interference) turned into several seconds of total device
// // // silence, repeatedly, which is what "sometimes the connection just fails"
// // // looks like from the app side. Two changes fix this:
// // //   1. WiFi.setAutoReconnect(true) (set inside connectWiFi(), above) lets the
// // //      ESP32 driver itself silently reassociate to the AP it just dropped,
// // //      almost always within under a second, with no loop() involvement at
// // //      all -- covers the common transient-blip case for free.
// // // 2. loop() only falls back to the expensive full multi-SSID
// // //      connectWiFi() scan after WiFi has been down continuously for
// // //      WIFI_RECONNECT_GRACE_MS (giving setAutoReconnect a real chance to
// // //      recover first), and even then at most once per
// // //      WIFI_RECONNECT_RETRY_MS -- instead of re-entering it back-to-back
// // //      on every loop() tick while still down.
// // unsigned long wifiDownSince = 0;
// // unsigned long lastWifiReconnectAttempt = 0;
// // const unsigned long WIFI_RECONNECT_GRACE_MS = 4000;
// // const unsigned long WIFI_RECONNECT_RETRY_MS = 10000;

// // void maintainMQTT() {
// //   if (mqtt.connected()) return;
// //   unsigned long now = millis();
// //   if (now - lastMqttAttempt < MQTT_RETRY_INTERVAL_MS) return;
// //   lastMqttAttempt = now;

// //   // Fixed client id "wearable02", deliberately not unique-per-boot -- see
// //   // the comment above this device's global state (near lastDrdyTimestamp).
// //   // Known tradeoff: right after a FAST reconnect (e.g. a manual reset,
// //   // which never cuts power and so cycles much quicker than an off/on power
// //   // cycle), EMQX may briefly still consider the previous session (same
// //   // client id) alive and reject or delay this connect attempt -- the MQTT
// //   // spec says the broker should evict the stale session and accept the new
// //   // one, but that takeover isn't guaranteed instant. Not fixed by retrying
// //   // with a different id here (would defeat the point of keeping it fixed);
// //   // this function's own MQTT_RETRY_INTERVAL_MS loop already retries every
// //   // 2s regardless, which is what actually rides out that window.
// //   Serial.print("Connecting to EMQX MQTT Broker...");
// //   if (mqtt.connect("wearable02", MQTT_USER, MQTT_PASS)) {
// //     Serial.println(" Connected");
// //     char online[96];
// //     snprintf(online, sizeof(online), "{\"status\":\"ONLINE\",\"mode\":\"BIPOLAR_T7_T8\",\"gain\":%d,\"lead_off\":1}", CH2_GAIN);
// //     mqtt.publish(MQTT_STATUS, online);
// //   } else {
// //     Serial.print(" Failed, rc=");
// //     Serial.println(mqtt.state());
// //   }
// // }

// // /* ================= ADS1292R OPTION B CONFIGURATION ================= */

// // bool initADS() {
// //   Serial.println("Configuring ADS1292R for Option B (1-Channel Bipolar T7-T8)...");

// //   // --- NEW: Wake up the chip before doing anything ---
// //   sendCommand(0x02); // WAKEUP Command
// //   delay(100);

// //   sendCommand(ADS_CMD_SDATAC);
// //   delay(100);

// //   // CONFIG1 (0x01): 250 SPS data rate -> 0x01
// //   if (!verifiedWrite(0x01, 0x01)) return false;

// //   // CONFIG2 (0x02): lead-off comparators ON, PDB_REFBUF = 1, VREF = 2.42V
// //   // (was 0xA0: comparators powered down, so lead-off was never detected)
// //   if (!verifiedWrite(0x02, CONFIG2_VALUE)) return false;

// //   // LOFF (0x03): DC lead-off, 6 nA, 95% threshold -- see LOFF_VALUE
// //   if (!verifiedWrite(0x03, LOFF_VALUE)) return false;

// //   // CH1SET (0x04): Power-down Ch1 & short input -> 0x81
// //   if (!verifiedWrite(0x04, 0x81)) return false;

// //   // CH2SET (0x05): gain CH2_GAIN, normal electrode input -- see CH2SET_VALUE
// //   if (!verifiedWrite(0x05, CH2SET_VALUE)) return false;

// //   // RLD_SENS (0x06): see RLD_SENS_VALUE (was 0x2C: no bias lead-off sensing)
// //   if (!verifiedWrite(0x06, RLD_SENS_VALUE)) return false;

// //   // LOFF_SENS (0x07): lead-off sensing on channel 2's inputs -- see LOFF_SENS_VALUE
// //   if (!verifiedWrite(0x07, LOFF_SENS_VALUE)) return false;

// //   // RESP1 (0x09): Disable respiration circuitry -> 0x00
// //   if (!verifiedWrite(0x09, 0x00)) return false;

// //   // RESP2 (0x0A): Set internal RLD reference to midsupply (RLDREF_INT = 1) -> 0x02
// //   if (!verifiedWrite(0x0A, 0x02)) return false;
// //   delay(100);

// //   attachInterrupt(digitalPinToInterrupt(ADS_PIN_DRDY), onDrdy, FALLING);

// //   sendCommand(ADS_CMD_RDATAC);
// //   delay(50);

// //   sendCommand(ADS_CMD_START);
// //   digitalWrite(ADS_PIN_START, HIGH);

// //   Serial.println("Option B Streaming Initialized.");
// //   return true;
// // }

// // /* ================= MQTT TRANSMISSION ================= */

// // void publishBatch() {
// //   if (mqtt.connected()) {
// //     static char payload[600];
// //     int offset = 0;

// //     for (uint8_t i = 0; i < batchCount; i++) {
// //       int n = snprintf(
// //           payload + offset, sizeof(payload) - offset,
// //           "%lu,%ld;",
// //           batchTime[i], batchCh2[i]
// //       );
// //       if (n < 0 || offset + n >= (int)sizeof(payload)) break;
// //       offset += n;
// //     }

// //     bool ok = mqtt.publish(MQTT_TOPIC, payload);
// //     if (!ok) {
// //       Serial.println("[MQTT] Publish batch drop");
// //     }
// //   }
// //   batchCount = 0;
// // }

// // /* ================= SETUP ================= */

// // void printResetReason() {
// //   esp_reset_reason_t reason = esp_reset_reason();
// //   const char* reasonStr;
// //   switch (reason) {
// //     case ESP_RST_POWERON:  reasonStr = "POWERON (normal power-up)"; break;
// //     case ESP_RST_EXT:      reasonStr = "EXT (external reset pin)"; break;
// //     case ESP_RST_SW:       reasonStr = "SW (software/programmer-triggered reset)"; break;
// //     case ESP_RST_PANIC:    reasonStr = "PANIC (crash/exception)"; break;
// //     case ESP_RST_INT_WDT:  reasonStr = "INT_WDT (interrupt watchdog -- something blocked too long)"; break;
// //     case ESP_RST_TASK_WDT: reasonStr = "TASK_WDT (task watchdog -- something blocked too long)"; break;
// //     case ESP_RST_WDT:      reasonStr = "WDT (other watchdog)"; break;
// //     case ESP_RST_BROWNOUT: reasonStr = "BROWNOUT -- supply voltage sagged below threshold. Check battery charge/cable, not code."; break;
// //     case ESP_RST_SDIO:     reasonStr = "SDIO"; break;
// //     default:               reasonStr = "UNKNOWN"; break;
// //   }
// //   Serial.print("[boot] Reset reason: ");
// //   Serial.println(reasonStr);
// // }

// // void setup() {
// //   Serial.begin(115200); // Fixed baud rate

// //   // DELIBERATELY REMOVED the while (!Serial) loop!
// //   // Do not wait for USB when running on a battery.

// //   printResetReason();  // first thing printed -- see its own comment above

// //   Serial.println("\n=================================");
// //   Serial.println("  OPTION B: BIPOLAR T7-T8 EEG    ");
// //   Serial.println("=================================");

// //   pinMode(ADS_PIN_CS, OUTPUT);
// //   pinMode(ADS_PIN_RESET, OUTPUT);
// //   pinMode(ADS_PIN_START, OUTPUT);
// //   pinMode(ADS_PIN_DRDY, INPUT_PULLUP);

// //   digitalWrite(ADS_PIN_CS, HIGH);
// //   digitalWrite(ADS_PIN_START, LOW);

// //   SPI.begin(SPI_PIN_SCK, SPI_PIN_MISO, SPI_PIN_MOSI, -1);

// //   // Hardware Reset Pulse
// //   digitalWrite(ADS_PIN_RESET, LOW);
// //   delay(300);
// //   digitalWrite(ADS_PIN_RESET, HIGH);
// //   delay(1000);

// //   // DIAGNOSIS (power-cycle-specific reconnect failure): confirmed earlier
// //   // this session that this LiPo (600mAh/3.7V, unknown C-rating) browns out
// //   // under the WiFi TX association burst alone (fixed via setTxPower +
// //   // setSleep). A fresh power-cycle stacks THREE current draws close
// //   // together that a mid-session WiFi reconnect never has to -- regulator
// //   // startup inrush, the ADS1292R hardware reset pulse just above, and then
// //   // the WiFi TX burst only ~1.3s later -- while a runtime reconnect only
// //   // ever faces the WiFi burst alone, on a rail that's had much longer to
// //   // recover. This extra settle delay gives the rail more time to recover
// //   // from the ADS reset inrush specifically before adding WiFi's TX burst on
// //   // top. NOT confirmed against a real reset-reason log from a failed
// //   // power-cycle (still don't have one) -- if this doesn't fully fix it,
// //   // check Serial for "BROWNOUT" (see printResetReason() above) right after
// //   // a failed power-cycle attempt to confirm vs. rule this out.
// //   delay(500);

// //   connectWiFi();

// //   // Restored Certificate for secure connection
// //   wifiClient.setCACert(EMQX_CA_CERT);

// //   // ADDED FIX: Bypass the 1970 time-check failure!
// //   wifiClient.setInsecure();

// //   // DIAGNOSIS (MQTT "connection fails" contributor): mqtt.connect() below
// //   // does a blocking TCP+TLS handshake to EMQX Cloud with no explicit
// //   // timeout ever set -- same freeze-everything risk WIFI_RECONNECT_GRACE_MS
// //   // above fixes for WiFi, just unbounded on the MQTT side (core-default
// //   // timeouts vary by ESP32 Arduino core version, so relying on the default
// //   // is exactly the kind of implicit assumption that bit this file before --
// //   // see the "1970 time-check failure" comment above). Bounding both layers
// //   // explicitly: the underlying TLS socket connect, and PubSubClient's own
// //   // post-connect read/write socket timeout.
// //   wifiClient.setTimeout(5000);       // ms -- caps the TLS handshake itself
// //   mqtt.setSocketTimeout(5);          // seconds -- PubSubClient's own read/write timeout

// //   mqtt.setServer(MQTT_BROKER, MQTT_PORT);
// //   mqtt.setBufferSize(1024);
// //   maintainMQTT();

// //   if (!initADS()) {
// //     Serial.println("[FATAL] ADS1292R initialization failed! Checking SPI lines.");
// //     while (true) {
// //       delay(100);
// //     }
// //   }

// //   lastDrdyTimestamp = millis();
// // }

// // /* ================= LOOP ================= */

// // void loop() {
// //   if (WiFi.status() != WL_CONNECTED) {
// //     unsigned long now = millis();
// //     if (wifiDownSince == 0) wifiDownSince = now;
// //     // Give WiFi.setAutoReconnect() a real chance to silently recover from a
// //     // brief drop before paying for the full blocking multi-SSID scan, and
// //     // even then don't re-enter it more than once per retry window.
// //     if (now - wifiDownSince >= WIFI_RECONNECT_GRACE_MS
// //         && now - lastWifiReconnectAttempt >= WIFI_RECONNECT_RETRY_MS) {
// //       lastWifiReconnectAttempt = now;
// //       connectWiFi();
// //     }
// //   } else {
// //     wifiDownSince = 0;
// //   }

// //   maintainMQTT();
// //   mqtt.loop();

// //   // 5-second Watchdog & Heartbeat
// //   if (millis() - lastHeartbeatTime > 5000) {
// //     lastHeartbeatTime = millis();
// //     bool drdyActive = (millis() - lastDrdyTimestamp < 1000);
// //     if (!drdyActive) {
// //       Serial.println("[WARNING] DRDY interrupt stopped pulsing!");
// //     }
// //     // Lead-off over the last 5 s, as the share of samples (0-1) with each
// //     // EEG input flagged off. Anything well above 0 = re-seat that electrode.
// //     float offP = loffFrames ? (float)loffIn2pOff / loffFrames : 0.0f;
// //     float offN = loffFrames ? (float)loffIn2nOff / loffFrames : 0.0f;
// //     float offR = loffFrames ? (float)loffRldOff / loffFrames : 0.0f;
// //     // Only detects an electrode that is fully off (input past 95% of the
// //     // rail) -- poor-but-present contact still shows up only in the signal
// //     // quality checks (RMS, out-of-range share, delta power).
// //     if (offP > 0.5f || offN > 0.5f || offR > 0.5f) {
// //       Serial.print("[WARNING] Electrode off: ");
// //       if (offP > 0.5f) Serial.print("IN2P ");
// //       if (offN > 0.5f) Serial.print("IN2N ");
// //       if (offR > 0.5f) Serial.print("BIAS(RLD) ");
// //       Serial.println();
// //     }
// //     loffFrames = loffIn2pOff = loffIn2nOff = loffRldOff = 0;
// //     if (mqtt.connected()) {
// //       char hb[160];
// //       snprintf(hb, sizeof(hb), "{\"uptime_ms\":%lu,\"drdy_ok\":%d,\"loff_in2p\":%.2f,\"loff_in2n\":%.2f,\"loff_rld\":%.2f}",
// //                millis(), drdyActive ? 1 : 0, offP, offN, offR);
// //       mqtt.publish(MQTT_STATUS, hb);
// //     }
// //   }

// //   if (!drdyFlag) return;
// //   drdyFlag = false;
// //   // lastDrdyTimestamp is now set in onDrdy() itself, not here -- see its comment.

// //   byte r[9];
// //   SPI.beginTransaction(adsSPI);
// //   digitalWrite(ADS_PIN_CS, LOW);
// //   for (int i = 0; i < 9; i++) {
// //     r[i] = SPI.transfer(0x00);
// //   }
// //   digitalWrite(ADS_PIN_CS, HIGH);
// //   SPI.endTransaction();

// //   if (!isStatusValid(r[0])) {
// //     corruptFrameCount++;
// //     if (corruptFrameCount % 250 == 0) {
// //       Serial.print("Corrupted ADS frames: ");
// //       Serial.println(corruptFrameCount);
// //     }
// //     return;
// //   }

// //   loffFrames++;
// //   if (r[0] & STAT_IN2P_OFF) loffIn2pOff++;
// //   if (r[0] & STAT_IN2N_OFF) loffIn2nOff++;
// //   if (r[0] & STAT_RLD_OFF)  loffRldOff++;

// //   // Channel 2 (T7 - T8 Differential)
// //   int32_t raw_t7_t8 = parseSigned24(r[6], r[7], r[8]);
// //   uint32_t now = millis();

// //   // LSB = VREF / (gain * (2^23 - 1)) -- see UV_PER_COUNT. Serial readout
// //   // only; MQTT sends the raw code, which the backend converts itself.
// //   float t7_t8_uV = raw_t7_t8 * UV_PER_COUNT;

// //   /* =========================================== */
// //   /* --- MODIFIED FOR ARDUINO SERIAL PLOTTER --- */
// //   /* =========================================== */
// //   // Only printing the microvolt value with a label. 
  
// //   Serial.print("EEG(uV):");
// //   Serial.println(t7_t8_uV, 2);

// //   /* =========================================== */

// //   batchTime[batchCount] = now;
// //   batchCh2[batchCount]  = raw_t7_t8;
// //   batchCount++;

// //   if (batchCount >= BATCH_SIZE) {
// //     publishBatch();
// //   }
// // }




// #include <SPI.h>
// #include <WiFi.h>
// #include <WiFiClientSecure.h>
// #include <PubSubClient.h>
// #include "esp_system.h"

// /* ================= HARDWARE PIN DEFINITIONS (XIAO ESP32-C3) ================= */
// // Reverted to raw GPIO integers for generic ESP32-C3 board compatibility
// constexpr int8_t ADS_PIN_RESET = 2;   // GPIO2 (D0)
// constexpr int8_t ADS_PIN_START = 3;   // GPIO3 (D1)
// constexpr int8_t ADS_PIN_DRDY  = 4;   // GPIO4 (D2)
// constexpr int8_t ADS_PIN_CS    = 7;   // GPIO7 (D5)

// constexpr int8_t SPI_PIN_SCK   = 8;   // GPIO8 (D8)
// constexpr int8_t SPI_PIN_MISO  = 20;  // GPIO9 (D9)
// constexpr int8_t SPI_PIN_MOSI  = 10;  // GPIO10 (D10)

// /* ================= WIFI CONFIGURATION ================= */

// const int WIFI_NETWORK_COUNT = 2;
// const char* WIFI_SSIDS[WIFI_NETWORK_COUNT]     = { "Wehara's A07", "Hiruni" };
// const char* WIFI_PASSWORDS[WIFI_NETWORK_COUNT] = { "wehara1216",   "Hiruni2022" };

// // --- EMQX CLOUD BROKER CONFIGURATION ---
// const char* MQTT_BROKER = "ob1f0f10.ala.asia-southeast1.emqxsl.com";
// const int   MQTT_PORT   = 8883;
// const char* MQTT_USER   = "wearable02";
// const char* MQTT_PASS   = "wearable02";
// const char* MQTT_TOPIC  = "mindpulse/wearable02/eeg";
// const char* MQTT_STATUS = "mindpulse/wearable02/status";

// const char* EMQX_CA_CERT = R"EOF(
// -----BEGIN CERTIFICATE-----
// MIIDjjCCAnagAwIBAgIQAzrx5qcRqaC7KGSxHQn65TANBgkqhkiG9w0BAQsFADBh
// MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
// d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
// MjAeFw0xMzA4MDExMjAwMDBaFw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVT
// MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
// b20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IEcyMIIBIjANBgkqhkiG
// 9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuzfNNNx7a8myaJCtSnX/RrohCgiN9RlUyfuI
// 2/Ou8jqJkTx65qsGGmvPrC3oXgkkRLpimn7Wo6h+4FR1IAWsULecYxpsMNzaHxmx
// 1x7e/dfgy5SDN67sH0NO3Xss0r0upS/kqbitOtSZpLYl6ZtrAGCSYP9PIUkY92eQ
// q2EGnI/yuum06ZIya7XzV+hdG82MHauVBJVJ8zUtluNJbd134/tJS7SsVQepj5Wz
// tCO7TG1F8PapspUwtP1MVYwnSlcUfIKdzXOS0xZKBgyMUNGPHgm+F6HmIcr9g+UQ
// vIOlCsRnKPZzFBQ9RnbDhxSJITRNrw9FDKZJobq7nMWxM4MphQIDAQABo0IwQDAP
// BgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNVHQ4EFgQUTiJUIBiV
// 5uNu5g/6+rkS7QYXjzkwDQYJKoZIhvcNAQELBQADggEBAGBnKJRvDkhj6zHd6mcY
// 1Yl9PMWLSn/pvtsrF9+wX3N3KjITOYFnQoQj8kVnNeyIv/iPsGEMNKSuIEyExtv4
// NeF22d+mQrvHRAiGfzZ0JFrabA0UWTW98kndth/Jsw1HKj2ZL7tcu7XUIOGZX1NG
// Fdtom/DzMNU+MeKNhJ7jitralj41E6Vf8PlwUHBHQRFXGU7Aj64GxJUTFy8bJZ91
// 8rGOmaFvE7FBcf6IKshPECBV1/MUReXgRPTqh5Uykw7+U0b6LJ3/iyK5S9kJRaTe
// pLiaWN0bfVKfjllDiIGknibVb63dDcY3fe0Dkhvld1927jyNxF1WW6LZZm6zNTfl
// MrY=
// -----END CERTIFICATE-----
// )EOF";

// /* ================= ADS1292R COMMANDS & CONFIG ================= */

// #define ADS_CMD_START   0x08
// #define ADS_CMD_STOP    0x0A
// #define ADS_CMD_RDATAC  0x10
// #define ADS_CMD_SDATAC  0x11
// #define ADS_CMD_WREG    0x40
// #define ADS_CMD_RREG    0x20

// #define BATCH_SIZE 25

// // Wi-Fi transmit power. 8.5 dBm because higher settings browned out the
// // 600 mAh LiPo (see connectWiFi()). If the heartbeat's "rssi" is below about
// // -75 dBm or "pub_drops" is non-zero, first move closer to the router; on
// // USB power or a better battery, raise this to WIFI_POWER_15dBm (or up to
// // WIFI_POWER_19_5dBm) and watch Serial for a BROWNOUT reset reason.
// #define WIFI_TX_POWER  WIFI_POWER_8_5dBm

// // CH2SET (0x05) gain field, bits 6:4 -- ADS1292R datasheet: 000=6, 001=1,
// // 010=2, 011=3, 100=4, 101=8, 110=12. The backend's BIPOLAR_GAIN
// // (backend/psychological/realtime/adc.py) MUST equal CH2_GAIN; it converts
// // the raw codes this device sends into microvolts with it.
// #define CH2_GAIN       8
// #define CH2SET_VALUE   0x50   // gain 8 (101 << 4), normal electrode input (MUX 000)
// #define UV_PER_COUNT   (2.42f / (CH2_GAIN * 8388607.0f) * 1e6f)   // 0.0360608 uV/count

// // Lead-off: DC current (6 nA) injected into IN2P/IN2N; the comparators
// // flag an input whose voltage drifts past 95% of the rail, i.e. an electrode
// // that is off or has no contact. Status bits arrive with every sample.
// #define CONFIG2_VALUE  0xE0   // bit7=1 (required), PDB_LOFF_COMP=1, PDB_REFBUF=1, VREF 2.42 V
// #define LOFF_VALUE     0x10   // COMP_TH=95%, bit4=1 (required), ILEAD_OFF=6 nA, DC lead-off
// #define LOFF_SENS_VALUE 0x0C  // LOFF2N | LOFF2P -- sense channel 2's inputs only
// // Status byte 0 = 1100 + LOFF_STAT[4:1]  ->  bit3 = RLD off, bit2 = IN2N off, bit1 = IN2P off
// #define STAT_RLD_OFF   0x08
// #define STAT_IN2N_OFF  0x04
// #define STAT_IN2P_OFF  0x02
// // RLD_SENS (0x06): PDB_RLD=1 (RLD buffer on), RLD_LOFF_SENS=1 (bias
// // electrode lead-off sensing -> RLD_STAT), RLD derived from IN2P + IN2N.
// // UNVERIFIED on this board: if loff_rld reads 1.00 with the bias electrode
// // firmly on, or stays 0.00 with it removed, RLD sensing isn't working in
// // continuous mode -- set this back to 0x2C and check the bias contact by hand.
// #define RLD_SENS_VALUE 0x3C

// // Share of samples with each EEG input flagged off since the last
// // heartbeat -- reported in the 5 s status message.
// uint32_t loffFrames = 0, loffIn2pOff = 0, loffIn2nOff = 0, loffRldOff = 0;

// // Glitch diagnostics: a sample beyond +-GLITCH_UV is impossible for EEG
// // (e.g. the recurring 0x67BFF3 = ~245 mV code). Each one is logged to Serial
// // with its raw bytes and timing, to tell whether it lines up with the 5 s
// // heartbeat publish, a batch publish, a missed DRDY or a lead-off change.
// #define GLITCH_UV            100000.0f   // +-100 mV
// #define GLITCH_LOG_MAX       20          // Serial lines per heartbeat window
// volatile uint32_t drdyPulses = 0;        // counted in the ISR
// uint32_t framesRead = 0, glitchCount = 0, glitchLogged = 0, pubDrops = 0;
// unsigned long lastHeartbeatPublish = 0, lastBatchPublish = 0;

// uint32_t batchTime[BATCH_SIZE];
// int32_t  batchCh2[BATCH_SIZE];
// uint8_t  batchCount = 0;
// uint32_t corruptFrameCount = 0;

// /* ================= SYSTEM OBJECTS ================= */

// WiFiClientSecure wifiClient;
// PubSubClient mqtt(wifiClient);

// SPISettings adsSPI(100000, MSBFIRST, SPI_MODE1); // Kept at 100kHz for stability
// volatile bool drdyFlag = false;
// unsigned long lastDrdyTimestamp = 0;
// unsigned long lastHeartbeatTime = 0;

// // MQTT client id is kept fixed as "wearable02" (not a per-boot unique id) --
// // deliberate, to keep exactly one entry for this device in the EMQX client
// // dashboard rather than a new one every reboot (same reasoning as not
// // spinning up a new calibration client per attempt, elsewhere in this
// // system). See maintainMQTT()'s comment for the tradeoff this implies.

// void IRAM_ATTR onDrdy() {
//   drdyFlag = true;
//   drdyPulses++;
//   // DIAGNOSIS ("drdy issue"): this used to be set in loop() instead, at the
//   // point the flag got processed -- but loop() can be blocked for seconds
//   // at a time inside connectWiFi() (or, before the mqtt.connect() timeout
//   // fix above, inside a hung TLS handshake), during which this timestamp
//   // never advanced even though the ADS1292R itself kept pulsing DRDY the
//   // whole time. The 5s heartbeat's "[WARNING] DRDY interrupt stopped
//   // pulsing!" check reads this timestamp, so any long-enough loop() stall
//   // was making that warning fire as a FALSE POSITIVE -- reporting "DRDY
//   // stopped" when really it was just loop() that stopped reading it. Timing
//   // it here instead measures the real hardware signal, independent of
//   // whatever loop() is doing. If the warning still appears with no
//   // WiFi/MQTT reconnect happening nearby, that points at a genuine
//   // ADS1292R/SPI/power issue instead of this false-positive mechanism.
//   lastDrdyTimestamp = millis();
// }

// /* ================= SPI HELPERS ================= */

// void sendCommand(byte cmd) {
//   SPI.beginTransaction(adsSPI);
//   digitalWrite(ADS_PIN_CS, LOW);
//   delayMicroseconds(10);
//   SPI.transfer(cmd);
//   digitalWrite(ADS_PIN_CS, HIGH);
//   SPI.endTransaction();
//   delay(2);
// }

// void writeReg(byte reg, byte val) {
//   SPI.beginTransaction(adsSPI);
//   digitalWrite(ADS_PIN_CS, LOW);
//   delayMicroseconds(10);
//   SPI.transfer(ADS_CMD_WREG | reg);
//   SPI.transfer(0x00);
//   SPI.transfer(val);
//   digitalWrite(ADS_PIN_CS, HIGH);
//   SPI.endTransaction();
//   delay(10);
// }

// byte readReg(byte reg) {
//   SPI.beginTransaction(adsSPI);
//   digitalWrite(ADS_PIN_CS, LOW);
//   delayMicroseconds(10);
//   SPI.transfer(ADS_CMD_RREG | reg);
//   SPI.transfer(0x00);
//   byte val = SPI.transfer(0x00);
//   digitalWrite(ADS_PIN_CS, HIGH);
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
//     Serial.print(" expected 0x");
//     Serial.print(value, HEX);
//     Serial.print(" got 0x");
//     Serial.println(check, HEX);
//     return false;
//   }
//   return true;
// }

// int32_t parseSigned24(byte msb, byte mid, byte lsb) {
//   int32_t val = ((int32_t)msb << 16) | ((int32_t)mid << 8) | lsb;
//   if (val & 0x800000) {
//     val |= 0xFF000000;
//   }
//   return val;
// }

// bool isStatusValid(byte s0) {
//   return (s0 & 0xF0) == 0xC0;
// }

// /* ================= NETWORK SERVICES ================= */

// void connectWiFi() {
//   WiFi.mode(WIFI_STA);
//   // Lets the driver silently reassociate on its own after a brief drop --
//   // see WIFI_RECONNECT_GRACE_MS's comment below for why this matters.
//   WiFi.setAutoReconnect(true);
//   // Lower TX power -- confirmed working over USB (ample current) but not on
//   // battery, which points at the WiFi radio's TX current spike (default max
//   // is ~19.5dBm, drawing several hundred mA in bursts) browning out a
//   // battery that can't source that peak. Dropped further to 8.5dBm from an
//   // earlier 11dBm -- still browning out on a 600mAh/3.7V LiPo (small cell,
//   // unknown discharge rating -- likely can't source even the reduced spike
//   // without voltage sag), so cutting the peak further. Raise this back up
//   // (max WIFI_POWER_19_5dBm) if range turns out to be a problem once
//   // brownouts are ruled out; if 8.5dBm still browns out, the battery itself
//   // (charge level or discharge/C rating) is the limiting factor, not TX
//   // power -- a bulk capacitor across the battery rail or a better-rated
//   // cell would be the next step, not a further firmware change.
//   WiFi.setTxPower(WIFI_TX_POWER);
//   for (int i = 0; i < WIFI_NETWORK_COUNT; i++) {
//     WiFi.disconnect(true, true);
//     delay(100);

//     Serial.print("Connecting WiFi: ");
//     Serial.println(WIFI_SSIDS[i]);
//     WiFi.begin(WIFI_SSIDS[i], WIFI_PASSWORDS[i]);

//     int attempts = 0;
//     while (WiFi.status() != WL_CONNECTED && attempts < 30) {
//       delay(300);
//       Serial.print(".");
//       attempts++;
//     }

//     if (WiFi.status() == WL_CONNECTED) {
//       Serial.println();
//       Serial.println("WiFi connected: " + String(WIFI_SSIDS[i]));
//       Serial.print("IP Address: ");
//       Serial.println(WiFi.localIP());
//       // Was setSleep(false) -- fine on USB, but on battery that keeps the
//       // radio fully awake between transmissions instead of using WiFi's own
//       // modem-sleep power saving, raising sustained average draw for no
//       // benefit this app needs (samples publish in ~1s batches, not
//       // latency-critical). true re-enables modem sleep.
//       WiFi.setSleep(true);
//       return;
//     }
//     Serial.println();
//   }
//   Serial.println("WiFi connection failed across all configurations.");
// }

// unsigned long lastMqttAttempt = 0;
// const unsigned long MQTT_RETRY_INTERVAL_MS = 2000;

// // loop() used to call the full blocking connectWiFi() (up to ~9s of
// // delay()-spinning PER configured SSID) on every single iteration where
// // WiFi wasn't connected -- during which mqtt.loop(), the heartbeat, and
// // DRDY sample draining all stall completely. A brief drop (AP roam,
// // momentary RF interference) turned into several seconds of total device
// // silence, repeatedly, which is what "sometimes the connection just fails"
// // looks like from the app side. Two changes fix this:
// //   1. WiFi.setAutoReconnect(true) (set inside connectWiFi(), above) lets the
// //      ESP32 driver itself silently reassociate to the AP it just dropped,
// //      almost always within under a second, with no loop() involvement at
// //      all -- covers the common transient-blip case for free.
// // 2. loop() only falls back to the expensive full multi-SSID
// //      connectWiFi() scan after WiFi has been down continuously for
// //      WIFI_RECONNECT_GRACE_MS (giving setAutoReconnect a real chance to
// //      recover first), and even then at most once per
// //      WIFI_RECONNECT_RETRY_MS -- instead of re-entering it back-to-back
// //      on every loop() tick while still down.
// unsigned long wifiDownSince = 0;
// unsigned long lastWifiReconnectAttempt = 0;
// const unsigned long WIFI_RECONNECT_GRACE_MS = 4000;
// const unsigned long WIFI_RECONNECT_RETRY_MS = 10000;

// void maintainMQTT() {
//   if (mqtt.connected()) return;
//   unsigned long now = millis();
//   if (now - lastMqttAttempt < MQTT_RETRY_INTERVAL_MS) return;
//   lastMqttAttempt = now;

//   // Fixed client id "wearable02", deliberately not unique-per-boot -- see
//   // the comment above this device's global state (near lastDrdyTimestamp).
//   // Known tradeoff: right after a FAST reconnect (e.g. a manual reset,
//   // which never cuts power and so cycles much quicker than an off/on power
//   // cycle), EMQX may briefly still consider the previous session (same
//   // client id) alive and reject or delay this connect attempt -- the MQTT
//   // spec says the broker should evict the stale session and accept the new
//   // one, but that takeover isn't guaranteed instant. Not fixed by retrying
//   // with a different id here (would defeat the point of keeping it fixed);
//   // this function's own MQTT_RETRY_INTERVAL_MS loop already retries every
//   // 2s regardless, which is what actually rides out that window.
//   Serial.print("Connecting to EMQX MQTT Broker...");
//   if (mqtt.connect("wearable02", MQTT_USER, MQTT_PASS)) {
//     Serial.println(" Connected");
//     char online[96];
//     snprintf(online, sizeof(online), "{\"status\":\"ONLINE\",\"mode\":\"BIPOLAR_T7_T8\",\"gain\":%d,\"lead_off\":1}", CH2_GAIN);
//     mqtt.publish(MQTT_STATUS, online);
//   } else {
//     Serial.print(" Failed, rc=");
//     Serial.println(mqtt.state());
//   }
// }

// /* ================= ADS1292R OPTION B CONFIGURATION ================= */

// bool initADS() {
//   Serial.println("Configuring ADS1292R for Option B (1-Channel Bipolar T7-T8)...");

//   // --- NEW: Wake up the chip before doing anything ---
//   sendCommand(0x02); // WAKEUP Command
//   delay(100);

//   sendCommand(ADS_CMD_SDATAC);
//   delay(100);

//   // CONFIG1 (0x01): 250 SPS data rate -> 0x01
//   if (!verifiedWrite(0x01, 0x01)) return false;

//   // CONFIG2 (0x02): lead-off comparators ON, PDB_REFBUF = 1, VREF = 2.42V
//   // (was 0xA0: comparators powered down, so lead-off was never detected)
//   if (!verifiedWrite(0x02, CONFIG2_VALUE)) return false;

//   // LOFF (0x03): DC lead-off, 6 nA, 95% threshold -- see LOFF_VALUE
//   if (!verifiedWrite(0x03, LOFF_VALUE)) return false;

//   // CH1SET (0x04): Power-down Ch1 & short input -> 0x81
//   if (!verifiedWrite(0x04, 0x81)) return false;

//   // CH2SET (0x05): gain CH2_GAIN, normal electrode input -- see CH2SET_VALUE
//   if (!verifiedWrite(0x05, CH2SET_VALUE)) return false;

//   // RLD_SENS (0x06): see RLD_SENS_VALUE (was 0x2C: no bias lead-off sensing)
//   if (!verifiedWrite(0x06, RLD_SENS_VALUE)) return false;

//   // LOFF_SENS (0x07): lead-off sensing on channel 2's inputs -- see LOFF_SENS_VALUE
//   if (!verifiedWrite(0x07, LOFF_SENS_VALUE)) return false;

//   // RESP1 (0x09): Disable respiration circuitry -> 0x00
//   if (!verifiedWrite(0x09, 0x00)) return false;

//   // RESP2 (0x0A): Set internal RLD reference to midsupply (RLDREF_INT = 1) -> 0x02
//   if (!verifiedWrite(0x0A, 0x02)) return false;
//   delay(100);

//   attachInterrupt(digitalPinToInterrupt(ADS_PIN_DRDY), onDrdy, FALLING);

//   sendCommand(ADS_CMD_RDATAC);
//   delay(50);

//   sendCommand(ADS_CMD_START);
//   digitalWrite(ADS_PIN_START, HIGH);

//   Serial.println("Option B Streaming Initialized.");
//   return true;
// }

// /* ================= MQTT TRANSMISSION ================= */

// void publishBatch() {
//   if (mqtt.connected()) {
//     static char payload[600];
//     int offset = 0;

//     for (uint8_t i = 0; i < batchCount; i++) {
//       int n = snprintf(
//           payload + offset, sizeof(payload) - offset,
//           "%lu,%ld;",
//           batchTime[i], batchCh2[i]
//       );
//       if (n < 0 || offset + n >= (int)sizeof(payload)) break;
//       offset += n;
//     }

//     bool ok = mqtt.publish(MQTT_TOPIC, payload);
//     lastBatchPublish = millis();
//     if (!ok) {
//       pubDrops++;
//       Serial.println("[MQTT] Publish batch drop");
//     }
//   }
//   batchCount = 0;
// }

// /* ================= SETUP ================= */

// void printResetReason() {
//   esp_reset_reason_t reason = esp_reset_reason();
//   const char* reasonStr;
//   switch (reason) {
//     case ESP_RST_POWERON:  reasonStr = "POWERON (normal power-up)"; break;
//     case ESP_RST_EXT:      reasonStr = "EXT (external reset pin)"; break;
//     case ESP_RST_SW:       reasonStr = "SW (software/programmer-triggered reset)"; break;
//     case ESP_RST_PANIC:    reasonStr = "PANIC (crash/exception)"; break;
//     case ESP_RST_INT_WDT:  reasonStr = "INT_WDT (interrupt watchdog -- something blocked too long)"; break;
//     case ESP_RST_TASK_WDT: reasonStr = "TASK_WDT (task watchdog -- something blocked too long)"; break;
//     case ESP_RST_WDT:      reasonStr = "WDT (other watchdog)"; break;
//     case ESP_RST_BROWNOUT: reasonStr = "BROWNOUT -- supply voltage sagged below threshold. Check battery charge/cable, not code."; break;
//     case ESP_RST_SDIO:     reasonStr = "SDIO"; break;
//     default:               reasonStr = "UNKNOWN"; break;
//   }
//   Serial.print("[boot] Reset reason: ");
//   Serial.println(reasonStr);
// }

// void setup() {
//   Serial.begin(115200); // Fixed baud rate

//   // DELIBERATELY REMOVED the while (!Serial) loop!
//   // Do not wait for USB when running on a battery.

//   printResetReason();  // first thing printed -- see its own comment above

//   Serial.println("\n=================================");
//   Serial.println("  OPTION B: BIPOLAR T7-T8 EEG    ");
//   Serial.println("=================================");

//   pinMode(ADS_PIN_CS, OUTPUT);
//   pinMode(ADS_PIN_RESET, OUTPUT);
//   pinMode(ADS_PIN_START, OUTPUT);
//   pinMode(ADS_PIN_DRDY, INPUT_PULLUP);

//   digitalWrite(ADS_PIN_CS, HIGH);
//   digitalWrite(ADS_PIN_START, LOW);

//   SPI.begin(SPI_PIN_SCK, SPI_PIN_MISO, SPI_PIN_MOSI, -1);

//   // Hardware Reset Pulse
//   digitalWrite(ADS_PIN_RESET, LOW);
//   delay(300);
//   digitalWrite(ADS_PIN_RESET, HIGH);
//   delay(1000);

//   // DIAGNOSIS (power-cycle-specific reconnect failure): confirmed earlier
//   // this session that this LiPo (600mAh/3.7V, unknown C-rating) browns out
//   // under the WiFi TX association burst alone (fixed via setTxPower +
//   // setSleep). A fresh power-cycle stacks THREE current draws close
//   // together that a mid-session WiFi reconnect never has to -- regulator
//   // startup inrush, the ADS1292R hardware reset pulse just above, and then
//   // the WiFi TX burst only ~1.3s later -- while a runtime reconnect only
//   // ever faces the WiFi burst alone, on a rail that's had much longer to
//   // recover. This extra settle delay gives the rail more time to recover
//   // from the ADS reset inrush specifically before adding WiFi's TX burst on
//   // top. NOT confirmed against a real reset-reason log from a failed
//   // power-cycle (still don't have one) -- if this doesn't fully fix it,
//   // check Serial for "BROWNOUT" (see printResetReason() above) right after
//   // a failed power-cycle attempt to confirm vs. rule this out.
//   delay(500);

//   connectWiFi();

//   // Restored Certificate for secure connection
//   wifiClient.setCACert(EMQX_CA_CERT);

//   // ADDED FIX: Bypass the 1970 time-check failure!
//   wifiClient.setInsecure();

//   // DIAGNOSIS (MQTT "connection fails" contributor): mqtt.connect() below
//   // does a blocking TCP+TLS handshake to EMQX Cloud with no explicit
//   // timeout ever set -- same freeze-everything risk WIFI_RECONNECT_GRACE_MS
//   // above fixes for WiFi, just unbounded on the MQTT side (core-default
//   // timeouts vary by ESP32 Arduino core version, so relying on the default
//   // is exactly the kind of implicit assumption that bit this file before --
//   // see the "1970 time-check failure" comment above). Bounding both layers
//   // explicitly: the underlying TLS socket connect, and PubSubClient's own
//   // post-connect read/write socket timeout.
//   wifiClient.setTimeout(5000);       // ms -- caps the TLS handshake itself
//   mqtt.setSocketTimeout(5);          // seconds -- PubSubClient's own read/write timeout

//   mqtt.setServer(MQTT_BROKER, MQTT_PORT);
//   mqtt.setBufferSize(1024);
//   maintainMQTT();

//   if (!initADS()) {
//     Serial.println("[FATAL] ADS1292R initialization failed! Checking SPI lines.");
//     while (true) {
//       delay(100);
//     }
//   }

//   lastDrdyTimestamp = millis();
// }

// /* ================= LOOP ================= */

// void loop() {
//   if (WiFi.status() != WL_CONNECTED) {
//     unsigned long now = millis();
//     if (wifiDownSince == 0) wifiDownSince = now;
//     // Give WiFi.setAutoReconnect() a real chance to silently recover from a
//     // brief drop before paying for the full blocking multi-SSID scan, and
//     // even then don't re-enter it more than once per retry window.
//     if (now - wifiDownSince >= WIFI_RECONNECT_GRACE_MS
//         && now - lastWifiReconnectAttempt >= WIFI_RECONNECT_RETRY_MS) {
//       lastWifiReconnectAttempt = now;
//       connectWiFi();
//     }
//   } else {
//     wifiDownSince = 0;
//   }

//   maintainMQTT();
//   mqtt.loop();

//   // 5-second Watchdog & Heartbeat
//   if (millis() - lastHeartbeatTime > 5000) {
//     lastHeartbeatTime = millis();
//     bool drdyActive = (millis() - lastDrdyTimestamp < 1000);
//     if (!drdyActive) {
//       Serial.println("[WARNING] DRDY interrupt stopped pulsing!");
//     }
//     // Lead-off over the last 5 s, as the share of samples (0-1) with each
//     // EEG input flagged off. Anything well above 0 = re-seat that electrode.
//     float offP = loffFrames ? (float)loffIn2pOff / loffFrames : 0.0f;
//     float offN = loffFrames ? (float)loffIn2nOff / loffFrames : 0.0f;
//     float offR = loffFrames ? (float)loffRldOff / loffFrames : 0.0f;
//     // Only detects an electrode that is fully off (input past 95% of the
//     // rail) -- poor-but-present contact still shows up only in the signal
//     // quality checks (RMS, out-of-range share, delta power).
//     if (offP > 0.5f || offN > 0.5f || offR > 0.5f) {
//       Serial.print("[WARNING] Electrode off: ");
//       if (offP > 0.5f) Serial.print("IN2P ");
//       if (offN > 0.5f) Serial.print("IN2N ");
//       if (offR > 0.5f) Serial.print("BIAS(RLD) ");
//       Serial.println();
//     }
//     loffFrames = loffIn2pOff = loffIn2nOff = loffRldOff = 0;
//     // DRDY pulses the loop didn't read in time (frame overwritten before the
//     // SPI read) -- a sign loop() is being blocked, e.g. by a TLS publish.
//     uint32_t pulses = drdyPulses;
//     uint32_t missed = pulses > framesRead ? pulses - framesRead : 0;
//     drdyPulses = 0; framesRead = 0;
//     if (mqtt.connected()) {
//       char hb[256];
//       snprintf(hb, sizeof(hb),
//                "{\"uptime_ms\":%lu,\"drdy_ok\":%d,\"loff_in2p\":%.2f,\"loff_in2n\":%.2f,\"loff_rld\":%.2f,"
//                "\"glitches\":%lu,\"missed_drdy\":%lu,\"pub_drops\":%lu,\"rssi\":%d}",
//                millis(), drdyActive ? 1 : 0, offP, offN, offR,
//                (unsigned long)glitchCount, (unsigned long)missed, (unsigned long)pubDrops, (int)WiFi.RSSI());
//       mqtt.publish(MQTT_STATUS, hb);
//       lastHeartbeatPublish = millis();
//     }
//     glitchCount = 0; glitchLogged = 0; pubDrops = 0;
//   }

//   if (!drdyFlag) return;
//   drdyFlag = false;
//   // lastDrdyTimestamp is now set in onDrdy() itself, not here -- see its comment.

//   byte r[9];
//   SPI.beginTransaction(adsSPI);
//   digitalWrite(ADS_PIN_CS, LOW);
//   for (int i = 0; i < 9; i++) {
//     r[i] = SPI.transfer(0x00);
//   }
//   digitalWrite(ADS_PIN_CS, HIGH);
//   SPI.endTransaction();

//   if (!isStatusValid(r[0])) {
//     corruptFrameCount++;
//     if (corruptFrameCount % 250 == 0) {
//       Serial.print("Corrupted ADS frames: ");
//       Serial.println(corruptFrameCount);
//     }
//     return;
//   }

//   loffFrames++;
//   if (r[0] & STAT_IN2P_OFF) loffIn2pOff++;
//   if (r[0] & STAT_IN2N_OFF) loffIn2nOff++;
//   if (r[0] & STAT_RLD_OFF)  loffRldOff++;

//   // Channel 2 (T7 - T8 Differential)
//   int32_t raw_t7_t8 = parseSigned24(r[6], r[7], r[8]);
//   uint32_t now = millis();

//   // LSB = VREF / (gain * (2^23 - 1)) -- see UV_PER_COUNT. Serial readout
//   // only; MQTT sends the raw code, which the backend converts itself.
//   float t7_t8_uV = raw_t7_t8 * UV_PER_COUNT;
//   framesRead++;

//   if (fabsf(t7_t8_uV) > GLITCH_UV) {
//     glitchCount++;
//     if (glitchLogged < GLITCH_LOG_MAX) {
//       glitchLogged++;
//       // ms since the last heartbeat / batch publish; DRDY pulses vs frames
//       // read so far this window; the 9 raw frame bytes (3 status + 3 CH1 + 3 CH2).
//       Serial.printf("[GLITCH] t=%lu code=%ld (0x%06lX) %.0f uV | since_hb=%lu ms since_batch=%lu ms"
//                     " | drdy=%lu read=%lu | loff=%s%s%s | bytes=%02X %02X %02X  %02X %02X %02X  %02X %02X %02X\n",
//                     now, (long)raw_t7_t8, (unsigned long)(raw_t7_t8 & 0xFFFFFF), t7_t8_uV,
//                     now - lastHeartbeatPublish, now - lastBatchPublish,
//                     (unsigned long)drdyPulses, (unsigned long)framesRead,
//                     (r[0] & STAT_IN2P_OFF) ? "P" : "-", (r[0] & STAT_IN2N_OFF) ? "N" : "-", (r[0] & STAT_RLD_OFF) ? "R" : "-",
//                     r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]);
//     }
//   }

//   /* =========================================== */
//   /* --- MODIFIED FOR ARDUINO SERIAL PLOTTER --- */
//   /* =========================================== */
//   // Only printing the microvolt value with a label. 
  
//   Serial.print("EEG(uV):");
//   Serial.println(t7_t8_uV, 2);

//   /* =========================================== */

//   batchTime[batchCount] = now;
//   batchCh2[batchCount]  = raw_t7_t8;
//   batchCount++;

//   if (batchCount >= BATCH_SIZE) {
//     publishBatch();
//   }
// }


// #include <SPI.h>
// #include <WiFi.h>
// #include <WiFiClientSecure.h>
// #include <PubSubClient.h>
// #include "esp_system.h"

// /* ================= HARDWARE PIN DEFINITIONS (XIAO ESP32-C3) ================= */
// // Reverted to raw GPIO integers for generic ESP32-C3 board compatibility
// constexpr int8_t ADS_PIN_RESET = 2;   // GPIO2 (D0)
// constexpr int8_t ADS_PIN_START = 3;   // GPIO3 (D1)
// constexpr int8_t ADS_PIN_DRDY  = 4;   // GPIO4 (D2)
// constexpr int8_t ADS_PIN_CS    = 7;   // GPIO7 (D5)

// constexpr int8_t SPI_PIN_SCK   = 8;   // GPIO8 (D8)
// constexpr int8_t SPI_PIN_MISO  = 20;  // GPIO9 (D9)
// constexpr int8_t SPI_PIN_MOSI  = 10;  // GPIO10 (D10)

// /* ================= WIFI CONFIGURATION ================= */

// const int WIFI_NETWORK_COUNT = 2;
// const char* WIFI_SSIDS[WIFI_NETWORK_COUNT]     = { "Wehara's A07", "Hiruni" };
// const char* WIFI_PASSWORDS[WIFI_NETWORK_COUNT] = { "wehara1216",   "Hiruni2022" };

// // --- EMQX CLOUD BROKER CONFIGURATION ---
// const char* MQTT_BROKER = "ob1f0f10.ala.asia-southeast1.emqxsl.com";
// const int   MQTT_PORT   = 8883;
// const char* MQTT_USER   = "wearable02";
// const char* MQTT_PASS   = "wearable02";
// const char* MQTT_TOPIC  = "mindpulse/wearable02/eeg";
// const char* MQTT_STATUS = "mindpulse/wearable02/status";

// const char* EMQX_CA_CERT = R"EOF(
// -----BEGIN CERTIFICATE-----
// MIIDjjCCAnagAwIBAgIQAzrx5qcRqaC7KGSxHQn65TANBgkqhkiG9w0BAQsFADBh
// MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
// d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
// MjAeFw0xMzA4MDExMjAwMDBaFw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVT
// MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
// b20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IEcyMIIBIjANBgkqhkiG
// 9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuzfNNNx7a8myaJCtSnX/RrohCgiN9RlUyfuI
// 2/Ou8jqJkTx65qsGGmvPrC3oXgkkRLpimn7Wo6h+4FR1IAWsULecYxpsMNzaHxmx
// 1x7e/dfgy5SDN67sH0NO3Xss0r0upS/kqbitOtSZpLYl6ZtrAGCSYP9PIUkY92eQ
// q2EGnI/yuum06ZIya7XzV+hdG82MHauVBJVJ8zUtluNJbd134/tJS7SsVQepj5Wz
// tCO7TG1F8PapspUwtP1MVYwnSlcUfIKdzXOS0xZKBgyMUNGPHgm+F6HmIcr9g+UQ
// vIOlCsRnKPZzFBQ9RnbDhxSJITRNrw9FDKZJobq7nMWxM4MphQIDAQABo0IwQDAP
// BgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNVHQ4EFgQUTiJUIBiV
// 5uNu5g/6+rkS7QYXjzkwDQYJKoZIhvcNAQELBQADggEBAGBnKJRvDkhj6zHd6mcY
// 1Yl9PMWLSn/pvtsrF9+wX3N3KjITOYFnQoQj8kVnNeyIv/iPsGEMNKSuIEyExtv4
// NeF22d+mQrvHRAiGfzZ0JFrabA0UWTW98kndth/Jsw1HKj2ZL7tcu7XUIOGZX1NG
// Fdtom/DzMNU+MeKNhJ7jitralj41E6Vf8PlwUHBHQRFXGU7Aj64GxJUTFy8bJZ91
// 8rGOmaFvE7FBcf6IKshPECBV1/MUReXgRPTqh5Uykw7+U0b6LJ3/iyK5S9kJRaTe
// pLiaWN0bfVKfjllDiIGknibVb63dDcY3fe0Dkhvld1927jyNxF1WW6LZZm6zNTfl
// MrY=
// -----END CERTIFICATE-----
// )EOF";

// /* ================= ADS1292R COMMANDS & CONFIG ================= */

// #define ADS_CMD_START   0x08
// #define ADS_CMD_STOP    0x0A
// #define ADS_CMD_RDATAC  0x10
// #define ADS_CMD_SDATAC  0x11
// #define ADS_CMD_WREG    0x40
// #define ADS_CMD_RREG    0x20

// #define BATCH_SIZE 25

// // CH2SET (0x05) gain field, bits 6:4 -- ADS1292R datasheet: 000=6, 001=1,
// // 010=2, 011=3, 100=4, 101=8, 110=12. The backend's BIPOLAR_GAIN
// // (backend/psychological/realtime/adc.py) MUST equal CH2_GAIN; it converts
// // the raw codes this device sends into microvolts with it.
// #define CH2_GAIN       8
// #define CH2SET_VALUE   0x50   // gain 8 (101 << 4), normal electrode input (MUX 000)
// #define UV_PER_COUNT   (2.42f / (CH2_GAIN * 8388607.0f) * 1e6f)   // 0.0360608 uV/count

// // Lead-off: DC current (6 nA) injected into IN2P/IN2N; the comparators
// // flag an input whose voltage drifts past 95% of the rail, i.e. an electrode
// // that is off or has no contact. Status bits arrive with every sample.
// #define CONFIG2_VALUE  0xE0   // bit7=1 (required), PDB_LOFF_COMP=1, PDB_REFBUF=1, VREF 2.42 V
// #define LOFF_VALUE     0x10   // COMP_TH=95%, bit4=1 (required), ILEAD_OFF=6 nA, DC lead-off
// #define LOFF_SENS_VALUE 0x0C  // LOFF2N | LOFF2P -- sense channel 2's inputs only
// // Status byte 0 = 1100 + LOFF_STAT[4:1]  ->  bit3 = RLD off, bit2 = IN2N off, bit1 = IN2P off
// #define STAT_RLD_OFF   0x08
// #define STAT_IN2N_OFF  0x04
// #define STAT_IN2P_OFF  0x02
// // RLD_SENS (0x06): PDB_RLD=1 (RLD buffer on), RLD_LOFF_SENS=1 (bias
// // electrode lead-off sensing -> RLD_STAT), RLD derived from IN2P + IN2N.
// // UNVERIFIED on this board: if loff_rld reads 1.00 with the bias electrode
// // firmly on, or stays 0.00 with it removed, RLD sensing isn't working in
// // continuous mode -- set this back to 0x2C and check the bias contact by hand.
// #define RLD_SENS_VALUE 0x3C

// // Share of samples with each EEG input flagged off since the last
// // heartbeat -- reported in the 5 s status message.
// uint32_t loffFrames = 0, loffIn2pOff = 0, loffIn2nOff = 0, loffRldOff = 0;

// uint32_t batchTime[BATCH_SIZE];
// int32_t  batchCh2[BATCH_SIZE];
// uint8_t  batchCount = 0;
// uint32_t corruptFrameCount = 0;

// /* ================= SYSTEM OBJECTS ================= */

// WiFiClientSecure wifiClient;
// PubSubClient mqtt(wifiClient);

// SPISettings adsSPI(100000, MSBFIRST, SPI_MODE1); // Kept at 100kHz for stability
// volatile bool drdyFlag = false;
// unsigned long lastDrdyTimestamp = 0;
// unsigned long lastHeartbeatTime = 0;

// // MQTT client id is kept fixed as "wearable02" (not a per-boot unique id) --
// // deliberate, to keep exactly one entry for this device in the EMQX client
// // dashboard rather than a new one every reboot (same reasoning as not
// // spinning up a new calibration client per attempt, elsewhere in this
// // system). See maintainMQTT()'s comment for the tradeoff this implies.

// void IRAM_ATTR onDrdy() {
//   drdyFlag = true;
//   // DIAGNOSIS ("drdy issue"): this used to be set in loop() instead, at the
//   // point the flag got processed -- but loop() can be blocked for seconds
//   // at a time inside connectWiFi() (or, before the mqtt.connect() timeout
//   // fix above, inside a hung TLS handshake), during which this timestamp
//   // never advanced even though the ADS1292R itself kept pulsing DRDY the
//   // whole time. The 5s heartbeat's "[WARNING] DRDY interrupt stopped
//   // pulsing!" check reads this timestamp, so any long-enough loop() stall
//   // was making that warning fire as a FALSE POSITIVE -- reporting "DRDY
//   // stopped" when really it was just loop() that stopped reading it. Timing
//   // it here instead measures the real hardware signal, independent of
//   // whatever loop() is doing. If the warning still appears with no
//   // WiFi/MQTT reconnect happening nearby, that points at a genuine
//   // ADS1292R/SPI/power issue instead of this false-positive mechanism.
//   lastDrdyTimestamp = millis();
// }

// /* ================= SPI HELPERS ================= */

// void sendCommand(byte cmd) {
//   SPI.beginTransaction(adsSPI);
//   digitalWrite(ADS_PIN_CS, LOW);
//   delayMicroseconds(10);
//   SPI.transfer(cmd);
//   digitalWrite(ADS_PIN_CS, HIGH);
//   SPI.endTransaction();
//   delay(2);
// }

// void writeReg(byte reg, byte val) {
//   SPI.beginTransaction(adsSPI);
//   digitalWrite(ADS_PIN_CS, LOW);
//   delayMicroseconds(10);
//   SPI.transfer(ADS_CMD_WREG | reg);
//   SPI.transfer(0x00);
//   SPI.transfer(val);
//   digitalWrite(ADS_PIN_CS, HIGH);
//   SPI.endTransaction();
//   delay(10);
// }

// byte readReg(byte reg) {
//   SPI.beginTransaction(adsSPI);
//   digitalWrite(ADS_PIN_CS, LOW);
//   delayMicroseconds(10);
//   SPI.transfer(ADS_CMD_RREG | reg);
//   SPI.transfer(0x00);
//   byte val = SPI.transfer(0x00);
//   digitalWrite(ADS_PIN_CS, HIGH);
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
//     Serial.print(" expected 0x");
//     Serial.print(value, HEX);
//     Serial.print(" got 0x");
//     Serial.println(check, HEX);
//     return false;
//   }
//   return true;
// }

// int32_t parseSigned24(byte msb, byte mid, byte lsb) {
//   int32_t val = ((int32_t)msb << 16) | ((int32_t)mid << 8) | lsb;
//   if (val & 0x800000) {
//     val |= 0xFF000000;
//   }
//   return val;
// }

// bool isStatusValid(byte s0) {
//   return (s0 & 0xF0) == 0xC0;
// }

// /* ================= NETWORK SERVICES ================= */

// void connectWiFi() {
//   WiFi.mode(WIFI_STA);
//   // Lets the driver silently reassociate on its own after a brief drop --
//   // see WIFI_RECONNECT_GRACE_MS's comment below for why this matters.
//   WiFi.setAutoReconnect(true);
//   // Lower TX power -- confirmed working over USB (ample current) but not on
//   // battery, which points at the WiFi radio's TX current spike (default max
//   // is ~19.5dBm, drawing several hundred mA in bursts) browning out a
//   // battery that can't source that peak. Dropped further to 8.5dBm from an
//   // earlier 11dBm -- still browning out on a 600mAh/3.7V LiPo (small cell,
//   // unknown discharge rating -- likely can't source even the reduced spike
//   // without voltage sag), so cutting the peak further. Raise this back up
//   // (max WIFI_POWER_19_5dBm) if range turns out to be a problem once
//   // brownouts are ruled out; if 8.5dBm still browns out, the battery itself
//   // (charge level or discharge/C rating) is the limiting factor, not TX
//   // power -- a bulk capacitor across the battery rail or a better-rated
//   // cell would be the next step, not a further firmware change.
//   WiFi.setTxPower(WIFI_POWER_8_5dBm);
//   for (int i = 0; i < WIFI_NETWORK_COUNT; i++) {
//     WiFi.disconnect(true, true);
//     delay(100);

//     Serial.print("Connecting WiFi: ");
//     Serial.println(WIFI_SSIDS[i]);
//     WiFi.begin(WIFI_SSIDS[i], WIFI_PASSWORDS[i]);

//     int attempts = 0;
//     while (WiFi.status() != WL_CONNECTED && attempts < 30) {
//       delay(300);
//       Serial.print(".");
//       attempts++;
//     }

//     if (WiFi.status() == WL_CONNECTED) {
//       Serial.println();
//       Serial.println("WiFi connected: " + String(WIFI_SSIDS[i]));
//       Serial.print("IP Address: ");
//       Serial.println(WiFi.localIP());
//       // Was setSleep(false) -- fine on USB, but on battery that keeps the
//       // radio fully awake between transmissions instead of using WiFi's own
//       // modem-sleep power saving, raising sustained average draw for no
//       // benefit this app needs (samples publish in ~1s batches, not
//       // latency-critical). true re-enables modem sleep.
//       WiFi.setSleep(true);
//       return;
//     }
//     Serial.println();
//   }
//   Serial.println("WiFi connection failed across all configurations.");
// }

// unsigned long lastMqttAttempt = 0;
// const unsigned long MQTT_RETRY_INTERVAL_MS = 2000;

// // loop() used to call the full blocking connectWiFi() (up to ~9s of
// // delay()-spinning PER configured SSID) on every single iteration where
// // WiFi wasn't connected -- during which mqtt.loop(), the heartbeat, and
// // DRDY sample draining all stall completely. A brief drop (AP roam,
// // momentary RF interference) turned into several seconds of total device
// // silence, repeatedly, which is what "sometimes the connection just fails"
// // looks like from the app side. Two changes fix this:
// //   1. WiFi.setAutoReconnect(true) (set inside connectWiFi(), above) lets the
// //      ESP32 driver itself silently reassociate to the AP it just dropped,
// //      almost always within under a second, with no loop() involvement at
// //      all -- covers the common transient-blip case for free.
// // 2. loop() only falls back to the expensive full multi-SSID
// //      connectWiFi() scan after WiFi has been down continuously for
// //      WIFI_RECONNECT_GRACE_MS (giving setAutoReconnect a real chance to
// //      recover first), and even then at most once per
// //      WIFI_RECONNECT_RETRY_MS -- instead of re-entering it back-to-back
// //      on every loop() tick while still down.
// unsigned long wifiDownSince = 0;
// unsigned long lastWifiReconnectAttempt = 0;
// const unsigned long WIFI_RECONNECT_GRACE_MS = 4000;
// const unsigned long WIFI_RECONNECT_RETRY_MS = 10000;

// void maintainMQTT() {
//   if (mqtt.connected()) return;
//   unsigned long now = millis();
//   if (now - lastMqttAttempt < MQTT_RETRY_INTERVAL_MS) return;
//   lastMqttAttempt = now;

//   // Fixed client id "wearable02", deliberately not unique-per-boot -- see
//   // the comment above this device's global state (near lastDrdyTimestamp).
//   // Known tradeoff: right after a FAST reconnect (e.g. a manual reset,
//   // which never cuts power and so cycles much quicker than an off/on power
//   // cycle), EMQX may briefly still consider the previous session (same
//   // client id) alive and reject or delay this connect attempt -- the MQTT
//   // spec says the broker should evict the stale session and accept the new
//   // one, but that takeover isn't guaranteed instant. Not fixed by retrying
//   // with a different id here (would defeat the point of keeping it fixed);
//   // this function's own MQTT_RETRY_INTERVAL_MS loop already retries every
//   // 2s regardless, which is what actually rides out that window.
//   Serial.print("Connecting to EMQX MQTT Broker...");
//   if (mqtt.connect("wearable02", MQTT_USER, MQTT_PASS)) {
//     Serial.println(" Connected");
//     char online[96];
//     snprintf(online, sizeof(online), "{\"status\":\"ONLINE\",\"mode\":\"BIPOLAR_T7_T8\",\"gain\":%d,\"lead_off\":1}", CH2_GAIN);
//     mqtt.publish(MQTT_STATUS, online);
//   } else {
//     Serial.print(" Failed, rc=");
//     Serial.println(mqtt.state());
//   }
// }

// /* ================= ADS1292R OPTION B CONFIGURATION ================= */

// bool initADS() {
//   Serial.println("Configuring ADS1292R for Option B (1-Channel Bipolar T7-T8)...");

//   // --- NEW: Wake up the chip before doing anything ---
//   sendCommand(0x02); // WAKEUP Command
//   delay(100);

//   sendCommand(ADS_CMD_SDATAC);
//   delay(100);

//   // CONFIG1 (0x01): 250 SPS data rate -> 0x01
//   if (!verifiedWrite(0x01, 0x01)) return false;

//   // CONFIG2 (0x02): lead-off comparators ON, PDB_REFBUF = 1, VREF = 2.42V
//   // (was 0xA0: comparators powered down, so lead-off was never detected)
//   if (!verifiedWrite(0x02, CONFIG2_VALUE)) return false;

//   // LOFF (0x03): DC lead-off, 6 nA, 95% threshold -- see LOFF_VALUE
//   if (!verifiedWrite(0x03, LOFF_VALUE)) return false;

//   // CH1SET (0x04): Power-down Ch1 & short input -> 0x81
//   if (!verifiedWrite(0x04, 0x81)) return false;

//   // CH2SET (0x05): gain CH2_GAIN, normal electrode input -- see CH2SET_VALUE
//   if (!verifiedWrite(0x05, CH2SET_VALUE)) return false;

//   // RLD_SENS (0x06): see RLD_SENS_VALUE (was 0x2C: no bias lead-off sensing)
//   if (!verifiedWrite(0x06, RLD_SENS_VALUE)) return false;

//   // LOFF_SENS (0x07): lead-off sensing on channel 2's inputs -- see LOFF_SENS_VALUE
//   if (!verifiedWrite(0x07, LOFF_SENS_VALUE)) return false;

//   // RESP1 (0x09): Disable respiration circuitry -> 0x00
//   if (!verifiedWrite(0x09, 0x00)) return false;

//   // RESP2 (0x0A): Set internal RLD reference to midsupply (RLDREF_INT = 1) -> 0x02
//   if (!verifiedWrite(0x0A, 0x02)) return false;
//   delay(100);

//   attachInterrupt(digitalPinToInterrupt(ADS_PIN_DRDY), onDrdy, FALLING);

//   sendCommand(ADS_CMD_RDATAC);
//   delay(50);

//   sendCommand(ADS_CMD_START);
//   digitalWrite(ADS_PIN_START, HIGH);

//   Serial.println("Option B Streaming Initialized.");
//   return true;
// }

// /* ================= MQTT TRANSMISSION ================= */

// void publishBatch() {
//   if (mqtt.connected()) {
//     static char payload[600];
//     int offset = 0;

//     for (uint8_t i = 0; i < batchCount; i++) {
//       int n = snprintf(
//           payload + offset, sizeof(payload) - offset,
//           "%lu,%ld;",
//           batchTime[i], batchCh2[i]
//       );
//       if (n < 0 || offset + n >= (int)sizeof(payload)) break;
//       offset += n;
//     }

//     bool ok = mqtt.publish(MQTT_TOPIC, payload);
//     if (!ok) {
//       Serial.println("[MQTT] Publish batch drop");
//     }
//   }
//   batchCount = 0;
// }

// /* ================= SETUP ================= */

// void printResetReason() {
//   esp_reset_reason_t reason = esp_reset_reason();
//   const char* reasonStr;
//   switch (reason) {
//     case ESP_RST_POWERON:  reasonStr = "POWERON (normal power-up)"; break;
//     case ESP_RST_EXT:      reasonStr = "EXT (external reset pin)"; break;
//     case ESP_RST_SW:       reasonStr = "SW (software/programmer-triggered reset)"; break;
//     case ESP_RST_PANIC:    reasonStr = "PANIC (crash/exception)"; break;
//     case ESP_RST_INT_WDT:  reasonStr = "INT_WDT (interrupt watchdog -- something blocked too long)"; break;
//     case ESP_RST_TASK_WDT: reasonStr = "TASK_WDT (task watchdog -- something blocked too long)"; break;
//     case ESP_RST_WDT:      reasonStr = "WDT (other watchdog)"; break;
//     case ESP_RST_BROWNOUT: reasonStr = "BROWNOUT -- supply voltage sagged below threshold. Check battery charge/cable, not code."; break;
//     case ESP_RST_SDIO:     reasonStr = "SDIO"; break;
//     default:               reasonStr = "UNKNOWN"; break;
//   }
//   Serial.print("[boot] Reset reason: ");
//   Serial.println(reasonStr);
// }

// void setup() {
//   Serial.begin(115200); // Fixed baud rate

//   // DELIBERATELY REMOVED the while (!Serial) loop!
//   // Do not wait for USB when running on a battery.

//   printResetReason();  // first thing printed -- see its own comment above

//   Serial.println("\n=================================");
//   Serial.println("  OPTION B: BIPOLAR T7-T8 EEG    ");
//   Serial.println("=================================");

//   pinMode(ADS_PIN_CS, OUTPUT);
//   pinMode(ADS_PIN_RESET, OUTPUT);
//   pinMode(ADS_PIN_START, OUTPUT);
//   pinMode(ADS_PIN_DRDY, INPUT_PULLUP);

//   digitalWrite(ADS_PIN_CS, HIGH);
//   digitalWrite(ADS_PIN_START, LOW);

//   SPI.begin(SPI_PIN_SCK, SPI_PIN_MISO, SPI_PIN_MOSI, -1);

//   // Hardware Reset Pulse
//   digitalWrite(ADS_PIN_RESET, LOW);
//   delay(300);
//   digitalWrite(ADS_PIN_RESET, HIGH);
//   delay(1000);

//   // DIAGNOSIS (power-cycle-specific reconnect failure): confirmed earlier
//   // this session that this LiPo (600mAh/3.7V, unknown C-rating) browns out
//   // under the WiFi TX association burst alone (fixed via setTxPower +
//   // setSleep). A fresh power-cycle stacks THREE current draws close
//   // together that a mid-session WiFi reconnect never has to -- regulator
//   // startup inrush, the ADS1292R hardware reset pulse just above, and then
//   // the WiFi TX burst only ~1.3s later -- while a runtime reconnect only
//   // ever faces the WiFi burst alone, on a rail that's had much longer to
//   // recover. This extra settle delay gives the rail more time to recover
//   // from the ADS reset inrush specifically before adding WiFi's TX burst on
//   // top. NOT confirmed against a real reset-reason log from a failed
//   // power-cycle (still don't have one) -- if this doesn't fully fix it,
//   // check Serial for "BROWNOUT" (see printResetReason() above) right after
//   // a failed power-cycle attempt to confirm vs. rule this out.
//   delay(500);

//   connectWiFi();

//   // Restored Certificate for secure connection
//   wifiClient.setCACert(EMQX_CA_CERT);

//   // ADDED FIX: Bypass the 1970 time-check failure!
//   wifiClient.setInsecure();

//   // DIAGNOSIS (MQTT "connection fails" contributor): mqtt.connect() below
//   // does a blocking TCP+TLS handshake to EMQX Cloud with no explicit
//   // timeout ever set -- same freeze-everything risk WIFI_RECONNECT_GRACE_MS
//   // above fixes for WiFi, just unbounded on the MQTT side (core-default
//   // timeouts vary by ESP32 Arduino core version, so relying on the default
//   // is exactly the kind of implicit assumption that bit this file before --
//   // see the "1970 time-check failure" comment above). Bounding both layers
//   // explicitly: the underlying TLS socket connect, and PubSubClient's own
//   // post-connect read/write socket timeout.
//   wifiClient.setTimeout(5000);       // ms -- caps the TLS handshake itself
//   mqtt.setSocketTimeout(5);          // seconds -- PubSubClient's own read/write timeout

//   mqtt.setServer(MQTT_BROKER, MQTT_PORT);
//   mqtt.setBufferSize(1024);
//   maintainMQTT();

//   if (!initADS()) {
//     Serial.println("[FATAL] ADS1292R initialization failed! Checking SPI lines.");
//     while (true) {
//       delay(100);
//     }
//   }

//   lastDrdyTimestamp = millis();
// }

// /* ================= LOOP ================= */

// void loop() {
//   if (WiFi.status() != WL_CONNECTED) {
//     unsigned long now = millis();
//     if (wifiDownSince == 0) wifiDownSince = now;
//     // Give WiFi.setAutoReconnect() a real chance to silently recover from a
//     // brief drop before paying for the full blocking multi-SSID scan, and
//     // even then don't re-enter it more than once per retry window.
//     if (now - wifiDownSince >= WIFI_RECONNECT_GRACE_MS
//         && now - lastWifiReconnectAttempt >= WIFI_RECONNECT_RETRY_MS) {
//       lastWifiReconnectAttempt = now;
//       connectWiFi();
//     }
//   } else {
//     wifiDownSince = 0;
//   }

//   maintainMQTT();
//   mqtt.loop();

//   // 5-second Watchdog & Heartbeat
//   if (millis() - lastHeartbeatTime > 5000) {
//     lastHeartbeatTime = millis();
//     bool drdyActive = (millis() - lastDrdyTimestamp < 1000);
//     if (!drdyActive) {
//       Serial.println("[WARNING] DRDY interrupt stopped pulsing!");
//     }
//     // Lead-off over the last 5 s, as the share of samples (0-1) with each
//     // EEG input flagged off. Anything well above 0 = re-seat that electrode.
//     float offP = loffFrames ? (float)loffIn2pOff / loffFrames : 0.0f;
//     float offN = loffFrames ? (float)loffIn2nOff / loffFrames : 0.0f;
//     float offR = loffFrames ? (float)loffRldOff / loffFrames : 0.0f;
//     // Only detects an electrode that is fully off (input past 95% of the
//     // rail) -- poor-but-present contact still shows up only in the signal
//     // quality checks (RMS, out-of-range share, delta power).
//     if (offP > 0.5f || offN > 0.5f || offR > 0.5f) {
//       Serial.print("[WARNING] Electrode off: ");
//       if (offP > 0.5f) Serial.print("IN2P ");
//       if (offN > 0.5f) Serial.print("IN2N ");
//       if (offR > 0.5f) Serial.print("BIAS(RLD) ");
//       Serial.println();
//     }
//     loffFrames = loffIn2pOff = loffIn2nOff = loffRldOff = 0;
//     if (mqtt.connected()) {
//       char hb[160];
//       snprintf(hb, sizeof(hb), "{\"uptime_ms\":%lu,\"drdy_ok\":%d,\"loff_in2p\":%.2f,\"loff_in2n\":%.2f,\"loff_rld\":%.2f}",
//                millis(), drdyActive ? 1 : 0, offP, offN, offR);
//       mqtt.publish(MQTT_STATUS, hb);
//     }
//   }

//   if (!drdyFlag) return;
//   drdyFlag = false;
//   // lastDrdyTimestamp is now set in onDrdy() itself, not here -- see its comment.

//   byte r[9];
//   SPI.beginTransaction(adsSPI);
//   digitalWrite(ADS_PIN_CS, LOW);
//   for (int i = 0; i < 9; i++) {
//     r[i] = SPI.transfer(0x00);
//   }
//   digitalWrite(ADS_PIN_CS, HIGH);
//   SPI.endTransaction();

//   if (!isStatusValid(r[0])) {
//     corruptFrameCount++;
//     if (corruptFrameCount % 250 == 0) {
//       Serial.print("Corrupted ADS frames: ");
//       Serial.println(corruptFrameCount);
//     }
//     return;
//   }

//   loffFrames++;
//   if (r[0] & STAT_IN2P_OFF) loffIn2pOff++;
//   if (r[0] & STAT_IN2N_OFF) loffIn2nOff++;
//   if (r[0] & STAT_RLD_OFF)  loffRldOff++;

//   // Channel 2 (T7 - T8 Differential)
//   int32_t raw_t7_t8 = parseSigned24(r[6], r[7], r[8]);
//   uint32_t now = millis();

//   // LSB = VREF / (gain * (2^23 - 1)) -- see UV_PER_COUNT. Serial readout
//   // only; MQTT sends the raw code, which the backend converts itself.
//   float t7_t8_uV = raw_t7_t8 * UV_PER_COUNT;

//   /* =========================================== */
//   /* --- MODIFIED FOR ARDUINO SERIAL PLOTTER --- */
//   /* =========================================== */
//   // Only printing the microvolt value with a label. 
  
//   Serial.print("EEG(uV):");
//   Serial.println(t7_t8_uV, 2);

//   /* =========================================== */

//   batchTime[batchCount] = now;
//   batchCh2[batchCount]  = raw_t7_t8;
//   batchCount++;

//   if (batchCount >= BATCH_SIZE) {
//     publishBatch();
//   }
// }




#include <SPI.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include "esp_system.h"

/* ================= HARDWARE PIN DEFINITIONS (XIAO ESP32-C3) ================= */
// Reverted to raw GPIO integers for generic ESP32-C3 board compatibility
constexpr int8_t ADS_PIN_RESET = 2;   // GPIO2 (D0)
constexpr int8_t ADS_PIN_START = 3;   // GPIO3 (D1)
constexpr int8_t ADS_PIN_DRDY  = 4;   // GPIO4 (D2)
constexpr int8_t ADS_PIN_CS    = 7;   // GPIO7 (D5)

constexpr int8_t SPI_PIN_SCK   = 8;   // GPIO8 (D8)
constexpr int8_t SPI_PIN_MISO  = 20;  // GPIO9 (D9)
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
const char* MQTT_TOPIC  = "mindpulse/wearable02/eeg";
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

// Wi-Fi transmit power. 8.5 dBm because higher settings browned out the
// 600 mAh LiPo (see connectWiFi()). If the heartbeat's "rssi" is below about
// -75 dBm or "pub_drops" is non-zero, first move closer to the router; on
// USB power or a better battery, raise this to WIFI_POWER_15dBm (or up to
// WIFI_POWER_19_5dBm) and watch Serial for a BROWNOUT reset reason.
#define WIFI_TX_POWER  WIFI_POWER_8_5dBm

// CH2SET (0x05) gain field, bits 6:4 -- ADS1292R datasheet: 000=6, 001=1,
// 010=2, 011=3, 100=4, 101=8, 110=12. The backend's BIPOLAR_GAIN
// (backend/psychological/realtime/adc.py) MUST equal CH2_GAIN; it converts
// the raw codes this device sends into microvolts with it.
#define CH2_GAIN       8
#define CH2SET_VALUE   0x50   // gain 8 (101 << 4), normal electrode input (MUX 000)
#define UV_PER_COUNT   (2.42f / (CH2_GAIN * 8388607.0f) * 1e6f)   // 0.0360608 uV/count

// Lead-off: DC current (6 nA) injected into IN2P/IN2N; the comparators
// flag an input whose voltage drifts past 95% of the rail, i.e. an electrode
// that is off or has no contact. Status bits arrive with every sample.
#define CONFIG2_VALUE  0xE0   // bit7=1 (required), PDB_LOFF_COMP=1, PDB_REFBUF=1, VREF 2.42 V
#define LOFF_VALUE     0x10   // COMP_TH=95%, bit4=1 (required), ILEAD_OFF=6 nA, DC lead-off
#define LOFF_SENS_VALUE 0x0C  // LOFF2N | LOFF2P -- sense channel 2's inputs only
// Status byte 0 = 1100 + LOFF_STAT[4:1]  ->  bit3 = RLD off, bit2 = IN2N off, bit1 = IN2P off
#define STAT_RLD_OFF   0x08
#define STAT_IN2N_OFF  0x04
#define STAT_IN2P_OFF  0x02
// RLD_SENS (0x06): PDB_RLD=1 (RLD buffer on), RLD_LOFF_SENS=1 (bias
// electrode lead-off sensing -> RLD_STAT), RLD derived from IN2P + IN2N.
// UNVERIFIED on this board: if loff_rld reads 1.00 with the bias electrode
// firmly on, or stays 0.00 with it removed, RLD sensing isn't working in
// continuous mode -- set this back to 0x2C and check the bias contact by hand.
#define RLD_SENS_VALUE 0x3C

// Share of samples with each EEG input flagged off since the last
// heartbeat -- reported in the 5 s status message.
uint32_t loffFrames = 0, loffIn2pOff = 0, loffIn2nOff = 0, loffRldOff = 0;

// Glitch diagnostics: a sample beyond +-GLITCH_UV is impossible for EEG
// (e.g. the recurring 0x67BFF3 = ~245 mV code). Each one is logged to Serial
// with its raw bytes and timing, to tell whether it lines up with the 5 s
// heartbeat publish, a batch publish, a missed DRDY or a lead-off change.
#define GLITCH_UV            100000.0f   // +-100 mV
#define GLITCH_LOG_MAX       20          // Serial lines per heartbeat window
volatile uint32_t drdyPulses = 0;        // counted in the ISR
uint32_t framesRead = 0, glitchCount = 0, glitchLogged = 0, pubDrops = 0;
unsigned long lastHeartbeatPublish = 0, lastBatchPublish = 0;

// ---- Sampling task + sample ring ------------------------------------
// The ADS1292R is read by sampleTask(), a high-priority FreeRTOS task woken
// by the DRDY interrupt -- NOT by loop(). loop() also does TLS publishing,
// Wi-Fi reconnects and Serial output, any of which can stall it for
// seconds (seen live: missed_drdy 724-3406 per window, a 13.6 s gap with
// the network fine); a sample loop() didn't read in time was simply lost.
// The task pre-empts loop(), so those stalls now only delay sending: each
// sample waits in the ring below until flushRing() publishes it.
// Single producer (sampleTask) / single consumer (loop): ringHead is only
// written by the task, ringTail only by loop().
#define RING_SAMPLES   8192                 // ~32 s at 250 SPS
#define SAMPLE_TASK_PRIORITY 10             // above loop() (1), below the Wi-Fi stack
#define SERIAL_PLOT    0                    // 1 = print every sample for the Arduino Serial
                                            // Plotter. Keep 0 unless a terminal is reading
                                            // USB: on the C3 an unread USB port blocks prints.
uint32_t ringTime[RING_SAMPLES];
int32_t  ringCode[RING_SAMPLES];
volatile uint32_t ringHead = 0, ringTail = 0;   // free-running counters (index = % RING_SAMPLES)
volatile uint32_t ringDrops = 0;                // samples lost to a full ring (outage > ~32 s)
volatile uint32_t missedDrdy = 0;               // DRDY pulses the task couldn't read in time
volatile uint32_t corruptFrameCount = 0;
TaskHandle_t sampleTaskHandle = nullptr;

// Latest glitch sample, recorded by the task, printed by loop().
struct GlitchInfo { uint32_t t; int32_t code; byte r[9]; uint32_t seq; };
volatile uint32_t glitchSeq = 0;
GlitchInfo lastGlitch;
uint32_t glitchPrintedSeq = 0;

/* ================= SYSTEM OBJECTS ================= */

WiFiClientSecure wifiClient;
PubSubClient mqtt(wifiClient);

SPISettings adsSPI(100000, MSBFIRST, SPI_MODE1); // Kept at 100kHz for stability
volatile bool drdyFlag = false;
unsigned long lastDrdyTimestamp = 0;
unsigned long lastHeartbeatTime = 0;

// MQTT client id is kept fixed as "wearable02" (not a per-boot unique id) --
// deliberate, to keep exactly one entry for this device in the EMQX client
// dashboard rather than a new one every reboot (same reasoning as not
// spinning up a new calibration client per attempt, elsewhere in this
// system). See maintainMQTT()'s comment for the tradeoff this implies.

void IRAM_ATTR onDrdy() {
  drdyFlag = true;
  drdyPulses++;
  // Wake sampleTask() -- each pulse adds one to its notification count, so
  // a count above 1 when it wakes means samples were overwritten unread.
  BaseType_t woken = pdFALSE;
  if (sampleTaskHandle) vTaskNotifyGiveFromISR(sampleTaskHandle, &woken);
  portYIELD_FROM_ISR(woken);
  // DIAGNOSIS ("drdy issue"): this used to be set in loop() instead, at the
  // point the flag got processed -- but loop() can be blocked for seconds
  // at a time inside connectWiFi() (or, before the mqtt.connect() timeout
  // fix above, inside a hung TLS handshake), during which this timestamp
  // never advanced even though the ADS1292R itself kept pulsing DRDY the
  // whole time. The 5s heartbeat's "[WARNING] DRDY interrupt stopped
  // pulsing!" check reads this timestamp, so any long-enough loop() stall
  // was making that warning fire as a FALSE POSITIVE -- reporting "DRDY
  // stopped" when really it was just loop() that stopped reading it. Timing
  // it here instead measures the real hardware signal, independent of
  // whatever loop() is doing. If the warning still appears with no
  // WiFi/MQTT reconnect happening nearby, that points at a genuine
  // ADS1292R/SPI/power issue instead of this false-positive mechanism.
  lastDrdyTimestamp = millis();
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
  // Lets the driver silently reassociate on its own after a brief drop --
  // see WIFI_RECONNECT_GRACE_MS's comment below for why this matters.
  WiFi.setAutoReconnect(true);
  // Lower TX power -- confirmed working over USB (ample current) but not on
  // battery, which points at the WiFi radio's TX current spike (default max
  // is ~19.5dBm, drawing several hundred mA in bursts) browning out a
  // battery that can't source that peak. Dropped further to 8.5dBm from an
  // earlier 11dBm -- still browning out on a 600mAh/3.7V LiPo (small cell,
  // unknown discharge rating -- likely can't source even the reduced spike
  // without voltage sag), so cutting the peak further. Raise this back up
  // (max WIFI_POWER_19_5dBm) if range turns out to be a problem once
  // brownouts are ruled out; if 8.5dBm still browns out, the battery itself
  // (charge level or discharge/C rating) is the limiting factor, not TX
  // power -- a bulk capacitor across the battery rail or a better-rated
  // cell would be the next step, not a further firmware change.
  WiFi.setTxPower(WIFI_TX_POWER);
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
      // Was setSleep(false) -- fine on USB, but on battery that keeps the
      // radio fully awake between transmissions instead of using WiFi's own
      // modem-sleep power saving, raising sustained average draw for no
      // benefit this app needs (samples publish in ~1s batches, not
      // latency-critical). true re-enables modem sleep.
      WiFi.setSleep(true);
      return;
    }
    Serial.println();
  }
  Serial.println("WiFi connection failed across all configurations.");
}

unsigned long lastMqttAttempt = 0;
const unsigned long MQTT_RETRY_INTERVAL_MS = 2000;

// loop() used to call the full blocking connectWiFi() (up to ~9s of
// delay()-spinning PER configured SSID) on every single iteration where
// WiFi wasn't connected -- during which mqtt.loop(), the heartbeat, and
// DRDY sample draining all stall completely. A brief drop (AP roam,
// momentary RF interference) turned into several seconds of total device
// silence, repeatedly, which is what "sometimes the connection just fails"
// looks like from the app side. Two changes fix this:
//   1. WiFi.setAutoReconnect(true) (set inside connectWiFi(), above) lets the
//      ESP32 driver itself silently reassociate to the AP it just dropped,
//      almost always within under a second, with no loop() involvement at
//      all -- covers the common transient-blip case for free.
// 2. loop() only falls back to the expensive full multi-SSID
//      connectWiFi() scan after WiFi has been down continuously for
//      WIFI_RECONNECT_GRACE_MS (giving setAutoReconnect a real chance to
//      recover first), and even then at most once per
//      WIFI_RECONNECT_RETRY_MS -- instead of re-entering it back-to-back
//      on every loop() tick while still down.
unsigned long wifiDownSince = 0;
unsigned long lastWifiReconnectAttempt = 0;
const unsigned long WIFI_RECONNECT_GRACE_MS = 4000;
const unsigned long WIFI_RECONNECT_RETRY_MS = 10000;

void maintainMQTT() {
  if (mqtt.connected()) return;
  unsigned long now = millis();
  if (now - lastMqttAttempt < MQTT_RETRY_INTERVAL_MS) return;
  lastMqttAttempt = now;

  // Fixed client id "wearable02", deliberately not unique-per-boot -- see
  // the comment above this device's global state (near lastDrdyTimestamp).
  // Known tradeoff: right after a FAST reconnect (e.g. a manual reset,
  // which never cuts power and so cycles much quicker than an off/on power
  // cycle), EMQX may briefly still consider the previous session (same
  // client id) alive and reject or delay this connect attempt -- the MQTT
  // spec says the broker should evict the stale session and accept the new
  // one, but that takeover isn't guaranteed instant. Not fixed by retrying
  // with a different id here (would defeat the point of keeping it fixed);
  // this function's own MQTT_RETRY_INTERVAL_MS loop already retries every
  // 2s regardless, which is what actually rides out that window.
  Serial.print("Connecting to EMQX MQTT Broker...");
  if (mqtt.connect("wearable02", MQTT_USER, MQTT_PASS)) {
    Serial.println(" Connected");
    char online[96];
    snprintf(online, sizeof(online), "{\"status\":\"ONLINE\",\"mode\":\"BIPOLAR_T7_T8\",\"gain\":%d,\"lead_off\":1}", CH2_GAIN);
    mqtt.publish(MQTT_STATUS, online);
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

  // CONFIG2 (0x02): lead-off comparators ON, PDB_REFBUF = 1, VREF = 2.42V
  // (was 0xA0: comparators powered down, so lead-off was never detected)
  if (!verifiedWrite(0x02, CONFIG2_VALUE)) return false;

  // LOFF (0x03): DC lead-off, 6 nA, 95% threshold -- see LOFF_VALUE
  if (!verifiedWrite(0x03, LOFF_VALUE)) return false;

  // CH1SET (0x04): Power-down Ch1 & short input -> 0x81
  if (!verifiedWrite(0x04, 0x81)) return false;

  // CH2SET (0x05): gain CH2_GAIN, normal electrode input -- see CH2SET_VALUE
  if (!verifiedWrite(0x05, CH2SET_VALUE)) return false;

  // RLD_SENS (0x06): see RLD_SENS_VALUE (was 0x2C: no bias lead-off sensing)
  if (!verifiedWrite(0x06, RLD_SENS_VALUE)) return false;

  // LOFF_SENS (0x07): lead-off sensing on channel 2's inputs -- see LOFF_SENS_VALUE
  if (!verifiedWrite(0x07, LOFF_SENS_VALUE)) return false;

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

// Reads one ADS1292R frame per DRDY. Runs in its own task (see the ring
// comment above), so loop() stalls can't make it miss samples.
void sampleTask(void*) {
  for (;;) {
    uint32_t pending = ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    if (pending > 1) missedDrdy += pending - 1;   // frames overwritten before we could read them

    byte r[9];
    SPI.beginTransaction(adsSPI);
    digitalWrite(ADS_PIN_CS, LOW);
    for (int i = 0; i < 9; i++) r[i] = SPI.transfer(0x00);
    digitalWrite(ADS_PIN_CS, HIGH);
    SPI.endTransaction();

    if (!isStatusValid(r[0])) { corruptFrameCount++; continue; }

    loffFrames++;
    if (r[0] & STAT_IN2P_OFF) loffIn2pOff++;
    if (r[0] & STAT_IN2N_OFF) loffIn2nOff++;
    if (r[0] & STAT_RLD_OFF)  loffRldOff++;

    int32_t code = parseSigned24(r[6], r[7], r[8]);
    uint32_t now = millis();
    framesRead++;

    if (fabsf(code * UV_PER_COUNT) > GLITCH_UV) {
      glitchCount++;
      lastGlitch.t = now; lastGlitch.code = code;
      memcpy((void*)lastGlitch.r, r, 9);
      glitchSeq++;
    }

    if (ringHead - ringTail >= RING_SAMPLES) { ringDrops++; continue; }   // full: drop newest
    uint32_t i = ringHead % RING_SAMPLES;
    ringTime[i] = now;
    ringCode[i] = code;
    ringHead++;
  }
}

// Publishes the oldest BATCH_SIZE buffered samples, at most one batch per
// call, and only when connected. On failure nothing is consumed -- the same
// samples are retried next time, so a Wi-Fi drop delays data, never loses it
// (unless it outlasts the ~32 s ring).
// Sending has to keep up with 250 samples/s. One 25-sample message per
// loop() pass couldn't over a weak link (seen live: RSSI -70 dBm, a ~28 s
// backlog and 3157 batches dropped from a full ring -> stream gaps), since
// each TLS publish carries a fixed cost. Now each message carries up to
// PUBLISH_MAX_SAMPLES (1 s), and while a backlog exists several messages go
// per pass (up to FLUSH_BUDGET_MS), with Wi-Fi modem sleep off until the
// backlog drains (modem sleep delays every TCP ACK). The bridge and psy_web
// parse any number of "millis,code;" records per message.
#define PUBLISH_MAX_SAMPLES   250                  // 1 s per MQTT message
#define FLUSH_BUDGET_MS       40                   // max time per loop() pass spent sending
#define BACKLOG_SLEEP_OFF     (SOURCE_SPS)         // > 1 s queued: modem sleep off
#define BACKLOG_SLEEP_ON      (SOURCE_SPS / 5)     // < 0.2 s queued: modem sleep back on
#define SOURCE_SPS            250
bool modemSleepOn = true;

void flushRing() {
  if (!mqtt.connected()) return;
  uint32_t backlog = ringHead - ringTail;
  // Modem sleep only while caught up -- see the block comment above.
  if (modemSleepOn && backlog > BACKLOG_SLEEP_OFF) { WiFi.setSleep(false); modemSleepOn = false; }
  else if (!modemSleepOn && backlog < BACKLOG_SLEEP_ON) { WiFi.setSleep(true); modemSleepOn = true; }

  static char payload[PUBLISH_MAX_SAMPLES * 20 + 1];
  unsigned long start = millis();
  while (ringHead - ringTail >= BATCH_SIZE && millis() - start < FLUSH_BUDGET_MS) {
    uint32_t tail = ringTail;
    uint32_t n = ringHead - tail;
    if (n > PUBLISH_MAX_SAMPLES) n = PUBLISH_MAX_SAMPLES;
    int offset = 0;
    uint32_t k = 0;
    for (; k < n; k++) {
      uint32_t i = (tail + k) % RING_SAMPLES;
      int w = snprintf(payload + offset, sizeof(payload) - offset, "%lu,%ld;",
                       (unsigned long)ringTime[i], (long)ringCode[i]);
      if (w < 0 || offset + w >= (int)sizeof(payload)) break;
      offset += w;
    }
    bool ok = mqtt.publish(MQTT_TOPIC, payload);
    lastBatchPublish = millis();
    if (!ok) {
      pubDrops++;                                   // retried, not lost
      Serial.println("[MQTT] Publish failed -- samples kept for retry");
      return;
    }
    ringTail = tail + k;
    mqtt.loop();                                    // keep the connection serviced between messages
  }
}

/* ================= SETUP ================= */

void printResetReason() {
  esp_reset_reason_t reason = esp_reset_reason();
  const char* reasonStr;
  switch (reason) {
    case ESP_RST_POWERON:  reasonStr = "POWERON (normal power-up)"; break;
    case ESP_RST_EXT:      reasonStr = "EXT (external reset pin)"; break;
    case ESP_RST_SW:       reasonStr = "SW (software/programmer-triggered reset)"; break;
    case ESP_RST_PANIC:    reasonStr = "PANIC (crash/exception)"; break;
    case ESP_RST_INT_WDT:  reasonStr = "INT_WDT (interrupt watchdog -- something blocked too long)"; break;
    case ESP_RST_TASK_WDT: reasonStr = "TASK_WDT (task watchdog -- something blocked too long)"; break;
    case ESP_RST_WDT:      reasonStr = "WDT (other watchdog)"; break;
    case ESP_RST_BROWNOUT: reasonStr = "BROWNOUT -- supply voltage sagged below threshold. Check battery charge/cable, not code."; break;
    case ESP_RST_SDIO:     reasonStr = "SDIO"; break;
    default:               reasonStr = "UNKNOWN"; break;
  }
  Serial.print("[boot] Reset reason: ");
  Serial.println(reasonStr);
}

void setup() {
  Serial.begin(115200); // Fixed baud rate

  // DELIBERATELY REMOVED the while (!Serial) loop!
  // Do not wait for USB when running on a battery.

  printResetReason();  // first thing printed -- see its own comment above

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

  // DIAGNOSIS (power-cycle-specific reconnect failure): confirmed earlier
  // this session that this LiPo (600mAh/3.7V, unknown C-rating) browns out
  // under the WiFi TX association burst alone (fixed via setTxPower +
  // setSleep). A fresh power-cycle stacks THREE current draws close
  // together that a mid-session WiFi reconnect never has to -- regulator
  // startup inrush, the ADS1292R hardware reset pulse just above, and then
  // the WiFi TX burst only ~1.3s later -- while a runtime reconnect only
  // ever faces the WiFi burst alone, on a rail that's had much longer to
  // recover. This extra settle delay gives the rail more time to recover
  // from the ADS reset inrush specifically before adding WiFi's TX burst on
  // top. NOT confirmed against a real reset-reason log from a failed
  // power-cycle (still don't have one) -- if this doesn't fully fix it,
  // check Serial for "BROWNOUT" (see printResetReason() above) right after
  // a failed power-cycle attempt to confirm vs. rule this out.
  delay(500);

  connectWiFi();

  // Restored Certificate for secure connection
  wifiClient.setCACert(EMQX_CA_CERT);

  // ADDED FIX: Bypass the 1970 time-check failure!
  wifiClient.setInsecure();

  // DIAGNOSIS (MQTT "connection fails" contributor): mqtt.connect() below
  // does a blocking TCP+TLS handshake to EMQX Cloud with no explicit
  // timeout ever set -- same freeze-everything risk WIFI_RECONNECT_GRACE_MS
  // above fixes for WiFi, just unbounded on the MQTT side (core-default
  // timeouts vary by ESP32 Arduino core version, so relying on the default
  // is exactly the kind of implicit assumption that bit this file before --
  // see the "1970 time-check failure" comment above). Bounding both layers
  // explicitly: the underlying TLS socket connect, and PubSubClient's own
  // post-connect read/write socket timeout.
  wifiClient.setTimeout(5000);       // ms -- caps the TLS handshake itself
  mqtt.setSocketTimeout(5);          // seconds -- PubSubClient's own read/write timeout

  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  // Room for a full PUBLISH_MAX_SAMPLES message (~20 bytes/sample + headers).
  mqtt.setBufferSize(PUBLISH_MAX_SAMPLES * 20 + 256);
  maintainMQTT();

  // Created before initADS() attaches the DRDY interrupt that wakes it.
  xTaskCreate(sampleTask, "ads_sample", 4096, nullptr, SAMPLE_TASK_PRIORITY, &sampleTaskHandle);

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
    unsigned long now = millis();
    if (wifiDownSince == 0) wifiDownSince = now;
    // Give WiFi.setAutoReconnect() a real chance to silently recover from a
    // brief drop before paying for the full blocking multi-SSID scan, and
    // even then don't re-enter it more than once per retry window.
    if (now - wifiDownSince >= WIFI_RECONNECT_GRACE_MS
        && now - lastWifiReconnectAttempt >= WIFI_RECONNECT_RETRY_MS) {
      lastWifiReconnectAttempt = now;
      connectWiFi();
    }
  } else {
    wifiDownSince = 0;
  }

  maintainMQTT();
  mqtt.loop();
  flushRing();

  // 5-second Watchdog & Heartbeat
  if (millis() - lastHeartbeatTime > 5000) {
    lastHeartbeatTime = millis();
    bool drdyActive = (millis() - lastDrdyTimestamp < 1000);
    if (!drdyActive) {
      Serial.println("[WARNING] DRDY interrupt stopped pulsing!");
    }
    // Lead-off over the last 5 s, as the share of samples (0-1) with each
    // EEG input flagged off. Anything well above 0 = re-seat that electrode.
    float offP = loffFrames ? (float)loffIn2pOff / loffFrames : 0.0f;
    float offN = loffFrames ? (float)loffIn2nOff / loffFrames : 0.0f;
    float offR = loffFrames ? (float)loffRldOff / loffFrames : 0.0f;
    // Only detects an electrode that is fully off (input past 95% of the
    // rail) -- poor-but-present contact still shows up only in the signal
    // quality checks (RMS, out-of-range share, delta power).
    if (offP > 0.5f || offN > 0.5f || offR > 0.5f) {
      Serial.print("[WARNING] Electrode off: ");
      if (offP > 0.5f) Serial.print("IN2P ");
      if (offN > 0.5f) Serial.print("IN2N ");
      if (offR > 0.5f) Serial.print("BIAS(RLD) ");
      Serial.println();
    }
    loffFrames = loffIn2pOff = loffIn2nOff = loffRldOff = 0;
    // DRDY pulses sampleTask() couldn't read in time -- should now stay ~0.
    uint32_t missed = missedDrdy;
    missedDrdy = 0; drdyPulses = 0; framesRead = 0;
    if (mqtt.connected()) {
      char hb[256];
      snprintf(hb, sizeof(hb),
               "{\"uptime_ms\":%lu,\"drdy_ok\":%d,\"loff_in2p\":%.2f,\"loff_in2n\":%.2f,\"loff_rld\":%.2f,"
               "\"glitches\":%lu,\"missed_drdy\":%lu,\"pub_drops\":%lu,\"rssi\":%d,\"queued\":%u,\"queue_drops\":%lu}",
               millis(), drdyActive ? 1 : 0, offP, offN, offR,
               (unsigned long)glitchCount, (unsigned long)missed, (unsigned long)pubDrops, (int)WiFi.RSSI(),
               (unsigned)(ringHead - ringTail) / BATCH_SIZE, (unsigned long)(ringDrops / BATCH_SIZE));
      mqtt.publish(MQTT_STATUS, hb);
      lastHeartbeatPublish = millis();
    }
    glitchCount = 0; glitchLogged = 0; pubDrops = 0;
  }

  // Samples are read by sampleTask(); loop() only reports glitches and
  // (optionally) plots. Printing here can block loop() but never sampling.
  if (glitchSeq != glitchPrintedSeq) {
    glitchPrintedSeq = glitchSeq;
    if (glitchLogged < GLITCH_LOG_MAX) {
      glitchLogged++;
      const GlitchInfo& g = lastGlitch;
      Serial.printf("[GLITCH] t=%lu code=%ld (0x%06lX) %.0f uV | since_hb=%lu ms since_batch=%lu ms"
                    " | loff=%s%s%s | bytes=%02X %02X %02X  %02X %02X %02X  %02X %02X %02X\n",
                    (unsigned long)g.t, (long)g.code, (unsigned long)(g.code & 0xFFFFFF), g.code * UV_PER_COUNT,
                    (unsigned long)(g.t - lastHeartbeatPublish), (unsigned long)(g.t - lastBatchPublish),
                    (g.r[0] & STAT_IN2P_OFF) ? "P" : "-", (g.r[0] & STAT_IN2N_OFF) ? "N" : "-", (g.r[0] & STAT_RLD_OFF) ? "R" : "-",
                    g.r[0], g.r[1], g.r[2], g.r[3], g.r[4], g.r[5], g.r[6], g.r[7], g.r[8]);
    }
  }

#if SERIAL_PLOT
  static uint32_t plotted = 0;
  if (plotted < ringTail) plotted = ringTail;            // don't plot what's already been dropped
  while (plotted < ringHead) {
    Serial.print("EEG(uV):");
    Serial.println(ringCode[plotted % RING_SAMPLES] * UV_PER_COUNT, 2);
    plotted++;
  }
#endif
}