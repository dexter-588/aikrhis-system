# Deploying Aikrhis on Vercel

This project runs on Vercel's default address, such as `https://aikrhis-system.vercel.app`. No custom domain is required.

## Project settings

1. In Vercel, create a **New Project** and import `dexter-588/aikrhis-system`.
2. Keep the defaults: framework **Other**, build command `npm run build` only if Vercel suggests one (this project does not require a build), and output directory blank.
3. Add the environment variables below for **Production**, **Preview**, and **Development**.
4. Deploy.

## Environment variables

| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `SECURITY_STORAGE` | `postgres` |
| `DATABASE_URL` | Supabase **Transaction pooler** PostgreSQL URI (port `6543`) |
| `PGSSLROOTCERT` | `./supabase-ca.crt` |
| `PGPOOL_MAX` | `1` |
| `MAIL_MODE` | `smtp` |
| `SMTP_HOST` | Your SMTP host |
| `SMTP_PORT` | Your SMTP port |
| `SMTP_USER` | Your SMTP username |
| `SMTP_PASSWORD` | Your SMTP password or app password |
| `MAIL_FROM` | Verified sender, for example `Aikrhis <noreply@your-email-domain>` |

Vercel automatically provides `VERCEL_URL`, which Aikrhis uses for secure cookies and email links. After the first production deployment, add `PUBLIC_ORIGIN` with the exact production `https://...vercel.app` URL and redeploy.

Use the Supabase **Transaction pooler** for Vercel. A serverless deployment can create several short-lived function instances, so this project uses one PostgreSQL connection for each warm instance.

## Before going live

- Regenerate the Supabase database password because it was shared during setup, then update `DATABASE_URL` in Vercel.
- Do not copy `.env` to GitHub or Vercel as a file; add its values through Vercel's encrypted Environment Variables screen.
- Open `/health` after deployment. It should return `{ "status": "ok" }`.
