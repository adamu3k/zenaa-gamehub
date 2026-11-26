# 27 — Online server with Coolify + Cloudflare Tunnel

This is the setup ZENAA runs on now: a Linux server at the venue (or a rented VPS) with **Coolify**, and **Cloudflare Tunnel** putting it on the internet with HTTPS. No ports are opened on the router.

Other ways to run it:
- **Only Docker (no panel) + Cloudflare Tunnel:** guide 28.
- **Portainer, Dockge or another panel:** guide 29.

## How it fits together

```
Customer's phone ──https──► Cloudflare ──tunnel──► cloudflared (on the server) ──► localhost:18080 ──► ZENAA app
                                                                                             └──► Postgres + nightly backup
```

- **Cloudflare** holds the domains and the HTTPS certificate.
- **cloudflared** runs on the server and keeps an outgoing connection to Cloudflare, so nothing has to be opened on the router.
- **Coolify** builds ZENAA from GitHub and runs it: the app, the database and the backup job.
- ZENAA listens on the server's own port, **18080** in our setup. The tunnel sends each domain to `http://localhost:18080`.

### Our current setup

| What | Value |
|---|---|
| Coolify panel | `https://cool.adamun8n.online` → tunnel → `http://localhost:8000` |
| ZENAA | `https://zenaamegagames.online`, `https://www.zenaamegagames.online`, `https://zenaa.adamun8n.online` → tunnel → `http://localhost:18080` |
| Inside the venue | `http://<server-ip>:18080` |
| Cloudflare tunnel name | `zenaa server` |
| Coolify compose file | `/docker-compose.server.yml` |
| Port setting | `APP_PORT=18080` (8080 was already used by something else on the server) |

## A. First-time setup

### 1. Coolify: create the app
1. Coolify → **+ New → Public Repository** → `https://github.com/adamu3k/zenaa-gamehub`, branch `main`.
2. **Build pack: Docker Compose.** Base directory `/`.
3. **Docker Compose Location: `/docker-compose.server.yml`.** This step matters. If it's left as `/docker-compose.yml`, the build fails with *"POSTGRES_PASSWORD is missing a value"*, because that file is for the venue PC.
4. Save, then click **Reload Compose File**.

### 2. Coolify: Environment Variables

| Variable | Value | Notes |
|---|---|---|
| `ADMIN_PASSWORD` | 8 or more characters | Only used for the very first sign-in. Avoid `$` in it, or tick **Is Literal**: Coolify treats `$` as the start of a variable and shortens the password. |
| `APP_PORT` | `18080` | The port ZENAA opens on the server. Pick any free one; 8080 was taken on ours. |
| `TZ` | `Africa/Accra` | Optional. |
| `SERVICE_PASSWORD_POSTGRES`, `SERVICE_PASSWORD_64_JWT` | (made by Coolify) | **Never change these after the first start.** The database is locked with the first one; changing the second signs everyone out. |

### 3. Coolify: Domains

With Cloudflare Tunnel going straight to port 18080, Coolify's own domains are not strictly needed. If you set them anyway (for its proxy), use **`http://`**, not `https://`, and set **Redirect HTTP to HTTPS** to **Disabled**. Cloudflare already does HTTPS; if Coolify does it too, the page redirects forever.

Coolify may show **"DNS doesn't match"** for the domains. With a tunnel that's expected; ignore it.

### 4. Deploy
Click **Deploy**. The first build takes 3–6 minutes. Afterwards `http://<server-ip>:18080/api/health` should answer `{"ok":true,…}`.

### 5. Cloudflare Tunnel: routes
Cloudflare → **Networking → Tunnels → zenaa server → Routes → Add route → Published application**:

| Hostname | Service URL |
|---|---|
| `zenaamegagames.online` | `http://localhost:18080` |
| `www.zenaamegagames.online` | `http://localhost:18080` |
| `zenaa.adamun8n.online` | `http://localhost:18080` |
| `cool.adamun8n.online` | `http://localhost:8000` (the Coolify panel) |

`localhost` is correct because cloudflared is installed **on the server itself**, outside Coolify. If cloudflared runs in a Docker container instead, see guide 28.

### 6. Cloudflare DNS: point each name at the tunnel
For every hostname above, Cloudflare → that domain → **DNS → Records** must show type **Tunnel** (a CNAME to `<tunnel-id>.cfargotunnel.com`), proxied (orange cloud).

**If an old A record or CNAME already exists for that name, the tunnel can't create its own, and Cloudflare keeps sending visitors to the old address.** This is what happened to us: `zenaamegagames.online` was an A record to `162.255.119.138` and `www` was a CNAME to `parkingpage.namecheap.com`, both Namecheap's parking page. The fix was to **Edit** each record, change it to **CNAME** with target `<tunnel-id>.cfargotunnel.com`, and **Save**. The tunnel ID is shown under Tunnels → zenaa server → Overview.

Leave **MX** and **TXT** records alone; they are for email.

### 7. First sign-in
1. Open your domain and sign in as `admin` with `ADMIN_PASSWORD`.
2. Change the password: Staff → your account.
3. You can now remove `ADMIN_PASSWORD` in Coolify (from v1.2.1 an empty value is fine).

### 8. Bring the venue data across (optional)
1. On the venue PC: **Backup & updates → Download everything (1 file)**.
2. On the server: **Backup & updates → Restore from file…**, choose that file and type `RESTORE`.

After that, use only the server, so money and sessions aren't split between two copies.

## B. Updating

1. On the PC with the code, double-click `tools\ZENAA-publish-update.cmd`. It checks the code, uploads it to GitHub and raises the version.
2. In Coolify, press **Redeploy**, or turn on automatic deploy (a GitHub webhook) so it updates by itself.

Your data stays in the Docker volumes (`zenaa-pgdata`, `zenaa-backups`). The **Update now** button inside ZENAA is for the venue PC's updater and does nothing on Coolify.

## C. Backups
- Every night a database dump is saved in the `zenaa-backups` volume (kept 14 days), along with ZENAA's own `.json.gz` backups.
- Download them from **Backup & updates** in ZENAA.
- For an off-server copy, use Coolify's **Backups** (to S3 or Cloudflare R2), or download a backup now and then.

## D. Problems we hit, and the fixes

| What you see | Cause | Fix |
|---|---|---|
| Build fails: *POSTGRES_PASSWORD / JWT_SECRET is missing a value* | Coolify used `docker-compose.yml` | Docker Compose Location → `/docker-compose.server.yml`, then Reload Compose |
| Status **Restarting**; app log says *ADMIN_PASSWORD must contain at least 8 character(s)* | Password empty, too short, or cut short at a `$` | Set an 8+ character password (tick Is Literal if it has `$`) and redeploy |
| Deploy fails: *Bind for 0.0.0.0:8080 failed: port is already allocated* | Another program on the server uses 8080 | Add `APP_PORT=18080` (or another free port), redeploy, and point the tunnel routes at that port |
| Bare IP `http://<server-ip>` shows Coolify's **503** page | Normal: Coolify's proxy chooses the app by domain name | Use `http://<server-ip>:18080` or the domain |
| Cloudflare **522** or **525** | The DNS record is an old A/CNAME, not the tunnel | Part A, step 6 |
| Cloudflare **502 Bad gateway** | The tunnel works but nothing answers on the route's port | Check the route's Service URL port matches `APP_PORT` and the app is running |
| **Too many redirects** | Coolify domain set to `https://`, or its HTTP→HTTPS redirect is on | Use `http://` domains and turn the redirect off |
| Coolify says **DNS doesn't match** | Expected with a tunnel | Ignore |

## E. What a server can't reach in the venue

ZENAA on the server can still reach things on the same network as the server. If the server is somewhere else (a rented VPS), anything ZENAA has to reach **inside** the venue needs a VPN such as Tailscale: local Tasmota/MQTT plugs, VNC to the PCs, and switching PCs on or off. Things that connect **out** to ZENAA work from anywhere once pointed at the new address: TV/PC screens and agents, the MoMo relay phone, eWeLink plugs, Paystack, Telegram and Facebook.
