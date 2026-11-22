package com.zenaa.tv;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.SystemClock;
import android.text.TextUtils;
import android.view.View;

/**
 * The "island": a black pill at the top centre of the TV, like a phone's dynamic island.
 *   [ progress ring · PS-01 ]   45:12   [ ☀ 31° ]
 * It grows for a few seconds to show alerts (time almost up, staff messages) and then shrinks back.
 */
public class IslandView extends View {
    static final float COMPACT_W = 300, COMPACT_H = 44, WIDE_W = 460, WIDE_H = 112;

    private final float baseD; // px per dp
    private float d; // px per dp × island size from Settings
    private float scale = 0.7f;
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF r = new RectF();

    String station = "", time = "--:--", right = "", rightIcon = "";
    int accent = Color.parseColor("#7C5CFF"), timeColor = Color.WHITE;
    float progress = -1f;
    boolean offline;
    private String exTitle = "", exBody = "";
    private int exColor = Color.WHITE;
    private long expandUntil = 0;
    private float curW, curH;

    public IslandView(Context c) {
        super(c);
        baseD = c.getResources().getDisplayMetrics().density;
        d = baseD * scale;
        curW = COMPACT_W * d;
        curH = COMPACT_H * d;
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeCap(Paint.Cap.ROUND);
    }

    /** Settings → Island size (0.4–1.0). Returns true when the size changed (the window must be resized). */
    boolean setScale(float s) {
        s = Math.max(0.4f, Math.min(1f, s));
        if (Math.abs(s - scale) < 0.01f) return false;
        scale = s;
        d = baseD * s;
        curW = COMPACT_W * d;
        curH = COMPACT_H * d;
        invalidate();
        return true;
    }

    int maxWidthPx() {
        return Math.round(WIDE_W * d) + 4;
    }

    int maxHeightPx() {
        return Math.round(WIDE_H * d) + 4;
    }

    void expand(String title, String body, int color, int seconds) {
        exTitle = title == null ? "" : title;
        exBody = body == null ? "" : body;
        exColor = color;
        expandUntil = SystemClock.elapsedRealtime() + seconds * 1000L;
        invalidate();
    }

    static String weatherGlyph(String icon) {
        switch (icon == null ? "" : icon) {
            case "sun": return "☀";
            case "moon": return "☾";
            case "partly": return "⛅";
            case "rain": return "☔";
            case "storm": return "⚡";
            case "snow": return "❄";
            case "fog": return "≈";
            default: return "☁";
        }
    }

    @Override
    protected void onDraw(Canvas c) {
        boolean expanded = SystemClock.elapsedRealtime() < expandUntil;
        float tw = (expanded ? WIDE_W : COMPACT_W) * d, th = (expanded ? WIDE_H : COMPACT_H) * d;
        boolean animating = Math.abs(tw - curW) > 0.5f || Math.abs(th - curH) > 0.5f;
        if (animating) {
            curW += (tw - curW) * 0.22f;
            curH += (th - curH) * 0.22f;
        }
        float left = (getWidth() - curW) / 2f;
        r.set(left, 1, left + curW, 1 + curH);
        float rad = Math.min(curH / 2f, 30 * d);
        fill.setColor(Color.argb(250, 0, 0, 0));
        c.drawRoundRect(r, rad, rad, fill);
        stroke.setStrokeWidth(1.2f * d);
        stroke.setColor((accent & 0x00FFFFFF) | 0x46000000);
        c.drawRoundRect(r, rad, rad, stroke);
        c.save();
        c.clipRect(r);
        drawRow(c);
        float t = (curH - COMPACT_H * d) / ((WIDE_H - COMPACT_H) * d);
        if (t > 0.35f) drawExpanded(c, Math.min(1f, (t - 0.35f) / 0.65f));
        c.restore();
        if (animating || expanded) postInvalidateOnAnimation();
    }

    private float centerText(Paint p, float cy) {
        Paint.FontMetrics fm = p.getFontMetrics();
        return cy - (fm.ascent + fm.descent) / 2f;
    }

    private void drawRow(Canvas c) {
        float cy = r.top + COMPACT_H * d / 2f;
        // Left: progress ring + station code
        float ring = 22 * d, rx = r.left + 13 * d, ry = cy - ring / 2f;
        RectF rr = new RectF(rx, ry, rx + ring, ry + ring);
        stroke.setStrokeWidth(3 * d);
        stroke.setColor(Color.argb(60, 255, 255, 255));
        c.drawOval(rr, stroke);
        if (progress > 0.004f) {
            stroke.setColor(accent);
            c.drawArc(rr, -90, 360f * progress, false, stroke);
        }
        fill.setColor(accent);
        c.drawCircle(rx + ring / 2f, cy, 3 * d, fill);
        text.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        text.setTextSize(10 * d);
        text.setColor(Color.rgb(160, 170, 185));
        c.drawText(station, rx + ring + 7 * d, centerText(text, cy), text);
        // Centre: time
        text.setTextSize((time.length() > 8 ? 17 : 21) * d);
        text.setColor(timeColor);
        float tw = text.measureText(time);
        c.drawText(time, r.left + (r.width() - tw) / 2f, centerText(text, cy), text);
        // Right: weather / clock / offline
        text.setTextSize(13 * d);
        text.setColor(offline ? Color.rgb(239, 68, 68) : Color.rgb(225, 230, 240));
        float w = text.measureText(right);
        float x = r.right - 16 * d - w;
        c.drawText(right, x, centerText(text, cy), text);
        if (!rightIcon.isEmpty()) {
            text.setTypeface(Typeface.DEFAULT);
            text.setTextSize(14 * d);
            text.setColor(offline ? Color.rgb(239, 68, 68) : Color.rgb(253, 186, 69));
            float iw = text.measureText(rightIcon);
            c.drawText(rightIcon, x - iw - 3 * d, centerText(text, cy), text);
        }
    }

    private void drawExpanded(Canvas c, float alpha) {
        int a = Math.round(255 * alpha);
        float x = r.left + 22 * d, y = r.top + COMPACT_H * d + 2 * d, w = r.width() - 44 * d;
        fill.setColor(Color.argb(a / 4, 255, 255, 255));
        c.drawRect(x, y - 3 * d, x + w, y - 3 * d + Math.max(1, d / 2), fill);
        text.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        text.setTextSize(15 * d);
        text.setColor((exColor & 0x00FFFFFF) | (a << 24));
        c.drawText(TextUtils.ellipsize(exTitle, new android.text.TextPaint(text), w, TextUtils.TruncateAt.END).toString(), x, y + 18 * d, text);
        text.setTypeface(Typeface.DEFAULT);
        text.setTextSize(12.5f * d);
        text.setColor(Color.argb(a, 200, 205, 215));
        // Up to two lines of body text
        android.text.TextPaint tp = new android.text.TextPaint(text);
        String body = exBody;
        int n = tp.breakText(body, true, w, null);
        String l1 = body.substring(0, n), rest = body.substring(n);
        if (!rest.isEmpty()) {
            int sp = l1.lastIndexOf(' ');
            if (sp > 0) {
                rest = body.substring(sp + 1);
                l1 = body.substring(0, sp);
            }
        }
        c.drawText(l1, x, y + 40 * d, text);
        if (!rest.isEmpty()) c.drawText(TextUtils.ellipsize(rest, tp, w, TextUtils.TruncateAt.END).toString(), x, y + 58 * d, text);
    }
}
