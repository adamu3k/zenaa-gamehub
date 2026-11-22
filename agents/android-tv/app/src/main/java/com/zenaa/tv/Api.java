package com.zenaa.tv;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Tiny HTTP + settings helper (no libraries). */
final class Api {
    static final String VERSION = "1.3.0";

    static final class Result {
        final int status;
        final JSONObject json;

        Result(int status, JSONObject json) {
            this.status = status;
            this.json = json;
        }
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("zenaa", Context.MODE_PRIVATE);
    }

    static Result call(String method, String url, String token, JSONObject body) throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        con.setRequestMethod(method);
        con.setConnectTimeout(6000);
        con.setReadTimeout(8000);
        con.setRequestProperty("User-Agent", "ZenaaTV/" + VERSION);
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

    static String sha256(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] b = md.digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte x : b) sb.append(String.format("%02x", x));
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    static String clock(int seconds) {
        if (seconds < 0) seconds = 0;
        int h = seconds / 3600, m = (seconds % 3600) / 60, s = seconds % 60;
        return h > 0 ? String.format("%d:%02d:%02d", h, m, s) : String.format("%02d:%02d", m, s);
    }
}
