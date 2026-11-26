# 28 — Online server with only Docker + Cloudflare Tunnel (no Coolify)

The simplest setup: a Linux server (Ubuntu 22.04/24.04) with Docker, ZENAA from GitHub, and Cloudflare Tunnel for the domain and HTTPS. No panel to learn, and nothing opened on the router.

```
Phone ──https──► Cloudflare ──tunnel──► cloudflared ──► ZENAA app (port 8080) ──► Postgres + nightly backup
```

## 1. Install Docker and get ZENAA

On the server (over SSH):

```sh
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER      # then log out and back in
git clone https://github.com/adamu3k/zenaa-gamehub.git
cd zenaa-gamehub
sh tools/server-setup.sh
```

`server-setup.sh`:
- creates `.env` with new random secrets (database password, login key),
- asks for the first admin username and password, the time zone and the port (default **8080**; choose another, e.g. 18080, if 8080 is taken),
- builds and starts ZENAA, then waits until it answers.

Check it: `curl http://localhost:8080/api/health` should print `{"ok":true,…}`. On the venue network it's also at `http://<server-ip>:8080`.

## 2. Cloudflare Tunnel: choose one way

### Way A: cloudflared installed on the server (what we use)
1. Cloudflare → **Networking → Tunnels → Create a tunnel → Cloudflared**. Give it a name, e.g. `zenaa server`.
2. Pick **Debian/Ubuntu**, copy the install command Cloudflare shows (`sudo cloudflared service install eyJ…`) and run it on the server. The tunnel shows **Healthy**.
3. **Routes → Add route → Published application**, for each name:
   - Hostname: `zenaamegagames.online` (then `www`, and `zenaa.adamun8n.online` if you like)
   - Service URL: **`http://localhost:8080`** (or the port you chose)

### Way B: cloudflared in Docker next to ZENAA
1. Create the tunnel as in Way A, but **copy only the token** (the long `eyJ…` text).
2. Add it to ZENAA's `.env`:
   ```
   TUNNEL_TOKEN=eyJ...
   ```
3. Start ZENAA together with the tunnel:
   ```sh
   docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d
   ```
4. In the tunnel's **Routes**, set every hostname's Service URL to **`http://app:8080`**. Inside Docker the app is called `app` and always listens on 8080, whatever `APP_PORT` is.

With Way B you can even remove the `ports:` line from `docker-compose.yml`, so ZENAA isn't reachable on the network at all, only through Cloudflare.

## 3. Cloudflare DNS: check the records

For each hostname, **DNS → Records** must show type **Tunnel** (CNAME → `<tunnel-id>.cfargotunnel.com`, orange cloud).

If an **A** record or an old **CNAME** (e.g. `parkingpage.namecheap.com`) is there, **Edit** it: change it to **CNAME**, set the target to `<tunnel-id>.cfargotunnel.com`, and **Save**. Otherwise you get Cloudflare errors **522/525**. Leave MX and TXT (email) records alone.

## 4. First sign-in
Open `https://zenaamegagames.online`, sign in as admin and change the password. Then delete the `ADMIN_PASSWORD=` line in `.env` and run `docker compose up -d`.

## 5. Everyday commands (in the `zenaa-gamehub` folder)

| Task | Command |
|---|---|
| Update to the newest version | `sh tools/server-setup.sh` (git pull + rebuild; data and `.env` are kept) |
| See if it's running | `docker compose ps` |
| App log | `docker compose logs app --tail 50` |
| Restart | `docker compose restart app` |
| Stop / start | `docker compose down` / `docker compose up -d` (with Way B, add both `-f` files) |
| Backups | the `backups/` folder: nightly `.dump` files plus ZENAA's `.json.gz` |

Don't run `docker compose down -v`: the `-v` **deletes the database**.

## 6. Problems

| What you see | Fix |
|---|---|
| `port is already allocated` | Set another `APP_PORT` in `.env`, run `docker compose up -d`, and change the tunnel route (Way A) |
| Cloudflare 522 / 525 | The DNS record isn't the tunnel. See step 3 |
| Cloudflare 502 | The route's Service URL is wrong: `localhost:<APP_PORT>` for Way A, `app:8080` for Way B |
| App keeps restarting | `docker compose logs app`: usually `ADMIN_PASSWORD` shorter than 8 characters on a new install |
