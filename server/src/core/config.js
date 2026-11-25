import 'dotenv/config';

// TRUST_PROXY: set to 1 (or the number of proxies) when the API runs behind a reverse proxy / load balancer, so req.ip is the real client.
const proxy = process.env.TRUST_PROXY;
const trustProxy = !proxy || proxy === 'false' ? false : proxy === 'true' ? true : Number.isInteger(Number(proxy)) ? Number(proxy) : proxy;

export const config = {
  port: Number(process.env.PORT) || 5000,
  env: process.env.NODE_ENV || 'development',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  trustProxy,
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
  },
};

/**
 * Called once at startup. In production, refuses to start on unsafe configuration; elsewhere only warns.
 * Messages name the variable, never its value.
 */
export function assertConfig(env = process.env, mode = config.env) {
  const problems = [];
  const a = env.JWT_ACCESS_SECRET; const r = env.JWT_REFRESH_SECRET;
  const weak = (s) => !s || s.length < 32 || /^change-me/i.test(s);
  if (weak(a)) problems.push('JWT_ACCESS_SECRET must be set to a random string of at least 32 characters (not the example value)');
  if (weak(r)) problems.push('JWT_REFRESH_SECRET must be set to a random string of at least 32 characters (not the example value)');
  if (a && r && a === r) problems.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  if (!env.DATABASE_URL) problems.push('DATABASE_URL must be set');
  if (!env.CLIENT_URL) problems.push('CLIENT_URL must be set to the web app origin (CORS allows only this origin)');
  if (env.USE_QUEUE === 'true' && !env.REDIS_URL) problems.push('REDIS_URL must be set when USE_QUEUE=true');
  if (!problems.length) return;
  if (mode === 'production') throw new Error(`Unsafe production configuration:\n - ${problems.join('\n - ')}`);
  console.warn(`[config] warning (fatal in production):\n - ${problems.join('\n - ')}`);
}
