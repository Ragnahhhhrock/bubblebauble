# Bubble Bauble

A Christmas puzzle bobble game for mobile browsers, live at **https://bubblebauble.com**.
Aim, fire and match festive baubles. Elf mascots load the cannon and cheer you on, and a global high score table keeps score.

Another [Mal Gordon](https://malgordon.com) creation. Created as part of the [30products30days.com](https://30products30days.com) challenge.

## Structure

- `public/` – the static game (`index.html`, music, icons, Open Graph image)
- `worker/index.js` – Cloudflare Worker: serves the site and the `/api/scores` high score API (SQLite-backed Durable Object)
- `wrangler.jsonc` – Worker config (static assets, Durable Object, `bubblebauble.com` custom domain)

## Develop

```sh
npm install
npm run dev      # http://localhost:8787
npm run deploy   # needs a Cloudflare login / API token
```

## High score API

- `GET /api/scores` returns the top 25: `{ "scores": [{ "id", "name", "score", "level" }] }`
- `POST /api/scores` with `{ "name", "score", "level" }` saves a score and returns `{ id, rank, scores }`

Scores are submitted by the browser, so the table is for fun, not tamper-proof. The Worker limits name length, caps scores per level and allows one submission per IP every 10 seconds.
