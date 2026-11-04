/* The Pods · backend
 * Serves the site and the small API it needs:
 *   content (menu, details, pods, team), reservations, votes, shout-outs,
 *   gallery photos and image uploads. Owner-only routes need the owner key.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const OWNER_KEY = process.env.OWNER_KEY;
if (!OWNER_KEY || OWNER_KEY.length < 12) {
  console.error('Set OWNER_KEY to a secret of at least 12 characters before starting.');
  process.exit(1);
}
const SALT = process.env.SALT || crypto.randomBytes(16).toString('hex');

const PUBLIC = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data');
const UPLOADS = path.join(PUBLIC, 'uploads');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);           // correct client IPs behind a host or proxy
app.use(express.json({ limit: '6mb' }));
app.use(express.static(PUBLIC, { extensions: ['html'] }));

/* ---------- storage: small JSON files, written atomically ---------- */
function read(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8')); }
  catch (e) { return fallback; }
}
function write(name, value) {
  const file = path.join(DATA, name);
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2));
  fs.renameSync(file + '.tmp', file);
}

/* ---------- owner auth ---------- */
function sameKey(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function requireOwner(req, res, next) {
  const h = req.headers.authorization || '';
  const key = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (key && sameKey(key, OWNER_KEY)) return next();
  res.status(401).json({ error: 'Owner key required.' });
}

/* ---------- rate limit per IP (memory; fine for one small site) ---------- */
const hits = new Map();
function limiter(max, windowMs) {
  return (req, res, next) => {
    const now = Date.now();
    const key = req.path + ':' + req.ip;
    const list = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (list.length >= max) return res.status(429).json({ error: 'Too many requests. Please wait a few minutes.' });
    list.push(now); hits.set(key, list); next();
  };
}
function ipHash(req) {
  return crypto.createHash('sha256').update(SALT + req.ip).digest('hex');
}

/* ---------- owner sign-in check ---------- */
app.get('/api/me', requireOwner, (req, res) => res.json({ ok: true }));

/* ---------- site content: menu, details, pods, team ---------- */
app.get('/api/content', (req, res) => res.json(read('content.json', null) || {}));
app.put('/api/content', requireOwner, (req, res) => {
  const c = req.body;
  if (!c || typeof c !== 'object' || Array.isArray(c) || !Array.isArray(c.menu) || !Array.isArray(c.team)) {
    return res.status(400).json({ error: 'Content is not in the right shape.' });
  }
  write('content.json', c);
  res.json({ ok: true });
});

/* ---------- reservations ---------- */
const OCCASIONS = ['Just dinner', 'Breakfast', 'Birthday', 'Anniversary', 'Business', 'Proposal'];
const clean = (v, max) => String(v ?? '').trim().slice(0, max);

app.post('/api/reservations', limiter(8, 10 * 60 * 1000), (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 80);
  const phone = clean(b.phone, 25);
  const email = clean(b.email, 120);
  const date = clean(b.date, 10);
  const time = clean(b.time, 5);
  const guests = parseInt(b.guests, 10);
  const occasion = OCCASIONS.includes(b.occasion) ? b.occasion : 'Just dinner';
  const notes = clean(b.notes, 500);

  if (name.length < 2) return res.status(400).json({ error: 'Please add your name.' });
  if (phone.replace(/\D/g, '').length < 7) return res.status(400).json({ error: 'Please add a phone number.' });
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'That email does not look right.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: 'Please choose a date and time.' });
  const when = new Date(date + 'T' + time + ':00');
  if (isNaN(when) || when < new Date()) return res.status(400).json({ error: 'That time has passed. Please choose another.' });
  if (!(guests >= 1 && guests <= 14)) return res.status(400).json({ error: 'Parties are 1 to 14 guests.' });

  const item = {
    ref: 'PODS-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
    name, phone, email, date, time, guests, occasion, notes,
    submitted: new Date().toISOString()
  };
  const list = read('reservations.json', []);
  list.unshift(item);
  write('reservations.json', list);
  res.json({ ref: item.ref });
});
app.get('/api/reservations', requireOwner, (req, res) => res.json(read('reservations.json', [])));

/* ---------- guest votes and shout-outs: one per guest per item, checked here ---------- */
function bump(kind, field, id, req, res) {
  const content = read('content.json', null);
  if (!content) return res.status(404).json({ error: 'The site has not been published yet.' });
  const item = (content[kind] || []).find(x => x.id === id);
  if (!item) return res.status(404).json({ error: 'Not found.' });

  const seen = read('seen.json', {});
  const key = kind + ':' + id + ':' + ipHash(req);
  if (seen[key]) return res.status(409).json({ error: 'You have already done this.' });
  seen[key] = Date.now();
  item[field] = (Number(item[field]) || 0) + 1;

  write('seen.json', seen);
  write('content.json', content);
  res.json({ [kind]: content[kind] });
}
app.post('/api/votes/:id', limiter(30, 10 * 60 * 1000), (req, res) => bump('menu', 'votes', req.params.id, req, res));
app.post('/api/shouts/:id', limiter(30, 10 * 60 * 1000), (req, res) => bump('team', 'points', req.params.id, req, res));

/* ---------- gallery and uploads ---------- */
app.get('/api/gallery', (req, res) => res.json(read('gallery.json', null)));
app.put('/api/gallery', requireOwner, (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected a list of photos.' });
  write('gallery.json', req.body);
  res.json({ ok: true });
});
app.post('/api/upload', requireOwner, (req, res) => {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(String((req.body || {}).data || ''));
  if (!m) return res.status(400).json({ error: 'Please upload a JPG, PNG or WebP image.' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 4 * 1024 * 1024) return res.status(413).json({ error: 'That image is too large.' });
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const name = crypto.randomBytes(8).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(UPLOADS, name), buf);
  res.json({ url: 'uploads/' + name });
});

app.listen(PORT, () => console.log('The Pods running on http://localhost:' + PORT));
