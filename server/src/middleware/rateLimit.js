// Brute-force protection for login. In-memory, per API instance, no extra package.
// shortcut: counters live in this process and reset on restart; with several API servers each keeps its own count. Move to Redis when scaling out.
const hits = new Map(); // "bucket:key" -> { count, reset }
const MAX_ENTRIES = 20_000;

function prune(now) {
  for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  while (hits.size > MAX_ENTRIES) hits.delete(hits.keys().next().value); // oldest first
}
setInterval(() => prune(Date.now()), 5 * 60_000).unref();

/**
 * Counts FAILED requests (any 4xx/5xx except 429) per bucket and blocks a bucket once it has `max` failures inside the window.
 * buckets: [{ name, max, key(req) -> string, resetOnSuccess? }]. A successful (2xx) response clears the buckets marked resetOnSuccess,
 * so a real user who finally types the right password is not penalised for earlier typos.
 */
export function failureLimiter({ windowMs = 15 * 60_000, buckets }) {
  return (req, res, next) => {
    const now = Date.now();
    const keyed = buckets.map((b) => ({ ...b, id: `${b.name}:${b.key(req)}` }));
    for (const b of keyed) {
      const e = hits.get(b.id);
      if (e && e.reset > now && e.count >= b.max) {
        const wait = Math.ceil((e.reset - now) / 1000);
        res.set('Retry-After', String(wait));
        return res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minute(s).` });
      }
    }
    res.on('finish', () => {
      const t = Date.now();
      for (const b of keyed) {
        if (res.statusCode < 400) { if (b.resetOnSuccess) hits.delete(b.id); continue; }
        if (res.statusCode === 429) continue;
        const e = hits.get(b.id);
        if (e && e.reset > t) e.count += 1;
        else hits.set(b.id, { count: 1, reset: t + windowMs });
      }
      if (hits.size > MAX_ENTRIES) prune(t);
    });
    next();
  };
}

const idOf = (req) => String(req.body?.loginId ?? '').toLowerCase().slice(0, 100);

/** 10 failed logins per login ID per IP, and 50 failed logins per IP, per 15 minutes. LOGIN_MAX_PER_ID / LOGIN_MAX_PER_IP override the limits. */
export const loginLimiter = failureLimiter({
  buckets: [
    { name: 'login-id', max: Number(process.env.LOGIN_MAX_PER_ID) || 10, key: (req) => `${req.ip}|${idOf(req)}`, resetOnSuccess: true },
    { name: 'login-ip', max: Number(process.env.LOGIN_MAX_PER_IP) || 50, key: (req) => String(req.ip) },
  ],
});
