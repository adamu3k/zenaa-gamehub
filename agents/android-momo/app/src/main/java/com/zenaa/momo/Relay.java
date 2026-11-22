package com.zenaa.momo;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Sends SMS to ZENAA. Messages that can't be sent (no Wi-Fi, server off) are kept in a queue and sent later —
 * with the next SMS, when the app is opened, or with "Send waiting messages".
 */
final class Relay {
    static final String VERSION = "1.2.0";

    static final class Result {
        final int status;
        final JSONObject json;

        Result(int status, JSONObject json) {
            this.status = status;
            this.json = json;
        }
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("zenaa-momo", Context.MODE_PRIVATE);
    }

    static Result call(String method, String url, String token, JSONObject body) throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        con.setRequestMethod(method);
        con.setConnectTimeout(8000);
        con.setReadTimeout(10000);
        con.setRequestProperty("User-Agent", "ZenaaMoMo/" + VERSION);
        if (token != null && token.length() > 0) con.setRequestProperty("Authorization", "Bearer " + token);
        if (body != null) {
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            con.setDoOutput(true);
            con.setRequestProperty("Content-Type", "application/json");
            OutputStream os = con.getOutputStream();
            os.write(bytes);
            os.close();
        }
        int status = con.getResponseCode();
        InputStream in = status >= 400 ? con.getErrorStream() : con.getInputStream();
        StringBuilder sb = new StringBuilder();
        if (in != null) {
            BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            r.close();
        }
        con.disconnect();
        JSONObject json;
        try {
            json = new JSONObject(sb.toString());
        } catch (Exception e) {
            json = new JSONObject();
        }
        return new Result(status, json);
    }

    /** Adds a message to the queue (max 200 kept). */
    static synchronized void enqueue(Context c, String from, String body, long at) {
        try {
            SharedPreferences p = prefs(c);
            JSONArray q = new JSONArray(p.getString("queue", "[]"));
            JSONObject m = new JSONObject();
            m.put("from", from);
            m.put("body", body);
            m.put("at", at);
            q.put(m);
            while (q.length() > 200) q.remove(0);
            p.edit().putString("queue", q.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    static int queued(Context c) {
        try {
            return new JSONArray(prefs(c).getString("queue", "[]")).length();
        } catch (Exception e) {
            return 0;
        }
    }

    /** Sends everything waiting. Call from a background thread. Returns how many are still waiting. */
    static synchronized int flush(Context c) {
        SharedPreferences p = prefs(c);
        String server = p.getString("server", "");
        String token = p.getString("token", "");
        if (server.isEmpty() || token.isEmpty()) return queued(c);
        JSONArray q;
        try {
            q = new JSONArray(p.getString("queue", "[]"));
        } catch (Exception e) {
            q = new JSONArray();
        }
        JSONArray left = new JSONArray();
        boolean stop = false;
        for (int i = 0; i < q.length(); i++) {
            JSONObject m = q.optJSONObject(i);
            if (m == null) continue;
            if (stop) {
                left.put(m);
                continue;
            }
            try {
                JSONObject body = new JSONObject();
                body.put("from", m.optString("from"));
                body.put("body", m.optString("body"));
                Result r = call("POST", server + "/api/momo/sms", token, body);
                if (r.status == 200) {
                    log(c, m.optString("from") + ": " + describe(r.json));
                } else if (r.status == 401) {
                    log(c, "Not paired any more — pair again in ZENAA → Settings → MoMo");
                    left.put(m);
                    stop = true;
                } else if (r.status >= 500) {
                    left.put(m);
                    stop = true;
                } else {
                    log(c, "Refused (" + r.status + "): " + r.json.optString("message"));
                }
            } catch (Exception e) {
                left.put(m);
                stop = true; // offline: try again later
            }
        }
        p.edit().putString("queue", left.toString()).apply();
        return left.length();
    }

    private static String describe(JSONObject j) {
        String s = j.optString("status");
        if ("credited".equals(s)) return "✓ matched and credited to the customer";
        if ("unmatched".equals(s)) return "received — waiting for a customer to claim it";
        String reason = j.optString("reason", "");
        return "ignored" + (reason.isEmpty() ? "" : " (" + reason + ")");
    }

    static synchronized void log(Context c, String line) {
        try {
            SharedPreferences p = prefs(c);
            JSONArray a = new JSONArray(p.getString("log", "[]"));
            a.put(new SimpleDateFormat("dd MMM HH:mm", Locale.US).format(new Date()) + "  " + line);
            while (a.length() > 30) a.remove(0);
            p.edit().putString("log", a.toString()).apply();
        } catch (Exception ignored) {
        }
    }
}
