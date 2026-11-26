# 29 — Other ways to run the server: Portainer, Dockge, CasaOS, Dokploy

All of these run the same ZENAA Docker setup. They only change **how you click it into place**. Cloudflare Tunnel works the same with every one: the tunnel route points at `http://localhost:<port>` (cloudflared installed on the server) and the DNS records must be type **Tunnel** (guide 28, steps 2–3).

| Panel | Good for | Updating ZENAA |
|---|---|---|
| **Coolify** (guide 27) | Builds from GitHub, domains, auto-deploy, backups to S3 | Redeploy button / automatic |
| **Only Docker** (guide 28) | Simplest, nothing extra to run | `sh tools/server-setup.sh` |
| **Portainer** | Seeing and managing every container in a web page | Stack → Pull and redeploy |
| **Dockge** | A small, simple page for compose stacks | Terminal `git pull`, then Dockge → Update |
| **CasaOS** | Home-server style app dashboard | Like Dockge |
| **Dokploy** | Like Coolify, lighter | Redeploy |

Use **one** of them for ZENAA, not two at the same time, or you'll have two databases.

---

## Portainer

### Install (once)
```sh
docker volume create portainer_data
docker run -d --name portainer --restart=always -p 9443:9443 \
  -v /var/run/docker.sock:/var/run/docker.sock -v portainer_data:/data \
  portainer/portainer-ce:lts
```
Open `https://<server-ip>:9443` and create the Portainer admin within 5 minutes. To reach it from outside, add a tunnel route such as `portainer.adamun8n.online` → `https://localhost:9443`, and turn on **No TLS Verify** in that route's additional settings.

### Add ZENAA as a stack
1. Portainer → **Stacks → + Add stack**. Name: `zenaa`.
2. Build method: **Repository**.
   - Repository URL: `https://github.com/adamu3k/zenaa-gamehub`
   - Reference: `refs/heads/main`
   - Compose path: **`docker-compose.server.yml`**
3. **Environment variables** (click *Add an environment variable* for each one):

   | Name | Value |
   |---|---|
   | `SERVICE_PASSWORD_POSTGRES` | a long random password, e.g. from `openssl rand -hex 24` |
   | `SERVICE_PASSWORD_64_JWT` | a 64-character random value: `openssl rand -hex 32` |
   | `ADMIN_PASSWORD` | 8+ characters, for the first sign-in |
   | `APP_PORT` | `18080` (or any free port) |
   | `TZ` | `Africa/Accra` |

   Write the first two down somewhere safe and **never change them**: the database is locked with the first, and changing the second signs everyone out.
4. Optional: turn on **GitOps updates** (polling, e.g. every 5 minutes) so new versions on GitHub deploy by themselves.
5. **Deploy the stack.** The first build takes a few minutes.
6. Tunnel route → `http://localhost:18080`.

**Update:** Stacks → zenaa → **Pull and redeploy**, or let GitOps do it.
**Logs:** Containers → `zenaa-app-1` → Logs.

If Portainer can't build from the repository on your setup, use Dockge or the terminal method (guide 28). They build from a normal folder.

---

## Dockge

### Install (once)
```sh
sudo mkdir -p /opt/stacks /opt/dockge && cd /opt/dockge
sudo curl -fsSL https://raw.githubusercontent.com/louislam/dockge/master/compose.yaml -o compose.yaml
sudo docker compose up -d
```
Open `http://<server-ip>:5001` and create the admin.

### Add ZENAA
```sh
cd /opt/stacks
sudo git clone https://github.com/adamu3k/zenaa-gamehub.git zenaa
cd zenaa && sudo sh tools/server-setup.sh
```
The script creates `.env` and starts ZENAA. Dockge then lists the **zenaa** stack, where you can start, stop, read logs and edit `.env`.

**Update:** `cd /opt/stacks/zenaa && sudo git pull`, then in Dockge click **Update** (or run `sudo sh tools/server-setup.sh` again).

---

## CasaOS

Install: `curl -fsSL https://get.casaos.io | sudo bash`. Then open `http://<server-ip>`.

CasaOS imports compose files but can't build ZENAA from source. So set ZENAA up from the terminal as in guide 28 (`sh tools/server-setup.sh`); CasaOS then shows the running containers for starting, stopping and logs.

---

## Dokploy

Install: `curl -sSL https://dokploy.com/install.sh | sh` (it uses ports 80, 443 and 3000). It works like Coolify:
- **Create Service → Compose**, provider **GitHub/Git**, repository `https://github.com/adamu3k/zenaa-gamehub`, branch `main`, compose path `./docker-compose.server.yml`.
- **Environment:** the same variables as the Portainer table.
- Deploy, then point the tunnel route at `http://localhost:18080`.

---

## Which one should I use?

- Already on **Coolify** and it works: stay there (guide 27).
- You want the least to learn: **only Docker** (guide 28). Add **Portainer** later if you want a page to look at the containers; Portainer can manage stacks it didn't create, with limited control.
- You want a simple panel for a home or venue server: **Dockge**.
