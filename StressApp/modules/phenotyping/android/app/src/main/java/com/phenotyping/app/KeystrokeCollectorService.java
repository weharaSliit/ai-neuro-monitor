package com.phenotyping.app;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;

import com.google.android.gms.location.ActivityRecognition;
import com.google.android.gms.location.ActivityRecognitionClient;
import com.google.android.gms.location.ActivityRecognitionResult;
import com.google.android.gms.location.DetectedActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

public class KeystrokeCollectorService extends AccessibilityService {

    private static final String TAG = "PhenoCare_Sensor";

    // -----------------------------------------------------------------------
    // CONFIG — Real device via USB (Android Studio run)
    //   Option A (current): PC's Ethernet IP — works over the same network.
    //   Option B (USB tunnel): run once → adb reverse tcp:5001 tcp:5001
    //   then change FLASK_BASE_URL to "http://localhost:5001"
    // -----------------------------------------------------------------------
    
    //private static final String FLASK_BASE_URL   = "http://192.168.1.6:5001";
    private static final String FLASK_BASE_URL   = "http://127.0.0.1:5001";
    private static final String PREDICT_ENDPOINT = FLASK_BASE_URL + "/behavior/predict";

    // Firebase REST — only used for the UI dashboard display
    private static final String FIREBASE_BASE_URL =
        "https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app/phenotyping/metrics/";

    // Upload window — 15 s for demo/testing (change back to 5 * 60 * 1000L for production)
    private static final long UPLOAD_INTERVAL_MS = 15 * 1000L;

    // -----------------------------------------------------------------------
    // T7-A: Activity Recognition — noise gate
    // Intent action used when the OS delivers activity updates to our receiver
    // -----------------------------------------------------------------------
    private static final String ACTION_ACTIVITY_UPDATE =
        "com.phenotyping.app.ACTIVITY_UPDATE";

    /**
     * The activities that invalidate a behavioral window.
     * Walking / running / on a bicycle / in a vehicle all produce irregular
     * typing cadence that would pollute the user's baseline.
     */
    private static final int[] NOISY_ACTIVITIES = {
        DetectedActivity.WALKING,
        DetectedActivity.RUNNING,
        DetectedActivity.ON_BICYCLE,
        DetectedActivity.IN_VEHICLE,
        DetectedActivity.ON_FOOT,   // super-set of WALKING + RUNNING
    };

    // Confidence threshold: we only call a window "noisy" if the detected
    // activity has >= 60% confidence from the OS classifier.
    private static final int ACTIVITY_CONFIDENCE_THRESHOLD = 60;

    // How often (ms) to poll Activity Recognition (~every upload window is fine)
    private static final long ACTIVITY_POLL_MS = UPLOAD_INTERVAL_MS;

    private ActivityRecognitionClient activityRecognitionClient;
    private PendingIntent             activityPendingIntent;

    // Volatile so the upload thread reads the most recent value without locking
    private volatile boolean dataValid = true;   // true = user is stationary/still

    /**
     * BroadcastReceiver that receives activity transitions from the OS.
     * Runs on the main thread; just updates the volatile dataValid flag.
     */
    private final BroadcastReceiver activityReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!ACTION_ACTIVITY_UPDATE.equals(intent.getAction())) return;
            if (!ActivityRecognitionResult.hasResult(intent)) return;

            ActivityRecognitionResult result = ActivityRecognitionResult.extractResult(intent);
            if (result == null) return;

            DetectedActivity mostLikely = result.getMostProbableActivity();
            int type       = mostLikely.getType();
            int confidence = mostLikely.getConfidence();

            boolean isNoisy = false;
            for (int noisy : NOISY_ACTIVITIES) {
                if (type == noisy && confidence >= ACTIVITY_CONFIDENCE_THRESHOLD) {
                    isNoisy = true;
                    break;
                }
            }

            dataValid = !isNoisy;

            Log.d(TAG, "🚶 Activity: " + activityName(type)
                + " (" + confidence + "%) → data_valid=" + dataValid);
        }
    };

    // -----------------------------------------------------------------------
    // State — inter-keystroke intervals (proxy for flight time)
    // -----------------------------------------------------------------------
    private final List<Long> flightTimes  = new ArrayList<>();  // ms between text-change events
    private final List<Long> dwellTimes   = new ArrayList<>();  // ms key held — real or approximated
    private final List<Long> scrollSpeeds = new ArrayList<>();  // px/sec — one entry per gesture

    // --- Scroll gesture tracking (debounce) ---
    // We accumulate pixels & time across a continuous fling, then record ONE
    // averaged velocity when the gesture ends (>300 ms silence).
    private long   scrollGesturePxSum    = 0;
    private long   scrollGestureStartMs  = 0;
    private long   lastScrollEventMs     = 0;
    private static final long SCROLL_GESTURE_GAP_MS = 300;

    // --- Technique 2: Dual-Event Dwell Timing ---
    // When TYPE_VIEW_FOCUSED fires just before TYPE_VIEW_TEXT_CHANGED,
    // the gap between them is a close approximation of real dwell time.
    // Max 500 ms pairing window — beyond that we fall back to 40% × flight.
    private long   lastFocusEventTime = 0;
    private static final long MAX_FOCUS_PAIR_MS = 500;

    private long   lastKeyPressTime = 0;
    private int    unlockCount      = 0;
    private int    appSwitchCount   = 0;
    private String lastPackageName  = "";
    private long   sessionStartTime = System.currentTimeMillis();

    private final Handler handler = new Handler(Looper.getMainLooper());

    // -----------------------------------------------------------------------
    // Periodic upload runnable
    // -----------------------------------------------------------------------
    private final Runnable uploadRunnable = new Runnable() {
        @Override
        public void run() {
            flushWindow();
            handler.postDelayed(this, UPLOAD_INTERVAL_MS);
        }
    };

    private volatile boolean isScreenOn = true;

    // -----------------------------------------------------------------------
    // Screen-unlock & lock receiver
    // -----------------------------------------------------------------------
    private final BroadcastReceiver unlockReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (Intent.ACTION_USER_PRESENT.equals(action) || Intent.ACTION_SCREEN_ON.equals(action)) {
                isScreenOn = true;
                if (Intent.ACTION_USER_PRESENT.equals(action)) {
                    unlockCount++;
                    Log.d(TAG, "🔓 Screen unlock #" + unlockCount);
                }
            } else if (Intent.ACTION_SCREEN_OFF.equals(action)) {
                isScreenOn = false;
                Log.d(TAG, "🔒 Screen locked");
            }
        }
    };

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------
    @Override
    public void onServiceConnected() {
        super.onServiceConnected();

        AccessibilityServiceInfo info = new AccessibilityServiceInfo();
        info.eventTypes =
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED       |   // typing events
            AccessibilityEvent.TYPE_VIEW_SCROLLED           |   // scroll events
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED    |   // app switch events
            AccessibilityEvent.TYPE_VIEW_FOCUSED;
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
        info.flags =
            AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS |
            AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
        setServiceInfo(info);

        // Start Foreground Service notification to prevent OS background suspension
        startForegroundService();

        // Register screen-unlock and screen-lock receiver
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_USER_PRESENT);
        filter.addAction(Intent.ACTION_SCREEN_ON);
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        registerReceiver(unlockReceiver, filter);

        // T7-A: Register activity recognition receiver & start updates
        startActivityRecognition();

        // First flush after 10 s for quick testing; then every UPLOAD_INTERVAL_MS
        handler.postDelayed(uploadRunnable, 10_000);

        Log.d(TAG, "✅ PhenoCare sensor live — collecting flight times, scroll velocity & activity context");
    }

    private void startForegroundService() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                String CHANNEL_ID = "phenocare_passive_channel";
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "PhenoCare Passive Monitor", NotificationManager.IMPORTANCE_LOW);
                NotificationManager manager = getSystemService(NotificationManager.class);
                if (manager != null) {
                    manager.createNotificationChannel(channel);
                }
                Notification notification = new Notification.Builder(this, CHANNEL_ID)
                    .setContentTitle("PhenoCare Behavioral Monitor")
                    .setContentText("Passively monitoring digital wellness signals")
                    .setSmallIcon(android.R.drawable.ic_menu_compass)
                    .build();
                startForeground(1001, notification);
                Log.d(TAG, "🔔 Foreground Service notification started");
            } catch (Exception e) {
                Log.w(TAG, "⚠️ Foreground service notification notice: " + e.getMessage());
            }
        }
    }

    @Override
    public void onInterrupt() {
        Log.e(TAG, "⚠️ Sensor interrupted");
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        try { unregisterReceiver(unlockReceiver); } catch (Exception ignored) {}
        stopActivityRecognition();
        handler.removeCallbacks(uploadRunnable);
    }

    // -----------------------------------------------------------------------
    // T7-A: Activity Recognition setup & teardown
    // -----------------------------------------------------------------------
    private void startActivityRecognition() {
        try {
            // Build the PendingIntent that the OS uses to deliver activity updates
            Intent intent = new Intent(ACTION_ACTIVITY_UPDATE);
            intent.setPackage(getPackageName());

            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT |
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                    ? PendingIntent.FLAG_MUTABLE : 0);

            activityPendingIntent = PendingIntent.getBroadcast(this, 0, intent, piFlags);

            // Register our receiver so we get the broadcasts
            IntentFilter filter = new IntentFilter(ACTION_ACTIVITY_UPDATE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(activityReceiver, filter, RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(activityReceiver, filter);
            }

            // Request activity updates from Play Services
            activityRecognitionClient = ActivityRecognition.getClient(this);
            activityRecognitionClient
                .requestActivityUpdates(ACTIVITY_POLL_MS, activityPendingIntent)
                .addOnSuccessListener(v ->
                    Log.d(TAG, "✅ ActivityRecognitionClient started (poll=" + ACTIVITY_POLL_MS + " ms)"))
                .addOnFailureListener(e ->
                    Log.w(TAG, "⚠️ ActivityRecognition start failed: " + e.getMessage() +
                        " — data_valid will default to true"));

        } catch (Exception e) {
            Log.w(TAG, "⚠️ Could not start ActivityRecognition: " + e.getMessage() +
                " — data_valid will default to true");
        }
    }

    private void stopActivityRecognition() {
        try {
            if (activityRecognitionClient != null && activityPendingIntent != null) {
                activityRecognitionClient.removeActivityUpdates(activityPendingIntent);
            }
            unregisterReceiver(activityReceiver);
        } catch (Exception ignored) {}
    }

    // -----------------------------------------------------------------------
    // Event handler
    // -----------------------------------------------------------------------
    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        int type = event.getEventType();

        // --- Technique 2: Capture FOCUSED event timestamp for dwell pairing ---
        if (type == AccessibilityEvent.TYPE_VIEW_FOCUSED) {
            lastFocusEventTime = System.currentTimeMillis();
        }

        // --- Typing: inter-keystroke interval (flight-time) + dual-event dwell ---
        if (type == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED) {
            long now = System.currentTimeMillis();

            // --- Flight time (unchanged) ---
            if (lastKeyPressTime != 0) {
                long interval = now - lastKeyPressTime;
                // Valid typing rhythm: 30 ms – 1000 ms
                //   < 30 ms  → autocomplete/suggestion artifact
                //   > 1000 ms → thinking pause (not typing rhythm)
                if (interval >= 30 && interval <= 1000) {
                    flightTimes.add(interval);

                    // --- Dwell time: Technique 2 dual-event method ---
                    // If a FOCUSED event fired within MAX_FOCUS_PAIR_MS before this
                    // TEXT_CHANGED event, use the gap as a real dwell approximation.
                    // Otherwise fall back to the validated 40% ratio.
                    long dwell;
                    if (lastFocusEventTime > 0 && (now - lastFocusEventTime) <= MAX_FOCUS_PAIR_MS) {
                        dwell = now - lastFocusEventTime;  // real OS-event dwell
                        Log.d(TAG, "⌨️ Flight: " + interval + " ms | Dwell (real): " + dwell + " ms | n=" + flightTimes.size());
                    } else {
                        dwell = Math.round(interval * 0.4); // fallback approximation
                        Log.d(TAG, "⌨️ Flight: " + interval + " ms | Dwell (est.): " + dwell + " ms | n=" + flightTimes.size());
                    }
                    dwellTimes.add(dwell);
                    lastFocusEventTime = 0; // consume the paired focus event

                } else {
                    Log.d(TAG, "⏩ Filtered interval: " + interval + " ms (out of 30–1000ms range)");
                }
            }
            lastKeyPressTime = now;
        }

        // --- Scrolling: debounce to one velocity per gesture ---
        if (type == AccessibilityEvent.TYPE_VIEW_SCROLLED) {
            long now = System.currentTimeMillis();
            int deltaY = event.getScrollDeltaY(); // px (API 28+), 0 on older
            if (deltaY == 0) deltaY = 50;          // conservative fallback

            if (lastScrollEventMs != 0 && (now - lastScrollEventMs) > SCROLL_GESTURE_GAP_MS) {
                long gestureDurationMs = lastScrollEventMs - scrollGestureStartMs;
                if (gestureDurationMs > 0 && scrollGesturePxSum > 0) {
                    long velocity = scrollGesturePxSum * 1000L / gestureDurationMs; // px/s
                    scrollSpeeds.add(velocity);
                    Log.d(TAG, "📜 Gesture scroll velocity: " + velocity
                        + " px/s (" + scrollGesturePxSum + "px over " + gestureDurationMs + "ms)");
                }
                scrollGesturePxSum   = 0;
                scrollGestureStartMs = now;
            }

            if (scrollGestureStartMs == 0 || scrollGesturePxSum == 0) {
                scrollGestureStartMs = now;
            }

            scrollGesturePxSum  += Math.abs(deltaY);
            lastScrollEventMs    = now;
        }

        // --- App Switching: track unique window package changes ---
        if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            CharSequence pkgName = event.getPackageName();
            if (pkgName != null && !pkgName.toString().equals(lastPackageName)) {
                appSwitchCount++;
                lastPackageName = pkgName.toString();
                Log.d(TAG, "🔀 App switch #" + appSwitchCount + " → " + lastPackageName);
            }
        }
    }

    private String getUserId() {
        SharedPreferences prefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        return prefs.getString("user_id", "anonymous_user");
    }

    // -----------------------------------------------------------------------
    // Flush: compute stats → POST to Flask → secondary write to Firebase UI
    // -----------------------------------------------------------------------
    private void flushWindow() {
        if (!isScreenOn) {
            Log.d(TAG, "🔒 Screen locked. Skipping upload.");
            return;
        }

        boolean hasInteraction = flightTimes.size() >= 3 || !scrollSpeeds.isEmpty() || appSwitchCount > 0;
        if (!hasInteraction) {
            Log.d(TAG, "⏭️ Phone idle (0 typing, 0 scrolling, 0 app switches). Skipping upload.");
            return;
        }

        // Snapshot and reset buffers immediately so we don't block new events
        final List<Long> flightSnapshot    = new ArrayList<>(flightTimes);
        final List<Long> dwellSnapshot     = new ArrayList<>(dwellTimes);   // Technique 2
        final List<Long> scrollSnapshot    = new ArrayList<>(scrollSpeeds);
        final int        unlockSnapshot    = unlockCount;
        final int        appSwitchSnapshot = appSwitchCount;
        final long       elapsed           = Math.max(1, (System.currentTimeMillis() - sessionStartTime) / 60000L);
        final String     currentUserId     = getUserId();

        // T7-A: Snapshot the current activity validity flag at upload time
        final boolean windowDataValid = this.dataValid;

        flightTimes.clear();
        dwellTimes.clear();    // Technique 2: clear dwell buffer for next window
        scrollSpeeds.clear();
        appSwitchCount = 0; // RESET counter for the next window!

        // Log the noise-gate decision so it's visible in Logcat
        if (!windowDataValid) {
            Log.d(TAG, "🚶 data_valid=false — window flagged as noisy (motion detected). " +
                "Sending to Flask but EMA baseline will be frozen.");
        }

        new Thread(() -> {
            try {
                // --- Build JSON for Flask /behavior/predict ---
                JSONArray flightArr = new JSONArray();
                for (long v : flightSnapshot) flightArr.put(v);

                // Technique 2: Use real dual-event dwell times collected during the window.
                // These are either real OS-paired dwell values or 40% fallbacks per keystroke.
                JSONArray dwellArr = new JSONArray();
                for (long v : dwellSnapshot) dwellArr.put(v);

                // Count how many dwell values were real (paired) vs approximated
                // A real dwell is typically < 250ms; approximated ones mirror 40% of flight
                long realDwellCount = dwellSnapshot.stream().filter(d -> d < 250).count();
                String dwellSource = (dwellSnapshot.isEmpty() || realDwellCount == 0)
                    ? "approximated" : (realDwellCount == dwellSnapshot.size() ? "real" : "mixed");
                Log.d(TAG, "📊 Dwell source this window: " + dwellSource
                    + " (" + realDwellCount + "/" + dwellSnapshot.size() + " real)");

                double avgScroll = scrollSnapshot.isEmpty() ? 0.0 :
                    scrollSnapshot.stream().mapToLong(Long::longValue).average().orElse(0.0);

                double interactionRate = (double) flightSnapshot.size() / elapsed;
                double appSwitchRate   = (double) appSwitchSnapshot / elapsed;

                JSONObject payload = new JSONObject();
                payload.put("user_id",           currentUserId);
                payload.put("dwell_times",       dwellArr);        // approximated
                payload.put("flight_times",      flightArr);       // real inter-keystroke intervals
                payload.put("scroll_velocity",   avgScroll);
                payload.put("interaction_rate",  interactionRate);
                payload.put("app_switch_rate",   appSwitchRate);
                payload.put("data_valid",        windowDataValid); // ✅ T7-A: real motion flag

                Log.d(TAG, "📡 Sending to Flask: " + flightSnapshot.size()
                    + " flight times | scroll=" + String.format("%.1f", avgScroll)
                    + " px/s | app_switches=" + appSwitchSnapshot
                    + " | data_valid=" + windowDataValid);

                // --- POST to Flask backend ---
                String flaskResponse = httpPost(PREDICT_ENDPOINT, payload.toString());
                if (flaskResponse != null) {
                    Log.d(TAG, "✅ Flask response: " + flaskResponse);

                    JSONObject resp = new JSONObject(flaskResponse);
                    String label    = resp.optString("prediction", "Unknown");
                    double severity = resp.optDouble("severity", 0.0);
                    pushDashboardUpdate(currentUserId, label, severity, unlockSnapshot);
                } else {
                    Log.w(TAG, "⚠️ Flask unreachable — writing raw metrics to Firebase only");
                    pushRawMetricsToFirebase(currentUserId, flightSnapshot, avgScroll, unlockSnapshot, elapsed);
                }

            } catch (Exception e) {
                Log.e(TAG, "❌ Upload failed", e);
            }
        }).start();
    }

    // -----------------------------------------------------------------------
    // Firebase: write the model's output (label + severity) for the UI
    // -----------------------------------------------------------------------
    private void pushDashboardUpdate(String userId, String label, double severity, int unlocks) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("stress_score",  severity);
            payload.put("label",         label);
            payload.put("unlocks_count", unlocks);
            payload.put("source",        "flask_ocsvm");
            payload.put("timestamp",     System.currentTimeMillis());

            String targetUrl = FIREBASE_BASE_URL + userId + ".json";
            String result = httpPatch(targetUrl, payload.toString());
            Log.d(TAG, "☁️ Dashboard updated: " + label + " (" + severity + ") → " + result);
        } catch (Exception e) {
            Log.e(TAG, "Firebase dashboard update failed", e);
        }
    }

    // -----------------------------------------------------------------------
    // Firebase fallback: write raw computed metrics when Flask is unreachable
    // -----------------------------------------------------------------------
    private void pushRawMetricsToFirebase(String userId, List<Long> flights, double avgScroll,
                                          int unlocks, long elapsedMin) {
        try {
            long avgFlight = flights.isEmpty() ? 0 :
                (long) flights.stream().mapToLong(Long::longValue).average().orElse(0);
            int  wpm       = (int) (flights.size() / 5.0 / Math.max(1, elapsedMin));

            JSONObject payload = new JSONObject();
            payload.put("typing_speed",     Math.max(wpm, 1));
            payload.put("typing_rhythm_ms", avgFlight);
            payload.put("scroll_velocity",  avgScroll);
            payload.put("unlocks_count",    unlocks);
            payload.put("source",           "raw_accessibility");
            payload.put("timestamp",        System.currentTimeMillis());

            String targetUrl = FIREBASE_BASE_URL + userId + ".json";
            httpPatch(targetUrl, payload.toString());
        } catch (Exception e) {
            Log.e(TAG, "Firebase raw fallback failed", e);
        }
    }

    // -----------------------------------------------------------------------
    // T7-A helper: human-readable activity name for Logcat
    // -----------------------------------------------------------------------
    private static String activityName(int type) {
        switch (type) {
            case DetectedActivity.STILL:       return "STILL";
            case DetectedActivity.WALKING:     return "WALKING";
            case DetectedActivity.RUNNING:     return "RUNNING";
            case DetectedActivity.ON_FOOT:     return "ON_FOOT";
            case DetectedActivity.ON_BICYCLE:  return "ON_BICYCLE";
            case DetectedActivity.IN_VEHICLE:  return "IN_VEHICLE";
            case DetectedActivity.TILTING:     return "TILTING";
            case DetectedActivity.UNKNOWN:     return "UNKNOWN";
            default:                           return "OTHER(" + type + ")";
        }
    }

    // -----------------------------------------------------------------------
    // HTTP helpers
    // -----------------------------------------------------------------------
    private String httpPost(String urlStr, String jsonBody) {
        return httpRequest("POST", urlStr, jsonBody);
    }

    private String httpPatch(String urlStr, String jsonBody) {
        return httpRequest("PATCH", urlStr, jsonBody);
    }

    private String httpRequest(String method, String urlStr, String jsonBody) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod(method);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setDoOutput(true);
            conn.setConnectTimeout(2_000);
            conn.setReadTimeout(2_000);

            try (OutputStream os = conn.getOutputStream()) {
                os.write(jsonBody.getBytes("utf-8"));
            }

            int code = conn.getResponseCode();
            if (code >= 200 && code < 300) {
                StringBuilder sb = new StringBuilder();
                try (BufferedReader br = new BufferedReader(
                        new InputStreamReader(conn.getInputStream(), "utf-8"))) {
                    String line;
                    while ((line = br.readLine()) != null) sb.append(line);
                }
                return sb.toString();
            } else {
                Log.w(TAG, method + " " + urlStr + " → HTTP " + code);
                return null;
            }
        } catch (Exception e) {
            Log.d(TAG, "ℹ️ Flask backend offline/unreachable: " + e.getMessage() + " (Fallback to Firebase)");
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}