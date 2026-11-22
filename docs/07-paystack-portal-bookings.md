# 07 — Paystack, customer portal & bookings

## Customer portal

Customers open **`http://<your-server>:8080/portal`**, for example `http://192.168.100.12:8080/portal` on the venue Wi-Fi. There they can:

- **Create an account** with name, phone and password, or **activate** an account that staff already registered at the counter.
- See their **wallet balance, loyalty points, membership tier** and anything they **owe**.
- **Top up their wallet with Paystack** (card or mobile money).
- **Book a station** for a day, time and length, and cancel their own upcoming bookings.
- See which stations are **free right now**, the **prices**, and their **session and wallet history**.
- Update their name, email and password.
- Switch between **light, dark or auto** theme.

### Accounts registered at the counter

Some customers were registered by staff at the counter, so their phone number already exists in the system. To stop strangers claiming someone else's wallet, those customers can't simply "sign up". Instead:

1. Staff open **Customers → the customer → Customer portal → Give activation code**. A 6-digit code appears, valid for **48 hours**, usable **once**.
2. The customer opens `/portal`, taps **I have a code**, and enters their phone, the code and a new password.

The same button, shown as **Password reset code**, is how a customer who **forgot their password** gets back in. There is no SMS or email reset, so no SMS provider is needed.

Staff can also **Turn access off** for a customer. That signs them out everywhere at once. Suspending a customer does the same.

**Settings → Customer portal & bookings:**
- **Portal on/off.**
- **Self sign-up on/off.** When off, only staff-issued codes can create accounts.
- **Online booking on/off.**
- **Auto-confirm.** When off, bookings wait in *Bookings* until a staff member confirms them.
- **Opening hours.**
- **Minimum notice.**
- **How many days ahead** customers can book.
- **No-show grace:** after this many minutes late, a booking that hasn't been checked in is released.

**Security:**
- Customer logins are separate from staff logins. A customer token can never open staff screens.
- 5 wrong passwords or codes lock that phone for 15 minutes.
- Passwords and codes are stored hashed (scrypt), never in plain text.

---

## Bookings

**Bookings** (left menu) lists the day's reservations, both online and taken at the desk.

- **New booking:** for a registered customer, or a contact name and phone for walk-ins or phone calls.
- **Check in:** opens the *Start session* dialog on that station with the customer already filled in. When the session starts, the booking becomes *Checked in*. When the session ends, it becomes *Completed*.
- **Confirm** (when auto-confirm is off), **No-show** and **Cancel** (optionally with a reason).
- A station can never have two overlapping bookings.
- Online, a customer can't book a station that is **in use right now** for a start within the next hour.
- Each customer can hold at most **3 upcoming** online bookings.
- On the **Stations** grid, a blue chip such as **"14:30 · Ama"** shows the next booking. A **Check in** button appears from one hour before the booking starts.
- Bookings nobody turned up for become **No-show** automatically after the grace period, which frees the station.

Payment still happens when the session starts, exactly as for walk-ins: wallet, cash, MoMo, split, and so on.

---

## Paystack

### What it is used for

1. **Customer portal top-up.** The customer chooses an amount, pays on Paystack's secure page by card or mobile money, comes back, and the wallet is credited.
2. **Top-up at the counter.** Go to **Customers → customer → Paystack** and enter the amount and the customer's email. A **QR code** appears. The customer scans it with their phone camera and pays on their own phone, and the dialog turns green when the money arrives. The customer can then play using the wallet.

Paystack money always goes **into the wallet first**. Sessions are then paid from the wallet, so nothing has to wait for a payment network in the middle of starting a game. Paystack top-ups appear in **Payments** with the method **Paystack (online)** and the reference `Paystack · zg_… · mobile money`, so you can match them against your Paystack dashboard and settlements.

### Setup

1. Create a business account at **paystack.com** (Ghana: you will need your business registration documents to go live).
2. In the Paystack dashboard go to **Settings → API Keys & Webhooks** and copy the **test** public key (`pk_test_…`) and secret key (`sk_test_…`).
3. In ZENAA go to **Settings → Paystack**, tick **Accept payments through Paystack**, paste both keys, then press **Save** and **Test connection**.
4. Try a top-up with Paystack's test cards or test mobile-money numbers (listed in Paystack's docs). Money in test mode is not real.
5. When Paystack activates your business, replace the keys with the **live** ones (`pk_live_…`, `sk_live_…`). The badge changes from *TEST mode* to *LIVE*.

The secret key is stored only on your server, is **never shown again** after saving (just `sk_test_…abcd`), and is only usable by admins (`settings.manage`).

### How a payment is confirmed (and why it's safe)

ZENAA never trusts the browser. Before crediting anything, the server itself asks Paystack *"did reference X succeed, for this exact amount, in this currency?"* (the verify API). This check runs:

- when the customer returns to `/portal/paid`;
- when the counter dialog polls every 4 seconds;
- when Paystack's **webhook** arrives (if your server is reachable from the internet);
- every minute in the background, for anyone who closed the page early.

All four paths go through the same step, which credits **exactly once**. If the amount or currency doesn't match, nothing is credited, the payment is marked *Failed*, and a red alert appears. Payments not completed within 24 hours become *Expired*.

### Webhook and remote access (optional)

Inside the venue everything works without exposing your server to the internet: the background check confirms payments within about a minute. If you want customers to use the portal **from home**, or want instant webhooks, publish the server securely:

- **Cloudflare Tunnel** or **Tailscale Funnel** give you an `https://…` address with no port forwarding.
- Put that address in **Settings → Paystack → Public address of this system**.
- Paste the **Webhook URL** shown there (`https://…/api/paystack/webhook`) into the Paystack dashboard. Webhooks are checked with Paystack's HMAC-SHA512 signature.

### Supported currencies

Paystack works in Ghana (GHS), Nigeria (NGN), Kenya (KES), South Africa (ZAR) and a few others (check Paystack's site for your country). Amounts are sent in the smallest unit (pesewas/kobo/cents). Fees are charged by Paystack and deducted from your settlement, not from the customer's wallet credit.
