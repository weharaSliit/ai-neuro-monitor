# Implementation, Integration and Testing

## Development Environment and Technology Stack

Table[stack]: Technology stack of the ring component
| Layer | Technology |
| Ring hardware | Seeed XIAO ESP32-C3, MAX30102 pulse sensor (I2C 0x57), Grove GSR sensor, MPU-6050 (I2C 0x68), 250 mAh LiPo with TP4056 charger |
| Transport | MQTT over TLS (EMQX Cloud broker) |
| Modelling | Python 3.11, NumPy, SciPy, PyWavelets, pandas, scikit-learn {{cite:pedregosa}}, XGBoost {{cite:chen}}, Jupyter notebooks |
| Backend | Flask services hosted on Render; Firebase Realtime Database |
| Mobile application | React Native 0.81 with Expo SDK 54, react-native-svg |
| Web dashboard | React 19, Vite 7, React Router, Firebase web SDK |
| Version control | Git and GitHub |
Source: project configuration files.

The ring firmware is written in C++ as an Arduino sketch for the ESP32-C3 and uses the Arduino ESP32 WiFi libraries, PubSubClient for MQTT, ArduinoJson for message construction, the MAX3010x library for the pulse sensor and the Adafruit MPU6050 library for the accelerometer. The analogue GSR input is read with a 12-bit converter, and the I2C bus runs at 400 kHz. [[TODO: state the IDE and board-package version used to build and upload the firmware (for example Arduino IDE and its version).]] The physiological backend runs on Python 3.11 with Flask 3.0.0, Flask-CORS 4.0.0, firebase-admin 6.4.0, paho-mqtt 2.1.0, XGBoost 2.0.3, scikit-learn 1.4.2, NumPy 1.26.4, pandas 2.2.1, joblib 1.3.2 and PyWavelets 1.6.0, as pinned in the service's requirements file.

## Component Implementation

### Feature extraction and scoring

`extract_features.py` converts a window of inter-beat intervals, raw GSR values and acceleration into the 23 features, applying the cleaning described in Chapter 3. GSR cut-offs are clamped to a safe fraction of the Nyquist frequency because the ring publishes at about 5 Hz. A window whose heart-rate data are too short returns a flag that makes `/predict` reject the window instead of scoring placeholder numbers. `predictor.py` loads the saved model, scaler and feature list, normalises features against the user's baseline, scores the window, and updates the trend state machine. The population threshold (0.7141) and the vote threshold of the trend indicator (0.35) are held in a shared configuration file.

### Calibration

`calibration_capture.py` implements the calm baseline and the limit test. Capture runs in the background: the app starts it and polls a status route every two seconds, and each window is checked for motion and for enough clean beats before it counts. Windows that fail are retried, with six extra windows allowed. Resting scores are saved after the baseline so that a later limit test can use them, possibly in a separate request. The personal threshold is computed and stored only when the separation rule is met; otherwise the record shows that the population threshold is kept.

### Processed signal storage

Each stored window carries its 23 features, probability, label and trend flag. For the clinical view it also carries a filtered GSR preview reduced to 80 points and the inter-beat intervals capped at the most recent 150. Raw ADC and raw interval arrays are never written to the database.

### Interfaces

The mobile application and the web dashboard read the same routes. A shared chart component, written once for each platform, sizes itself to its container, draws the user's own limit as a dashed line and colours the line green, amber or red around it, scrolls sideways when readings are crowded, and shows the value on touch or hover. The calibration card shows a breathing circle inside a progress ring, with one progress bar per device in plain words.

### Engineering issues found and fixed

Three problems found during development changed the design. First, the clinical screen lagged because three uncoordinated polls (every 5 s, every 8 s and an unbounded one over all sessions) fetched the same history; they were merged into one cycle with a cache for finished sessions, an in-flight guard and memoised charts. Second, the stress label on the home screen briefly flashed "Normal" every minute: a new minute's record is created when the first device reports, and the fused label is added a moment later, so the screen read an unfused record; readings are now taken from the newest record that actually contains them. Third, the website and the phone share one live-session pointer, so the website joins an active session of the same user, starts one only if nobody is live, and is view-only when someone else is live, to avoid taking the devices away from the phone.

## Integration with the Other Components

The ring writes its probability and threshold into the fused record of the current minute; the EEG component writes its own probability and threshold into the same record. The fusion engine weights each modality by its signal quality, combines them, and compares the result with a weighted combination of the two personal thresholds to give the fused label, a trend, and an alert message. The app and the web dashboard show "Mind" (EEG) and "Body" (ring) rings side by side from these records. The phone-behaviour component and the relaxation guide are reached from the same home screen. [[TODO: add one paragraph on how the fusion weights are computed and tested if you contributed to that part; otherwise refer the reader to the fusion section of the group report.]]

## Verification and Software Testing

### Offline experiments

The experiments of Chapter 6 are the main verification of the model: LOSO validation of ten models, ROC analysis, the personalisation experiment, the cross-dataset check, and the trend-indicator validation.

### Software testing

The mobile application and the web dashboard were built and bundled after every change to confirm that all imports resolve, and the screens were exercised manually against the live backend. No formal test run was carried out for this draft, and no automated test suite exists. {{tab:testcases}} therefore lists the manual test cases planned for the final evaluation, with expected results taken from the behaviour defined in the code. Two cases were incidentally observed during development and are marked as such; the others are recorded as not yet run.

Table[testcases]: Planned manual test cases
| ID | Description | Input | Expected result | Actual result | Pass/fail |
| T1 | Register a new user | Unused username, password of at least 6 characters | Account created and the user is asked to calibrate | Not yet run | Not run |
| T2 | Register with a short password | Password of fewer than 6 characters | Request rejected (HTTP 400) with a clear message | Not yet run | Not run |
| T3 | Register with a taken username | Existing username | Request rejected (HTTP 409) | Not yet run | Not run |
| T4 | Log in with a wrong password | Valid username, wrong password | Login refused (HTTP 401), no token issued | Not yet run | Not run |
| T5 | Calibrate with the ring off | Start calibration with no ring data arriving | No baseline saved; the user is told no ring data were received | Not yet run | Not run |
| T6 | Calibrate with the finger off the sensor | Ring connected, finger removed | Windows with too few valid beats are rejected and no baseline is saved from them | Not yet run | Not run |
| T7 | Start calibration twice | Second start while one is running | Second request refused (HTTP 409) | Not yet run | Not run |
| T8 | Limit test with poor separation | Task scores within 0.10 of rest scores | Population threshold kept (safe fallback) | Observed on real users: 12 of 17 calibrated records had no personal threshold | Not run as a formal test |
| T9 | Recalibrate | Calibrate again after an existing baseline | New baseline blended with the old (EMA, alpha 0.2) | Not yet run | Not run |
| T10 | Stress label stability | Live session in which heart rate briefly falls during stress | Label stays Stress | A one-second flicker to Normal was found and fixed by reading each value from the newest window that has it; the user confirmed the fix | Pass after fix |
| T11 | View a user in the clinical view | Admin opens a user | 23 features, processed GSR and inter-beat-interval previews are shown | Not yet run | Not run |
| T12 | Website opened while the phone is live | Web login of the same or another user during a live phone session | Same user joins the session; a different user gets a view-only page; the web ends only a session it started | Not yet run | Not run |
Source: compiled by the author from the system behaviour; two cases were observed during development.

### Findings of the verification

Writing and checking this chapter against the code and data revealed four train–serve inconsistencies ({{tab:findings}}). The most important was the first: the first classifier and its scaler were trained on raw WESAD features (the scaler mean of AVNN is 778 ms), but for every user who has a baseline, `/predict` first normalises the features against that baseline (a ratio for EDA features and a z-score for the others) and then passed them to the same scaler and model. As a diagnostic, the baseline-normalised inputs of all 913 WESAD windows were passed through the original scaler and model; this gave an AUC of 0.829 and a mean stress probability of 0.51 for Normal and 0.80 for Stress windows, and 26.1% of Normal windows and 70.6% of Stress windows reached the earlier threshold of 0.7141. This check is in-sample, because the model was trained on the same windows, so it demonstrates the mismatch and not a new accuracy figure. The mismatch was corrected by retraining the classifier on baseline-normalised features with the notebook 06 protocol (script `retrain_personalised.py`), and the decision threshold was re-derived from the pooled out-of-fold probabilities (Section 6.1). The original raw-feature model is kept only for the path that scores a user who has no baseline yet. The LOSO values reported for the model comparison (accuracy 0.851, AUC 0.938) describe the raw-feature model.

Table[findings]: Train–serve inconsistencies found during verification
| ID | Finding | Effect | Status |
| V1 | Model and scaler fitted on raw features; live path scores baseline-normalised features | Probabilities for users with a baseline are not those validated offline | Fixed: the model was retrained on baseline-normalised features (`retrain_personalised.py`), giving LOSO accuracy 0.945 and AUC 0.986 at a re-derived threshold of 0.6447. [[TODO: confirm after deployment and re-run of the real-user check.]] |
| V2 | pNN20 is a percentage (0–95) in training and a proportion (0–1) in the ring code | Wrong scale for users without a baseline, where raw features are scored; cancels inside the z-score for users with a baseline | Fixed: the no-baseline path converts pNN20 to the training scale (multiplied by 100) before scoring. |
| V3 | Training intervals come from chest ECG R-peaks; ring intervals come from PPG pulse peaks | Interval noise differs by device | Documented limitation |
| V4 | Training signals at 700 Hz; ring GSR at about 5 Hz, with clamped filter cut-offs | Slow features are comparable; fast features (SCR counts, derivatives) may differ | Documented limitation |
Source: code and data inspection by the author.

## Deployment and Operation

The Flask services run on a free Render tier, which sleeps when idle, so the first request after a pause can take 20 to 40 seconds; the clients use long time-outs and show a clear waiting message. The database is a Firebase Realtime Database. The mobile application is built as an Android package with Expo, and the website is a static build that any static host can serve. Deployment followed four steps. First, the backend services (physiological, EEG, phone behaviour and relaxation guide) were published as separate Flask services on Render, and changes reached them by pushing the repository to GitHub. Second, the Firebase Realtime Database was shared by all services and clients. Third, the mobile application was built as an installable Android package with Expo Application Services (preview profile) and was also run during development through Expo Go. Fourth, the web dashboard was produced with `npm run build` and served as a single-page application, with a rewrite rule that sends every path to the main page. The clients point to the deployed service addresses and use time-outs of 20 to 45 seconds to cope with the cold start. [[TODO: state which static host serves the website, and whether any monitoring was done or any outage observed; if none, say that no formal monitoring was set up.]]
