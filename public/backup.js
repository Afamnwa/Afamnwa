'use strict';
// Encrypted backup of the SQLite database to any S3-compatible bucket (Cloudflare R2, Backblaze B2, AWS S3, Supabase...).
// Needed on hosts whose disk is wiped (Render free plan). No extra npm packages.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const env = process.env;
const enabled = !!(env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
const REGION = env.S3_REGION || 'auto';
const PREFIX = (env.S3_PREFIX || 'fire-safety-academy').replace(/^\/+|\/+$/g, '');
const KEY_NAME = `${PREFIX}/academy-backup.enc`;
const DATA_DIR = env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'academy.db');
const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json');

const sha256hex = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function signedRequest(method, body, extraHeaders = {}) {
  const base = new URL(env.S3_ENDPOINT.replace(/\/+$/, ''));
  const canonicalPath = '/' + [env.S3_BUCKET, ...KEY_NAME.split('/')].map(enc).join('/');
  const prefixPath = base.pathname.replace(/\/+$/, '');
  const urlPath = prefixPath + canonicalPath;
  const amz = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amz.slice(0, 8);
  const payloadHash = sha256hex(body || '');
  const headers = { host: base.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amz, ...extraHeaders };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonHeaders = names.map((n) => `${n}:${String(headers[Object.keys(headers).find((k) => k.toLowerCase() === n)]).trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonical = [method, urlPath.split('/').map((s) => s).join('/'), '', canonHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${REGION}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha256hex(canonical)].join('\n');
  let k = hmac('AWS4' + env.S3_SECRET_ACCESS_KEY, day);
  k = hmac(k, REGION); k = hmac(k, 's3'); k = hmac(k, 'aws4_request');
  const sig = crypto.createHmac('sha256', k).update(toSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${env.S3_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;
  delete headers.host;
  return { url: `${base.protocol}//${base.host}${urlPath}`, headers, canonical };
}

async function s3(method, body) {
  const extra = body ? { 'content-type': 'application/octet-stream' } : {};
  const { url, headers } = signedRequest(method, body, extra);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 60000);
  try {
    return await fetch(url, { method, headers, body, signal: ctl.signal });
  } finally { clearTimeout(t); }
}

// ---- encryption: AES-256-GCM, key derived from BACKUP_KEY with HKDF ----
function cryptoKey() {
  if (!env.BACKUP_KEY || env.BACKUP_KEY.length < 16) throw new Error('BACKUP_KEY must be set to a secret of at least 16 characters');
  return Buffer.from(crypto.hkdfSync('sha256', env.BACKUP_KEY, 'fsa-backup-salt', 'fsa-backup-v1', 32));
}
function encrypt(buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cryptoKey(), iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([Buffer.from('FSA1'), iv, c.getAuthTag(), ct]);
}
function decrypt(buf) {
  if (buf.length < 32 || buf.subarray(0, 4).toString() !== 'FSA1') throw new Error('backup file is not in the expected format');
  const d = crypto.createDecipheriv('aes-256-gcm', cryptoKey(), buf.subarray(4, 16));
  d.setAuthTag(buf.subarray(16, 32));
  return Buffer.concat([d.update(buf.subarray(32)), d.final()]);
}

// ---- restore (before the database is opened) ----
async function restoreIfNeeded() {
  if (!enabled) { console.log('[backup] disabled (S3_* variables not set). Data is only as durable as the disk.'); return; }
  cryptoKey(); // fail fast if BACKUP_KEY is missing
  if (fs.existsSync(DB_FILE)) { console.log('[backup] local database present, no restore needed.'); return; }
  const r = await s3('GET');
  if (r.status === 404) { console.log('[backup] no backup in the bucket yet: starting fresh.'); return; }
  if (!r.ok) throw new Error(`[backup] restore failed (HTTP ${r.status}): ${(await r.text()).slice(0, 300)}. Refusing to start with an empty database.`);
  let bundle;
  try { bundle = JSON.parse(decrypt(Buffer.from(await r.arrayBuffer())).toString('utf8')); }
  catch (e) { throw new Error(`[backup] cannot decrypt the backup (${e.message}). Check BACKUP_KEY is the same one used when it was saved. Refusing to start.`); }
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(DB_FILE, Buffer.from(bundle.db, 'base64'), { mode: 0o600 });
  if (bundle.secrets && !fs.existsSync(SECRETS_FILE)) fs.writeFileSync(SECRETS_FILE, Buffer.from(bundle.secrets, 'base64'), { mode: 0o600 });
  console.log(`[backup] restored database from bucket (saved ${bundle.savedAt}).`);
}

// ---- backup ----
let busy = false, lastSeen = -1;
async function backupNow(db) {
  if (!enabled || busy) return;
  busy = true;
  const tmp = path.join(DATA_DIR, 'snapshot.tmp');
  try {
    await db.backup(tmp);
    const bundle = {
      savedAt: new Date().toISOString(),
      db: fs.readFileSync(tmp).toString('base64'),
      secrets: fs.existsSync(SECRETS_FILE) ? fs.readFileSync(SECRETS_FILE).toString('base64') : null
    };
    const r = await s3('PUT', encrypt(Buffer.from(JSON.stringify(bundle))));
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    console.log('[backup] saved to bucket.');
  } finally { busy = false; try { fs.unlinkSync(tmp); } catch (_) {} }
}

function startLoop(db) {
  if (!enabled) return;
  const every = Math.max(15, Number(env.BACKUP_INTERVAL_SECONDS || 60)) * 1000;
  const changes = () => db.prepare('SELECT total_changes() AS n').get().n;
  const tick = async (force) => {
    try {
      const n = changes();
      if (force || n !== lastSeen) { await backupNow(db); lastSeen = n; }
    } catch (e) { console.error('[backup] FAILED:', e.message); }
  };
  tick(true);
  setInterval(() => tick(false), every).unref();
  const flush = async () => { await tick(changes() !== lastSeen); process.exit(0); };
  process.once('SIGTERM', flush);
  process.once('SIGINT', flush);
}

module.exports = { enabled, restoreIfNeeded, backupNow, startLoop, signedRequest, encrypt, decrypt };
