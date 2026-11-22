# 12 — SONOFF with eWeLink: can we use just the IP address and device ID?

**Short answer:**

| Device type | IP + device ID only? |
|---|---|
| SONOFF in **DIY mode** (BASICR3, RFR3, MINIR2, MINIR3, D1) | **Yes** |
| SONOFF with **normal eWeLink firmware** (BASICR4, MINIR4 and most newer models) | **No.** The device rejects commands that are not encrypted with its own **device key**. |

For the second group, ZENAA now handles the key **for you**, so in practice you still type only the IP and device ID. There is also a no-key, no-IP option through the eWeLink cloud.

## Why the key is needed

When *LAN Control* is on in the eWeLink app, a SONOFF listens on port 8081 of your Wi-Fi.

- Every command must be encrypted (AES-128) with that device's key.
- Without the key, the device ignores the command.
- This stops anyone on your Wi-Fi from switching your TVs off.

The key is created when the device is added to your eWeLink account. It is stored in your account and is **not** shown in the eWeLink app.

DIY mode is SONOFF's official "open" mode. It turns encryption off, which is why IP + device ID is enough there.

## Your options, best first

| Option | Typing needed | Internet needed | Works for |
|---|---|---|---|
| **A. Import your eWeLink account once (recommended)** | IP + device ID, or pick from a list | Only for the one-time import | Every SONOFF with LAN Control |
| **B. eWeLink cloud plug type** | Pick the device from a list — **no IP, no key** | Yes, always | Every device in your eWeLink account |
| C. DIY mode (R3 / MINI models) | IP + device ID | No | BASICR3, RFR3, MINIR2/R3, D1 |
| D. Flash Tasmota | IP (or press **Find**) | No | ESP-based devices (doc 09 / doc 11) |

---

## Option A — Import your eWeLink account (fills in every key)

### A1. Get a free developer App ID (one time, 5 minutes)

1. Go to **https://dev.ewelink.cc** and sign in with the **same eWeLink account** as the eWeLink app on your phone.
2. Become a developer (personal is fine), then **create an application** (any name, e.g. *ZENAA*).
3. In ZENAA open **Integrations → eWeLink / SONOFF account** and press **Copy** next to the Redirect URL. It looks like
   `http://192.168.1.10:8080/api/integrations/ewelink/callback`.
4. Back in dev.ewelink.cc, open your app (App Management → your app → edit) and paste it as the **Redirect URL** (sometimes "Callback URL"). Save.
5. Copy the app's **App ID** and **App Secret**.

> **The Redirect URL must match exactly** the address you use to open ZENAA, including `http://`, the IP or name, and `:8080`. If you open ZENAA at `http://localhost:8080` on the server PC, register `http://localhost:8080/api/integrations/ewelink/callback` and sign in from that PC. You can add both addresses if the developer site allows more than one.

### A2. Sign in with eWeLink in ZENAA

1. **Integrations → eWeLink / SONOFF account.**
2. Paste the **App ID** and **App Secret**.
3. Press **Sign in with eWeLink**. eWeLink's own sign-in page opens.
4. Sign in with your eWeLink email or phone and password (on eWeLink's page, not in ZENAA), and allow access.
5. You come back to ZENAA with *"Signed in to eWeLink — imported N device(s)"* and every device listed with its **device ID**.

- ZENAA keeps the **device keys on the server**. They are never shown or sent to browsers.
- ZENAA never sees your eWeLink password.
- Sign in within a few minutes of pressing the button. The link expires after 15 minutes, and the code eWeLink sends back lasts 30 seconds, so don't stop halfway.

**Why not just type the password into ZENAA?** Free developer App IDs aren't allowed to sign in with a password: eWeLink answers **error 407** (*"the path of request is not allowed with appid"*). *Sign in with eWeLink* (OAuth 2.0) is the method eWeLink allows for these apps. The old email + password form is still under **"Other way"** for App IDs that allow it.

### A3. Find their IP addresses (optional)

Press **Find their IP addresses**. ZENAA scans your Wi-Fi for SONOFFs (port 8081) and tries each imported key until one fits. The IP column fills in.

### A4. Connect a station

**Stations → ✏️ → Plug type: SONOFF eWeLink LAN.**
1. In **From your eWeLink account**, pick the device. The device ID and IP fill in.
2. Leave **Device key** blank. ZENAA adds the key when you save.
3. Press **Test ON / Test OFF**.

---

## Option B — eWeLink cloud (no key, no IP)

After the import (A1–A2), choose **Plug type: eWeLink cloud** and pick the device. That's all.

- ZENAA switches the device through eWeLink's servers, exactly like the eWeLink app does.
- This works even when **LAN Control is missing or unreliable**.

**Trade-offs:**
- It needs **internet** at the shop. When the internet is down, sessions still work, but plugs won't switch until it's back.
- Each switch takes about 1–2 seconds.

ZENAA renews the eWeLink sign-in by itself. If eWeLink ever ends it (password changed, about every 60 days), you'll see *"The eWeLink sign-in has expired"*: press **Sign in with eWeLink** again.

---

## Errors

| Message | Meaning / fix |
|---|---|
| *eWeLink sign-in failed (error 10014 / 10011 / 10003)* | Wrong email/phone, country code or password. |
| *(error 10001 / 401)* | Wrong App ID or App Secret. |
| *(error 407) … the path of request is not allowed with appid* | Normal for free developer App IDs: they can't sign in with a password. Use **Sign in with eWeLink** (A2). |
| eWeLink's page says the redirect address is wrong / invalid, or nothing happens after signing in | The **Redirect URL** in dev.ewelink.cc must be exactly the one ZENAA shows (A1, step 3–4). Open ZENAA at that same address. |
| *The code expired (it lasts 30 seconds)* / *link is not valid any more* | Press **Sign in with eWeLink** again and finish the sign-in in one go. |
| *Cannot reach the eWeLink cloud* | The mini PC has no internet. |
| *Signed in, but could not list devices* | Temporary eWeLink problem: try again later. |
| *Enter the device key, or import your devices once…* | That device ID isn't in the import: re-import, or check the ID. |
| *SONOFF answered error 401 (wrong device key)* | The device was re-paired in eWeLink (it got a new key): **import again**. |
| *…wrong device ID, or LAN Control is off* | Turn on **LAN Control** in the eWeLink app (device → ⚙ → LAN Control), and check the ID. |
| *eWeLink error 4002 — the device is offline* (cloud) | The plug has no power or Wi-Fi. |
| *The eWeLink sign-in has expired* | Import again (Integrations → eWeLink). |
| *Find their IP addresses* finds *unknown eWeLink device* | Something answers on 8081 but no imported key fits. It may be a device in another account, or one re-paired since the import. |
