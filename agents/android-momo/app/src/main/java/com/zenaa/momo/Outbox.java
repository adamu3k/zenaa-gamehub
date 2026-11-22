package com.zenaa.momo;

import android.Manifest;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.telephony.SmsManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;

/**
 * Thank-you SMS: asks ZENAA for messages waiting to be sent, sends each from this phone's SIM and reports back.
 * The report is sent by {@link SentReceiver} when Android says whether the SMS really went out (e.g. no airtime = failed).
 */
final class Outbox {
    static final String ACTION_SENT = "com.zenaa.momo.SMS_SENT";

    static boolean canSend(Context c) {
        return Build.VERSION.SDK_INT < 23 || c.checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED;
    }

    @SuppressWarnings("deprecation")
    private static SmsManager sms(Context c) {
        if (Build.VERSION.SDK_INT >= 31) {
            SmsManager m = c.getSystemService(SmsManager.class);
            if (m != null) return m;
        }
        return SmsManager.getDefault();
    }

    /** Call from a background thread. Returns how many messages were handed to Android. */
    static synchronized int run(Context c) {
        SharedPreferences p = Relay.prefs(c);
        String server = p.getString("server", "");
        String token = p.getString("token", "");
        if (server.isEmpty() || token.isEmpty() || !canSend(c)) return 0;
        JSONArray list;
        try {
            Relay.Result r = Relay.call("GET", server + "/api/momo/relay/outbox", token, null);
            if (r.status != 200) return 0; // old ZENAA (404) or not paired: nothing to do
            list = r.json.optJSONArray("messages");
        } catch (Exception e) {
            return 0; // offline
        }
        if (list == null) return 0;
        int n = 0;
        for (int i = 0; i < list.length(); i++) {
            JSONObject m = list.optJSONObject(i);
            if (m == null) continue;
            String id = m.optString("id");
            String to = m.optString("to");
            String body = m.optString("body");
            try {
                SmsManager mgr = sms(c);
                ArrayList<String> parts = mgr.divideMessage(body);
                Intent sent = new Intent(ACTION_SENT).setClass(c, SentReceiver.class).putExtra("id", id).putExtra("to", to);
                PendingIntent pi = PendingIntent.getBroadcast(c, id.hashCode(), sent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                if (parts.size() <= 1) {
                    mgr.sendTextMessage(to, null, body, pi, null);
                } else {
                    ArrayList<PendingIntent> intents = new ArrayList<>();
                    for (int k = 0; k < parts.size(); k++) intents.add(k == parts.size() - 1 ? pi : null);
                    mgr.sendMultipartTextMessage(to, null, parts, intents, null);
                }
                n++;
            } catch (Exception e) {
                report(c, id, false, "Phone refused: " + e.getMessage());
                Relay.log(c, "SMS to " + to + " failed: " + e.getMessage());
            }
        }
        return n;
    }

    static void report(Context c, String id, boolean ok, String error) {
        SharedPreferences p = Relay.prefs(c);
        try {
            JSONObject b = new JSONObject();
            b.put("ok", ok);
            if (error != null) b.put("error", error);
            Relay.call("POST", p.getString("server", "") + "/api/momo/relay/outbox/" + id, p.getString("token", ""), b);
        } catch (Exception ignored) {
            // ZENAA marks it as "did not report back" after a few minutes.
        }
    }
}
