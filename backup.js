'use strict';
/**
 * Backup & restore of everything that matters: accounts (logins), progress, quiz attempts,
 * the audit log (every change), and settings (certificate signature, logo, signatory).
 *
 * Why: Render's disk is temporary. Without this, every redeploy would erase all users.
 *
 *  - Every change (anything that writes to the audit log) schedules a push to a PRIVATE GitHub repo.
 *    One commit per batch of changes, on its own branch, so it never triggers a redeploy of the site.
 *  - On startup, if the database is empty, the latest snapshot is restored from GitHub automatically.
 *  - Without GitHub configured, a local file backup/snapshot.json is written instead, ready for `git push`.
 *
 * The snapshot has one row per line, so `git log -p` / `git diff` shows exactly what changed.
 * It contains password HASHES and email addresses: keep the repository private.
 *
 * CLI:  node backup.js export [file]   write a snapshot file (default backup/snapshot.json)
 *       node backup.js import [file]   restore from a snapshot file (asks for --force if data exists)
 *       node backup.js push            push a snapshot to GitHub now
 *       node backup.js pull            restore from GitHub now (asks for --force if data exists)
 */
try { require('dotenv').config(); } catch (_) {}
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, hooks, seedAdmin, ensureSuperAdmin } = require('./db');

const TABLES = [ // order matters for inserts (parents first)
  { name: 'users', order: 'id' },
  { name: 'progress', order: 'user_id, section_id' },
  { name: 'attempts', order: 'id' },
  { name: 'audit', order: 'id' },
  { name: 'settings', order: 'key' }
];
const FORMAT = 1;

const cfg = () => ({
  token: process.env.GITHUB_TOKEN || '',
  repo: (process.env.GITHUB_BACKUP_REPO || '').trim(),
  branch: (process.env.GITHUB_BACKUP_BRANCH || 'data-backup').trim(),
  file: (process.env.GITHUB_BACKUP_PATH || 'backup/snapshot.json').trim().replace(/^\/+/, ''),
  api: (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, ''),
  delayMs: Math.max(1, Number(process.env.BACKUP_DELAY_SECONDS || 30)) * 1000,
  localFile: process.env.BACKUP_LOCAL_FILE || path.join(__dirname, 'backup', 'snapshot.json')
});
const githubConfigured = () => { const c = cfg(); return !!(c.token && /^[\w.-]+\/[\w.-]+$/.test(c.repo)); };

const status = { configured: githubConfigured(), repo: cfg().repo || null, branch: cfg().branch, file: cfg().file,
  lastSuccess: null, lastError: null, lastCommit: null, pending: false, running: false, blocked: false, lastRestore: null };

// ---------- snapshot ----------
const enc = (v) => (v instanceof Uint8Array ? { $b64: Buffer.from(v).toString('base64') } : v);
const dec = (v) => (v && typeof v === 'object' && typeof v.$b64 === 'string' ? Buffer.from(v.$b64, 'base64') : v);

function buildSnapshot() {
  const tables = {};
  for (const t of TABLES) {
    tables[t.name] = db.prepare(`SELECT * FROM ${t.name} ORDER BY ${t.order}`).all()
      .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, enc(v)])));
  }
  return { format: FORMAT, app: 'fire-safety-academy', tables };
}
// One row per line: small, readable git diffs.
function serialize(snap) {
  const body = TABLES.map((t) => {
    const rows = snap.tables[t.name];
    return `    ${JSON.stringify(t.name)}: [${rows.length ? '\n' + rows.map((r) => '      ' + JSON.stringify(r)).join(',\n') + '\n    ' : ''}]`;
  }).join(',\n');
  return `{\n  "format": ${FORMAT},\n  "app": "fire-safety-academy",\n  "tables": {\n${body}\n  }\n}\n`;
}
const currentText = () => serialize(buildSnapshot());
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function counts() {
  const o = {}; for (const t of TABLES) o[t.name] = db.prepare(`SELECT COUNT(*) c FROM ${t.name}`).get().c; return o;
}
const isFresh = () => {
  const c = counts();
  return c.users <= 1 && c.progress === 0 && c.attempts === 0;
};

// ---------- restore ----------
function applySnapshot(snap) {
  if (!snap || snap.format !== FORMAT || !snap.tables || !Array.isArray(snap.tables.users)) throw new Error('Not a valid Fire Safety Academy snapshot.');
  for (const t of TABLES) if (!Array.isArray(snap.tables[t.name])) throw new Error(`Snapshot is missing the "${t.name}" table.`);
  if (!snap.tables.users.length) throw new Error('Snapshot contains no users, refusing to restore it.');
  db.transaction(() => {
    for (const n of ['attempts', 'progress', 'otps', 'audit', 'settings', 'users']) db.prepare(`DELETE FROM ${n}`).run();
    for (const t of TABLES) {
      const cols = db.prepare(`PRAGMA table_info(${t.name})`).all().map((c) => c.name);
      for (const row of snap.tables[t.name]) {
        const use = cols.filter((c) => Object.prototype.hasOwnProperty.call(row, c));
        db.prepare(`INSERT INTO ${t.name} (${use.join(',')}) VALUES (${use.map(() => '?').join(',')})`).run(...use.map((c) => dec(row[c])));
      }
    }
  })();
  // Make sure the site is never left without an administrator / Super Admin.
  seedAdmin(); ensureSuperAdmin();
  status.lastRestore = Date.now();
  return counts();
}
const applyText = (text) => applySnapshot(JSON.parse(text));

// ---------- GitHub ----------
async function gh(method, urlPath, body, raw) {
  const c = cfg();
  const res = await fetch(c.api + urlPath, {
    method,
    headers: { Authorization: `Bearer ${c.token}`, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'fire-safety-academy-backup', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000)
  });
  const text = await res.text();
  if (raw && res.ok) return { status: res.status, text };
  let json = {}; try { json = text ? JSON.parse(text) : {}; } catch (_) {}
  return { status: res.status, json, text };
}
const explain = (r, what) => {
  const msg = (r.json && r.json.message) || r.text || '';
  if (r.status === 401) return `GitHub rejected the token (401) while ${what}. Check GITHUB_TOKEN.`;
  if (r.status === 403) return `GitHub refused access (403) while ${what}: ${msg}. The token needs "Contents: Read and write" on the backup repo.`;
  if (r.status === 404) return `GitHub could not find the repository (404) while ${what}. Check GITHUB_BACKUP_REPO and that the token can see it.`;
  return `GitHub error ${r.status} while ${what}: ${msg}`.slice(0, 300);
};
const enc64 = (p) => p.split('/').map(encodeURIComponent).join('/');

async function ensureBranch() {
  const c = cfg();
  const b = await gh('GET', `/repos/${c.repo}/branches/${encodeURIComponent(c.branch)}`);
  if (b.status === 200) return;
  if (b.status !== 404) throw new Error(explain(b, 'checking the backup branch'));
  const repo = await gh('GET', `/repos/${c.repo}`);
  if (repo.status !== 200) throw new Error(explain(repo, 'reading the repository'));
  const def = await gh('GET', `/repos/${c.repo}/branches/${encodeURIComponent(repo.json.default_branch)}`);
  if (def.status !== 200) throw new Error('The backup repository is empty. Create it with a README first, so it has a first commit.');
  const mk = await gh('POST', `/repos/${c.repo}/git/refs`, { ref: `refs/heads/${c.branch}`, sha: def.json.commit.sha });
  if (mk.status !== 201 && mk.status !== 422) throw new Error(explain(mk, 'creating the backup branch'));
}

async function readRemote() { // -> text or null when no snapshot exists yet
  const c = cfg();
  const r = await gh('GET', `/repos/${c.repo}/contents/${enc64(c.file)}?ref=${encodeURIComponent(c.branch)}`, null, true);
  if (r.status === 200) return r.text;
  if (r.status === 404) return null;
  throw new Error(explain(r, 'reading the backup'));
}

let lastHash = null, lastAuditId = null;
function summary() {
  const c = counts();
  let acts = '';
  if (lastAuditId !== null) {
    const rows = db.prepare('SELECT action, COUNT(*) n FROM audit WHERE id > ? GROUP BY action ORDER BY n DESC LIMIT 6').all(lastAuditId);
    acts = rows.map((r) => (r.n > 1 ? `${r.action} x${r.n}` : r.action)).join(', ');
  }
  const max = db.prepare('SELECT MAX(id) m FROM audit').get().m || 0;
  return { msg: `Backup: ${acts || 'snapshot'} (${c.users} users, ${c.audit} log entries)`.slice(0, 250), max };
}

async function pushGithub(force) {
  const c = cfg();
  const text = currentText(); const h = sha(text);
  if (!force && h === lastHash) return { skipped: true };
  await ensureBranch();
  const { msg, max } = summary();
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await gh('GET', `/repos/${c.repo}/contents/${enc64(c.file)}?ref=${encodeURIComponent(c.branch)}`);
    if (cur.status !== 200 && cur.status !== 404) throw new Error(explain(cur, 'reading the existing backup'));
    const put = await gh('PUT', `/repos/${c.repo}/contents/${enc64(c.file)}`, {
      message: msg, content: Buffer.from(text).toString('base64'), branch: c.branch, ...(cur.status === 200 ? { sha: cur.json.sha } : {}) });
    if (put.status === 200 || put.status === 201) {
      lastHash = h; lastAuditId = max;
      return { commit: put.json.commit && put.json.commit.html_url, message: msg };
    }
    if (put.status !== 409 && put.status !== 422) throw new Error(explain(put, 'saving the backup'));
  }
  throw new Error('GitHub reported a conflict while saving the backup. It will be retried.');
}

function writeLocal() {
  const c = cfg();
  fs.mkdirSync(path.dirname(c.localFile), { recursive: true });
  const text = currentText();
  if (sha(text) === lastHash) return { skipped: true };
  fs.writeFileSync(c.localFile, text, { mode: 0o600 });
  lastHash = sha(text);
  return { file: c.localFile };
}

// ---------- scheduling ----------
let timer = null, running = null, again = false;
async function runNow(force) {
  if (running) { again = true; return running; }
  if (status.blocked) throw new Error('Backups are paused: the startup check against GitHub has not succeeded yet, so the empty database is not allowed to overwrite your saved data.');
  status.running = true;
  running = (async () => {
    try {
      const r = githubConfigured() ? await pushGithub(force) : writeLocal();
      status.lastError = null;
      if (!r.skipped) { status.lastSuccess = Date.now(); if (r.commit) status.lastCommit = r.commit; }
      status.pending = false;
      return r;
    } catch (e) {
      status.lastError = e.message; status.pending = true;
      console.error('Backup failed:', e.message);
      schedule(); // retry later
      throw e;
    } finally { status.running = false; running = null; if (again) { again = false; schedule(); } }
  })();
  return running;
}
function schedule() {
  status.pending = true;
  if (timer) return;
  timer = setTimeout(() => { timer = null; runNow().catch(() => {}); }, Math.max(cfg().delayMs, status.lastError ? 60000 : 0));
  if (timer.unref) timer.unref();
}
async function flush(maxMs) { // called on shutdown: push anything still waiting
  if (timer) { clearTimeout(timer); timer = null; }
  if (!status.pending && !running) return;
  await Promise.race([runNow().catch(() => {}), new Promise((r) => setTimeout(r, maxMs || 8000))]);
}

// ---------- startup ----------
async function init() {
  hooks.onChange = schedule;
  if (!githubConfigured()) {
    console.log('Backup: GitHub is not configured. Changes are saved to backup/snapshot.json (push that file to a PRIVATE repo), or set GITHUB_TOKEN and GITHUB_BACKUP_REPO.');
    lastHash = null; schedule();
    return;
  }
  if (isFresh()) { // new/empty database (e.g. after a Render redeploy): bring the data back
    try {
      const text = await readRemote();
      if (text) { const c = applyText(text); lastHash = sha(currentText()); console.log(`Backup: restored from GitHub (${c.users} users, ${c.progress} progress rows, ${c.audit} log entries).`); }
      else console.log('Backup: no snapshot on GitHub yet; the first one will be pushed after the first change.');
    } catch (e) {
      status.blocked = true; status.lastError = e.message;
      console.error('Backup: could not check GitHub for existing data:', e.message, '\n  Backups are paused until this works, so an empty database cannot overwrite your saved data. Retrying every minute.');
      const retry = setInterval(async () => {
        try {
          const text = await readRemote();
          if (text) applyText(text);
          status.blocked = false; status.lastError = null; clearInterval(retry); console.log('Backup: GitHub check succeeded; backups resumed.'); schedule();
        } catch (er) { status.lastError = er.message; }
      }, 60000);
      retry.unref();
    }
  }
  schedule(); // also pushes an initial snapshot if none exists yet
}

async function restoreFromGithub() {
  if (!githubConfigured()) throw new Error('GitHub backup is not configured.');
  const text = await readRemote();
  if (!text) throw new Error('There is no snapshot on GitHub yet.');
  const c = applyText(text);
  lastHash = sha(currentText());
  return c;
}

module.exports = { init, flush, runNow, schedule, status, currentText, applyText, restoreFromGithub, githubConfigured, isFresh, counts, cfg };

// ---------- CLI ----------
if (require.main === module) {
  (async () => {
    const [cmd, arg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
    const force = process.argv.includes('--force');
    const file = arg || cfg().localFile;
    if (cmd === 'export') { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, currentText(), { mode: 0o600 }); console.log('Snapshot written to', file, counts()); }
    else if (cmd === 'import') {
      if (!isFresh() && !force) { console.error('The database already has data. Re-run with --force to replace it.'); process.exit(1); }
      console.log('Restored:', applyText(fs.readFileSync(file, 'utf8')));
    } else if (cmd === 'push') { console.log(await pushGithub(true)); }
    else if (cmd === 'pull') {
      if (!isFresh() && !force) { console.error('The database already has data. Re-run with --force to replace it.'); process.exit(1); }
      console.log('Restored:', await restoreFromGithub());
    } else { console.log('Usage: node backup.js export|import [file] | push | pull   (add --force to overwrite existing data)'); process.exit(cmd ? 1 : 0); }
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
