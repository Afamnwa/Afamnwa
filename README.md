# Fire Safety Academy

Fire safety / fire drill / fire extinguisher training with videos, readable lessons, instantly-marked quizzes
(pass mark 55% per section), a progress tracker, certificate, and an admin panel.

## Run it
```bash
npm install
cp .env.example .env      # then edit it (admin email, SMTP settings)
npm start                 # http://localhost:3000
```
First start creates the admin account (`ADMIN_EMAIL`). If `ADMIN_PASSWORD` is blank, a random password is printed
once in the console and you must change it at first sign-in.

**Email:** set the `SMTP_*` values (Gmail app password, Brevo, Mailgun, Office 365, etc.). Until then, one-time codes are
printed in the server console only (never sent to the browser), which is fine for trying it out but not for real users.

## What users get
- Register -> 6-digit code emailed -> enter code to activate and sign in.
- Forgot password -> code emailed -> set a new password.
- Six sections (hazards, prevention, response, extinguishers, drills...) each with YouTube videos, a lesson, and a 6-question quiz.
- Quiz is marked instantly on the server. 55% or more passes and unlocks the next section. Retakes are unlimited.
- Sidebar shows progress, ticks, locks. Summary page shows all scores and a printable certificate when all sections are passed.

## Admin panel (`#/admin`)
- Dashboard stats; search users; add users.
- Per user: edit name/email, role, suspend/activate, grant or revoke course access, mark email verified,
  set a new password, unlock, force sign-out, change any section score or pass/fail, reset a section or all progress, delete.
- Audit log of sign-ins and every admin action.

## Security built in
- Passwords hashed with bcrypt (cost 12); 10+ chars with upper/lower/number required.
- OTPs: random 6 digits, stored only as HMAC hashes, expire in 10 minutes, 5 tries max, single use, 60-second resend gap.
- Sessions in HttpOnly + SameSite=Strict cookies (Secure in production); sessions are revoked instantly on suspend,
  role change, password change or reset.
- Account lock for 15 minutes after 5 wrong passwords; rate limits on all auth, OTP, quiz and admin routes.
- Same answers for known/unknown emails (no account enumeration); constant-time checks.
- CSRF protection (custom header + Origin check + SameSite), strict Content-Security-Policy, Helmet headers, HSTS in production.
- Quiz answers never leave the server until a quiz is submitted; all grading is server-side.
- Parameterised SQL only; the front end never uses innerHTML, so user data cannot become script.
- Last admin cannot be demoted, suspended or deleted; admins cannot delete themselves.
- Database and secrets files are created with owner-only permissions.

## Going live checklist
1. Serve over HTTPS (nginx / Caddy / your host) and set `NODE_ENV=production` and `TRUST_PROXY=1`.
2. Configure SMTP and set your own admin email.
3. Back up the `data/` folder regularly (it holds the database and secrets). Never expose it publicly.
4. Keep dependencies updated (`npm audit`, `npm update`).

## Changing content
Lessons, YouTube video IDs and quiz questions live in `content.js`. Restart the server after editing.
Videos are embedded via youtube-nocookie.com; if a video owner removes or blocks a video, replace its ID.
