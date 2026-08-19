package com.phenotyping.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            Log.d("PhenoCare_Sensor", "Phone rebooted. Sensor logic ready for user activation.");
            // Note: Accessibility Services are automatically restarted by Android
            // if they were ON before the reboot.
        }
    }
}