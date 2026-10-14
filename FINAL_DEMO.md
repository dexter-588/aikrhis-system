# Information Assurance and Security 1 — final demonstration

## Requirement coverage

| Requirement | Implementation | Demonstration evidence |
| --- | --- | --- |
| Authentication and access control | Scrypt password hashes, HTTP-only session cookies, CSRF and origin checks, server-side user/admin role checks | A user gets 403 for admin APIs; an admin gets 403 for the user cipher API |
| Activity logs | `activities` records login, logout, cipher transactions, failed access, rate limits and report exports | Admin Dashboard → Recent activity; Audit reports → User activities |
| User account logs | `account_logs` records signup, profile/password changes, role changes, activation/deactivation, locks and unlocks | Audit reports → Account changes |
| AI security monitoring | Seeded Isolation Forest with 96 trees, trained on 640 synthetic baseline samples | AI monitoring shows score, threshold, observed features and model training source |
| Unauthorized access prevention | Five failed logins cause a 15-minute lock and session revocation; verified email is required for ciphers; rate limits and temporary ML-based cipher restrictions | Lockout account cannot sign in even with its correct password; suspicious account receives HTTP 429 for ciphers |
| Security alerts | Persisted administrator alerts, live notification banner and sidebar badge; acknowledge/resolve controls | Alerts refresh every 15 seconds while the page is visible |
| Dashboard and reports | Live summary cards, recent activity, account management, filtered/paginated reports and CSV export | Admin sidebar → Dashboard / Audit reports / Security alerts |
| Existing cryptography | Caesar, Playfair, Vigenere and Bifid encryption/decryption remain available to users | Cipher round-trip tests plus the normal-user demonstration |

Accounts are stored in Supabase `public.users`; sessions, activity/account/security logs, alerts and settings are in `aikrhis_private.records`, distinguished by `collection`. The application writes records through its backend; Supabase public client roles cannot read account data directly.

## Run all four scenarios automatically

From `mongodb-project`:

```powershell
npm.cmd run demo:security
```

This uses an isolated in-memory database and real HTTP endpoints, session handling, password hashing and the actual ML model. It prints four PASS results and saves `data/security-demo-report.json`. No live Supabase accounts or data are modified. The report includes the actual anomaly score, threshold, features and summary counts; it excludes credentials, session tokens and message content.

## Open the presentation dashboard

```powershell
npm.cmd run demo:start
```

Open **http://localhost:3001**. The demo prepares the four scenarios before leaving the server running, so the administrator can show the resulting logs, locks, alerts and model assessments. It uses in-memory data that resets when restarted. The normal Supabase app on port 3000 stays separate.

| Demonstration account | Email | Purpose |
| --- | --- | --- |
| Administrator | `admin@demo.example` | Review Dashboard, Users, Alerts, Audit reports and AI monitoring |
| Normal user | `normal@demo.example` | Show the cipher workspace and normal activity |
| Lockout user | `lockout@demo.example` | Already locked by five wrong passwords; use Admin → User accounts → Unlock before repeating the scenario |
| Suspicious user | `suspicious@demo.example` | Produced a mixed anomaly and a one-minute cipher restriction |

All isolated demonstration accounts use **`Classroom demo passphrase 42!`**. These are test credentials for this local demo only. The demo seeds email verification locally; normal app signup still requires email verification.

1. **Demonstrate authentication/access control.** Log in as the normal user and show the cipher dashboard. Log in as admin in another browser profile and show the sidebar. The automated scenario confirms that users cannot access administrator APIs and administrators cannot run user ciphers.
2. **Normal user activity.** Encrypt and decrypt a message, update the profile and log out. Show the resulting activity and account logs. Messages, cipher keys and passwords are excluded from audit records.
3. **Repeated failed access — five attempts.** Unlock the lockout user in the admin dashboard. Attempt to log in five times with an incorrect password. On the fifth attempt the account locks for 15 minutes and existing sessions are revoked. Show the lock in User accounts, the `account_locked` event, and the high-severity alert. Admin Unlock permits the user to sign in again.
4. **Suspicious activity detected by AI.** In the prepared demo, the suspicious account made three failed logins, two denied requests to admin APIs, and repeated profile changes. Show its `ai_anomaly` and `ai_restriction` assessments under AI monitoring and its alerts under Security alerts. The next cipher request is denied with HTTP 429 and a Retry-After header while its one-minute restriction is active.

Restrictions use a one-minute pause and a 15-minute cooldown so the same historical events do not repeatedly pause normal use. Administrator review remains available. Alerts and audit history persist after temporary restrictions expire. Admin Unlock clears both login locks and cipher restrictions and revokes existing sessions.

## Model limitations

The model is trained on a synthetic classroom baseline and has not been validated against real-world attacks. It scores four counts: failed logins and denied access in 15 minutes, cipher requests in one minute, and account changes in 15 minutes. Alerts include the observed counts and model version. A score above the calibrated threshold is evidence of an unusual pattern, not proof of an attack. Temporary prevention also requires repeated security events or rapid account changes. Separate five-attempt locks and rate limits do not depend on the ML score.

Security logging reference: [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).

## Validation

```powershell
npm.cmd test
```

Tests cover authentication, email verification/recovery, roles, logs and lifecycle changes, five-attempt lockout, expiry and admin unlock, actual-model detection/prevention, private PostgreSQL storage/migration and cipher vectors.
