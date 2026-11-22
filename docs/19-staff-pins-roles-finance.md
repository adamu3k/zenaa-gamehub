# 19 — Staff PINs, user types, admin unlock, finance, shifts, news

## 1. User types and permissions

**Users & roles** has two tabs:

- **People**: each person's account, user type, PIN status and extra or removed permissions.
- **User types**: your own types (e.g. *Supervisor*, *Attendant*, *Tournament host*) with exactly the permissions you tick. Changing a type changes everyone who has it.

The built-in types are **Administrator** (everything), **Manager** (everything except staff, settings, backup and updates) and **Cashier** (stations, sessions, customers, deposits, bookings, competitions, MoMo inbox). New in this version:

| Permission | Lets them |
|---|---|
| Turn a station on with no charge / unlock screens | Use **Turn on (no charge)** and unlock PC/TV screens and the console page with their PIN |
| Confirm MoMo payments | Use the MoMo inbox |
| View the Finance page | See the Finance page and export CSV |
| Post news, events and promotions | Use News & posters |
| Download and restore backups | Use Backup & updates (backups) |
| Check for and install updates | Use Backup & updates (updates) |

## 2. Staff PINs

Everyone sets a **4–8 digit PIN**: menu → **My PIN** (they need their password). Admins can also set or remove anyone's PIN under **Users & roles → person → Staff PIN**. Easy PINs (1234, 0000) are refused, and two people can't share a PIN.

A PIN is used for:

1. **Manager approval.** When a cashier tries something they aren't allowed to do (cash out, refund, wallet withdrawal, discount, Turn on no charge), a PIN pad appears. A manager types **their** PIN and the action goes through. It is recorded as *done by the cashier, approved by the manager* (Audit trail, Finance CSV column "Approved by (PIN)").
2. **Always ask** (Settings → Staff PINs & approvals). Tick actions that must **always** have a PIN, even for people who are allowed, e.g. cash out and refunds. Then nobody can do them on a computer someone else left signed in.
3. **Station screens.** Unlocking or closing the PC/TV apps and sending the console timer from `/ps` (see section 3).

Five wrong PINs lock the PIN pad for 5 minutes on that device.

## 3. Admin unlock on the PC and TV apps

| App | How |
|---|---|
| **ZENAA Station (PC)** | Press **Ctrl+Shift+F12** (or right-click the tray icon). Type **your** PIN, then: **Unlock (free 30 min)**, **Lock again**, **Exit app**, **Unpair**. |
| **ZENAA TV** | On the "See the counter" screen, type your PIN with the remote's number keys and press **OK**. |
| **PS4/PS5** | Open `http://<server>:8080/ps` in the console browser, type your PIN and press **Send** (doc 16). |

Unlocking from a screen does the same as **Turn on (no charge)** in ZENAA: the plug goes on, the screen unlocks, the island shows **FREE 29:59**, and it is recorded with your name.

The shared **exit PIN** from Settings → Station screen apps also works on every screen (recorded as *Shared exit PIN*). If the screen can't reach the server it still works and unlocks for 10 minutes.

On the PC the PIN box takes typing from the keyboard **or** the on-screen number pad (mouse/touch). Press **Esc** to close it.

### Time warnings and alarm (PC and TV apps, v1.3.0)

| When | What players see and hear |
|---|---|
| 5 minutes left | The island grows: **5 minutes left — top up at the counter**, with a chime |
| 1 minute left | **Last minute — save your game now**, with a chime |
| Last 10 seconds | The island counts down **Time is up in 10… 9…**, with a beep every second (higher beeps for the last 3) |
| Zero | An alarm rings and the screen locks |

The sounds play through the PC's speakers or headset, or the TV's speakers, over the game sound.

### The timer over games (PC)

The island is re-placed on top of everything 4 times a second, so it stays visible over games in **Borderless** or **Windowed full screen** mode. A game in **exclusive full screen** draws straight to the screen and nothing can appear over it (the sounds still play, and the lock still covers the game at zero). If the island disappears in a game, open the game's display/graphics settings and choose **Borderless** (also called *Windowed full screen* or *Full screen windowed*). The staff PIN box shows a warning when this is the problem.

## 4. Turn on — no charge

Use this for game updates, controller tests, staff play or events: **Stations → station card → Turn on (no charge)**. Choose 15 min to 2 h, or *until I turn it off* (12 h at most).

- The plug switches on and the screens unlock. No session is started and no money or revenue is recorded.
- The card shows **Staff use · free** with the time left and who turned it on. **Turn off** ends it.
- **Start paid session** replaces it at any time.
- Finance shows how many staff unlocks happened in the period. Check it for misuse.

## 5. Finance page

Menu → **Finance**. Choose Today, Yesterday, This week, This month, Last month, or your own dates.

| Box | Meaning |
|---|---|
| Revenue (games) | Sessions, extensions and sales, minus refunds. Includes games paid from the wallet. |
| Money in | Real money received: cash, MoMo, card and transfer, including wallet top-ups. |
| Expenses & payouts | Cash out of the drawer by category, refunds paid out, and wallet withdrawals. |
| Net cash flow | Money in − money out. |
| Wallets: customers hold | Prepaid money you still owe in play time. |
| Tabs: customers owe you | Pay-later balances. |
| MoMo top-ups | Top-ups made through the customer app (doc 18). |

Below the boxes: totals by **payment method**, **expenses by category**, **staff member** (revenue, cash, MoMo), **day**, and every **shift** with its cash and MoMo difference.

**Export CSV (Excel)** downloads every payment in the period with date, type, method, amount, category, reference, customer, staff and PIN approver. **Print** gives a one-page summary.

## 6. Shifts and the cash drawer

- **Cash in / Cash out** are open to everyone. Without permission, a manager approves with a PIN. Cash out asks *what for*: safe drop, bank/MoMo deposit, owner withdrawal, supplies, electricity, internet, generator fuel, repairs, wages, rent, transport or other. These are the expense categories on the Finance page.
- **Count & close** has a note-and-coin counter for the currency (GHS 200 … 10p). ZENAA adds it up. You can also just type the total.
- **MoMo received this shift**: type what the MoMo phone or statement shows. ZENAA compares it with the MoMo payments recorded in the shift and shows the difference.
- **Blind count** (Settings → Staff PINs & approvals): staff count the drawer before they see the expected amount, so the count can't be "adjusted".
- **Notes / handover** are kept with the shift (Z-report).

## 7. News, events and QR posters

Menu → **News & posters**.

- **Posts** appear in the customer app (**News** tab and home page): game news, upcoming events, promotions, announcements. A post can have a picture (resized automatically), an event date, a button (e.g. *Register* → `/portal/cups`, *Watch* → YouTube), **show from** and **hide after** dates, and **pin to top**.
- When a tournament's registration opens, ZENAA **posts it automatically**.
- **Socials** (Settings → Socials & public address): YouTube, TikTok, Instagram, Facebook, X, Snapchat, WhatsApp channel, website. They show in the app as **Follow us** buttons.
- **QR posters**: printable codes for *Join & get the app* (opens sign-up), *Top up with MoMo*, *News*, *Find a match*, *Tournaments*, and each social link. Set **Public address** first, otherwise the codes point to "localhost". Print them for the counter, the walls and each station.

## 8. Online matches (EA SPORTS FC, eFootball…)

- **EA SPORTS FC has no match codes.** Players add each other as PSN friends (or EA ID friends for cross-play). Then: *Online Friendlies → New Friendly Season → pick the friend*, or in Ultimate Team *Play → Friendlies → Play a Friend*. So in ZENAA, players put their **PSN ID** and **EA ID** in Profile, and the matched opponent sees them.
- **eFootball** uses rooms: *Friend Match → Create 1 vs 1 Match Room*, with a password. The host puts **Room ID + password** in the request's *Room ID / password* field (or under *Your matches* later). Only the matched opponent sees it.
- Each game can have its own "how to meet online" text. It is shown to both players.
- After the match, one player reports the score and the other confirms. The result counts on the leaderboard.

To set up a scheduled online match: **Find match → Online → Later at …**, then add a message and a room code. Whoever accepts gets a scheduled match with the opponent's IDs and the room code.
