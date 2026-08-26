package com.mindpulse.stressapp.phenotyping;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

// Ported unchanged from the standalone phenotyping app -- see
// KeystrokeCollectorService.java's header comment for context.
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            Log.d("PhenoCare_Sensor", "Phone rebooted. Rescheduling EMA notifications.");
            EmaNotificationScheduler.scheduleAll(context);
        }
    }
}
