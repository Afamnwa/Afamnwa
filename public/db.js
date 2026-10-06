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

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'learner' CHECK (role IN ('learner','admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  email_verified INTEGER NOT NULL DEFAULT 0,
  course_access INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  token_version INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login INTEGER
);
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
`);

function audit(req, actor, action, targetId, detail) {
  db.prepare('INSERT INTO audit (actor_id, actor_email, action, target_id, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(actor ? actor.id : null, actor ? actor.email : null, action, targetId || null,
      detail ? String(detail).slice(0, 500) : null, req && req.ip ? req.ip : null, Date.now());
}

// Seed the first admin account. Set ADMIN_EMAIL / ADMIN_PASSWORD, otherwise a random password is printed once.
function seedAdmin() {
  const exists = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
  if (exists) return;
  const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password) { password = crypto.randomBytes(9).toString('base64url') + 'aA1'; generated = true; }
  const hash = bcrypt.hashSync(password, 12);
  db.prepare(`INSERT INTO users (email,name,password_hash,role,email_verified,must_change_password,created_at)
              VALUES (?,?,?,?,1,?,?)`).run(email, 'Administrator', hash, 'admin', generated ? 1 : 0, Date.now());
  console.log('\n=== FIRST RUN: admin account created ===');
  console.log('  Email   :', email);
  if (generated) console.log('  Password:', password, '(shown once. You will be asked to change it at first login)');
  console.log('========================================\n');
}
seedAdmin();

module.exports = { db, secrets, audit };
