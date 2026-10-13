import { useEffect, useState } from 'react';
import mqtt from 'mqtt';

// wearable02 publishes {"uptime_ms":..,"drdy_ok":0|1} to its status topic
// every 5s (iot_firmware/wearable02/wearable02.ino), independent of the
// bridge or the EEG API. Firebase only shows a block once the bridge has
// finished its own ~75s calibration, so this heartbeat is the only way to
// know the headband is on from the moment it's worn.
//
// Only the status topic -- never the 250 SPS EEG topic. EMQX Cloud's
// WebSocket-TLS listener (8084, /mqtt), same broker/credentials the
// firmware and backend/psychological/mqtt_bridge.py use.
const MQTT_URL = 'wss://ob1f0f10.ala.asia-southeast1.emqxsl.com:8084/mqtt';
const MQTT_USER = 'wearable02';
const MQTT_PASS = 'wearable02';
const STATUS_TOPIC = 'mindpulse/wearable02/status';
// Fixed, not per-tab unique -- one stable entry in the EMQX dashboard, same
// policy as the firmware and bridges. Tradeoff: two tabs open at once share
// this id and the broker keeps kicking one off (the other still falls back
// to Firebase freshness in useDeviceStatus).
const CLIENT_ID = 'web_wearable02_status';

// One connection shared by every component that asks (UserDashboard,
// SetupPage, ...) -- per-component clients with the same fixed id would
// evict each other.
let client = null;
let users = 0;
let last = { at: null, drdyOk: null };
const listeners = new Set();

function publish(next) {
  last = next;
  listeners.forEach((fn) => fn(last));
}

function acquire() {
  users += 1;
  if (client) return;
  client = mqtt.connect(MQTT_URL, {
    clientId: CLIENT_ID, username: MQTT_USER, password: MQTT_PASS,
    clean: true, reconnectPeriod: 5000, connectTimeout: 10000,
  });
  client.on('connect', () => client.subscribe(STATUS_TOPIC));
  client.on('message', (_topic, payload) => {
    try {
      const msg = JSON.parse(payload.toString());
      // The connect message ({"status":"ONLINE",...}) has no drdy_ok; it
      // still proves the device is up.
      publish({ at: Date.now(), drdyOk: msg.drdy_ok == null ? last.drdyOk : msg.drdy_ok === 1 });
    } catch { /* ignore non-JSON */ }
  });
  client.on('error', () => { /* reconnects by itself; Firebase freshness covers the gap */ });
}

function release() {
  users -= 1;
  if (users <= 0 && client) {
    client.end(true);
    client = null;
    users = 0;
  }
}

// { at: ms of last heartbeat | null, drdyOk: bool | null }
export default function useHeadbandHeartbeat(enabled = true) {
  const [beat, setBeat] = useState(last);
  useEffect(() => {
    if (!enabled) return undefined;
    acquire();
    listeners.add(setBeat);
    setBeat(last);
    return () => { listeners.delete(setBeat); release(); };
  }, [enabled]);
  return beat;
}
