# 01 — Research & Feature Comparison

Sources examined (public pages only, 2026-11-16):

| Product | Pages read | Notes |
|---|---|---|
| iCafe Cloud | icafecloud.com home/features | Cloud admin + Windows client shell + CCBoot diskless. |
| SENET Cloud | senet.cloud/gaming-centers | Cloud platform, PC shell, console app, booking, POS. |
| GameBiller | gamebiller.com home/features | Browser-based station billing aimed at console/PS5 parlours. |

**Not used / missing:**
- The iCafe "demo" link is a live client session URL for a specific café (`icafe_id=7789`), not public documentation. It was deliberately not used.
- No SENET demo link was supplied.
- No public material describes any vendor's internal database or API, so the data model in this project is designed independently.
- The brief's "Cinet Cloud / GameVilla" is treated as SENET Cloud / GameBiller.

## 1. Feature comparison matrix

Legend: ● strong · ◐ partial / basic · ○ not offered or not described publicly

| Area | iCafe Cloud | SENET | GameBiller | Best implementation |
|---|---|---|---|---|
| Live dashboard / floor view | ● live PC layout, second screen | ● interactive floor map | ● live station dashboard, timers synced across devices | GameBiller (multi-device sync) + iCafe (floor layout) |
| Console (PS5) stations | ◐ via TV/plug control | ◐ "console app" | ● first-class: PS5, Xbox, VR, pool, sims | **GameBiller** |
| Start / pause / resume / end | ● | ● | ● with double-start conflict protection | **GameBiller** |
| Prepaid / postpaid / offers | ● prepaid, postpaid, member, offer, free | ◐ rates, passes | ● rate card, intervals, happy hours | **iCafe** (session types) + GameBiller (rate card) |
| Pre-expiry warnings & auto-stop | ● | ◐ | ● (TV lock on Done) | **iCafe** |
| Zone / per-station pricing | ● zones, member-group prices | ◐ unified pricing | ● per-seat, custom slots | iCafe |
| Members, wallet, bonus balance | ● balance + bonus + points + hours | ● balance + bonus | ● prepaid wallets, hour packs | **iCafe** |
| Loyalty | ● points, cashback, top-up rewards, lucky spin | ● points + tiers | ◐ points → discounts | iCafe / SENET tiers |
| Booking | ● portal, seat picker | ● app + booking calendar | ● public booking page, approval flow | **GameBiller** (no app required) |
| POS / bar / inventory | ◐ shop page | ● in-seat ordering, stock control, combos | ● snacks on bill, live stock, service income | SENET + GameBiller |
| Payments | ◐ | ● gateways | ● cash/card/UPI/split, pay-later tabs with limits | **GameBiller** |
| Tax invoices / receipts | ○ | ○ | ● tax lines, thermal / PDF / WhatsApp receipts | **GameBiller** |
| Staff roles & audit | ◐ staff filters in reports | ◐ | ● roles + activity timeline + shift handoff | **GameBiller** |
| Reports & export | ● income, top-ups, offers, products, shift filters, month-over-month | ● real-time analytics | ● revenue by day/type, peak hours, utilisation, Excel/PDF, expenses → profit | **GameBiller** + iCafe shift filters |
| Smart plug / TV control | ● Sonoff / Raspberry Pi / iCafeTV scheduled TV on/off | ○ | ● Tuya plug on Start/Done; Android-TV lock app | iCafe (multi-driver) |
| Tournaments | ● leaderboards, coin prizes | ○ | ● brackets, fees, payouts to ledger | GameBiller |
| PC shell / game library / diskless | ● iCafeMenu, licence pool, CCBoot | ● shell, SENET Boot | ◐ PC lock | iCafe (out of scope for PS5 venue) |
| Deployment | Cloud only | Cloud only | Hosted web app | **ZENAA: local server, works offline** |

## 2. Strongest features to carry into ZENAA GAMEHUB

1. **Double-start protection and live timers synced across devices** (GameBiller). Enforced in the database, not just the UI.
2. **Session types: prepaid, postpaid, packages and member pricing** (iCafe), plus **rate cards** with billing units, minimums and grace periods (GameBiller).
3. **Pre-expiry warnings and automatic expiry** (iCafe).
4. **Wallets with a full ledger, bonus balance and loyalty tiers** (iCafe/SENET).
5. **Cash vs non-cash split, shift handoff and an activity timeline per cashier** (GameBiller).
6. **Smart-power actions tied to session start/end** (iCafe/GameBiller), made safe for PS5 (see the architecture doc).
7. **Booking with approval, stock-linked POS, and expenses feeding true profit** (GameBiller/SENET).
8. **Reports with shift/staff filters, month-over-month comparison and Excel/PDF export** (iCafe/GameBiller).

## 3. Where ZENAA deliberately differs

- **Local-first.** All three references depend on a vendor cloud. ZENAA runs entirely on your mini PC and keeps billing when the internet is down.
- **No subscription.** Everything is open source. The references charge per PC per month (iCafe: USD 2.50–4.00) or USD 10/month (GameBiller).
- **Power-failure accounting.** If the server goes down, running sessions are paused at the last heartbeat, so customers are not billed for time when nothing was working.
- **Out of scope for now:** diskless boot, PC shells and game-licence pools. These matter for PC cafés, not a PS5 venue. The data model still allows PC stations to be added later.
