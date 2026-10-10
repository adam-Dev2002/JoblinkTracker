# Joblink migration: Vercel + Supabase

This migration preserves the existing accounts, password hashes, Google identity IDs, workspace records, attachment metadata and file bytes. Local PHP/MySQL remains running until the cloud replacement is tested. Creating Supabase does not complete the Node API migration or make the app ready to deploy.

## 1. Create the Supabase project

1. Sign in at https://supabase.com/dashboard and create a **New project**.
2. Name it `joblink`. Select the free plan if suitable for your usage.
3. Choose a nearby available region, such as Singapore.
4. Generate a strong database password and save it in your password manager.
5. Wait for provisioning to finish.

Get the project URL from **Connect**. Get a server **secret key** (`sb_secret_...`) from **Settings → API Keys**. This migration uses a server-only key, never a browser key. Do not put this key in frontend code or commit it.

Copy `migration/.env.example` to `migration/.env`. Set only `SUPABASE_URL` and `SUPABASE_SECRET_KEY` initially. Keep Google/Gemini keys private; we will copy their configuration into server environment variables during the API cutover.

## 2. Prepare cloud tables

On a new project, open **SQL Editor**, paste the entire `migration/supabase-schema.sql` file, and run it. It creates PostgreSQL equivalents with browser access disabled and server-only import functions. It does not upload your local data.

This approach preserves your custom login accounts in `public.users`; it does not create accounts in Supabase Auth's `auth.users`. The cloud Node backend must enforce account ownership before using the secret key. Existing bcrypt password hashes will need compatible verification in the Node login implementation.

## 3. Export local data

Keep XAMPP MySQL running. From the project root:

```powershell
C:\xampp\php\php.exe migration\export-local.php
```

Exports are private under `.migration-data/<timestamp>/snapshot.json`, with attachment bytes in `files/`. The folder is ignored by Git. Password hashes and Google identity IDs are sensitive: do not share or upload the snapshot to public hosting. Source rows and files are not modified. Any missing attachment aborts the export.

A snapshot has already been prepared if the assistant reported export counts. Make a fresh final export while users are not editing data immediately before cutover.

## 4. Review and import

Install the migration tool's dependencies in `migration/`, then run a dry run from that folder:

```powershell
node --env-file=.env import-supabase.mjs ..\.migration-data\TIMESTAMP\snapshot.json
```

Review the project and counts. The tool refuses to overwrite nonempty cloud tables and checks every file's SHA-256 hash. Once ready:

```powershell
node --env-file=.env import-supabase.mjs ..\.migration-data\TIMESTAMP\snapshot.json --apply
```

Files go into the private `joblink-attachments` bucket. Database records are imported atomically; identity counters are advanced beyond preserved IDs. Failed imports attempt to remove only the files they just uploaded. Stop and inspect any rollback error before retrying.

## 5. Finish the Node API conversion

The Node API is now implemented under `tabler-dev/tabler-dev/preview/server/`, with an Astro catch-all API route. Set `JOBLINK_BACKEND=supabase` to select it; the PHP proxies are bypassed in this mode. A private `preview/.env` has been prepared for local cloud testing. `start-preview.ps1` detects this mode and starts Node without starting PHP.

Run `migration/cloud-runtime.sql` after the initial schema. It adds persistent feed caching, rate limiting and atomic workspace writes. It preserves imported records.

Verified during cutover: all 2 imported accounts and the 1 workspace record match the export, and cloud registration, sessions, custom task statuses, status deletion with task remapping, persistent task deletion and logout passed using a temporary account that was subsequently removed. The browser-facing cloud session API and task board return HTTP 200. Existing account sign-in, interactive Google login, attachments, assistant calls and a production build/deployment still require verification. Sign in again after switching backends; local PHP sessions do not transfer.

Before deployment, replace PHP endpoints with Node equivalents for:

- Email/password and Google login, account settings, logout
- Persistent sessions and OAuth state (no local PHP session files)
- Workspace CRUD, custom task statuses, bulk deletion and attachment deletion
- Private Storage uploads and authenticated downloads
- Job/news feeds and persistent feed cache
- Gemini account context, rate limiting and local fallback

Keep the existing `/api/...` URLs so the frontend remains compatible. The local port proxies (8081/8082/8083) must not be used by the deployed app. Native Astro/Vercel server routes require the Vercel adapter and the existing template-specific `vercel.json` needs updating. Merely switching database credentials will not achieve this.

## 6. Configure Vercel and Google

Use server environment variables, not `config.local.php`. Set the production `APP_URL` to your deployment domain, and add that domain's `/api/auth/google/callback` URL to your Google OAuth client when preserving the current login flow. Use secure cookies in production. Do not remove the working localhost callback until cloud testing finishes.

Do not expose the Supabase secret key with `PUBLIC_` or `VITE_` prefixes. Uploaded files must stay in a private bucket; downloads check the signed-in owner.

## 7. Verify before turning off XAMPP

Validate existing email/password login, Google login, photos, record counts, attachment downloads, CRUD and bulk deletion, custom statuses, cross-account access protection and assistant summaries. Test a restart and fresh login. Only after the deployed APIs and cloud data are verified can XAMPP be turned off.

Official references: [Supabase keys](https://supabase.com/docs/guides/getting-started/api-keys), [MySQL migration](https://supabase.com/docs/guides/platform/migrating-to-supabase/mysql), [private Storage](https://supabase.com/docs/guides/storage/buckets/fundamentals), [Astro on Vercel](https://vercel.com/docs/frameworks/frontend/astro).
