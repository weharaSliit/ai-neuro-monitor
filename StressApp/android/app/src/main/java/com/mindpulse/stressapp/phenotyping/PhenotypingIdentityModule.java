package com.mindpulse.stressapp.phenotyping;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.view.accessibility.AccessibilityManager;
import android.accessibilityservice.AccessibilityServiceInfo;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.modules.core.PermissionAwareActivity;
import com.facebook.react.modules.core.PermissionListener;

/**
 * Bridges StressApp's real login identity (context/AuthContext.js) into
 * KeystrokeCollectorService's native world -- see that file's header
 * comment for the full "why". The original standalone phenotyping app
 * used Capacitor's Preferences plugin for this same purpose; this module
 * is StressApp's direct React Native equivalent, deliberately scoped to
 * exactly one job (write/clear one identity value) plus the runtime
 * permission requests the original app's MainActivity used to make on
 * launch -- kept here instead of in MainActivity.kt (which `expo
 * prebuild` regenerates and would silently drop hand-edits from).
 */
public class PhenotypingIdentityModule extends ReactContextBaseJavaModule implements PermissionListener {

    public static final String PREFS_NAME = "PhenotypingIdentityPrefs";
    public static final String USER_ID_KEY = "user_id";

    private static final int REQ_ACTIVITY_RECOGNITION = 9101;
    private static final int REQ_POST_NOTIFICATIONS   = 9102;

    private Promise pendingPermissionPromise;

    public PhenotypingIdentityModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return "PhenotypingIdentity";
    }

    /** Called on login / auth-restore (see AuthContext.js) with the real
     * logged-in userId -- KeystrokeCollectorService.getUserId() reads this
     * same value back out. */
    @ReactMethod
    public void setUserId(String userId) {
        SharedPreferences prefs = getReactApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(USER_ID_KEY, userId).apply();
    }

    /** Called on logout -- without this, a buffered window flushed after
     * logout but before the next login would misattribute data to
     * whoever logs in next. */
    @ReactMethod
    public void clearUserId() {
        SharedPreferences prefs = getReactApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().remove(USER_ID_KEY).apply();
    }

    /** Schedules the daily SISS / weekly PSS-4 local notifications --
     * same call the original app's MainActivity made once on launch. Safe
     * to call multiple times (EmaNotificationScheduler replaces existing
     * alarms rather than duplicating them). */
    @ReactMethod
    public void scheduleEmaNotifications() {
        EmaNotificationScheduler.scheduleAll(getReactApplicationContext());
    }

    /** Requests ACTIVITY_RECOGNITION (motion noise-gate) and
     * POST_NOTIFICATIONS (EMA reminders) runtime permissions, mirroring
     * the original app's MainActivity.onCreate() logic. Resolves true
     * once both prompts have been answered (regardless of grant/deny --
     * KeystrokeCollectorService already degrades gracefully when either
     * is denied, same as before). */
    @ReactMethod
    public void requestRuntimePermissions(Promise promise) {
        Activity activity = getCurrentActivity();
        if (!(activity instanceof PermissionAwareActivity)) {
            promise.resolve(false);
            return;
        }
        pendingPermissionPromise = promise;
        PermissionAwareActivity permissionAwareActivity = (PermissionAwareActivity) activity;

        java.util.List<String> toRequest = new java.util.ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            && ContextCompat.checkSelfPermission(activity, Manifest.permission.ACTIVITY_RECOGNITION)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            toRequest.add(Manifest.permission.ACTIVITY_RECOGNITION);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            toRequest.add(Manifest.permission.POST_NOTIFICATIONS);
        }

        if (toRequest.isEmpty()) {
            pendingPermissionPromise = null;
            promise.resolve(true);
            return;
        }

        permissionAwareActivity.requestPermissions(
            toRequest.toArray(new String[0]), REQ_ACTIVITY_RECOGNITION, this
        );
    }

    @Override
    public boolean onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode != REQ_ACTIVITY_RECOGNITION) return false;
        if (pendingPermissionPromise != null) {
            pendingPermissionPromise.resolve(true);
            pendingPermissionPromise = null;
        }
        return true;
    }

    /**
     * Checks whether the PhenoCare Accessibility Service (KeystrokeCollectorService)
     * is currently enabled in Android's Accessibility Settings.
     * Called from PhenotypingScreen.js on every screen focus to show a live
     * warning banner if the user has revoked the permission after onboarding.
     * Resolves to true (enabled) or false (disabled/revoked).
     */
    @ReactMethod
    public void isAccessibilityServiceEnabled(Promise promise) {
        try {
            AccessibilityManager am = (AccessibilityManager)
                getReactApplicationContext().getSystemService(Context.ACCESSIBILITY_SERVICE);
            if (am == null) {
                promise.resolve(false);
                return;
            }
            // Iterate enabled accessibility services and look for ours by package name.
            java.util.List<AccessibilityServiceInfo> enabled =
                am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK);
            String ourPackage = getReactApplicationContext().getPackageName();
            for (AccessibilityServiceInfo info : enabled) {
                android.content.pm.ServiceInfo si = info.getResolveInfo().serviceInfo;
                if (ourPackage.equals(si.packageName)) {
                    promise.resolve(true);
                    return;
                }
            }
            promise.resolve(false);
        } catch (Exception e) {
            // Fail open: if we can't check, assume enabled so we don't spam a false warning.
            promise.resolve(true);
        }
    }
}
