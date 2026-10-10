'use strict';
try { require('dotenv').config(); } catch (_) {}
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { db, secrets, audit, getSetting, setSetting, delSetting } = require('./db');
const backup = require('./backup');
const PDFDocument = require('pdfkit');
const { sendOtp, sendTest, configured: smtpConfigured, provider: mailProvider, FROM: MAIL_FROM_ADDR } = require('./mail');
const { PASS_MARK, sections } = require('./content');
const { renderCertificate, certificateNumber } = require('./cert');
const ORG_NAME = process.env.ORG_NAME || 'City of Refuge';
const SIGNATORY = process.env.SIGNATORY_NAME || '';

const PROD = process.env.NODE_ENV === 'production';
// Administrators and Super Admins must enter an emailed code after their password. ADMIN_2FA=off is an emergency switch.
const ADMIN_2FA = String(process.env.ADMIN_2FA || 'on').toLowerCase() !== 'off';
const PORT = Number(process.env.PORT || 3000);
const COOKIE = 'fsa_session';
const SESSION_HOURS = 8;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_MS = 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12); // keeps login timing constant for unknown emails

const app = express();
app.disable('x-powered-by');
// Behind Render's proxy the real visitor IP is in X-Forwarded-For. Render sets RENDER=true, so trust it automatically there.
const TRUST = process.env.TRUST_PROXY || (process.env.RENDER ? '1' : '');
if (TRUST) app.set('trust proxy', Number(TRUST) || 1);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https://i.ytimg.com'],
      frameSrc: ['https://www.youtube-nocookie.com'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(PROD ? { upgradeInsecureRequests: [] } : {})
    }
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: PROD ? { maxAge: 31536000, includeSubDomains: true } : false,
  crossOriginEmbedderPolicy: false
}));
// Image uploads (base64 in JSON) need a bigger body limit than the rest of the API.
app.use('/api/admin/assets', express.json({ limit: '700kb' }));
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());

// ---------- CSRF defence: SameSite=Strict cookie + custom header + Origin check on state-changing calls ----------
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'fsa') return res.status(403).json({ error: 'Request blocked.' });
  const origin = req.get('origin');
  if (origin) {
    try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Request blocked.' }); }
    catch (_) { return res.status(403).json({ error: 'Request blocked.' }); }
  }
  next();
});
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const mkLimiter = (windowMin, max, msg) => rateLimit({
  windowMs: windowMin * 60 * 1000, max, standardHeaders: true, legacyHeaders: false,
  message: { error: msg || 'Too many requests. Please try again later.' }
});
app.use('/api', mkLimiter(15, 600));
const authLimiter = mkLimiter(15, 30);
const otpLimiter = mkLimiter(15, 15);
const quizLimiter = mkLimiter(60, 60);

// ---------- helpers ----------
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const now = () => Date.now();
const normEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => typeof e === 'string' && e.length <= 254 && /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/.test(e);
const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 100);
function passwordProblem(p) {
  if (typeof p !== 'string') return 'Password is required.';
  if (p.length < 10) return 'Password must be at least 10 characters.';
  if (Buffer.byteLength(p) > 72) return 'Password is too long (72 bytes max).';
  if (!/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/[0-9]/.test(p)) return 'Password needs upper-case, lower-case letters and a number.';
  return null;
}
const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, role: u.role, status: u.status,
  email_verified: !!u.email_verified, course_access: !!u.course_access,
  must_change_password: !!u.must_change_password, created_at: u.created_at, last_login: u.last_login
});
const getUserByEmail = (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(email);
const getUserById = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

function setSession(res, user) {
  const token = jwt.sign({ sub: user.id, tv: user.token_version }, secrets.JWT_SECRET, { algorithm: 'HS256', expiresIn: `${SESSION_HOURS}h` });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: PROD, maxAge: SESSION_HOURS * 3600 * 1000, path: '/' });
}

// ---------- OTP ----------
const hashOtp = (userId, purpose, code) => crypto.createHmac('sha256', secrets.OTP_SECRET).update(`${userId}:${purpose}:${code}`).digest('hex');
async function issueOtp(user, purpose) {
  const last = db.prepare('SELECT created_at, used, expires_at FROM otps WHERE user_id=? AND purpose=? ORDER BY id DESC LIMIT 1').get(user.id, purpose);
  // Cooldown only while an earlier code is still valid; a used or expired code never blocks a fresh one.
  if (last && !last.used && last.expires_at > now() && now() - last.created_at < OTP_RESEND_MS) return false;
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  db.prepare('UPDATE otps SET used=1 WHERE user_id=? AND purpose=? AND used=0').run(user.id, purpose);
  db.prepare('INSERT INTO otps (user_id,purpose,code_hash,expires_at,created_at) VALUES (?,?,?,?,?)')
    .run(user.id, purpose, hashOtp(user.id, purpose, code), now() + OTP_TTL_MS, now());
  try { await sendOtp(user.email, user.name, code, purpose); } catch (e) { console.error('Mail send failed:', e.message); }
  return true;
}
function checkOtp(user, purpose, code) {
  if (!/^\d{6}$/.test(String(code || ''))) return false;
  const row = db.prepare('SELECT * FROM otps WHERE user_id=? AND purpose=? AND used=0 ORDER BY id DESC LIMIT 1').get(user.id, purpose);
  if (!row || row.expires_at < now() || row.attempts >= OTP_MAX_ATTEMPTS) return false;
  db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE id=?').run(row.id);
  const a = Buffer.from(row.code_hash, 'hex');
  const b = Buffer.from(hashOtp(user.id, purpose, String(code)), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  db.prepare('UPDATE otps SET used=1 WHERE id=?').run(row.id);
  return true;
}

// ---------- auth middleware ----------
function auth(req, res, next) {
  const token = req.cookies[COOKIE];
  if (!token) return res.status(401).json({ error: 'Please sign in.' });
  try {
    const p = jwt.verify(token, secrets.JWT_SECRET, { algorithms: ['HS256'] });
    const user = getUserById(p.sub);
    if (!user || user.token_version !== p.tv || user.status !== 'active' || !user.email_verified) {
      res.clearCookie(COOKIE); return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }
    req.user = user; next();
  } catch (_) { res.clearCookie(COOKIE); res.status(401).json({ error: 'Session expired. Please sign in again.' }); }
}
const isAdminRole = (r) => r === 'admin' || r === 'superadmin';
const adminOnly = (req, res, next) => (isAdminRole(req.user.role) ? next() : res.status(403).json({ error: 'Admin access required.' }));
const superOnly = (req, res, next) => (req.user.role === 'superadmin' ? next() : res.status(403).json({ error: 'Only a Super Admin can do this.' }));
const courseAccess = (req, res, next) => (req.user.course_access || isAdminRole(req.user.role) ? next() : res.status(403).json({ error: 'Your course access has not been granted yet. Please contact an administrator.', code: 'NO_ACCESS' }));

// ======================= AUTH ROUTES =======================
const GENERIC_CODE_ERR = 'That code is invalid or has expired.';

app.post('/api/auth/register', authLimiter, wrap(async (req, res) => {
  const name = cleanName(req.body.name), email = normEmail(req.body.email), password = req.body.password;
  if (!name) return res.status(400).json({ error: 'Please enter your name.' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  const pw = passwordProblem(password);
  if (pw) return res.status(400).json({ error: pw });
  const existing = getUserByEmail(email);
  const hash = await bcrypt.hash(password, 12);
  let user;
  if (!existing) {
    const r = db.prepare('INSERT INTO users (email,name,password_hash,created_at) VALUES (?,?,?,?)').run(email, name, hash, now());
    user = getUserById(r.lastInsertRowid);
    audit(req, null, 'register', user.id, email);
  } else if (!existing.email_verified) {
    // Unverified: the latest registrant wins, but only the inbox owner can finish verification.
    db.prepare('UPDATE users SET name=?, password_hash=? WHERE id=?').run(name, hash, existing.id);
    user = getUserById(existing.id);
  }
  if (user) await issueOtp(user, 'verify');
  // Same answer whether or not the email already existed (prevents account enumeration)
  res.json({ ok: true, message: 'If this email can be registered, a 6-digit confirmation code has been sent.' });
}));

app.post('/api/auth/verify', otpLimiter, wrap(async (req, res) => {
  const email = normEmail(req.body.email);
  const user = validEmail(email) ? getUserByEmail(email) : null;
  if (!user || user.email_verified || user.status !== 'active' || !checkOtp(user, 'verify', req.body.otp)) {
    return res.status(400).json({ error: GENERIC_CODE_ERR });
  }
  db.prepare('UPDATE users SET email_verified=1, last_login=? WHERE id=?').run(now(), user.id);
  audit(req, user, 'email_verified', user.id);
  setSession(res, user);
  res.json({ ok: true, user: publicUser(getUserById(user.id)) });
}));

app.post('/api/auth/resend', otpLimiter, wrap(async (req, res) => {
  const email = normEmail(req.body.email);
  const purpose = req.body.purpose === 'reset' ? 'reset' : 'verify';
  const user = validEmail(email) ? getUserByEmail(email) : null;
  if (user && user.status === 'active' && ((purpose === 'verify' && !user.email_verified) || (purpose === 'reset' && user.email_verified))) {
    await issueOtp(user, purpose);
  }
  res.json({ ok: true, message: 'If the account exists, a new code has been sent. Codes can be requested once a minute.' });
}));

app.post('/api/auth/login', authLimiter, wrap(async (req, res) => {
  const email = normEmail(req.body.email), password = String(req.body.password || '');
  const user = validEmail(email) ? getUserByEmail(email) : null;
  const GENERIC = { error: 'Incorrect email or password.' };
  if (!user) { await bcrypt.compare(password, DUMMY_HASH); return res.status(401).json(GENERIC); }
  if (user.locked_until > now()) return res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes or reset your password.' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    const fails = user.failed_logins + 1;
    if (fails >= MAX_FAILED_LOGINS) {
      db.prepare('UPDATE users SET failed_logins=0, locked_until=? WHERE id=?').run(now() + LOCK_MS, user.id);
      audit(req, user, 'account_locked', user.id);
    } else db.prepare('UPDATE users SET failed_logins=? WHERE id=?').run(fails, user.id);
    return res.status(401).json(GENERIC);
  }
  if (user.status !== 'active') return res.status(403).json({ error: 'This account has been suspended. Contact an administrator.' });
  if (!user.email_verified) {
    await issueOtp(user, 'verify');
    return res.status(403).json({ error: 'Please confirm your email first. We sent you a new code.', needsVerification: true });
  }
  if (ADMIN_2FA && isAdminRole(user.role)) { // step 2 of 2: emailed code (see /api/auth/login-verify)
    await issueOtp(user, 'login');
    return res.json({ ok: true, needs2fa: true, message: 'We emailed a 6-digit sign-in code to your address.' });
  }
  db.prepare('UPDATE users SET failed_logins=0, locked_until=0, last_login=? WHERE id=?').run(now(), user.id);
  audit(req, user, 'login', user.id);
  setSession(res, user);
  res.json({ ok: true, user: publicUser(getUserById(user.id)) });
}));

app.post('/api/auth/login-verify', otpLimiter, wrap(async (req, res) => {
  const email = normEmail(req.body.email);
  const user = validEmail(email) ? getUserByEmail(email) : null;
  if (!user || !ADMIN_2FA || !isAdminRole(user.role) || user.status !== 'active' || !user.email_verified || user.locked_until > now()
      || !checkOtp(user, 'login', req.body.otp)) return res.status(400).json({ error: GENERIC_CODE_ERR });
  db.prepare('UPDATE users SET failed_logins=0, locked_until=0, last_login=? WHERE id=?').run(now(), user.id);
  audit(req, user, 'login', user.id, 'with email code');
  setSession(res, user);
  res.json({ ok: true, user: publicUser(getUserById(user.id)) });
}));

app.post('/api/auth/forgot', authLimiter, wrap(async (req, res) => {
  const email = normEmail(req.body.email);
  const user = validEmail(email) ? getUserByEmail(email) : null;
  if (user && user.email_verified && user.status === 'active') await issueOtp(user, 'reset');
  res.json({ ok: true, message: 'If an account exists for that email, a 6-digit reset code has been sent.' });
}));

app.post('/api/auth/reset', otpLimiter, wrap(async (req, res) => {
  const email = normEmail(req.body.email);
  const pw = passwordProblem(req.body.password);
  if (pw) return res.status(400).json({ error: pw });
  const user = validEmail(email) ? getUserByEmail(email) : null;
  if (!user || user.status !== 'active' || !checkOtp(user, 'reset', req.body.otp)) return res.status(400).json({ error: GENERIC_CODE_ERR });
  const hash = await bcrypt.hash(req.body.password, 12);
  db.prepare('UPDATE users SET password_hash=?, token_version=token_version+1, failed_logins=0, locked_until=0, must_change_password=0 WHERE id=?').run(hash, user.id);
  audit(req, user, 'password_reset', user.id);
  res.json({ ok: true, message: 'Password updated. You can now sign in.' });
}));

app.post('/api/auth/logout', (req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true }); });
app.get('/api/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user), passMark: PASS_MARK }));

app.post('/api/auth/change-password', authLimiter, auth, wrap(async (req, res) => {
  const pw = passwordProblem(req.body.newPassword);
  if (pw) return res.status(400).json({ error: pw });
  if (!(await bcrypt.compare(String(req.body.currentPassword || ''), req.user.password_hash))) return res.status(400).json({ error: 'Current password is incorrect.' });
  const hash = await bcrypt.hash(req.body.newPassword, 12);
  db.prepare('UPDATE users SET password_hash=?, token_version=token_version+1, must_change_password=0 WHERE id=?').run(hash, req.user.id);
  audit(req, req.user, 'password_changed', req.user.id);
  setSession(res, getUserById(req.user.id));
  res.json({ ok: true });
}));

// ======================= COURSE ROUTES =======================
function progressMap(userId) {
  const map = {};
  for (const r of db.prepare('SELECT * FROM progress WHERE user_id=?').all(userId)) map[r.section_id] = r;
  return map;
}
function statusOf(i, map) {
  const p = map[sections[i].id];
  if (p && p.passed) return 'passed';
  if (i > 0 && !(map[sections[i - 1].id] && map[sections[i - 1].id].passed)) return 'locked';
  return p && p.lesson_done ? 'in_progress' : 'available';
}
function overview(userId) {
  const map = progressMap(userId);
  const list = sections.map((s, i) => {
    const p = map[s.id];
    return { id: s.id, title: s.title, summary: s.summary, status: statusOf(i, map), questions: s.quiz.length,
      lessonDone: !!(p && p.lesson_done), bestScore: p ? p.best_score : 0, lastScore: p ? p.last_score : 0, attempts: p ? p.attempts : 0 };
  });
  const passed = list.filter((s) => s.status === 'passed').length;
  return { passMark: PASS_MARK, sections: list, passed, total: list.length, percent: Math.round((passed / list.length) * 100), completed: passed === list.length };
}

app.get('/api/course', auth, courseAccess, (req, res) => res.json(overview(req.user.id)));

app.get('/api/course/:id', auth, courseAccess, (req, res) => {
  const i = sections.findIndex((s) => s.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Section not found.' });
  const map = progressMap(req.user.id);
  const status = statusOf(i, map);
  if (status === 'locked') return res.status(403).json({ error: 'Pass the previous section quiz to unlock this section.' });
  const s = sections[i], p = map[s.id];
  res.json({
    id: s.id, index: i, title: s.title, summary: s.summary, videos: s.videos, body: s.body, status,
    next: sections[i + 1] ? sections[i + 1].id : null, passMark: PASS_MARK,
    progress: { lessonDone: !!(p && p.lesson_done), bestScore: p ? p.best_score : 0, lastScore: p ? p.last_score : 0, attempts: p ? p.attempts : 0, passed: !!(p && p.passed) },
    quiz: s.quiz.map((q) => ({ q: q.q, options: q.options })) // answers are never sent here
  });
});

function ensureProgress(userId, sectionId) {
  db.prepare('INSERT OR IGNORE INTO progress (user_id, section_id, updated_at) VALUES (?,?,?)').run(userId, sectionId, now());
}

app.post('/api/course/:id/lesson-complete', auth, courseAccess, (req, res) => {
  const i = sections.findIndex((s) => s.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Section not found.' });
  if (statusOf(i, progressMap(req.user.id)) === 'locked') return res.status(403).json({ error: 'Section is locked.' });
  ensureProgress(req.user.id, sections[i].id);
  db.prepare('UPDATE progress SET lesson_done=1, updated_at=? WHERE user_id=? AND section_id=?').run(now(), req.user.id, sections[i].id);
  audit(req, req.user, 'lesson_complete', req.user.id, sections[i].id);
  res.json({ ok: true });
});

app.post('/api/course/:id/quiz', quizLimiter, auth, courseAccess, (req, res) => {
  const i = sections.findIndex((s) => s.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Section not found.' });
  const map = progressMap(req.user.id);
  if (statusOf(i, map) === 'locked') return res.status(403).json({ error: 'Section is locked.' });
  const s = sections[i];
  const answers = req.body.answers;
  if (!Array.isArray(answers) || answers.length !== s.quiz.length) return res.status(400).json({ error: 'Please answer every question.' });
  for (let k = 0; k < answers.length; k++) {
    if (!Number.isInteger(answers[k]) || answers[k] < 0 || answers[k] >= s.quiz[k].options.length) return res.status(400).json({ error: 'Please answer every question.' });
  }
  if (!(map[s.id] && map[s.id].lesson_done)) return res.status(400).json({ error: 'Read the lesson before taking the quiz.' });

  let correct = 0;
  const results = s.quiz.map((q, k) => {
    const ok = answers[k] === q.answer;
    if (ok) correct++;
    return { yourAnswer: answers[k], correctAnswer: q.answer, isCorrect: ok, explain: q.explain };
  });
  const total = s.quiz.length;
  const score = Math.round((correct / total) * 1000) / 10;
  const passed = score >= PASS_MARK;
  const prev = map[s.id];
  const nowPassed = passed || (prev && prev.passed);
  db.transaction(() => {
    db.prepare(`UPDATE progress SET attempts=attempts+1, last_score=?, best_score=MAX(best_score, ?), passed=?,
                passed_at=CASE WHEN passed_at IS NULL AND ?=1 THEN ? ELSE passed_at END, updated_at=? WHERE user_id=? AND section_id=?`)
      .run(score, score, nowPassed ? 1 : 0, nowPassed ? 1 : 0, now(), now(), req.user.id, s.id);
    db.prepare('INSERT INTO attempts (user_id,section_id,correct,total,score,passed,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(req.user.id, s.id, correct, total, score, passed ? 1 : 0, now());
  })();
  audit(req, req.user, 'quiz_attempt', req.user.id, `${s.id}: ${correct}/${total} = ${score}% ${passed ? 'passed' : 'not passed'}`);
  res.json({ score, correct, total, passed, passMark: PASS_MARK, results, overview: overview(req.user.id),
    next: passed && sections[i + 1] ? sections[i + 1].id : null });
});

const asBuf = (v) => (v instanceof Uint8Array && v.length ? Buffer.from(v) : null); // BLOBs may come back as Buffer or Uint8Array
function certificateData(user) {
  const ov = overview(user.id);
  if (!ov.completed) return null;
  const rows = db.prepare('SELECT passed_at FROM progress WHERE user_id=?').all(user.id);
  const date = Math.max(...rows.map((r) => r.passed_at || 0)) || Date.now();
  return { name: user.name, completedAt: date, org: ORG_NAME, number: certificateNumber(user.id, date),
    signatory: getSetting('signatory_name') || SIGNATORY, signatoryTitle: getSetting('signatory_title') || '',
    signature: asBuf(getSetting('signature_image')), logo: asBuf(getSetting('logo_image')) };
}

app.get('/api/certificate', auth, courseAccess, (req, res) => {
  const c = certificateData(req.user);
  if (!c) return res.status(403).json({ error: 'Pass every section to receive your certificate.' });
  res.json({ name: c.name, date: c.completedAt, number: c.number, org: c.org });
});

app.get('/api/certificate/pdf', auth, courseAccess, (req, res) => {
  const c = certificateData(req.user);
  if (!c) return res.status(403).json({ error: 'Pass every section to receive your certificate.' });
  audit(req, req.user, 'certificate_downloaded', req.user.id, c.number);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="Fire-Safety-Certificate-' + c.number + '.pdf"');
  renderCertificate(c).pipe(res);
});

// ======================= ADMIN ROUTES =======================
const admin = express.Router();
app.use('/api/admin', mkLimiter(15, 400), auth, adminOnly, admin);

const userRow = (u) => {
  const passed = db.prepare('SELECT COUNT(*) c FROM progress WHERE user_id=? AND passed=1').get(u.id).c;
  return { ...publicUser(u), locked: u.locked_until > now(), passedSections: passed, totalSections: sections.length, percent: Math.round((passed / sections.length) * 100) };
};
const activeAdminCount = () => db.prepare("SELECT COUNT(*) c FROM users WHERE role IN ('admin','superadmin') AND status='active'").get().c;
const activeSuperCount = () => db.prepare("SELECT COUNT(*) c FROM users WHERE role='superadmin' AND status='active'").get().c;
// A normal Admin may not change, reset, sign out or delete a Super Admin account.
admin.param('id', (req, res, next, id) => {
  if (req.method === 'GET') return next();
  const t = getUserById(Number(id));
  if (t && t.role === 'superadmin' && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Only a Super Admin can change a Super Admin account.' });
  next();
});
const toBool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

admin.get('/stats', (req, res) => {
  const users = db.prepare('SELECT id, role, status, email_verified FROM users').all();
  const done = db.prepare('SELECT user_id, COUNT(*) c FROM progress WHERE passed=1 GROUP BY user_id').all();
  const completed = done.filter((d) => d.c === sections.length).length;
  const learners = users.filter((u) => u.role === 'learner');
  res.json({ users: users.length, learners: learners.length, admins: users.length - learners.length,
    unverified: users.filter((u) => !u.email_verified).length, suspended: users.filter((u) => u.status === 'suspended').length,
    completed, inProgress: done.filter((d) => d.c < sections.length).length, attempts: db.prepare('SELECT COUNT(*) c FROM attempts').get().c });
});

admin.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const rows = q
    ? db.prepare("SELECT * FROM users WHERE name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 300")
        .all(...Array(2).fill(`%${q.replace(/[\\%_]/g, '\\$&')}%`))
    : db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT 300').all();
  res.json({ users: rows.map(userRow) });
});

admin.get('/users/:id', (req, res) => {
  const u = getUserById(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const map = progressMap(u.id);
  res.json({
    user: userRow(u), passMark: PASS_MARK,
    sections: sections.map((s, i) => ({ id: s.id, title: s.title, status: statusOf(i, map), lessonDone: !!(map[s.id] && map[s.id].lesson_done),
      bestScore: map[s.id] ? map[s.id].best_score : 0, lastScore: map[s.id] ? map[s.id].last_score : 0, attempts: map[s.id] ? map[s.id].attempts : 0, passed: !!(map[s.id] && map[s.id].passed) })),
    attempts: db.prepare('SELECT section_id, correct, total, score, passed, created_at FROM attempts WHERE user_id=? ORDER BY id DESC LIMIT 30').all(u.id)
  });
});

admin.post('/users', wrap(async (req, res) => {
  const name = cleanName(req.body.name), email = normEmail(req.body.email);
  if (!name || !validEmail(email)) return res.status(400).json({ error: 'A valid name and email are required.' });
  const pw = passwordProblem(req.body.password);
  if (pw) return res.status(400).json({ error: pw });
  if (getUserByEmail(email)) return res.status(409).json({ error: 'That email is already registered.' });
  const role = ['admin', 'superadmin'].includes(req.body.role) ? req.body.role : 'learner';
  if (role === 'superadmin' && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Only a Super Admin can create a Super Admin.' });
  const hash = await bcrypt.hash(req.body.password, 12);
  const r = db.prepare('INSERT INTO users (email,name,password_hash,role,email_verified,course_access,must_change_password,created_at) VALUES (?,?,?,?,?,?,1,?)')
    .run(email, name, hash, role, req.body.email_verified === false ? 0 : 1, req.body.course_access === false ? 0 : 1, now());
  audit(req, req.user, 'admin_create_user', r.lastInsertRowid, `${email} (${role})`);
  res.json({ ok: true, user: userRow(getUserById(r.lastInsertRowid)) });
}));

admin.patch('/users/:id', (req, res) => {
  const u = getUserById(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const b = req.body, next = { ...u };
  if (b.name !== undefined) { next.name = cleanName(b.name); if (!next.name) return res.status(400).json({ error: 'Name cannot be empty.' }); }
  if (b.email !== undefined) {
    const e = normEmail(b.email);
    if (!validEmail(e)) return res.status(400).json({ error: 'Invalid email address.' });
    const other = getUserByEmail(e);
    if (other && other.id !== u.id) return res.status(409).json({ error: 'That email is already registered.' });
    next.email = e;
  }
  if (b.role !== undefined) {
    if (!['learner', 'admin', 'superadmin'].includes(b.role)) return res.status(400).json({ error: 'Invalid role.' });
    if (b.role === 'superadmin' && u.role !== 'superadmin' && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Only a Super Admin can make someone a Super Admin.' });
    next.role = b.role;
  }
  if (b.status !== undefined) { if (!['active', 'suspended'].includes(b.status)) return res.status(400).json({ error: 'Invalid status.' }); next.status = b.status; }
  if (b.course_access !== undefined) next.course_access = toBool(b.course_access);
  if (b.email_verified !== undefined) next.email_verified = toBool(b.email_verified);
  const losesAdmin = isAdminRole(u.role) && u.status === 'active' && (!isAdminRole(next.role) || next.status !== 'active');
  if (losesAdmin && activeAdminCount() <= 1) return res.status(400).json({ error: 'You cannot remove or suspend the last active administrator.' });
  const losesSuper = u.role === 'superadmin' && u.status === 'active' && (next.role !== 'superadmin' || next.status !== 'active');
  if (losesSuper && activeSuperCount() <= 1) return res.status(400).json({ error: 'You cannot remove or suspend the last active Super Admin.' });
  const securityChange = next.role !== u.role || next.status !== u.status || next.email !== u.email;
  db.prepare('UPDATE users SET name=?,email=?,role=?,status=?,course_access=?,email_verified=?,token_version=token_version+? WHERE id=?')
    .run(next.name, next.email, next.role, next.status, next.course_access, next.email_verified, securityChange ? 1 : 0, u.id);
  audit(req, req.user, 'admin_edit_user', u.id, JSON.stringify(Object.keys(b)));
  res.json({ ok: true, user: userRow(getUserById(u.id)) });
});

admin.post('/users/:id/password', wrap(async (req, res) => {
  const u = getUserById(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const pw = passwordProblem(req.body.password);
  if (pw) return res.status(400).json({ error: pw });
  const hash = await bcrypt.hash(req.body.password, 12);
  db.prepare('UPDATE users SET password_hash=?, token_version=token_version+1, failed_logins=0, locked_until=0, must_change_password=? WHERE id=?')
    .run(hash, toBool(req.body.must_change !== false), u.id);
  audit(req, req.user, 'admin_set_password', u.id);
  if (u.id === req.user.id) setSession(res, getUserById(u.id));
  res.json({ ok: true });
}));

admin.post('/users/:id/unlock', (req, res) => {
  const u = getUserById(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found.' });
  db.prepare('UPDATE users SET failed_logins=0, locked_until=0 WHERE id=?').run(u.id);
  audit(req, req.user, 'admin_unlock', u.id);
  res.json({ ok: true });
});

admin.post('/users/:id/sign-out', (req, res) => {
  const u = getUserById(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found.' });
  db.prepare('UPDATE users SET token_version=token_version+1 WHERE id=?').run(u.id);
  audit(req, req.user, 'admin_force_signout', u.id);
  if (u.id === req.user.id) setSession(res, getUserById(u.id));
  res.json({ ok: true });
});

admin.put('/users/:id/progress/:sid', (req, res) => {
  const u = getUserById(Number(req.params.id));
  const s = sections.find((x) => x.id === req.params.sid);
  if (!u || !s) return res.status(404).json({ error: 'Not found.' });
  const score = Number(req.body.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) return res.status(400).json({ error: 'Score must be between 0 and 100.' });
  const rounded = Math.round(score * 10) / 10;
  const passed = req.body.passed === undefined ? (rounded >= PASS_MARK ? 1 : 0) : toBool(req.body.passed);
  ensureProgress(u.id, s.id);
  db.prepare('UPDATE progress SET best_score=?, last_score=?, passed=?, lesson_done=1, passed_at=CASE WHEN ?=1 THEN COALESCE(passed_at, ?) ELSE NULL END, updated_at=? WHERE user_id=? AND section_id=?')
    .run(rounded, rounded, passed, passed, now(), now(), u.id, s.id);
  audit(req, req.user, 'admin_set_score', u.id, `${s.id}=${rounded} passed=${passed}`);
  res.json({ ok: true });
});

admin.delete('/users/:id/progress/:sid', (req, res) => {
  const u = getUserById(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found.' });
  db.prepare('DELETE FROM progress WHERE user_id=? AND section_id=?').run(u.id, req.params.sid);
  audit(req, req.user, 'admin_reset_section', u.id, req.params.sid);
  res.json({ ok: true });
});
admin.delete('/users/:id/progress', (req, res) => {
  const u = getUserById(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found.' });
  db.prepare('DELETE FROM progress WHERE user_id=?').run(u.id);
  db.prepare('DELETE FROM attempts WHERE user_id=?').run(u.id);
  audit(req, req.user, 'admin_reset_all_progress', u.id);
  res.json({ ok: true });
});

admin.delete('/users/:id', (req, res) => {
  const u = getUserById(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found.' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
  db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  audit(req, req.user, 'admin_delete_user', u.id, u.email);
  res.json({ ok: true });
});

// ---------- Super Admin only: certificate signature / logo ----------
const ASSETS = { signature: 'signature_image', logo: 'logo_image' };
const MAX_IMAGE_BYTES = 400 * 1024;
function imageMime(b) {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}
const assetInfo = (kind) => { const b = asBuf(getSetting(ASSETS[kind])); const row = db.prepare('SELECT updated_at FROM settings WHERE key=?').get(ASSETS[kind]); return { has: !!b, bytes: b ? b.length : 0, updatedAt: row ? row.updated_at : null }; };

admin.get('/certificate-settings', superOnly, (req, res) => {
  res.json({ signature: assetInfo('signature'), logo: assetInfo('logo'),
    signatoryName: getSetting('signatory_name') || SIGNATORY, signatoryTitle: getSetting('signatory_title') || '', maxKb: MAX_IMAGE_BYTES / 1024 });
});
admin.put('/certificate-settings', superOnly, (req, res) => {
  const name = cleanName(req.body.signatoryName).slice(0, 60), title = cleanName(req.body.signatoryTitle).slice(0, 60);
  if (name) setSetting('signatory_name', name); else delSetting('signatory_name');
  if (title) setSetting('signatory_title', title); else delSetting('signatory_title');
  audit(req, req.user, 'cert_signatory_changed', null, `${name || '(none)'} / ${title || '(default title)'}`);
  res.json({ ok: true });
});
admin.get('/assets/:kind', superOnly, (req, res) => {
  if (!ASSETS[req.params.kind]) return res.status(404).json({ error: 'Not found.' });
  const b = asBuf(getSetting(ASSETS[req.params.kind]));
  if (!b) return res.status(404).json({ error: 'Nothing uploaded yet.' });
  res.set('Content-Type', imageMime(b) || 'application/octet-stream').send(b);
});
admin.post('/assets/:kind', superOnly, (req, res) => {
  const kind = req.params.kind;
  if (!ASSETS[kind]) return res.status(404).json({ error: 'Not found.' });
  const raw = String(req.body.data || '').replace(/^data:[^,]*,/, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(raw) || !raw) return res.status(400).json({ error: 'Please choose an image file.' });
  const buf = Buffer.from(raw, 'base64');
  if (buf.length > MAX_IMAGE_BYTES) return res.status(413).json({ error: `Image is too large. Maximum is ${MAX_IMAGE_BYTES / 1024} KB.` });
  if (!imageMime(buf)) return res.status(400).json({ error: 'Only PNG or JPG images are accepted.' });
  try { new PDFDocument().openImage(buf); } catch (_) { return res.status(400).json({ error: 'That image could not be read. Save it again as a standard (non-interlaced) PNG or a JPG.' }); }
  setSetting(ASSETS[kind], buf);
  audit(req, req.user, 'cert_' + kind + '_uploaded', null, `${imageMime(buf)} ${buf.length} bytes`);
  res.json({ ok: true, ...assetInfo(kind) });
});
admin.delete('/assets/:kind', superOnly, (req, res) => {
  if (!ASSETS[req.params.kind]) return res.status(404).json({ error: 'Not found.' });
  delSetting(ASSETS[req.params.kind]);
  audit(req, req.user, 'cert_' + req.params.kind + '_removed');
  res.json({ ok: true });
});

// ---------- Super Admin only: email check ----------
admin.get('/email-status', superOnly, (req, res) => res.json({ provider: mailProvider, from: MAIL_FROM_ADDR, twoFactor: ADMIN_2FA }));
admin.post('/email-test', superOnly, wrap(async (req, res) => {
  try { await sendTest(req.user.email); audit(req, req.user, 'email_test', req.user.id, 'sent'); res.json({ ok: true, to: req.user.email, provider: mailProvider }); }
  catch (e) { audit(req, req.user, 'email_test', req.user.id, 'failed: ' + e.message); res.status(502).json({ error: e.message }); }
}));

// ---------- Super Admin only: backup ----------
admin.get('/backup/status', superOnly, (req, res) => {
  res.json({ ...backup.status, configured: backup.githubConfigured(), counts: backup.counts(), delaySeconds: backup.cfg().delayMs / 1000 });
});
admin.post('/backup/run', superOnly, wrap(async (req, res) => {
  audit(req, req.user, 'backup_manual', null);
  try { const r = await backup.runNow(true); res.json({ ok: true, ...r }); }
  catch (e) { res.status(502).json({ error: e.message }); }
}));
admin.get('/backup/download', superOnly, (req, res) => {
  audit(req, req.user, 'backup_downloaded');
  res.set({ 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="fire-safety-academy-backup-${new Date().toISOString().slice(0, 10)}.json"` });
  res.send(backup.currentText());
});
admin.post('/backup/restore', superOnly, wrap(async (req, res) => {
  if (req.body.confirm !== 'RESTORE') return res.status(400).json({ error: 'Type RESTORE to confirm.' });
  try {
    const c = await backup.restoreFromGithub();
    audit(null, null, 'backup_restored', null, `by ${req.user.email}: ${c.users} users`);
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true, counts: c });
  } catch (e) { res.status(502).json({ error: e.message }); }
}));

admin.get('/audit', (req, res) => {
  res.json({ events: db.prepare('SELECT id, actor_email, action, target_id, detail, ip, created_at FROM audit ORDER BY id DESC LIMIT 150').all() });
});

// ======================= STATIC + ERRORS =======================
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'ignore', index: 'index.html', maxAge: PROD ? '1h' : 0 }));
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// Housekeeping: remove old OTP rows
setInterval(() => db.prepare('DELETE FROM otps WHERE created_at < ?').run(now() - 24 * 3600 * 1000), 3600 * 1000).unref();

(async () => {
  try { await backup.init(); } catch (e) { console.error('Backup start-up problem:', e.message); }
  app.listen(PORT, () => {
  console.log(`Fire Safety Academy running on http://localhost:${PORT}`);
  if (!smtpConfigured) console.log('NOTE: No email service is configured, so codes are only printed in this log and nobody receives them. Set RESEND_API_KEY (or SMTP_*) to send real email.');
  if (!PROD) console.log('NOTE: NODE_ENV is not "production". Set NODE_ENV=production behind HTTPS to enable Secure cookies and HSTS.');
  });
})();

// Render stops the old instance on every deploy: push any change still waiting before exiting.
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { try { await backup.flush(8000); } finally { process.exit(0); } });
