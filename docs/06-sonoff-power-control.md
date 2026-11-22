# 06 — SONOFF smart plugs: automatic station power

> **v0.4:** more plug types (eWeLink cloud, ESPHome, Home Assistant, Custom HTTP / DIY) and a model-by-model table are in **[doc 11](11-smart-devices-catalog.md)**. SONOFF without typing device keys: **[doc 12](12-ewelink-without-device-key.md)**. Timer on the TV instead of (or as well as) a plug: **[doc 13](13-station-screen-apps.md)**.


ZENAA GAMEHUB can switch each station's power through a smart plug on your Wi-Fi:

- When a session **starts or resumes**, the station turns **ON**.
- When the session **ends**, the time **runs out**, or it is **paused**, the station turns **OFF**.

Nobody can keep playing after their time is up, and staff don't have to walk around switching screens.

This guide covers what to switch, what to buy, how to set it up and how to test it.

---

## 1. The most important decision: switch the **TV**, not the PS5

**Put the smart plug on the TV or monitor. Plug the PS5 straight into the wall.**

| | Plug on the TV/monitor ✅ | Plug on the PS5 ❌ |
|---|---|---|
| Stops play when time ends | Yes: no picture, so nobody can play | Yes |
| Risk to the console | None | Cutting power while it runs can corrupt data. The PS5 then runs "PS5 wasn't turned off properly" checks, and repeated cuts risk the system storage. |
| Downloads/updates at night | Still work (PS5 in rest mode) | Interrupted |
| Start-up delay for the next customer | Instant (TV on in ~2 s) | 20–30 s boot |

Recommended PS5 settings (*Settings → System → Power Saving*):

- **Set Time Until PS5 Enters Rest Mode → During Media Playback / While Playing Games:** 1–2 hours. An idle console then rests by itself.
- **Features Available in Rest Mode → Stay Connected to the Internet:** On, so updates download overnight.
- *Settings → System → HDMI → Enable HDMI Device Link:* **Off.** The TV switching off then never sends the PS5 to rest in the middle of a game.

### Check this before buying plugs for every station

Many TVs stay in **standby** when power comes back on, instead of switching on. Test each TV model:

1. Unplug the TV at the wall while it is **on**, wait 10 seconds, and plug it back in.
2. **If the picture comes back by itself,** the TV is ready for a smart plug.
3. **If it stays in standby,** look in the TV menu for a setting named **"Power On Behaviour"**, **"Auto Power On"**, **"Power restore: Last state"** or **"Instant On"**. Some TVs hide it in a *hotel mode* or *installer* menu, so search your model online.
4. **If the TV has no such setting,** use a **computer monitor** (they almost always switch on when power returns) or a different TV model.

---

## 2. Which device to buy

All of these work locally on your network. **None of them need the internet or the eWeLink cloud** once set up.

| Device | Type | Fitting | In ZENAA choose | Notes |
|---|---|---|---|---|
| **SONOFF S26R2 / S40 / S60** smart plug, **UK (Type G) version** for Ghana | Plug-in socket adapter | Plug in, no electrician | *SONOFF (DIY / LAN mode)*, or *Tasmota* if flashed | Easiest. Check the box/listing says **DIY mode** or **LAN control**. |
| **SONOFF MINI R2 / R3**, **BASIC R3** | Inline relay inside the socket box or extension | **Electrician** wires it in | *SONOFF DIY mode* or *Tasmota* | Neat and hidden. These are SONOFF's official DIY-mode models. |
| **SONOFF BASICR4 / MINIR4** | Inline relay | **Electrician** | *SONOFF R4 / eWeLink LAN* | **No DIY mode.** Best: flash **Tasmota** ([doc 09](09-flash-tasmota-basicr4.md)). Without flashing: eWeLink LAN Control with the device key ([doc 08](08-sonoff-basicr4.md)). |
| **SONOFF 4CH** | 4 relays in one box | Electrician | Same, plus **Channel** = 0–3 | One box can serve four stations' screens. |
| SONOFF flashed with **Tasmota** firmware | Any of the above | As above | *SONOFF flashed with Tasmota* | **Most reliable** (see section 5). |
| **Shelly Plus Plug UK / Shelly Plus 1** (not SONOFF) | Plug / inline | As above | *Shelly Plus / Gen 2–3* | Works locally straight out of the box. A good backup if a SONOFF model lacks DIY mode. |

**Power rating:** a TV uses 50–250 W, and every plug above handles 2,000 W or more, so there is plenty of headroom.

**Shopping list per station:**
- 1 smart plug (UK 3-pin).
- The TV/monitor plugs into the smart plug.
- The PS5 goes on a surge-protected socket.

**For the whole venue:**
- A **UPS** for the mini PC and the Wi-Fi router. The plugs need both to be alive.
- A good **2.4 GHz** Wi-Fi access point.

---

## 3. Network setup (do this first)

1. **2.4 GHz Wi-Fi.** SONOFF devices only use 2.4 GHz. If your router merges 2.4 and 5 GHz under one name, create a separate 2.4 GHz network, for example `ZENAA-IOT`.
2. **Same network as the mini PC.** The plugs and the ZENAA server must reach each other. Guest networks with "client isolation" will **not** work.
3. **Give every plug a fixed address.** In the router, use **DHCP reservation / static lease** to reserve an IP for each plug, for example `192.168.1.101` for PS-01 and `192.168.1.102` for PS-02. ZENAA talks to the plug by this address. If it changes, power control stops.
4. **Label everything.** Put a sticker with the station code and IP on each plug.
5. **Strong signal.** Plugs behind metal TV stands lose signal. If *Test connection* is slow or fails sometimes, add an access point or move the router.
6. **Optional: block the plugs from the internet** in the router. ZENAA does not need them to reach the cloud, and it is more secure.

---

> **BASICR4 owners: use [doc 09](09-flash-tasmota-basicr4.md) (Tasmota, recommended) or [doc 08](08-sonoff-basicr4.md) (eWeLink, no flashing).**

## 4. Option A: SONOFF DIY (LAN) mode, no firmware change

DIY mode makes the SONOFF accept commands over your LAN on **port 8081**. ZENAA uses SONOFF's official DIY API. It sends `POST http://<ip>:8081/zeroconf/switch` with `{"deviceid":"…","data":{"switch":"on"}}`, and reads the state with `/zeroconf/info`.

### Step by step

1. **Update the firmware first.** Pair the device in the **eWeLink** app once and install the latest firmware (*device → ⋯ → Firmware update*). Write down the **Device ID** (*device → ⋯ → Device info*), a 10-character code like `1000a1b2c3`.
2. **Enter DIY mode.** The exact sequence depends on the model and firmware, so check the DIY-mode page for your model ([help.sonoff.tech — DIY mode](https://help.sonoff.tech/docs/DIY-MODE-API-PROTOCOL)). On R3-generation devices with firmware 3.6 or newer it is usually:
   - Hold the button **5 s** until the LED blinks quickly, then hold it **5 s again** until the LED shows a *short-short-long* pattern.
   - The plug creates a Wi-Fi network called **`ITEAD-xxxxxxxxxx`** (password **`12345678`**). Join it with your phone.
   - Open **http://10.10.7.1** in the phone browser, enter your 2.4 GHz Wi-Fi name and password, and save.
3. **Find its IP.** In the router's list of connected devices, look for **`eWeLink_<deviceid>`**. Reserve that IP (section 3).
4. **Test from the mini PC.** This should answer `"error":0` and show `"switch":"on"` or `"off"`:
   ```bash
   curl -X POST http://192.168.1.101:8081/zeroconf/info -H 'Content-Type: application/json' -d '{"deviceid":"","data":{}}'
   ```
5. **Make it start OFF after a power cut** (recommended). ZENAA switches it on again within a minute if a session is running:
   ```bash
   curl -X POST http://192.168.1.101:8081/zeroconf/startup -H 'Content-Type: application/json' -d '{"deviceid":"","data":{"startup":"off"}}'
   ```

> While DIY mode is on, the eWeLink app usually can't control the device. That is expected: ZENAA is now in charge.

---

## 5. Option B: Tasmota firmware (most reliable)

Tasmota is free, open firmware with a simple local web API. ZENAA sends `GET http://<ip>/cm?cmnd=Power On`. It never changes behaviour with cloud updates.

1. **Flash Tasmota.**
   - ESP32-based SONOFF models can be flashed over USB-serial with the web installer at **tasmota.github.io/install**. Step-by-step for the BASICR4: **[doc 09](09-flash-tasmota-basicr4.md)**.
   - Older ESP8266 models (S26R2, MINI R2, BASIC R2) need the case opened and a USB-serial adapter.
   - **Disconnect mains power while flashing.** If you are not comfortable doing this, buy pre-flashed Tasmota plugs or use Shelly (section 2).
2. Join the `tasmota-xxxx` Wi-Fi with your phone, open `192.168.4.1` and enter your Wi-Fi details.
3. Open the plug's web page and set *Configuration → Configure Other → Web Admin Password*. Enter the same password in ZENAA (username `admin`).
4. Open *Console* and run these once:
   ```
   PowerOnState 0
   SetOption65 1
   ```
   - `PowerOnState 0` makes the plug start OFF after a power cut.
   - `SetOption65 1` stops quick power cycles from resetting the plug.
5. Reserve the IP in the router (section 3).

---

## 6. Connecting it in ZENAA

1. **Stations** → click the ✏️ pencil on a station → scroll to **Smart plug (automatic power)**.
2. **Plug type:** *SONOFF (DIY / LAN mode)*, *SONOFF flashed with Tasmota*, *Shelly (Gen 1)* or *Shelly Plus / Gen 2–3*.
3. **Plug IP address:** for example `192.168.1.101`.
   - **Device ID:** for SONOFF DIY.
   - **Channel:** only for multi-relay devices (4CH: 0–3).
   - **Username / password:** only for Tasmota or Shelly Gen 1 with a password set.
4. Press **Test connection**, then **Test ON** and **Test OFF**, and watch the TV. Then press **Save**.
5. **Settings → Smart plugs:**
   - **Switch off after session ends (seconds):** default 10. Players see the end screen first.
   - **Switch off while paused:** default on.
   - **Every minute, switch off stations that have no session:** default on. This stops someone switching a TV on by hand to play for free.
6. **Users & roles:** the permission *Switch station power by hand* (`stations.power`) lets a person use the power button on the station card. Managers and admins have it by default.

### What you will see

Each station card shows a chip:
- **Power on** (green), **Power off** (grey) or **Plug offline** (red).
- Hover over **Plug offline** to see the reason.
- Clicking the chip switches the plug by hand (with permission).

### Exactly how it behaves

| Situation | Plug |
|---|---|
| Session started or resumed | ON immediately |
| Session paused | OFF (or stays on if you untick *Switch off while paused*) |
| Session ended or time ran out | OFF after the delay (default 10 s) |
| Station has no session and someone presses the plug's button | Back OFF within a minute (enforcement) |
| Station set to **Maintenance** | Left alone. Use this to test a console or TV by hand. |
| Manual switch with the chip | Obeyed, but enforcement may switch it back. The message tells you when; use Maintenance to keep it. |
| Plug unreachable | **Billing carries on normally.** A red *Plug offline* chip and an alert appear, and it is retried every minute. |
| Server restarted or power cut | Sessions are paused at the moment the server stopped. Plugs start OFF (if you set the start-up state) and are corrected within a minute of the server returning. |

---

## 7. Electrical safety

- **Inline relays (MINI, BASIC, 4CH) carry mains voltage.** Have a qualified electrician install them inside a proper enclosure.
- Stay well under each device's current rating. Never chain extension boards.
- Put the mini PC and the router on a **UPS**. Without the server and Wi-Fi, plugs can't be controlled.
- Keep plugs and wiring away from drinks and where customers sit.

---

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| *Plug not reachable (timed out)* | Wrong IP, plug on another network/guest Wi-Fi, weak signal, or plug unpowered. Ping the IP from the mini PC. |
| SONOFF answers but *error 401* / DIY | DIY/LAN mode is not active. Repeat section 4, step 2. |
| *The plug sent an unexpected answer* | Wrong plug type selected (e.g. Tasmota chosen for a DIY-mode SONOFF). |
| Works, then stops after some days | The IP changed. Reserve it in the router (section 3). |
| TV doesn't come on when the plug switches on | The TV goes to standby after power returns. See the check in section 1. |
| 4CH: wrong screen switches | Set **Channel** to the right outlet (0, 1, 2 or 3). |
| Tasmota: *The plug refused the username/password* | Enter the web admin password in the station form (the username is `admin`). |

Quick manual test from the mini PC:

```bash
# SONOFF DIY
curl -X POST http://IP:8081/zeroconf/switch -H 'Content-Type: application/json' -d '{"deviceid":"","data":{"switch":"on"}}'
# Tasmota
curl "http://IP/cm?cmnd=Power%20On"
# Shelly Gen 2/3
curl "http://IP/rpc/Switch.Set?id=0&on=true"
```

---

## 9. Recommended roll-out

1. Buy **one** plug and test it with **one** TV for a full day: start, pause, end and power-cut tests.
2. Confirm the TV comes back on by itself (section 1).
3. Then buy plugs for every station, reserve their IPs, label them and configure each station.
4. Turn on *Every minute, switch off stations that have no session* once everything is stable.
