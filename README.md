# Aikrhis

For online deployment and the custom subdomain, see [DEPLOYMENT.md](DEPLOYMENT.md).

The Node application uses Supabase PostgreSQL by default. Existing authentication remains in the application; Supabase Auth is not required.

## Supabase setup

1. Create a Supabase project. Open **Connect**, choose **Session pooler**, and copy its PostgreSQL URI. This works on IPv4 networks.
2. In `.env`, set `SECURITY_STORAGE=postgres` and `DATABASE_URL` to that URI. Replace the password placeholder with your database password, URL-encoding special characters. Keep the URI private.
3. TLS certificate validation is enabled. If your connection requires a project CA certificate, download it from the Supabase dashboard and set `PGSSLROOTCERT` to its local file path.
4. Run `npm.cmd install`, then `npm.cmd start`. Open http://localhost:3000 after the ready message.
5. To create the first administrator, run `npm.cmd run setup:admin` and follow the prompts.

If you previously selected SQLite in PowerShell, run `$env:SECURITY_STORAGE="postgres"` before starting; shell variables override `.env`.

On first connection the backend creates `public.users` for accounts and `aikrhis_private.records` for sessions, logs, and settings, using the database owner connection. Users have visible `name`, `email`, `role`, `email_verified`, `active`, and `created_at` columns generated from the complete JSONB account record in `value`. The backend writes the complete record so generated columns stay consistent. Row-level security is enabled and access is revoked from Supabase's `anon` and `authenticated` roles on both tables; the browser talks to the Node backend. Expired sessions are deleted at startup and rejected by authentication on every request.

Upgrading from the original PostgreSQL implementation automatically copies existing accounts from `aikrhis_private.records` into `public.users` once, preserving IDs, password hashes, and account state. The original records remain as a backup. Restart every running app instance after the update so new signups and account changes use `public.users`. In the Supabase Table Editor, choose the `public` schema and open `users`.

Existing MongoDB or SQLite records are not automatically copied. The older PHP application in `project/` is separate and is not started by `npm.cmd start`.

For an offline demo, select `SECURITY_STORAGE=sqlite`. Legacy MongoDB remains available with `SECURITY_STORAGE=mongodb` and `MONGODB_URI`.

Connection reference: https://supabase.com/docs/guides/database/connecting-to-postgres

## Password recovery and email verification

User accounts open the cipher dashboard at `/dashboard`. Administrators go directly to `/security.html`, which has sidebar navigation for overview, user accounts, security alerts, audit reports, monitoring, profile, and activity. Cipher operations are restricted to the `user` role at the API; administrators manage the system through their dashboard. Mobile administrators can open navigation with the Menu button.

Sign-up creates an unverified account and sends a verification link. The home page offers **Send verification email**, including for existing accounts whose email has not yet been verified. Confirming a link unlocks cipher operations. **Forgot password?** in the login form requests a reset link; completing a reset signs out all sessions for that account. The initial administrator created by the local setup command is trusted and marked verified.

For local development, `MAIL_MODE=preview` writes email text and links into `data/mail/`. Open the latest `.txt` file locally and copy its link into your browser. Preview files stay outside the public directory, are ignored by Git, and are never returned through the API. No actual email is sent in this mode. Delete old preview emails after testing.

For delivery to inboxes, set `MAIL_MODE=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `MAIL_FROM` in `.env`. Set `PUBLIC_ORIGIN` to the application's real origin so links point to the right server. Port 465 uses TLS immediately; port 587 requires STARTTLS. Production requires SMTP and an HTTPS origin; preview mode is disabled in production. Database credentials and SMTP credentials are separate.

Verification links expire after 24 hours; reset links expire after 30 minutes. Tokens are random, hashed in storage, consumed once, and invalidated by relevant account changes. Email requests are throttled and each account has a one-minute resend cooldown. Reset requests give the same response for existing and unknown addresses. Email delivery runs after the request; failed jobs record a failure in account logs and leave no usable token. Links use URL fragments and require an explicit confirmation or form submission, so merely opening a link does not consume it.

SMTP reference: https://nodemailer.com/smtp

## Validation

See [FINAL_DEMO.md](FINAL_DEMO.md) for all eight classroom requirements and the four final presentation scenarios. Run `npm.cmd run demo:security` for automated evidence, or `npm.cmd run demo:start` for an isolated presentation dashboard at http://localhost:3001.

Run `npm.cmd test`. PostgreSQL store tests use an isolated PostgreSQL engine and do not access your Supabase project.
