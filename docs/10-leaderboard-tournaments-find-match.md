# 10 — Leaderboard, tournaments and Find match

This guide covers the competition features added in v0.4:

- **Leaderboard:** who is leading, who beat whom, and who is champion.
- **Tournaments:** knockout cups, leagues, and group stages (divisions), with cash prizes and live brackets.
- **Find match:** players find opponents at the venue or online.

Everything feeds **one leaderboard per game**: friendlies entered at the counter, Find-match games and tournament games.

---

## 1. First-time setup (5 minutes)

1. **Leaderboard → Games.** ZENAA starts with *EA SPORTS FC, eFootball, Mortal Kombat, Tekken* and *NBA 2K*.
   - Add the exact titles you run, e.g. *EA SPORTS FC 26*. Choose what the game is scored in:
     - **Goals** for football;
     - **Points** for basketball;
     - **Rounds** for fighting games.
   - Untick **"A match can end level"** for games that can't end in a draw.
   - **Hide** games you don't offer.
2. **Settings → Competitions:**
   - **Leaderboard and tournaments are public.** This turns on the venue TV board at `http://<server>:8080/board`, and lets portal visitors see rankings.
   - **Customers can use Find match.**
3. **Customers:** give players a **Gamertag**, which is their name on the board. Players can also set it themselves in the portal → Profile.

---

## 2. The leaderboard

**Staff app → Leaderboard.** In the player portal, **Ranks** shows the same data, with the top 10 by default.

| What you see | How it works |
|---|---|
| **Rating** (starts at 1000) | Elo rating, like chess. Beating a stronger player earns more. A big win (3+ goals) counts more than a 1–0. A draw between equal players changes nothing. |
| **Tier** | Bronze < 900 · Silver 900 · Gold 1050 · Platinum 1200 · Diamond 1350 · **Legend 1500+** |
| **Placement** | Players with fewer than **3** matches are listed after ranked players and do not appear on the podium. This stops someone winning one game and sitting at #1. |
| **Form** | Last 5 results (W / D / L). |
| **Arrow next to the rating** | All time: rating change in the last 7 days. Week/Month: change since the start of the period. |
| **🏆 next to a name** | Tournament titles won in this game. |
| **🔥 next to a name** | 3 or more wins in a row. |
| **All time / This month / This week** | All time ranks by rating. Month and week rank by points (3 for a win, 1 for a draw), then goal difference. |
| **Highlights** | Matches and goals, biggest win, top scorer, the hottest streak right now. |

**Recording a friendly at the counter:** **Leaderboard → Record result**. Pick the game, both players and the score. The board updates on every screen at once.

**Correcting or deleting a result:** click it under *Latest results*. Friendlies can be deleted. Tournament results are corrected inside the tournament.

**Head-to-head:** click any player on the board, then pick an opponent. You see wins–draws–losses, goals and their last 20 meetings.

**Privacy:**
- Public screens show only the **gamertag**, or first name + last initial ("Kofi B."), never phone numbers.
- A player can tick **Hide me from the public leaderboard** in the portal. Staff still see them.

### Venue TV board

On a smart TV browser, or a PC/stick connected to a TV, open **`http://<server-ip>:8080/board`** and press **F11** for full screen.

- It cycles through each game's podium and top 10, then each **live tournament's bracket or table**, every 25 seconds.
- It refreshes itself and needs no sign-in.

---

## 3. Tournaments

**Staff app → Tournaments → New tournament.**

| Setting | Meaning |
|---|---|
| **Format: Knockout cup** | Single elimination. Byes are given to top seeds automatically when the player count isn't 4/8/16/32… Optional **third-place play-off**. |
| **Format: League** | Everyone plays everyone, once or **twice** (home & away). The table decides the winner. |
| **Format: Groups / divisions + knockout** | Players are split into **groups (divisions)** in snake order by seed (A B C D D C B A…). The top **N** of each group go through to a knockout. Winners face runners-up of another group (A1 v B2, B1 v A2, …). |
| **Maximum players** | Registration closes when full. |
| **Points for a win / draw** | League and group tables only (default 3 / 1). |
| **Entry fee** | Per player. Mark it paid as **Cash**, or take it from the player's **Wallet**, on the Players tab. |
| **Cash prizes** | One line per place: 1st, 2nd, 3rd, … with an amount and an optional label ("+ trophy"). |
| **Portal registration** | While the tournament is in **Registration open**, players can sign up from the portal. |
| **Description / Rules** | Shown to players in the portal. |

### Running one, step by step

1. **Create it.** It starts as a **Draft**, visible only to staff.
2. **Open registration** to let players join from the portal. Or add players yourself: **Add player** → an existing customer, or a **New player** with just a name.
3. **Seeds (optional):** on the Players tab, type 1, 2, 3… for your best players so they meet late. Tick **Random draw** to ignore seeds and shuffle.
4. **Start tournament.** The player list is locked and every fixture is drawn.
5. **Enter results:** click any match in the **Bracket**, **Fixtures** or **Overview** → type the score → **Save**.
   - **Knockout draws need a winner:** enter the penalty shoot-out (or deciding game) score.
   - **No-show?** Use **wins by walkover**. Walkovers don't change ratings.
   - **Mistake?** Open the match again and save the right score. Or press **Clear result**, which works only until the next-round match has been played.
6. **The tournament finishes itself** when the final (and third-place match) or the last league game is recorded. The champion is crowned, an alert pops up on every staff screen, and places 1–4 get their prizes.
7. **Prizes tab → Pay:**
   - **To wallet** credits the player's wallet at once. This needs the *wallet adjustments* permission.
   - **Cash** / **MoMo** just records the payout. Also record it as **Cash out** on the Shift page so the drawer balances.

Group-stage matches are locked once the knockout has been drawn from the tables. This keeps the bracket honest.

**What updates live:** brackets, tables, top scorers and the progress bar update on every staff screen and every player's phone (portal refreshes every 20 seconds). All tournament games also count on the main leaderboard.

---

## 4. Find match

### For players (portal → Match)

1. Pick the game and choose:
   - **where**: at the centre, or online over PSN;
   - **when**: now, or pick a time;
   - **opponent**: anyone, or **my level** (within 150 rating points).
2. **Find me a match** posts a request. Other players see it in *Players looking for a game* and press **Accept**.
3. **Challenge** a specific player: tap them on the Ranks page → **Challenge**, or use *Players near your level*. Only they can accept.
4. After playing, one player **reports the score**. The opponent gets *"⚠️ score to confirm"* on their home screen and taps **Confirm** (or **Wrong score**).
   - Confirmed scores go on the leaderboard.
   - Disputed scores go to staff, who see an alert and enter the real result.
5. Online matches: each player sees the other's **PSN ID** only after they are matched. Players add their PSN ID in Profile.

**Limits:**
- Up to 3 open requests per player.
- Requests expire 24 h after posting, or 2 h after the chosen time.

### For staff (Find match page)

- See everyone looking for a game, live.
- **Pair** a waiting player with any customer, e.g. someone standing at the counter.
- **Request for a customer** posts on behalf of someone without the portal.
- **Enter score** makes a result final at once. Use it for disputed scores too.

---

## 5. Permissions

`competitions.manage` controls recording results, running tournaments and pairing players.
- Cashiers, managers and admins have it by default.
- You can remove it from a user type in **Users & roles**.
- Paying a prize **into a wallet** also needs `wallet.adjust`.

---

## 6. Troubleshooting

| Message / problem | Fix |
|---|---|
| *"This game has no draws — enter the deciding score"* | The game is set to no draws. Enter the result after extra rounds, or allow draws in Leaderboard → Games. |
| *"A knockout match needs a winner — enter the penalty shoot-out…"* | Level score in a knockout: fill in both penalty boxes with different numbers. |
| *"The next match for these players has been played — clear that result first"* | You are correcting an old knockout result. Clear the later match first, then fix this one. |
| *"The knockout stage has already been drawn — group results can no longer change"* | Group results are locked once the bracket exists. |
| *"Each group must have more than N players…"* / *"N groups need at least…"* | Too few players for the group settings: use fewer groups or fewer going through. |
| *"The tournament is full"* | Raise **Maximum players** (Edit) before starting. |
| *"Registration for this tournament is closed"* (portal) | Staff must press **Open registration**, and *Portal registration* must be ticked. |
| *"You already have 3 open requests"* | Cancel one in Match → *Your open requests*. |
| *"This player wants an opponent of a similar level"* | Their request is *my level only*, and your rating is more than 150 away. |
| A player isn't on the board | They have fewer than 3 matches (they show as *placement*), or they ticked *Hide me*, or the result was a walkover. |
| `/board` shows *"The leaderboard is not public"* | Settings → Competitions → tick **Leaderboard and tournaments are public**. |
| *"That record already exists"* when saving a gamertag | Another player already uses it (letter case doesn't matter). |
