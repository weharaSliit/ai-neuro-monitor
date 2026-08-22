set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="$ROOT/venv/bin/python3"
CRED="$ROOT/backend/common/serviceAccountKey.json"

port_listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
proc_running()   { pgrep -f "$1" >/dev/null 2>&1; }

echo "== MQTT broker (mosquitto) =="
if port_listening 1883; then
  echo "  already running"
else
  brew services start mosquitto
  sleep 1
fi

echo "== physiological backend (:5050) =="
if port_listening 5050; then
  echo "  already running"
else
  nohup "$PY" -m backend.physiological.app > /tmp/physiological_backend.log 2>&1 &
  disown
  echo "  started, pid $!"
fi

echo "== psychological backend (:5001, Firebase enabled) =="
if port_listening 5001; then
  echo "  already running"
else
  FIREBASE_CREDENTIALS="$CRED" nohup "$PY" -m backend.psychological.app > /tmp/psychological_backend.log 2>&1 &
  disown
  echo "  started, pid $!"
fi

echo "== phenotyping_behavior backend (:5002) =="
if port_listening 5002; then
  echo "  already running"
else
  nohup "$PY" -m backend.phenotyping_behavior.app > /tmp/phenotyping_backend.log 2>&1 &
  disown
  echo "  started, pid $!"
fi

echo "== waiting for backends to come up =="
for i in $(seq 1 15); do
  port_listening 5050 && port_listening 5001 && port_listening 5002 && break
  sleep 1
done

echo "== wearable01 (ring) MQTT bridge, session=${SESSION_ID:-<app-driven>} =="
if proc_running "backend.physiological.mqtt_bridge"; then
  echo "  already running"
else
  STRESSAPP_MQTT_BROKER=localhost RING_SESSION_ID="${SESSION_ID:-}" nohup "$PY" -u -m backend.physiological.mqtt_bridge \
    > /tmp/physio_mqtt_bridge.log 2>&1 &
  disown
  echo "  started, pid $!"
fi

echo "== wearable02 (EEG) MQTT bridge, session=${SESSION_ID:-<app-driven>} =="
if proc_running "backend.psychological.mqtt_bridge"; then
  echo "  already running"
else
  EEG_MQTT_BROKER=localhost EEG_SESSION_ID="${SESSION_ID:-}" nohup "$PY" -u -m backend.psychological.mqtt_bridge \
    > /tmp/eeg_mqtt_bridge.log 2>&1 &
  disown
  echo "  started, pid $!"
fi

echo "== fusion engine live session =="
if proc_running "fusion_live_session.py"; then
  echo "  already running"
else
  ( cd "$ROOT" && FIREBASE_CREDENTIALS="$CRED" nohup "$PY" -u "fushion engin/fusion_live_session.py" \
      ${SESSION_ID:+--session-id "$SESSION_ID"} > /tmp/fusion_live_session.log 2>&1 & disown )
  echo "  started"
fi

echo "== StressApp (Expo web, :8081) =="
if port_listening 8081; then
  echo "  already running"
else
  ( cd "$ROOT/StressApp" && nohup npx expo start --web --port 8081 > /tmp/stressapp_expo.log 2>&1 & disown )
  echo "  started"
fi

echo
echo "============================================================"
if [ -n "${SESSION_ID:-}" ]; then
  echo "Stack up. session_id pinned (debug override): $SESSION_ID"
else
  echo "Stack up. session_id is app-driven -- open StressApp to start a session"
  echo "(each bridge + the fusion engine follow their own current_session_id field in Firebase)."
fi
echo "  StressApp:            http://localhost:8081"
echo "  physiological backend: http://localhost:5050/health"
echo "  psychological backend: http://localhost:5001/health"
echo "  phenotyping backend:   http://localhost:5002/health"
echo "Logs:"
echo "  /tmp/physiological_backend.log   /tmp/psychological_backend.log"
echo "  /tmp/phenotyping_backend.log     /tmp/physio_mqtt_bridge.log"
echo "  /tmp/eeg_mqtt_bridge.log         /tmp/fusion_live_session.log"
echo "  /tmp/stressapp_expo.log"
echo
echo "NOTE: wearable02 needs this Mac on the same WiFi network the ESP32"
echo "connects to (mDNS-resolved via iot_firmware/wearable02/wearable02.ino)"
echo "-- nothing flows from that device until the two share a network."
echo "============================================================"
