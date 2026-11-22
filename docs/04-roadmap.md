# 04 — Development Roadmap

| # | Milestone | Contents | Status |
|---|---|---|---|
| 1–3 | Research, analysis, unified spec | docs 01–02 | ✅ |
| 4 | Architecture & OS | doc 03 | ✅ |
| 5 | Core database schema + migrations | staff, audit, settings, stations, categories, plans, tiers, customers, wallet ledger, sessions, session events, payments, shifts | ✅ |
| 6–7a | **Foundation app** | auth + RBAC, audit, stations, pricing, billing engine, sessions (start/pause/resume/extend/end, auto-expiry, warnings, outage recovery), customers + wallet, dashboard, real-time UI, Docker Compose, backups | ✅ (this release) |
| 7b | Money operations | shifts & cash reconciliation, refunds/voids/adjustments, split payments, pay-later tabs, happy-hour rules, promo codes, receipt printing (80 mm thermal / PDF) | ✅ (v0.2.0) |
| 7c′ | Portal, bookings, Paystack, power, user types | customer portal (sign-up, activation codes, wallet, bookings), desk bookings + check-in + no-shows, Paystack wallet top-ups (portal + counter QR, verified + webhook), SONOFF DIY / Tasmota / Shelly power control with enforcement, custom staff user types, light/dark/auto theme | ✅ (v0.3.0) |
| 7c | POS & inventory | products, categories, stock, sales on bill, low-stock alerts, profit | ⏳ next |
| 7d | Reports | per station/customer/staff, peak hours, durations, monthly, Excel + PDF export | ⏳ |
| 7e | Groups & tournaments | group/tournament sessions, booking deposits via Paystack | ⏳ (bookings done in v0.3) |
| 8 | Hardware | HTTP drivers for SONOFF DIY, Tasmota, Shelly ✅ (v0.3). Still to do: MQTT push state, Home Assistant, power-usage logs, schedules | 🔨 — confirm your plug model on site |
| 9 | Testing | billing property tests, end-to-end flows, permission matrix, backup restore drill | 🔨 continuous |
| 10 | Deployment | Ubuntu install guide, Tailscale, UPS, upgrade/rollback procedure | 🔨 guide drafted in README |
