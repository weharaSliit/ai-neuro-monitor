#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include "MAX30105.h"
#include "heartRate.h"

// Tried in order in connectWiFi() -- add more pairs here as needed rather
// than re-flashing every time the device needs a different network.
const int WIFI_NETWORK_COUNT = 2;
const char* WIFI_SSIDS[WIFI_NETWORK_COUNT]     = { "Wehara's A07", "Hiruni" };
const char* WIFI_PASSWORDS[WIFI_NETWORK_COUNT] = { "wehara1216",   "Hiruni2022" };
// EMQX Cloud Serverless broker (mindpulse-broker, Asia-Pacific) -- replaces
// the local-IP broker this used to point at. Serverless only accepts TLS
// on 8883 (see EMQX_CA_CERT below) with username/password auth, unlike
// the old local Mosquitto's plain-TCP/allow_anonymous setup.
const char* MQTT_BROKER   = "ob1f0f10.ala.asia-southeast1.emqxsl.com";
const int   MQTT_PORT     = 8883;
const char* MQTT_USER     = "wearable01";
const char* MQTT_PASS     = "wearable01";
const char* MQTT_TOPIC    = "mindpulse/wearable01/sensors";
const char* DEVICE_ID     = "wearable01";

// EMQX Cloud's CA (DigiCert Global Root G2, downloaded from the
// mindpulse-broker Overview page, expires 2031-11-10) -- needed for
// WiFiClientSecure to verify the TLS connection. Same cert is used by
// wearable02.ino and saved standalone at iot_firmware/emqxsl-ca.crt.
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

WiFiClientSecure espClient;
PubSubClient mqttClient(espClient);

Adafruit_MPU6050 mpu;
MAX30105 particleSensor;
const int GSR_PIN = D0;

long lastBeat = 0;
bool max30102_ok = false;
bool mpu6050_ok  = false;

unsigned long lastPublish = 0;
const unsigned long PUBLISH_INTERVAL = 200;

const int MAX_IBI = 20;
long ibiBuffer[MAX_IBI];
int ibiCount = 0;

void connectWiFi() {
  for (int i = 0; i < WIFI_NETWORK_COUNT; i++) {
    Serial.print("Connecting to WiFi: ");
    Serial.println(WIFI_SSIDS[i]);
    WiFi.begin(WIFI_SSIDS[i], WIFI_PASSWORDS[i]);
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 40) {
      delay(500);
      Serial.print(".");
      attempts++;
    }
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\nWiFi connected to " + String(WIFI_SSIDS[i]) + ". IP: " + WiFi.localIP().toString());
      Serial.println("WiFi signal strength (RSSI): " + String(WiFi.RSSI()) + " dBm");
      return;
    }
    Serial.println("\nFailed to connect to " + String(WIFI_SSIDS[i]) + " after 20s -- trying next network");
  }
  Serial.println("WiFi connection FAILED for all known networks -- retrying in loop");
}

void connectMQTT() {
  while (!mqttClient.connected()) {
    Serial.print("Connecting to MQTT broker...");
    if (mqttClient.connect(DEVICE_ID, MQTT_USER, MQTT_PASS)) {
      Serial.println("connected");
    } else {
      Serial.print("failed, rc=");
      Serial.print(mqttClient.state());
      Serial.println(" — WiFi status: " + String(WiFi.status()));
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  analogReadResolution(12);
  Wire.begin(D4, D5);
  Wire.setClock(400000);

  Serial.print("MPU-6050: ");
  if (!mpu.begin()) {
    Serial.println("NOT FOUND");
  } else {
    Serial.println("OK");
    mpu.setAccelerometerRange(MPU6050_RANGE_2_G);
    mpu.setGyroRange(MPU6050_RANGE_250_DEG);
    mpu6050_ok = true;
  }

  Serial.print("MAX30102: ");
  if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("NOT FOUND");
  } else {
    Serial.println("OK");
    particleSensor.setup();
    particleSensor.setPulseAmplitudeRed(0x0A);
    particleSensor.setPulseAmplitudeGreen(0);
    max30102_ok = true;
  }

  connectWiFi();

  espClient.setCACert(EMQX_CA_CERT);
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setKeepAlive(60);
  mqttClient.setSocketTimeout(10);

  Serial.println("--- Starting sensor + MQTT loop ---");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi dropped, reconnecting...");
    connectWiFi();
  }

  if (!mqttClient.connected()) {
    connectMQTT();
  }
  mqttClient.loop();

  long irValue = 0;
  if (max30102_ok) {
    irValue = particleSensor.getIR();

    if (checkForBeat(irValue)) {
      long delta = millis() - lastBeat;
      lastBeat = millis();

      if (delta >= 300 && delta <= 2000 && ibiCount < MAX_IBI) {
        ibiBuffer[ibiCount++] = delta;
      }
    }
  }

  if (millis() - lastPublish >= PUBLISH_INTERVAL) {
    lastPublish = millis();

    int gsrValue = analogRead(GSR_PIN);

    float accX = 0, accY = 0, accZ = 0;
    if (mpu6050_ok) {
      sensors_event_t a, g, temp;
      mpu.getEvent(&a, &g, &temp);
      accX = a.acceleration.x;
      accY = a.acceleration.y;
      accZ = a.acceleration.z;
    }

    StaticJsonDocument<384> doc;
    doc["device_id"] = DEVICE_ID;
    doc["ts"] = millis();
    doc["gsr"] = gsrValue;
    doc["ir"] = irValue;
    doc["finger"] = (irValue > 50000);
    doc["acc_x"] = accX;
    doc["acc_y"] = accY;
    doc["acc_z"] = accZ;

    JsonArray ibiArr = doc.createNestedArray("ibi");
    for (int i = 0; i < ibiCount; i++) {
      ibiArr.add(ibiBuffer[i]);
    }
    ibiCount = 0;

    char payload[384];
    serializeJson(doc, payload);

    mqttClient.publish(MQTT_TOPIC, payload);
    Serial.println(payload);
  }
}
