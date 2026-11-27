package com.zenaa.momo;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Every incoming SMS is passed to ZENAA. ZENAA itself decides what counts: only messages from trusted MoMo sender
 * names ("MobileMoney", "T-CASH"…) that say money was received; everything else is ignored there.
 * Long messages arrive in parts — they are joined per sender first.
 */
public class SmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null || parts.length == 0) return;
        Map<String, StringBuilder> bySender = new LinkedHashMap<>();
        long at = System.currentTimeMillis();
        for (SmsMessage m : parts) {
            if (m == null) continue;
            String from = m.getDisplayOriginatingAddress();
            if (from == null) from = "";
            StringBuilder sb = bySender.get(from);
            if (sb == null) bySender.put(from, sb = new StringBuilder());
            sb.append(m.getDisplayMessageBody());
            at = m.getTimestampMillis();
        }
        final Context app = context.getApplicationContext();
        for (Map.Entry<String, StringBuilder> e : bySender.entrySet()) {
            Relay.enqueue(app, e.getKey(), e.getValue().toString(), at);
            ExtraApps.enqueue(app, e.getKey(), e.getValue().toString(), at);
        }
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                Relay.flush(app);
                ExtraApps.flush(app);
                Outbox.run(app);
            } finally {
                pending.finish();
            }
        }).start();
    }
}
