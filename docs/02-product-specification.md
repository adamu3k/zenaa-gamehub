# 02 — Unified Product Specification

Status markers track implementation: ✅ done & tested · 🔨 in progress · ⏳ planned.
The live status is maintained in `DEVELOPMENT_LOG.md`.

## A. Dashboard
- ✅ Station counts: total, available, in use, paused, maintenance, offline
- ✅ Revenue today / this week / this month (revenue = session + extension + POS payments − refunds; wallet deposits are a liability, not revenue)
- ✅ Active sessions, today's utilisation %, 7-day revenue chart
- ✅ Recent transactions, recent staff activity, alerts (sessions ending soon, stations down)
- ⏳ Reserved count (with Bookings)

## B. Stations
- ✅ Unlimited stations: code, name, platform (PS5, PS4, Xbox, Switch, PC, VR, racing sim, other), category, sort order
- ✅ Per-station hourly rate override
- ✅ Status: active / maintenance / offline / archived (archived keeps history)
- ✅ Start, pause, resume, extend and end sessions, with live timers on every connected device
- ✅ One open session per station, enforced by a database unique index
- ⏳ Group / tournament sessions (start several stations under one group bill)

## C. Billing engine
All money is stored as **integers in minor units** (kobo/pesewas/cents). There is no floating-point money.
- ✅ Time rate plans: rate per hour, billing unit (1 = per minute, 60 = hourly, any N), minimum minutes, grace period on the final partial unit
- ✅ Package plans: fixed minutes for a fixed price; extensions charged at the plan's hourly rate
- ✅ Prepaid (pay up front; ends automatically when time runs out) and postpaid (open timer; pay at checkout)
- ✅ Extensions, automatic termination, configurable pre-expiry warnings
- ✅ Membership-tier percentage discounts (rate snapshot frozen at session start)
- ✅ Payment methods: cash, card, bank transfer, mobile money, wallet
- ✅ Power-failure recovery: on restart, sessions are paused at the last server heartbeat, and prepaid sessions that expired during the outage are closed at their real expiry time
- ⏳ Time-of-day / happy-hour rules, promo codes
- ⏳ Refunds, voids and adjustments (with permission and audit), pay-later tabs with credit limits, split payments
- ⏳ Daily cash reconciliation per shift

## D. Customers
- ✅ Registration, profile, unique ID (`ZG-000001`), phone/email, notes
- ✅ Wallet with an append-only ledger (deposit, withdrawal, charge, refund, adjustment) and a balance-after on every row
- ✅ Membership tiers (discount %, loyalty earn rate), loyalty points earned on spend
- ✅ Suspension (blocks new sessions and wallet charges), search by name, phone or ID
- ✅ Session and spending history per customer
- ⏳ Points redemption, bonus balance, top-up rewards

## E. Smart hardware (Phase 8)
- ⏳ Driver model: **Tasmota-MQTT** (recommended), **Shelly Gen2 HTTP**, **Home Assistant REST**, **manual**
- ⏳ Assign a device to a station with a role: `tv`, `console`, `accessory` or `light`
- ⏳ Online/offline monitoring, device log, manual override, schedules
- ⏳ Session start → power on; session end → warning, then a delayed power off
- ⏳ **PS5 safeguard:** a device with role `console` is never switched off automatically. A manual off requires confirmation, and with a power-metering plug it is refused while the draw is above the rest-mode threshold.

## F. POS & inventory (Phase 7b)
- ⏳ Products, categories, stock movements, sales on a session bill or standalone, receipts, low-stock alerts, cost price → profit

## G. Staff
- ✅ Admin / manager / cashier roles, per-user grant/revoke of permissions, deactivate, password reset
- ✅ Audit trail of every state-changing action (who, what, when, details)
- ✅ Login lockout after repeated failures; sessions revoked on password change
- ⏳ Shifts (opening float, expected vs counted cash), attendance

## H. Reports
- ⏳ Revenue per station / customer / employee, session durations, most-used stations, peak hours, daily cash, monthly, product sales; export to Excel (xlsx) and PDF

## I. Remote management
- ✅ Web app served by the mini PC, responsive for phones and tablets, live updates over WebSocket
- ⏳ Secure remote access from outside the venue (Tailscale recommended, so no router ports are opened)
- ⏳ Multi-location (the schema leaves room for a `location_id`)
