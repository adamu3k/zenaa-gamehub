# 18 — MoMo top-ups without a payment gateway (and Paystack explained)

Customers can top up their ZENAA wallet by sending **ordinary mobile money** to your number. ZENAA confirms the payment and credits the wallet automatically, with a green "Payment received" screen like Paystack's. There is **no gateway and no fee** from ZENAA; the money goes straight into your MoMo account.

---

## 1. How it works

```
Customer app                    Customer's phone            Your MoMo phone              ZENAA
──────────────                  ────────────────            ───────────────              ─────
Wallet → Top up with MoMo
  amount GHS 50
  ← code 482193
  ← "send to 024 000 0000"  →   *170# → send GHS 50
                                 Reference: 482193    →     SMS "Payment received
                                                             for GHS 50.00 …
                                                             Reference: 482193
                                                             Transaction ID: 5123…"
                                                                  │ ZENAA MoMo app
                                                                  └──────────────────→  match: code + amount
  ✓ "Payment received —                                                                 credit wallet
    GHS 50 added" (auto)    ←───────────────────────────────────────────────────────────
```

1. In the app, the customer opens **Wallet → Top up with MoMo**, picks an amount and gets a **personal code** (e.g. `482193`). It is **numbers only**, so it is easy to type on a keypad phone with *170#.
2. They send exactly that amount to your MoMo number, with the code as the **Reference**. The app shows the *170# steps.
3. Your MoMo phone receives the network's "Payment received" SMS. The **ZENAA MoMo** app on that phone forwards it to ZENAA.
4. ZENAA reads the amount, transaction ID and reference. When the code and amount match, it credits the wallet. The customer's screen turns green within seconds.
5. If the customer forgot the code, they can type the **Transaction ID** from their own SMS in the app; ZENAA matches it to your phone's SMS.
6. Anything that doesn't match waits in the **MoMo inbox** (menu → Money). Staff confirm it with one tap or credit it to the right customer.

**Without the MoMo phone** it still works: every top-up waits in the MoMo inbox and staff confirm it after checking the phone.

---

## 2. Set up (10 minutes)

1. **Settings → MoMo top-ups**: add your number(s) (network, number, and the name customers will see), then **Save settings**.
2. Choose **Wait for staff from this amount up** (default GHS 300: GHS 300 and above waits for you, smaller payments are credited at once) and, if you like, the **automatic crediting hours** (see *Auto-credit rules* below).
3. **Integrations → Download ZenaaMoMo.apk** on the Android phone that holds your MoMo SIM and install it ("Install unknown apps" → allow your browser).
4. In ZENAA press **Settings → Pair the MoMo phone**. In the phone app, type the server address (e.g. `http://192.168.1.10:8080`) and the 6-digit code.
5. Press **Allow SMS** and choose **Allow**. If Android or Google Play Protect blocks it, see **"If the SMS permission is blocked"** below.
6. Test it: from another phone, start a top-up of GHS 1 in the customer app and send it. It should go green within a few seconds.

Keep the MoMo phone **charged and on the venue Wi-Fi**. If Wi-Fi drops, the app keeps the messages and sends them when it is back.

### If the SMS permission is blocked

Android and Google treat any app that reads SMS carefully, because fake apps use SMS to steal bank codes. ZENAA MoMo is not from the Play Store, so you may see one of these:

| What you see | Why |
|---|---|
| **"Restricted setting — for your security, this setting is currently unavailable"**, or **Allow** is greyed out | Android 13+ restricts SMS for apps installed from a browser, WhatsApp or a file manager. |
| **"Unsafe app blocked"** or **"Blocked by Play Protect"** when installing | Play Protect doesn't know the app. In some countries Google blocks every downloaded app that asks for SMS. |
| The app is installed but stops working later, or "harmful app" warning | Play Protect scanned it again and turned it off. |

Try these in order. **Plan B always works.**

**Plan A — on the phone (2 minutes)**

1. If Play Protect asks while installing: tap **More details → Install anyway**.
2. Open ZENAA MoMo and press **Allow SMS**. If Android says *Restricted setting*, press OK.
3. In the app press **Open app settings** (version 1.1 shows this button after the first try). Or go to **Settings → Apps → ZENAA MoMo**.
4. Tap **⋮** (three dots, top right) → **Allow restricted settings** → confirm with your PIN/fingerprint.
   - The ⋮ option only appears **after** you have tried Allow SMS once (step 2).
   - Samsung: same place (App info → ⋮). Xiaomi/Redmi: App info → ⋮ or "Other permissions".
5. Tap **Permissions → SMS → Allow**.
6. Go back to ZENAA MoMo: the yellow "Allow SMS" box is gone.

**Plan B — install from the server PC with a cable (10 minutes, works when Plan A doesn't)**

Apps installed from a PC with Android's own tool aren't restricted, and the SMS permission is switched on during the install.

1. On the MoMo phone, turn on **USB debugging**:
   - **Settings → About phone → tap "Build number" 7 times** (Samsung: About phone → Software information → Build number). It says *"You are now a developer"*.
   - **Settings → System → Developer options** (Samsung: at the bottom of Settings) → turn on **USB debugging**. If there is **"Verify apps over USB"**, turn it **off**.
   - Xiaomi/Redmi/POCO: also turn on **"Install via USB"** (needs a Mi account).
2. If ZENAA MoMo is already on the phone, you can leave it; the setup updates it.
3. Connect the phone to the **server PC** with a USB **data** cable. If the phone asks, choose *File transfer*.
4. On the PC, open the ZENAA folder → **tools** → double-click **ZENAA-MoMo-phone-setup.cmd**.
5. The phone asks **"Allow USB debugging?"** → tick *Always allow* → **Allow**.
6. The setup downloads Android's tools from Google once (7 MB). Then it installs ZENAA MoMo with SMS allowed, stops Android from putting it to sleep, and opens it. If Play Protect asks on the phone, tap **Install anyway**.
7. Pair it (step 4 of the setup above). Then you can turn USB debugging off again.

No cable? The setup also connects over Wi-Fi on Android 11+: type **W** when it asks, and use **Developer options → Wireless debugging → Pair device with pairing code**.

**If Play Protect keeps turning the app off:** this is a dedicated MoMo phone, so on **that phone only** open **Play Store → your picture → Play Protect → ⚙ settings** and turn off **Scan apps with Play Protect**. Then open ZENAA MoMo again. Don't install other apps from outside the Play Store on that phone.

**Plan C — another SMS-forwarder app from the Play Store.** Any app that forwards SMS to a web address (often called *SMS forwarder*, *SMS to URL* or *webhook*) works with ZENAA. Use **Settings → MoMo top-ups → Link for another SMS-forwarder app** and paste the link into that app. Forward only messages from the MoMo sender names.

**Plan D — no phone app at all.** Top-ups still work: they wait in the **MoMo inbox** and staff press **Received** after checking the MoMo phone.

**Already using an SMS-forwarder app?** Use **Settings → Link for another SMS-forwarder app** instead. Any app that can POST JSON `{"from": "...", "body": "..."}` to a URL works.

---

## 3. Safety

| Risk | What ZENAA does |
|---|---|
| A customer sends a fake "Payment received" SMS to your phone | Only SMS from **trusted sender names** count (e.g. `MobileMoney`, `T-CASH`; edit the list in Settings). Texts from ordinary phone numbers are always ignored. |
| The same SMS is forwarded twice | Each **transaction ID** is credited once. |
| Wrong amount sent | The amount must match **exactly**. Otherwise it waits in the MoMo inbox with a note ("SMS amount differs"). |
| Large amounts | From the *wait for staff* amount up (default GHS 300), staff confirm by hand. |
| Late at night | With *automatic crediting hours* on, payments outside them wait for staff. |
| Staff crediting without money | Confirming by hand can need a manager PIN (Settings → Staff PINs → "Confirming a MoMo payment by hand"). Every confirmation is recorded with the person's name. |

Always check the MoMo phone or statement before pressing **Received** in the MoMo inbox. At shift close, type the MoMo total in **MoMo received this shift** to catch differences (see doc 19).

---

## 4. MoMo inbox

**Menu → MoMo inbox** has three tabs:

- **Waiting** — top-ups not yet confirmed. Use **Received** (after checking the phone) or **Reject** with a reason; the customer sees the reason.
- **Unclaimed SMS** — money that arrived but matched nobody, e.g. a customer who forgot the code. Use **Credit a customer**, or **Ignore** if it wasn't a top-up (e.g. a supplier refund).
- **History** — confirmed and rejected top-ups, and whether the SMS or a person confirmed them.
- **Thank-you SMS** — every SMS sent to customers from the MoMo phone, with *sent* / *failed* and **Send again**.

### Auto-credit rules (Settings → MoMo top-ups)

When the payment SMS matches a customer's top-up, ZENAA credits it **automatically** unless one of these says *wait*:

| Setting | Example | What happens |
|---|---|---|
| **Wait for staff from this amount up** | 300 | GHS 299.99 or less → credited at once. GHS 300 and above → waits in **MoMo inbox → Waiting** with *"Payment received — waiting for staff (GHS 300.00 and above is checked by staff)"*, and staff screens get a notice. |
| **Automatic crediting hours** | Only from 06:00 to 23:00 | After 11 pm and before 6 am, every payment waits for staff, whatever the amount. Windows across midnight work too (e.g. 18:00 to 02:00). |
| **Credit automatically…** (off) | | Every payment waits for staff. |

A waiting payment has already been **matched**: the customer and the SMS are known. Staff only check the MoMo phone and press **Received**.

**Matched without the code:** if a customer forgets to type the reference but pays **from the phone number on their ZENAA account**, the exact amount of one waiting top-up, ZENAA matches it to them too (same rules as above).

### Thank-you SMS to customers

The MoMo phone (ZENAA MoMo **1.2** or newer) also **sends** SMS for you, from its own SIM, to the phone number on the customer's account:

| When | Default message (you can change it) |
|---|---|
| A MoMo top-up is credited (automatically or by staff) | *Hi Ama, thank you! GHS 20.00 has been added to your ZENAA GAMEHUB wallet. Balance: GHS 45.00.* |
| Staff add money at the counter | *Hi Ama, GHS 50.00 has been added to your ZENAA GAMEHUB wallet. Balance: GHS 95.00. Thank you!* |
| A customer pays for a game (start, extension or paying a tab) | *Thanks for playing at ZENAA GAMEHUB, Ama! GHS 18.00 paid for your game on PS5 One. See you again!* |

Set it up in **Settings → MoMo top-ups → Thank-you SMS to customers**:
- switch each one on or off, and change the words. `{name}` (first name), `{amount}`, `{balance}`, `{centre}` and `{station}` are filled in;
- keep each message under **160 characters** (one SMS). The form counts for you;
- **Send a test SMS** to your own phone.

Good to know:
- Each SMS costs the MoMo SIM's normal SMS price. A cheap SMS bundle on that SIM helps.
- Only **registered customers with a phone number** get messages. Walk-ins don't.
- The phone checks for new messages every 15 seconds while it is on Wi-Fi. It shows a small *"ZENAA MoMo is on"* notification; leave it.
- A message the phone couldn't send (no airtime, no signal) shows **failed** with the reason. If the phone was off for more than 12 hours, old messages are not sent any more (*too old*), so customers don't get a pile of messages in the morning.
- Updating from ZENAA MoMo 1.1: install the new **ZenaaMoMo.apk** over the old one (Integrations → downloads, or `tools\ZENAA-MoMo-phone-setup.cmd` with the USB cable). Then open it once and allow **SMS** again if it asks: sending SMS is a new permission.

### Send the MoMo SMS to other apps too (ZENAA MoMo 1.3)

The same phone can pass the MoMo SMS to more apps than ZENAA: another branch, a bookkeeping app, your own webhook.

1. Install the new **ZenaaMoMo.apk** over the old one. Pairing stays.
2. Open ZENAA MoMo and scroll to **Other apps**. There are 3 empty boxes, *"App 2 · empty"*, *"App 3 · empty"* and *"App 4 · empty"*.
3. Press **Set up** on one box and type:
   - **Name**, for example *Branch 2*.
   - **Link**: the address that app gave you for receiving SMS, starting with `https://`. Use `http://` only on the same Wi-Fi.
   - **Code**: that app's key or token.
4. Leave **Only MoMo payment messages** ticked. If you untick it, every SMS on the phone goes to that app, including bank codes and private messages.
5. Press **Save**, then **Test**. *"✓ Branch 2 received the test"* means it works.

What the other app receives: an HTTP `POST` with JSON `{ "from", "body", "at", "device", "source": "zenaa-momo", "version" }`. The code is sent as `Authorization: Bearer <code>` and as `X-Relay-Code: <code>`. The test message also has `"test": true`. A `2xx` answer counts as delivered. Each app has its own waiting list, so if one app is offline, ZENAA and the other apps still get their messages.

**For developers: more than 3 boxes, or links filled in for you.** Open `agents/android-momo/app/src/main/java/com/zenaa/momo/ExtraApps.java` and look for the block marked **PLACEHOLDER — MORE APPS**:
- `SLOTS` is the number of boxes. Change it from 3 to the number you need.
- `PRESET` holds names and links to fill in on every phone, for example `{"Branch 2", "https://branch2.example.com/api/momo/sms"}`.
- Never put the codes in that file, because the repository is public. Type the codes on the phone.
- Rebuild with `agentsndroid-momouild-apk.ps1`.

---

## 5. Paystack — what it is and what it costs

Paystack (already built into ZENAA, doc 07) is a **payment gateway**. The customer pays on Paystack's page with **card or mobile money**, and Paystack sends the money to your bank or MoMo account.

| | Paystack | ZENAA MoMo (this guide) |
|---|---|---|
| Fee | About **1.95% per payment** in Ghana (local cards and MoMo; check paystack.com/gh/pricing for today's rate). Paying out to a MoMo wallet costs about GHS 1 per payout. | **None** from ZENAA. Your network's normal charges for receiving and cashing out apply. |
| GHS 100 top-up | You receive about GHS 98.05 | You receive GHS 100 |
| Cards (Visa / Mastercard) | Yes | No, MoMo only |
| Needs a business account | Yes (registration documents) | No, any MoMo number works |
| Confirmation | Instant, by Paystack | Instant with the MoMo phone; otherwise staff confirm |
| Settlement | Paystack pays you the next working day | Money is in your MoMo straight away |
| Disputes / chargebacks | Paystack handles them | You handle them |

**Recommendation:** for a venue where most customers pay by MoMo, use **ZENAA MoMo as the main top-up** (no fees, money arrives at once). Keep Paystack on only if you want **card** payments, and accept its fee on those.

Other gateways in Ghana (Hubtel, ExpressPay, Flutterwave, MTN MoMo API) charge in a similar range (about 1–2%). The MTN **MoMo API** needs a business registration and MTN approval before you can use it.

**Merchant MoMo (MoMoPay) vs personal MoMo:** a merchant number looks more professional and some customers trust it more, but MTN may charge the merchant a small fee per payment. Ask MTN for the current merchant tariff. ZENAA works the same with either.

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| The customer sees "MoMo top-up is not available" | Add a number in Settings → MoMo top-ups and turn on "Customers can top up with MoMo". |
| The phone app says "Cannot reach …" | Put the phone on the venue Wi-Fi. The address needs `http://` and `:8080`. Allow port 8080 in the server PC's firewall. |
| An SMS shows "ignored (sender not trusted)" in the phone app | Check how the MoMo SMS sender appears on that phone (e.g. `MobileMoney`) and add it to **Trusted SMS senders**. |
| Payments always wait in the inbox | Check that "Credit automatically…" is on, the amount is under *Wait for staff from this amount up*, and the time is inside the *automatic crediting hours*. The note on the payment says which rule stopped it. |
| Thank-you SMS stay *waiting for the phone* | The MoMo phone needs ZENAA MoMo 1.2+, opened once, with SMS allowed. Check that it is on Wi-Fi. |
| Thank-you SMS *failed* | Read the reason: usually no airtime / SMS bundle, or no signal. Fix it, then press **Send again**. |
| A customer paid but nothing happened | Ask for the transaction ID. If it's under **Unclaimed SMS**, credit it to them. If not, check the MoMo phone itself, then use **Received** on their waiting top-up. |
| The SMS permission button is greyed out, "Restricted setting", or Play Protect blocks the app | See **If the SMS permission is blocked** above: Plan A on the phone, or Plan B with a USB cable from the server PC. |
| SMS arrive late or only when the app is opened | In the app press **Don't put to sleep (battery)**. On Xiaomi/Tecno/Infinix/itel also: App info → Battery → **No restrictions** and turn on **Autostart**. |
