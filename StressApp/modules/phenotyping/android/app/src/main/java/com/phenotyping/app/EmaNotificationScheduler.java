package com.phenotyping.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import java.util.Calendar;

/**
 * Schedules recurring EMA survey notifications using AlarmManager.
 *
 * Schedule:
 *   SISS Daily Check-In  → every day at 20:00 (8 PM)
 *   PSS-4 Weekly Survey  → every Sunday at 19:00 (7 PM)
 *
 * Call scheduleAll() once from MainActivity on first launch.
 * Alarms survive reboot because BootReceiver re-schedules them.
 */
public class EmaNotificationScheduler {

    private static final String TAG = "EmaScheduler";
    private static final int    REQUEST_SISS = 3001;
    private static final int    REQUEST_PSS4 = 3002;

    /**
     * Schedule both SISS (daily) and PSS-4 (weekly) notifications.
     * Safe to call multiple times — existing alarms are replaced.
     */
    public static void scheduleAll(Context context) {
        scheduleDailySiss(context);
        scheduleWeeklyPss4(context);
        Log.d(TAG, "EMA notification schedules set.");
    }

    /** Daily SISS reminder at 20:00 every day. */
    private static void scheduleDailySiss(Context context) {
        Intent intent = new Intent(context, EmaNotificationReceiver.class);
        intent.putExtra("ACTION", EmaNotificationReceiver.ACTION_SISS);

        PendingIntent pi = PendingIntent.getBroadcast(
            context, REQUEST_SISS, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, 20);
        cal.set(Calendar.MINUTE, 0);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);

        // If 20:00 has already passed today, schedule for tomorrow
        if (cal.getTimeInMillis() <= System.currentTimeMillis()) {
            cal.add(Calendar.DAY_OF_YEAR, 1);
        }

        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.setExactAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                cal.getTimeInMillis(),
                pi
            );
        } else {
            am.setRepeating(
                AlarmManager.RTC_WAKEUP,
                cal.getTimeInMillis(),
                AlarmManager.INTERVAL_DAY,
                pi
            );
        }

        Log.d(TAG, "SISS daily alarm set for: " + cal.getTime());
    }

    /** Weekly PSS-4 reminder every Sunday at 19:00. */
    private static void scheduleWeeklyPss4(Context context) {
        Intent intent = new Intent(context, EmaNotificationReceiver.class);
        intent.putExtra("ACTION", EmaNotificationReceiver.ACTION_PSS4);

        PendingIntent pi = PendingIntent.getBroadcast(
            context, REQUEST_PSS4, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.DAY_OF_WEEK, Calendar.SUNDAY);
        cal.set(Calendar.HOUR_OF_DAY, 19);
        cal.set(Calendar.MINUTE, 0);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);

        // If this Sunday's 19:00 has already passed, move to next Sunday
        if (cal.getTimeInMillis() <= System.currentTimeMillis()) {
            cal.add(Calendar.WEEK_OF_YEAR, 1);
        }

        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        // Repeat every 7 days
        am.setRepeating(
            AlarmManager.RTC_WAKEUP,
            cal.getTimeInMillis(),
            AlarmManager.INTERVAL_DAY * 7,
            pi
        );

        Log.d(TAG, "PSS-4 weekly alarm set for: " + cal.getTime());
    }

    /** Cancel all EMA alarms (e.g., if user unregisters from study). */
    public static void cancelAll(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        Intent sisIntent = new Intent(context, EmaNotificationReceiver.class);
        PendingIntent sisPi = PendingIntent.getBroadcast(
            context, REQUEST_SISS, sisIntent,
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
        );
        if (sisPi != null) am.cancel(sisPi);

        Intent pss4Intent = new Intent(context, EmaNotificationReceiver.class);
        PendingIntent pss4Pi = PendingIntent.getBroadcast(
            context, REQUEST_PSS4, pss4Intent,
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
        );
        if (pss4Pi != null) am.cancel(pss4Pi);

        Log.d(TAG, "All EMA alarms cancelled.");
    }
}
