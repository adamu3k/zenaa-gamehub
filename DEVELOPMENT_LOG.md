# Development Log

## 2026-11-25 — Online server: Coolify compose file and Linux setup script
- `docker-compose.server.yml`: for Coolify (Docker Compose build pack). Secrets come from Coolify's `SERVICE_PASSWORD_POSTGRES` / `SERVICE_PASSWORD_64_JWT`, the domain from `SERVICE_FQDN_APP_8080`; named volumes; no host ports; backup loop inline (no bind-mounted script).
- `tools/server-setup.sh`: clone-and-run on any Linux server. Makes `.env` with random secrets, starts ZENAA and waits for health; run it again to update (git pull + rebuild).
- Dockerfile creates `/backups` and `/updates` owned by the app user, so named volumes are writable.
- Tested with a throwaway stack: healthy, first admin created, nightly dump written, app can write backups.
- Guide: `docs/27-online-server.md`.

## 2026-11-24 — v0.9.8 Owed money as a minus balance, paying it from the app (MoMo code / wallet), game packages when booking, one-click publish
- Setting `autoPayOwed` (default on): money put into a wallet — staff deposit, MoMo code top-up (`momo.ts` credit), Paystack (`paystack.ts` credit) — first pays what the customer owes (`payOwedFromWallet` → `payTabTx`, oldest first, wallet tender). `payTab` now wraps `payTabTx`.
- Portal `POST /api/portal/account/pay-from-wallet`; `info.autoPayOwed`. Portal "Main balance" = wallet − owed, red with "You owe" when below zero; `PayOwedCard` (Pay from my wallet / Pay with MoMo — the MoMo code card prefilled with the amount owed). Staff customer list shows "owes −…", customer detail shows the main balance in red.
- `GET /api/portal/booking-quote` takes `planId` and returns `options` (every price and game package for the station with its cost for the booking). Booking page: "Price / game package" picker; a package sets the booking length to the package's.
- `tools/publish-update.ps1`: type-checks server and web before uploading (`-NoCheck` to skip), `-Yes` for no questions, then offers to rebuild ZENAA on this PC (`-Rebuild` / `-NoRebuild`).
- Tests: `owed-v098.test.ts` (4).

## 2026-11-24 — v0.9.7 Take time off a session, Book now, any-minute bookings
- Migration 0013: `session_event_type` gets `reduce`.
- `reduceSession` (`POST /api/sessions/:id/reduce`): minutes off a running fixed-time session (at least 1 minute stays). `back`: saved (onto the customer's saved time — station type when it came from saved time, else the price's type), refund (saved-time part goes back as time; bought part cuts the price by its share; money back only beyond the new price — needs `payments.refund`; a pay-later session just owes less), keep (shorter, same price). Refund logic shared via `refundSessionMoney` in `refunds.ts`.
- Portal `POST /api/portal/play/:id/reduce` (own prepaid session, back to saved time). App play card "− Time".
- Station card: "+ Time" / "− Time"; the dialog switches between Add time and Take time off.
- Bookings: `now: true` starts at the current minute without the advance-notice rule. App booking page: ⚡ Book now / Pick a time (30-min list) / Exact time (any minute), and "Other length…" (hours + minutes, 15 min–12 h).
- Docs: 26 sections 9–10. Tests: `reduce-v097.test.ts` (4). 153/153.

## 2026-11-24 — v0.9.6 Pay later accounts, paid bookings, play from the app, time per station type, chat people, phone notifications
- Migration 0012: `customer_charges` (things on a customer's account besides unpaid sessions), `push_subscriptions`, `customers.time_by_category` + `last_seen_at`, `customer_time_log.category_id`, bookings `payment` / `plan_id` / `paid_amount` / `paid_seconds`.
- Account (tab): `outstandingFor` = unpaid sessions (any status) + unpaid charges; `checkCredit` falls back to the new `defaultCreditLimit` setting. Start prepaid with `payLater`; end with `payLater` + `accountId` (walk-ins); `addCharge` / `removeCharge`; `payTab` pays oldest first, split tenders allocated per item (`/api/customers/:id/charges`, `/api/customers/charges/:id`, `/api/customers/:id/account/pay`). Customer page Account card; Start/End dialogs ask "Paying now / Put on account".
- Extend: `source` pay | saved | tab and `accountId` (another customer's wallet, saved time or account; another customer's tab becomes a charge on them).
- Saved time per station type (`timeBuckets`, `playableSeconds`, `postTime` categoryId; untyped/old time plays anywhere). `convertTime` at equal value via each type's cheapest hourly price (`hourlyValue`); staff and portal endpoints with preview.
- Bookings: `pay` counter | wallet | saved; wallet payment buys the time onto saved time (cancel keeps it); `payBooking`; `defaultPlanFor`; `/api/portal/booking-quote`.
- `services/self-play.ts`: portal start (paid booking from 15 min before, or saved time on a free station not booked by someone else), pause (always locks), resume, stop (saves the rest). Setting `portalSelfStart`.
- `services/push.ts`: Web Push with `web-push` (VAPID keys generated into kv; request built by `generateRequestDetails`, sent through `ctx.fetch`; 404/410 removes the subscription). Sent for DMs, match challenge/accept, staff booking confirm/cancel, 5-min warning, time up. `sw.js` push + notificationclick. Portal Profile → Notifications (explains https / iPhone limits).
- Chat: `customerPeople` (search + online/playing), last-seen updated by customer auth (≤ once a minute). Portal People finder.
- Portal `PortalPlay.tsx`: play card with live clock, Play now, booking Pay now / Start, pay choice when booking, saved time per type + Change type, notifications card.
- Docs: new 26. Tests: `account-v096.test.ts` (8). 149/149.

## 2026-11-23 — v0.9.5 Speed, deleting & clearing data, part backups, Ask AI, chat, shifts guide
- Speed / black screen: pages lazy-load (`web/src/lib/lazy.tsx`: retries, one reload on a stale build, `PageBoundary` with Try again), spinner in `index.html`, main pages pre-fetched after start. Build writes `.br`/`.gz` (vite plugin) and the server sends them (`preCompressed`), hashed assets cached for a year, `index.html`/`sw.js` no-cache. First load 960 KB → 337 KB (106 KB gzip). `/api/auth/me` retries on network errors instead of signing out.
- `PasswordInput` (show/hide eye) on every password box, staff and customer app.
- New `server/src/routes/cleanup.ts`: delete customer (removed, or wiped to "Deleted customer" when payments/results point to it; blocked with wallet money, saved time, a tab or a running session), price, membership, happy hour, promo code (hidden via new `deleted_at` columns when used — migration 0011), Find match request, tournament with results (`/everything`), reward claim, chat room, audit line, outside news stories (hide list). `GET/POST /api/cleanup` clears whole areas with the admin's password; recorded in the audit trail. `DeleteButton` component on the pages.
- Part backups: `SECTIONS` in `services/backup.ts`; `GET /api/system/backup?sections=`, `POST /api/system/backup/inspect`, part restore merges (upsert by primary key) in one transaction and explains missing parts. System page: Choose parts…, restore picks parts, Clean up card.
- Ask AI: `services/ai.ts` (Claude via `@anthropic-ai/sdk`, default `claude-opus-5-5`, low effort, server-side fallback; or OpenAI chat completions). Key in kv, never sent to browsers. `/api/social/ai*`; editor card with Undo; settings card.
- Chat: refresh, avatars (rooms + messages), find player, clear chat, no scroll jump. User types: members add/remove. Audit: search, staff filter. Shifts: 4-step guide, last drawer count suggestion (`/api/shifts/last-count`).
- Social looks: quint easing, figure settle, soft-light grade instead of a filter pass (faster video), phone layout shows the picture first.
- Docs: 17 (part backups, new-PC checklist incl. copying `.env`), new 25. Tests: cleanup, part backup, AI (mocked).

## 2026-11-23 — v0.9.4 Blank canvas, background remover, stronger looks, better 3D prompts
- New `web/src/social/Studio.tsx` (**Blank canvas**): a small design tool with no libraries. Headings, text, boxes, circles, pictures and the ZMG logo; move, resize, turn, layers (order, hide, lock), colours with fades, outline, shadow/glow, picture brightness/contrast/colour, undo/redo, keyboard shortcuts, drag-drop and paste. Autosaves in the browser; Save/Open an editable `.zmgdesign.json`; PNG/JPG download; **Use in a post** opens the post editor with the new `custom` look ("Your own design").
- `removeBackground()` in graphics.ts: flood-fills plain backgrounds from the top/side edges, softens the edge and trims. Button under every picture field (with Gentler / Stronger / Original) and in the Studio.
- Uploads with a see-through background now stay see-through (WebP/PNG instead of JPEG).
- Looks: ordinary photos become a framed, tilted photo card instead of a blurry box; cut-outs get a coloured glow and rim light; every pack look gets a finishing pass (contrast/saturation, light sweep, vignette, grain).
- 3D prompts keep the face and **eyes exactly the same** (no enlarged cartoon eyes). New **AI · Make my design 3D** (attach a finished design; only the people turn 3D, text/logos/layout stay) and **AI · Remove background** prompts; "No background" option on the other prompts.
- Tests 130/130.

## 2026-11-23 — v0.9.3 Reference-pack looks + 3D character prompts
- `web/src/social/graphics.ts`: 28 new layouts modelled on the 50 reference posts (`asset 1` folder; style inspiration only, no logos or artwork copied) × 4 colourways = 112 looks, plus 4 "3D & AI" looks. New colourways: magenta, purple, green, gold, warm yellow, sunset, orange, red, festival red, pink (`pal3`, knit / grain / dots patterns). New helpers: `figure` (cut-out with soft edges), `bubble`, `capBox`, `shout`, `metalName`, `brushes`, `confetti`, `countUp`.
- `AI3D_STYLES` builds a ChatGPT / Gemini prompt (3D cartoon, game cover, 2D cartoon, collectible figure) from the photo + name, outfit, scene, pose, expression, bubble and caption. The editor shows a **3D prompt** card with Copy prompt / Copy photo for `ai-*` looks.
- Look picker: previews draw only once on screen (IntersectionObserver); new groups 3D & AI, Players, Results & tables, Memes & comics, Celebrations. 163 looks in total.
- All new looks rendered in Post, Square and Story with headless Chrome and checked; tests 130/130.

## 2026-11-23 — v0.9.2 40 more Social looks
- `web/src/social/graphics.ts`: 10 new layouts (split, magazine cover, news card, slash, TV live, big word, countdown, fixtures, player stats, photo dump) × 4 brand colourways, built from `FAMILIES`. Keys are `layout-colour` (e.g. `split-navy`). `TemplateKey` is now a string; each template has a `group`.
- Editor: the look picker shows live mini previews with group filters. Rows fields outside Leaderboard are a plain textarea.
- Server: `template` is checked against a pattern instead of a fixed list. News ideas rotate through 8 looks.
- All 40 looks were rendered in Post, Square and Story with headless Chrome and checked.

## 2026-11-21 — v0.9.1 Saved time on customer accounts
- `customers.saved_seconds`, `sessions.from_saved_seconds` / `saved_seconds`, and a new `customer_time_log` table (migration 0010_saved_time).
- `services/time-bank.ts`: `postTime` (never below zero; logs it) and `addCustomerTime` (buy = package/minutes with payment and member discount; adjust = signed minutes with a reason). Permission `customers.time` (admin and manager by default).
- Start session: `useSavedTime` (+ optional `minutes`) plays prepaid with no charge. End session: `saveRemaining` puts the unplayed prepaid time back. The unused-refund suggestion counts saved time as used.
- Routes: `POST /api/customers/:id/time`; the customer detail includes `timeLog`; portal `/me` includes `savedSeconds` and `timeLog`.
- Web: green saved-time box in Start and End session; Saved time card, Add/Change modal and history on the customer page; "Your saved time" in the customer app. Docs 24.
- Tests: `saved-time.test.ts` (3). Total 130/130.

## 2026-11-21 — v0.9.0 Amount → time calculator, Appearance settings, Social (branded graphics, daily ideas, posting)

- **Calculator:** `components/TimeCalculator.tsx`.
  - `timeForAmount()` uses the same half-up rounding as the billing engine. Hourly plans use whole billing units; packages give whole packs plus leftover minutes at the hourly rate.
  - **Amount → time** button on Stations and Session history; *amount the customer pays* field in Start session.
  - New permission `sessions.calculator` (admins only by default).
- **Appearance:** settings group `appearance` (primary, accent, textScale, font, headingFont, corners, tintedBackground, defaultTheme, applyToPortal).
  - Public `GET /api/public/appearance`. `lib/appearance.ts` applies CSS variables and caches them per device; `bootAppearance()` runs before render.
  - CSS: hard-coded purples replaced by `--primary`/`--accent` via `color-mix`. Added `--on-primary` (black text on light colours), `--ui-zoom` (html zoom; sidebar and modal heights divided by it), and `html.tinted`.
  - Fonts Anton and Archivo Black come from `@fontsource`.
  - `getSettings` merges grouped settings with defaults.
- **Social:**
  - Tables `social_posts` (unique `news_url`) and `social_media` (posted files, 30 days, random key). Migration `0009_social_posts`.
  - Settings group `social` (daily ideas time/count, notify phone, handle, hashtags, caption pattern, brand colours). Secrets in kv `social.secrets` (Facebook Page token, Telegram bot token), never returned.
  - `services/social.ts`:
    - `dailyIdeasTick` runs every minute from index.ts, once per local day after `ideasTime`. It sends an alert and an SMS (kind `social`) through the MoMo phone outbox.
    - Image proxy `GET /api/social/image` (DNS check against private networks, manual redirects, image types only, 8 MB).
    - Publishing to Facebook (photos/videos), Instagram (container → poll → publish; needs an https `publicUrl`), Telegram (sendPhoto/sendVideo), and the portal `posts`.
    - `mark-posted` for manual shares; insights (FB followers/posts, IG followers/media, Telegram members, 10-minute cache).
  - Permission `social.manage` (admins only by default).
  - Web:
    - `social/graphics.ts`: canvas engine, 7 templates (news, breaking, quote, versus, leaderboard, promo, winner) × 3 sizes. Animated (6 s timeline); MediaRecorder MP4/WebM export.
    - `pages/Social.tsx`: ideas/drafts grid, editor with live preview, posting panel with Web Share and manual links, page updates, accounts & settings.
  - Brand files in `web/public/brand`, made from the owner's Z ASSET folder: keyed logos, blue texture, merch photos.
- Docs: `23-calculator-appearance-social.md`; checklist row 18. Tests: `test/social-v090.test.ts` (7 tests), 127 total.

## 2026-11-21 — v0.8.0 Rooms, pause choices, profile pictures, counter alarm & voice, remote view (VNC), PC app auto-start

- **Rooms:** `stations.room`. Stations page groups by room, with room buttons (remembered per PC); room field with suggestions.
- **Pause choices:** `sessions.pause_mode`, set by `POST /api/sessions/:id/pause {mode}`:
  - `off` = lock + plug off; `screen` = lock, plug on; `open` = clock only, nothing locked.
  - The default still follows Settings → power off on pause. Agent state has `pauseMode`; power desired state follows it.
- **Profile pictures:** `customers.avatar` / `avatar_at`.
  - `PUT`/`DELETE /api/portal/me/avatar` (the phone crops to a 256 px JPEG); public `GET /api/avatars/:id`.
  - `avatarUrl` in me, leaderboard, find opponents, tournaments and chat. Hidden players show no picture. Staff lists never carry the image itself.
- **Counter alarm + voice:**
  - Alerts carry `sound` (`warning` | `timeup`) and `speak`. The scheduler sends "<station>, 5 minutes remaining"; expiry sends "<station>, time up".
  - Web `lib/announcer.tsx`: WebAudio beeps + Windows speech, per-PC settings behind the speaker button.
- **Remote view (VNC):**
  - Station `vnc_config` (password secret). `POST /api/stations/:id/vnc` (`stations.remote`) gives a single-use 60 s ticket.
  - WebSocket bridge `/api/vnc/<ticket>` → station TCP (the `ws` package; socket.io `destroyUpgrade: false`). Refuses loopback; audited.
  - noVNC 1.5.0 core vendored in `web/public/novnc` (MPL-2.0). Page `/remote/:id`: watch-only by default, take control, Ctrl+Alt+Del.
- **ZenaaStation 1.4.0:**
  - Copies itself to `%LOCALAPPDATA%\ZenaaStation` and removes the Zone.Identifier mark (SmartScreen blocked start at sign-in).
  - Run key, re-enabled in StartupApproved. Task Scheduler `--watchdog` every 2 min (no admin needed; checked on this PC).
  - Staff Exit = stays closed until the next restart.
- Migration 0008. Doc 22. 120 tests.

## 2026-11-20 — v0.7.2 MoMo auto-credit rules and thank-you SMS from the MoMo phone

- **Auto-credit rules:**
  - *Wait for staff from this amount up* (default GHS 300; `momoAutoMax` now means "this amount and above waits").
  - *Automatic crediting hours* (`momoAutoHoursOn/From/To`, venue time zone, windows across midnight). Outside them, payments wait for staff.
  - A waiting payment is matched, with a note saying which rule stopped it, plus an info alert to staff.
  - A payment without the code matches when it comes from the customer's registered phone with the exact amount of their only waiting top-up.
- **Thank-you SMS:**
  - New `sms_outbox` table (migration 0007). Messages are queued in the same transaction as: a MoMo credit, a counter deposit, or a game/extension/tab payment by a registered customer.
  - Templates with `{name} {amount} {balance} {centre} {station}`. Per-kind on/off; test SMS.
  - The relay phone polls `GET /api/momo/relay/outbox` and reports `POST /api/momo/relay/outbox/:id`.
  - Failed sends retry up to 3×. No report within 5 min → failed (never double-sent). Not sent within 12 h → expired.
  - MoMo inbox → *Thank-you SMS* tab with Send again.
- **ZENAA MoMo 1.2.0:**
  - SEND_SMS; foreground service polling every 15 s (dataSync); starts again after a reboot.
  - Real sent/failed result from Android (no airtime, no signal).
- 114 tests.

## 2026-11-20 — v0.7.1 MoMo reference codes are numbers only

- New MoMo top-up codes are 6 digits (e.g. 482193, never starting with 0), so customers on keypad phones (*170#) can type them; no capital letters needed.
- Matching reads number codes only from the SMS Reference (not phone numbers, balances or transaction IDs) and ignores spaces/dashes typed inside the code. Old letter codes (KD4821) still match.
- Portal shows "Numbers only — type it on any phone". Doc 18 updated. 111 tests.

## 2026-11-20 — v0.7.0 Find opponents, customer chat, rewards, game news from other sites, GitHub setup

- **Find opponents** (portal Match tab):
  - Search by gamertag, name, PSN ID or EA ID (searched, never shown).
  - Filters: *Everyone / My level / At the centre now / Looking for a game*.
  - Each player shows tier, rating and gap, W-D-L, win %, last 5, last played, head-to-head with you, "at the centre now" (running/paused session) and an open request.
  - Buttons: Challenge, Accept game, Message. `GET /api/portal/players/search`.
- **Customer chat:**
  - Lobby + private messages (`chat_messages`, polling every 3 s). Unread badge on Chat.
  - Blocked words → `***`; 1.5 s per-player gap; report → staff alert.
  - Staff **Chat** page: all rooms, delete, "it's fine", mute/unmute (muted players can read only), post as the centre.
  - Permission `chat.moderate` (managers, cashiers).
- **Rewards:**
  - Follow-us bonuses (YouTube/TikTok/Instagram/…): staff check the username and press Pay, or honour system.
  - Bonus codes: once per customer, limits, end date; 8 wrong → 15 min wait.
  - Optional promo code revealed after the reward. Promo codes can be shown in the app (`show_in_portal`).
  - Paid as wallet `bonus`. Staff **Rewards** page with claims to check and a menu count; Home teaser card.
  - Permission `rewards.manage`.
- **Game news from other sites:**
  - RSS/Atom feeds or a site address (feed auto-discovered), read hourly by the server. No XML library; tested on PlayStation Blog, Push Square, IGN, GameSpot, Eurogamer and Polygon.
  - Newest N (default 2) mixed into the portal News and Home with picture, source and a link out. Blocked words hide stories.
  - News & posters → *Game news from other sites*: Test, Quick add, Check now, preview.
- Portal phones: bottom bar Home / Book / Match / Chat / **More** (all pages).
- **GitHub:**
  - `tools\ZENAA-GitHub-setup.cmd`: first upload. Checks Git, refuses secrets, sets a private noreply email, links and pushes.
  - `tools\ZENAA-publish-update.cmd`: commit + push + version tag.
  - Doc 17 rewritten. Tested against a local bare repository.
- Migration 0006. Doc 21. 110/110 tests (vitest hook timeout raised to 60 s for 9 parallel databases).

## 2026-11-20 — v0.6.3 Sign in with eWeLink (OAuth 2.0)

- eWeLink rejects password sign-in (`/v2/user/login`) for free developer App IDs with **error 407**. New **Sign in with eWeLink**: ZENAA builds the CoolKit OAuth page link (`c2ccdn.coolkit.cc/oauth/index.html`, HMAC-SHA256 of `clientId_seq`), eWeLink redirects back to `/api/integrations/ewelink/callback` (one-time state, 15 min), the code is exchanged at `/v2/user/oauth/token` (Sign header) and devices are imported as before. Integrations shows the exact Redirect URL to register; the password form moves under "Other way".
- Fix: `setKv(…, null)` failed (column NOT NULL), so **Disconnect** on the eWeLink account didn't work. Null now deletes the key.
- Doc 12 rewritten (A1/A2, errors). 106/106 tests.

## 2026-11-19 — v0.6.2 MoMo phone SMS permission, timer & settings guide

- **ZENAA MoMo 1.1.0:** after the first SMS request, the app explains Android's "restricted setting" and opens its own App info page (⋮ → Allow restricted settings → Permissions → SMS); asks to be excluded from battery optimisation.
- **`tools\ZENAA-MoMo-phone-setup.cmd`** (Plan B): downloads Android platform-tools, connects the phone (USB or Wi-Fi pairing), `adb install -r -g` (session install = not restricted; SMS granted), appops ACCESS_RESTRICTED_SETTINGS, deviceidle whitelist, opens the app. Linked from Integrations.
- Docs: 18 "If the SMS permission is blocked" (Plans A–D, Play Protect); new **20 — timer & every setting with recommended values**; 15 points to it.

## 2026-11-19 — v0.6.1 Timer over games, 5-minute warning & alarm, staff PIN box fix

- **PC app v1.3.0:** the island (and corner box and alerts) is re-asserted as top-most 4×/second without taking focus, so it stays over borderless/windowed-fullscreen games. Exclusive full screen is detected (`SHQueryUserNotificationState`) and explained in the staff box.
- **Warnings:** 5 minutes left (island alert + chime), last minute (chime), last 10 seconds (island countdown + beep each second), zero (alarm). Sounds are generated WAVs (`ZenaaStation.exe --sounds <folder>` saves them). TV app v1.3.0: the same with Android tones.
- **Staff PIN box fix (PC):** the lock cover re-activated itself every second and stole the keyboard from the PIN box. Now the cover leaves focus alone while the box is open, the box forces itself to the foreground, accepts digits only, has an on-screen number pad and closes with Esc.
- **Shared exit PIN** now works online too (server accepts it in `/api/agent/unlock`, recorded as "Shared exit PIN"). 105/105 tests.

## 2026-11-19 — v0.6.0 Staff PINs & admin unlock, finance, MoMo without a gateway, news, backups & updates

- **Staff PINs** (keyed HMAC, unique, easy PINs refused, 5 wrong → 5 min lock). PIN pad appears automatically (API 428 `pin_required` → retry with `pin`). **Manager override:** someone with the permission approves for someone without it; recorded as `approved_by` + audit. Settings → *always require a PIN* for cash in/out, refunds, discounts, wallet withdraw/adjust, shift close, staff unlock, MoMo confirm. New permissions: `stations.bypass`, `momo.confirm`, `finance.view`, `content.manage`, `system.backup`, `system.update`.
- **Turn on — no charge** (staff unlock): plug on + screens unlocked without a session, 15 min – 12 h, shown as *Staff use · free*; a paid session replaces it. **PC/TV apps** (v1.2.0): staff unlock/exit with their **own PIN**, checked by the server (offline: shared exit PIN). Island **size setting** (default 70%) and *FREE 29:59* display. PS4/PS5 payload: "Staff unlock" notification.
- **Console browser page `/ps`:** open on the jailbroken console's browser → station (remembered) → staff PIN → Send. Detects the console IP and server address; no JavaScript; LAN only.
- **MoMo without a gateway:** portal top-up with a reference code; the **ZENAA MoMo** Android app (new, `agents/android-momo`) forwards "Payment received" SMS; parser for MTN/Telecel/AT; trusted senders only, one credit per transaction ID, exact amount, auto-credit limit; customer can type the transaction ID; **MoMo inbox** for staff (confirm/reject/credit unclaimed SMS). Generic webhook for other SMS-forwarder apps.
- **Finance page:** revenue, money in/out by method, expenses by category, wallet liability, tabs, MoMo top-ups, staff unlocks, by staff/day, shift cash & MoMo differences; CSV export with PIN approver; print.
- **Shifts:** note/coin counter per currency, MoMo reconciliation at close, blind count option, cash in/out categories, open to all with manager PIN.
- **News & posters:** posts (news/event/promo/tournament/announcement, picture, button, schedule, pin) on the portal *News* tab and home; tournaments auto-post when registration opens; social links (*Follow us*); printable **QR posters** (sign-up, MoMo top-up, news, find match, tournaments, socials).
- **Online matches:** room ID / password on requests and matches (only the opponent sees it), EA ID on profiles, per-game "how to meet online" (EA FC friendlies, eFootball rooms).
- **Backups & updates:** one-file backup download / restore (schema-tolerant, safety copy first), automatic backups to `BACKUP_PATH` (cloud-synced folder), backup list; update check against GitHub and one-click update through the PC updater (`infra/updater`, scheduled task; backup → git pull → compose rebuild).
- Docs: new 17, 18, 19; 16, 13, 15, 05, README updated. Migration `0005_admin_finance_momo`. **104/104 tests** (14 new: PINs & override, shift count, staff unlock incl. from the screen, console page, SMS parsing, MoMo auto/txn/mismatch/assign, news & auto-post, finance & CSV, backup/restore, update check).

### Not yet verified
- ZenaaMoMo.apk on a real phone with real MoMo SMS (sender names and message wording can differ by network and change over time — the trusted-sender list is editable).
- The PC/TV apps v1.2.0 and the `/ps` page on a real PS4/PS5 browser; the updater against a real GitHub repository.

## 2026-11-18 — v0.5.0 Timer island, PS4/PS5 console timer

- **Timer island** on ZENAA Station (Windows, v1.1.0) and ZENAA TV (Android TV, v1.1.0): a black pill at the top centre — progress ring + station code, time, temperature (or clock). Grows for 10 s for alerts: *Game on*, *Time is almost up*, *Last minute*, staff messages. Windows: per-pixel-alpha layered window, click-through; `ZenaaStation.exe --preview <folder>` renders the states to PNG.
- Settings: **Timer look** (island / corner box), **outside temperature** (server asks Open-Meteo every 15 min, venue lat/lon; never blocks; off in tests).
- **PS4/PS5 console timer** (`agents/console/zenaa.c`, ps4-payload-sdk / ps5-payload-sdk, built in Docker): background ELF payload for jailbroken consoles; PlayStation notifications for session start, time left (every 10 min, 5, 1), staff messages, time up, pause, offline. Single instance (new copy replaces old via 127.0.0.1:9077).
- Server writes the server URL + station token into the payload's 1 KiB config block and sends it to the console's ELF loader (**Send to PS5/PS4** in the station form) or offers it as a download. New `GET /api/agent/console` (plain text state). Unpair revokes payload tokens.
- Docs: new 16 (PS4/PS5), 13 (island, Apple TV note), 15, 05 updated. Tests: 90 (console push to a fake ELF loader, token in payload, text state, localhost refused, unreachable console).
- Not possible: Apple TV (tvOS can't draw over another HDMI input); PKG app (suspended while a game runs) — explained in doc 16.

## 2026-11-18 — v0.4.0 Competitions, station screens, more smart devices, installable portal, in-app help

- **Station delete:** never-used stations are removed; stations with history are hidden everywhere (code freed, plug and screen disconnected) so reports stay correct. Refused while a session runs or bookings are upcoming.
- **Leaderboard** (staff page, portal *Ranks*, public venue TV board `/board`):
  - Per game, Elo rating with a goal-difference multiplier and tiers (Bronze → Legend); placement until 3 matches.
  - W-D-L, goals, form, streaks, titles; week / month / all-time boards.
  - Highlights: biggest win, top scorer, on fire, best streak. Head-to-head between any two players.
  - Gamertags and PSN IDs; players can hide from public boards.
- **Games** list (scoring in goals/points/rounds, draws allowed or not). Seeded: EA SPORTS FC, eFootball, Mortal Kombat, Tekken, NBA 2K.
- **Tournaments:**
  - Formats: knockout (automatic byes, seeding, optional third-place play-off), league (single or double round robin), and groups/divisions + knockout (snake seeding, cross-group draw).
  - Max players, points per win/draw, entry fee (cash or wallet), cash prize places, portal self-registration, rules.
  - Live bracket, tables, fixtures and top scorers. Penalties and walkovers; clearing and correcting results, with locks once later matches are played.
  - Finishes automatically (champion alert, places, prizes); prize payout to wallet or recorded cash/MoMo.
  - All games count on the leaderboard.
- **Find match:**
  - Players post requests: venue/online, now/time, anyone/similar level ±150. They can also challenge a player directly, and get suggestions of players near their level.
  - Accepting schedules a friendly. One player reports the score and the other confirms; disputes go to staff.
  - Staff page shows requests and pairs players; up to 3 open requests per player; requests expire.
- **Station screen apps** (pair with a 6-digit code; agent tokens are separate and can't reach staff/portal APIs; unpair revokes):
  - `agents/windows` — **ZenaaStation.exe** (C# 5/.NET 4, built with Windows' own csc): timer dock, warning toast, full-screen lock on every monitor with Win/Alt+Tab/Alt+F4 blocked, Ctrl+Shift+F12 staff PIN menu, offline countdown, autostart.
  - `agents/android-tv` — **ZenaaTV.apk** (Java, built in Docker): overlay timer over the PS5 picture, warning banner, black cover when time is up, optional panel off (device admin), staff PIN via remote number keys, starts on boot.
  - Staff can send a message to a screen from the station card. New settings: cover when idle, Android panel off, staff exit PIN.
  - A PS5 app is not possible on retail consoles (only Sony-signed software); doc 13 explains the HDMI-CEC + TV alternative.
- **Smart devices:**
  - New plug types: **eWeLink cloud** (device ID only), **ESPHome**, **Home Assistant** (Kasa, Tapo, Tuya, Meross, Zigbee, Matter, TVs…) and **Custom HTTP** (DIY boards, Node-RED, webhooks; status matching).
  - **eWeLink account import:** device IDs and LAN keys are stored server-side and filled in automatically, so staff type only IP + device ID. Locating devices on the LAN by trying keys on port 8081.
  - Device catalogue (every SONOFF model plus other brands and DIY) in Integrations and as "Help me choose" in the station form. All secrets (password, deviceKey, token, authHeader) are masked and kept when left blank.
- **Customer portal on phones:**
  - Bottom tab bar, wallet chip, greeting, install card.
  - Ranks / Cups / Match pages, and gamertag, PSN ID and privacy in Profile.
  - **Installable web app** (manifests, PNG icons, service worker, install button with iPhone/Android instructions). A staff app manifest too.
- **In-app Help & guides:** searchable docs (docs are now shipped in the Docker image).
- **Integrations** page: supported devices, eWeLink import/locate, station app downloads + status, custom/DIY help.
- **Docs:**
  - New: 10 (competitions), 11 (smart devices catalogue, DIY sketch/ESPHome/HA), 12 (eWeLink without the key), 13 (screen apps & PS5), 14 (install app & https via Cloudflare Tunnel), 15 (setup checklist & troubleshooting index).
  - Updated: README, 05 API, 06.
- Migration `0004_competitions_agents`. **89/89 tests passing** (11 new: engine maths, station delete, leaderboard + privacy, knockout with byes/penalties/third place/prizes, groups→knockout, league, Find match report/confirm/dispute/expiry, screen pairing/state/unpair/token isolation, HA + custom HTTP drivers, eWeLink import/key fill/locate/cloud).

### Not yet verified
- The new web screens are type-checked and built, but **not clicked through by a person**.
- **ZenaaStation.exe** compiles but hasn't been run on a gaming PC. **ZenaaTV.apk** has not run on a real TV: whether the timer draws over the HDMI input depends on the TV model.
- eWeLink cloud control and HA are tested only against simulated servers.
- The PWA install prompt needs https; over plain LAN http only "Add to Home screen" is available.

## 2026-11-16 — v0.3.2 Tasmota on BASICR4 + plug finder

- Research correction: the BASICR4 (ESP32-C3) **can** be flashed with Tasmota over USB-serial (blakadder template: relay GPIO4, LED GPIO6, button GPIO9). The "secure boot" report was about the MINIR4. Tasmota is now the recommended BASICR4 route; the eWeLink LAN driver stays as the no-flashing option.
- No custom firmware or phone app is needed: Tasmota's own hotspot (192.168.4.1) does the Wi-Fi setup.
- New `GET /api/power/discover?subnet=a.b.c` (stations.manage): scans the /24 for Tasmota (`/cm?cmnd=Status 0`) and Shelly (`/shelly`) plugs and marks the ones already used by a station. The subnet defaults to the address ZENAA was opened on.
- Station form: **Find** button next to the plug IP (Tasmota/Shelly types). It picks a plug and fills the IP and type.
- New doc `docs/09-flash-tasmota-basicr4.md`; docs 06 and 08 corrected. Tests: 78 (new `discover.test.ts`).

## 2026-11-16 — v0.3.1 SONOFF BASICR4 support

- **Finding:** the BASICR4 and MINIR4 are not DIY-mode devices; SONOFF's DIY list is BASICR3, RFR3, MINIR2, MINIR3 and D1. They only offer eWeLink *LAN Control*, which encrypts commands with a per-device key. The previous *SONOFF DIY* driver therefore cannot control a BASICR4.
- **New plug type `sonoff_lan` (SONOFF R4 / eWeLink LAN):**
  - AES-128-CBC with an MD5 key derived from the device key, a random IV per command, POST to `:8081/zeroconf/switch` with automatic fallback to `switches`.
  - State is read via `info` when the device reports it. Otherwise enforcement repeats the command.
  - Clear messages for a wrong key, wrong ID, or LAN Control switched off.
  - The device key is masked like a password and kept when the form is re-saved.
- **`server/scripts/ewelink-keys.mjs`:** one-off tool that prints each device's ID and key from the user's eWeLink account, using their own dev.ewelink.cc App ID and Secret.
- **Docs:** new `docs/08-sonoff-basicr4.md` (wiring, eWeLink pairing, LAN Control, IP reservation, keys, ZENAA setup, error table); doc 06 corrected for R4.
- 76/76 tests (new: encrypted R4 round trip, wrong key, wrong ID, key masking and keeping).
- **Not verified on a real BASICR4 yet.**

## 2026-11-16 — v0.3.0 Customer portal, bookings, Paystack, SONOFF power, user types

- **Customer portal at `/portal`:**
  - Sign-up, sign-in by phone (local or international format) or email.
  - Wallet balance, points and tier, amount owed, prices, live station availability, session and wallet history.
  - Profile and password; light/dark/auto theme.
  - Customers registered at the counter activate with a **6-digit staff code** (48 h, single use). The same code resets a forgotten password, so no SMS provider is needed.
  - Staff can turn portal access off, which signs the customer out at once.
  - Customer tokens are separate from staff tokens. Login and code attempts are rate-limited.
- **Bookings:**
  - Customers book online; staff book at the desk for a customer or a contact name and phone.
  - No overlapping bookings per station; opening hours (including past midnight and 24 h); minimum notice; days ahead; at most 3 upcoming bookings per customer.
  - Optional manual confirmation.
  - **Check-in** starts the session with the customer pre-filled and links it to the booking, which becomes *completed* when the session ends.
  - Automatic **no-show** after the grace period.
  - Next-booking chip and *Check in* button on the station grid; new **Bookings** page.
- **Paystack:**
  - Wallet top-up from the portal (redirect to Paystack checkout) and **at the counter with a QR code** that the customer pays on their own phone.
  - Credited only after the server verifies the amount and currency with Paystack.
  - The return page, counter polling, **HMAC-checked webhook** and a 1-minute background sweep all funnel into one idempotent credit, so money is never credited twice.
  - Mismatches are refused and raise an alert; unpaid attempts expire after 24 h.
  - The secret key is never returned to browsers. New payment method `paystack` with reference.
- **Smart-plug power control:**
  - Drivers for **SONOFF DIY/LAN mode**, **Tasmota**, **Shelly Gen 1** and **Shelly Gen 2/3** over local HTTP, configured per station with Test / Test ON / Test OFF.
  - On at start/resume; off at end, expiry and pause (configurable), with an off-delay.
  - **Enforcement** every minute switches off stations without a session; stations in Maintenance are left alone.
  - Manual switch with the new `stations.power` permission.
  - Unreachable plugs never block billing; they show *Plug offline* and raise an alert.
  - Commands per station are serialised so a quick start→end can't arrive out of order. Plug passwords are never sent to browsers.
- **User types:** custom staff types (e.g. Supervisor, Attendant) with their own permission sets alongside Administrator, Manager and Cashier, plus per-person extra or removed permissions. Staff page renamed **Users & roles**. New permissions `bookings.manage` (cashiers by default) and `stations.power`.
- **Theme:** light / dark / auto switch in the top bar, the staff login and the portal.
- **Docs:**
  - `docs/06-sonoff-power-control.md`: what to switch (the TV, not the PS5), what to buy, network, DIY mode, Tasmota, ZENAA setup, behaviour table, safety, troubleshooting.
  - `docs/07-paystack-portal-bookings.md`.
- Migration `0003_portal_bookings_paystack_power`. **75/75 tests passing** (17 new: user types, portal auth isolation, activation codes, bookings rules and check-in, no-shows, Paystack verify, idempotency, webhook signature and mismatch, plug drivers, enforcement, unreachable plug).

### Not yet verified
- **Real Paystack** (test keys) and **real SONOFF hardware.** Both are covered by tests against faked HTTP only.
- Portal and Bookings screens are built and type-checked but have not been clicked through by a person.

## 2026-11-16 — v0.2.1 Countries, currencies & mobile money

- **Country setting:** all 54 African countries plus the USA. Choosing one pre-fills the currency, decimal places, time zone, phone prefix and mobile-money networks; each can be changed afterwards. The currency picker lists every ISO currency the browser knows. New installs default to **Ghana: GHS, Africa/Accra, +233, MTN MoMo / Telecel Cash / AT Money**.
- **Time zone from Settings:** once saved, it overrides the container's `TZ` for "today", reports and happy hours.
- **Decimal places locked:** they cannot change after any money has been recorded, so stored amounts are never re-scaled.
- **Phone numbers:** local numbers are stored internationally (`024 123 4567` → `+233241234567`), and search finds them either way.
- **Mobile money:**
  - Each payment records the network and transaction ID: at start, extend, end, split payments, tab settlement and wallet top-ups.
  - The reference appears on receipts and in the transaction list.
  - Optional setting to require the transaction ID.
- Migration `0002_payment_reference`. **58/58 tests passing.**
- **First Docker deployment verified** on the dev PC: `docker compose up -d --build` builds; Postgres 16, the app and the backup container are healthy; migrations apply on Postgres; the first backup ran; all pages serve on port 8080.

## 2026-11-16 — v0.2.0 Money operations (milestone 7b)

### Completed & verified
- **Migration `0001_money_ops`** (applied automatically on start): adds the `happy_hours` and `promo_codes` tables, customer `credit_limit`, and session promo, manual-discount, refund and tab columns. It also adds payment `refund_of_id`, payment kinds `cash_in` and `cash_out`, the shift Z-report summary, and a rule allowing only one open shift per staff member.
- **Shifts & cash drawer:**
  - Each person opens their own shift with a float, and every payment is attached to it.
  - Live X-report by payment method and type.
  - Close by counting the cash; the system records the variance and freezes the Z-report. The report is printable.
  - Managers can close other people's shifts and record cash in/out (petty cash).
  - Optional setting *require an open shift before handling money* (off by default).
- **Split payments:** start, extend, end and tab settlement all accept one method or a split across methods. A split must add up exactly to the amount owed. The UI shows change due from cash received.
- **Refunds and voids** (`payments.refund`, reason required):
  - Refund a single payment or a whole session, newest payment first.
  - Wallet-paid money always goes back to the wallet; other money can be returned by cash, card or other methods.
  - For ended prepaid sessions, the suggested refund for unused time is proportional to the whole minutes not used.
  - Refunds count against revenue and against the shift's expected cash.
- **Manual checkout discount** (`payments.discount`, reason required).
- **Pay-later tabs** (`payments.tab`):
  - A per-customer credit limit; 0 means tabs are not allowed.
  - Part-payment now, with the rest on the tab.
  - Credit limit enforced; tabs settled later in full or in part.
  - Shown on the Payments → Tabs list, the customer page and the dashboard.
- **Happy hours:**
  - Day and time windows, including windows that run past midnight, optionally per station category.
  - Applied when a session starts. The better of happy hour and member tier wins; they do not stack.
- **Promo codes:**
  - Percentage or fixed amount off, minimum spend, validity dates and a maximum number of uses.
  - Prepaid sessions take the code at the start; pay-as-you-go sessions at checkout.
  - Codes are checked live before payment.
- **Receipts:** 80 mm printable receipts (sessions, wallet payments, shift Z-reports), with a configurable header and footer. Use "Save as PDF" in the print dialog for a PDF copy.
- **Web UI:**
  - New pages: Shift & cash drawer, Payments & tabs, Promotions, Receipt.
  - Rebuilt start, extend and end dialogs; refund and settle dialogs.
  - Shift indicator in the top bar.
- **Permissions added:** `payments.refund`, `payments.discount`, `payments.tab`, `shifts.manage` (managers and admins by default; cashiers can be granted any of them).
- **Tests:** **51/51 passing**, including 10 new end-to-end money flows and 3 new billing unit tests. A manual HTTP smoke test against the running server also passed: the drawer maths was correct and every new page served.

### Not yet verified
- The web UI is type-checked and built, but **not clicked through in a browser**.
- Docker is still unverified (no Docker on the dev PC).
- Printing on a real 80 mm thermal printer is untested; it uses the browser print dialog. Direct ESC/POS printing could come later.

### Design decisions
- Happy hours and tier discounts use the server's local time (the `TZ` setting in `.env`). They are fixed when a session starts and are not re-priced if a session runs past the end of the window.
- Refunds do not take back loyalty points that were already earned.

## 2026-11-16 — v0.1.0 Foundation

### Completed & verified
- **Docs:** research and comparison matrix (iCafe Cloud, SENET, GameBiller), unified spec, architecture and OS choice (Ubuntu Server 24.04 + Docker Compose), roadmap, API reference.
- **Database:** 13 tables, versioned migration `server/drizzle/0000_init.sql`. Money is stored as integer minor units. A partial unique index enforces one open session per station.
- **Billing engine:** per-minute, hourly or any billing unit; minimum charge; grace on the last unit; packages; prepaid; postpaid; extensions; tier discounts; exact half-up rounding with integers only.
- **Sessions:**
  - Start, pause, resume, extend and end, with a rate snapshot taken at start.
  - Automatic expiry at the true expiry instant, plus configurable low-time alerts.
  - Outage recovery: sessions are paused at the last heartbeat.
- **Customers:** `ZG-000001` IDs, search, suspend/reactivate, membership tiers, loyalty points earned on spend, and an append-only wallet ledger with balance-after on every row (no negative balances).
- **Payments:** cash, card, bank transfer, mobile money and wallet. Deposits are tracked separately from revenue.
- **Staff & security:**
  - Admin, manager and cashier roles, with per-user grant/revoke of permissions.
  - Passwords hashed with scrypt; JWTs are revoked on password, role or active changes.
  - Login lockout after 5 failures for 15 min.
  - Audit trail on every state change.
- **Real time:** Socket.IO pushes changes and alerts to every signed-in device.
- **Web app:** dashboard (stats, 7-day revenue, alerts, transactions, staff activity), live station grid with timers, start/extend/end checkout dialogs, customers with wallet ledger, pricing/tiers/categories, staff and permissions, session history with timeline, audit trail, settings, dark/light theme, responsive layout.
- **Deployment:** multi-stage Dockerfile; Compose with Postgres 16, the app and a nightly backup container with rotation; `.env.example`; install, backup and restore guide.
- **Tests:** `npm test` gives **38/38 passing**: 22 billing unit tests and 16 end-to-end API flows covering auth, permissions, postpaid, prepaid, wallet, discount, extension, expiry, double-start, suspension, maintenance, outage recovery and dashboard. A manual smoke test against the running server also passed.

### Not yet verified
- The Docker image and `docker compose up` have **not** been built here, because this Windows PC has no Docker. First verification will happen on the mini PC.
- The web UI has been type-checked, built and served, but not yet clicked through in a browser.

### Outstanding (next milestones; see docs/04-roadmap.md)
1. **Money operations:** shifts and cash reconciliation, refunds/voids (with permission and audit), split payments, pay-later tabs, happy hours, promo codes, receipt printing.
2. **POS and inventory.**
3. **Reports** with Excel/PDF export.
4. **Bookings,** reserved status, group/tournament sessions.
5. **Smart hardware:** Tasmota-MQTT, Shelly and Home Assistant drivers, PS5 power safeguards. *Needs the exact plug model and firmware.*
6. **Remote access** via Tailscale.

### Known limitations
- The utilisation figure is approximate for sessions that cross midnight.
- Ending a prepaid session early does not refund unused time automatically. A refund workflow comes with milestone 1.
- No git repository yet, because git is not installed on the dev PC.
