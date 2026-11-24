# 26 — Pay later (account), paid bookings, playing from the app, changing time, chat people, phone notifications, taking time off, Book now (v0.9.6–0.9.8)

## 1. The customer's account — "pay later"

A customer can play now and pay later. What they owe sits on their **account** until they pay it with cash, MoMo, card or their wallet.

**How much can they owe?** Each customer can have their own limit (customer page → *Owes* → **Change**). Customers without one use the **default limit** in **Settings → Operations → Pay later: credit limit for every customer**. 0 / empty = nobody without their own limit can pay later. Staff need the **Pay later** permission (`payments.tab`; admins and managers have it).

**Ways to put something on the account**

| When | Where | What happens |
|---|---|---|
| Starting a fixed-time session | Start session → **Payment: Put on account (pay later)** | The session starts; the price goes on the account. |
| Ending an open-timer session (or anything still owed) | End session → **Did they pay? Paying now / Put on account** | The bill goes on the account. A walk-in without a customer: choose **whose account**. |
| Adding time | Add time → **Take it from → Put on account** | That time goes on the account (the customer playing, or another customer). |
| Anything else (drinks, a game not paid, a debt) | Customer page → **Account — pay later → Put on account** | Amount + what it is for. A line put on by mistake can be removed (🗑) while nothing of it is paid. |

**Taking payment:** customer page → **Take payment**. Part payment is fine; the oldest things are paid first. Each payment goes into the shift of the staff member who takes it, like any other payment.

The customer sees what they owe in the app (Home and Wallet).

## 2. Adding time from a chosen account

On a running fixed-time session, **Add time** now asks **where the time comes from**:

- **Pay now** — cash, MoMo, card or **the wallet of the account chosen** (the player, or **Use another customer** — e.g. a friend pays from their wallet).
- **Saved time** — taken from that account's saved time for this station type. No money.
- **Put on account** — that account pays later (see 1). If it is another customer, the debt goes on *their* account and the session counts as paid.

## 3. Bookings paid ahead, started from the app

When customers book in the app they choose **How will you pay?**:

- **Pay now** from the wallet. The price is taken from the wallet and the time is put on their **saved time** for that station type. If they cancel, the time stays on their saved time — nothing is lost and no refund is needed.
- **Use my saved time** — needs enough saved time for that station type.
- **Pay at the counter** — as before.

A "pay at the counter" booking can be paid later in the app (**Pay now** on the booking). Staff see **Paid / Saved time / Pay at counter** on the Bookings page.

**Starting it themselves:** from 15 minutes before the booking until it ends, a paid booking shows **Start** in the app. The clock starts straight away on the booked station. Staff can still check bookings in at the counter as before (the saved time is used automatically).

## 4. Playing, pausing and stopping from the app

If **Settings → Customer portal & bookings → Customers can start, pause and stop their own time** is on (it is by default):

- **Play now** on the app's Home page: a customer with saved time picks a **free station** and starts. A station booked by someone else soon can't be taken past their booking.
- **Pause** — the clock stops and the screen locks (and the plug switches off if *Switch the station off while paused* is on). Customers can't use "clock stopped only".
- **Continue** — the clock runs again.
- **Stop** — ends a fixed-time session early; the time left goes back on their saved time.

Only time that is **already paid** can be started from the app. Open-timer (pay as you go) sessions are paid and ended at the counter. Everything a customer does is in the audit trail and the session timeline.

## 5. Saved time per station type, and changing it

Stations have different prices, so saved time now belongs to a **station type** (a **station category** under Pricing & tiers, e.g. PC, PS5 — each station has one). Time bought on a PC price plays on PCs; time bought on an "all stations" price, and all time saved before v0.9.6, plays anywhere.

**Change type** (customer page → Saved time → *Type*, or in the app: Wallet → **Change to another station type**): the time is changed at the same money value, using each type's cheapest hourly price.

> Example: 5 h of PC at GH₵10/h = GH₵50 = **2 h 30 min** of PS5 at GH₵20/h. Rounded down to whole minutes.

## 6. Chat: find anyone, see who is online

In the app's Chat, **Find a player to message…** searches every app user by name or gamertag. Tapping the box shows who is **online now** (used the app in the last 5 minutes, green dot) and who is **playing now** (blue dot). Tap a picture to start a private chat. Only public names and pictures are shown — never phone numbers.

## 7. Phone notifications

Customers turn them on in the app: **Profile → Notifications → Turn on notifications**. They then get a message on their phone, even when the app is closed, for:

- a private chat message,
- a match challenge, and when someone accepts their match,
- a booking confirmed or cancelled by staff,
- 5 minutes left, and time up.

**What it needs (honest limits):**

- The app must be opened over **https://** — browsers only allow notifications on secure addresses. On the plain Wi-Fi address (`http://192.168.…:8080`) the button explains this instead. Set up an https address (Cloudflare Tunnel — see doc 14) and put it in Settings → Socials & public address.
- The server needs **internet** — messages go through Google / Apple / Mozilla's push service.
- **Android** (Chrome, Edge, Samsung Internet): works in the browser or the installed app.
- **iPhone** (iOS 16.4 or newer): only after **Share → Add to Home Screen** and opening the app from the home screen.
- The keys for notifications are made automatically and kept in the database (they move with a full backup). Turning notifications off, or removing the app, stops them.

## 8. Taking time off a session (v0.9.7)

On a running fixed-time session the station card has **+ Time** and **− Time**. **− Time** opens *Take time off* (you can switch to *Add time* at the top):

- **Back on saved time** — the minutes go on the customer's saved time to play another day. No money changes hands.
- **Give money back** — the price goes down by those minutes' share and the difference is given back (as they paid, or cash / MoMo; wallet money always goes back to the wallet). Needs the refund permission. If the session is on their account (pay later), it is called **Lower the bill**: they simply owe less. Minutes that came from saved time always go back on saved time.
- **Just shorten** — the session ends earlier; the price stays.

At least 1 minute must stay — to stop now, use **End**. Each change is in the session timeline ("Time taken off") and the audit trail.

**In the app:** while playing a fixed-time session, customers have **− Time**. The minutes go back on their saved time (needs *Customers can start, pause and stop their own time* switched on).

## 9. Book now and exact times (v0.9.7)

The app's booking page has three ways to choose when:

- **⚡ Book now** — starts this minute on a station that is free now (the "book ahead at least … minutes" rule does not apply). Then press **Start** on the booking (if paid) or go to the counter.
- **Pick a time** — the list of times every 30 minutes, as before.
- **Exact time** — type any start time, e.g. 14:47. It still has to be at least the advance-notice minutes from now and inside opening hours.

**How long** has **Other length…** for any length from 15 minutes to 12 hours (hours + minutes). The stations list shows which are free for exactly that time.

## 10. Owing shows as a minus balance, and paying it from the app (v0.9.8)

- In the app, a customer who owes sees **Main balance** = wallet − what they owe, in **red** with a minus, e.g. **−GH₵20.00**, and "Wallet GH₵0.00 · You owe GH₵20.00". Staff see the same on the customer page, and "owes −…" in the customer list.
- **Money in pays the debt first.** When money goes into the wallet — cash at the counter (Wallet → Deposit), a MoMo code top-up, or Paystack — what they owe is paid first (oldest first); the rest stays in the wallet. Switch it off in **Settings → Operations → Money put into a customer's wallet … first pays what they owe**.
- The app's **You owe** card has:
  - **Pay … from my wallet** — pays as much as the wallet holds.
  - **Pay with MoMo** — the MoMo code card, already filled in with the amount owed: the customer gets a code, sends the MoMo with the code as the reference, and the debt is paid as soon as the MoMo is confirmed (by the MoMo relay phone or staff in the MoMo inbox — see the MoMo guide).

## 11. Game packages when booking (v0.9.8)

When booking in the app, **Price / game package** lists every price and package for that station (e.g. *PC hourly*, *GTA 5 — 3 hours*) with its cost for the booking. Picking a package sets the booking length to the package's. Paying now from the wallet buys that package: its full time goes on saved time for the station type, so a package longer than the booking leaves the extra time saved. Make packages in **Pricing & tiers** (type *Package*, with the station type).

## 12. Uploading changes to GitHub (one click)

After changing the code, double-click **tools\ZENAA-publish-update.cmd**. It:

1. checks the server and web code compile (stops and shows the errors if not),
2. refuses to upload secrets (.env, signing keys, backups),
3. saves every change as a new version and uploads it to GitHub (tagged with the version in `server\package.json` — raise it so other servers see "update available"),
4. asks whether to rebuild ZENAA on this PC too.

No questions: `powershell -ExecutionPolicy Bypass -File tools\publish-update.ps1 -Yes -Message "what changed"`.

## 13. Notes for staff

- Payments a customer makes from the app (booking from the wallet) are in **Finance** and **Payments** with no staff member and no shift, like Paystack top-ups.
- Moving to a new PC: a full backup carries accounts, charges, saved time per type and notification sign-ups (see doc 17).
