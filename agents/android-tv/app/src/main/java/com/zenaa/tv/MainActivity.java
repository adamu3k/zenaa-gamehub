package com.zenaa.tv;

import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

/** Pairing + status screen. Works with a TV remote (D-pad) as well as touch. */
public class MainActivity extends Activity {
    private LinearLayout root;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ScrollView scroll = new ScrollView(this);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(48), dp(32), dp(48), dp(32));
        root.setBackgroundColor(Color.parseColor("#0B0D12"));
        scroll.addView(root);
        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        build();
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

    private Button button(String label, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(18);
        b.setTextColor(Color.WHITE);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#7C5CFF"));
        bg.setCornerRadius(dp(10));
        b.setBackground(bg);
        b.setOnFocusChangeListener((v, has) -> bg.setStroke(has ? dp(4) : 0, Color.WHITE));
        b.setOnClickListener(l);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(10);
        b.setLayoutParams(lp);
        b.setPadding(dp(24), dp(10), dp(24), dp(10));
        return b;
    }

    private EditText input(String hint, String value, int type) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setText(value);
        e.setInputType(type);
        e.setTextSize(20);
        e.setTextColor(Color.WHITE);
        e.setHintTextColor(Color.parseColor("#5F6779"));
        e.setSingleLine(true);
        return e;
    }

    private boolean canDraw() {
        return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(this);
    }

    private void build() {
        root.removeAllViews();
        final SharedPreferences p = Api.prefs(this);
        root.addView(text("ZENAA TV", 34, Color.WHITE, true));
        root.addView(text("Shows the play-time timer on top of the PS5 picture and covers the screen when time is up.", 18, Color.parseColor("#8A93A6"), false));

        // Permissions first: without "display over other apps" nothing can be shown over the PS5.
        if (!canDraw()) {
            root.addView(text("Step 1 — allow \"Display over other apps\"", 22, Color.parseColor("#F59E0B"), true));
            root.addView(text("Press the button. If your TV has no such settings screen, run this once from a PC on the same Wi-Fi (Developer options → Network debugging on):\n"
                + "adb connect <TV-IP>\nadb shell appops set com.zenaa.tv SYSTEM_ALERT_WINDOW allow", 16, Color.parseColor("#BEC3D2"), false));
            root.addView(button("Open the permission screen", v -> {
                try {
                    startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())));
                } catch (Exception e) {
                    try {
                        startActivity(new Intent(Settings.ACTION_SETTINGS));
                    } catch (Exception ignored) {
                    }
                }
            }));
        }

        String token = p.getString("token", "");
        if (token.isEmpty()) {
            root.addView(text("Pair this TV with a station", 24, Color.WHITE, true));
            root.addView(text("In ZENAA: Stations → ✏️ (edit) → Station screen → Pair a screen. Enter the address and the 6-digit code shown there.", 16, Color.parseColor("#8A93A6"), false));
            final EditText server = input("Server address, e.g. http://192.168.1.10:8080", p.getString("server", "http://192.168.1.10:8080"), InputType.TYPE_TEXT_VARIATION_URI);
            final EditText code = input("6-digit code", "", InputType.TYPE_CLASS_NUMBER);
            final TextView err = text("", 16, Color.parseColor("#F87171"), false);
            root.addView(server);
            root.addView(code);
            root.addView(err);
            root.addView(button("Pair", v -> pair(server.getText().toString(), code.getText().toString(), err)));
            code.requestFocus();
            return;
        }

        root.addView(text("Paired with " + p.getString("station", "a station"), 24, Color.parseColor("#22C55E"), true));
        root.addView(text("Server: " + p.getString("server", ""), 16, Color.parseColor("#8A93A6"), false));
        startAgent();

        final ComponentName admin = new ComponentName(this, AdminReceiver.class);
        DevicePolicyManager dpm = (DevicePolicyManager) getSystemService(DEVICE_POLICY_SERVICE);
        if (!dpm.isAdminActive(admin)) {
            root.addView(text("Optional — switch the TV screen off when time is up", 20, Color.WHITE, true));
            root.addView(text("Also turn on \"Android TV: switch the panel off\" in ZENAA → Settings. If the button does nothing on your TV, run:\nadb shell dpm set-active-admin com.zenaa.tv/.AdminReceiver", 16, Color.parseColor("#8A93A6"), false));
            root.addView(button("Allow screen off", v -> {
                Intent i = new Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN);
                i.putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, admin);
                i.putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, "ZENAA switches the screen off when paid play time is over.");
                try {
                    startActivity(i);
                } catch (Exception ignored) {
                }
            }));
        } else {
            root.addView(text("Screen-off permission: on", 16, Color.parseColor("#22C55E"), false));
        }

        root.addView(text("Staff", 20, Color.WHITE, true));
        final EditText pin = input("Staff exit PIN", "", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        final TextView err = text("", 16, Color.parseColor("#F87171"), false);
        root.addView(pin);
        root.addView(err);
        root.addView(button("Unpair this TV", v -> {
            String hash = p.getString("pinHash", "");
            if (!hash.isEmpty() && !Api.sha256(pin.getText().toString()).equals(hash)) {
                err.setText("Wrong PIN");
                return;
            }
            p.edit().remove("token").apply();
            stopService(new Intent(this, AgentService.class));
            build();
        }));
        root.addView(text("Tip: when the screen is covered, staff can type the PIN with the remote's number keys to unlock for 10 minutes. The app starts by itself when the TV is switched on.", 14, Color.parseColor("#5F6779"), false));
    }

    private void startAgent() {
        Intent svc = new Intent(this, AgentService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc);
        else startService(svc);
    }

    private void pair(String serverRaw, String code, TextView err) {
        String s = serverRaw.trim();
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://" + s;
        final String server = s;
        if (!code.trim().matches("\\d{6}")) {
            err.setText("Enter the 6-digit code");
            return;
        }
        err.setTextColor(Color.parseColor("#8A93A6"));
        err.setText("Pairing…");
        new Thread(() -> {
            String msg;
            try {
                JSONObject body = new JSONObject();
                body.put("code", code.trim());
                body.put("kind", "android_tv");
                body.put("name", Build.MANUFACTURER + " " + Build.MODEL);
                body.put("version", Api.VERSION);
                Api.Result r = Api.call("POST", server + "/api/agent/pair", null, body);
                if (r.status == 200) {
                    JSONObject st = r.json.optJSONObject("station");
                    Api.prefs(this)
                        .edit()
                        .putString("server", server)
                        .putString("token", r.json.optString("token"))
                        .putString("station", st == null ? "" : st.optString("code") + " · " + st.optString("name"))
                        .apply();
                    runOnUiThread(this::build);
                    return;
                }
                msg = r.json.optString("message", "Server answered " + r.status);
            } catch (Exception e) {
                msg = "Cannot reach the server: " + e.getMessage();
            }
            final String m = msg;
            runOnUiThread(() -> {
                err.setTextColor(Color.parseColor("#F87171"));
                err.setText(m);
            });
        }).start();
    }
}
