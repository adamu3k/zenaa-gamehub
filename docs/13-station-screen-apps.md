# 13 — Station screen apps: timer on the TV / PC, black screen when time is up

ZENAA has two small apps that show the player their remaining time **on the screen they are playing on**, and cover the screen when time is up. Both are free downloads from your own ZENAA server: **Integrations → Station screen apps**.

| App | For | What it does |
|---|---|---|
| **ZENAA TV** (`ZenaaTV.apk`) | Android TV / Google TV sets (Sony, TCL, Hisense, Philips, Xiaomi…), Android TV boxes | Timer **island** at the top centre **on top of the PS5 picture**, a warning before time runs out, a full black "Time is up" cover, and the option to switch the TV panel off. No smart plug needed. |
| **ZENAA Station** (`ZenaaStation.exe`) | Windows PC stations (PC gaming, or a PC driving a TV) | Timer island, warning, full-screen lock on every monitor (blocks Win key, Alt+Tab, Alt+F4), staff PIN unlock. Starts with Windows. |

Both apps keep counting down if the Wi-Fi drops, and lock at zero. If the server unpairs them, they ask to be paired again.

### The timer island

By default both apps show the timer as an **island**: a small black pill at the top centre of the screen, like a phone's dynamic island.

```
 ( ◔ PS-01        45:12        ☀ 31° )
```

| Part | Shows |
|---|---|
| Left | A ring that empties as time runs out (green → orange in the last 5 minutes → red in the last minute) and the station code. |
| Middle | Time left (or time played for open sessions). *PAUSED*, *Ready* or *Maintenance* when no session runs. The time blinks when it is low. |
| Right | The outside temperature with a weather sign, or the clock if weather is off. Red *offline* if the server can't be reached. |

The island **grows for 10 seconds** to show alerts: *Game on, Ama!*, *Time is almost up*, *Last minute*, staff messages. It never takes mouse clicks or remote presses.

**Settings → Station screen apps:**

- **Timer look:** *Island* (default) or *Corner box* (the older look).
- **Show the outside temperature:** the server asks the free Open-Meteo service every 15 minutes (no account; only the venue coordinates are sent). Set the venue latitude/longitude (default Accra). If the server has no internet the island shows the clock instead.

**Apple TV:** there is no Apple TV version. tvOS apps can't draw over another HDMI input (the PS5), so a timer on an Apple TV would only show when the Apple TV itself is on screen.

---

## About a PS5 app (PKG)

**Jailbroken PS4/PS5:** ZENAA now has a timer payload for jailbroken consoles — see **doc 16**. Everything below is about normal (retail) consoles.

**A ZENAA app cannot run on a retail PS5 itself.**

- A normal (retail) PS5 only runs software signed by Sony and installed from the PlayStation Store.
- "PKG" homebrew only installs on consoles **jailbroken** with exploits for old system software. Those consoles can't update and can't safely go online. Sony bans consoles caught running them, which ends online play (EA SPORTS FC, eFootball, CoD…) for a gaming centre.
- Sony also offers no API for third-party apps to show notifications or timers on the PS5 screen.

**What gives the same result, legally and reliably:**

1. **ZENAA TV on an Android/Google TV.** The TV draws the timer over the PS5's picture, and the cover hides the game when time is up.
2. **HDMI-CEC power linking.** On the PS5: **Settings → System → HDMI → Enable HDMI Device Link** (and *Link Power Off* where shown). When the TV switches off, whether by smart plug or by ZENAA TV, the PS5 goes to **rest mode** by itself, safely.
3. **A smart plug on the TV** (doc 06 / 11) for non-Android TVs.
4. **A staff message to the screen:** on the Stations page, click the **Screen** chip on a station card to send *"5 minutes left — top up at the counter"*.

---

## 1. Pair a screen (both apps)

1. **Stations → ✏️ (edit the station) → Station screen → Pair a screen.** A **6-digit code** appears. It is valid for 10 minutes and works once.
2. In the app, enter:
   - the **server address** shown above the code (e.g. `http://192.168.1.10:8080`);
   - the **code**.
3. The station card now shows a **Screen** chip, green when the app is online.

To **unpair** (e.g. the TV moved to another station): edit the station → **Unpair**, or use the PIN menu in the app.

### Settings → Station screen apps

| Setting | Effect |
|---|---|
| **Cover the screen when no session is running** | On: the screen shows *"See the counter to play"* until staff start a session. Off: the cover appears only when a paused session needs attention. |
| **Android TV: also switch the TV panel off when time is up** | ZENAA TV turns the panel off (standby) on top of the cover. With HDMI-CEC, the PS5 then rests too. |
| **Island size** | 40–100% of the full design (default **70%**). Same look, less of the game covered. Changes reach the screens within a few seconds. |
| **Shared exit PIN (backup)** | Staff normally use **their own PIN** (menu → My PIN) on the screens. This shared PIN also works on every screen, online or offline (offline: 10-minute unlock). Unlocks with it are recorded as *Shared exit PIN*. |

The warning time is the same as the staff alert (**Settings → Low-time alerts**, e.g. 5 and 1 minutes).

---

## 2. ZENAA TV (Android TV)

### Install

1. On the TV:
   - **Settings → Device preferences → Security & restrictions → Unknown sources**;
   - allow your file manager or browser. (On Google TV: **Settings → System → About → tap "Android TV OS build" 7 times** to unlock developer options first, if needed.)
2. Get the APK onto the TV, using any of these:
   - **Browser on the TV** (e.g. *Downloader* by AFTVnews): open `http://<server-ip>:8080/downloads/ZenaaTV.apk`;
   - **USB stick:** copy the file from a PC, then open it with a file manager on the TV;
   - **From a PC with ADB:** `adb connect <tv-ip>` then `adb install ZenaaTV.apk`.
3. Open **ZENAA TV** from the apps row.

### Permissions (once)

1. **Display over other apps.** Required to draw over the PS5 picture. Press **Open the permission screen** and turn it on for ZENAA TV.
   Many TVs hide this screen. Then do it from a PC on the same Wi-Fi:
   - TV: **Developer options → USB debugging / Network debugging** on.
   - PC (Android *platform-tools*):
     ```
     adb connect 192.168.1.50
     adb shell appops set com.zenaa.tv SYSTEM_ALERT_WINDOW allow
     ```
2. **Screen off (optional):** press **Allow screen off**. If nothing appears on your TV:
   ```
   adb shell dpm set-active-admin com.zenaa.tv/.AdminReceiver
   ```
3. **Pair** with the code (section 1).

The app starts by itself whenever the TV turns on.

### Using it

| Situation | What players see |
|---|---|
| Session running | Timer island at the top centre (or the corner box): green ring, turning orange/red and blinking in the last minutes. |
| Warning time reached | The island grows: *"Time is almost up — 05:00 left. Top up at the counter…"* (corner look: a banner). |
| Time is up / no session | Full black cover: centre name, **Time is up**, *"Please see the counter to play again."* (plus panel off, if enabled). |
| Staff message | The island grows for 10 s (corner look: a banner at the bottom for 15 s). |

**Staff unlock:** while the cover is shown, type **your staff PIN** with the remote's number keys and press **OK**. The station turns on with no charge for 30 minutes, recorded with your name, and the island shows **FREE 29:59**. Offline, the shared offline PIN unlocks for 10 minutes. See doc 19.

**Unpair:** open the ZENAA TV app, type the PIN, and press **Unpair this TV**.

### Will the timer show over the PS5 picture on my TV?

On most Android/Google TVs, yes: apps with *display over other apps* draw over every input, including HDMI. A few models put the HDMI picture on a layer above apps. On those, the timer only shows on the home screen. Test once: start a 2-minute session with the PS5 input on screen.

If it doesn't show, use **Screen off** (panel off at time-up still works) or a smart plug on the TV.

> Non-Android TVs (Samsung Tizen, LG webOS…) cannot install APKs. Use a smart plug on the TV, or switch the TV through Home Assistant (doc 11).
>
> An Android **box** (Mi Box, Chromecast) only shows its own output. It can't draw over a PS5 plugged into a different HDMI port of the TV.

### Build or update the APK yourself

On the dev PC (Docker Desktop running):

```powershell
powershell -ExecutionPolicy Bypass -File agents\android-tv\build-apk.ps1
```

It builds inside Docker (no Android Studio needed) and puts `ZenaaTV.apk` in `web\public\downloads`. Rebuild ZENAA (`docker compose up -d --build`) to serve it.

- The first build creates `agents\android-tv\zenaa-tv.keystore`. **Keep this file:** an update only installs over an existing app when it is signed with the same key.
- To use your own password, set `ZENAA_KEYSTORE_PASSWORD` before the first build.

---

## 3. ZENAA Station (Windows)

### Install

1. On the gaming PC, open `http://<server-ip>:8080/downloads/ZenaaStation.exe` (or copy it over by USB) and run it.
   - Windows SmartScreen may say *"Windows protected your PC"* because the app is not code-signed. Click **More info → Run anyway**.
2. Enter the server address and the 6-digit pairing code.
3. It adds itself to Windows start-up, so it starts with every boot.

It needs .NET Framework 4, which is built into Windows 8, 10 and 11.

### Using it

| What | Where / how |
|---|---|
| Timer | **Island** at the top centre (click-through, never blocks the game), or the **corner box** if Settings → Timer look = Corner (drag it anywhere). Orange/red blinking when time is low. |
| Lock | Covers every monitor when time is up or no session runs. Win key, Alt+Tab, Alt+Esc, Ctrl+Esc and Alt+F4 are blocked while locked. |
| Staff menu | **Ctrl + Shift + F12** (or right-click the tray icon) → **your staff PIN**. Options: **Unlock (free 30 min)** / **Lock again**, **Move timer** (corner look only), **Exit app**, **Unpair this PC**. Your PIN is checked by the server, which needs the "Turn on with no charge" permission. Offline, the shared offline PIN works. |
| Settings file | `%APPDATA%\ZenaaStation\config.txt` (server, token, dock corner). Delete it to start fresh. |

Ctrl+Alt+Del cannot be blocked by any normal app. For a fully locked-down kiosk, also give players a standard (non-admin) Windows account.

### Build it yourself

```cmd
agents\windows\build.cmd
```

This uses the C# compiler that comes with Windows and writes `web\public\downloads\ZenaaStation.exe`.

---

## 4. Troubleshooting

| Problem | Fix |
|---|---|
| *That code is wrong or has expired* | Codes last 10 minutes and work once: press **Pair a screen** again. |
| *Cannot reach the server* | Use the IP address of the mini PC with `:8080`, and keep the TV/PC on the same network. Test the address in the TV's browser. |
| *This screen was unpaired* | Someone pressed Unpair, or the station was deleted. Pair again. |
| Screen chip shows **Screen offline** | The app isn't running or lost Wi-Fi. Open the app; check the TV is not in deep sleep (Settings → Power → *Network standby / Quick start* on). |
| TV: nothing drawn over the PS5 | Grant *Display over other apps* (adb command above). Some TVs don't allow overlays on HDMI inputs: use screen-off or a plug. |
| TV: screen-off does nothing | Grant the device admin (adb command above) and tick the setting in ZENAA. Some TVs ignore it: use a smart plug. |
| TV: app stops after a while | Exclude ZENAA TV from "battery/memory optimisation" if your TV has it; it restarts on boot anyway. |
| PC: *No staff PIN set* when pressing Ctrl+Shift+F12 | Set **Settings → Station screen apps → Staff exit PIN**. |
| PC: SmartScreen blocks it | More info → Run anyway, or right-click → Properties → **Unblock**. |
| Lock covers the screen but a session is running | The session is **paused**: resume it at the counter. |
