package com.mindpulse.stressapp.phenotyping;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import android.view.accessibility.AccessibilityManager;

import java.util.List;

// Ported unchanged from the standalone phenotyping app -- see
// KeystrokeCollectorService.java's header comment for context.
// Extended: also checks whether KeystrokeCollectorService came back
// up after reboot (the OS restarts an enabled AccessibilityService
// automatically, but we log a warning if for any reason it didn't).
public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "PhenoCare_Sensor";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;

        Log.d(TAG, "Phone rebooted. Rescheduling EMA notifications.");
        EmaNotificationScheduler.scheduleAll(context);

        // Verify the AccessibilityService came back up.
        // The OS automatically restarts an enabled AccessibilityService after
        // reboot -- this is just a diagnostic log so the logcat shows clearly
        // whether the service is live post-boot, making it easier to spot the
        // rare case where Android skipped the auto-restart (e.g. device admin
        // policy, restricted user account, or force-stopped app state).
        try {
            AccessibilityManager am = (AccessibilityManager)
                context.getSystemService(Context.ACCESSIBILITY_SERVICE);
            if (am != null) {
                List<AccessibilityServiceInfo> enabled =
                    am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK);
                boolean serviceFound = false;
                String ourPackage = context.getPackageName();
                for (AccessibilityServiceInfo info : enabled) {
                    android.content.pm.ServiceInfo si = info.getResolveInfo().serviceInfo;
                    if (ourPackage.equals(si.packageName)) {
                        serviceFound = true;
                        break;
                    }
                }
                if (serviceFound) {
                    Log.d(TAG, "Post-boot check: KeystrokeCollectorService is ACTIVE. Data collection resumed.");
                } else {
                    Log.w(TAG, "Post-boot check: KeystrokeCollectorService NOT found in enabled services. " +
                        "If the user had Accessibility ON before reboot, the OS should restart it shortly. " +
                        "If it stays off, the user needs to re-enable it in Settings → Accessibility.");
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Post-boot accessibility check failed: " + e.getMessage());
        }
    }
}
