package com.phenotyping.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

/**
 * MainActivity — Capacitor entry point.
 *
 * T7-A: Requests the ACTIVITY_RECOGNITION runtime permission on Android 10+
 * (API 29+). Without this the ActivityRecognitionClient in
 * KeystrokeCollectorService silently produces no results and data_valid
 * stays true forever, bypassing the motion noise-gate.
 *
 * Permission flow:
 *   Launch → checkPermission() →
 *     already granted  → nothing (service handles itself)
 *     not granted      → showRationale / requestPermission()
 *     denied by user   → Toast explaining why it matters
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG         = "PhenoCare_Main";
    private static final int    REQ_ACTIVITY = 1001;

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestActivityRecognitionPermission();
    }

    // -----------------------------------------------------------------------
    // Permission request
    // -----------------------------------------------------------------------
    private void requestActivityRecognitionPermission() {
        // ACTIVITY_RECOGNITION is only a runtime permission from API 29 onward.
        // On API 28 and below it is automatically granted by the GMS manifest,
        // so we skip the runtime check entirely.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            Log.d(TAG, "API < 29 — ACTIVITY_RECOGNITION granted automatically, no runtime request needed.");
            return;
        }

        String permission = Manifest.permission.ACTIVITY_RECOGNITION;

        if (ContextCompat.checkSelfPermission(this, permission)
                == PackageManager.PERMISSION_GRANTED) {
            // Already granted (e.g. user granted on a previous launch)
            Log.d(TAG, "✅ ACTIVITY_RECOGNITION already granted.");
            return;
        }

        // Show a rationale if the user has previously denied the permission.
        // Android suppresses the dialog the second time without this check.
        if (ActivityCompat.shouldShowRequestPermissionRationale(this, permission)) {
            Log.d(TAG, "ℹ️ Showing permission rationale.");
            Toast.makeText(
                this,
                "PhenoCare needs Activity Recognition to filter out motion noise " +
                "during stress detection. Please allow it on the next screen.",
                Toast.LENGTH_LONG
            ).show();
        }

        // Request the permission — result arrives in onRequestPermissionsResult()
        ActivityCompat.requestPermissions(
            this,
            new String[]{ permission },
            REQ_ACTIVITY
        );
    }

    // -----------------------------------------------------------------------
    // Permission result callback
    // -----------------------------------------------------------------------
    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            @NonNull String[] permissions,
            @NonNull int[] grantResults) {

        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode != REQ_ACTIVITY) return;

        if (grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED) {

            Log.d(TAG, "✅ ACTIVITY_RECOGNITION granted by user — motion noise-gate active.");
            Toast.makeText(
                this,
                "Activity monitoring enabled ✓  — stress data will be filtered during motion.",
                Toast.LENGTH_SHORT
            ).show();

        } else {
            // User denied — the service defaults data_valid=true so collection
            // still works, just without the motion noise-gate.
            Log.w(TAG, "⚠️ ACTIVITY_RECOGNITION denied. data_valid will always be true " +
                "(motion noise-gate inactive). Baseline may drift during walking/running.");
            Toast.makeText(
                this,
                "Activity permission denied. Stress data collected during motion " +
                "won't be filtered — results may be less accurate.",
                Toast.LENGTH_LONG
            ).show();
        }
    }
}
