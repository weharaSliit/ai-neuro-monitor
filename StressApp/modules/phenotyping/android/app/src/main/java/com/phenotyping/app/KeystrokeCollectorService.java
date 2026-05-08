package com.phenotyping.app;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class KeystrokeCollectorService extends AccessibilityService {

    private static final String TAG = "PhenoCare_Sensor";
    private static final String FIREBASE_URL = "https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app/phenotyping/metrics/s002.json";

    private int keystrokeCount = 0;
    private int unlockCount = 0;
    private long lastKeyPressTime = 0;
    private long totalIntervalSum = 0;
    private long startTime = System.currentTimeMillis();

    private Handler handler = new Handler(Looper.getMainLooper());

    private Runnable uploadRunnable = new Runnable() {
        @Override
        public void run() {
            uploadToFirebase();
            handler.postDelayed(this, 5 * 60 * 1000); // Sync every 5 minutes
        }
    };

    private BroadcastReceiver unlockReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (Intent.ACTION_USER_PRESENT.equals(intent.getAction())) {
                unlockCount++;
                Log.d(TAG, "🔓 Screen unlocked detected. Total today: " + unlockCount);
            }
        }
    };

    @Override
    public void onServiceConnected() {
        super.onServiceConnected();

        AccessibilityServiceInfo info = new AccessibilityServiceInfo();
        // Listen for text changes AND focused views (helps catch more keyboard activity)
        info.eventTypes = AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED | AccessibilityEvent.TYPE_VIEW_FOCUSED;
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
        info.flags = AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS | AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
        this.setServiceInfo(info);

        registerReceiver(unlockReceiver, new IntentFilter(Intent.ACTION_USER_PRESENT));
        handler.postDelayed(uploadRunnable, 10000); // First sync after 10 seconds for testing
        Log.d(TAG, "✅ SENSOR SYSTEM LIVE: Monitoring passive behavioral signals...");
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        int eventType = event.getEventType();

        // LOG EVERY EVENT (To prove the sensor is hearing the OS)
        if (eventType == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED) {
            keystrokeCount++;
            long currentTime = System.currentTimeMillis();

            if (lastKeyPressTime != 0) {
                long dwellTime = currentTime - lastKeyPressTime;
                // Filter out huge gaps (more than 3 seconds) as they aren't "typing rhythm"
                if (dwellTime < 3000) {
                    totalIntervalSum += dwellTime;
                    Log.d(TAG, "⌨️ Keystroke captured | Interval: " + dwellTime + "ms | Total: " + keystrokeCount);
                }
            }
            lastKeyPressTime = currentTime;
        }
    }

    @Override
    public void onInterrupt() {
        Log.e(TAG, "⚠️ Sensor Interrupted");
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        try {
            unregisterReceiver(unlockReceiver);
        } catch (Exception e) {
            Log.e(TAG, "Error unregistering receiver", e);
        }
        handler.removeCallbacks(uploadRunnable);
    }

    private void uploadToFirebase() {
        new Thread(() -> {
            try {
                long elapsedMinutes = (System.currentTimeMillis() - startTime) / 60000;
                if (elapsedMinutes == 0) elapsedMinutes = 1;

                int wpm = (keystrokeCount / 5) / (int)elapsedMinutes;
                long avgInterval = (keystrokeCount > 1) ? (totalIntervalSum / (keystrokeCount - 1)) : 0;

                JSONObject payload = new JSONObject();
                payload.put("typing_speed", Math.max(wpm, 42)); // Default to 42 for demo if no typing
                payload.put("typing_rhythm_ms", avgInterval);
                payload.put("unlocks_count", unlockCount);
                payload.put("typing_deviation", (wpm < 30 && keystrokeCount > 0) ? -22 : -5);
                payload.put("unlocks_deviation", (unlockCount > 15) ? 81 : 12);

                // Mock History for UI visualization
                JSONArray history = new JSONArray();
                for(int i = 0; i < 7; i++) {
                    JSONObject bar = new JSONObject();
                    bar.put("val", 30 + (int)(Math.random() * 60));
                    bar.put("active", i >= 5);
                    history.put(bar);
                }
                payload.put("typing_history", history);
                payload.put("unlocks_history", history);

                URL url = new URL(FIREBASE_URL);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("PATCH");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);

                try (OutputStream os = conn.getOutputStream()) {
                    os.write(payload.toString().getBytes("utf-8"));
                }

                int responseCode = conn.getResponseCode();
                Log.d(TAG, "☁️ Firebase Sync Complete | Status: " + responseCode + " | WPM: " + wpm);

            } catch (Exception e) {
                Log.e(TAG, "❌ Firebase Sync Failed", e);
            }
        }).start();
    }
}