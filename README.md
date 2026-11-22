# ZENAA GAMEHUB

Self-hosted gaming-centre management and billing: stations, live session timers, prepaid/postpaid billing, customer wallets, memberships, shifts and refunds, bookings, an installable customer app (`/portal`), Paystack online payments, smart-plug power control (SONOFF, Tasmota, Shelly, ESPHome, Home Assistant, eWeLink cloud, custom HTTP/DIY), **leaderboards, tournaments and Find match**, **station screen apps** for Android TV and Windows PCs (timer on screen, lock when time is up), a venue TV board (`/board`), staff user types and permissions, audit trail, in-app help, and a live dashboard. It runs on a local mini PC and keeps working without internet (only Paystack needs internet).

| Folder | Contents |
|---|---|
| `server/` | Node.js + TypeScript API, billing engine, scheduler, migrations (`server/drizzle`) and tests |
| `web/` | React web app (served by the server in production) |
| `infra/` | Backup script, MQTT config (Phase 8) |
| `agents/` | Station screen apps: `windows/` (ZenaaStation.exe) and `android-tv/` (ZenaaTV.apk) |
| `docs/` | Research, specification, architecture, roadmap, API |
| `DEVELOPMENT_LOG.md` | What's done, what's next |

---

## A. Install on the mini PC (production)

### 1. Install Ubuntu Server 24.04 LTS
1. Download *Ubuntu Server 24.04 LTS* from ubuntu.com and write it to a USB stick with **Rufus** or **balenaEtcher** (on your Windows PC).
2. Boot the mini PC from USB and install. Choose **"Install OpenSSH server"**, use the whole 250 GB SSD, and create your user (e.g. `zenaa`).
3. On your router, make a **DHCP reservation** so the mini PC always gets the same IP (e.g. `192.168.1.10`).
4. In the mini PC's BIOS, set **"Restore on AC power loss" → Power On** so it boots by itself after a power cut.

From here on, run commands **on the mini PC**: either at its keyboard, or over SSH from your Windows PC with `ssh zenaa@192.168.1.10` in PowerShell.

### 2. Install Docker (on the mini PC)
```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install ca-certificates curl git unattended-upgrades
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
sudo dpkg-reconfigure -plow unattended-upgrades   # choose "Yes" for automatic security updates
# log out and back in (or reboot) so the docker group takes effect
```

### 3. Copy the project to the mini PC
Run this from **your Windows PC**, in PowerShell, in the folder that contains `zenaa-gamehub`:
```powershell
scp -r zenaa-gamehub zenaa@192.168.1.10:~/
```
(When the project lives in a git repository, you will `git clone` it instead.)

### 4. Configure (on the mini PC)
```bash
cd ~/zenaa-gamehub
cp .env.example .env
openssl rand -base64 48     # run twice: one value for POSTGRES_PASSWORD, one for JWT_SECRET
nano .env                   # paste both secrets, set TZ (e.g. Africa/Lagos) and ADMIN_PASSWORD
```

### 5. Start
```bash
docker compose up -d --build
docker compose ps           # app, db, backup should be "running"/"healthy"
docker compose logs -f app  # Ctrl+C to stop following
```
Open **http://192.168.1.10:8080** from any phone, tablet or PC on the venue Wi-Fi and sign in as `admin`.

### 6. First-time setup in the web app
1. **Settings:** set the centre name and **currency** (NGN, GHS…) *before* taking any payments.
2. **Settings → Change my password.** Then remove the `ADMIN_PASSWORD` line from `.env`.
3. **Pricing & tiers:** create at least one pricing plan, plus optional categories (e.g. VIP) and membership tiers.
4. **Stations:** add each PS5 (code `PS-01`, name, platform).
5. **Staff:** create cashier and manager accounts. Never share the admin login.

---

## B. Operating

| Task | Command (on the mini PC, in `~/zenaa-gamehub`) |
|---|---|
| Status | `docker compose ps` |
| Logs | `docker compose logs --tail 200 app` |
| Restart | `docker compose restart app` |
| Stop everything | `docker compose down` (data is kept) |
| Update to a new version | copy the new files, then `docker compose up -d --build`. A backup runs automatically when the backup container restarts, and DB migrations apply automatically on start |

**Never** run `docker compose down -v`. The `-v` deletes the database volume.

### Backups
- A backup is taken automatically every night (at `BACKUP_HOUR`) and on every start, into `~/zenaa-gamehub/backups/`. The last 14 days are kept.
- **Copy backups off the machine regularly** (USB drive or a cloud folder). A backup on the same SSD does not survive a disk failure.
- Manual backup now: `docker compose restart backup`

### Restore a backup
```bash
docker compose stop app
docker compose exec -T db dropdb -U zenaa zenaa
docker compose exec -T db createdb -U zenaa zenaa
docker compose exec -T db pg_restore -U zenaa -d zenaa --no-owner < backups/zenaa-YYYYMMDD-HHMMSS.dump
docker compose start app
```
Test a restore once a month, so you know it works before you need it.

### Power cuts
- PostgreSQL is crash-safe. When power returns, the PC boots (BIOS setting) and Docker restarts every container.
- Running sessions are **paused at the moment the server went down**. Prepaid sessions that would have finished during the outage are closed at their real end time.
- Staff see an alert and resume the sessions. Customers are not charged for downtime.
- A small UPS on the mini PC and router is strongly recommended.

---

## C. Development (Windows or any OS with Node.js 22+)

No Docker or PostgreSQL is needed for development. An embedded PostgreSQL (PGlite) is used automatically.

Run this in one terminal, starting from the `zenaa-gamehub` folder:
```powershell
cd server
npm install
$env:JWT_SECRET="dev-secret-dev-secret-dev-secret-0001"; $env:ADMIN_PASSWORD="admin12345"; npm run dev   # API on :8080
```
Run this in a second terminal, also starting from the `zenaa-gamehub` folder:
```powershell
cd web
npm install
npm run dev        # UI on http://localhost:5173 (proxies to :8080)
```

Tests, run from the `server` folder:
```powershell
npm test           # billing engine and end-to-end API flows against a real embedded PostgreSQL
npm run typecheck
```

Schema change workflow: edit `server/src/db/schema.ts`, run `npm run db:generate`, and commit the new SQL file in `server/drizzle/`. It is applied automatically on the next start.

## Documentation
- [01 Research & comparison](docs/01-research-and-comparison.md)
- [02 Product specification](docs/02-product-specification.md)
- [03 Architecture & OS](docs/03-architecture.md)
- [04 Roadmap](docs/04-roadmap.md)
- [05 API reference](docs/05-api.md)
- [06 SONOFF smart plugs — automatic station power](docs/06-sonoff-power-control.md)
- [07 Paystack, customer portal & bookings](docs/07-paystack-portal-bookings.md)
- [08 SONOFF BASICR4 with eWeLink — setup](docs/08-sonoff-basicr4.md)
- [09 Flash Tasmota onto the BASICR4 (recommended)](docs/09-flash-tasmota-basicr4.md)
- [10 Leaderboard, tournaments and Find match](docs/10-leaderboard-tournaments-find-match.md)
- [11 Smart devices catalog — every SONOFF, other brands, DIY, custom](docs/11-smart-devices-catalog.md)
- [12 SONOFF with eWeLink: just IP + device ID?](docs/12-ewelink-without-device-key.md)
- [13 Station screen apps (Android TV, Windows) and the PS5](docs/13-station-screen-apps.md)
- [14 Customer app on the home screen & the https link](docs/14-install-portal-app-https.md)
- [15 Complete setup checklist & troubleshooting index](docs/15-setup-checklist-and-troubleshooting.md)
- [16 Timer on jailbroken PS4 / PS5 consoles](docs/16-ps4-ps5-console-timer.md)
- [17 Backups, moving to a new PC, one-click updates](docs/17-backup-restore-and-updates.md)
- [18 MoMo top-ups without a gateway, and Paystack explained](docs/18-momo-without-gateway-and-paystack.md)
- [19 Staff PINs, user types, admin unlock, finance, shifts, news](docs/19-staff-pins-roles-finance.md)

All guides are also inside the app: **Help & guides** (searchable).

## Licence

MIT. See [LICENSE](LICENSE). The ZMG / ZENAA MEGA GAMES name, logos and brand pictures in `web/public/brand/` are trademarks of ZENAA MEGA GAMES and are not covered by the MIT licence.

