# 23 — Amount → time calculator, Appearance, and Social (graphics and posting)

| What | Where | Who |
|---|---|---|
| How much time an amount buys | **Stations** or **Session history** → **Amount → time**; also inside **Start session** | Admins (permission *sessions.calculator*) |
| Colours, text size, fonts | **Settings → Appearance** (top of the page) | Admins |
| Post ideas, graphics, videos, posting | **Social** (menu → Customers) | Admins (permission *social.manage*) |

Managers and cashiers don't see the calculator or Social. To give them access, open **Users & roles** and tick the permission for that person.

---

## 1. Amount → time calculator

1. Press **Amount → time**.
2. Choose the **package or pricing plan**.
3. Type what the customer pays, e.g. `25` (or tap 5 / 10 / 20 / 50 / 100).

It shows the playing time straight away.

**Hourly plans:** the time in whole billing blocks that fits the money, the exact cost, and the change. Example: GHS 25 at GHS 20/h = **1 h 15 min**, no change.

**Packages:** how many packages the money buys, and what is left over. The leftover also shows how many extra minutes it buys at the plan's hourly rate, as an extension.

**Inside Start session** (prepaid, hourly plan): type the amount in **…or the amount the customer pays**. The **Time** box fills itself in.

The result is before member discounts, happy hours and promo codes. Those give *more* time for the same money; the to-collect total in Start session already includes them.

## 2. Appearance (Settings → Appearance)

The page changes **live** while you choose. Press **Save appearance** to use the look on every computer and phone. **Undo changes** puts the saved look back.

| Setting | What it does |
|---|---|
| **Ready-made colours** | One tap. **ZMG blue + lime** matches your brand. |
| **Main colour** / **Second colour** | Any colour (picker, or type e.g. `#1d44f9`). The second colour is used in gradients. |
| **Text size** | 85–130 %. Makes everything bigger or smaller, which is useful on the counter PC. |
| **Corners** | Sharp / Normal / Round. |
| **Text font** / **Heading font** | Headings can use **ANTON** (tall poster style) or **ARCHIVO BLACK** (wide heavy). |
| **Tint dark backgrounds** | Dark mode turns navy instead of grey when the main colour is blue. |
| **Theme for new devices** | Dark, light or follow the device. Used until someone presses the sun/moon switch on that device. |
| **Use these colours in the customer app too** | Applies the same look to the customer app. |

With a light main colour such as lime, button text turns black so it stays readable. The dark theme suits lime best.

## 3. Social

### What it does
- **Every day** at the time you choose (default 09:00), ZENAA takes the newest stories from your game news websites and makes **ready-to-post graphics** with a caption.
- It shows an alert in ZENAA. It can also **text your phone**, sent by the MoMo phone (ZENAA MoMo app).
- You open **Social → Ideas & drafts**, check or change the text, and either:
  - **post** directly to Facebook, Instagram, Telegram and the customer app news; or
  - **Share / download** the picture or video and post it to TikTok, YouTube, X, Snapchat and WhatsApp yourself.
- **Page updates** shows your followers and how your latest Facebook and Instagram posts are doing (likes, comments, shares).

Nothing is ever posted without you pressing **Post**.

### Graphics
Graphics use your ZMG brand: the controller logo, the blue ZENAA texture from your stream overlays, and navy / blue / lime. Seven looks:

| Look | Good for |
|---|---|
| **News** | A game news story with its picture |
| **Breaking** | Big announcements: framed picture, lime highlight text |
| **Quote / hot take** | Questions and opinions ("FC 27 defending… agree?") |
| **Next match** | Player vs player with photos |
| **Leaderboard** | Top 10. Press **Fill from your rankings** |
| **Promo / event** | Happy hour, tournaments, merch, opening hours, with price badge and WhatsApp line |
| **Winner** | Champion photo, WINNER and confetti |

**Sizes:**
- **Post 4:5:** Instagram and Facebook feeds.
- **Square:** any feed or WhatsApp.
- **Story / Reel 9:16:** Stories, Reels, TikTok, Shorts and Status.

**Pictures:**
- Paste a picture address, or press **Upload** (it is shrunk automatically).
- Or use your brand pictures: black or white merch, or the ZMG logo.
- News ideas already have the story's picture.

**Animation:** every look moves: the picture zooms, text slides in, the logo pops and the winner gets confetti. **Play animation** shows it, and **Make video** records 7 seconds:
- an **MP4** in Chrome or Edge on Windows;
- a **WebM** in some other browsers.

Keep the tab visible while it records.

**Captions:**
- **Write from the text** fills the caption pattern (Accounts & settings), for example *headline, summary, "Come and play at ZENAA MEGA GAMES", hashtags*.
- Change it freely. **Copy** puts it on the clipboard.

### Posting
- **Post now:** tick where to post, then choose **picture** or **video** (once a video has been made).
- **Where it went** shows ✅ or ❌ for each place, with a link to the live post.
- **Share…**
  - On a phone, it opens TikTok, WhatsApp or Instagram with the file ready. The caption is copied: paste it.
  - On a PC, it downloads the file.
- **I posted it on:** tap where you posted it by hand, so **Posted** keeps a full history.

### Connect your accounts (Social → Accounts & settings)

**Facebook Page** (also used for Instagram):
1. Go to **developers.facebook.com** and create an app of type **Business**.
2. Open **Tools → Graph API Explorer**:
   - choose your app;
   - **User or Page → your Page**;
   - add the permissions `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`, `instagram_basic`, `instagram_content_publish`, `read_insights`;
   - press **Generate Access Token**.
3. Make the token long-lasting: **Access Token Debugger → Extend Access Token**. Page tokens made from a long-lived user token don't expire.
4. In ZENAA, paste the **Page ID** (Facebook → your Page → About → Page transparency) and the **Page access token**.
5. Press **Save & check**. It shows *Connected to the Page "…"*.

**Instagram:**
1. Switch Instagram to a **professional account** (Business or Creator).
2. Link it to the Facebook Page.
3. In ZENAA, press **Save & check**. The account is found automatically.

Instagram downloads each picture or video from your ZENAA address, so ZENAA must be reachable from the internet over **https** (Settings → Socials & public address). Until then, use **Share** for Instagram. Instagram videos must be **MP4**.

**Telegram channel:**
1. Talk to **@BotFather** → `/newbot` and copy the token.
2. Add the bot to your channel as an **admin**.
3. In ZENAA, paste the token and `@yourchannel`, then press **Save & check**.

**TikTok, YouTube, X, Snapchat, WhatsApp:** they only allow automatic posting through paid or reviewed developer apps, so ZENAA prepares the file and caption and you post in two taps with **Share**.

Tokens stay on the ZENAA server. They are never shown again or written to the audit trail. Every post is recorded in the **Audit trail**.

### Daily ideas settings
- **On/off**, **time**, and **ideas per day** (1–10).
- **Text me when ideas are ready:** your phone number. The text is sent by the MoMo phone.
- **Handle** printed on graphics (e.g. `@zenaamegagames`), **hashtags**, the **caption pattern** and the **brand colours** used in graphics.
- **Your social pages:** the links shown in the customer app and on QR posters.

Ideas come from the websites listed under **News & posters → Outside news**. Each story is used once. Press **×** on an idea you don't want, or **Get ideas now** to check the news straight away.
