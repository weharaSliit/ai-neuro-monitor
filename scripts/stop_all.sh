#!/usr/bin/env bash
# ============================================================
# stop_all.sh -- stops everything start_all.sh starts, except mosquitto
# (managed separately via `brew services stop mosquitto` since other
# things on this machine may depend on it staying up).
# ============================================================

set -uo pipefail

kill_port() {
  local port="$1" name="$2"
  local pids
  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tail -n +2 | awk '{print $2}' | sort -u)"
  if [ -n "$pids" ]; then
    echo "stopping $name (:$port) pid(s) $pids"
    echo "$pids" | xargs kill 2>/dev/null
  else
    echo "$name (:$port) not running"
  fi
}

kill_pattern() {
  local pattern="$1" name="$2"
  local pids
  pids="$(pgrep -f "$pattern")"
  if [ -n "$pids" ]; then
    echo "stopping $name pid(s) $pids"
    echo "$pids" | xargs kill 2>/dev/null
  else
    echo "$name not running"
  fi
}

kill_port 5050 "physiological backend"
kill_port 5001 "psychological backend"
kill_port 5002 "phenotyping_behavior backend"
kill_port 8081 "StressApp (Expo web)"
kill_pattern "backend.physiological.mqtt_bridge" "wearable01 (ring) bridge"
kill_pattern "backend.psychological.mqtt_bridge" "wearable02 (EEG) bridge"
kill_pattern "fusion_live_session.py" "fusion engine session"

echo "Done. mosquitto left running -- stop separately with: brew services stop mosquitto"
