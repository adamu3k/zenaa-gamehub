package com.zenaa.momo;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * Keeps ZENAA MoMo running in the background (with a small "ZENAA MoMo is on" notification): every 15 seconds it
 * sends waiting payment SMS to ZENAA and sends waiting thank-you SMS to customers.
 */
public class RelayService extends Service {
    private static final String CHANNEL = "zenaa-momo";
    private volatile boolean running;
    private Thread loop;

    static void start(Context c) {
        if (Relay.prefs(c).getString("token", "").isEmpty()) return;
        Intent i = new Intent(c, RelayService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
            else c.startService(i);
        } catch (Exception ignored) {
            // Android may refuse to start it from the background; it starts again when the app is opened.
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = notification();
        if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(1, n);
        if (loop == null || !loop.isAlive()) {
            running = true;
            loop = new Thread(() -> {
                while (running) {
                    try {
                        if (Relay.prefs(this).getString("token", "").isEmpty()) break;
                        Relay.flush(this);
                        Outbox.run(this);
                    } catch (Exception ignored) {
                    }
                    try {
                        Thread.sleep(15_000);
                    } catch (InterruptedException e) {
                        break;
                    }
                }
                stopSelf();
            });
            loop.start();
        }
        return START_STICKY;
    }

    @SuppressWarnings("deprecation")
    private Notification notification() {
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(new NotificationChannel(CHANNEL, "ZENAA MoMo running", NotificationManager.IMPORTANCE_LOW));
            b = new Notification.Builder(this, CHANNEL);
        } else {
            b = new Notification.Builder(this);
        }
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        return b.setContentTitle("ZENAA MoMo is on")
                .setContentText("Forwarding MoMo payments and sending thank-you SMS")
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentIntent(open)
                .setOngoing(true)
                .build();
    }

    @Override
    public void onDestroy() {
        running = false;
        if (loop != null) loop.interrupt();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
