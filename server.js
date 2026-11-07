/*
 Banc Restaurant backend
 Requires Node.js 18 or newer. No npm packages are needed.

 Run:
   ADMIN_PASSWORD="choose-a-strong-password" node server.js

 Data is stored in data.json next to this file.
 The website itself is served from the public folder at the same address as the API.
 Put the server behind HTTPS (for example Render, Railway, or a VPS with Caddy or Nginx)
 before sharing it with customers.
*/

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const SESSION_HOURS = 12;
const PUBLIC_DIR = path.join(__dirname, "public");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".webp": "image/webp"
};

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) {
  console.error("Set ADMIN_PASSWORD (at least 8 characters) before starting the server.");
  process.exit(1);
}

/* ---------- Storage ---------- */

function defaults() {
  return {
    menu: [], news: [], wall: [], regulars: [], orders: [], reservations: [],
    giftCards: [], dining: [], gallery: [], users: {}, seq: 1
  };
}
function load() {
  try { return { ...defaults(), ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) }; }
  catch (e) { return defaults(); }
}
let db = load();
function save() {
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DATA_FILE);
}
function nextId() { db.seq += 1; return db.seq; }

/* ---------- Sessions and passwords ---------- */

const sessions = new Map(); // token -> { role, email?, expires }
function makeSession(role, email) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { role, email, expires: Date.now() + SESSION_HOURS * 3600e3 });
  return token;
}
function sessionFrom(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  const s = sessions.get(token);
  if (!s || s.expires < Date.now()) { sessions.delete(token); return null; }
  return s;
}
function hashPassword(pw, salt) {
  return crypto.scryptSync(pw, salt, 64).toString("hex");
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ---------- HTTP helpers ---------- */

function send(res, code, data) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 12 * 1024 * 1024) { reject(new Error("Request too large")); req.destroy(); }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}
const text = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

/* ---------- Routes ---------- */

async function handle(req, res, url) {
  const m = req.method;
  const p = url.pathname;
  const s = sessionFrom(req);
  const isAdmin = s && s.role === "admin";
  const need = () => send(res, 401, { error: "Admin login required" });
  const body = (m === "GET" || m === "DELETE") ? {} : await readBody(req);
  const match = (re) => p.match(re);
  let id;

  /* Admin login */
  if (m === "POST" && p === "/api/admin/login") {
    if (!safeEqual(body.password, ADMIN_PASSWORD)) return send(res, 401, { error: "Wrong password" });
    return send(res, 200, { token: makeSession("admin") });
  }

  /* Customer accounts */
  if (m === "POST" && p === "/api/auth/signup") {
    const email = text(body.email, 120).toLowerCase();
    const name = text(body.name, 80);
    const pw = String(body.password || "");
    if (!email.includes("@") || !name) return send(res, 400, { error: "Name and a valid email are required" });
    if (pw.length < 6) return send(res, 400, { error: "Password needs at least 6 characters" });
    if (db.users[email]) return send(res, 409, { error: "An account with this email already exists" });
    const salt = crypto.randomBytes(16).toString("hex");
    db.users[email] = { name, salt, hash: hashPassword(pw, salt) };
    save();
    return send(res, 201, { token: makeSession("customer", email), name });
  }
  if (m === "POST" && p === "/api/auth/login") {
    const email = text(body.email, 120).toLowerCase();
    const u = db.users[email];
    if (!u || !safeEqual(hashPassword(String(body.password || ""), u.salt), u.hash))
      return send(res, 401, { error: "Email or password is incorrect" });
    return send(res, 200, { token: makeSession("customer", email), name: u.name });
  }
  if (m === "GET" && p === "/api/auth/me") {
    if (!s || s.role !== "customer") return send(res, 401, { error: "Not signed in" });
    return send(res, 200, { email: s.email, name: db.users[s.email]?.name });
  }
  if (m === "POST" && p === "/api/auth/logout") {
    const h = req.headers.authorization || "";
    sessions.delete(h.startsWith("Bearer ") ? h.slice(7) : "");
    return send(res, 200, { ok: true });
  }

  /* Menu */
  if (m === "GET" && p === "/api/menu") return send(res, 200, db.menu);
  if (m === "POST" && p === "/api/menu") {
    if (!isAdmin) return need();
    const item = {
      id: nextId(), cat: text(body.cat, 60), name: text(body.name, 80), desc: text(body.desc, 240),
      price: Math.max(0, num(body.price)), emoji: text(body.emoji, 8) || "🍽️", photo: body.photo || null,
      adj: body.adj || { b: 100, c: 100, s: 100, w: 0 }
    };
    db.menu.push(item); save();
    return send(res, 201, item);
  }
  if (match(/^\/api\/menu\/(\d+)$/) && (id = +p.split("/")[3])) {
    if (!isAdmin) return need();
    const item = db.menu.find(x => x.id === id);
    if (!item) return send(res, 404, { error: "Dish not found" });
    if (m === "PUT") {
      if (body.name !== undefined) item.name = text(body.name, 80);
      if (body.desc !== undefined) item.desc = text(body.desc, 240);
      if (body.cat !== undefined) item.cat = text(body.cat, 60);
      if (body.price !== undefined) item.price = Math.max(0, num(body.price));
      if (body.emoji !== undefined) item.emoji = text(body.emoji, 8);
      if (body.photo !== undefined) item.photo = body.photo;
      if (body.adj !== undefined) item.adj = body.adj;
      save();
      return send(res, 200, item);
    }
    if (m === "DELETE") {
      db.menu = db.menu.filter(x => x.id !== id); save();
      return send(res, 200, { ok: true });
    }
  }

  /* News */
  if (m === "GET" && p === "/api/news") return send(res, 200, db.news);
  if (m === "POST" && p === "/api/news") {
    if (!isAdmin) return need();
    const n = { id: nextId(), title: text(body.title, 120), text: text(body.text, 600), date: new Date().toISOString().slice(0, 10) };
    if (!n.title) return send(res, 400, { error: "A headline is required" });
    db.news.unshift(n); save();
    return send(res, 201, n);
  }
  if (m === "DELETE" && (id = +(p.match(/^\/api\/news\/(\d+)$/) || [])[1])) {
    if (!isAdmin) return need();
    db.news = db.news.filter(x => x.id !== id); save();
    return send(res, 200, { ok: true });
  }

  /* Customer honor wall (feedback is approved by staff before it appears) */
  if (m === "GET" && p === "/api/wall") return send(res, 200, db.wall);
  if (m === "POST" && p === "/api/wall") {
    if (!isAdmin) return need();
    const w = { id: nextId(), name: text(body.name, 80), stars: Math.min(5, Math.max(1, num(body.stars, 5))), text: text(body.text, 400) };
    if (!w.name || !w.text) return send(res, 400, { error: "Name and words are required" });
    db.wall.unshift(w); save();
    return send(res, 201, w);
  }
  if (m === "DELETE" && (id = +(p.match(/^\/api\/wall\/(\d+)$/) || [])[1])) {
    if (!isAdmin) return need();
    db.wall = db.wall.filter(x => x.id !== id); save();
    return send(res, 200, { ok: true });
  }

  /* Regulars club */
  if (m === "GET" && p === "/api/regulars") {
    const list = [...db.regulars].sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name)).slice(0, 10);
    return send(res, 200, list);
  }
  if (m === "POST" && p === "/api/regulars") {
    const name = text(body.name, 80);
    if (!name) return send(res, 400, { error: "Please enter your name" });
    if (db.regulars.some(r => r.name.toLowerCase() === name.toLowerCase()))
      return send(res, 409, { error: "You are already in the club" });
    const r = { id: nextId(), name, visits: 0 };
    db.regulars.push(r); save();
    return send(res, 201, r);
  }
  if (m === "POST" && (id = +(p.match(/^\/api\/regulars\/(\d+)\/checkin$/) || [])[1])) {
    if (!isAdmin) return need();
    const r = db.regulars.find(x => x.id === id);
    if (!r) return send(res, 404, { error: "Not found" });
    r.visits += 1; save();
    return send(res, 200, r);
  }

  /* Orders and the kitchen */
  if (m === "POST" && p === "/api/orders") {
    const lines = Array.isArray(body.lines) ? body.lines.slice(0, 50).map(l => ({
      name: text(l.name, 80), qty: Math.max(1, Math.min(99, num(l.qty, 1))), price: Math.max(0, num(l.price))
    })) : [];
    if (!lines.length) return send(res, 400, { error: "The order is empty" });
    const mode = body.mode === "delivery" ? "delivery" : "pickup";
    const total = lines.reduce((t, l) => t + l.qty * l.price, 0) + (mode === "delivery" ? 15 : 0);
    const o = {
      id: nextId(), name: text(body.name, 80), mode, payment: text(body.payment, 30) || "Card",
      lines, total, status: "new", placedAt: new Date().toISOString()
    };
    db.orders.push(o); save();
    return send(res, 201, o);
  }
  if (m === "GET" && p === "/api/orders") {
    if (!isAdmin) return need();
    return send(res, 200, db.orders.filter(o => o.status !== "done"));
  }
  if (m === "PATCH" && (id = +(p.match(/^\/api\/orders\/(\d+)$/) || [])[1])) {
    if (!isAdmin) return need();
    const o = db.orders.find(x => x.id === id);
    if (!o) return send(res, 404, { error: "Order not found" });
    if (["new", "cooking", "ready", "done"].includes(body.status)) o.status = body.status;
    save();
    return send(res, 200, o);
  }

  /* Reservations, gift cards and dining requests */
  if (m === "POST" && p === "/api/reservations") {
    const r = { id: nextId(), name: text(body.name, 80), phone: text(body.phone, 30), date: text(body.date, 20), time: text(body.time, 10), party: text(body.party, 6), seating: text(body.seating, 20) };
    if (!r.name || !r.date) return send(res, 400, { error: "Name and date are required" });
    db.reservations.push(r); save();
    return send(res, 201, r);
  }
  if (m === "GET" && p === "/api/reservations") {
    if (!isAdmin) return need();
    return send(res, 200, db.reservations);
  }
  if (m === "POST" && p === "/api/giftcards") {
    const amount = [100, 200, 500, 1000].includes(+body.amount) ? +body.amount : 200;
    const code = "BR-" + crypto.randomBytes(4).toString("hex").toUpperCase().match(/.{4}/g).join("-");
    const g = { id: nextId(), code, amount, buyer: text(body.buyer, 80), recipient: text(body.recipient, 80), note: text(body.note, 300) };
    if (!g.buyer || !g.recipient) return send(res, 400, { error: "Buyer and recipient names are required" });
    db.giftCards.push(g); save();
    return send(res, 201, g);
  }
  if (m === "GET" && p === "/api/giftcards") {
    if (!isAdmin) return need();
    return send(res, 200, db.giftCards);
  }
  if (m === "POST" && p === "/api/dining") {
    const d = { id: nextId(), type: text(body.type, 40), date: text(body.date, 20), guests: text(body.guests, 6), name: text(body.name, 80), phone: text(body.phone, 30), details: text(body.details, 1000) };
    if (!d.name || !d.date || !d.guests) return send(res, 400, { error: "Date, guests and name are required" });
    db.dining.push(d); save();
    return send(res, 201, d);
  }
  if (m === "GET" && p === "/api/dining") {
    if (!isAdmin) return need();
    return send(res, 200, db.dining);
  }

  /* Gallery (admin uploads, public viewing) */
  if (m === "GET" && p === "/api/gallery") return send(res, 200, db.gallery);
  if (m === "POST" && p === "/api/gallery") {
    if (!isAdmin) return need();
    if (db.gallery.length >= 12) return send(res, 400, { error: "The gallery is full (12 photos)" });
    if (!String(body.photo || "").startsWith("data:image/")) return send(res, 400, { error: "Send a photo as an image data URL" });
    db.gallery.push(body.photo); save();
    return send(res, 201, { count: db.gallery.length });
  }
  if (m === "DELETE" && (id = +(p.match(/^\/api\/gallery\/(\d+)$/) || [])[1])) {
    if (!isAdmin) return need();
    db.gallery.splice(id, 1); save();
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: "Not found" });
}

/* ---------- Server ---------- */

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && !url.pathname.startsWith("/api")) {
    const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const full = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!full.startsWith(PUBLIC_DIR)) return send(res, 404, { error: "Not found" });
    return fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
      res.end(data);
    });
  }
  try {
    await handle(req, res, url);
  } catch (e) {
    send(res, 400, { error: e.message || "Bad request" });
  }
});

server.listen(PORT, () => console.log(`Banc Restaurant API running on port ${PORT}`));
