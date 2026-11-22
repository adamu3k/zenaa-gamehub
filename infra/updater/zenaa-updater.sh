#!/bin/sh
# ZENAA updater for Linux servers. Run it with systemd or in tmux:  sh infra/updater/zenaa-updater.sh
# Same job as zenaa-updater.ps1: watches updates/request.json, backs up, git pull, docker compose up -d --build.
root=$(cd "$(dirname "$0")/../.." && pwd)
upd="$root/updates"; bk="$root/backups"
mkdir -p "$upd" "$bk"
status() { printf '{"state":"%s","message":"%s","at":"%s"}' "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$upd/status.json"; echo "$(date -Is) $1 $2" >> "$upd/updater.log"; }
cd "$root" || exit 1
while true; do
  date -Is > "$upd/heartbeat"
  if [ -f "$upd/request.json" ]; then
    branch=$(sed -n 's/.*"branch": *"\([^"]*\)".*/\1/p' "$upd/request.json"); branch=${branch:-main}
    rm -f "$upd/request.json"
    ts=$(date +%Y%m%d-%H%M%S)
    status running "Backing up the database…"
    if docker compose exec -T db pg_dump -U zenaa --format=custom zenaa > "$bk/zenaa-before-update-$ts.dump" \
      && status running "Downloading the new version ($branch)…" && git pull --ff-only origin "$branch" >> "$upd/updater.log" 2>&1 \
      && status running "Rebuilding and restarting ZENAA…" && docker compose up -d --build >> "$upd/updater.log" 2>&1; then
      status done "Updated to $(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' server/package.json | head -1)"
    else
      status failed "Update failed — see updates/updater.log"
    fi
  fi
  sleep 15
done
