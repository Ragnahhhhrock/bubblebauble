// Bubble Bauble: static site + global high score table.
// Static files are served by Workers Assets; /api/scores is handled here and
// backed by a single SQLite-backed Durable Object.
import { DurableObject } from "cloudflare:workers";

const MAX_KEEP = 500;      // rows retained
const TOP_N = 25;          // rows returned
const MAX_PER_LEVEL = 60000;
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === "/api/scores") {
      if (request.method !== "GET" && request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405, { allow: "GET, POST" });
      }
      const stub = env.SCOREBOARD.get(env.SCOREBOARD.idFromName("global"));
      if (request.method === "GET") return json({ scores: await stub.list() });

      const origin = request.headers.get("origin");
      if (origin && new URL(origin).host !== url.host) return json({ error: "Forbidden" }, 403);
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

      const name = String(body?.name ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 12);
      const score = Number(body?.score);
      const level = Number(body?.level);
      if (!name) return json({ error: "Please enter a name." }, 400);
      if (!Number.isInteger(score) || score < 1 || !Number.isInteger(level) || level < 1 || level > 99) {
        return json({ error: "Invalid score." }, 400);
      }
      if (score > level * MAX_PER_LEVEL) return json({ error: "Score rejected." }, 400);

      const ip = request.headers.get("cf-connecting-ip") || "unknown";
      const out = await stub.submit(name, score, level, ip);
      return json(out.body, out.status);
    }

    return env.ASSETS.fetch(request);
  },
};

export class Scoreboard extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, score INTEGER NOT NULL, level INTEGER NOT NULL, ts INTEGER NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_score ON scores (score DESC, ts ASC)`);
    this.last = new Map(); // ip -> last submit time (resets if the object is evicted)
  }

  top() {
    return this.sql.exec(`SELECT id, name, score, level FROM scores ORDER BY score DESC, ts ASC LIMIT ?`, TOP_N).toArray();
  }

  async list() {
    return this.top();
  }

  async submit(name, score, level, ip) {
    const now = Date.now();
    if (now - (this.last.get(ip) || 0) < 10_000) return { status: 429, body: { error: "Too fast. Wait a few seconds." } };
    this.last.set(ip, now);
    if (this.last.size > 2000) this.last.clear();

    const id = this.sql
      .exec(`INSERT INTO scores (name, score, level, ts) VALUES (?, ?, ?, ?) RETURNING id`, name, score, level, now)
      .one().id;
    const rank = this.sql.exec(
      `SELECT COUNT(*) AS n FROM scores WHERE score > ? OR (score = ? AND ts < ?)`, score, score, now,
    ).one().n + 1;
    this.sql.exec(
      `DELETE FROM scores WHERE id IN (SELECT id FROM scores ORDER BY score DESC, ts ASC LIMIT -1 OFFSET ?)`, MAX_KEEP,
    );
    const scores = this.top();
    return { status: 200, body: { id, rank: rank <= TOP_N ? rank : null, scores } };
  }
}
