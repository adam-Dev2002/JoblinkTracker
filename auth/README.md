# Joblink local authentication

Uses XAMPP PHP 8.2 and MySQL/MariaDB. Start MySQL in XAMPP first.

Initialize the database once:

```powershell
C:\xampp\php\php.exe auth\init-db.php
```

Run from the project root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-preview.ps1
```

Open http://localhost:3000/sign-up or http://localhost:3000/sign-in. The Astro preview proxies `/api/auth` to a PHP service bound to `127.0.0.1:8081`. The database contains user profiles, password hashes, Google identity IDs, and rate-limit counters. PHP sessions use HttpOnly, SameSite cookies and expire after two hours of inactivity. Accounts registered by email are not marked email-verified.

## Google configuration

Create a Google OAuth client of type **Web application**, configure the consent screen for `openid email profile`, and add this exact authorized redirect URI:

`http://localhost:3000/api/auth/google/callback`

If the Google project is in testing mode, add your Google account as a test user.

Copy `config.example.php` to `config.local.php` and fill in `google_client_id` and `google_client_secret`. Keep the secret in that local file, never in frontend code. The local configuration is ignored by Git and the PHP router does not serve files from disk. Reload the login page after configuring credentials.

Google uses a server-side authorization code flow with state, PKCE, and identity fetched from Google's HTTPS UserInfo endpoint. An existing email/password account is never silently linked to Google by matching email.

The default local database credentials are XAMPP's `root` user with an empty password. Override them in `config.local.php` if your MySQL setup differs. Use `localhost:3000` consistently; cookies for `127.0.0.1` and `localhost` are separate.

Before public hosting, configure HTTPS (`cookie_secure: true`), a dedicated database user, production OAuth callback URLs, email verification and password recovery. This local preview does not yet send verification or reset emails, or save jobs/preferences.

Successful signup and sign-in go directly to /job-listing. Use the account icon in the header to open /settings. Display names can be edited there; email accounts can change their password after confirming the current password. Google accounts manage their password and photo through Google. The sign-in email is read-only.

