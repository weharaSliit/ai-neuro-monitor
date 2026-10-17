# psy_web — Wearable 02 EEG monitor (proof of concept)

A standalone React dashboard for the psychological (EEG) component. It shows
wearable 02's raw signal, calibration, extracted features, task-state score and label as
they happen. It only reads, with one exception: the **Recalibrate** button in the
technical view's Calibration card writes `eeg_recalibration/{session}`. The EEG bridge
(`backend/psychological/mqtt_bridge.py`) checks that node every 10 s, discards the
session's baseline, records new rest blocks and reports its progress back there.

```bash
cd psy_web
npm install
npm run dev        # http://localhost:5174
```

**Two views**
- **Simple view** (default, for non-technical users): Home · Progress · Brainwaves · Calibrate · Profile.
  Plain language, mood faces, a 0–100 "mind load", break suggestions and a 1-minute breathing exercise.
  Each word maps to one technical value (see `src/lib/friendly.js`): mind load = `task_state_score × 100`;
  the mood face compares the score with the user's alert level (`effective_high_load_p`).
- **Technical view** (Profile → Technical view, or `#tech`): the raw signal, all 29 features, model contributions, the block log and the API.
- **Wearable 01 HRV + GSR monitor** (Technical view → Wearable 01 HRV + GSR monitor, or `#physio`): live ring signals over MQTT (`mindpulse/wearable01/sensors`: skin conductance, heart rate from beat intervals, PPG, movement), the stress prediction per window, the processed GSR wave and beat intervals the model saw, the personal baseline and threshold, all features against the baseline, the window log and the ring API's `/health`. Reads `physiological/{predictions,prediction_quality,baselines,personal_thresholds,devices}`; follows `fusion_en/current_*` like the ring bridge. Never reads `physiological/users`.
- **Calibration, scores & alerts dashboard** (Technical view → Calibration, scores & alerts, or `#calibration`): for the selected session, baseline and high-load threshold calibration graphs for EEG, HRV/GSR and fused (each block's score, the running mean settling, and the value chosen), each component's score and label over time (EEG at its amplitude gain), the rising alerts from each component on one timeline, and a feature dropdown graph for EEG and for HRV/GSR.
- **Fusion engine monitor** (Technical view → Fusion engine monitor, or `#fusion`): the fused EEG + HRV/GSR stress result per window from `fusion_en/{uid}/{sid}`, a step-by-step breakdown of how each window's weights and fused value were computed (cross-checked against the stored value), timelines, a session summary and the window log. Follows `fusion_en_sessions/current_*` by default.

For live data, run wearable02 and `backend/psychological/mqtt_bridge.py` as usual. The page
follows `psychological/current_user_id` / `current_session_id`, the same session the bridge
posts under. Untick **Follow live session** to browse past sessions.

| Panel | Source |
|---|---|
| Raw reading, device heartbeat | MQTT `mindpulse/wearable02/eeg` + `/status` over EMQX WebSocket (`wss://…:8084/mqtt`). Raw samples are never stored in Firebase. |
| Task state, block log, features, filtered wave | Firebase `psychological/{uid}/{sid}/{window}` (written by `/predict`) |
| Calibration | `…/calibration_result`, `…/threshold_result`, `user_profiles/{uid}/eeg` |
| API status | `GET https://mindpulse-eeg.onrender.com/health` |
| "Why this score" | `src/lib/model_coefficients.json`, the scaler and coefficients exported from `backend/psychological/models/sam40_t7t8_state_model.joblib`. Re-export if the model is retrained. |

Optional overrides (`.env.local`): `VITE_MQTT_URL`, `VITE_MQTT_USER`, `VITE_MQTT_PASS`, `VITE_EEG_API_BASE`.

The MQTT client id is fixed (`psy_web_wearable02`), so keep only one tab open. A second
tab with the same id will keep kicking the first off the broker.
