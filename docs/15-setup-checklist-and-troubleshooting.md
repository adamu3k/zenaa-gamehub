# 15 — Complete setup checklist and troubleshooting index

New here? Start with **guide 20** (how the timer works and every setting with recommended values). Use this page as the map. Each step links to the detailed guide. In the app, every guide is under **Help & guides**, with a search box: type part of any error message to find its fix.

---

## A. Setup checklist (in order)

| # | Step | Guide |
|---|---|---|
| 1 | Install Ubuntu + Docker on the mini PC, copy ZENAA, `docker compose up -d --build` | README (A) |
| 2 | First sign-in as `admin`. **Settings:** centre name, country/currency, opening hours, time zone. Change the admin password | README (A6) |
| 3 | **Pricing & tiers:** at least one pricing plan; optional membership tiers | 02 |
| 4 | **Stations:** add each PS5 (code, name). Delete mistakes with **Delete station** in the edit window | this page, C |
| 5 | **Users & roles:** cashier/manager accounts; custom user types; **everyone sets a PIN** (menu → My PIN); choose actions that always need a PIN | 19 |
| 6 | **Shift & cash drawer:** open a shift before taking money | 02 |
| 7 | **Smart plugs:** choose your device, set the plug type on each station, press **Test ON / OFF** | 06, 11 (catalogue), 08/09 (BASICR4), 12 (eWeLink) |
| 8 | **Station screens:** install ZENAA TV / ZENAA Station, pair each screen; choose the timer look (island), island size and venue location for the temperature; optional offline exit PIN. Jailbroken PS4/PS5: bookmark `http://<server>:8080/ps` on the console | 13, 16 |
| 9 | **Paystack:** keys, public address, webhook | 07 |
| 10 | **Customer portal:** settings, QR at the counter, https address for the install button | 07, 14 |
| 11 | **Competitions:** games list, gamertags, public board on a TV (`/board`), first tournament | 10 |
| 12 | **MoMo top-ups:** add your MoMo number, install ZenaaMoMo.apk on the MoMo phone (SMS blocked? use `tools\ZENAA-MoMo-phone-setup.cmd` with a USB cable), pair it, test with GHS 1 | 18 |
| 13 | **News & posters:** socials and public address in Settings; print the QR posters; first news post | 19 |
| 14 | **Backups:** automatic backups on; point `BACKUP_PATH` at a Google Drive / OneDrive folder; download one backup and keep it safe | 17 |
| 15 | **Updates (when on GitHub):** create an empty private repository, double-click `tools\ZENAA-GitHub-setup.cmd`, set the repository in Settings → Updates, run `infra\updater\install-updater.ps1` once | 17 |
| 16 | **Chat, rewards, game news:** Settings → Socials links; Customers → Rewards (follow-us bonus); News & posters → Game news from other sites → Quick add | 21 |
| 17 | **Rooms, counter alarm, remote view, PC auto-start:** set a Room on each station; turn on the 🔊 speaker button on the counter PC; install TightVNC Server on station PCs; install ZenaaStation 1.4.0 and Windows automatic sign-in | 22 |
| 18 | **Appearance & Social:** Settings → Appearance (ZMG blue + lime, Save); Social → Accounts & settings: handle, hashtags, phone for idea texts; connect Facebook Page (+ Instagram) and Telegram; make sure News & posters has game news websites | 23 |

---

## B. Daily routine

1. Open a shift (Shift & cash drawer).
2. Check the **Stations** page:
   - every plug chip is **Power on/off**, not *Plug offline*;
   - every **Screen** chip is green.
3. Start, extend and end sessions from the station cards. Players see their time on the TV.
4. Record friendlies or tournament results as they finish (Leaderboard / Tournaments).
5. Close the shift and count the drawer. Pay out prizes and record cash outs.

---

## C. Station delete — what happens

| The station… | Result |
|---|---|
| has never had a session, booking or match | Removed completely. |
| has history | **Hidden** everywhere (station grid, booking, portal). Its past sessions stay in reports, and the code (e.g. `PS-03`) is free to reuse. Its smart plug and screen app are disconnected. |
| has a running/paused session | Refused: end the session first. |
| has upcoming bookings | Refused: cancel or move them first (Bookings page). |

To take a station out **temporarily**, set its status to **Maintenance** (plug left alone) or **Archived** instead of deleting it.

---

## D. Troubleshooting index

### Sign-in and access

| Message | Fix |
|---|---|
| *Too many failed attempts. Try again in 15 minutes.* | Wait 15 minutes, or an admin resets the password (Users & roles). |
| *You do not have permission to …* | Give the permission to the user or their user type (Users & roles). |
| *Your session has expired — sign in again* | Password, role or account changed, or the token expired (12 h). Sign in again. |
| Portal: *The customer portal is switched off* | Settings → Customer portal is on. |

### Sessions, money, bookings

See doc 02 (spec) and doc 07 (Paystack/bookings). The most common:

| Message | Fix |
|---|---|
| *PS5 One already has an active session* | End or resume the existing one. |
| *Open your shift (cash drawer) before taking or paying out money* | Shift & cash drawer → Open shift (or untick the setting in Settings). |
| *Insufficient wallet balance (available …)* | Top up, or take another payment method. |
| *Credit limit exceeded: … already owes …* | The customer's pay-later limit is reached: settle their tab first (Payments & tabs). |
| *Enter the mobile money transaction ID* | Settings requires MoMo references: type the ID from the customer's SMS. |
| *This station has upcoming bookings…* (delete) | Cancel/move the bookings first. |

### Smart plugs → doc 11 §6, doc 08 §7, doc 12 (errors)
### Station screen apps → doc 13 §4
### PS4 / PS5 console timer → doc 16 §6
### MoMo top-ups → doc 18 §6
### PINs, Turn on (no charge), Finance → doc 19
### Backups, restore, updates → doc 17
### Competitions → doc 10 §6
### Install / https → doc 14

### Server

| Symptom | Check |
|---|---|
| Nothing loads on port 8080 | `docker compose ps`: the app must be *healthy*. Then `docker compose logs --tail 100 app`. |
| *Cannot reach the ZENAA server* in the browser | The PC/phone is on another network, or the mini PC changed IP (reserve it in the router). |
| After an update, a page looks broken | Hard refresh (Ctrl+F5); the installed app reloads itself when online. |
| Database errors after a power cut | Postgres recovers by itself. If not: `docker compose restart db app`; restore the latest backup as a last resort (README). |

---

## E. Where things live

| Thing | Location |
|---|---|
| Docs (this folder) | `docs/` — also in the app under **Help & guides** |
| Windows screen app source / build | `agents/windows/` (`build.cmd`) |
| Android TV app source / build | `agents/android-tv/` (`build-apk.ps1`); signing key `zenaa-tv.keystore` — **back it up** |
| PS4/PS5 timer payload source / build | `agents/console/` (`build.ps1`) → `server/console/*.elf` |
| Downloads served to devices | `web/public/downloads/` → `http://<server>:8080/downloads/…` |
| Database backups | `backups/` |
| Settings & secrets | `.env` (server), Settings page (everything else) |
