#!/bin/sh
# ZENAA GAMEHUB - set up (or update) ZENAA on a Linux server with Docker, without Coolify.
#
#   git clone https://github.com/adamu3k/zenaa-gamehub.git && cd zenaa-gamehub && sh tools/server-setup.sh
#
# First run: makes .env with new random secrets, asks for the first admin password, builds and starts ZENAA.
# Later runs: downloads the newest code from GitHub and rebuilds (your data and .env are kept).
set -eu
cd "$(dirname "$0")/.."

say() { printf '%s\n' "$*"; }
fail() { say ""; say "STOPPED: $*"; exit 1; }
rand() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

say ""
say "=== ZENAA GAMEHUB - server setup ==="
command -v docker >/dev/null 2>&1 || fail "Docker is not installed. Install it with:  curl -fsSL https://get.docker.com | sh"
docker compose version >/dev/null 2>&1 || fail "Docker Compose is missing (install the docker-compose-plugin package)."

if [ -f .env ]; then
  say "Found .env - keeping your settings and data."
  if [ -d .git ]; then
    say "Getting the newest code from GitHub..."
    git pull --ff-only || fail "Could not update the code (local changes?). Run: git status"
  fi
else
  say "First start: creating .env with new random secrets."
  printf 'Username for the first admin [admin]: '
  read -r admin_user || true
  admin_user=${admin_user:-admin}
  while :; do
    printf 'Password for the first admin (at least 8 characters): '
    stty -echo 2>/dev/null || true
    read -r admin_pass || true
    stty echo 2>/dev/null || true
    say ""
    [ "${#admin_pass}" -ge 8 ] && break
    say "Too short - try again."
  done
  printf 'Time zone [Africa/Accra]: '
  read -r tz || true
  tz=${tz:-Africa/Accra}
  printf 'Port for the web app [8080]: '
  read -r port || true
  port=${port:-8080}
  umask 077
  cat > .env <<EOF
# Made by tools/server-setup.sh. Never upload this file.
POSTGRES_PASSWORD=$(rand 40)
JWT_SECRET=$(rand 64)
ADMIN_USERNAME=$admin_user
# Only used on the very first start. Delete this line after you sign in and change the password.
ADMIN_PASSWORD=$admin_pass
TZ=$tz
APP_PORT=$port
BACKUP_HOUR=3
BACKUP_KEEP_DAYS=14
EOF
  say "Saved .env (only this server can read it)."
fi

mkdir -p backups updates
# The app runs as user 1000 inside the container and writes its backups here.
chown 1000:1000 backups updates 2>/dev/null || chmod 777 backups updates

say "Building and starting ZENAA (the first build takes a few minutes)..."
docker compose up -d --build

port=$(grep -E '^APP_PORT=' .env | cut -d= -f2)
port=${port:-8080}
say "Waiting for ZENAA to start..."
i=0
until curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -ge 60 ] && fail "ZENAA did not start. See:  docker compose logs app --tail 50"
  sleep 2
done
say ""
say "ZENAA is running:  http://$(hostname -I 2>/dev/null | awk '{print $1}'):$port"
say "Put a domain with HTTPS in front of it (Caddy, Nginx, Cloudflare Tunnel) - the app's notifications and camera need HTTPS."
say "To update later: run this script again."
