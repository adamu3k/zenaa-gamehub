#!/bin/sh
# Nightly PostgreSQL backup with rotation. Runs inside the `backup` container.
# Files: /backups/zenaa-YYYYMMDD-HHMMSS.dump (pg_dump custom format, restorable with pg_restore).
set -eu

backup_now() {
  ts=$(date +%Y%m%d-%H%M%S)
  tmp="/backups/.zenaa-$ts.dump.partial"
  if pg_dump --format=custom --no-owner --file="$tmp"; then
    mv "$tmp" "/backups/zenaa-$ts.dump"
    echo "$(date -Iseconds) backup ok: zenaa-$ts.dump"
    find /backups -name 'zenaa-*.dump' -mtime +"${BACKUP_KEEP_DAYS}" -print -delete
  else
    rm -f "$tmp"
    echo "$(date -Iseconds) BACKUP FAILED" >&2
  fi
}

# One backup at container start (covers upgrades/restarts), then daily at BACKUP_HOUR.
backup_now
last_day=$(date +%Y%m%d)
while true; do
  sleep 300
  today=$(date +%Y%m%d)
  hour=$(date +%H | sed 's/^0//')
  if [ "$today" != "$last_day" ] && [ "${hour:-0}" -ge "${BACKUP_HOUR}" ]; then
    backup_now
    last_day=$today
  fi
done
