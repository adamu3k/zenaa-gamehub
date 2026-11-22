package com.zenaa.tv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** Starts the timer service when the TV boots (or the app is updated), if this TV is paired. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Api.prefs(context).getString("token", "").isEmpty()) return;
        Intent svc = new Intent(context, AgentService.class);
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(svc);
        else context.startService(svc);
    }
}
