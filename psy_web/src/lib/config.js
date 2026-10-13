// Every value here mirrors an existing source of truth -- this site only
// READS what wearable02 + backend/psychological already produce; it never
// writes to Firebase or calls a mutating API route.

// Same RTDB as web/ and StressApp (backend/common/firebase_config.py).
export const FIREBASE_DB_URL = 'https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app';

// Same Render service mqtt_bridge.py posts blocks to. Only GET /health
// (no auth) is used.
export const EEG_API_BASE = import.meta.env.VITE_EEG_API_BASE || 'https://mindpulse-eeg.onrender.com';

// Raw samples never reach Firebase (app.py keeps them on local disk), so
// the raw view subscribes to the same EMQX topic the firmware publishes
// to, over EMQX Cloud's WebSocket-TLS listener (8084, /mqtt) -- the
// browser can't speak raw MQTT/TLS on 8883 like mqtt_bridge.py does.
export const MQTT_URL = import.meta.env.VITE_MQTT_URL || 'wss://ob1f0f10.ala.asia-southeast1.emqxsl.com:8084/mqtt';
export const MQTT_USER = import.meta.env.VITE_MQTT_USER || 'wearable02';
export const MQTT_PASS = import.meta.env.VITE_MQTT_PASS || 'wearable02';
export const MQTT_TOPIC_EEG = 'mindpulse/wearable02/eeg';       // wearable02.ino MQTT_TOPIC
export const MQTT_TOPIC_STATUS = 'mindpulse/wearable02/status'; // wearable02.ino MQTT_STATUS
// Fixed, not per-load unique -- one stable entry in the EMQX client
// dashboard, same policy as the firmware and the bridges. Tradeoff: two
// tabs open at once share this id and the broker will keep kicking one off.
export const MQTT_CLIENT_ID = 'psy_web_wearable02';

// Hardware constants (wearable02.ino initADS(), realtime/adc.py).
export const SOURCE_FS = 250;                 // CONFIG1 = 0x01 -> 250 SPS
export const UV_PER_COUNT = 0.0360608;        // VREF / (gain * (2^23 - 1)), gain 8 (CH2SET 0x50), VREF 2.42V (realtime/adc.py)
export const BATCH_SIZE = 250;                // max samples per MQTT message (wearable02.ino PUBLISH_MAX_SAMPLES)

// Pipeline constants (backend/psychological/realtime/pipeline.py, mqtt_bridge.py).
export const BLOCK_SEC = 25;
export const N_CALIBRATION_BLOCKS = 3;
export const TARGET_FS = 128;
export const BIPOLAR_HIGHPASS_HZ = 1.0;
export const CLIP_UV = 100;
export const TASK_STATE_LABEL_THRESHOLD = 0.5;      // firebase_sync.py
export const POPULATION_HIGH_LOAD_P = 0.7933008189294708; // sam40/decision.py DecisionThresholds

export const RAW_WINDOW_SEC = 10;  // seconds of raw signal kept on screen

// ── Wearable 01 (ring: HRV + GSR) -- backend/physiological, read-only ──
// Same Render service backend/physiological/mqtt_bridge.py posts windows to;
// only GET /health (no auth) is used.
export const PHYSIO_API_BASE = import.meta.env.VITE_PHYSIO_API_BASE || 'https://mindpulse-physiological.onrender.com';
// wearable01.ino publishes one JSON message every PUBLISH_INTERVAL = 200 ms.
export const MQTT_TOPIC_RING = 'mindpulse/wearable01/sensors';
export const MQTT_RING_USER = import.meta.env.VITE_MQTT_RING_USER || 'wearable01';
export const MQTT_RING_PASS = import.meta.env.VITE_MQTT_RING_PASS || 'wearable01';
export const MQTT_RING_CLIENT_ID = 'psy_web_wearable01';   // fixed, same policy as MQTT_CLIENT_ID
export const RING_MSG_HZ = 5;
export const RING_WINDOW_SEC = 60;       // backend/common/config.py WINDOW_SEC
export const RING_SLIDE_SEC = 20;        // mqtt_bridge.py SLIDE_INTERVAL_SEC
export const GSR_CAL = 2872;             // backend/common/config.py GSR_CAL (ADC with electrodes off)
export const RING_FINGER_IR = 50000;     // wearable01.ino: finger = ir > 50000
// backend/common/config.py: v3 baseline-normalised model / raw-feature fallback.
export const STRESS_DECISION_THRESHOLD = 0.6447;
export const RAW_DECISION_THRESHOLD = 0.7141;
export const PERSONAL_THRESHOLD_MIN_SEPARATION = 0.10;   // predictor.py
export const CALIBRATION_SOFT_AGE_DAYS = 7;
export const CALIBRATION_HARD_AGE_DAYS = 30;
