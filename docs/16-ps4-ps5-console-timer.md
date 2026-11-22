# 16 — Timer on jailbroken PS4 and PS5 consoles

ZENAA can send a small timer program (an **ELF payload**) to a **jailbroken** PS4 or PS5. It runs in the background while people play and shows **PlayStation notifications over the game**:

| When | Notification |
|---|---|
| Session starts | *PS-01 \| Hi Ama — Game on! 45:00 to play \| 31°C Clear* |
| Every 10 minutes, then at 5 and 1 minute(s) left | *PS-01 \| 05:00 left — Top up at the counter to keep playing.* |
| Open session (pay at the end) | *Played 1:00:00* every 30 minutes |
| Staff sends a message (Screen chip on the station card) | *Message from the counter — Your friend is waiting* |
| Session ends | *PS-01 \| TIME IS UP — See the counter to play again* (repeated 3 times, 1 minute apart) |
| Session paused | *Session paused — Please see the counter.* |
| Server unreachable for 30 s | *ZENAA: cannot reach the server …* (it keeps trying) |

The payload **informs** the player. To actually stop play when time is up, keep a smart plug on the station (doc 06/11) and/or ZENAA TV on the TV (doc 13). With HDMI-CEC on, the console goes to rest mode when the TV turns off.

> **Retail (normal) consoles cannot run this.** It needs a console that is already jailbroken with an ELF loader running. Read the warning in section 5 before jailbreaking consoles used for online play.

---

## 1. What you need

| Console | Needs | ELF loader port |
|---|---|---|
| **PS5** | A jailbreakable firmware with **etaHEN** or **kstuff + elfldr** (ps5-payload-dev) loaded. | **9021** |
| **PS4** | **GoldHEN** (or another HEN) plus **elfldr** from ps4-payload-dev (the SDK's loader). | **9021** |

Check the loader works first: any "payload sender" tool on a PC/phone should be able to send a test payload to port 9021.

Also:

- The console and the ZENAA server on the **same network** (Wi-Fi or LAN).
- The **console IP**: PS Settings → Network → *View connection status*. Reserve it in the router (DHCP reservation) so it never changes.
- The **ZENAA server address** as the console sees it, e.g. `http://192.168.1.10:8080` (not `localhost`, not `https`).

---

## 2. Send the timer from the console's own browser (easiest)

No typing of IP addresses, no internet:

1. Jailbreak the console and start the ELF loader as usual.
2. On the console, open the **web browser** and go to **`http://<server-ip>:8080/ps`** (e.g. `http://192.168.1.10:8080/ps`). **Bookmark it.**
3. The first time, pick the **station**. PS4/PS5 and the console's IP are filled in automatically when possible (check them).
4. Type your **staff PIN** (menu → My PIN) and press **Send the timer**.
5. "ZENAA timer started" pops up. Close the browser and start the game.

The page remembers the station, console and IP **on that console**. After every restart it is: jailbreak → open the bookmark → PIN → **Send**.

The same page works from **any phone** on the Wi-Fi, but then type the console's IP yourself.

**Without internet / without updates:** the page and the timer only talk to the ZENAA server on your network. To stop a jailbroken console from updating itself, keep it off the internet:

- PS Settings → Network → Set Up Internet Connection → **Custom** → DNS **Manual**, primary DNS `0.0.0.0` (or your router's "block internet" for that device). The LAN, the `/ps` page and the timer keep working. Updates and PSN don't.
- Or block the console's internet in the router (parental controls / access control).
- Turn off automatic downloads: Settings → System → System Software → Automatic Updates → off.

## 2b. Send the timer from the counter (ZENAA on the PC)

1. Jailbreak the console and start the ELF loader as usual.
2. In ZENAA: **Stations → ✏️ (the console's station) → Station screen → "Jailbroken PS4 / PS5? Send the timer…"**
3. Choose **PS5** or **PS4**, type the **console IP**, keep port **9021**, check the **ZENAA address**.
4. Press **Send to PS5** (or PS4).

On the TV you should see **"ZENAA timer started"** within a few seconds. The station's screen badge turns **Online** after the first check-in.

ZENAA remembers the IP and address for each station in this browser, so next time it is one click.

**After every console restart** the payload is gone (that is how jailbreaks work). Run the jailbreak again, then press **Send** again — or set up autoload (next section).

Sending again while it is running is safe: the new copy replaces the old one.

---

## 3. Autoload (optional)

Press **Download .elf** instead of Send. The file (e.g. `zenaa-ps-01-ps5.elf`) already contains your server address and this station's token — **one file per station**; don't mix them up.

- **PS5 + etaHEN:** put the file where your etaHEN version autoloads payloads (see its readme; usually `/data/etaHEN/payloads/` or an `autoload` folder on USB), or send it with any payload sender.
- **PS4 + GoldHEN:** use your loader's autoload feature with the file, or send it with a payload sender to port 9021.

Keep downloaded files private: anyone with the file can read that station's timer state (nothing more — the token cannot start sessions, see money or customers).

---

## 4. Unpair / move to another station

- **Unpair:** Stations → ✏️ → Station screen → **Unpair**. The console shows *"this console was unpaired"* and the payload stops. Old downloaded `.elf` files for that station stop working too.
- **Move a console to another station:** Unpair the old station, then Send from the new station.

---

## 5. Important warning about jailbroken consoles

- A jailbroken console stays on old system software. It can't install system updates without losing the jailbreak.
- Many online games (EA SPORTS FC, eFootball, Call of Duty…) need the **latest system software** to play online. Sony can **ban consoles** detected running homebrew while online.
- For a gaming centre that relies on online play, the safe choice is: **retail consoles + ZENAA TV + smart plug**. Use this payload on consoles you have already decided to run jailbroken (offline / local play).
- ZENAA does not include, download or run any jailbreak or exploit. It only sends its own timer to a loader you started yourself.

---

## 6. Troubleshooting

| Message / symptom | Fix |
|---|---|
| *… refused port 9021: the ELF loader is not running* | Run the jailbreak again and start the ELF loader (etaHEN/elfldr). Check the port. |
| *No answer from 192.168.x.x:9021* / *Cannot reach …* | Wrong console IP, console off/rest mode, or a different network. Check PS Settings → Network. |
| *Server address must look like http://192.168.1.10:8080* | Type the server PC's network address with `http://` and the port; no path, no https. |
| *Use the server network address … not localhost* | You opened ZENAA on the server PC as `localhost`. Type its LAN IP instead (find it with `ipconfig` / `ip a`). |
| *The PS4/PS5 payload is missing from this server* | The image was built without the payloads: run `agents\console\build.ps1`, then `docker compose up -d --build`. |
| "ZENAA timer started" shows, then *cannot reach the server* | The console can't reach the server address: wrong IP, firewall on the server PC (allow port 8080), or guest Wi-Fi isolation on the router. |
| *ZENAA: this console was unpaired* | Station was unpaired (or the console belongs to another station now). Send again from the right station. |
| No notifications at all, even "timer started" | The loader didn't run it: try a different payload sender / loader version; check the console firmware is supported by your loader. |
| Notifications show but the game keeps running at 00:00 | Expected — the payload only informs. Add a smart plug or ZENAA TV to enforce. |

---

## 7. Build the payloads yourself

The source is `agents/console/zenaa.c` (one file for both consoles). It builds in Docker with the open-source **ps4-payload-sdk** and **ps5-payload-sdk**:

```
powershell -ExecutionPolicy Bypass -File agents\console\build.ps1
docker compose up -d --build
```

This writes `server/console/zenaa-ps4.elf` and `zenaa-ps5.elf`; the ZENAA image ships them and writes each station's settings into a 1 KB block inside the file when sending.

The payload asks `GET /api/agent/console` every 5 seconds (plain `key=value` lines, see doc 05).

---

## Why not a PKG app or an always-on-screen timer?

- A **PKG app** is paused by the system as soon as the player opens a game, so its timer would freeze. A background payload keeps running during games.
- Drawing a permanent clock **inside** the game picture needs system-level hooks that differ for every firmware and game, and can crash games. Notifications are built into the system and work in every game.
- An always-visible timer is what ZENAA TV (Android TV) and ZENAA Station (PC) do — see doc 13.
