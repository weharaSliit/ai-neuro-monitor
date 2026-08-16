#include <Wire.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include "MAX30105.h"
#include "heartRate.h"

const char* WIFI_SSID     = "Wehara's A07";   // fill in
const char* WIFI_PASSWORD = "wehara1216";  // fill in
const char* MQTT_BROKER   = "10.76.255.56";
const int   MQTT_PORT     = 1883;
const char* MQTT_TOPIC    = "mindpulse/wearable01/sensors";
const char* DEVICE_ID     = "wearable01";

WiFiClient espClient;
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
  Serial.print("Connecting to WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected. IP: " + WiFi.localIP().toString());
    Serial.println("WiFi signal strength (RSSI): " + String(WiFi.RSSI()) + " dBm");
  } else {
    Serial.println("\nWiFi connection FAILED after 20s — retrying in loop");
  }
}

void connectMQTT() {
  while (!mqttClient.connected()) {
    Serial.print("Connecting to MQTT broker...");
    if (mqttClient.connect(DEVICE_ID)) {
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
