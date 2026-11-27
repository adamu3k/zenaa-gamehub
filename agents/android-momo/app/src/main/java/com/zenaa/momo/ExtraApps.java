package com.zenaa.momo;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URL;
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
 *
 * Another ZENAA app (GameHub branch, WiFi Hub...): type just its website as the link and the 6-digit pairing code from
 * its admin as the code. The phone pairs by itself (the code is swapped for a long-lived token), sends the SMS to
 * /api/momo/sms and also sends that app's customer SMS (its outbox), exactly like the main ZENAA pairing.
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

        /** Where the SMS is POSTed: a bare website (or its /admin, /portal page) means a ZENAA app -> /api/momo/sms. */
        String sendUrl() {
            return ExtraApps.sendUrl(url);
        }

        /** The ZENAA server behind this slot ("https://wifi.example.com"), or null for a non-ZENAA link. */
        String zenaaBase() {
            String s = sendUrl();
            int q = s.indexOf('?');
            String noQuery = q >= 0 ? s.substring(0, q) : s;
            return noQuery.endsWith("/api/momo/sms") ? noQuery.substring(0, noQuery.length() - "/api/momo/sms".length()) : null;
        }

        /** The 6-digit code was typed but not yet swapped for a token. */
        boolean needsPairing() {
            return zenaaBase() != null && code.matches("\\d{6}");
        }
    }

    static String sendUrl(String url) {
        try {
            URL u = new URL(url);
            String path = u.getPath() == null ? "" : u.getPath();
            if (u.getQuery() == null && (path.isEmpty() || path.equals("/") || path.matches("^/(admin|portal|login|home)(/.*)?$"))) {
                return Relay.origin(url) + "/api/momo/sms";
            }
        } catch (Exception ignored) {
        }
        return url;
    }

    /**
     * Swaps a 6-digit pairing code for a token (ZENAA apps only). Returns null when ready, else a line to show.
     * Call from a background thread.
     */
    static synchronized String ensurePaired(Context c, int i) {
        Slot s = get(c, i);
        if (!s.needsPairing()) return null;
        try {
            JSONObject b = new JSONObject();
            b.put("code", s.code);
            b.put("device", Build.MANUFACTURER + " " + Build.MODEL);
            Relay.Result r = Relay.call("POST", s.zenaaBase() + "/api/momo/relay/pair", null, b);
            if (r.status == 200 && r.json.optString("token").length() > 0) {
                Relay.prefs(c).edit().putString(k(i, "code"), r.json.optString("token")).putString(k(i, "center"), r.json.optString("centerName")).apply();
                Relay.log(c, s.label() + ": paired with " + r.json.optString("centerName", s.label()));
                return null;
            }
            if (r.status == 404) return s.label() + ": no ZENAA app at " + s.zenaaBase() + " (404). Check the website address.";
            JSONObject err = r.json.optJSONObject("error");
            String msg = err != null ? err.optString("message") : r.json.optString("message");
            return s.label() + ": pairing refused (" + r.status + ")" + (msg.isEmpty() ? "" : " - " + msg) + ". Make a new code in its admin.";
        } catch (Exception e) {
            return "Cannot reach " + s.zenaaBase() + " - check the address and the internet";
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
                .remove(k(i, "center"))
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
            if (s.needsPairing()) {
                if (ensurePaired(c, i) != null) continue; // keep the queue until pairing works
                s = get(c, i);
            }
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
                    Relay.Result r = Relay.call("POST", s.sendUrl(), s.code, payload(m.optString("from"), m.optString("body"), m.optLong("at")), s.code);
                    if (r.status >= 200 && r.status < 300) {
                        Relay.log(c, s.label() + ": ✓ sent (" + m.optString("from") + ")");
                    } else if (r.status == 401 || r.status == 403) {
                        Relay.log(c, s.label() + ": code refused (" + r.status + ") — check the code");
                        left.put(m);
                        stop = true;
                    } else if (r.status == 408 || r.status == 429 || r.status >= 500) {
                        left.put(m);
                        stop = true;
                    } else if (r.status == 404) {
                        Relay.log(c, s.label() + ": wrong link (404) - type just the website, e.g. https://wifi.example.com");
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
        String pairing = ensurePaired(c, i);
        if (pairing != null) return pairing;
        s = get(c, i);
        if (s.zenaaBase() != null) {
            try {
                Relay.Result r = Relay.call("GET", s.zenaaBase() + "/api/momo/relay/ping", s.code, null);
                if (r.status == 200) return "\u2713 Connected to " + r.json.optString("centerName", s.label()) + " (payments and customer SMS)";
                if (r.status == 401) return s.label() + ": not paired any more. Edit and type a new 6-digit code from its admin.";
                if (r.status == 404) return s.label() + ": no ZENAA app at " + s.zenaaBase() + " (404). Check the website address.";
                if (r.status == 404) return s.label() + " answered 404: wrong link. Check the address (for a ZENAA app type just its website).";
            return s.label() + " answered " + r.status;
            } catch (Exception e) {
                return "Cannot reach " + s.zenaaBase() + " - check the address and the internet";
            }
        }
        try {
            JSONObject b = payload("ZENAA MoMo", "Test message from ZENAA MoMo — not a payment.", System.currentTimeMillis());
            b.put("test", true);
            Relay.Result r = Relay.call("POST", s.sendUrl(), s.code, b, s.code);
            if (r.status >= 200 && r.status < 300) return "✓ " + s.label() + " received the test";
            if (r.status == 401 || r.status == 403) return s.label() + " refused the code (" + r.status + ")";
            return s.label() + " answered " + r.status;
        } catch (Exception e) {
            return "Cannot reach " + s.url + " — check the link and Wi-Fi";
        }
    }
}
