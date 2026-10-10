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
- When all sections are passed, users can download a professional A4 PDF certificate (logo, name, date, signature, certificate number). No scores are printed on it.
- Sidebar shows progress, ticks, locks. Summary page shows all scores and a printable certificate when all sections are passed.

## Admin panel (`#/admin`)
- Dashboard stats; search users; add users.
- Per user: edit name/email, role, suspend/activate, grant or revoke course access, mark email verified,
  set a new password, unlock, force sign-out, change any section score or pass/fail, reset a section or all progress, delete.
- Audit log of sign-ins, learner activity (lessons, quiz attempts) and every admin action.

## Roles
- **Learner**: takes the course.
- **Administrator**: manages learners and other administrators, sees the audit log.
- **Super Admin**: everything an Administrator can do, plus: upload the certificate **signature** and **logo**, set the signatory
  name/title, create or edit Super Admin accounts, and run/download/restore backups (`#/admin/settings`).
  A normal Administrator cannot edit, reset, sign out or delete a Super Admin. The last Super Admin cannot be removed.
  The Super Admin is whoever `SUPERADMIN_EMAIL` names: if that account exists and its email is confirmed it is promoted when the site
  starts; if it does not exist it is created (password from `SUPERADMIN_PASSWORD`, or a random one printed once in the Render logs).
  If the variable is not set, the oldest administrator is promoted. A Super Admin is also an Administrator, so one role covers both.
  Another Super Admin can also change anyone's role in **Manage users**.

## Two-step sign-in for administrators
After the password, every Administrator and Super Admin must enter a 6-digit code emailed to them (expires in 10 minutes, 5 tries,
single use). Learners are not affected. This needs working email (SMTP / Resend), and `ADMIN_EMAIL` / `SUPERADMIN_EMAIL` must be real inboxes.
Emergency switch if email is down: set `ADMIN_2FA=off`, sign in, fix email, then remove it.

## Backup to GitHub (logins and every change)
Render's disk is erased on each deploy, so the database is copied to a **private** GitHub repo:
1. Create a private repo (tick "Add a README"), e.g. `fsa-data`.
2. Create a fine-grained token limited to that repo with **Contents: Read and write**.
3. In Render > Environment add `GITHUB_TOKEN`, `GITHUB_BACKUP_REPO=owner/fsa-data`, and `JWT_SECRET` / `OTP_SECRET` (long random strings).
That is all. Every change (sign-ups, logins, quiz attempts, admin edits, signature uploads) is committed to the branch `data-backup`
about 30 seconds later, with a message such as `Backup: login x3, quiz_attempt (42 users, 810 log entries)`. The file has one record per
line, so `git log -p` shows exactly what changed and when. On start-up, if the database is empty (a fresh Render deploy), the latest
snapshot is restored automatically. If GitHub cannot be reached at that moment, backups are paused so an empty database never overwrites your data.
- The snapshot holds emails and **password hashes**: keep the repo private. `JWT_SECRET`/`OTP_SECRET` are never stored in it.
- Use a separate branch (default) or repo from the one Render deploys, otherwise each backup would trigger a redeploy.
- Without GitHub settings, changes go to `backup/snapshot.json`; run `git add backup && git commit && git push` to a private repo.
- Manual tools: `npm run backup` (write file), `npm run restore` (load file), `npm run backup:github`, `npm run restore:github` (add `-- --force` to replace existing data).

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
3. Set up the GitHub backup above (or back up the `data/` folder). Never expose `data/` publicly.
4. Keep dependencies updated (`npm audit`, `npm update`).

## Changing content
Lessons, YouTube video IDs and quiz questions live in `content.js`. Restart the server after editing.
Videos are embedded via youtube-nocookie.com; if a video owner removes or blocks a video, replace its ID.
