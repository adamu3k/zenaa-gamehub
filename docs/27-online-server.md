# 27 — Running ZENAA on an online server (Coolify or any Linux server)

ZENAA can run on a rented server (VPS) instead of, or as well as, the PC at the venue. Customers then reach the app from anywhere at your own web address with HTTPS.

## A. With Coolify (recommended if you have it)

1. In Coolify: **+ New → Public Repository**, paste `https://github.com/adamu3k/zenaa-gamehub`, branch `main`.
2. **Build pack: Docker Compose**. Base directory `/`. Docker Compose location **`/docker-compose.server.yml`**. Continue.
3. **Environment Variables** tab:
   - `ADMIN_PASSWORD`: the password for the first sign-in, at least 8 characters. `ADMIN_USERNAME` is `admin` unless you set it.
   - `TZ`: leave as `Africa/Accra` or set your time zone.
   - Coolify fills in `SERVICE_PASSWORD_POSTGRES` and `SERVICE_PASSWORD_64_JWT` by itself. **Never change them after the first start**: the database is locked with the first one, and changing the second signs everyone out.
4. **Domains**: in the **app** service, set your domain, e.g. `https://zenaa.adamun8n.online`. Coolify gets the HTTPS certificate.
5. **Deploy**. The first build takes 3–6 minutes. Then open your domain and sign in as `admin`.
6. After signing in: change the password (Staff), then delete `ADMIN_PASSWORD` in Coolify.

**Cloudflare:** if the domain's DNS record is proxied (orange cloud), set Cloudflare **SSL/TLS → Full (strict)**. *Flexible* causes an endless redirect loop.

**Updates:** after you upload a new version with `tools\ZENAA-publish-update.cmd`, press **Redeploy** in Coolify, or turn on automatic deploy (GitHub webhook) so it updates by itself. The data stays in the Docker volumes. The **Update now** button inside ZENAA is for the venue PC's updater and does nothing on Coolify.

**Backups:** a database dump is made every night into the `zenaa-backups` volume, and the app's own `.json.gz` backups go there too. Download them from **Backup & updates** in ZENAA. Coolify's own *Backups* feature can also copy the database to S3.

## B. Any Linux server with Docker (no Coolify)

```sh
curl -fsSL https://get.docker.com | sh          # only if Docker isn't installed
git clone https://github.com/adamu3k/zenaa-gamehub.git
cd zenaa-gamehub
sh tools/server-setup.sh
```

The script makes `.env` with new random secrets, asks for the first admin password, time zone and port, then builds and starts ZENAA on port 8080. Put HTTPS in front of it (Caddy, Nginx or a Cloudflare Tunnel). **To update later, run `sh tools/server-setup.sh` again**: it downloads the newest code and rebuilds, keeping `.env` and the data.

## C. Moving your venue data to the server

1. On the venue PC: **Backup & updates → Download everything (1 file)**.
2. On the server: sign in as admin → **Backup & updates → Restore from file…** → choose that file → type `RESTORE`.
3. Sign in again with your usual account.

After this the server and the venue PC are **two separate copies**. Pick one to use from then on, so money and sessions are not split between them.

## D. What an online server can't reach

The server is on the internet, not on your venue's network. So:

- Things that **connect out** to ZENAA keep working once you point them at the new address: TV/PC/console screens and agents, the MoMo relay phone, eWeLink (cloud) plugs, Telegram/Facebook, Paystack, Web Push.
- Things ZENAA must **reach inside the venue** won't work from the server without a VPN (e.g. Tailscale): local Tasmota/MQTT plugs, VNC to the PCs, and waking or switching off PCs on the LAN.

If you run the venue's machines from ZENAA, keep ZENAA on the venue PC. You can still use a Cloudflare Tunnel to put that PC's ZENAA online.
