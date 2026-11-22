package com.zenaa.momo;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * ZENAA MoMo: install on the Android phone that holds the venue's MoMo SIM.
 * Pair once (server address + 6-digit code from ZENAA → Settings → MoMo), allow SMS, and leave it.
 */
public class MainActivity extends Activity {
    private LinearLayout root;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ScrollView scroll = new ScrollView(this);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(24), dp(20), dp(24));
        root.setBackgroundColor(Color.parseColor("#0B0D12"));
        scroll.setBackgroundColor(Color.parseColor("#0B0D12"));
        scroll.addView(root);
        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        build();
        RelayService.start(this);
        new Thread(() -> {
            Relay.flush(this);
            Outbox.run(this);
            ui.post(this::build);
        }).start();
    }

    /** SMS in + out, and (Android 13+) the small "running" notification. */
    private String[] wantedPermissions() {
        if (Build.VERSION.SDK_INT >= 33) return new String[] {Manifest.permission.RECEIVE_SMS, Manifest.permission.SEND_SMS, Manifest.permission.POST_NOTIFICATIONS};
        return new String[] {Manifest.permission.RECEIVE_SMS, Manifest.permission.SEND_SMS};
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        t.setPadding(0, dp(6), 0, dp(6));
        return t;
    }

    private EditText input(String hint, String value, int type) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setText(value);
        e.setInputType(type);
        e.setTextColor(Color.WHITE);
        e.setHintTextColor(Color.parseColor("#6E7382"));
        e.setSingleLine(true);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#141822"));
        bg.setCornerRadius(dp(10));
        bg.setStroke(dp(1), Color.parseColor("#2A3140"));
        e.setBackground(bg);
        e.setPadding(dp(14), dp(12), dp(14), dp(12));
        return e;
    }

    private Button button(String label, boolean primary) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextColor(primary ? Color.WHITE : Color.parseColor("#E5E7EB"));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor(primary ? "#7C5CFF" : "#1F2430"));
        bg.setCornerRadius(dp(10));
        b.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48));
        lp.topMargin = dp(10);
        b.setLayoutParams(lp);
        return b;
    }

    private void openAppSettings() {
        try {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
        } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_SETTINGS));
        }
    }

    private boolean batteryFree() {
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            return pm == null || pm.isIgnoringBatteryOptimizations(getPackageName());
        } catch (Exception e) {
            return true;
        }
    }

    private boolean smsAllowed() {
        return Build.VERSION.SDK_INT < 23
                || (checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED && Outbox.canSend(this));
    }

    private void build() {
        root.removeAllViews();
        SharedPreferences p = Relay.prefs(this);
        String token = p.getString("token", "");
        root.addView(text("ZENAA MoMo", 26, Color.WHITE, true));
        root.addView(text("Forwards \"Payment received\" SMS to ZENAA so customers' MoMo top-ups are credited automatically. Keep this phone charged, on Wi-Fi, with the MoMo SIM inside.", 14, Color.parseColor("#9AA4B2"), false));

        if (!smsAllowed()) {
            boolean asked = p.getBoolean("askedSms", false);
            root.addView(text("Step 1 · Allow SMS", 18, Color.parseColor("#F59E0B"), true));
            if (!asked) {
                root.addView(text("Press the button. Android asks to let ZENAA MoMo send and view SMS: choose Allow. (It reads MoMo payment messages and sends your thank-you SMS to customers.)", 14, Color.parseColor("#BEC3D2"), false));
            } else {
                root.addView(text("Android blocked the SMS permission. This is normal for apps not from the Play Store. Do this once:", 14, Color.parseColor("#BEC3D2"), false));
                root.addView(text("1. Press \"Open app settings\" below.\n"
                        + "2. Tap ⋮ (three dots, top right) → \"Allow restricted settings\" → confirm with your screen lock.\n"
                        + "    No ⋮ or no such option? Your Android doesn't need it: go on to step 3.\n"
                        + "3. Tap Permissions → SMS → Allow.\n"
                        + "4. Come back to this app. This box disappears when it worked.", 14, Color.WHITE, false));
                Button settings = button("Open app settings", true);
                settings.setOnClickListener(v -> openAppSettings());
                root.addView(settings);
                root.addView(text("Still greyed out? Use Plan B in ZENAA Help → guide 18: connect this phone to the counter PC with a USB cable and run the installer there. It installs ZENAA MoMo with SMS already allowed.", 13, Color.parseColor("#9AA4B2"), false));
            }
            Button allow = button(asked ? "Ask again" : "Allow SMS", !asked);
            allow.setOnClickListener(v -> {
                Relay.prefs(this).edit().putBoolean("askedSms", true).apply();
                requestPermissions(wantedPermissions(), 1);
            });
            root.addView(allow);
        } else if (Build.VERSION.SDK_INT >= 23 && !batteryFree()) {
            root.addView(text("✓ SMS allowed", 16, Color.parseColor("#22C55E"), true));
            root.addView(text("Recommended: stop Android from putting this app to sleep, so payments are forwarded straight away.", 14, Color.parseColor("#BEC3D2"), false));
            Button bat = button("Don't put to sleep (battery)", false);
            bat.setOnClickListener(v -> {
                try {
                    startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
                } catch (Exception e) {
                    openAppSettings();
                }
            });
            root.addView(bat);
        }

        if (token.isEmpty()) {
            root.addView(text("Pair with ZENAA", 18, Color.WHITE, true));
            root.addView(text("In ZENAA on the counter PC: Settings → MoMo top-ups → Pair the MoMo phone. Type the server address and the 6-digit code shown there.", 14, Color.parseColor("#BEC3D2"), false));
            final EditText server = input("Server address, e.g. http://192.168.1.10:8080", p.getString("server", "http://"), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
            final EditText code = input("6-digit code", "", InputType.TYPE_CLASS_NUMBER);
            final TextView err = text("", 14, Color.parseColor("#F87171"), false);
            root.addView(server);
            root.addView(code);
            root.addView(err);
            Button pair = button("Pair", true);
            pair.setOnClickListener(v -> {
                final String url = server.getText().toString().trim().replaceAll("/+$", "");
                final String c = code.getText().toString().trim();
                err.setText("Pairing…");
                new Thread(() -> {
                    String problem = null;
                    String center = "";
                    try {
                        JSONObject body = new JSONObject();
                        body.put("code", c);
                        body.put("device", Build.MANUFACTURER + " " + Build.MODEL);
                        Relay.Result r = Relay.call("POST", url + "/api/momo/relay/pair", null, body);
                        if (r.status == 200) {
                            p.edit().putString("server", url).putString("token", r.json.getString("token")).putString("center", r.json.optString("centerName")).apply();
                            center = r.json.optString("centerName");
                            Relay.log(this, "Paired with " + center);
                            RelayService.start(this);
                        } else problem = r.json.optString("message", "Pairing failed (" + r.status + ")");
                    } catch (Exception e) {
                        problem = "Cannot reach " + url + " — same Wi-Fi as the ZENAA PC? Address with http:// and :8080?";
                    }
                    final String fp = problem;
                    ui.post(() -> {
                        if (fp != null) err.setText(fp);
                        else build();
                    });
                }).start();
            });
            root.addView(pair);
        } else {
            root.addView(text("✓ Paired with " + p.getString("center", "ZENAA"), 18, Color.parseColor("#22C55E"), true));
            root.addView(text(p.getString("server", ""), 13, Color.parseColor("#9AA4B2"), false));
            root.addView(text(Outbox.canSend(this) ? "✓ Sends thank-you SMS to customers (switch on/off in ZENAA → Settings → MoMo)" : "Thank-you SMS: not allowed to send SMS yet (Step 1 above)", 13, Outbox.canSend(this) ? Color.parseColor("#22C55E") : Color.parseColor("#F59E0B"), false));
            int waiting = Relay.queued(this);
            root.addView(text(waiting == 0 ? "No messages waiting." : waiting + " message(s) waiting to be sent (server unreachable).", 14, waiting == 0 ? Color.parseColor("#BEC3D2") : Color.parseColor("#F59E0B"), false));
            Button test = button("Test connection", false);
            final TextView status = text("", 14, Color.parseColor("#BEC3D2"), false);
            test.setOnClickListener(v -> {
                status.setText("Checking…");
                new Thread(() -> {
                    String msg;
                    try {
                        Relay.Result r = Relay.call("GET", p.getString("server", "") + "/api/momo/relay/ping", p.getString("token", ""), null);
                        msg = r.status == 200 ? "✓ Connected to " + r.json.optString("centerName") : r.json.optString("message", "Error " + r.status);
                    } catch (Exception e) {
                        msg = "Cannot reach the server — check Wi-Fi.";
                    }
                    final String m = msg;
                    ui.post(() -> status.setText(m));
                }).start();
            });
            root.addView(test);
            Button retry = button("Send waiting messages", false);
            retry.setOnClickListener(v -> new Thread(() -> {
                Relay.flush(this);
                ui.post(this::build);
            }).start());
            root.addView(retry);
            root.addView(status);
            root.addView(text("Recent", 16, Color.WHITE, true));
            try {
                JSONArray log = new JSONArray(p.getString("log", "[]"));
                if (log.length() == 0) root.addView(text("Nothing yet. Send yourself GHS 1 by MoMo to test.", 13, Color.parseColor("#6E7382"), false));
                for (int i = log.length() - 1; i >= 0; i--) root.addView(text(log.optString(i), 13, Color.parseColor("#BEC3D2"), false));
            } catch (Exception ignored) {
            }
            Button unpair = button("Unpair this phone", false);
            unpair.setOnClickListener(v -> {
                p.edit().remove("token").apply();
                build();
            });
            root.addView(unpair);
        }
        root.addView(text("ZENAA MoMo " + Relay.VERSION + " · only ZENAA receives the messages; it ignores everything that isn't a MoMo payment.", 12, Color.parseColor("#6E7382"), false));
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        RelayService.start(this);
        build();
    }
}
