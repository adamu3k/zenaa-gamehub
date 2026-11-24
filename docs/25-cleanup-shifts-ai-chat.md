# 25 — Deleting & clearing data, shifts & cash drawer, Ask AI, chat (v0.9.5)

## 1. Deleting things

Every list now has a delete button (🗑). Deleting asks first.

| Page | What you can delete | Where |
|---|---|---|
| Customers | One customer | Open the customer → **Delete** |
| Pricing | A price, a membership | Open it → **Delete** (bottom left) |
| Promotions | A happy hour, a promo code | 🗑 at the end of the row |
| Tournaments | A tournament, even after results | 🗑 on its card, or **Delete** inside it |
| Find match | A request | 🗑 on the request |
| Leaderboard | One match result | Open the match → **Delete** |
| Rewards | An offer, a claim | 🗑 on the row |
| News & posters → Outside news | One game-news story, or all of them | 🗑 on the story / **Remove all** (**Show removed** brings them back) |
| Customer chat | One message, or a whole chat | **Delete** on the message / **Clear chat** |
| Staff → User types | A user type | Open it → **Delete** |
| Stations | A station | Station → Edit → **Delete** (since v0.8) |
| Audit trail (admins) | One line | 🗑 on the line |

**Money records are never torn out.** Some things have payments or results pointing at them:

- A **customer** with past sessions, payments or match results is not removed from the reports. Their name, phone number, email, app account, gamertag and picture are wiped and they show as **"Deleted customer"**. Their phone number becomes free for a new account. A customer who never played is removed completely.
- A customer who still has **wallet money, saved time, an unpaid tab, or is playing right now** cannot be deleted. Settle that first (withdraw the money or set it to 0).
- A **price, happy hour or promo code** that past sessions used is hidden everywhere and switched off instead of removed, so old receipts still show what was charged. A deleted promo code's name can be used again.
- Deleting a **membership** moves its customers back to no membership.
- Deleting a **tournament** removes its players and matches, and its results leave the leaderboard.

## 2. Clean up (clear whole areas)

**Backup & updates → Clean up (delete data)** — admins only (Change system settings permission).

1. **Download a backup first** (same page, above), so you can get it back.
2. Tick what to clear. The number next to each shows how many there are now:
   - Customers (those with money, saved time or an unpaid tab are kept and counted as "skipped")
   - Leaderboard (friendly match results; choose one game or all games)
   - Tournaments, Find match requests, Customer chat, Reward claims
   - Old bookings (past, cancelled, no-show; upcoming bookings stay)
   - MoMo inbox (unmatched texts and unpaid requests; confirmed payments stay)
   - News & posters posts, Game news from other websites, Social ideas and drafts (posted ones stay)
   - Audit trail (all of it, or only lines older than N days)
3. Press **Delete the ticked data…**, type your **password** and **DELETE**.

Sessions, payments, shifts and wallet history are never cleared here, so Finance and your reports stay correct. Every clean-up is written to the audit trail, including clearing the audit trail itself.

## 3. Shifts & cash drawer

A **shift** is one staff member's working period at the counter. It answers: *"How much cash should be in the drawer, and is it there?"*

**The four steps** (also shown at the top of the Shifts page):

1. **Open your shift.** Count the cash in the drawer before you start (the *float*: change for customers) and type it in. ZENAA shows what the last shift left in the drawer; press **Use** to copy it if your count agrees. Each staff member opens their own shift. Payments taken while you have no open shift are not counted in any drawer, so always open yours first.
2. **Take payments.** Every payment you take is added to your shift automatically: sessions, wallet top-ups, time sold, tab payments, refunds. The **By payment method** box shows cash, MoMo, card and wallet separately.
3. **Cash in / Cash out.** Money that enters or leaves the drawer but is **not a sale**:
   - *Cash out*: drinks stock, generator fuel, electricity units, internet, repairs, wages, rent, transport, **safe drop** (moving extra cash to the safe), bank or MoMo deposit, owner withdrawal.
   - *Cash in*: more change added, the owner putting money in.
   Choose the reason so **Finance** can report expenses by type. Settings → **Staff PINs & approvals** can require a PIN for this.
4. **Count & close.** At the end, count notes and coins (type how many of each note; ZENAA adds them up) and, if you take MoMo, the MoMo received on the phone. ZENAA compares:

   **Expected cash = opening float + cash taken − cash refunds − cash out + cash in**

   - **0 / ✓**: the drawer is right.
   - **Over** (positive): there is more cash than expected, e.g. change not given, or a sale entered as MoMo but paid in cash.
   - **Short** (negative): cash is missing, e.g. wrong change, a payment not entered, or money taken out without **Cash out**.

   You can print the shift report. Managers see **All shifts**, with each shift's difference, and can open any shift to see every transaction.

**Good habits**

- One person per drawer per shift. Close before the next person opens theirs.
- Do a **safe drop** when the drawer gets full. It is recorded, so the closing count still matches.
- Write a note when you close if the count is off, so the manager knows why.

## 4. Ask AI (Social)

Connect **Claude** (Anthropic) or **ChatGPT** (OpenAI) once, and every graphic gets an **Ask AI** box.

**Connect (admins):** Social → **Accounts & settings** → **AI assistant**.

1. Choose Claude or ChatGPT.
2. Paste an API key: Claude from console.anthropic.com → API keys (starts with `sk-ant-`), OpenAI from platform.openai.com → API keys (`sk-…`). The AI company bills you for what you use.
3. Leave **Model** empty to use the default (Claude: `claude-opus-5-5`, OpenAI: `gpt-4o-mini`), or type another model name your account has.
4. **Save**, then **Test**.

The key stays on the ZENAA server and is never shown again (only its last 4 characters).

**Use:** in any graphic, type what you want in **Ask AI**, e.g. *"FIFA night this Friday 7 PM, entry GH₵20, winner gets GH₵500"* or *"shorter and more exciting"*, then press **Do it** (or Ctrl+Enter).

- The AI rewrites the text boxes and the caption. Pictures are never sent to the AI.
- Tick **It may choose a different look** to let it switch to a look that fits better.
- **Undo** puts everything back as it was.
- The AI is told not to make up prices, dates or prizes you did not give. Always read the result before posting.

## 5. Customer chat

- **Refresh** button at the top; new messages also arrive by themselves every few seconds and instantly when the connection is live.
- Players' **profile pictures** (or coloured initials) are shown next to their messages and in the chat list.
- **Find a player** box when there are many chats.
- **Clear chat** deletes every message in the open chat.
- The chat no longer jumps to the bottom while you are reading older messages.

## 6. Other changes in v0.9.5

- **Faster start, no black screen.** Pages now download only when you open them, files are sent compressed (about 3–5× smaller), and a loading spinner shows while a page loads. If a page fails to load (Wi-Fi blip, or right after an update) it tries again by itself, and if a page has a problem you see **Try again / Reload** instead of a black screen. A slow connection no longer signs you out.
- **Show password** eye button on every password box (staff sign-in, customer app sign-in and sign-up, settings).
- **User types → members**: open a user type (built-in or your own) to see who has it, **Add** a person or **Remove** them (they become a Cashier until you choose another type).
- **Audit trail**: search box, filter by staff member, refresh.
- **Social looks**: smoother animations, faster video recording, and on phones the picture now shows above the form.
