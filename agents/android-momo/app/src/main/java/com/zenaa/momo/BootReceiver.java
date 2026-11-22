package com.zenaa.momo;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Starts ZENAA MoMo again after the phone restarts. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) RelayService.start(context.getApplicationContext());
    }
}
