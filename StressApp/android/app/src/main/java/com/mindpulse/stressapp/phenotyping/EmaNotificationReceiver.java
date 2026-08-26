package com.mindpulse.stressapp.phenotyping;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;

import com.mindpulse.stressapp.MainActivity;

/**
 * BroadcastReceiver that fires scheduled EMA survey notifications.
 * Ported from the standalone phenotyping app -- see
 * KeystrokeCollectorService.java's header comment for context.
 *
 * Two types are fired via the ACTION extra:
 *   "SISS"  — Daily check-in reminder (every day at 20:00)
 *   "PSS4"  — Weekly survey reminder (every Sunday at 19:00)
 *
 * The notification opens StressApp's MainActivity with a "navigate_to"/
 * "ema_tab" extra -- the original standalone app handled this via a
 * WebView evaluateJavascript() hack (Capacitor-specific); StressApp's JS
 * side instead reads these extras via expo-notifications' initial-intent
 * handling and pushes the real EmaSurvey screen through React Navigation
 * (see the phenotyping UI migration screens for the listener).
 */
public class EmaNotificationReceiver extends BroadcastReceiver {

    public static final String ACTION_SISS = "SISS";
    public static final String ACTION_PSS4 = "PSS4";
    private static final String CHANNEL_ID  = "phenocare_ema_channel";
    private static final int    NOTIF_SISS  = 2001;
    private static final int    NOTIF_PSS4  = 2002;

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getStringExtra("ACTION");
        if (action == null) return;

        createNotificationChannel(context);

        Intent openApp = new Intent(context, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        openApp.putExtra("navigate_to", "ema-survey");
        openApp.putExtra("ema_tab", action.equals(ACTION_PSS4) ? "pss4" : "siss");

        int reqCode = action.equals(ACTION_PSS4) ? NOTIF_PSS4 : NOTIF_SISS;
        PendingIntent pi = PendingIntent.getActivity(
            context, reqCode, openApp,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder;

        if (action.equals(ACTION_PSS4)) {
            builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("Weekly Stress Survey")
                .setContentText("Your PSS-4 weekly survey is ready. Takes just 1 minute!")
                .setStyle(new NotificationCompat.BigTextStyle()
                    .bigText("It's time for your weekly PSS-4 survey. Answer 4 questions about how you've been feeling this week. Your data helps calibrate your personal stress patterns."))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pi);
        } else {
            builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("Daily Stress Check-In")
                .setContentText("How are you feeling right now? Quick 5-second check-in!")
                .setStyle(new NotificationCompat.BigTextStyle()
                    .bigText("We detected behavioural patterns today. Tap to log how you're feeling right now -- it helps calibrate your personal stress model."))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(pi);
        }

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(reqCode, builder.build());
        }
    }

    private void createNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "PhenoCare EMA Reminders",
                NotificationManager.IMPORTANCE_DEFAULT
            );
            channel.setDescription("Daily and weekly EMA survey reminders for stress tracking.");
            NotificationManager nm = context.getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }
}
