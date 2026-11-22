# 08 — SONOFF BASICR4: setup with the eWeLink app and ZENAA GAMEHUB

This guide is for the **SONOFF BASICR4**. The same steps work for the **MINIR4**.

## First, the important difference

SONOFF's **DIY mode** (the open local API) officially covers only the older **BASICR3, RFR3, MINIR2, MINIR3** and **D1**. The **BASICR4 is not on that list.** It has no DIY mode and no ITEAD hotspot.

> **Recommended instead:** flash the BASICR4 with **Tasmota** ([doc 09](09-flash-tasmota-basicr4.md)). It takes about 20 minutes with a cheap USB adapter. Afterwards there is no eWeLink account, device key or developer app, and ZENAA finds the plug by itself. *(An earlier version of this guide said the R4 couldn't be flashed. That came from a report about the MINIR4; the BASICR4 has a working Tasmota template.)* Use the eWeLink method below only if you don't want to open the device.

What the BASICR4 *does* have is **eWeLink "LAN Control"**:

- The device obeys commands sent over your own Wi-Fi with **no internet**, as long as each command is **encrypted with the device's own key**.
- ZENAA GAMEHUB supports this as the plug type **"SONOFF R4 / eWeLink LAN (BASICR4, MINIR4)"**.
- You need two things from your eWeLink account, **once**: the **Device ID** and the **Device key**.

> If you chose *"SONOFF DIY mode"* for your BASICR4, connection fails with errors such as *HTTP 400 / 500*, *SONOFF error 401* or *unexpected answer*. That is expected. Switch the station to the **R4 / eWeLink LAN** type and follow this guide.

| Step | Where | Once or always |
|---|---|---|
| 1. Wire the BASICR4 to the TV/monitor | Electrician | Once |
| 2. Pair it in the eWeLink app and update its firmware | Phone | Once |
| 3. Turn on **LAN Control** | eWeLink app | Once |
| 4. Reserve its IP address | Router | Once |
| 5. Get the Device ID and Device key | PC (key tool) | Once |
| 6. Enter them in ZENAA and test | ZENAA | Once |
| Daily use | Automatic, local, no internet needed | Always |

---

## 1. Wiring (qualified electrician)

The BASICR4 is an **inline relay**. Mains power goes **in** one end and **out** the other.

- **Input (L, N):** from the wall supply.
- **Output (L, N):** to a socket or extension that the **TV or monitor** plugs into.
- **Do not power the PS5 through it.** The PS5 goes on its own socket (see doc 06, section 1).
- Stay within the current rating printed on the device (a TV uses only 50–250 W).
- Mount it inside a closed box, away from drinks and feet.
- Before going further, check the TV comes back on by itself after power is cut and restored (doc 06, section 1).

## 2. Pair with the eWeLink app

These are SONOFF's official steps for the BASICR4:

1. Install **eWeLink** (Play Store or App Store), create an account and sign in. Note the **email or phone** you used; step 5 needs it.
2. Make sure your **phone is on the same 2.4 GHz Wi-Fi** the plug will use. The BASICR4 does **not** work on 5 GHz.
3. Power on the BASICR4.
4. In the app tap **Scan** (or **＋ → Scan QR code**) and scan the **QR code on the BASICR4 body**, then choose **Add Device**.
5. **Press and hold the button for 5 seconds.** The blue LED should flash **two short + one long**, which means pairing mode.
6. The app searches for the device. Pick your **2.4 GHz Wi-Fi**, type its password, and wait for **"Added completely"**.
7. **Rename it** after the station, for example `PS-01 TV`.
8. Open the device → **⋯ (settings)** → **Firmware update** and install any update.

**BASICR4 blue LED meanings:**

| LED | Meaning |
|---|---|
| Steady on | Online |
| Flashes once | Offline (can't reach Wi-Fi) |
| Flashes twice | LAN connection active |
| Two short + one long | Pairing mode |
| Flashes three times | Updating firmware |
| Keeps flashing | Overheat protection, so check the load and ventilation |

- **Single press** of the button: switch on/off.
- **Hold 10 seconds:** factory reset. Then pair again from step 4.

### If pairing fails in the eWeLink app

| Problem | Fix |
|---|---|
| Device not found / stuck searching | Phone and plug must be on **2.4 GHz**. If the router uses one name for 2.4 and 5 GHz, create a separate 2.4 GHz network (e.g. `ZENAA-IOT`) or temporarily turn 5 GHz off. |
| LED doesn't show two short + one long | Hold the button for a full 5 s. If it was paired before, hold 10 s to reset, then 5 s. |
| "Failed to connect" / times out | Wrong Wi-Fi password, the network name has special characters, or the plug is too far from the router. Move closer for pairing. |
| App asks for location / nearby devices | Allow **Location** and **Nearby devices / Bluetooth** for eWeLink in phone settings, and turn on phone location. Android needs this to scan Wi-Fi. |
| Router has MAC filtering or client isolation | Allow the device and turn off client/AP isolation. Guest Wi-Fi often isolates devices. |
| "Device is offline" right after adding | Check the router gives it an address, and that the network allows the internet **during setup**. After setup ZENAA doesn't need internet. |

## 3. Turn on LAN Control

In eWeLink, open the device → **⋯ (settings)** → **LAN Control** → **On**. This lets the BASICR4 accept commands directly over your Wi-Fi. The LED flashing **twice** shows a LAN connection is active.

If you can't see *LAN Control*, update the firmware (step 2.8) and check again.

## 4. Give it a fixed IP address

1. Open your router's admin page and find the BASICR4 in the list of connected devices. Look for its MAC address, or a name like `ESP-xxxx` or `eWeLink_1000xxxxxx`. The router app's device list usually shows the newest device.
2. Create a **DHCP reservation / static lease** so it always gets the same address, e.g. `192.168.100.101` for PS-01.
3. Put a label with the station code and IP on the box.

The ZENAA mini PC and the BASICR4 must be on the **same network**. Guest networks won't work.

## 5. Get the Device ID and Device key

- **Device ID:** in eWeLink open the device → **⋯ → Device info / Settings**. It is **10 characters** and usually starts with `1000`, e.g. `1000a1b2c3`.
- **Device key:** not shown in the app. Get it once from your eWeLink account with ZENAA's key tool:

### 5a. Create your free eWeLink developer app (5 minutes)

1. Go to **https://dev.ewelink.cc** and sign in with the **same eWeLink account** as the app.
2. Become a developer (personal is fine), then **create an application** (any name, e.g. "ZENAA").
3. Copy its **App ID** and **App Secret**.

### 5b. Run the key tool on the PC where ZENAA's files are

Open PowerShell or Git Bash in the `zenaa-gamehub` folder:

```bash
node server/scripts/ewelink-keys.mjs --appid YOUR_APP_ID --secret YOUR_APP_SECRET --login you@example.com --country +233
```

For phone-number accounts use `--login 0241234567`. It asks for your eWeLink password (hidden, not saved) and prints something like:

```
• PS-01 TV  [BASICR4]
    Device ID : 1000a1b2c3
    Device key: 3f2a9c4e-....-....
```

**Keep the keys private.** Anyone on your Wi-Fi with a key can switch that device.

### If the key tool fails

| Message | Meaning / fix |
|---|---|
| `error 407` | Your developer app type isn't allowed to log in with a password. Check the app's type and permissions in dev.ewelink.cc, or create a new app. If it still fails, send me the full message. |
| `error 10001` / `401` | Wrong App ID or App Secret. |
| `error 10014` / `10011` | Wrong email/phone, country code or password. |
| `error 10004` | Wrong region. The tool retries automatically; if not, add `--region eu` (or `as`, `us`). |
| `Device key: (not provided…)` | eWeLink didn't return a key for that device. Send me the output and I'll look at another way. |
| `fetch is not defined` | Install Node.js 18 or newer. |

## 6. Connect it in ZENAA GAMEHUB

1. **Stations** → ✏️ on the station → **Smart plug (automatic power)**.
2. **Plug type:** **SONOFF R4 / eWeLink LAN (BASICR4, MINIR4)**.
3. **Plug IP address:** the reserved IP, e.g. `192.168.100.101`.
4. **Device ID** and **Device key:** from step 5. Leave **Channel** blank.
5. Press **Test ON**: the TV should switch on. Then press **Test OFF**.
   - Sometimes the device obeys but doesn't report whether it is on or off. Then *Test connection* says *"Connected, but this plug does not report its state"*. That is fine: ZENAA simply repeats the right command every minute.
6. **Save.** From now on:
   - a session start or resume switches the TV **on**;
   - an end, time running out or a pause switches it **off**;
   - a station with no session is switched **off** within a minute, even if someone presses the button on the device.

The key is stored only on the ZENAA server and is never shown again; the form says *"Saved — leave blank to keep it"*.

## 7. Errors in ZENAA and what they mean

| Message in ZENAA | Fix |
|---|---|
| *Plug not reachable (timed out)* | Wrong IP, device unpowered, not on the same network, or weak Wi-Fi. Ping the IP from the mini PC. |
| *HTTP 400/500 — usually a wrong device ID or device key, or LAN Control is off* | Re-check the ID and key from step 5, and that **LAN Control** is on (step 3). |
| *SONOFF answered error 401 (wrong device key)* | Wrong key. Run the key tool again; the key changes if the device is reset and re-paired. |
| *SONOFF answered error 404 (wrong device ID)* | Wrong Device ID. |
| *Could not read the answer — the device key is wrong* | Wrong key. |
| *Enter the device ID and device key* | One of the two fields is empty. |
| Works, then stops after a few days | The IP changed. Reserve it (step 4). |
| Stops after a factory reset or re-pairing | The device key changes on re-pairing. Run the key tool again and update the station. |

**Quick test from the mini PC:** `ping 192.168.100.101`. If ping fails, ZENAA can't reach the device either.

## 8. If the BASICR4 still won't work

The BASICR4's local protocol is not officially documented by SONOFF. ZENAA uses the method proven by open-source projects (SonoffLAN, homey-ewelink-lan), but it hasn't been tested on your exact unit yet. If it still fails after this guide, either option below will work for certain:

- Send me the **exact error message** from ZENAA (or a screenshot) and I'll adjust the driver.
- Flash it with **Tasmota** ([doc 09](09-flash-tasmota-basicr4.md)). This is the most reliable route.
- For further stations, buy a model with an open local API:
  - **SONOFF MINIR3 / MINIR2** (DIY mode, choose *SONOFF DIY mode* in ZENAA);
  - **Shelly Plus 1 / Shelly Plus Plug UK** (works locally out of the box, choose *Shelly Plus / Gen 2–3*).
