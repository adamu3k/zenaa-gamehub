package com.zenaa.momo;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;

/**
 * "Other apps": the same phone can forward MoMo SMS to more apps than ZENAA (another branch, a bookkeeping app,
 * a webhook…). Each slot has a name, a link (where the SMS is sent) and a code (sent as "Authorization: Bearer
 * code" and "X-Relay-Code: code"). Each slot has its own waiting queue, so one app being offline never holds up
 * ZENAA or the others.
 *
 * What each app receives (HTTP POST, JSON):
 *   { "from": "MobileMoney", "body": "Payment received for GHS 20.00 …", "at": 1764240000000,
 *     "device": "Samsung SM-A155F", "source": "zenaa-momo", "version": "1.3.0" }
 * Any 2xx answer = delivered.
 */
final class ExtraApps {
    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // PLACEHOLDER — MORE APPS
    // SLOTS = how many "Other apps" boxes the phone shows. Raise it to link more apps (each box is set up on the
    // phone: open ZENAA MoMo → "Other apps" → "Set up").
    // PRESET = optional names and links filled in for you on every phone that installs this APK. Leave the code
    // out of here: this repository is public. Type the code on the phone instead.
    //   Example: {"Branch 2", "https://branch2.example.com/api/momo/sms"}
    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
    static final int SLOTS = 3;
    static final String[][] PRESET = {
            // {"App name", "https://link-to-the-app/receive-sms"},
    };

    /** Sender names counted as MoMo when a slot is set to "Only MoMo payment messages" (same list as ZENAA). */
    static final String[] MOMO_SENDERS = {"MobileMoney", "MTN MoMo", "MTNMoMo", "T-CASH", "TelecelCash", "Telecel", "VodaCash", "AT Money", "AirtelTigo"};

    static final class Slot {
        final int index;
        final String name;
        final String url;
        final String code;
        final boolean momoOnly;

        Slot(int index, String name, String url, String code, boolean momoOnly) {
            this.index = index;
            this.name = name;
            this.url = url;
            this.code = code;
            this.momoOnly = momoOnly;
        }

        boolean ready() {
            return url.startsWith("http://") || url.startsWith("https://");
        }

        String label() {
            return name.isEmpty() ? "App " + (index + 2) : name;
        }
    }

    private static String k(int i, String field) {
        return "extra" + i + "." + field;
    }

    static Slot get(Context c, int i) {
        SharedPreferences p = Relay.prefs(c);
        String presetName = i < PRESET.length ? PRESET[i][0] : "";
        String presetUrl = i < PRESET.length ? PRESET[i][1] : "";
        return new Slot(i, p.getString(k(i, "name"), presetName), p.getString(k(i, "url"), presetUrl), p.getString(k(i, "code"), ""), p.getBoolean(k(i, "momoOnly"), true));
    }

    static void save(Context c, int i, String name, String url, String code, boolean momoOnly) {
        Relay.prefs(c).edit()
                .putString(k(i, "name"), name.trim())
                .putString(k(i, "url"), url.trim().replaceAll("/+$", ""))
                .putString(k(i, "code"), code.trim())
                .putBoolean(k(i, "momoOnly"), momoOnly)
                .apply();
        Relay.log(c, "Other app saved: " + get(c, i).label());
    }

    static void clear(Context c, int i) {
        String label = get(c, i).label();
        // An empty link (not a removed one) so a preset link does not come back.
        Relay.prefs(c).edit().putString(k(i, "name"), "").putString(k(i, "url"), "").putString(k(i, "code"), "").remove(k(i, "queue")).apply();
        Relay.log(c, "Other app removed: " + label);
    }

    static boolean anyReady(Context c) {
        for (int i = 0; i < SLOTS; i++) if (get(c, i).ready()) return true;
        return false;
    }

    static boolean isMomoSender(String from) {
        String f = from == null ? "" : from.replaceAll("\\s", "").toLowerCase(Locale.US);
        for (String s : MOMO_SENDERS) if (f.equals(s.replaceAll("\\s", "").toLowerCase(Locale.US))) return true;
        return false;
    }

    /** Puts a copy of the SMS in the queue of every app that wants it. */
    static synchronized void enqueue(Context c, String from, String body, long at) {
        for (int i = 0; i < SLOTS; i++) {
            Slot s = get(c, i);
            if (!s.ready() || (s.momoOnly && !isMomoSender(from))) continue;
            try {
                SharedPreferences p = Relay.prefs(c);
                JSONArray q = new JSONArray(p.getString(k(i, "queue"), "[]"));
                JSONObject m = new JSONObject();
                m.put("from", from);
                m.put("body", body);
                m.put("at", at);
                q.put(m);
                while (q.length() > 200) q.remove(0);
                p.edit().putString(k(i, "queue"), q.toString()).apply();
            } catch (Exception ignored) {
            }
        }
    }

    static int queued(Context c, int i) {
        try {
            return new JSONArray(Relay.prefs(c).getString(k(i, "queue"), "[]")).length();
        } catch (Exception e) {
            return 0;
        }
    }

    static JSONObject payload(String from, String body, long at) throws Exception {
        JSONObject b = new JSONObject();
        b.put("from", from);
        b.put("body", body);
        b.put("at", at);
        b.put("device", Build.MANUFACTURER + " " + Build.MODEL);
        b.put("source", "zenaa-momo");
        b.put("version", Relay.VERSION);
        return b;
    }

    /** Sends what is waiting for each app. Call from a background thread. */
    static synchronized void flush(Context c) {
        SharedPreferences p = Relay.prefs(c);
        for (int i = 0; i < SLOTS; i++) {
            Slot s = get(c, i);
            if (!s.ready()) continue;
            JSONArray q;
            try {
                q = new JSONArray(p.getString(k(i, "queue"), "[]"));
            } catch (Exception e) {
                q = new JSONArray();
            }
            if (q.length() == 0) continue;
            JSONArray left = new JSONArray();
            boolean stop = false;
            for (int j = 0; j < q.length(); j++) {
                JSONObject m = q.optJSONObject(j);
                if (m == null) continue;
                if (stop) {
                    left.put(m);
                    continue;
                }
                try {
                    Relay.Result r = Relay.call("POST", s.url, s.code, payload(m.optString("from"), m.optString("body"), m.optLong("at")), s.code);
                    if (r.status >= 200 && r.status < 300) {
                        Relay.log(c, s.label() + ": ✓ sent (" + m.optString("from") + ")");
                    } else if (r.status == 401 || r.status == 403) {
                        Relay.log(c, s.label() + ": code refused (" + r.status + ") — check the code");
                        left.put(m);
                        stop = true;
                    } else if (r.status == 408 || r.status == 429 || r.status >= 500) {
                        left.put(m);
                        stop = true;
                    } else {
                        Relay.log(c, s.label() + ": refused (" + r.status + ")");
                    }
                } catch (Exception e) {
                    left.put(m);
                    stop = true; // offline: try again later
                }
            }
            p.edit().putString(k(i, "queue"), left.toString()).apply();
        }
    }

    /** "Test" button: sends one test message. Returns a line to show. */
    static String test(Context c, int i) {
        Slot s = get(c, i);
        if (!s.ready()) return "Type a link starting with http:// or https://";
        try {
            JSONObject b = payload("ZENAA MoMo", "Test message from ZENAA MoMo — not a payment.", System.currentTimeMillis());
            b.put("test", true);
            Relay.Result r = Relay.call("POST", s.url, s.code, b, s.code);
            if (r.status >= 200 && r.status < 300) return "✓ " + s.label() + " received the test";
            if (r.status == 401 || r.status == 403) return s.label() + " refused the code (" + r.status + ")";
            return s.label() + " answered " + r.status;
        } catch (Exception e) {
            return "Cannot reach " + s.url + " — check the link and Wi-Fi";
        }
    }
}
