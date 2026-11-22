# 09 — Flash Tasmota onto the SONOFF BASICR4 (recommended)

This replaces the BASICR4's eWeLink firmware with **Tasmota**, free open firmware that ZENAA GAMEHUB already supports. After flashing:

- the BASICR4 is controlled **directly over your Wi-Fi**, with no eWeLink account, no cloud, no device key and no developer app;
- ZENAA finds it on the network by itself (**Find** button), so you don't need a separate phone app;
- it keeps working even if the internet is down or eWeLink changes its app.

**Does it work on the BASICR4?** Yes. The BASICR4 uses an ESP32-C3 chip, and Tasmota has a published template for it (relay on GPIO4, LED on GPIO6, button on GPIO9). Several people have flashed it with a cheap USB-serial adapter. *Correction:* doc 08 earlier said the R4 could not be flashed. That warning comes from one report about the **MINIR4**, not the BASICR4.

> **Do you need a custom firmware or app?** No. Tasmota already does everything a custom firmware would: a setup hotspot your phone can join, a web page to enter your Wi-Fi, and a simple local command (`Power On` / `Power Off`). A home-made firmware would be less tested. It also couldn't get past a locked chip if a unit ever had one, because the lock blocks *any* unsigned firmware, Tasmota or custom.

---

## ⚠️ Safety first

- **The BASICR4 must be completely disconnected from mains (230 V) the whole time it is open or wired to the computer.** It has no transformer, so its electronics sit at mains voltage when plugged in. Touching it or the USB adapter while it's on mains can kill you and destroy your PC.
- The USB adapter powers it with 3.3 V during flashing; that's all it needs.
- Close the case completely before reconnecting mains. Have an electrician do the mains wiring (doc 08, section 1).
- Flashing erases the eWeLink firmware. Going back to eWeLink later isn't easy, so try one unit first.

## What you need (about GH₵ 50–100)

| Item | Notes |
|---|---|
| **USB-to-TTL serial adapter, 3.3 V** | CH340G, CP2102 or FTDI. It must have a **3.3 V** setting or pin. **5 V will damage the chip.** |
| **4 jumper wires** (Dupont, female-male) | Plus a **4-pin male header** if the board has bare holes. Some people just hold the pins in place. |
| PC with **Chrome or Edge** | The Tasmota web installer only works in Chromium browsers. |
| Small flat screwdriver or fingernail | To open the case. |
| (Maybe) USB driver | CH340: install "CH340 driver" from wch-ic.com if Windows doesn't show a COM port. |

## Step 1. Open the BASICR4

1. **Unplug it from mains** and disconnect all wires.
2. Pull the bottom cover off. It's held by 4 plastic clips; a fingernail or flat screwdriver works.
3. Find the **4 serial pads/pins** on the board. They're printed **3V3 (VCC), RX, TX, GND**. Take a photo of your board for reference.

## Step 2. Wire it to the USB adapter

| BASICR4 | USB adapter |
|---|---|
| 3V3 / VCC | **3.3 V** (never 5 V) |
| GND | GND |
| RX | **TX** (crossed) |
| TX | **RX** (crossed) |

If the adapter has a 5 V/3.3 V jumper, set it to **3.3 V**. Don't plug the adapter into the PC yet.

## Step 3. Put it in flashing mode

1. **Hold down the BASICR4's button** (it's GPIO9, the boot pin).
2. While holding it, **plug the USB adapter into the PC**. This powers the board in flashing mode.
3. Release the button after 2–3 seconds.

If flashing later fails with "Failed to connect", unplug, then try again. This time hold the button and connect **GND last**, or disconnect and reconnect GND while holding the button.

## Step 4. Flash Tasmota (3 minutes)

1. In **Chrome/Edge** open **https://tasmota.github.io/install/**.
2. Choose **Tasmota** (the standard build; the installer picks the ESP32-C3 version itself), then **Connect**.
3. Pick the COM port of your USB adapter, e.g. *USB-SERIAL CH340 (COM5)*. **Pick the right one.** Don't flash some other device on your PC.
4. Tick **Erase device**, then **Install**. Wait for **"Installation complete"**.
5. Unplug the USB adapter, remove the wires, and **close the case**.

## Step 5. Connect it to your Wi-Fi (no app needed)

1. Have the electrician reconnect it to mains, or plug in the test lead, and power it on.
2. On your phone, open Wi-Fi settings and join the new network **`tasmota-XXXXXX-XXXX`** (no password).
3. A setup page opens. If not, open **http://192.168.4.1** in the phone's browser.
4. Choose your **2.4 GHz** Wi-Fi, type the password, and press **Save**.
5. The page shows the plug's **new IP address**, e.g. `192.168.100.101`. Write it down. You can also skip this, because ZENAA's **Find** button discovers it.

> If no `tasmota-…` hotspot appears after flashing, the flash didn't complete or the device needs mains power for Wi-Fi. Power it from mains (case closed!) and wait 1 minute.

## Step 6. Load the BASICR4 template (important)

Tasmota doesn't know the BASICR4's wiring until you tell it. **Without this, the relay won't switch.**

1. On a PC or phone on the same Wi-Fi, open `http://<plug IP>` (e.g. `http://192.168.100.101`).
2. **Configuration → Configure Other**, and paste into **Template**:

   ```json
   {"NAME":"Sonoff Basic R4","GPIO":[0,0,0,0,224,0,544,0,0,32,0,0,0,0,0,0,0,0,0,0,0,0],"FLAG":0,"BASE":1}
   ```

3. Tick **Activate**, set **Device Name** to the station, e.g. `PS-01 TV`, and press **Save**. It reboots.
4. On the main page press **Toggle**. The relay should click and the TV switch on and off.

**Recommended Tasmota settings** (Tools → Console, type each line and press Enter):

| Command | Why |
|---|---|
| `PowerOnState 0` | After a power cut the TV stays **off** until ZENAA turns it on. |
| `SetOption1 1` | The button only switches on/off. Holding it can't reset the device. |
| `WebPassword YourPlugPass` | *(Optional)* stops customers on your Wi-Fi from opening the plug's page. If you set it, enter username `admin` and this password in ZENAA. |

## Step 7. Fix its IP in the router

In the router, make a **DHCP reservation** for the plug's MAC (shown in Tasmota under *Information*) so the IP never changes. See doc 08, section 4.

## Step 8. Add it in ZENAA GAMEHUB

1. **Stations → ✏️** on the station → **Smart plug**.
2. **Plug type:** *SONOFF flashed with Tasmota*.
3. Press **Find** next to *Plug IP address*. ZENAA scans your network and lists every Tasmota and Shelly plug with its name, e.g. *PS-01 TV · 192.168.100.101*. Press **Use this**.
   - If you opened ZENAA as `localhost`, type your network's first three numbers (e.g. `192.168.100`) and press **Scan again**.
4. Leave **Channel** blank. Fill username/password only if you set `WebPassword`.
5. **Test ON** → TV on. **Test OFF** → TV off. **Save**.

That's it. Session start or resume turns the TV on; end, timeout or pause turns it off, and ZENAA corrects it every minute if someone presses the button.

## Troubleshooting

| Problem | Fix |
|---|---|
| No COM port in the installer | Install the CH340/CP2102 driver, try another USB cable (some are charge-only) or another port. |
| "Failed to connect" / "Wrong boot mode" | Not in flashing mode. Hold the button while powering on, connect GND last, and check RX/TX are crossed. Try swapping RX and TX. |
| Flash completes but no `tasmota-…` hotspot | Power it from mains (case closed) and wait 1 minute. If still nothing, flash again with **Erase device** ticked. |
| Relay doesn't click | Template not applied (step 6). |
| ZENAA *Find* lists nothing | The plug and the ZENAA PC must be on the same network (not guest Wi-Fi). Check the plug's page opens from the ZENAA PC. |
| ZENAA: *The plug refused the username/password* | Enter `admin` and the `WebPassword` in the station form. |
| TV comes on after a power cut | Run `PowerOnState 0` in the console. |

## Sources

- Tasmota template for the BASICR4: templates.blakadder.com/sonoff_BASICR4.html
- Flashing walkthrough: automation.baldacchino.net (*Flashing Tasmota on a Sonoff Basic R4*)
- ESPHome device page: devices.esphome.io/devices/sonoff-basic-r4-v10
- Tasmota web installer: tasmota.github.io/install
