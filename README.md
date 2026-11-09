# Ascend

A calm online card game for 2–4 players, based on the rules of the classic *Rack-O*.
Arrange your 10 cards from lowest to highest by swapping one card per turn. The first player with a perfect climb wins the round.

- Real online multiplayer with room codes and invite links (2–4 players, plus optional bots)
- Sound effects and ambient background music, all synthesised in the browser (no audio files)
- If you refresh or drop out you rejoin your seat. If you're gone more than 45 s, autopilot plays for you.
- Keyboard shortcuts: **D** draws from the deck, **T** takes the discard, **X** discards your drawn card, and **1–9, 0** pick a slot (1 = bottom).

## Play locally

```bash
npm install
npm start
```

Open http://localhost:3000. You can test multiplayer by opening a second tab.

## Put it online (Netlify + Render)

Netlify only hosts static files, and the multiplayer server has to stay running to hold live connections. So the game is split into two parts:

| Part | What it is | Where |
|---|---|---|
| Website | `public/` folder | **Netlify** |
| Game server | `server.js` + `game.js` | **Render** (free), Railway, Fly.io, or any Node host |

1. **Server → Render.** Push this folder to GitHub. In Render, choose **New → Blueprint**, pick the repo, and it reads `render.yaml`. You'll get a URL such as `https://ascend-game.onrender.com`.
2. **Point the website at it.** In `public/config.js` set
   `window.ASCEND_SERVER = 'wss://ascend-game.onrender.com';` (use `wss://`, not `https://`).
3. **Website → Netlify.** In Netlify, choose **Add new site → Import from Git**, then pick the repo. `netlify.toml` already tells it to publish `public/`. (You can also drag the `public` folder onto Netlify's dashboard.)
4. Share your Netlify link. Create a room and send your friends the code or the invite link.

Notes:
- Render's free tier sleeps after about 15 minutes idle, so the first visit after that can take around 30–60 seconds to connect.
- Rooms live in server memory, so restarting the server ends any games in progress.
- *Simpler alternative:* the Node server also serves the website, so you can skip Netlify and just use the Render URL directly.

## Rules

- Deck: 2 players use cards 1–40, 3 players 1–50, 4 players 1–60. Each player is dealt 10 cards into slots in the order dealt.
- On your turn, take the top discard **or** draw from the deck. You must place a discard you take. A deck card can be placed or thrown away.
- The card you replace goes onto the discard pile.
- Scoring: going out ("ascending") earns 75. Everyone else earns 5 points per card in order counting up from the bottom slot. With optional run bonuses, the winner also gets +50/100/200/400 for a run of 3/4/5/6+ consecutive numbers.
- **2-player games:** to win a round, your rack must also have at least 3 consecutive numbers side by side (like 14, 15, 16).
- The first player to reach the target score (500 by default) wins.

`npm test` simulates a few hundred bot games to check the rules engine.
