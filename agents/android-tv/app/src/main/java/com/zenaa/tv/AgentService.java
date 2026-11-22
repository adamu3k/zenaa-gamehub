package com.zenaa.tv;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

/**
 * Polls ZENAA for this station's state and draws on top of whatever the TV shows (PS5 HDMI input):
 *  - the timer as an "island" pill at the top centre (ring · time · temperature), or a corner box,
 *    growing the island for alerts (time almost up, staff messages),
 *  - a full-screen cover when time is up / no session ("See the counter"),
 *  - optionally switches the panel off (device admin) when time is up,
 *  - staff messages as a banner.
 * Staff unlock: type your own staff PIN with the remote's number keys on the cover, then OK. The server turns the
 * station on with no charge for 30 minutes (recorded with your name). Offline: the shared exit PIN unlocks 10 minutes.
 */
public class AgentService extends Service {
    private final Handler ui = new Handler(Looper.getMainLooper());
    private WindowManager wm;
    private View dock;
    private TextView dockTop, dockBig, dockSub;
    private FrameLayout cover;
    private TextView coverCenter, coverTitle, coverText, coverFoot;
    private View banner;
    private IslandView island;
    private String style = "island", stationCode = "", weatherIcon = "";
    private Integer tempC = null;
    private float islandScale = 0.7f;
    private Integer bypassRemaining = null;
    private volatile boolean checkingPin = false;
    private boolean lastMinuteShown = false;
    private boolean fiveShown = false;
    private Integer prevRem = null;
    private ToneGenerator tones;
    private TextView bannerText;
    private volatile boolean running;

    // Last good state from the server
    private String phase = "idle", lockTitle = "", lockText = "", center = "ZENAA GAMEHUB", station = "", player = "", pinHash = "", messageId = null;
    private boolean lock = true, screenOff = false;
    private Integer remaining = null;
    private int elapsed = 0;
    private long fetchedAt = SystemClock.elapsedRealtime();
    private long lastOk = SystemClock.elapsedRealtime();
    private long unlockedUntil = 0;
    private boolean screenOffDone = false;
    private String lastPhase = "";
    private final StringBuilder pinBuf = new StringBuilder();

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        startInForeground();
        running = true;
        new Thread(this::pollLoop, "zenaa-poll").start();
        ui.post(this::tick);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        removeAll();
        if (tones != null) { tones.release(); tones = null; }
        super.onDestroy();
    }

    private void startInForeground() {
        String ch = "zenaa";
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(ch, "ZENAA timer", NotificationManager.IMPORTANCE_MIN));
            b = new Notification.Builder(this, ch);
        } else {
            b = new Notification.Builder(this);
        }
        Notification n = b.setContentTitle("ZENAA TV").setContentText("Station timer is running").setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setOngoing(true).build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(1, n);
    }

    // ───────────── Network ─────────────

    private void pollLoop() {
        while (running) {
            SharedPreferences p = Api.prefs(this);
            String server = p.getString("server", "");
            String token = p.getString("token", "");
            if (token.isEmpty()) {
                ui.post(this::stopSelf);
                return;
            }
            try {
                Api.Result r = Api.call("GET", server + "/api/agent/state?v=" + Api.VERSION, token, null);
                if (r.status == 401) {
                    p.edit().remove("token").apply();
                    ui.post(() -> {
                        removeAll();
                        stopSelf();
                    });
                    return;
                }
                if (r.status == 200) {
                    final JSONObject j = r.json;
                    ui.post(() -> apply(j));
                }
            } catch (Exception ignored) {
                // offline — keep counting down locally
            }
            SystemClock.sleep(3000);
        }
    }

    private void apply(JSONObject j) {
        phase = j.optString("phase", "idle");
        lock = j.optBoolean("lock", true);
        screenOff = j.optBoolean("screenOff", false);
        lockTitle = j.optString("lockTitle", "Time is up");
        lockText = j.optString("lockText", "Please see the counter.");
        center = j.optString("centerName", "ZENAA GAMEHUB");
        JSONObject st = j.optJSONObject("station");
        if (st != null) {
            station = st.optString("code") + " · " + st.optString("name");
            stationCode = st.optString("code");
        }
        JSONObject dk = j.optJSONObject("dock");
        tempC = null;
        if (dk != null) {
            style = "corner".equals(dk.optString("style")) ? "corner" : "island";
            if (dk.has("scale")) islandScale = dk.optInt("scale", 70) / 100f;
            JSONObject w = dk.optJSONObject("weather");
            if (w != null) {
                tempC = w.optInt("tempC");
                weatherIcon = w.optString("icon");
            }
        }
        JSONObject s = j.optJSONObject("session");
        remaining = null;
        elapsed = 0;
        player = "";
        if (s != null) {
            if (!s.isNull("remainingSeconds")) remaining = s.optInt("remainingSeconds");
            elapsed = s.optInt("elapsedSeconds", 0);
            player = s.isNull("playerName") ? "" : s.optString("playerName", "");
        }
        JSONObject bp = j.optJSONObject("bypass");
        bypassRemaining = bp != null ? (Integer) bp.optInt("remainingSeconds") : null;
        String newHash = j.optString("exitPinHash", "");
        if (!newHash.equals(pinHash)) Api.prefs(this).edit().putString("pinHash", newHash).apply();
        pinHash = newHash;
        JSONObject m = j.optJSONObject("message");
        if (m != null) {
            String id = m.optString("id");
            if (messageId != null && !id.equals(messageId)) alert("Message from the counter", m.optString("text"), Color.parseColor("#A08CFF"));
            messageId = id;
        } else if (messageId == null) {
            messageId = "";
        }
        fetchedAt = SystemClock.elapsedRealtime();
        lastOk = fetchedAt;
    }

    // ───────────── Drawing ─────────────

    private boolean canDraw() {
        return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(this);
    }

    private int overlayType() {
        return Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private void tick() {
        if (!running) return;
        try {
            render();
        } catch (Exception ignored) {
        }
        ui.postDelayed(this::tick, 1000);
    }

    private void render() {
        if (!canDraw()) return;
        int since = (int) ((SystemClock.elapsedRealtime() - fetchedAt) / 1000);
        boolean active = phase.equals("running") || phase.equals("warning");
        Integer rem = remaining == null ? null : Math.max(0, remaining - (phase.equals("paused") ? 0 : since));
        boolean expiredLocally = active && rem != null && rem <= 0;
        boolean offline = SystemClock.elapsedRealtime() - lastOk > 20000;
        boolean locked = (lock || expiredLocally) && SystemClock.elapsedRealtime() > unlockedUntil;

        // Island (default) or corner dock
        boolean useIsland = !"corner".equals(style);
        if (useIsland) {
            if (dock != null) dock.setVisibility(View.GONE);
            ensureIsland();
            fillIsland(active, rem, since, offline);
            island.setVisibility(locked ? View.GONE : View.VISIBLE);
            island.invalidate();
        } else if (island != null) {
            island.setVisibility(View.GONE);
        }
        if (active && !lastPhase.isEmpty() && !lastPhase.equals("running") && !lastPhase.equals("warning")) {
            alert(player.isEmpty() ? "Game on!" : "Game on, " + player + "!", rem != null ? Api.clock(rem) + " to play. Enjoy!" : "Open session — pay at the end.", Color.parseColor("#22C55E"));
        }
        if (active && rem != null && rem > 0 && rem <= 60 && !lastMinuteShown) {
            lastMinuteShown = true;
            if (rem > 10) tone(ToneGenerator.TONE_PROP_ACK, 400);
            alert("Last minute", "Save your game now. Top up at the counter to keep playing.", Color.parseColor("#EF4444"));
        }
        if (!active) lastMinuteShown = false;
        countdown(active, rem);
        if (!useIsland) ensureDock();
        if (dock != null) dockTop.setText(station + (offline ? "  · offline" : ""));
        if (useIsland) {
            // nothing more: the island shows everything
        } else if (active) {
            dockBig.setText(rem != null ? Api.clock(rem) : Api.clock(elapsed + since));
            dockSub.setText((rem != null ? "remaining" : "playing") + (player.isEmpty() ? "" : " · " + player));
            boolean warn = phase.equals("warning") || (rem != null && rem <= 300);
            int color = warn ? ((since % 2 == 0) ? Color.parseColor("#F59E0B") : Color.parseColor("#EF4444")) : Color.parseColor("#22C55E");
            dockSub.setTextColor(color);
            dock.setVisibility(View.VISIBLE);
        } else {
            dock.setVisibility(View.GONE);
        }
        if (phase.equals("warning") && !lastPhase.equals("warning")) {
            if (rem != null && rem <= 305) fiveShown = true;
            if (rem == null || rem > 10) tone(ToneGenerator.TONE_PROP_ACK, 400);
            alert("Time is almost up", (rem != null ? Api.clock(rem) + " left. " : "") + "Top up at the counter to keep playing.", Color.parseColor("#F59E0B"));
        }
        lastPhase = phase;

        // Cover
        if (locked) {
            ensureCover();
            coverCenter.setText(center.toUpperCase());
            coverTitle.setText(expiredLocally ? "Time is up" : lockTitle);
            coverText.setText(expiredLocally ? "Please see the counter to play again." : lockText);
            if (pinBuf.length() == 0 && !checkingPin) coverFoot.setText(station);
            cover.setVisibility(View.VISIBLE);
            if (screenOff && !screenOffDone) {
                screenOffDone = true;
                turnScreenOff();
            }
        } else {
            if (cover != null) cover.setVisibility(View.GONE);
            screenOffDone = false;
        }
    }

    private WindowManager.LayoutParams params(int w, int h, boolean focusable) {
        int flags = WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON;
        if (!focusable) flags |= WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        return new WindowManager.LayoutParams(w, h, overlayType(), flags, PixelFormat.TRANSLUCENT);
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void ensureDock() {
        if (dock != null) return;
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(14), dp(8), dp(16), dp(8));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.argb(220, 12, 14, 20));
        bg.setCornerRadius(dp(12));
        bg.setStroke(dp(1), Color.argb(80, 124, 92, 255));
        box.setBackground(bg);
        dockTop = text(11, Color.parseColor("#9AA3B5"), false);
        dockBig = text(30, Color.WHITE, true);
        dockBig.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        dockSub = text(12, Color.parseColor("#22C55E"), true);
        box.addView(dockTop);
        box.addView(dockBig);
        box.addView(dockSub);
        WindowManager.LayoutParams lp = params(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT, false);
        lp.gravity = Gravity.TOP | Gravity.END;
        lp.x = dp(24);
        lp.y = dp(20);
        dock = box;
        wm.addView(dock, lp);
    }

    private void ensureIsland() {
        if (island != null) return;
        island = new IslandView(this);
        WindowManager.LayoutParams lp = params(island.maxWidthPx(), island.maxHeightPx(), false);
        lp.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        lp.y = dp(14);
        wm.addView(island, lp);
    }

    private void fillIsland(boolean active, Integer rem, int since, boolean offline) {
        IslandView v = island;
        if (v.setScale(islandScale)) {
            WindowManager.LayoutParams lp = (WindowManager.LayoutParams) v.getLayoutParams();
            lp.width = v.maxWidthPx();
            lp.height = v.maxHeightPx();
            try {
                wm.updateViewLayout(v, lp);
            } catch (Exception ignored) {
            }
        }
        v.station = stationCode;
        v.offline = offline;
        v.progress = -1f;
        v.timeColor = Color.WHITE;
        boolean blinkOn = (SystemClock.elapsedRealtime() / 1000) % 2 == 0;
        if (active) {
            v.time = rem != null ? Api.clock(rem) : Api.clock(elapsed + since);
            boolean warn = phase.equals("warning") || (rem != null && rem <= 300);
            v.accent = warn ? Color.parseColor(rem != null && rem <= 60 ? "#EF4444" : "#F59E0B") : Color.parseColor("#22C55E");
            if (warn) v.timeColor = blinkOn ? v.accent : Color.WHITE;
            if (rem != null && remaining != null) {
                int total = elapsed + remaining;
                v.progress = total > 0 ? Math.max(0f, Math.min(1f, rem / (float) total)) : 0f;
            } else v.progress = 1f;
        } else if (phase.equals("paused")) {
            v.time = "PAUSED";
            v.accent = Color.parseColor("#F59E0B");
            v.timeColor = v.accent;
        } else if (phase.equals("maintenance")) {
            v.time = "Maintenance";
            v.accent = Color.parseColor("#38BDF8");
        } else if (phase.equals("staff")) {
            int left = bypassRemaining != null ? Math.max(0, bypassRemaining - since) : 0;
            v.time = left > 0 && left < 11 * 3600 ? "FREE " + Api.clock(left) : "STAFF";
            v.accent = Color.parseColor("#38BDF8");
            v.timeColor = v.accent;
        } else {
            v.time = "Ready";
            v.accent = Color.parseColor("#7C5CFF");
        }
        if (offline) {
            v.rightIcon = "●";
            v.right = "offline";
        } else if (tempC != null) {
            v.rightIcon = IslandView.weatherGlyph(weatherIcon);
            v.right = tempC + "°";
        } else {
            v.rightIcon = "";
            v.right = new java.text.SimpleDateFormat("HH:mm", java.util.Locale.US).format(new java.util.Date());
        }
    }

    /** 5 minutes left: alert + chime. Last 10 seconds: a beep each second. Zero: alarm. */
    private void countdown(boolean active, Integer rem) {
        if (!active || rem == null) {
            if (prevRem != null && prevRem <= 12 && (lock || phase.equals("idle"))) tone(ToneGenerator.TONE_CDMA_EMERGENCY_RINGBACK, 2500);
            prevRem = null;
            if (!active) fiveShown = false;
            return;
        }
        int r = rem;
        if (prevRem != null) {
            int p = prevRem;
            if (!fiveShown && p > 300 && r <= 300 && r > 60) {
                fiveShown = true;
                tone(ToneGenerator.TONE_PROP_ACK, 400);
                alert("5 minutes left", Api.clock(r) + " left. Top up at the counter to keep playing.", Color.parseColor("#F59E0B"));
            }
            if (r < p && r <= 10 && r > 0) {
                tone(r <= 3 ? ToneGenerator.TONE_PROP_BEEP2 : ToneGenerator.TONE_PROP_BEEP, 200);
                if (!"corner".equals(style) && canDraw()) {
                    ensureIsland();
                    island.expand("Time is up in " + r + "…", "Save your game now. Top up at the counter to keep playing.", Color.parseColor("#EF4444"), 2);
                }
            }
            if (p > 0 && r <= 0) tone(ToneGenerator.TONE_CDMA_EMERGENCY_RINGBACK, 2500);
        }
        if (r > 300) fiveShown = false;
        prevRem = r;
    }

    private void tone(int type, int ms) {
        try {
            if (tones == null) tones = new ToneGenerator(AudioManager.STREAM_ALARM, 90);
            tones.startTone(type, ms);
        } catch (Exception ignored) {
        }
    }

    /** Island look: the island grows with the alert. Corner look: a banner at the bottom. */
    private void alert(String title, String body, int color) {
        if (!"corner".equals(style) && canDraw()) {
            ensureIsland();
            island.expand(title, body, color, 10);
        } else {
            showBanner(title + (body.isEmpty() ? "" : " — " + body), color);
        }
    }

    private void ensureCover() {
        if (cover != null) return;
        cover = new FrameLayout(this) {
            @Override
            public boolean dispatchKeyEvent(KeyEvent e) {
                if (e.getAction() == KeyEvent.ACTION_DOWN) onCoverKey(e.getKeyCode());
                return true; // swallow every key while covered
            }
        };
        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] {Color.parseColor("#180E34"), Color.BLACK});
        cover.setBackground(bg);
        cover.setFocusable(true);
        cover.setFocusableInTouchMode(true);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER);
        coverCenter = text(20, Color.parseColor("#A08CFF"), true);
        coverTitle = text(64, Color.WHITE, true);
        coverText = text(24, Color.parseColor("#BEC3D2"), false);
        coverFoot = text(16, Color.parseColor("#6E7382"), false);
        for (TextView t : new TextView[] {coverCenter, coverTitle, coverText, coverFoot}) {
            t.setGravity(Gravity.CENTER);
            t.setPadding(dp(40), dp(8), dp(40), dp(8));
            col.addView(t);
        }
        cover.addView(col, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        WindowManager.LayoutParams lp = params(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT, true);
        wm.addView(cover, lp);
        cover.requestFocus();
    }

    /**
     * Staff unlock on the cover: number keys type the PIN, OK / Enter sends it to the server (each person's own PIN,
     * needs "Turn on with no charge"). If the server can't be reached, the shared offline exit PIN works for 10 minutes.
     */
    private void onCoverKey(int code) {
        if (code >= KeyEvent.KEYCODE_0 && code <= KeyEvent.KEYCODE_9) {
            pinBuf.append((char) ('0' + (code - KeyEvent.KEYCODE_0)));
            if (pinBuf.length() > 8) pinBuf.delete(0, pinBuf.length() - 8);
            showPinHint("Staff PIN: " + "••••••••".substring(0, pinBuf.length()) + "   then press OK");
            return;
        }
        if (code == KeyEvent.KEYCODE_DEL || code == KeyEvent.KEYCODE_BACK) {
            pinBuf.setLength(0);
            showPinHint(station);
            return;
        }
        if ((code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER || code == KeyEvent.KEYCODE_NUMPAD_ENTER) && pinBuf.length() >= 4 && !checkingPin) {
            final String pin = pinBuf.toString();
            pinBuf.setLength(0);
            checkingPin = true;
            showPinHint("Checking PIN…");
            new Thread(() -> {
                String problem = null;
                String name = "";
                boolean offline = false;
                try {
                    SharedPreferences p = Api.prefs(this);
                    JSONObject body = new JSONObject();
                    body.put("pin", pin);
                    body.put("action", "unlock");
                    body.put("minutes", 30);
                    Api.Result r = Api.call("POST", p.getString("server", "") + "/api/agent/unlock", p.getString("token", ""), body);
                    if (r.status == 200) name = r.json.optString("name", "");
                    else if (r.status >= 500) throw new Exception("server");
                    else problem = r.json.optString("message", "PIN not accepted");
                } catch (Exception e) {
                    offline = true;
                    if (pinHash.isEmpty() || !Api.sha256(pin).equals(pinHash)) problem = pinHash.isEmpty() ? "Server unreachable — no offline PIN set" : "Wrong PIN (offline)";
                }
                final String fProblem = problem, fName = name;
                final boolean fOffline = offline;
                ui.post(() -> {
                    checkingPin = false;
                    if (fProblem != null) {
                        showPinHint(fProblem);
                        return;
                    }
                    if (fOffline) unlockedUntil = SystemClock.elapsedRealtime() + 10 * 60_000L;
                    else lock = false; // the server turned the station on; the next poll confirms it
                    if (cover != null) cover.setVisibility(View.GONE);
                    alert("Unlocked — no charge", (fName.isEmpty() ? "" : fName + " · ") + (fOffline ? "10 minutes (offline)" : "30 minutes"), Color.parseColor("#38BDF8"));
                });
            }).start();
        }
    }

    private void showPinHint(String t) {
        if (coverFoot != null) coverFoot.setText(t);
    }

    private TextView text(int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setTextSize(sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return t;
    }

    private void showBanner(String msg, int color) {
        if (!canDraw()) return;
        if (banner == null) {
            LinearLayout box = new LinearLayout(this);
            box.setPadding(dp(18), dp(12), dp(18), dp(12));
            GradientDrawable bg = new GradientDrawable();
            bg.setColor(Color.argb(235, 20, 22, 30));
            bg.setCornerRadius(dp(12));
            box.setBackground(bg);
            bannerText = text(18, Color.WHITE, true);
            box.addView(bannerText);
            WindowManager.LayoutParams lp = params(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT, false);
            lp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
            lp.y = dp(40);
            banner = box;
            wm.addView(banner, lp);
        }
        ((GradientDrawable) banner.getBackground()).setStroke(dp(3), color);
        bannerText.setText(msg);
        banner.setVisibility(View.VISIBLE);
        ui.removeCallbacks(hideBanner);
        ui.postDelayed(hideBanner, 15000);
    }

    private final Runnable hideBanner = () -> {
        if (banner != null) banner.setVisibility(View.GONE);
    };

    private void turnScreenOff() {
        try {
            DevicePolicyManager dpm = (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
            if (dpm.isAdminActive(new ComponentName(this, AdminReceiver.class))) dpm.lockNow();
        } catch (Exception ignored) {
        }
    }

    private void removeAll() {
        for (View v : new View[] {dock, cover, banner, island}) {
            try {
                if (v != null) wm.removeView(v);
            } catch (Exception ignored) {
            }
        }
        dock = null;
        cover = null;
        banner = null;
        island = null;
    }
}
