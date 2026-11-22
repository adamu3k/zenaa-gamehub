# 05 — REST API Reference (v0.1)

**Base:** `http://<server>:8080`. Bodies are JSON.
**Auth:** every call except `/api/auth/login` and `/api/health` needs `Authorization: Bearer <token>`.
**Money:** integer minor units (e.g. `150000` = 1,500.00).
**Errors:** `{ "error": "<code>", "message": "<human readable>" }`, with status 400 (validation), 401, 403, 404, 409 (conflict, e.g. double start or insufficient balance), 429 (login lockout) or 500.

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /api/health` | — | Liveness |
| `POST /api/auth/login` `{username,password}` | — | Returns `{token, staff}`. 5 failures → 15-min lockout |
| `GET /api/auth/me` | signed in | Current user and permissions |
| `POST /api/auth/change-password` `{currentPassword,newPassword}` | signed in | Revokes old tokens and returns a new one |
| `GET /api/permissions` | staff.manage | Permission catalogue and role defaults |
| `GET/POST /api/staff`, `PATCH /api/staff/:id`, `POST /api/staff/:id/reset-password` | staff.manage | Staff CRUD |
| `GET /api/stations` | stations.view | Stations with live status and open session (`serverTime` included) |
| `POST /api/stations`, `PATCH /api/stations/:id` | stations.manage | Create/edit. Status can't change while a session is open |
| `GET/POST /api/station-categories`, `PATCH …/:id` | view / stations.manage | Categories |
| `GET /api/pricing-plans` | stations.view | Plans |
| `POST /api/pricing-plans`, `PATCH …/:id` | pricing.manage | Plans are validated (grace < unit, package fields) |
| `GET /api/membership-tiers` | customers.view | Tiers |
| `POST/PATCH /api/membership-tiers` | pricing.manage | Tiers |
| `POST /api/sessions` | sessions.operate | Start: `{stationId, planId, billingType: prepaid\|postpaid, customerId?, minutes?, paymentMethod?}` |
| `POST /api/sessions/:id/pause` / `resume` | sessions.operate | Pause or resume |
| `POST /api/sessions/:id/extend` `{minutes, paymentMethod}` | sessions.operate | Prepaid only |
| `POST /api/sessions/:id/end` `{paymentMethod?}` | sessions.operate | Postpaid: payment required if anything is owed |
| `GET /api/sessions/:id` | stations.view | Live quote (`activeSeconds`, `remainingSeconds`, `balanceDue`) and event timeline |
| `GET /api/sessions?from&to&stationId&customerId&limit` | stations.view | History |
| `GET /api/customers?q&limit` | customers.view | Search by name, phone, email or `ZG-000001` |
| `POST /api/customers`, `PATCH /api/customers/:id` | customers.manage | Create/edit/suspend (`status`) |
| `GET /api/customers/:id` | customers.view | Profile, stats, wallet ledger, sessions |
| `POST /api/customers/:id/wallet` `{operation: deposit\|withdrawal\|adjustment, amount, method?, note?}` | wallet.deposit / withdraw / adjust | Wallet operations |
| `GET /api/dashboard` | stations.view (revenue needs reports.view) | Live overview |
| `GET /api/audit?before&staffId&limit` | audit.view | Audit trail |
| `GET /api/settings` / `PUT /api/settings` | signed in / settings.manage | Centre name, currency, warning minutes |

**Real time:** connect Socket.IO at path `/socket.io` with `auth: { token }`. The server emits `event` messages of these types:
- `sessions.changed`
- `stations.changed`
- `customers.changed`
- `payments.changed`
- `power.changed` with `{stationId}`
- `bookings.changed`
- `alert` with `{level, message}`

## v0.3 additions

| Endpoint | Permission | Purpose |
|---|---|---|
| `GET/POST /api/staff-roles`, `PATCH/DELETE /api/staff-roles/:id` | staff.manage | Custom user types `{name, description, permissions[]}`. Staff get `roleId` |
| `GET /api/bookings?from&to&stationId&customerId&status` | stations.view | Bookings (`status` comma-separated) |
| `POST /api/bookings` `{stationId, startAt, minutes, customerId? | contactName, contactPhone?, note?}` | bookings.manage | Desk booking |
| `POST /api/bookings/:id/confirm|cancel|no_show` `{reason?}` | bookings.manage | Change status |
| `POST /api/sessions` `{…, bookingId}` | sessions.operate | Starting a session with `bookingId` checks the booking in |
| `POST /api/customers/:id/portal-code` | customers.manage | 6-digit activation / password-reset code (48 h, single use) |
| `PATCH /api/customers/:id` `{portalEnabled}` | customers.manage | Turn portal access off/on (signs the customer out) |
| `GET/PUT /api/integrations/paystack`, `POST …/test` | settings.manage | Paystack keys (secret never returned) |
| `GET /api/paystack/status` | signed in | Is Paystack enabled? |
| `POST /api/customers/:id/paystack` `{amount, email}` | wallet.deposit | Counter top-up → `{reference, authorizationUrl, qr}` |
| `GET /api/paystack/payments/:reference` | customers.view | Verify with Paystack and return the status |
| `GET /api/paystack/payments` | reports.view | Online payment list |
| `POST /api/paystack/webhook` | Paystack signature | `charge.success` → verified and credited once |
| `POST /api/stations/:id/power` `{on}` | stations.power | Manual plug switch |
| `POST /api/power/test` `{driver, config, action}` | stations.manage | Test a plug before saving |
| `GET /api/power/discover?subnet=192.168.1` | stations.manage | Scan the network for Tasmota/Shelly plugs (subnet defaults to the one ZENAA was opened on) |
| `PATCH /api/stations/:id` `{powerDriver, powerConfig: {host, deviceId?, channel?, username?, password?}}` | stations.manage | Plug settings (password never returned) |

**Customer portal** (`/api/portal/*`, customer token `typ: customer`):
- `GET info` (public)
- `POST signup`, `POST login {login, password}`, `POST activate {phone, code, password}`
- `GET/PATCH me`, `POST me/password`
- `GET stations`, `GET prices`
- `GET availability?start&minutes`
- `GET/POST bookings`, `POST bookings/:id/cancel`
- `POST topup {amount, email}`
- `GET payments/:reference` (public by reference)


## v0.4 — competitions, station screens, more plugs, docs

| Endpoint | Permission | Purpose |
|---|---|---|
| `DELETE /api/stations/:id` | stations.manage | Delete a station (removed if never used, otherwise hidden with history kept) → `{removed: 'deleted' \| 'hidden'}` |
| `GET /api/stations/archived` | stations.manage | Archived (not deleted) stations |
| `GET/POST /api/games`, `PATCH /api/games/:id` | signed in / competitions.manage | Games `{name, shortName, scoring: goals\|points\|rounds, allowDraws, active}` |
| `GET /api/leaderboard?gameId&period=all\|month\|week&sort=rating\|points\|wins\|goals\|winrate` | signed in | Ranked players, highlights, totals |
| `GET /api/matches?gameId&customerId&tournamentId&limit` | signed in | Latest results |
| `GET /api/head-to-head?gameId&a&b` | signed in | Head-to-head record |
| `POST /api/matches` `{gameId, homeId, awayId, homeScore, awayScore, withResult?}` | competitions.manage | Friendly (with or without a score) |
| `PUT /api/matches/:id/result` `{homeScore, awayScore, homePens?, awayPens?, walkoverWinnerId?}` | competitions.manage | Record/correct a result (advances tournaments) |
| `POST /api/matches/:id/clear`, `DELETE /api/matches/:id` | competitions.manage | Clear a result / delete a friendly |
| `GET/POST /api/tournaments`, `GET/PATCH/DELETE /api/tournaments/:id` | signed in / competitions.manage | Tournaments (format knockout\|league\|groups_knockout, groups, prizes…) |
| `POST /api/tournaments/:id/status` `{status: draft\|registration\|cancelled}` | competitions.manage | Open/close registration, cancel |
| `POST /api/tournaments/:id/start` `{shuffle}` | competitions.manage | Lock players, draw groups/bracket, create fixtures |
| `POST /api/tournaments/:id/entries` `{customerId}` or `{newPlayer: {fullName, phone?, gamertag?}}` | competitions.manage | Add player |
| `PATCH/DELETE /api/tournaments/:id/entries/:entryId` `{seed, paid, paidNote, chargeWallet}` | competitions.manage | Seed, entry fee, remove |
| `POST /api/tournaments/:id/entries/:entryId/prize` `{method: wallet\|cash\|mobile_money\|bank_transfer\|other}` | competitions.manage (+ wallet.adjust for wallet) | Pay a prize |
| `GET /api/matchmaking?gameId`, `POST /api/matchmaking/requests`, `POST /api/matchmaking/pair` `{requestId, opponentId}`, `POST /api/matchmaking/requests/:id/cancel` | signed in / competitions.manage | Find match (staff) |
| `POST /api/stations/:id/agent-code` | stations.manage | 6-digit pairing code for a screen app (10 min) |
| `DELETE /api/stations/:id/agent` | stations.manage | Unpair all screens of a station |
| `POST /api/stations/:id/agent-message` `{text}` | sessions.operate | Message on the station screen |
| `POST /api/agent/pair` `{code, kind: pc\|android_tv, name, version}` | public (code) | → `{token, station}` (token `typ: agent`) |
| `GET /api/agent/state` | agent token | `{phase: idle\|running\|warning\|paused\|maintenance, lock, screenOff, session{remainingSeconds…}, message, exitPinHash, dock{style: island\|corner, weather{tempC, icon, label}\|null}}` |
| `GET /api/agent/console` | agent token | Same state as plain text `key=value` lines (phase, remaining, elapsed, station, player, msgid, msg, weather, center) — used by the PS4/PS5 payload |
| `POST /api/stations/:id/console-push` `{platform: ps4\|ps5, host, port=9021, serverUrl}` | stations.manage | Writes a station token into the payload and sends it to the console's ELF loader (502 if unreachable) |
| `GET /api/stations/:id/console-payload?platform=&serverUrl=` | stations.manage | Same payload as a download (`zenaa-<code>-<platform>.elf`) |
| `GET /api/integrations/ewelink`, `POST …/import` `{appId, appSecret, login, password, countryCode, region?}`, `POST …/locate` `{subnet?}`, `DELETE …` | stations.manage / settings.manage | eWeLink device import (keys stay on the server), LAN locate |
| `GET /api/docs`, `GET /api/docs/:file` | signed in | In-app Help & guides |

**Plug types** (`powerDriver`): `sonoff_lan`, `sonoff_diy`, `ewelink_cloud`, `tasmota`, `shelly_gen1`, `shelly_gen2`, `esphome`, `home_assistant`, `generic_http`. Extra `powerConfig` fields: `entityId`, `token`*, `onUrl`, `offUrl`, `statusUrl`, `method`, `onBody`, `offBody`, `contentType`, `authHeader`*, `statusOnMatch` (* secret: never returned, `hasToken`/`hasAuthHeader` instead; blank keeps the stored value).

**Public** (no sign-in; needs Settings → leaderboard public): `GET /api/public/games`, `/api/public/leaderboard`, `/api/public/results`, `/api/public/tournaments`, `/api/public/tournaments/:id`.

**Portal** (customer token): `GET /api/portal/competitions/games|leaderboard|me|head-to-head`, `GET /api/portal/tournaments[/:id]`, `POST /api/portal/tournaments/:id/register|withdraw`, `GET/POST /api/portal/matchmaking`, `POST /api/portal/matchmaking/:id/accept|cancel`, `POST /api/portal/matches/:id/report {myScore, opponentScore}|confirm|dispute`, `GET /api/portal/players?q=`. `PATCH /api/portal/me` also takes `gamertag`, `psnId`, `leaderboardHidden`.


## v0.6 — PINs, staff unlock, MoMo without gateway, news, finance, backups, updates

| Endpoint | Permission | Purpose |
|---|---|---|
| `POST /api/auth/pin` `{password, pin}` | signed in | Set your own PIN (4–8 digits; easy/duplicate PINs refused) |
| `POST /api/auth/pin/check` `{pin}` | signed in | Who does this PIN belong to |
| `POST /api/staff/:id/pin` `{pin \| null}` | staff.manage | Set/remove someone's PIN |
| `GET /api/pin-actions` | signed in | Actions that Settings can require a PIN for |
| *PIN gate* | — | Cash in/out, refunds, manual discount, wallet withdraw/adjust, shift close, staff unlock, MoMo confirm accept `pin` in the body. **428 `pin_required`** = ask for a PIN and retry; **403 `pin_wrong`**; 429 after 5 wrong PINs. Someone with the permission can approve for someone without it (`payments.approved_by`, audit `approvedBy`). |
| `POST /api/stations/:id/bypass` `{minutes (0 = until off, max 12 h), reason}` / `DELETE` | stations.bypass (or PIN) / sessions.operate | Turn on with no charge (plug on, screens unlocked, no session) |
| `POST /api/agent/unlock` `{pin, action: unlock\|lock\|exit, minutes}` | agent token + staff PIN with stations.bypass | Staff unlock from the PC/TV app |
| `GET /api/agent/state` | agent token | + `phase: staff`, `bypass{until, remainingSeconds}`, `dock.scale` (40–100) |
| `GET /ps`, `POST /ps` (form) | staff PIN (stations.manage or stations.bypass) | Console browser page: sends the PS4/PS5 timer to the requesting console |
| `GET/POST /api/portal/momo`, `GET /api/portal/momo/:id`, `POST …/:id/txn {txnId}`, `POST …/:id/cancel` | customer | MoMo top-up with a reference code; status polling |
| `GET /api/momo/requests?status=`, `GET /api/momo/sms?status=` | momo.confirm | MoMo inbox |
| `POST /api/momo/requests/:id/confirm {txnId?}` / `reject {reason}`, `POST /api/momo/sms/:id/assign {customerId}` / `ignore` | momo.confirm (+ PIN if set) | Confirm by hand / credit an unclaimed SMS |
| `POST /api/momo/relay/code`, `POST /api/momo/relay/link`, `GET /api/momo/relay`, `DELETE /api/momo/relay/:id` | settings.manage | Pair the MoMo phone / webhook link for SMS-forwarder apps |
| `POST /api/momo/relay/pair {code, device}` | public (code) | → `{token}` for the ZENAA MoMo app |
| `POST /api/momo/sms` `{from, body}` (also `sender/text/message/msg`) | relay token (Bearer or `?token=`) | Forwarded SMS → `{status: credited\|unmatched\|ignored, reason?}` |
| `GET/POST /api/posts`, `PATCH/DELETE /api/posts/:id` | content.manage | News, events, promos (image as data URL ≤ 1.5 MB) |
| `GET /api/public/news`, `GET /api/posts/:id/image` | public | Live posts + social links; post image |
| `GET /api/qr?text=` | public | QR code SVG (posters) |
| `GET /api/finance/summary?from&to`, `GET /api/finance/export.csv?from&to` | finance.view | Finance page; every payment as CSV |
| `GET /api/finance/categories` | signed in | Cash in/out categories |
| `GET /api/system/info` | signed in | Version, backup folder, last auto backup, updater status |
| `GET /api/system/backup` | system.backup | Download everything (`.json.gz`) |
| `POST /api/system/restore?confirm=RESTORE[&file=]` (body: the file) | system.backup | Replace all data (safety copy first) |
| `GET /api/system/backups`, `GET /api/system/backups/:name`, `POST /api/system/backups/run` | system.backup | Backup folder |
| `GET /api/system/update/check`, `POST /api/system/update` | system.update | Compare with GitHub; hand the update to the PC updater |
| `POST /api/portal/matches/:id/lobby {lobbyCode}` | customer (player) | Room ID / password for an online match |

`POST /api/shifts/:id/close` also takes `countedBreakdown {"200": 3, …}` and `countedMomo`. `POST /api/shifts/cash-movement` takes `category`. Match requests take `lobbyCode`. Customers have `eaId`.
