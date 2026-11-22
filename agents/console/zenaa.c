/*
 * ZENAA Console — station timer for jailbroken PS4 and PS5 consoles.
 *
 * Runs in the background as an ELF payload (sent to the console's ELF loader on port 9021, or with one click
 * from ZENAA: Stations → ✏️ → Station screen → Console). It asks the ZENAA server for this station's state
 * every few seconds and shows system notifications on top of the game:
 *   - session started (with the time bought),
 *   - time left every few minutes, and at 5 and 1 minute(s),
 *   - messages typed by staff ("Your friend is waiting at the counter"),
 *   - "Time is up" (repeated a few times) when the session ends.
 * Power is still cut by the smart plug if one is set; this payload only informs the player.
 *
 * Configuration (server address + station token) is written into the CONFIG block below by the ZENAA server
 * when it sends or downloads the payload. Alternatively, put the same lines in /data/zenaa/config.txt:
 *     url=http://192.168.1.10:8080
 *     token=eyJ...
 *
 * Only one copy runs: a new copy asks the old one (127.0.0.1:9077) to quit, so re-sending updates it.
 *
 * Build: agents/console/build.ps1 (Docker) — uses the ps4-payload-sdk / ps5-payload-sdk.
 */
#include <arpa/inet.h>
#include <netdb.h>
#include <netinet/in.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

#ifndef ZENAA_PLATFORM
#define ZENAA_PLATFORM "ps5"
#endif
#define ZENAA_VERSION "1.0.0"
#define CONTROL_PORT 9077

/* ZENAA writes "url=...\ntoken=...\n" after the marker (1 KiB block). volatile: read at run time. */
static volatile char CONFIG[1024] = "@@ZENAA_CONFIG_V1@@";

typedef struct notify_request {
  char useless1[45];
  char message[3075];
} notify_request_t;

int sceKernelSendNotificationRequest(int, notify_request_t *, size_t, int);

static char g_url_host[128], g_url_path[64], g_token[1024];
static int g_url_port = 80;

static void notify(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
static void notify(const char *fmt, ...) {
  notify_request_t req;
  va_list ap;
  memset(&req, 0, sizeof req);
  va_start(ap, fmt);
  vsnprintf(req.message, sizeof req.message, fmt, ap);
  va_end(ap);
  sceKernelSendNotificationRequest(0, &req, sizeof req, 0);
  printf("[zenaa] %s\n", req.message);
}

/* ───────────── config ───────────── */

static void trim(char *s) {
  size_t n = strlen(s);
  while (n && (s[n - 1] == '\r' || s[n - 1] == '\n' || s[n - 1] == ' ')) s[--n] = 0;
}

static int parse_url(const char *url) {
  const char *p = url;
  if (strncmp(p, "http://", 7) == 0) p += 7;
  else if (strncmp(p, "https://", 8) == 0) return -1; /* consoles talk plain http on the LAN */
  const char *end = p + strcspn(p, ":/");
  size_t hl = (size_t)(end - p);
  if (!hl || hl >= sizeof g_url_host) return -1;
  memcpy(g_url_host, p, hl);
  g_url_host[hl] = 0;
  g_url_port = 80;
  if (*end == ':') g_url_port = atoi(end + 1);
  const char *path = strchr(end, '/');
  snprintf(g_url_path, sizeof g_url_path, "%s", path ? path : "");
  trim(g_url_path);
  size_t pl = strlen(g_url_path);
  if (pl && g_url_path[pl - 1] == '/') g_url_path[pl - 1] = 0;
  return g_url_port > 0 && g_url_port < 65536 ? 0 : -1;
}

static void apply_config_text(const char *text) {
  char line[1200];
  const char *p = text;
  while (*p) {
    size_t n = strcspn(p, "\n");
    if (n >= sizeof line) n = sizeof line - 1;
    memcpy(line, p, n);
    line[n] = 0;
    trim(line);
    if (strncmp(line, "url=", 4) == 0) parse_url(line + 4);
    else if (strncmp(line, "token=", 6) == 0) snprintf(g_token, sizeof g_token, "%s", line + 6);
    p += n;
    if (*p == '\n') p++;
  }
}

static int load_config(void) {
  char block[sizeof CONFIG + 1];
  for (size_t i = 0; i < sizeof CONFIG; i++) block[i] = CONFIG[i];
  block[sizeof CONFIG] = 0;
  apply_config_text(block);
  FILE *f = fopen("/data/zenaa/config.txt", "r");
  if (f) {
    char buf[2048];
    size_t n = fread(buf, 1, sizeof buf - 1, f);
    buf[n] = 0;
    fclose(f);
    apply_config_text(buf);
  }
  return g_url_host[0] && g_token[0] ? 0 : -1;
}

/* ───────────── single instance ───────────── */

static int control_fd = -1;

static void take_over(void) {
  struct sockaddr_in a;
  memset(&a, 0, sizeof a);
  a.sin_family = AF_INET;
  a.sin_port = htons(CONTROL_PORT);
  a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  for (int attempt = 0; attempt < 10; attempt++) {
    control_fd = socket(AF_INET, SOCK_STREAM, 0);
    int one = 1;
    setsockopt(control_fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
    if (bind(control_fd, (struct sockaddr *)&a, sizeof a) == 0 && listen(control_fd, 2) == 0) return;
    close(control_fd);
    /* An older copy is running: ask it to quit, then try again. */
    int c = socket(AF_INET, SOCK_STREAM, 0);
    if (connect(c, (struct sockaddr *)&a, sizeof a) == 0) send(c, "QUIT\n", 5, 0);
    close(c);
    sleep(1);
  }
  control_fd = -1;
}

/* Returns 1 if a newer copy asked us to quit. Non-blocking check. */
static int should_quit(void) {
  if (control_fd < 0) return 0;
  fd_set rf;
  struct timeval tv = {0, 0};
  FD_ZERO(&rf);
  FD_SET(control_fd, &rf);
  if (select(control_fd + 1, &rf, NULL, NULL, &tv) <= 0) return 0;
  int c = accept(control_fd, NULL, NULL);
  if (c < 0) return 0;
  char buf[8] = {0};
  struct timeval rt = {1, 0};
  setsockopt(c, SOL_SOCKET, SO_RCVTIMEO, &rt, sizeof rt);
  recv(c, buf, sizeof buf - 1, 0);
  close(c);
  return strncmp(buf, "QUIT", 4) == 0;
}

/* ───────────── http ───────────── */

/* GET path; fills body (NUL-terminated). Returns the HTTP status or -1. */
static int http_get(const char *path, char *body, size_t cap) {
  struct sockaddr_in a;
  memset(&a, 0, sizeof a);
  a.sin_family = AF_INET;
  a.sin_port = htons((unsigned short)g_url_port);
  if (inet_pton(AF_INET, g_url_host, &a.sin_addr) != 1) {
    struct hostent *h = gethostbyname(g_url_host);
    if (!h || !h->h_addr_list[0]) return -1;
    memcpy(&a.sin_addr, h->h_addr_list[0], sizeof a.sin_addr);
  }
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) return -1;
  struct timeval tv = {6, 0};
  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
  setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof tv);
  if (connect(fd, (struct sockaddr *)&a, sizeof a) != 0) {
    close(fd);
    return -1;
  }
  static char req[2048];
  int n = snprintf(req, sizeof req,
                   "GET %s%s HTTP/1.0\r\nHost: %s:%d\r\nAuthorization: Bearer %s\r\nUser-Agent: ZenaaConsole/" ZENAA_VERSION
                   "\r\nConnection: close\r\n\r\n",
                   g_url_path, path, g_url_host, g_url_port, g_token);
  if (send(fd, req, (size_t)n, 0) != n) {
    close(fd);
    return -1;
  }
  static char raw[16384];
  size_t got = 0;
  for (;;) {
    ssize_t r = recv(fd, raw + got, sizeof raw - 1 - got, 0);
    if (r <= 0) break;
    got += (size_t)r;
    if (got >= sizeof raw - 1) break;
  }
  close(fd);
  raw[got] = 0;
  int status = -1;
  if (sscanf(raw, "HTTP/%*s %d", &status) != 1) return -1;
  char *b = strstr(raw, "\r\n\r\n");
  snprintf(body, cap, "%s", b ? b + 4 : "");
  return status;
}

/* ───────────── state ───────────── */

typedef struct {
  char phase[16];
  long remaining; /* -1 = open session (no end) */
  long elapsed;
  char station[48];
  char player[48];
  char msgid[32];
  char msg[220];
  char weather[24];
  char center[64];
} state_t;

static void field(const char *body, const char *key, char *out, size_t cap) {
  char k[32];
  snprintf(k, sizeof k, "\n%s=", key);
  const char *p = strstr(body, k);
  out[0] = 0;
  if (!p) return;
  p += strlen(k);
  size_t n = strcspn(p, "\r\n");
  if (n >= cap) n = cap - 1;
  memcpy(out, p, n);
  out[n] = 0;
}

static void parse_state(const char *text, state_t *s) {
  static char body[8192];
  char num[24];
  snprintf(body, sizeof body, "\n%s", text); /* so every key is preceded by a newline */
  field(body, "phase", s->phase, sizeof s->phase);
  field(body, "remaining", num, sizeof num);
  s->remaining = num[0] ? atol(num) : -1;
  field(body, "elapsed", num, sizeof num);
  s->elapsed = atol(num);
  field(body, "station", s->station, sizeof s->station);
  field(body, "player", s->player, sizeof s->player);
  field(body, "msgid", s->msgid, sizeof s->msgid);
  field(body, "msg", s->msg, sizeof s->msg);
  field(body, "weather", s->weather, sizeof s->weather);
  field(body, "center", s->center, sizeof s->center);
}

static const char *clock_str(long secs, char *buf, size_t cap) {
  if (secs < 0) secs = 0;
  long h = secs / 3600, m = (secs % 3600) / 60, s = secs % 60;
  if (h) snprintf(buf, cap, "%ld:%02ld:%02ld", h, m, s);
  else snprintf(buf, cap, "%02ld:%02ld", m, s);
  return buf;
}

static int is_active(const char *phase) { return !strcmp(phase, "running") || !strcmp(phase, "warning"); }

int main(void) {
  if (load_config() != 0) {
    notify("ZENAA: not set up.\nSend it from ZENAA (Stations > Station screen > Console) or create /data/zenaa/config.txt");
    return 1;
  }
  take_over();
  notify("ZENAA timer started (" ZENAA_PLATFORM " v" ZENAA_VERSION ")\nServer %s:%d", g_url_host, g_url_port);

  state_t cur, prev;
  memset(&prev, 0, sizeof prev);
  strcpy(prev.phase, "?");
  int fails = 0, offline_told = 0, first = 1;
  long last_left_note = -1;    /* minute mark of the last "time left" note */
  time_t times_up_at = 0;
  int times_up_repeats = 0;
  static char body[8192];
  char c1[16];

  for (;;) {
    for (int i = 0; i < 5; i++) {
      if (should_quit()) return 0;
      sleep(1);
    }
    int st = http_get("/api/agent/console?v=" ZENAA_VERSION "&p=" ZENAA_PLATFORM, body, sizeof body);
    if (st == 401) {
      notify("ZENAA: this console was unpaired.\nSend the timer again from ZENAA (Stations > Station screen).");
      return 1;
    }
    if (st != 200) {
      if (++fails == 6 && !offline_told) {
        notify("ZENAA: cannot reach the server %s:%d\nCheck the Wi-Fi/LAN. The timer keeps trying.", g_url_host, g_url_port);
        offline_told = 1;
      }
      continue;
    }
    if (offline_told) notify("ZENAA: connected again");
    fails = 0;
    offline_told = 0;
    memset(&cur, 0, sizeof cur);
    parse_state(body, &cur);
    const char *who = cur.station[0] ? cur.station : "ZENAA";

    /* Session started (or app started during a session). */
    if (is_active(cur.phase) && !is_active(prev.phase)) {
      if (cur.remaining >= 0)
        notify("%s  |  %s%s%s\nGame on! %s to play%s%s", who, cur.player[0] ? "Hi " : "", cur.player, cur.player[0] ? "" : "Welcome",
               clock_str(cur.remaining, c1, sizeof c1), cur.weather[0] ? "  |  " : "", cur.weather);
      else
        notify("%s  |  Game on%s%s\nOpen session - pay at the end.", who, cur.player[0] ? ", " : "", cur.player);
      last_left_note = cur.remaining >= 0 ? (cur.remaining + 59) / 60 : -1;
      times_up_at = 0;
    }

    /* Time-left reminders: every 10 minutes, then at 5 and 1. */
    if (is_active(cur.phase) && cur.remaining >= 0) {
      long mins = (cur.remaining + 59) / 60;
      int mark = (mins % 10 == 0) || mins == 5 || mins == 1;
      if (mark && mins != last_left_note && mins > 0 && !first) {
        notify("%s  |  %s left\n%s", who, clock_str(cur.remaining, c1, sizeof c1),
               mins <= 5 ? "Top up at the counter to keep playing." : "Enjoy your game!");
        last_left_note = mins;
      }
    } else if (is_active(cur.phase)) {
      /* Open session: a note every 30 minutes played. */
      long mins = cur.elapsed / 60;
      if (mins > 0 && mins % 30 == 0 && mins != last_left_note) {
        notify("%s  |  Played %s", who, clock_str(cur.elapsed, c1, sizeof c1));
        last_left_note = mins;
      }
    }

    /* Session ended / paused. */
    if (!is_active(cur.phase) && is_active(prev.phase)) {
      if (!strcmp(cur.phase, "paused")) notify("%s  |  Session paused\nPlease see the counter.", who);
      else {
        notify("%s  |  TIME IS UP\nThank you for playing! See the counter to play again.", who);
        times_up_at = time(NULL);
        times_up_repeats = 0;
      }
    }
    if (times_up_at && !is_active(cur.phase) && times_up_repeats < 3 && time(NULL) - times_up_at >= 60 * (times_up_repeats + 1)) {
      notify("%s  |  Time is up\nPlease see the counter to play again.", who);
      times_up_repeats++;
    }

    /* Staff unlock (turned on with no charge from ZENAA or a station screen). */
    if (!strcmp(cur.phase, "staff") && strcmp(prev.phase, "staff")) {
      notify("%s  |  Staff unlock\nNo charge - turned on by staff.", who);
      times_up_at = 0;
    }

    /* Staff message (skip the one that was already there when we started). */
    if (cur.msgid[0] && strcmp(cur.msgid, prev.msgid) && !first) notify("Message from the counter\n%s", cur.msg);

    prev = cur;
    first = 0;
  }
}
