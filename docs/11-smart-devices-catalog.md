# 11 — Smart devices catalog: every SONOFF board, other brands, DIY and custom integrations

ZENAA switches each station's **TV / monitor** on when a session starts and off when it ends (doc 06 explains the rules). This guide lists **which device works with which plug type**, how to add brands ZENAA doesn't talk to directly, and how to build your own relay.

> ⚠️ **Put the relay on the TV, not the PS5.** Cutting power to a running PS5 can corrupt its storage. With HDMI-CEC on, the PS5 goes to rest by itself when the TV turns off (doc 13).
>
> ⚠️ **Mains electricity kills.** Inline relays (BASIC, MINI, Shelly 1…) must be wired by a qualified electrician, in an enclosure, with the right cable and fuse. Plug-in sockets (S26, Plus Plug S, Tapo…) need no wiring.

The same table is in the app: **Integrations → Supported devices**. On a station, **Stations → ✏️ → "Help me choose — my device is…"** selects the right plug type for you.

---

## 1. Plug types in ZENAA

| Plug type | Talks to | Needs | Internet? |
|---|---|---|---|
| **Tasmota / OpenBeken** | Any ESP8266/ESP32 device flashed with Tasmota; BK7231 (Tuya) devices flashed with OpenBeken | IP address | No |
| **SONOFF DIY mode** | BASICR3, RFR3, MINI/MINIR2, MINIR3, D1 in DIY mode | IP + device ID | No |
| **SONOFF eWeLink LAN** | SONOFF with stock firmware and *LAN Control* on (BASICR4, MINIR4, S-series, POWR, DUALR3…) | IP + device ID (+ key, filled in automatically after an eWeLink import) | No |
| **eWeLink cloud** | **Any** device in your eWeLink account | Device ID only (after an eWeLink import) | **Yes** |
| **Shelly Gen 1** | Shelly 1, 1PM, Plug S (1st gen) | IP | No |
| **Shelly Plus / Pro / Gen 3** | Plus Plug S, Plus 1/1PM, 1 Gen3, Mini Gen3, Pro… | IP | No |
| **ESPHome** | ESPHome devices with `web_server:` | IP + switch ID | No |
| **Home Assistant** | Anything HA controls: TP-Link Kasa/Tapo, Tuya/Smart Life, Meross, Broadlink, Xiaomi, IKEA/Hue Zigbee, Matter, smart TVs | HA address + entity ID + token | No (local) |
| **Custom HTTP** | Your own board, a Raspberry Pi script, Node-RED, Hubitat, webhooks | ON URL + OFF URL (+ status URL) | Depends |

**Find button:** Tasmota and Shelly plugs can be found automatically. The station form's **Find** scans your network.

**Multi-channel devices** (DUALR3, 4CH, Shelly 2PM/Pro 4PM) can run several stations from one box. Give each station the same IP and a different **Channel**:

| Device type | Channel numbers |
|---|---|
| Tasmota | 1–4 |
| eWeLink | 0–3 |
| Shelly | 0–3 |

---

## 2. SONOFF models

| Model | Best plug type | Also works | Notes |
|---|---|---|---|
| **BASICR4** | Tasmota (flash) | eWeLink LAN, eWeLink cloud | ESP32-C3. Flash guide: doc 09. No-flash guide: doc 08. |
| BASICR3 | **DIY mode** | Tasmota, cloud | Easiest: DIY mode needs no key and no flashing. |
| BASICR2 / BASIC | Tasmota | cloud | ESP8266, classic Tasmota device. |
| RFR3 | DIY mode | Tasmota, cloud | |
| MINI / MINIR2 | DIY mode | Tasmota, cloud | Old MINI: DIY jumper. |
| MINIR3 | DIY mode | Tasmota, cloud | |
| MINIR4 | eWeLink LAN | cloud, (Tasmota on some batches) | Some MINIR4 batches use secure boot and cannot be flashed. |
| MINIR4M (Matter) | Home Assistant (Matter) | cloud | |
| D1 Dimmer | DIY mode | cloud | Used as on/off. |
| S26R2 / S26 plug | Tasmota (serial) | eWeLink LAN, cloud | No wiring — plug the TV into it. |
| S31 / S31 Lite (US) | Tasmota | eWeLink LAN, cloud | |
| S40 / S60 plugs | eWeLink LAN | cloud | Check the chip before trying to flash. |
| POWR2 | Tasmota | eWeLink LAN, cloud | |
| POWR3 / POWR316 / POWR320D | Tasmota | eWeLink LAN, cloud | ESP32. |
| DUALR3 | Tasmota | eWeLink LAN, cloud | 2 stations from one device. |
| 4CHR3 / 4CHPROR3 | Tasmota | eWeLink LAN, cloud | 4 stations from one box: ideal behind a row of TVs. |
| TH10/TH16/THR316/THR320 | Tasmota | eWeLink LAN, cloud | |
| ZBMINI / Zigbee plugs | Home Assistant | — | Need a Zigbee dongle (e.g. SONOFF ZBDongle-E). |

**Turning on DIY mode** (R3 / MINI):
1. Hold the button about 5 s until the LED blinks fast, then again until it blinks slowly. The device now shows a Wi-Fi network **ITEAD-XXXXXX**.
2. Join that Wi-Fi with your phone (password `12345678`) and open **http://10.10.7.1**.
3. Enter your shop Wi-Fi (2.4 GHz) and save.

Exact steps differ by firmware version; see SONOFF's "DIY mode" page for your model. In ZENAA, choose **SONOFF DIY mode** and enter the IP and device ID (printed on the device and shown in the eWeLink app).

**Flashing Tasmota** works the same way for every ESP device:
1. 3.3 V USB-serial adapter.
2. Hold the button while powering it, which puts the chip in flash mode.
3. Open **tasmota.github.io/install** in Chrome/Edge.
4. Join the `tasmota-…` Wi-Fi and enter your Wi-Fi details.
5. Apply the device **template** from **templates.blakadder.com**.

Doc 09 walks through this for the BASICR4 with photos-level detail.

---

## 3. Other brands

| Device | Plug type | How |
|---|---|---|
| Shelly Plus Plug S / Plug S Gen3 / Plus Plug UK/US | Shelly Plus / Gen 3 | Shelly app → add to Wi-Fi → in ZENAA press **Find**. Keep *device authentication* off on the LAN. |
| Shelly Plus 1 / 1PM / 1 Gen3 / Mini Gen3 | Shelly Plus / Gen 3 | Inline relay (electrician). |
| Shelly 1 / Plug S (Gen 1) | Shelly Gen 1 | |
| Athom plugs (Tasmota or ESPHome edition) | Tasmota / ESPHome | Ship with open firmware: just join Wi-Fi. |
| NOUS A1T | Tasmota | Ships with Tasmota. |
| TP-Link Kasa (HS100/HS103/HS110/KP115/EP10) | Home Assistant | HA → *TP-Link Smart Home* integration. |
| TP-Link Tapo (P100/P105/P110/P115) | Home Assistant | HA → TP-Link / Tapo integration. |
| Tuya / Smart Life plugs (Gosund, Teckin, Nedis, Lidl, AliExpress…) | Home Assistant | HA *Tuya* (cloud) or *LocalTuya* (local). Or flash: ESP chip → Tasmota; BK7231 chip → **OpenBeken** (then use the Tasmota type). |
| Meross MSS110/210/310 | Home Assistant | *Meross LAN* custom integration. |
| Broadlink SP4 | Home Assistant | Broadlink integration. |
| Xiaomi / Aqara plugs | Home Assistant | Xiaomi Miio / Aqara / Zigbee. |
| IKEA TRÅDFRI / INSPELNING, Philips Hue plug | Home Assistant | Zigbee. |
| Samsung / LG / Sony / Hisense smart TVs | Home Assistant (media_player) | Turns the TV itself off; switching ON often needs Wake-on-LAN. For Android/Google TVs, see the ZENAA TV app (doc 13). |

### Connecting through Home Assistant

Home Assistant (HA) is free software that talks to over 2,000 brands. Run it on the same mini PC:

```bash
docker run -d --name homeassistant --restart unless-stopped --network host \
  -v /home/zenaa/ha:/config ghcr.io/home-assistant/home-assistant:stable
```

1. Open `http://<mini-pc-ip>:8123`, create an account and add your plugs (**Settings → Devices & services → Add integration**).
2. Find the plug's **entity ID** in **Settings → Entities**, e.g. `switch.ps5_tv_plug`.
3. Create a token: click your name (bottom left) → **Security** → **Long-lived access tokens** → **Create token** → copy it.
4. In ZENAA: **Stations → ✏️ → Plug type: Home Assistant**:
   - address `http://<mini-pc-ip>:8123`;
   - the entity ID;
   - the token.
5. Press **Test ON / Test OFF**.

ZENAA uses HA's `homeassistant.turn_on` / `turn_off`, so it also works with `light.*`, `input_boolean.*` and `media_player.*` entities.

---

## 4. DIY relay (ESP8266 / ESP32 + relay module)

### Parts

| Part | Example | Cost |
|---|---|---|
| Board | Wemos D1 mini (ESP8266) or ESP32 DevKit | ~GH₵ 40–80 |
| Relay | 5 V relay module, 10 A, opto-isolated | ~GH₵ 20 |
| Power | 5 V USB supply (or a HLK-PM01 module, electrician only) | |
| Housing | Plastic project box, cable glands, a proper socket | |

Wiring (low-voltage side):

| Relay pin | Board pin |
|---|---|
| VCC | 5V |
| GND | G |
| IN | D1 (GPIO5) |

Have an electrician connect the relay's **COM / NO** contacts in series with the **live** wire to the TV's socket.

### Option A — Tasmota (no programming)

1. Flash Tasmota from **tasmota.github.io/install** over USB.
2. Configure it: **Configuration → Module → Generic (18)**, set **D1 GPIO5 = Relay 1**, and save.
3. In ZENAA, set the plug type to **Tasmota** and press **Find**.

### Option B — ESPHome

```yaml
esphome:
  name: ps01-relay
esp8266:
  board: d1_mini
wifi:
  ssid: "YourShopWiFi"
  password: "your-password"
web_server:          # ← required: ZENAA talks to this
  port: 80
switch:
  - platform: gpio
    pin: GPIO5
    id: relay
    name: "PS-01 TV"
    restore_mode: ALWAYS_OFF
```

Flash it with `esphome run ps01-relay.yaml`. In ZENAA, choose plug type **ESPHome**, enter the IP and switch ID `relay`.

### Option C — your own Arduino sketch + Custom HTTP

Upload with the Arduino IDE (board: *LOLIN(WEMOS) D1 mini*):

```cpp
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
const char* SSID = "YourShopWiFi";
const char* PASS = "your-password";
const int RELAY = 5;            // D1
ESP8266WebServer server(80);
bool on = false;
void setRelay(bool v) { on = v; digitalWrite(RELAY, v ? HIGH : LOW); }
void setup() {
  pinMode(RELAY, OUTPUT); setRelay(false);
  WiFi.begin(SSID, PASS);
  while (WiFi.status() != WL_CONNECTED) delay(300);
  server.on("/relay/on",     []() { setRelay(true);  server.send(200, "text/plain", "relay=1"); });
  server.on("/relay/off",    []() { setRelay(false); server.send(200, "text/plain", "relay=0"); });
  server.on("/relay/status", []() { server.send(200, "text/plain", on ? "relay=1" : "relay=0"); });
  server.begin();
}
void loop() { server.handleClient(); }
```

In ZENAA, choose plug type **Custom HTTP** and fill in:

| Field | Value |
|---|---|
| ON address | `http://<ip>/relay/on` |
| OFF address | `http://<ip>/relay/off` |
| Status address | `http://<ip>/relay/status` |
| ON looks like | `relay=1` |
| Method | GET |

---

## 5. Custom HTTP: any other system

The **Custom HTTP** plug type calls a web address to switch ON and another to switch OFF. Use it for:

| System | ON / OFF addresses |
|---|---|
| **Node-RED** | An `http in` node per action, e.g. `http://nodered:1880/ps01/on` |
| **Hubitat / openHAB / Domoticz** | Their REST/Maker API URLs |
| **Raspberry Pi** | A small Flask or Express server toggling a GPIO relay |
| **IFTTT / cloud webhooks** | The webhook URL (needs internet) |

Options:
- **Method:** GET, POST or PUT, with an optional JSON body for ON and OFF.
- **Authorization header:** e.g. `Bearer abc123`. It is stored as a secret and never shown again.
- **Status address + "ON looks like":** a word or JSON snippet that means ON (e.g. `"state":"ON"`), or a pattern in slashes like `/on|true/`.
  - Without them, ZENAA still switches but cannot read the state. The minute-by-minute check then repeats the last command instead.

---

## 6. Troubleshooting smart devices

| Message on the station / Test | Meaning / fix |
|---|---|
| *Plug not reachable (timed out)* | Wrong IP, the plug is off, or it's on a different Wi-Fi (guest network). Reserve the IP in your router. |
| *The plug refused the username/password* | Set the device password in the station form, or turn device authentication off. |
| *The plug sent an unexpected answer — check the driver type* | Wrong plug type for this device, e.g. Shelly Gen 1 chosen for a Gen 3. |
| *Tasmota did not report the relay state — check the channel* | Multi-relay Tasmota: set Channel 1/2/3/4. Single relay: leave blank. |
| *Home Assistant reports this device as unavailable* | HA lost the plug. Fix it in HA first. |
| *The device refused the login / token* (HA) | Token wrong or deleted: create a new long-lived token. |
| *The device answered "not found" (HTTP 404)* | Wrong entity/switch ID, or wrong ON/OFF address. |
| *Could not tell ON from OFF in the status answer* | Fill in **ON looks like** for your Custom HTTP device. |
| *ESPHome sent an unexpected answer — is web_server enabled?* | Add `web_server:` to the YAML and re-flash. |
| SONOFF / eWeLink messages | See doc 08 (LAN) and doc 12 (eWeLink import, cloud). |
