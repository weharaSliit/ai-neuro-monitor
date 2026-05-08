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
    private long totalIntervalSum = 0; // To calculate average rhythm
    private long startTime = System.currentTimeMillis();

    private Handler handler = new Handler(Looper.getMainLooper());

    private Runnable uploadRunnable = new Runnable() {
        @Override
        public void run() {
            uploadToFirebase();
            handler.postDelayed(this, 5 * 60 * 1000); // 5 minutes
        }
    };

    private BroadcastReceiver unlockReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (Intent.ACTION_USER_PRESENT.equals(intent.getAction())) {
                unlockCount++;
                Log.d(TAG, "Screen unlocked. Total: " + unlockCount);
            }
        }
    };

    @Override
    public void onServiceConnected() {
        super.onServiceConnected();

        AccessibilityServiceInfo info = new AccessibilityServiceInfo();
        info.eventTypes = AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED;
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
        info.flags = AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS;
        this.setServiceInfo(info);

        registerReceiver(unlockReceiver, new IntentFilter(Intent.ACTION_USER_PRESENT));
        handler.postDelayed(uploadRunnable, 5 * 60 * 1000);
        Log.d(TAG, "Sensor System Live & Connected to Firebase");
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event.getEventType() == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED) {
            keystrokeCount++;

            // Calculate Rhythm (Interval between keys)
            long currentTime = System.currentTimeMillis();
            if (lastKeyPressTime != 0) {
                totalIntervalSum += (currentTime - lastKeyPressTime);
            }
            lastKeyPressTime = currentTime;
        }
    }

    @Override
    public void onInterrupt() {}

    @Override
    public void onDestroy() {
        super.onDestroy();
        unregisterReceiver(unlockReceiver);
        handler.removeCallbacks(uploadRunnable);
    }

    private void uploadToFirebase() {
        new Thread(() -> {
            try {
                long elapsedMinutes = (System.currentTimeMillis() - startTime) / 60000;
                if (elapsedMinutes == 0) elapsedMinutes = 1;

                int wpm = (keystrokeCount / 5) / (int)elapsedMinutes;
                // Average typing interval (ms)
                long avgInterval = keystrokeCount > 1 ? (totalIntervalSum / (keystrokeCount - 1)) : 0;

                JSONObject payload = new JSONObject();
                payload.put("typing_speed", wpm);
                payload.put("typing_rhythm_ms", avgInterval); // New Research Variable!
                payload.put("unlocks_count", unlockCount);

                // Add simulated deviation for your UI dashboard
                payload.put("typing_deviation", (wpm < 40) ? -22 : 5);
                payload.put("unlocks_deviation", (unlockCount > 10) ? 81 : -5);

                // Mock History for the UI Bars
                JSONArray history = new JSONArray();
                for(int i = 0; i < 7; i++) {
                    JSONObject bar = new JSONObject();
                    bar.put("val", (int)(Math.random() * 100));
                    bar.put("active", i >= 5);
                    history.put(bar);
                }
                payload.put("typing_history", history);
                payload.put("unlocks_history", history);

                // Firebase Upload (PATCH method updates only these fields)
                URL url = new URL(FIREBASE_URL);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("PATCH");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);

                try (OutputStream os = conn.getOutputStream()) {
                    os.write(payload.toString().getBytes("utf-8"));
                }

                Log.d(TAG, "Data synced to Firebase: " + conn.getResponseCode());

                // Reset session counters
                keystrokeCount = 0;
                totalIntervalSum = 0;
                startTime = System.currentTimeMillis();

            } catch (Exception e) {
                Log.e(TAG, "Sync failed", e);
            }
        }).start();
    }
}