'use strict';
(function () {
  // ---------- tiny DOM helper (no innerHTML anywhere, so user data can never become markup) ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    const add = (c) => {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) return c.forEach(add);
      el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    };
    kids.forEach(add);
    return el;
  }
  const $app = document.getElementById('app');
  const fmt = (ms) => (ms ? new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never');
  const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-GB', { dateStyle: 'long' });

  let toastTimer;
  function toast(msg, isErr) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 3500);
  }

  async function api(path, method, body) {
    const res = await fetch('/api' + path, {
      method: method || 'GET', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fsa' },
      body: body ? JSON.stringify(body) : undefined
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      if (res.status === 401 && state.user && !path.startsWith('/auth/login')) { state.user = null; go('/login'); }
      const err = new Error(data.error || 'Request failed.'); err.status = res.status; err.data = data; throw err;
    }
    return data;
  }

  const state = { user: null, pendingEmail: '', passMark: 55 };
  const isAdmin = (u) => !!u && (u.role === 'admin' || u.role === 'superadmin');
  const isSuper = (u) => !!u && u.role === 'superadmin';
  const ROLE_LABEL = { learner: 'Learner', admin: 'Administrator', superadmin: 'Super Admin' };
  const go = (p) => { if (location.hash === '#' + p) render(); else location.hash = p; };
  const PUBLIC = ['login', 'register', 'verify', 'forgot', 'reset'];

  // ---------- reusable bits ----------
  function errBox() { return h('div', { class: 'alert err hidden', role: 'alert' }); }
  function showMsg(box, msg, kind) { box.className = 'alert ' + (kind || 'err'); box.textContent = msg; }
  function field(label, input, hint) {
    const id = 'f' + Math.random().toString(36).slice(2, 8);
    input.id = id;
    return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
  }
  function progressBar(pct, light) {
    const s = h('span'); s.style.width = Math.max(0, Math.min(100, pct)) + '%';
    return h('div', { class: 'bar' + (light ? ' light' : ''), role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, s);
  }
  async function submitting(btn, fn) {
    const old = btn.textContent; btn.disabled = true; btn.textContent = 'Please wait…';
    try { await fn(); } finally { btn.disabled = false; btn.textContent = old; }
  }

  // ---------- auth screens ----------
  function authShell(title, subtitle, body) {
    return h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
      h('div', { class: 'auth-head' }, h('img', { class: 'logo-badge', src: '/logo.png', alt: 'City of Refuge logo', width: 56, height: 61 }), h('h1', {}, title), h('p', {}, subtitle)),
      h('div', { class: 'auth-body' }, body)));
  }

  function viewLogin() {
    const err = errBox();
    const email = h('input', { type: 'email', autocomplete: 'username', required: true, value: state.pendingEmail || '' });
    const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const btn = h('button', { class: 'btn block', type: 'submit' }, 'Sign in');
    const form = h('form', { novalidate: true, on: { submit: (e) => { e.preventDefault(); submitting(btn, async () => {
      err.className = 'hidden';
      try {
        const r = await api('/auth/login', 'POST', { email: email.value, password: pw.value });
        state.user = r.user; state.pendingEmail = '';
        go('/course');
      } catch (ex) {
        if (ex.data && ex.data.needsVerification) { state.pendingEmail = email.value.trim(); state.verifyNote = ex.message; go('/verify'); }
        else showMsg(err, ex.message);
      }
    }); } } }, err, field('Email address', email), field('Password', pw), btn,
      h('div', { class: 'auth-links' },
        h('a', { href: '#/forgot' }, 'Forgot password?'), h('a', { href: '#/register' }, 'Create an account')));
    return authShell('Fire Safety Academy', 'Sign in to continue your training', form);
  }

  function viewRegister() {
    const err = errBox();
    const name = h('input', { type: 'text', autocomplete: 'name', required: true, maxlength: 100 });
    const email = h('input', { type: 'email', autocomplete: 'email', required: true });
    const pw = h('input', { type: 'password', autocomplete: 'new-password', required: true });
    const pw2 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
    const btn = h('button', { class: 'btn block', type: 'submit' }, 'Create account');
    const form = h('form', { novalidate: true, on: { submit: (e) => { e.preventDefault(); submitting(btn, async () => {
      err.className = 'hidden';
      if (pw.value !== pw2.value) return showMsg(err, 'Passwords do not match.');
      try {
        await api('/auth/register', 'POST', { name: name.value, email: email.value, password: pw.value });
        state.pendingEmail = email.value.trim().toLowerCase(); state.verifyNote = 'We sent a 6-digit code to your email. Enter it below to activate your account.';
        go('/verify');
      } catch (ex) { showMsg(err, ex.message); }
    }); } } }, err, field('Full name', name), field('Email address', email),
      field('Password', pw, 'At least 10 characters with upper-case, lower-case and a number.'),
      field('Confirm password', pw2), btn,
      h('div', { class: 'auth-links' }, h('span', {}, 'Already registered?'), h('a', { href: '#/login' }, 'Sign in')));
    return authShell('Create your account', 'Register, then confirm your email with a one-time code', form);
  }

  function resendButton(purpose, box) {
    let wait = 0, timer;
    const btn = h('button', { type: 'button', class: 'linkbtn' }, 'Send a new code');
    const tick = () => { if (wait > 0) { btn.textContent = `Send a new code (${wait}s)`; btn.disabled = true; wait--; timer = setTimeout(tick, 1000); } else { btn.textContent = 'Send a new code'; btn.disabled = false; } };
    btn.addEventListener('click', async () => {
      try { const r = await api('/auth/resend', 'POST', { email: state.pendingEmail, purpose }); showMsg(box, r.message, 'ok'); wait = 60; clearTimeout(timer); tick(); }
      catch (ex) { showMsg(box, ex.message); }
    });
    return btn;
  }

  function viewVerify() {
    if (!state.pendingEmail) { go('/login'); return h('div'); }
    const err = errBox();
    if (state.verifyNote) { showMsg(err, state.verifyNote, 'info'); state.verifyNote = ''; }
    const otp = h('input', { type: 'text', class: 'otp-input', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]*', required: true, 'aria-label': '6-digit code' });
    otp.addEventListener('input', () => { otp.value = otp.value.replace(/\D/g, '').slice(0, 6); });
    const btn = h('button', { class: 'btn block', type: 'submit' }, 'Confirm email');
    const form = h('form', { novalidate: true, on: { submit: (e) => { e.preventDefault(); submitting(btn, async () => {
      try { const r = await api('/auth/verify', 'POST', { email: state.pendingEmail, otp: otp.value }); state.user = r.user; state.pendingEmail = ''; toast('Email confirmed. Welcome!'); go('/course'); }
      catch (ex) { showMsg(err, ex.message); }
    }); } } },
      err, h('p', {}, 'Enter the 6-digit code sent to ', h('b', {}, state.pendingEmail), '. It expires in 10 minutes.'),
      field('Confirmation code', otp), btn,
      h('div', { class: 'auth-links' }, resendButton('verify', err), h('a', { href: '#/login' }, 'Back to sign in')));
    return authShell('Confirm your email', 'Check your inbox for a one-time code', form);
  }

  function viewForgot() {
    const err = errBox();
    const email = h('input', { type: 'email', autocomplete: 'username', required: true });
    const btn = h('button', { class: 'btn block', type: 'submit' }, 'Email me a reset code');
    const form = h('form', { novalidate: true, on: { submit: (e) => { e.preventDefault(); submitting(btn, async () => {
      try { await api('/auth/forgot', 'POST', { email: email.value }); state.pendingEmail = email.value.trim().toLowerCase(); state.resetNote = 'If an account exists for that email, we have sent a 6-digit code.'; go('/reset'); }
      catch (ex) { showMsg(err, ex.message); }
    }); } } }, err, h('p', {}, 'Enter the email you registered with and we will send a one-time code.'), field('Email address', email), btn,
      h('div', { class: 'auth-links' }, h('a', { href: '#/login' }, 'Back to sign in')));
    return authShell('Reset your password', 'Recover your access with a one-time code', form);
  }

  function viewReset() {
    const err = errBox();
    if (state.resetNote) { showMsg(err, state.resetNote, 'info'); state.resetNote = ''; }
    const email = h('input', { type: 'email', autocomplete: 'username', required: true, value: state.pendingEmail || '' });
    const otp = h('input', { type: 'text', class: 'otp-input', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, required: true, 'aria-label': '6-digit code' });
    otp.addEventListener('input', () => { otp.value = otp.value.replace(/\D/g, '').slice(0, 6); });
    const pw = h('input', { type: 'password', autocomplete: 'new-password', required: true });
    const pw2 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
    const btn = h('button', { class: 'btn block', type: 'submit' }, 'Set new password');
    const resend = resendButton('reset', err);
    email.addEventListener('input', () => { state.pendingEmail = email.value.trim().toLowerCase(); });
    const form = h('form', { novalidate: true, on: { submit: (e) => { e.preventDefault(); submitting(btn, async () => {
      if (pw.value !== pw2.value) return showMsg(err, 'Passwords do not match.');
      try { await api('/auth/reset', 'POST', { email: email.value, otp: otp.value, password: pw.value }); toast('Password updated. Please sign in.'); go('/login'); }
      catch (ex) { showMsg(err, ex.message); }
    }); } } }, err, field('Email address', email), field('6-digit code', otp),
      field('New password', pw, 'At least 10 characters with upper-case, lower-case and a number.'), field('Confirm new password', pw2), btn,
      h('div', { class: 'auth-links' }, resend, h('a', { href: '#/login' }, 'Back to sign in')));
    return authShell('Choose a new password', 'Enter the code from your email', form);
  }

  // ---------- app shell ----------
  function shell(sidebarEl, mainEl, opts) {
    const open = () => root.classList.toggle('open');
    const right = h('div', { class: 'right' },
      isAdmin(state.user) ? h('a', { class: 'btn ghost sm', href: (opts && opts.admin) ? '#/course' : '#/admin' }, (opts && opts.admin) ? 'Course view' : 'Admin') : null,
      h('a', { class: 'btn ghost sm', href: '#/account' }, state.user.name),
      h('button', { class: 'btn secondary sm', type: 'button', on: { click: async () => { try { await api('/auth/logout', 'POST'); } catch (_) {} state.user = null; go('/login'); } } }, 'Sign out'));
    const root = h('div', { class: 'shell' }, sidebarEl,
      h('div', { class: 'overlay', on: { click: open } }),
      h('div', { class: 'main' },
        h('div', { class: 'topbar' }, h('button', { class: 'menu-btn', type: 'button', 'aria-label': 'Toggle menu', on: { click: open } }, '☰'), h('span', { class: 'brand muted small' }, 'Fire Safety Academy'), right),
        h('main', { class: 'content' + (opts && opts.wide ? ' wide' : '') }, mainEl)));
    root.addEventListener('click', (e) => { if (e.target.closest('.sidebar a, .sidebar .nav-item')) root.classList.remove('open'); });
    return root;
  }

  function courseSidebar(ov, activeId) {
    const items = ov.sections.map((s) => {
      const locked = s.status === 'locked';
      const icon = s.status === 'passed' ? h('span', { class: 'tick', 'aria-label': 'Completed' }, '✓')
        : locked ? h('span', { class: 'ring lock', 'aria-label': 'Locked' }, '🔒')
        : h('span', { class: 'ring' + (s.id === activeId ? ' cur' : ''), 'aria-label': 'Not completed' });
      const a = h('a', { class: 'nav-item' + (s.id === activeId ? ' active' : '') + (locked ? ' locked' : ''), href: locked ? '#/course/' + activeId : '#/course/' + s.id, 'aria-current': s.id === activeId ? 'page' : null,
        on: locked ? { click: () => toast('Pass the previous section quiz to unlock this section.', true) } : {} },
        h('span', { class: 'lines' }),
        h('span', { class: 'nav-text' }, s.title, s.attempts ? h('small', {}, `Best score ${s.bestScore}%`) : null), icon);
      return h('li', {}, a);
    });
    const sum = h('a', { class: 'nav-item' + (activeId === 'summary' ? ' active' : ''), href: '#/summary' },
      h('span', { class: 'lines' }), h('span', { class: 'nav-text' }, 'Summary & certificate', h('small', {}, `${ov.passed} of ${ov.total} sections passed`)),
      ov.completed ? h('span', { class: 'tick' }, '✓') : h('span', { class: 'ring' + (activeId === 'summary' ? ' cur' : '') }));
    return h('aside', { class: 'sidebar', 'aria-label': 'Course navigation' },
      h('div', { class: 'side-head' }, h('img', { class: 'logo-badge', src: '/logo.png', alt: 'City of Refuge logo', width: 56, height: 61 }), h('h2', {}, 'Fire safety awareness'), h('div', { class: 'pct' }, `${ov.percent}% COMPLETE`), progressBar(ov.percent)),
      h('ul', { class: 'nav-list' }, items),
      h('div', { class: 'nav-group' }, 'Conclusion'),
      h('ul', { class: 'nav-list' }, h('li', {}, sum)),
      h('div', { class: 'side-foot muted' }, `Pass mark: ${ov.passMark}% per section`));
  }

  function adminSidebar(active) {
    const link = (key, href, label) => h('li', {}, h('a', { class: 'nav-item' + (active === key ? ' active' : ''), href }, h('span', { class: 'nav-text' }, label)));
    return h('aside', { class: 'sidebar' },
      h('div', { class: 'side-head' }, h('img', { class: 'logo-badge', src: '/logo.png', alt: 'City of Refuge logo', width: 56, height: 61 }), h('h2', {}, 'Administration'), h('div', { class: 'pct' }, 'FIRE SAFETY ACADEMY')),
      h('ul', { class: 'nav-list' }, link('dash', '#/admin', 'Dashboard'), link('users', '#/admin/users', 'Manage users'), link('audit', '#/admin/audit', 'Audit log'), isSuper(state.user) ? link('settings', '#/admin/settings', 'Certificate & backup') : null, link('back', '#/course', '← Back to course')));
  }

  function simpleSidebar() {
    return h('aside', { class: 'sidebar' }, h('div', { class: 'side-head' }, h('img', { class: 'logo-badge', src: '/logo.png', alt: 'City of Refuge logo', width: 56, height: 61 }), h('h2', {}, 'Fire safety awareness'), h('div', { class: 'pct' }, 'FIRE SAFETY ACADEMY')));
  }
  function plainSidebar(ov) { return ov ? courseSidebar(ov, 'account') : (isAdmin(state.user) ? adminSidebar('') : simpleSidebar()); }

  // ---------- course ----------
  async function viewCourse(id) {
    const ov = await api('/course');
    if (!id) {
      const target = ov.sections.find((s) => s.status !== 'passed' && s.status !== 'locked');
      return go(target ? '/course/' + target.id : '/summary');
    }
    const sec = await api('/course/' + encodeURIComponent(id));
    let sidebar = courseSidebar(ov, id);
    const refreshSidebar = (newOv) => { const n = courseSidebar(newOv, id); sidebar.replaceWith(n); sidebar = n; };

    const videos = sec.videos.map((v) => h('div', { class: 'video' },
      h('div', { class: 'frame' }, h('iframe', { src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?rel=0`, title: v.title, loading: 'lazy', allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' })),
      h('div', { class: 'cap muted' }, h('span', {}, v.title), h('a', { href: `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}`, target: '_blank', rel: 'noopener noreferrer' }, 'Watch on YouTube'))));

    const lesson = h('div', { class: 'lesson' }, sec.body.map((b) => [
      h('h3', {}, b.h),
      (b.p || []).map((p) => h('p', {}, p)),
      b.list ? h('ul', {}, b.list.map((li) => h('li', {}, li))) : null
    ]));

    const quizBox = h('div', {});
    function renderQuizIntro(p) {
      quizBox.replaceChildren(h('div', { class: 'card quiz-cta' },
        h('div', { class: 'eyebrow' }, 'End of section quiz'),
        h('h3', {}, `Test your knowledge: ${sec.quiz.length} questions`),
        h('p', {}, `You need ${sec.passMark}% or more to pass this section and unlock the next one. You will see your score straight away and can retake the quiz as often as you like.`),
        p.attempts ? h('p', {}, h('b', {}, `Attempts: ${p.attempts}. Best score: ${p.bestScore}%. `), p.passed ? h('span', { class: 'pill green' }, 'Passed') : h('span', { class: 'pill amber' }, 'Not passed yet')) : null,
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', on: { click: async (e) => { await submitting(e.target, async () => { try { await api('/course/' + sec.id + '/lesson-complete', 'POST'); renderQuiz(); } catch (ex) { toast(ex.message, true); } }); } } }, p.attempts ? 'Retake quiz' : 'Start quiz'),
          p.passed && sec.next ? h('a', { class: 'btn secondary', href: '#/course/' + sec.next }, 'Next section →') : null)));
    }
    function renderQuiz() {
      const answers = new Array(sec.quiz.length).fill(null);
      const err = errBox();
      const submit = h('button', { class: 'btn', type: 'submit', disabled: true }, 'Submit answers');
      const counter = h('span', { class: 'muted small' }, `0 of ${sec.quiz.length} answered`);
      const update = () => { const n = answers.filter((a) => a !== null).length; counter.textContent = `${n} of ${sec.quiz.length} answered`; submit.disabled = n !== sec.quiz.length; };
      const qs = sec.quiz.map((q, qi) => h('fieldset', { class: 'q', style: null },
        h('legend', { class: 'q-title' }, `${qi + 1}. ${q.q}`),
        q.options.map((o, oi) => {
          const radio = h('input', { type: 'radio', name: 'q' + qi, value: String(oi) });
          const lab = h('label', { class: 'opt' }, radio, h('span', {}, o));
          radio.addEventListener('change', () => { answers[qi] = oi; lab.parentElement.querySelectorAll('.opt').forEach((x) => x.classList.remove('sel')); lab.classList.add('sel'); update(); });
          return lab;
        })));
      qs.forEach((f) => { f.style.border = '0'; f.style.padding = '0'; f.style.margin = '0'; f.firstChild.style.padding = '0'; });
      const form = h('form', { novalidate: true, on: { submit: (e) => { e.preventDefault(); submitting(submit, async () => {
        try { const r = await api('/course/' + sec.id + '/quiz', 'POST', { answers }); renderResult(r, answers); refreshSidebar(r.overview); }
        catch (ex) { showMsg(err, ex.message); }
      }); } } }, qs, err, h('div', { class: 'row between' }, counter, submit));
      quizBox.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'eyebrow' }, 'Section quiz'), h('h3', {}, sec.title), form));
      quizBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function renderResult(r, answers) {
      const review = sec.quiz.map((q, qi) => {
        const res = r.results[qi];
        return h('div', { class: 'q' }, h('div', { class: 'q-title' }, `${qi + 1}. ${q.q}`),
          q.options.map((o, oi) => h('div', { class: 'opt' + (oi === res.correctAnswer ? ' right' : (oi === res.yourAnswer && !res.isCorrect ? ' wrong' : '')) },
            h('span', {}, (oi === res.correctAnswer ? '✓ ' : (oi === res.yourAnswer ? '✗ ' : '')) + o))),
          h('div', { class: 'explain' }, (res.isCorrect ? 'Correct. ' : 'Not quite. ') + res.explain));
      });
      quizBox.replaceChildren(
        h('div', { class: 'score-card ' + (r.passed ? 'pass' : 'fail'), role: 'status' },
          h('div', { class: 'eyebrow' }, r.passed ? 'Section passed' : 'Not passed yet'),
          h('div', { class: 'score-big' }, r.score + '%'),
          h('p', {}, `${r.correct} of ${r.total} correct. Pass mark: ${r.passMark}%.`),
          h('div', { class: 'row', style: null },
            !r.passed ? h('button', { class: 'btn', type: 'button', on: { click: () => { renderQuiz(); } } }, 'Try again') : null,
            !r.passed ? h('button', { class: 'btn secondary', type: 'button', on: { click: () => window.scrollTo({ top: 0, behavior: 'smooth' }) } }, 'Review the lesson') : null,
            r.passed && r.next ? h('a', { class: 'btn', href: '#/course/' + r.next }, 'Next section →') : null,
            r.passed && !r.next ? h('a', { class: 'btn', href: '#/summary' }, 'View summary & certificate →') : null,
            r.overview && r.overview.completed ? h('a', { class: 'btn secondary', href: '/api/certificate/pdf', download: 'Fire-Safety-Certificate.pdf' }, '⬇ Download certificate (PDF)') : null)),
        h('div', { class: 'card' }, h('h3', {}, 'Review your answers'), review));
      quizBox.firstChild.querySelector('.row').style.justifyContent = 'center';
      quizBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    renderQuizIntro(sec.progress);

    const main = h('div', {},
      h('div', { class: 'eyebrow' }, `Section ${sec.index + 1} of ${ov.total}`),
      h('h1', {}, sec.title), h('p', { class: 'lead' }, sec.summary),
      videos, lesson, quizBox);
    mount(shell(sidebar, main));
    document.title = sec.title + ' | Fire Safety Academy';
  }

  async function viewSummary() {
    const ov = await api('/course');
    let certData = null;
    if (ov.completed) { try { certData = await api('/certificate'); } catch (_) {} }
    const rows = ov.sections.map((s) => h('tr', {},
      h('td', {}, s.title), h('td', {}, s.attempts ? s.bestScore + '%' : '—'), h('td', {}, String(s.attempts)),
      h('td', {}, s.status === 'passed' ? h('span', { class: 'pill green' }, 'Passed') : s.status === 'locked' ? h('span', { class: 'pill' }, 'Locked') : s.attempts ? h('span', { class: 'pill red' }, 'Not passed') : h('span', { class: 'pill amber' }, 'Not started')),
      h('td', {}, s.status === 'locked' ? '' : h('a', { href: '#/course/' + s.id }, s.status === 'passed' ? 'Review' : 'Open'))));
    const main = h('div', {},
      h('div', { class: 'eyebrow' }, 'Conclusion'), h('h1', {}, 'Summary & certificate'),
      h('div', { class: 'card' },
        h('div', { class: 'row between' }, h('h3', {}, 'Your training progress'), h('b', {}, `${ov.percent}% complete`)),
        progressBar(ov.percent, true), h('p', { class: 'muted small' }, `${ov.passed} of ${ov.total} sections passed. The pass mark for each section is ${ov.passMark}%.`),
        h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Section', 'Best score', 'Attempts', 'Status', ''].map((t) => h('th', {}, t)))), h('tbody', {}, rows)))),
      certData ? certificate(certData) : h('div', { class: 'alert info' }, 'Pass all sections to unlock your certificate of completion.'));
    mount(shell(courseSidebar(ov, 'summary'), main));
  }
  function certificate(c) {
    return h('div', {}, h('div', { class: 'cert' },
      h('img', { class: 'cert-logo', src: '/logo.png', alt: 'City of Refuge logo', width: 83, height: 90 }),
      h('p', { class: 'eyebrow' }, 'Fire Safety Academy'), h('h2', {}, 'Certificate of Completion'),
      h('p', {}, 'This certifies that'), h('div', { class: 'name' }, c.name),
      h('p', {}, 'has successfully completed Fire Safety Awareness, including fire hazards, prevention, response, fire extinguishers and fire drills.'),
      h('p', { class: 'muted' }, 'Completed on ' + fmtDate(c.date)), h('p', { class: 'muted small' }, 'Certificate no. ' + c.number)),
      h('div', { class: 'row no-print cert-actions' },
        h('a', { class: 'btn', href: '/api/certificate/pdf', download: 'Fire-Safety-Certificate.pdf' }, '⬇ Download certificate (PDF)'),
        h('button', { class: 'btn secondary', type: 'button', on: { click: () => window.print() } }, 'Print')));
  }

  // ---------- account ----------
  async function viewAccount() {
    let ov = null;
    if (!state.user.must_change_password && (state.user.course_access || isAdmin(state.user))) { try { ov = await api('/course'); } catch (_) {} }
    const err = errBox();
    const cur = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const n1 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
    const n2 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Update password');
    const form = h('form', { novalidate: true, on: { submit: (e) => { e.preventDefault(); submitting(btn, async () => {
      if (n1.value !== n2.value) return showMsg(err, 'New passwords do not match.');
      try { await api('/auth/change-password', 'POST', { currentPassword: cur.value, newPassword: n1.value }); state.user.must_change_password = false; toast('Password updated.'); cur.value = n1.value = n2.value = ''; err.className = 'hidden'; go('/course'); }
      catch (ex) { showMsg(err, ex.message); }
    }); } } }, err, field('Current password', cur), field('New password', n1, 'At least 10 characters with upper-case, lower-case and a number.'), field('Confirm new password', n2), btn);
    const main = h('div', {}, h('h1', {}, 'My account'),
      state.user.must_change_password ? h('div', { class: 'alert info' }, 'For your security, please choose a new password before continuing.') : null,
      h('div', { class: 'card' }, h('h3', {}, 'Details'), h('p', {}, h('b', {}, 'Name: '), state.user.name), h('p', {}, h('b', {}, 'Email: '), state.user.email), h('p', {}, h('b', {}, 'Role: '), ROLE_LABEL[state.user.role] || state.user.role)),
      h('div', { class: 'card' }, h('h3', {}, 'Change password'), form));
    mount(shell(plainSidebar(ov), main));
  }

  // ---------- no access ----------
  function viewNoAccess() {
    mount(shell(plainSidebar(null), h('div', {}, h('h1', {}, 'Access pending'), h('div', { class: 'alert info' }, 'Your account is active but course access has not been granted yet. Please contact your administrator.'))));
  }

  // ---------- admin ----------
  async function viewAdminDash() {
    const s = await api('/admin/stats');
    const stat = (n, l) => h('div', { class: 'stat' }, h('b', {}, String(n)), h('span', { class: 'muted small' }, l));
    mount(shell(adminSidebar('dash'), h('div', {}, h('h1', {}, 'Dashboard'),
      h('div', { class: 'stats' }, stat(s.users, 'Total users'), stat(s.learners, 'Learners'), stat(s.admins, 'Admins'), stat(s.completed, 'Completed all sections'), stat(s.inProgress, 'In progress'), stat(s.unverified, 'Unverified emails'), stat(s.suspended, 'Suspended'), stat(s.attempts, 'Quiz attempts')),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/admin/users' }, 'Manage users'), isSuper(state.user) ? h('a', { class: 'btn secondary', href: '#/admin/settings' }, 'Certificate signature & backup') : null)), { admin: true, wide: true }));
  }

  async function viewAdminUsers() {
    let q = '';
    const body = h('tbody');
    const loadRows = async () => {
      const r = await api('/admin/users?q=' + encodeURIComponent(q));
      body.replaceChildren(...r.users.map((u) => h('tr', {},
        h('td', {}, h('b', {}, u.name), h('div', { class: 'muted small' }, u.email)),
        h('td', {}, h('span', { class: 'pill ' + (u.role === 'superadmin' ? 'amber' : u.role === 'admin' ? 'teal' : '') }, ROLE_LABEL[u.role] || u.role)),
        h('td', {}, u.status === 'suspended' ? h('span', { class: 'pill red' }, 'Suspended') : u.locked ? h('span', { class: 'pill amber' }, 'Locked') : h('span', { class: 'pill green' }, 'Active'), ' ', u.email_verified ? null : h('span', { class: 'pill amber' }, 'Unverified'), ' ', u.course_access ? null : h('span', { class: 'pill red' }, 'No access')),
        h('td', {}, progressBar(u.percent, true), h('span', { class: 'small muted' }, `${u.passedSections}/${u.totalSections} passed`)),
        h('td', { class: 'small' }, fmt(u.last_login)),
        h('td', {}, h('a', { class: 'btn sm', href: '#/admin/user/' + u.id }, 'Manage')))));
      if (!r.users.length) body.replaceChildren(h('tr', {}, h('td', { colspan: 6, class: 'muted' }, 'No users found.')));
    };
    const search = h('input', { type: 'text', placeholder: 'Search name or email…', 'aria-label': 'Search users' });
    let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { q = search.value; loadRows().catch((e) => toast(e.message, true)); }, 250); });
    const addBox = h('div', { class: 'card hidden' });
    addBox.appendChild(addUserForm(async () => { addBox.classList.add('hidden'); await loadRows(); }));
    const main = h('div', {}, h('h1', {}, 'Manage users'),
      h('div', { class: 'toolbar' }, search, h('button', { class: 'btn', type: 'button', on: { click: () => addBox.classList.toggle('hidden') } }, '+ Add user')),
      addBox,
      h('div', { class: 'card table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['User', 'Role', 'Status', 'Progress', 'Last sign-in', ''].map((x) => h('th', {}, x)))), body)));
    mount(shell(adminSidebar('users'), main, { admin: true, wide: true }));
    await loadRows();
  }

  function addUserForm(done) {
    const err = errBox();
    const name = h('input', { type: 'text', required: true }), email = h('input', { type: 'email', required: true }), pw = h('input', { type: 'password', autocomplete: 'new-password', required: true });
    const role = h('select', {}, h('option', { value: 'learner' }, 'Learner'), h('option', { value: 'admin' }, 'Administrator'), isSuper(state.user) ? h('option', { value: 'superadmin' }, 'Super Admin') : null);
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Create user');
    return h('form', { novalidate: true, on: { submit: (e) => { e.preventDefault(); submitting(btn, async () => {
      try { await api('/admin/users', 'POST', { name: name.value, email: email.value, password: pw.value, role: role.value }); toast('User created. They must change the password at first sign-in.'); await done(); }
      catch (ex) { showMsg(err, ex.message); }
    }); } } }, h('h3', {}, 'Add a user'), err,
      h('div', { class: 'grid2' }, field('Full name', name), field('Email', email), field('Temporary password', pw, 'At least 10 characters with upper-case, lower-case and a number.'), field('Role', role)), btn);
  }

  async function viewAdminUser(id) {
    const d = await api('/admin/users/' + encodeURIComponent(id));
    const u = d.user;
    const reload = () => viewAdminUser(id);
    const act = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg); await reload(); } catch (ex) { toast(ex.message, true); } };

    const name = h('input', { type: 'text', value: u.name }), email = h('input', { type: 'email', value: u.email });
    const role = h('select', {}, ['learner', 'admin'].concat(isSuper(state.user) || u.role === 'superadmin' ? ['superadmin'] : []).map((r) => h('option', { value: r, selected: u.role === r }, ROLE_LABEL[r])));
    const status = h('select', {}, ['active', 'suspended'].map((r) => h('option', { value: r, selected: u.status === r }, r[0].toUpperCase() + r.slice(1))));
    const access = h('input', { type: 'checkbox', checked: u.course_access }), verified = h('input', { type: 'checkbox', checked: u.email_verified });
    const saveBtn = h('button', { class: 'btn', type: 'submit' }, 'Save changes');
    const profile = h('form', { novalidate: true, on: { submit: (e) => { e.preventDefault(); submitting(saveBtn, () => act(() => api('/admin/users/' + id, 'PATCH', { name: name.value, email: email.value, role: role.value, status: status.value, course_access: access.checked, email_verified: verified.checked }), 'Saved.')); } } },
      h('div', { class: 'grid2' }, field('Name', name), field('Email', email), field('Role', role), field('Account status', status)),
      h('div', { class: 'row' }, h('label', { class: 'check' }, access, 'Course access granted'), h('label', { class: 'check' }, verified, 'Email verified')), h('p'), saveBtn);

    const newPw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'New temporary password' });
    const pwBtn = h('button', { class: 'btn secondary', type: 'button', on: { click: () => act(() => api('/admin/users/' + id + '/password', 'POST', { password: newPw.value }), 'Password set. The user must change it at next sign-in.') } }, 'Set password');

    const secRows = d.sections.map((s) => {
      const score = h('input', { type: 'number', min: 0, max: 100, step: 0.1, value: s.attempts || s.passed ? s.bestScore : '', 'aria-label': 'Score for ' + s.title });
      const passed = h('select', { 'aria-label': 'Passed status' }, h('option', { value: 'auto' }, 'Auto (≥' + d.passMark + '%)'), h('option', { value: 'yes', selected: false }, 'Mark passed'), h('option', { value: 'no' }, 'Mark failed'));
      return h('tr', {}, h('td', {}, s.title, h('div', { class: 'small muted' }, `${s.attempts} attempt(s)`)),
        h('td', {}, s.passed ? h('span', { class: 'pill green' }, 'Passed') : s.attempts ? h('span', { class: 'pill red' }, 'Not passed') : h('span', { class: 'pill' }, 'Not started')),
        h('td', {}, h('div', { class: 'inline-edit' }, score, passed,
          h('button', { class: 'btn sm', type: 'button', on: { click: () => { const body = { score: score.value }; if (passed.value !== 'auto') body.passed = passed.value === 'yes'; act(() => api('/admin/users/' + id + '/progress/' + s.id, 'PUT', body), 'Score updated.'); } } }, 'Save'),
          h('button', { class: 'btn sm secondary', type: 'button', on: { click: () => { if (confirm('Reset this section for the user?')) act(() => api('/admin/users/' + id + '/progress/' + s.id, 'DELETE'), 'Section reset.'); } } }, 'Reset'))));
    });

    const attemptRows = d.attempts.map((a) => h('tr', {}, h('td', {}, (d.sections.find((s) => s.id === a.section_id) || {}).title || a.section_id), h('td', {}, `${a.correct}/${a.total}`), h('td', {}, a.score + '%'), h('td', {}, a.passed ? 'Passed' : 'Failed'), h('td', { class: 'small' }, fmt(a.created_at))));

    const main = h('div', {}, h('p', {}, h('a', { href: '#/admin/users' }, '← All users')), h('h1', {}, u.name),
      h('p', { class: 'muted' }, `${u.email} · joined ${fmt(u.created_at)} · last sign-in ${fmt(u.last_login)}`),
      h('div', { class: 'card' }, h('h3', {}, 'Profile & permissions'), profile),
      h('div', { class: 'card' }, h('h3', {}, 'Login & security'),
        h('div', { class: 'toolbar' }, newPw, pwBtn),
        h('div', { class: 'row' },
          u.locked ? h('button', { class: 'btn secondary', type: 'button', on: { click: () => act(() => api('/admin/users/' + id + '/unlock', 'POST'), 'Account unlocked.') } }, 'Unlock account') : null,
          h('button', { class: 'btn secondary', type: 'button', on: { click: () => act(() => api('/admin/users/' + id + '/sign-out', 'POST'), 'User signed out everywhere.') } }, 'Force sign-out'))),
      h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h3', {}, `Training progress (${u.percent}%)`),
        h('button', { class: 'btn sm secondary', type: 'button', on: { click: () => { if (confirm('Reset ALL progress and attempts for this user?')) act(() => api('/admin/users/' + id + '/progress', 'DELETE'), 'Progress reset.'); } } }, 'Reset all progress')),
        progressBar(u.percent, true), h('p'),
        h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Section', 'Status', 'Change score'].map((x) => h('th', {}, x)))), h('tbody', {}, secRows)))),
      h('div', { class: 'card' }, h('h3', {}, 'Recent quiz attempts'), attemptRows.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Section', 'Correct', 'Score', 'Result', 'When'].map((x) => h('th', {}, x)))), h('tbody', {}, attemptRows))) : h('p', { class: 'muted' }, 'No attempts yet.')),
      h('div', { class: 'card' }, h('h3', {}, 'Danger zone'), h('button', { class: 'btn danger', type: 'button', on: { click: () => { if (confirm(`Permanently delete ${u.name} and all their data?`)) act(async () => { await api('/admin/users/' + id, 'DELETE'); go('/admin/users'); }, 'User deleted.'); } } }, 'Delete user')));
    mount(shell(adminSidebar('users'), main, { admin: true, wide: true }));
  }

  async function viewAdminAudit() {
    const r = await api('/admin/audit');
    const rows = r.events.map((e) => h('tr', {}, h('td', { class: 'small' }, fmt(e.created_at)), h('td', {}, e.actor_email || '—'), h('td', {}, e.action), h('td', {}, e.target_id || ''), h('td', { class: 'small' }, e.detail || ''), h('td', { class: 'small' }, e.ip || '')));
    mount(shell(adminSidebar('audit'), h('div', {}, h('h1', {}, 'Audit log'), h('div', { class: 'card table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['When', 'Actor', 'Action', 'Target', 'Detail', 'IP'].map((x) => h('th', {}, x)))), h('tbody', {}, rows)))), { admin: true, wide: true }));
  }


  // ---------- Super Admin: certificate signature / logo / backup ----------
  async function viewAdminSettings() {
    const [cs, bk] = await Promise.all([api('/admin/certificate-settings'), api('/admin/backup/status')]);
    const reload = () => viewAdminSettings();

    function imageCard(kind, title, help, info) {
      const err = errBox();
      const file = h('input', { type: 'file', accept: 'image/png,image/jpeg' });
      const preview = info.has ? h('img', { class: 'asset-preview', src: '/api/admin/assets/' + kind + '?v=' + (info.updatedAt || 0), alt: 'Current ' + kind }) : h('p', { class: 'muted small' }, 'Nothing uploaded yet.');
      const up = h('button', { class: 'btn', type: 'button' }, info.has ? 'Replace' : 'Upload');
      up.addEventListener('click', () => submitting(up, async () => {
        try {
          const f = file.files[0];
          if (!f) throw new Error('Choose a PNG or JPG file first.');
          if (f.size > cs.maxKb * 1024) throw new Error('That file is too large. Maximum is ' + cs.maxKb + ' KB.');
          const data = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => bad(new Error('Could not read the file.')); r.readAsDataURL(f); });
          await api('/admin/assets/' + kind, 'POST', { data });
          toast(title + ' saved.'); await reload();
        } catch (ex) { showMsg(err, ex.message); }
      }));
      const del = info.has ? h('button', { class: 'btn secondary', type: 'button', on: { click: async () => { if (!confirm('Remove the ' + kind + '?')) return; try { await api('/admin/assets/' + kind, 'DELETE'); toast(title + ' removed.'); await reload(); } catch (ex) { toast(ex.message, true); } } } }, 'Remove') : null;
      return h('div', { class: 'card' }, h('h3', {}, title), h('p', { class: 'muted small' }, help), err, preview, h('div', { class: 'field' }, file), h('div', { class: 'row' }, up, del));
    }

    const nameIn = h('input', { type: 'text', maxlength: 60, value: cs.signatoryName || '' });
    const titleIn = h('input', { type: 'text', maxlength: 60, value: cs.signatoryTitle || '', placeholder: 'Authorised signatory' });
    const saveBtn = h('button', { class: 'btn', type: 'submit' }, 'Save signatory');
    const who = h('form', { class: 'card', novalidate: true, on: { submit: (e) => { e.preventDefault(); submitting(saveBtn, async () => { try { await api('/admin/certificate-settings', 'PUT', { signatoryName: nameIn.value, signatoryTitle: titleIn.value }); toast('Saved.'); } catch (ex) { toast(ex.message, true); } }); } } },
      h('h3', {}, 'Signatory'), h('p', { class: 'muted small' }, 'Printed under the signature line on every certificate.'),
      h('div', { class: 'grid2' }, field('Name', nameIn), field('Title (optional)', titleIn, 'Leave empty to print "Authorised signatory".')), saveBtn);

    const when = (ms) => (ms ? fmt(ms) : 'never');
    const run = h('button', { class: 'btn', type: 'button' }, 'Back up now');
    run.addEventListener('click', () => submitting(run, async () => { try { const r = await api('/admin/backup/run', 'POST'); toast(r.skipped ? 'Already up to date.' : 'Backup saved.'); await reload(); } catch (ex) { toast(ex.message, true); } }));
    const restore = h('button', { class: 'btn danger', type: 'button' }, 'Restore from GitHub');
    restore.addEventListener('click', () => {
      if (prompt('This REPLACES all users, progress and logs on this server with the copy stored on GitHub, and signs everyone out.\n\nType RESTORE to continue.') !== 'RESTORE') return;
      submitting(restore, async () => { try { await api('/admin/backup/restore', 'POST', { confirm: 'RESTORE' }); state.user = null; toast('Restored. Please sign in again.'); go('/login'); } catch (ex) { toast(ex.message, true); } });
    });
    const line = (k, v) => h('p', {}, h('b', {}, k + ': '), v);
    const backupCard = h('div', { class: 'card' }, h('h3', {}, 'Backup of logins and every change'),
      bk.configured
        ? h('div', { class: 'alert info' }, 'Connected to GitHub: ' + bk.repo + ' (branch ' + bk.branch + ', file ' + bk.file + '). Each change is committed automatically about ' + bk.delaySeconds + ' seconds after it happens.')
        : h('div', { class: 'alert err' }, 'GitHub is not connected. Changes are only saved to a file on this server, which Render erases on every redeploy. Set GITHUB_TOKEN and GITHUB_BACKUP_REPO in your Render environment.'),
      line('Last successful backup', when(bk.lastSuccess)), line('Waiting to be saved', bk.pending ? 'yes' : 'no'),
      bk.lastCommit ? h('p', {}, h('a', { href: bk.lastCommit, target: '_blank', rel: 'noopener noreferrer' }, 'Latest commit on GitHub')) : null,
      bk.lastError ? h('div', { class: 'alert err' }, bk.lastError) : null,
      line('Stored', `${bk.counts.users} users, ${bk.counts.progress} progress rows, ${bk.counts.attempts} quiz attempts, ${bk.counts.audit} log entries`),
      h('p', { class: 'muted small' }, 'The backup contains email addresses and password hashes. Keep the GitHub repository PRIVATE.'),
      h('div', { class: 'row' }, run, h('a', { class: 'btn secondary', href: '/api/admin/backup/download', download: '' }, 'Download backup file'), bk.configured ? restore : null));

    mount(shell(adminSidebar('settings'), h('div', {}, h('h1', {}, 'Certificate & backup'),
      imageCard('signature', 'Certificate signature', 'Upload a PNG (transparent background works best) or JPG, up to ' + cs.maxKb + ' KB. It is printed above the signature line on every certificate.', cs.signature),
      who,
      imageCard('logo', 'Certificate logo (optional)', 'Replaces the default logo on certificates. PNG or JPG, up to ' + cs.maxKb + ' KB.', cs.logo),
      backupCard), { admin: true, wide: true }));
  }

  // ---------- router ----------
  function mount(el) { $app.replaceChildren(el); window.scrollTo(0, 0); }
  async function render() {
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    const route = parts[0] || '';
    document.title = 'Fire Safety Academy';
    try {
      if (!state.user) {
        if (!PUBLIC.includes(route)) return go('/login');
        const views = { login: viewLogin, register: viewRegister, verify: viewVerify, forgot: viewForgot, reset: viewReset };
        return mount(views[route]());
      }
      if (PUBLIC.includes(route) || route === '') return go('/course');
      if (state.user.must_change_password && route !== 'account') return go('/account');
      if (route === 'course') return await viewCourse(parts[1]);
      if (route === 'summary') return await viewSummary();
      if (route === 'account') return await viewAccount();
      if (route === 'admin') {
        if (!isAdmin(state.user)) return go('/course');
        if (!parts[1]) return await viewAdminDash();
        if (parts[1] === 'users') return await viewAdminUsers();
        if (parts[1] === 'user') return await viewAdminUser(parts[2]);
        if (parts[1] === 'audit') return await viewAdminAudit();
        if (parts[1] === 'settings') return isSuper(state.user) ? await viewAdminSettings() : go('/admin');
      }
      go('/course');
    } catch (ex) {
      if (ex.data && ex.data.code === 'NO_ACCESS') return viewNoAccess();
      if (state.user) { toast(ex.message, true); if (ex.status === 403 && route === 'course' && parts[1]) go('/course'); else mount(shell(plainSidebar(null), h('div', { class: 'alert err' }, ex.message))); }
    }
  }

  window.addEventListener('hashchange', render);
  (async function init() {
    try { const r = await api('/auth/me'); state.user = r.user; state.passMark = r.passMark; } catch (_) { state.user = null; }
    render();
  })();
})();
