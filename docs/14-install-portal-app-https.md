# 14 — Customer app on the home screen (install button) and the https link

The customer portal (`/portal`) is now a **web app** that customers install on their phone's home screen: no app store and no download. It opens full screen with its own icon, like a normal app.

The portal is redesigned for phones:
- a **bottom tab bar** (Home · Book · Ranks · Cups · Match);
- the wallet balance always at the top;
- big touch buttons, and forms that don't zoom on iPhone;
- an **Install** card on the home page.

## How customers install it

| Phone | Steps |
|---|---|
| **Android (Chrome)** | Tap **Install** on the portal home page (or ⋮ → *Install app* / *Add to Home screen*). |
| **iPhone (Safari)** | Tap **Install** for the steps: **Share** → **Add to Home Screen** → **Add**. (Apple has no install button for web apps; it must be done from Safari's Share menu.) |
| **PC (Chrome/Edge)** | The install icon in the address bar, or the **Install app** button in the portal top bar. |

The installed app has shortcuts (long-press the icon on Android): **Find match**, **Rankings**, **Book a station**.

Staff can also install the **staff app** the same way from `http://<server>:8080/` on the counter PC or a tablet. It is a separate icon, *ZENAA Staff*.

## Why you want an https address

Phones only offer the full **"Install app"** for sites served over **https** (or `localhost`).

On plain `http://192.168.x.x:8080`:
- Android still lets customers use **⋮ → Add to Home screen**, but it becomes a shortcut that opens in the browser;
- iPhone's *Add to Home Screen* still works;
- the portal itself works perfectly; only the "real app" install needs https.

You need a public https address anyway for:
- customers to use the portal **from home** (book, top up, Find match, follow tournaments);
- the **Paystack webhook** (doc 07).

### Recommended: Cloudflare Tunnel (free, no router changes, no fixed IP)

You need a domain on Cloudflare, e.g. `zenaagamehub.com` (domains cost about $10/year). On the **mini PC**:

```bash
# 1. Install cloudflared
curl -L https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install -y cloudflared

# 2. Log in and create the tunnel
cloudflared tunnel login
cloudflared tunnel create zenaa
cloudflared tunnel route dns zenaa play.zenaagamehub.com
```

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: zenaa
credentials-file: /home/zenaa/.cloudflared/<TUNNEL-ID>.json
ingress:
  - hostname: play.zenaagamehub.com
    service: http://localhost:8080
  - service: http_status:404
```

```bash
sudo cloudflared service install      # starts automatically on boot
```

Customers now open **https://play.zenaagamehub.com/portal** and get the real install button.

Then, in ZENAA:
1. **Settings → Paystack → Public address of this system:** `https://play.zenaagamehub.com`.
2. **Paystack dashboard → Webhook URL:** `https://play.zenaagamehub.com/api/paystack/webhook`.

Print a QR code of the portal address for the counter. Any free QR generator works.

> **Security:** with a public address, the **staff app** is reachable from the internet too. Use strong staff passwords (login is locked for 15 minutes after 5 failures).
>
> To keep staff pages LAN-only, protect `play.zenaagamehub.com/` (everything except `/portal`, `/api/portal`, `/api/public`, `/api/paystack/webhook`, `/assets`, `/icons`, `/sw.js` and `*.webmanifest`) with **Cloudflare Access**, a free login gate.

### Alternative: Tailscale (private, staff only)

Tailscale is already installed on your PC. It gives your phones and the mini PC a private https address (`https://minipc.tail1234.ts.net`) via `tailscale cert` / `tailscale serve`.

This is great for **staff** using ZENAA from home, but customers can't use it (they would need Tailscale too).

## Troubleshooting

| Problem | Fix |
|---|---|
| No **Install** button, only steps | Normal on iPhone, and on Android over plain http. Use the steps, or set up the https address above. |
| The installed app shows an old version | Close it fully and reopen. It always loads the newest version when online. |
| *Offline — check the Wi-Fi* | The phone can't reach the server. Inside the shop, use the shop Wi-Fi; outside, use the https address. |
| Install button gone after installing | Correct: it hides when the app is already installed. |
