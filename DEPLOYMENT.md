# Deploy Aikrhis

Target address: **https://aikrhis.airsense.sbs**. Create a separate application for this subdomain. Keep the existing root website at `airsense.sbs`.

## Hostinger preparation

The Express app needs Node.js hosting. Hostinger supports managed Node.js deployment on Business/Cloud plans; a VPS needs server configuration. A domain subscription alone does not host this backend.

In Hostinger, open **Websites**, then **Create Website → Web App → Import Git Repository**, and choose `dexter-588/aikrhis-system`, branch `main`. The application's repository root contains `package.json`; do not choose the old PHP `project/` directory or upload only `public/`.

Use Node.js **24.x**, framework **Express**, entry file **app.js**, dependency installation **npm ci --omit=dev**, and start command **npm start**. This server does not need a frontend compilation step. Use the provider's Express settings; if the panel demands additional build fields, inspect those fields before proceeding.

Reference: [Hostinger Node.js deployment](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/).

## Environment settings

Use `deployment.env.example` as the checklist. Enter values in the hosting environment panel, never in GitHub source:

| Setting | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `SECURITY_STORAGE` | `postgres` |
| `DATABASE_URL` | The working Supabase session pooler URI from your local `.env` |
| `PGSSLROOTCERT` | `./supabase-ca.crt` (the public CA file is in the repository) |
| `PUBLIC_ORIGIN` | `https://aikrhis.airsense.sbs` |
| `MAIL_MODE` | `smtp` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | Your email provider's verified sending configuration |

Do not copy the Windows `C:/...` certificate path to Linux hosting. The server uses the hosting `PORT` and binds publicly in production. Production enables Secure cookies and HSTS; use HTTPS. With a preview hostname, temporarily set `PUBLIC_ORIGIN` to that HTTPS origin for testing, then switch to the final domain before accepting registrations.

Real mail delivery is required for new users to verify their email and run ciphers. Local email preview is disabled in production. A missing SMTP configuration leaves registration accounts unverified and disables reset/resend delivery; configure email before opening signup to users.

## Subdomain and verification

After creating the Node service, attach `aikrhis.airsense.sbs` through its custom domain settings. Use the DNS target provided by the hosting service for the `aikrhis` record. Keep the root `@`, `www`, mail records and nameservers for the existing website. Do not guess the DNS target or replace root-domain DNS to connect a subdomain.

Verify HTTPS and `GET /health` returning `{"status":"ok"}`. Test signup and actual email verification, user login and ciphers, admin login/sidebar, logout, password reset, and the account/security reports. Check `public.users` for the newly created account.

Before first public use, note that a database password was previously shared in chat. Rotate it in Supabase and update both local and hosting environment settings. If your repository is public, anyone can read its source; environment credentials remain private.
