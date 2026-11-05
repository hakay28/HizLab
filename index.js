import express from 'express';
import cors from 'cors';
import { randomBytes } from 'node:crypto';

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: '*' })); // Public test endpoint: no credentials or private data.
app.use(express.raw({ type: 'application/octet-stream', limit: '1mb' }));

// Basic per-IP request and transfer limits for a small public demo.
// In-memory counters reset on restart and are NOT a substitute for provider-level protection.
const clients = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 2000;
const MAX_BYTES = 512 * 1024 * 1024;
const MAX_ACTIVE = 8;
app.use((req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const current = Date.now();
  let s = clients.get(ip);
  if (!s || current - s.since >= WINDOW_MS) {
    s = { since: current, requests: 0, bytes: 0, active: 0 };
    clients.set(ip, s);
  }
  if (s.requests >= MAX_REQUESTS || s.bytes >= MAX_BYTES || s.active >= MAX_ACTIVE) {
    return res.status(429).json({ error: 'Rate limit reached; retry later' });
  }
  s.requests++;
  s.active++;
  let released = false;
  const release = () => { if (!released) { released = true; s.active--; } };
  res.once('close', release);
  res.once('finish', release);
  res.locals.quota = s;
  next();
});
setInterval(() => {
  const t = Date.now();
  for (const [ip, s] of clients) if (t - s.since > WINDOW_MS) clients.delete(ip);
}, WINDOW_MS).unref();

app.get('/', (_req, res) => res.json({ name: 'HizLab test server', status: 'ok' }));
app.get('/ping', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true });
});

const CHUNK = randomBytes(64 * 1024);
app.get('/download', (req, res) => {
  const requested = Number(req.query.bytes);
  const bytes = Number.isFinite(requested) ? Math.floor(requested) : 4_000_000;
  if (bytes < 1024 || bytes > 8_000_000) {
    return res.status(400).json({ error: 'bytes must be 1024..8000000' });
  }
  const quota = res.locals.quota;
  if (quota.bytes + bytes > MAX_BYTES) {
    return res.status(429).json({ error: 'Transfer quota reached' });
  }
  quota.bytes += bytes; // Reserve full response, even if client disconnects.
  res.set({
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'no-store, no-transform',
    'Content-Length': String(bytes),
    'X-Content-Type-Options': 'nosniff'
  });
  let left = bytes;
  function write() {
    while (left > 0 && !res.destroyed) {
      const n = Math.min(left, CHUNK.length);
      left -= n;
      if (!res.write(CHUNK.subarray(0, n))) {
        res.once('drain', write);
        return;
      }
    }
    if (!res.destroyed) res.end();
  }
  write();
});

app.post('/upload', (req, res) => {
  const received = req.body instanceof Buffer ? req.body.length : 0;
  if (!received || received > 1_000_000) return res.status(400).json({ error: 'Invalid upload' });
  const quota = res.locals.quota;
  if (quota.bytes + received > MAX_BYTES) return res.status(429).json({ error: 'Transfer quota reached' });
  quota.bytes += received;
  res.set('Cache-Control', 'no-store');
  res.json({ received });
});

app.use((err, _req, res, _next) => {
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.status === 413 ? 'Upload too large' : 'Server error' });
});
const port = Number(process.env.PORT) || 3001;
app.listen(port, '0.0.0.0', () => console.log(`HizLab server listening on ${port}`));
