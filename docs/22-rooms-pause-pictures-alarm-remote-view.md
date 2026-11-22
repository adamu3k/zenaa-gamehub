# 22 — Rooms, pause choices, profile pictures, the counter alarm, remote view, and the PC app starting by itself

| What | Where |
|---|---|
| Rooms (e.g. Downstairs / Upstairs) | **Stations → ✏️ edit a station → Room**; the room buttons at the top of Stations |
| Pause choices | **Stations → Pause…** on a running session |
| Profile pictures | Customer app → **Profile → Add a profile picture** |
| Alarm and voice on the counter PC | 🔊 speaker button at the top of ZENAA, on the counter PC |
| Remote view (see a station's screen) | 🖥 button on a station card (VNC) |
| PC timer app starts by itself | ZenaaStation.exe **1.4.0**: install it once, then nothing to do |

---

## 1. Rooms

1. **Stations → ✏️** on a station → **Room**: type e.g. `Downstairs`. Names you already used are suggested.
2. Do the same for the other stations, e.g. `Upstairs` or `VIP room`.

On **Stations**:
- **All rooms** shows a heading per room, with the number of stations in each.
- Pick a room button (e.g. **Upstairs**) to see only that room. Each PC remembers its choice, so a tablet upstairs can always show Upstairs.
- The room also appears under the station name on each card.

Stations without a room are listed last under *No room set*. Leave every room blank to keep the old single list.

## 2. Pause choices

On a running session press **Pause…** and choose one:

| Choice | Clock | Station screen app (PC / TV) | Smart plug (TV/console power) |
|---|---|---|---|
| **Lock screen & switch off** | stops | locked: *"Your session is paused"* | **off** |
| **Lock screen, keep TV on** | stops | locked | stays **on** (no restart wait, game stays in memory) |
| **Stop the clock only** | stops | **not** locked, timer shows paused | stays **on** |

- **Resume** continues from the same remaining time in every case.
- The card shows how it was paused, e.g. *Paused · screen locked, TV on*.
- *Stop the clock only* lets the player keep using the console while no time is counted (e.g. a short power cut on the TV, or staff fixing a controller). Use it only when you trust what's happening at the station.
- Settings → *Switch the station off while a session is paused* is still the default when a pause comes from somewhere without a choice (e.g. a power-cut recovery).

## 3. Profile pictures (customer app)

**Profile → Add a profile picture** → choose a photo or take one. The app crops it to a square and shrinks it before uploading, so it's small and fast even on mobile data.

The picture replaces the coloured letters in:
- chat;
- the leaderboard and podium;
- *Find opponents*;
- tournaments;
- the top of the app.

Customers can **Change picture** or **Remove picture** at any time. Players who chose *Hide me from the public leaderboard* don't show a picture to other players. Staff see the picture on the customer's record.

## 4. Alarm and voice on the counter PC

On the **counter PC** (the one with a speaker), click the **🔊 speaker button** at the top of ZENAA:

1. Tick **Beep on this PC for time warnings and time up**, and **Also say it out loud**.
2. Press **Test: 5 minutes** and **Test: time up** to hear it. Adjust **Volume**, **Voice** and **how many times** "time up" is said.

What it does:
- At each warning time (Settings → *Low-time alerts*, e.g. 5 minutes): two beeps, then *"PS5 One, 5 minutes remaining"*.
- When prepaid time runs out: an alarm, then *"PS5 One, time up"* (said twice by default).
- It uses each **station's name** as typed in Stations. Call them what you want to hear, e.g. *"Foot monitor 1"*.

Good to know:
- The setting is saved **on that computer only**. Other PCs and phones stay quiet unless you turn it on there too.
- Keep ZENAA open in a browser tab (minimised is fine). After opening ZENAA, **click anywhere on the page once**: browsers only allow sound after a click.
- Voices come from Windows (**Settings → Time & language → Speech → Manage voices**). They work without internet.
- The station screens still chime and beep by themselves as before.

## 5. Remote view (VNC): see and control a station's screen

Remote view lets staff see a station PC's screen from ZENAA, and take control if needed (e.g. to close a stuck game).

### One-time setup on each station PC
1. Install **TightVNC** (tightvnc.com → Download → *TightVNC for Windows*).
   - Choose **Custom** → install only **TightVNC Server**, and leave **Register as a system service** ticked, so it runs before anyone signs in.
2. When it asks, set a **password for remote access**. Use the same one on every station if you like.
3. Allow it in the Windows firewall if asked. It listens on port **5900**.
4. In ZENAA: **Stations → ✏️ the station → Remote view (VNC)**:
   - **Computer address**: the PC's IP, e.g. `192.168.1.21`. Leave it blank if the ZENAA timer app runs on that PC; ZENAA then uses the address the app reports. Reserve the IP in your router so it never changes.
   - **Port**: 5900.
   - **VNC password**: the one from step 2. It is kept secret: only staff allowed to use remote view receive it, when they open a screen.

Android TV boxes can use **droidVNC-NG** (free, from the Play Store) the same way. PS5 and Xbox consoles can't be viewed; they don't run VNC.

### Using it
- The **🖥 button** on a station card opens the screen in a new tab.
- It starts in **Watching only**. Press **take control** to use your mouse and keyboard on the station, and **stop** when done. **Ctrl+Alt+Del** and **Full screen** buttons are at the top.
- Who can use it: the permission *See and control station screens remotely* (`stations.remote`). Admins and managers have it; cashiers don't by default (Users & roles).
- Every time someone opens a screen, it is written in the **Audit trail**.

### If it doesn't connect
| Message | Fix |
|---|---|
| *No VNC address for this station yet* | Fill in **Computer address**, or pair the ZENAA timer app on that PC. |
| *Could not connect to 192.168.1.21:5900* | Check that TightVNC Server is running on the station, that port 5900 is allowed in its firewall, and that the IP is right. |
| *Refused by the station … wrong VNC password?* | Type the password again under the station's **Remote view**. |

The ZENAA server must be able to reach the station over the network. Same Wi-Fi/LAN is fine.

## 6. The PC timer app starts by itself (ZenaaStation 1.4.0)

Install the new **ZenaaStation.exe** on each gaming PC once (Integrations → downloads), open it, and pair it as before. If it was already paired, it keeps its pairing. From then on it starts after every restart and sign-in.

What 1.4.0 changes:
1. **Fixed place.** It copies itself to `%LOCALAPPDATA%\ZenaaStation` and starts from there, so cleaning the Downloads folder doesn't break it.
2. **No more SmartScreen stop.** It removes Windows' *"downloaded from the internet"* mark from itself. Without this, Windows showed a hidden *"Windows protected your PC"* question at sign-in, and the app never started.
3. **Start-up entry.** It adds itself to Windows start-up, and switches itself back on if it was turned off in **Task Manager → Startup apps**.
4. **Restart check every 2 minutes** (Task Scheduler, task *ZENAA Station*). If the app was closed or crashed, it starts again within 2 minutes.
   - When staff choose **Exit** in the staff menu, it stays closed until the PC restarts.
   - **Unpair** removes the start-up entry and the task.

Still needed once per PC:
- **Windows must sign in by itself.** Apps only start after someone signs in. On a gaming PC with a password, turn on automatic sign-in: press **Win+R**, type `netplwiz`, untick *Users must enter a user name and password*, and type the password. On Windows 11, if that box is missing, first go to **Settings → Accounts → Sign-in options** and turn off *For improved security, only allow Windows Hello sign-in*.
- Plug the PC into power settings that never sleep (**Settings → System → Power → Screen and sleep → Never** while plugged in).
