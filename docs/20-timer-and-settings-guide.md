# 20 — How the timer works, and how to set everything up

This guide explains, in order: how a game's time is counted and charged, what players see on the screen, and every setting with a recommended value for a PS5 venue in Ghana.

---

## 1. How the timer works

### The life of a session

```
 Counter                       Station screen (TV / PC)                Plug (power)
 ───────                       ────────────────────────                ────────────
 (no session)                  Cover: "See the counter to play"        OFF
 Start session ───────────────▶ Island: "Game on, Ama!" 45:00          ON
                               counts down every second
 (5 min left) ◀── staff alert   "5 minutes left" + chime
 (1 min left)                   "Last minute — save your game" + chime
 (10 s left)                    "Time is up in 10… 9…" + beeps
 0:00 ──────────────────────▶   Alarm, cover: "Time is up"             OFF after 10 s
```

1. **Start session** (Stations → station card): pick the **pricing plan**, the **billing**, the customer (optional) and how they pay.
2. The plug turns **on**, and within about 3 seconds the screen app removes the cover and shows the timer.
3. The screen counts down every second by itself. It checks with ZENAA every 3 seconds, so an extension or pause from the counter appears within 3 seconds.
4. When time is up, the screen locks and the plug turns off after the delay in Settings (10 seconds by default).
5. If the Wi-Fi drops, the screen keeps counting and still locks at zero.

### Two ways to bill

| Billing | Use it when | How it works |
|---|---|---|
| **Prepaid (fixed time)** | The player pays first: "1 hour, please" | You choose the minutes (or a package). They pay now. The timer counts **down**. At zero the screen locks. **Extend** adds more paid time. |
| **Postpaid (open timer)** | Regulars, friends playing until they're done, tabs | The timer counts **up** ("playing 47:12"). The player pays when you press **End**. ZENAA works out the price from the time played. |

The station card shows the money: *Paid GHS 20* for prepaid, or *≈ GHS 15.67* so far for postpaid.

### Buttons on a running station

| Button | What it does |
|---|---|
| **Extend** | Prepaid: adds minutes and takes payment at the hourly rate (no minimum). The screen shows the new time within 3 seconds. |
| **Pause** | Stops the clock, for example during a power cut or when the controller dies. The screen shows **PAUSED**. With *Switch off while a session is paused* on, the plug turns off. |
| **Resume** | Continues from where it stopped. No time is lost. |
| **End** | Stops the session. Prepaid: you can refund unused time. Postpaid: charges the time played. The screen locks and the plug turns off. |
| **Send message** | Text appears on the player's screen (the island grows), e.g. "Your friend is at the counter". |
| **Turn on (no charge)** | Free time for staff, game updates and controller tests, with no session or money (guide 19). |

### How the price is worked out (pricing plans)

**Pricing & tiers → Pricing plans**. A plan is either:

- **Time rate:** a price per hour, charged in steps.
- **Package (fixed time & price):** e.g. *"3 hours for GHS 50"*. Always prepaid.

The settings of a time-rate plan:

| Field | Meaning | Example |
|---|---|---|
| **Rate per hour** | Price of 60 minutes | GHS 20 |
| **Billing unit (minutes)** | Time is charged in steps of this size. Prepaid time must be a multiple of it. | 15 → you sell 15, 30, 45, 60… minutes |
| **Minimum charge (minutes)** | The least anyone pays for | 30 → even 10 minutes costs 30 minutes |
| **Grace on last unit (minutes)** | Postpaid only: if the last unfinished step is this short or shorter, it's free | 3 |

**Worked example: postpaid at GHS 20/h, unit 15 min, minimum 30 min, grace 3 min**

| Played | Charged as | Price |
|---|---|---|
| 10 min | minimum 30 min | GHS 10.00 |
| 47 min | 45 min (the 2 extra minutes are within the grace) | GHS 15.00 |
| 50 min | 60 min (5 extra minutes > grace, so a full extra unit) | GHS 20.00 |
| 1 h 31 min | 1 h 30 min | GHS 30.00 |

**Prepaid at the same plan:** 30 min = GHS 10, 45 min = GHS 15, 1 h = GHS 20. 40 minutes isn't allowed, because it isn't a multiple of 15.

**Suggested plans to start with**

| Plan | Type | Settings |
|---|---|---|
| Standard | Time rate | GHS 20/h, unit 15 min, minimum 30 min, grace 3 min |
| 3-hour package | Package | 180 min for GHS 50 |
| Night (all night) | Package | 480 min for GHS 80 |

Use **Station categories** (e.g. *PS5*, *PS5 VIP*, *PC*) when some stations cost more: a plan with a category only applies to those stations.

> **Changing a price** only affects **new** sessions. Running sessions keep the price they started with.

### Discounts

- **Membership tiers** (Pricing & tiers): e.g. *Gold* = 10% off play time for customers on that tier.
- **Happy hours** (Promotions): e.g. Mon–Thu 10:00–14:00, 20% off, on chosen stations. Applied automatically.
- **Promo codes** (Promotions): percentage or fixed amount, with valid dates and maximum uses. Typed at the counter or in the customer app.
- **Manual discount** when ending a session: needs a manager PIN if the cashier isn't allowed.

### What the player sees and hears (screen apps v1.3)

| Moment | Screen | Sound |
|---|---|---|
| Session starts | Island grows: **"Game on, Ama! 45:00 to play"** | — |
| Normal play | Island: progress ring · station · **time left** (green) · temperature | — |
| 5 minutes left | Time turns amber; island grows: **"5 minutes left — top up at the counter"** | Chime |
| 1 minute left | Time turns red; **"Last minute — save your game now"** | Chime |
| Last 10 seconds | **"Time is up in 10… 9… 8…"** | Beep every second, higher for 3-2-1 |
| 0:00 | Cover: **"Time is up — please see the counter"** | Alarm |
| Paused | **PAUSED** | — |
| Free/staff time | **FREE 29:59** in blue | — |
| No session | Cover: "See the counter to play" (or just "Ready" if covering is off) | — |

At the counter, the station card shows when 5 minutes or less are left, and ZENAA records a warning at each **Low-time alerts** minute (Settings), so staff can offer an extension before the player is locked out.

**On a PC, games must be in "Borderless" or "Windowed full screen"** mode for the island to show over them. In exclusive "Full screen", nothing can be shown over the game; the sounds and the lock still work (guide 19).

---

## 2. Every setting, with recommended values

Menu → **Settings**. Press **Save settings** at the bottom after changing anything.

### Centre & country

| Setting | Recommended | Notes |
|---|---|---|
| Centre name | ZENAA GAMEHUB | Shown on receipts, screens and the customer app |
| Country | Ghana | Fills currency, time zone, phone prefix and MoMo networks |
| Currency / Decimal places | GHS / 2 | |
| Time zone | Africa/Accra | Decides "today" in reports and happy-hour times |
| Phone prefix | +233 | 024… becomes +23324… |

### Mobile money (at the counter)

| Setting | Recommended | Notes |
|---|---|---|
| Networks | MTN MoMo, Telecel Cash, AT Money | Choices at the till |
| Require transaction ID | **On** | Staff must type the MoMo transaction ID, which stops "I sent it" without proof |

### MoMo top-ups without a gateway (customer app)

| Setting | Recommended | Notes |
|---|---|---|
| MoMo numbers | Your venue number(s) and the name customers see | Customers send money here |
| Customers can top up with MoMo | On | |
| Credit automatically when the SMS matches | On | Needs the ZENAA MoMo phone (guide 18) |
| Auto-credit limit | GHS 500 | Bigger payments wait for staff to check |
| Minimum / maximum top-up | GHS 5 / GHS 2,000 | |
| Trusted SMS senders | Leave the defaults | Add the exact sender name your phone shows if the app says "sender not trusted" |

### Operations & receipts

| Setting | Recommended | Notes |
|---|---|---|
| Low-time alerts (minutes before end) | `5, 1` | When the counter is alerted. The screens always warn at 5 min, 1 min and 10 s. |
| Staff must open a shift before taking money | On | Every cedi then belongs to a shift and a person |
| Receipt header / footer | Address, phone / "Thank you for playing!" | |

### Staff PINs & approvals

| Setting | Recommended | Notes |
|---|---|---|
| Always require a PIN for | Cash in/out, refunds, wallet withdraw, wallet adjust, discounts | Stops misuse on a computer someone left signed in |
| Blind shift close | On | Staff count the drawer before seeing the expected amount |

Then every staff member: menu → **My PIN**.

### Customer portal & bookings

| Setting | Recommended | Notes |
|---|---|---|
| Customer portal on / self sign-up | On / On | |
| Bookings on / auto-confirm | On / On | Turn auto-confirm off if you want to approve each booking |
| Opening / closing time | 10:00 / 23:00 (your hours) | Closing before opening = past midnight. Same time = 24 h |
| Minimum notice | 30 min | |
| Book up to | 14 days | |
| No-show after | 15 min | The station is released if they don't come |

### Socials & public address

| Setting | Notes |
|---|---|
| YouTube, TikTok, Instagram… | Full links. They appear as **Follow us** buttons |
| Public address of the customer app | e.g. `https://play.yourvenue.com` (guide 14). **Set this before printing QR posters.** |

### Smart plugs (station power)

| Setting | Recommended | Notes |
|---|---|---|
| Switch off after session ends | 10 seconds | Gives the player a moment to see "Time is up" |
| Switch off while paused | On | |
| Every minute, switch off stations with no session | On | Stops anyone switching a PS5 on at the wall without paying |

> On a PS5, cutting the power during play can make the console "check the drive" on the next start. Ask players to save at the 1-minute warning. If you prefer, set the delay to 30–60 seconds.

### Station screen apps (PC, Android TV, PS4/PS5)

| Setting | Recommended | Notes |
|---|---|---|
| Cover the screen when no session runs | On | "See the counter to play" |
| Android TV: switch the TV panel off at time up | Off | Turn on only if players ignore the cover |
| Shared exit PIN | 6 digits only managers know | Works on every screen, online or offline. Staff normally use their own PIN |
| Timer look | Island (top centre) | Or the corner box |
| Island size | 60–70% | Smaller = less in the way of the game |
| Show the temperature / venue latitude & longitude | On / your venue's location | Find the numbers on Google Maps: long-press your venue |

### Backups and Updates

See guide 17. Recommended: automatic backup **every 24 hours**, keep the last **14**, and `BACKUP_PATH` pointing at a Google Drive folder.

### Competitions

Leaderboard public (on), Find match (on), and the games list with each game's "how to meet online" text (guide 19, section 8).

---

## 3. First-day checklist (30 minutes)

1. **Settings:** centre & country, Require MoMo transaction ID, Low-time alerts `5, 1`, PIN rules → Save.
2. **Pricing & tiers:** create *Standard* (time rate) and one package.
3. **Stations:** each PS5 with a code (PS-01, PS-02…), its plug, and its screen paired.
4. **Users & roles:** a cashier account each; everyone sets **My PIN**.
5. **Test one station end to end:**
   - Start a **prepaid 6-minute** session (make a test plan with unit 1 min if needed).
   - At 5:00 the island shows **"5 minutes left"** with a chime.
   - **Extend** 1 minute: the screen updates within 3 seconds.
   - **Pause / Resume**: the screen shows PAUSED, and the plug turns off and on.
   - At 1:00, the chime; at 0:10, the beeps; at 0:00, the alarm and the cover; after 10 s the plug turns off.
   - On the PC: press **Ctrl+Shift+F12**, type your PIN, **Unlock (free 30 min)**. The island shows FREE 29:59.
6. **MoMo:** send GHS 1 from another phone with a top-up code. The wallet should go green (guide 18).
7. **Shift:** open a shift, take a cash payment, close the shift with the note counter. The difference should be 0.

---

## 4. Common questions

**The time on the TV is different from the counter.** It catches up within 3 seconds. If it doesn't, check the screen chip on the station card is green (paired and online).

**A player says they paid but the screen is still locked.** Check a session is running on the right station. The screen unlocks within 3 seconds of starting.

**The plug didn't turn off.** Check the plug chip on the card says *Power on/off*, not *Plug offline* (guide 06).

**I want to give someone free minutes.** When no session is running, use **Turn on (no charge)**. For a postpaid session, give a discount when you press **End** (needs a manager PIN). Extensions are always charged at the hourly rate.

**Can players change the time themselves?** No. Time is only changed at the counter (or by a staff PIN on the screen). The screen apps block Alt+Tab, the Windows key and Alt+F4 while locked.
