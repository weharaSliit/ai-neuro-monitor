package com.phenotyping.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            Log.d("PhenoCare_Sensor", "Phone rebooted. Rescheduling EMA notifications.");
            // Re-schedule EMA survey alarms after reboot (AlarmManager clears on reboot)
            EmaNotificationScheduler.scheduleAll(context);
        }
    }
}
