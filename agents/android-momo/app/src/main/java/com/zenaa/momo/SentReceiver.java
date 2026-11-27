package com.zenaa.momo;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.telephony.SmsManager;

/** Android tells us whether a thank-you SMS really went out; we pass that on to ZENAA. */
public class SentReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        final String id = intent.getStringExtra("id");
        final String to = intent.getStringExtra("to");
        final int slot = intent.getIntExtra("slot", -1);
        if (id == null) return;
        final int code = getResultCode();
        final boolean ok = code == Activity.RESULT_OK;
        final String error = ok ? null : describe(code);
        final Context app = context.getApplicationContext();
        Relay.log(app, ok ? "✓ Thank-you SMS sent to " + to : "SMS to " + to + " failed: " + error);
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                Outbox.report(app, id, ok, error, slot);
            } finally {
                pending.finish();
            }
        }).start();
    }

    private static String describe(int code) {
        switch (code) {
            case SmsManager.RESULT_ERROR_NO_SERVICE:
                return "No network signal";
            case SmsManager.RESULT_ERROR_RADIO_OFF:
                return "Phone in airplane mode / radio off";
            case SmsManager.RESULT_ERROR_NULL_PDU:
                return "Message could not be built";
            case SmsManager.RESULT_ERROR_GENERIC_FAILURE:
                return "Network refused it (no airtime / SMS bundle?)";
            default:
                return "Error " + code;
        }
    }
}
