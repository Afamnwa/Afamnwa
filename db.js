'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

// Secrets: use environment variables in production. Otherwise generate once and keep in a 0600 file.
function loadSecrets() {
  const file = path.join(DATA_DIR, 'secrets.json');
  let s = {};
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { /* first run */ }
  let changed = false;
  for (const k of ['JWT_SECRET', 'OTP_SECRET']) {
    if (!s[k]) { s[k] = crypto.randomBytes(48).toString('hex'); changed = true; }
  }
  if (changed) fs.writeFileSync(file, JSON.stringify(s), { mode: 0o600 });
  return {
    JWT_SECRET: process.env.JWT_SECRET || s.JWT_SECRET,
    OTP_SECRET: process.env.OTP_SECRET || s.OTP_SECRET
  };
}
const secrets = loadSecrets();

const db = new Database(path.join(DATA_DIR, 'academy.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
try { fs.chmodSync(path.join(DATA_DIR, 'academy.db'), 0o600); } catch (_) {}

const usersDDL = (name) => `CREATE TABLE IF NOT EXISTS ${name} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'learner' CHECK (role IN ('learner','admin','superadmin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  email_verified INTEGER NOT NULL DEFAULT 0,
  course_access INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  token_version INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login INTEGER
)`;

db.exec(usersDDL('users') + ';\n');

db.exec(`
CREATE TABLE IF NOT EXISTS otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify','reset')),
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otps_user ON otps(user_id, purpose);
CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  lesson_done INTEGER NOT NULL DEFAULT 0,
  best_score REAL NOT NULL DEFAULT 0,
  last_score REAL NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  passed INTEGER NOT NULL DEFAULT 0,
  passed_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, section_id)
);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  correct INTEGER NOT NULL,
  total INTEGER NOT NULL,
  score REAL NOT NULL,
  passed INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  actor_email TEXT,
  action TEXT NOT NULL,
  target_id INTEGER,
  detail TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value,
  updated_at INTEGER NOT NULL
);
`);

// Migration: databases created before the Super Admin role have a CHECK constraint that rejects it.
// SQLite cannot alter a CHECK, so rebuild the users table once (data and ids are kept).
(function migrateUsersRole() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (!row || row.sql.includes("'superadmin'")) return;
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(usersDDL('users_new'));
      db.exec('INSERT INTO users_new SELECT * FROM users');
      db.exec('DROP TABLE users');
      db.exec('ALTER TABLE users_new RENAME TO users');
    })();
    console.log('Database upgraded: Super Admin role enabled.');
  } finally { db.pragma('foreign_keys = ON'); }
})();

const getSetting = (key) => { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key); return r ? r.value : null; };
const setSetting = (key, value) => db.prepare('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').run(key, value, Date.now());
const delSetting = (key) => db.prepare('DELETE FROM settings WHERE key=?').run(key);

// Every audited event also pings `hooks.onChange` (used to schedule the GitHub backup).
const hooks = { onChange: null };
function audit(req, actor, action, targetId, detail) {
  db.prepare('INSERT INTO audit (actor_id, actor_email, action, target_id, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(actor ? actor.id : null, actor ? actor.email : null, action, targetId || null,
      detail ? String(detail).slice(0, 500) : null, req && req.ip ? req.ip : null, Date.now());
  if (hooks.onChange) { try { hooks.onChange(); } catch (_) { /* backup must never break a request */ } }
}

// Seed the first account (a Super Admin). Set ADMIN_EMAIL / ADMIN_PASSWORD, otherwise a random password is printed once.
function seedAdmin() {
  const exists = db.prepare("SELECT id FROM users WHERE role IN ('admin','superadmin') LIMIT 1").get();
  if (exists) return;
  const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password) { password = crypto.randomBytes(9).toString('base64url') + 'aA1'; generated = true; }
  const hash = bcrypt.hashSync(password, 12);
  db.prepare(`INSERT INTO users (email,name,password_hash,role,email_verified,must_change_password,created_at)
              VALUES (?,?,?,?,1,?,?)`).run(email, 'Super Administrator', hash, 'superadmin', generated ? 1 : 0, Date.now());
  console.log('\n=== FIRST RUN: Super Admin account created ===');
  console.log('  Email   :', email);
  if (generated) console.log('  Password:', password, '(shown once. You will be asked to change it at first login)');
  console.log('========================================\n');
}
seedAdmin();

// Make sure at least one Super Admin exists (needed to upload the certificate signature).
// SUPERADMIN_EMAIL promotes that account; otherwise, if there is none, the oldest admin is promoted.
function ensureSuperAdmin() {
  const wanted = (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
  let target = null;
  if (wanted) target = db.prepare("SELECT * FROM users WHERE email=? AND status='active'").get(wanted);
  if (!target && !db.prepare("SELECT id FROM users WHERE role='superadmin' LIMIT 1").get()) {
    target = db.prepare("SELECT * FROM users WHERE role='admin' AND status='active' ORDER BY id LIMIT 1").get();
  }
  if (!target || target.role === 'superadmin') return;
  db.prepare("UPDATE users SET role='superadmin', token_version=token_version+1 WHERE id=?").run(target.id);
  audit(null, null, 'system_promote_superadmin', target.id, target.email);
  console.log(`Account ${target.email} is now a Super Admin.`);
}
ensureSuperAdmin();

module.exports = { db, secrets, audit, hooks, getSetting, setSetting, delSetting, seedAdmin, ensureSuperAdmin, DATA_DIR };
