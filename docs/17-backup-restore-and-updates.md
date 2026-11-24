# 17 — Backups, moving to a new PC, and one-click updates

## 1. Backups

ZENAA keeps **two kinds** of backup in the `backups` folder next to ZENAA on the server PC:

| File | Made by | Use it to |
|---|---|---|
| `zenaa-auto-….json.gz` | The app, every 24 h by default (Settings → Backups) | Restore from **Backup & updates** with one click, on this PC or a new one |
| `zenaa-YYYYMMDD-….dump` | The database backup container, every night at 03:00 | Full database restore with `pg_restore` (advanced) |

**Download everything now:** menu → **Backup & updates** → **Download everything (1 file)**. The `.json.gz` file contains every customer, wallet, session, payment, shift, tournament, setting, staff account and PIN.

> The backup contains customer phone numbers and money records. Keep it private: don't post it in WhatsApp groups.

### Automatic copies to Google Drive / OneDrive / Dropbox

The simplest way to get backups into the cloud is to let the cloud app sync the backups folder:

1. Install **Google Drive for desktop** (or OneDrive / Dropbox) on the server PC and sign in.
2. Google Drive: choose **Mirror files**, so the files exist on the PC (the default "stream" drive `G:` can't be used by Docker).
3. Create a folder inside it, e.g. `C:\Users\<you>\My Drive\ZENAA backups`.
4. Open the ZENAA `.env` file and add:
   ```
   BACKUP_PATH=C:/Users/<you>/My Drive/ZENAA backups
   ```
5. Run `docker compose up -d` in the ZENAA folder. New backups now appear in Google Drive automatically.

Check after a day that new files show up on drive.google.com.

### If the server PC dies

Backups do not keep ZENAA running while the PC is off. They let you get everything back on another PC in about 20 minutes:

1. Install Docker Desktop and ZENAA on the new PC (README → "Install").
2. Sign in with the first admin from `.env`.
3. **Backup & updates → Restore from file…** → choose the newest `.json.gz` (from Google Drive) → type `RESTORE`.
4. Sign in again with your usual account. Re-pair the screens if the PC's IP address changed (station tokens keep working if the address is the same).

To keep downtime short, keep the old PC's IP address on the new PC (router → DHCP reservation). The TVs, PCs, consoles and MoMo phone then reconnect by themselves.

### Backing up only some parts (v0.9.5)

**Backup & updates → Choose parts…** makes a smaller file with only the parts you tick:

| Part | What is in it |
|---|---|
| Settings, staff & user types | All settings, staff accounts, passwords, PINs, user types |
| Stations, prices & promotions | Stations, categories, pricing plans, memberships, happy hours, promo codes |
| Customers, sessions & money | Customers, wallets, sessions, payments, shifts, bookings, MoMo inbox, saved time, SMS queue |
| Games, leaderboard, tournaments & Find match | Games, match results, tournaments and their players, Find match requests |
| News, chat, rewards & social posts | News & posters, customer chat, rewards and claims, Social drafts and posts |
| Audit trail | The audit trail |

**Restoring a part file works differently from a full restore:**

- It **adds and updates** the rows in the file. It does **not** delete anything else on the PC. (A full backup replaces everything.)
- Some parts need others. For example, sessions belong to stations, and match results belong to customers. If the other PC does not have them, the restore stops, **nothing is changed**, and the message says which parts to restore too. The **Choose parts** window warns you about this before you download.
- A row that clashes with a different row on the other PC (e.g. the same phone number on a different customer) also stops the restore with nothing changed.
- When you restore from a file, the restore window shows what is in the file, and you can tick only some of its parts.

Typical uses:

- Copy your **prices and promotions** to a second branch: download *Stations, prices & promotions* and restore it there.
- Keep a small daily copy of **customers and money** on your phone or in WhatsApp-to-self (keep it private).
- Move only the **leaderboard and tournaments** to a new install that already has the same customers.

### Moving everything to a new PC — checklist

What a backup **does not** contain, and what you must copy by hand:

| Item | Why it matters | What to do |
|---|---|---|
| The **`.env` file** in the ZENAA folder | Holds `JWT_SECRET`. Staff **PINs** and the **station screen apps' sign-in** are tied to it. With a new secret, every PIN must be set again and every station screen re-paired. | Copy the old `.env` to the new PC **before** the first start. Keep a copy somewhere safe (it is a secret: not on GitHub, not in group chats). |
| `BACKUP_PATH` cloud folder | Where automatic backups go | Point the new PC's `.env` at the same Google Drive / OneDrive folder. |
| The PC's **IP address** | TVs, PCs, consoles, the MoMo phone and smart plugs talk to it | Give the new PC the old address (router → DHCP reservation), or re-pair the devices. |
| Smart plug firmware / Wi-Fi | Stored in the plugs, not in ZENAA | Nothing to do if the Wi-Fi is the same. |
| HTTPS certificate / tunnel (if you set one up) | Customer portal over the internet | Set it up again (Help → 14). |

Steps:

1. Old PC: **Backup & updates → Download everything (1 file)**. Also copy the ZENAA folder's `.env` file to a USB stick.
2. New PC: install Docker Desktop and ZENAA (README → Install). Put the old `.env` in the ZENAA folder **before** running `docker compose up -d`.
3. Sign in with the admin from `.env`, open **Backup & updates → Restore from file…**, choose the file, keep every part ticked, type `RESTORE`.
4. Sign in again with your usual account. Check: a staff PIN works, a station screen shows "connected", the customer list and today's money look right.
5. Leave the old PC switched off (two servers with the same address confuse the devices).

**Test your backups.** Once a month, restore the newest backup on a spare PC or laptop (any Windows PC with Docker). A backup you never tried is a hope, not a backup.

### Restore rules

- A **full** restore **replaces all data**. A **part** restore only adds and updates the parts you tick. Either way ZENAA first saves a safety copy (`zenaa-before-restore-….json.gz`).
- A backup from a **newer** ZENAA can't be restored on an older one. Update first.
- A backup from an **older** ZENAA restores fine; new fields get their default values.

---

## 2. Updates

Once the project is on GitHub, a new version installs with **one click**: Backup & updates → **Update now**. It takes 2–5 minutes, and screens and timers reconnect by themselves.

ZENAA runs inside Docker and can't rebuild itself, so a small **updater** runs on the server PC and does it.

### First-time setup (once): put ZENAA on your GitHub

You need a free GitHub account (github.com) and **Git for Windows** (git-scm.com → Download → install with the default options).

1. **Create an empty repository.** On github.com: **+** (top right) → **New repository**.
   - Name: `zenaa-gamehub`.
   - Visibility: **Private** (recommended). Nobody else can see your code or download your apps.
   - Do **not** tick *Add a README*, .gitignore or licence.
   - Press **Create repository**, then copy the **HTTPS** address, e.g. `https://github.com/yourname/zenaa-gamehub.git`.
2. In the ZENAA folder, double-click **`tools\ZENAA-GitHub-setup.cmd`**:
   - paste the address;
   - type your name;
   - press Enter to keep your email private (it uses `yourname@users.noreply.github.com`).
3. A window asks you to sign in to GitHub. Choose **Sign in with your browser** and approve. Git for Windows remembers this, so you only sign in once.
4. The setup saves and uploads everything. Refresh your repository page on GitHub and the files are there.
   - **Never uploaded:** `.env` (passwords), the app signing keys (`*.keystore`), `backups\`, `node_modules`. The setup checks this and stops if one would be uploaded.
5. In ZENAA: **Settings → Updates → GitHub repository**: `yourname/zenaa-gamehub`, branch `main` → **Save settings**.
6. Install the updater on the server PC (it starts with Windows from then on):
   ```
   powershell -ExecutionPolicy Bypass -File infra\updater\install-updater.ps1
   ```
7. **Backup & updates** should show **Updater on the PC: Running**.

**Another server PC** (a second branch, or a new PC) gets ZENAA from GitHub:
```
git clone https://github.com/yourname/zenaa-gamehub.git
```
Then copy `.env` from your first PC (or create a new one from `.env.example`), run `docker compose up -d --build`, and do steps 5–7 above.

### Publishing an update (after you or a developer change ZENAA)

1. Raise `version` in `server/package.json` and `web/package.json`, e.g. 0.7.0 → 0.7.1. Servers only see *update available* when the number goes up.
2. Double-click **`tools\ZENAA-publish-update.cmd`**. It shows the changed files, asks for a short note, uploads everything and tags the version (`v0.7.1`).
3. On every ZENAA server: **Backup & updates → Check now → Update now** (see below).

If the server is this same PC, the change is already running once it has been rebuilt with `docker compose up -d --build`. Uploading keeps a safe copy and the history on GitHub, and lets other PCs update.

### Each update

1. Backup & updates → **Check now**. If a newer version exists, the release notes appear.
2. **Update now**. The updater:
   1. backs up the database (`backups\zenaa-before-update-….dump`);
   2. runs `git pull`;
   3. runs `docker compose up -d --build`.
3. The page shows *running → done* (or *failed* with the reason; the details are in `updates\updater.log`).

The version check reads `server/package.json` on GitHub, so **raise the version number** in every release. For private repositories the "Check now" button can't see GitHub. **Update now** still works, because the updater on the PC uses your Git sign-in.

Linux servers: run `infra/updater/zenaa-updater.sh` as a service instead.

### Releasing a new version (for whoever develops ZENAA)

1. Raise `version` in `server/package.json` and `web/package.json`.
2. Add a `DEVELOPMENT_LOG.md` entry, commit and push to `main`.
3. Optionally create a GitHub **Release**. Its text is shown as the release notes.
4. Commit the app downloads too (`web/public/downloads/*.exe`, `*.apk`) and the console payloads (`server/console/*.elf`), because the server image ships them. Never commit `.env` or the `.keystore` files.
