// Runs every API test in tests/api against a throw-away server on port 5059 and prints one summary.
//   cd server && node tests/run-all.mjs [filter]      e.g.  node tests/run-all.mjs task19
//
// WARNING: these tests write to the database in server/.env (the shared Supabase DB). Every row they create is named ZZTEST*
// and removed again, but they do consume sequence numbers (PO, GRN, ORD ...), so real numbering gets gaps. Do not run against production.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';
const files = fs.readdirSync(path.join(here, 'api')).filter((f) => f.endsWith('.mjs') && f.includes(filter)).sort();
const env = {
  ...process.env, PORT: '5059', NODE_ENV: 'development',
  SMS_API_URL: 'http://127.0.0.1:5058/sms', SMS_API_KEY: 'test-key-123', // task25 starts its own fake gateway on 5058
};
delete env.USE_QUEUE;

const server = spawn(process.execPath, ['src/index.js'], { cwd: path.join(here, '..'), env, stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch('http://localhost:5059/api/health')).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not start on port 5059 (is something else using it?)');
}

function run(file) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(here, 'api', file)], { cwd: path.join(here, '..'), env });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ out, code }));
  });
}

let totalPass = 0; let totalFail = 0; const bad = [];
try {
  await waitForServer();
  for (const f of files) {
    const t0 = Date.now();
    const { out, code } = await run(f);
    const pass = (out.match(/^PASS /gm) || []).length;
    const fail = (out.match(/^FAIL /gm) || []).length;
    const crashed = code !== 0 && fail === 0; // died before reporting (e.g. a thrown error)
    totalPass += pass; totalFail += fail + (crashed ? 1 : 0);
    console.log(`${fail || crashed ? 'FAIL' : 'ok  '} ${f.padEnd(40)} ${String(pass).padStart(3)} passed, ${fail} failed${crashed ? ' (crashed)' : ''}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    if (fail || crashed) bad.push(`--- ${f}\n${out.split('\n').filter((l) => /^FAIL|Error|error/.test(l)).slice(0, 8).join('\n')}`);
  }
} finally { stop(); }
if (bad.length) console.log('\n' + bad.join('\n'));
console.log(`\n${totalPass} passed, ${totalFail} failed across ${files.length} files`);
process.exit(totalFail ? 1 : 0);
