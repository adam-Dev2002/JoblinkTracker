# JoblinkTracker deployment

GitHub stores source code. Vercel runs the Astro site and Node API. Supabase stores account records, workspace data and private attachments. Supabase does not need to be deployed through GitHub.

## Import into Vercel

Import `adam-Dev2002/JoblinkTracker` and choose these settings:

- Framework: Astro
- Root Directory: `tabler-dev/tabler-dev/preview`
- Enable access to source files outside the Root Directory.
- Node.js: 24.x
- Install Command: `cd .. && pnpm install --frozen-lockfile --config.symlink=true --config.store-dir=/tmp/joblink-pnpm-store`
- Build Command: `pnpm --dir ../core build && pnpm build`
- Output Directory: leave the Astro default; the Vercel adapter generates the server deployment.

The install override enables workspace links on Linux and avoids the local Windows cache path. The core build produces the Bootstrap/Tabler assets before the website build.

## Server environment variables

Add values from the private `tabler-dev/tabler-dev/preview/.env` using Vercel's Environment Variables interface. Do not commit that file.

Required: `JOBLINK_BACKEND=supabase`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SESSION_SECRET`, `APP_URL`.

Set `APP_URL` to the final HTTPS website origin, without a trailing slash. Keep `SESSION_SECRET` stable between deployments. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` for Google sign-in. Set `ASSISTANT_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, and `GEMINI_ACCOUNT_CONTEXT` for the assistant. `JSEARCH_API_KEY` is optional for additional imported job feeds.

Never prefix server secrets with `PUBLIC_` or `VITE_`.

## Google and verification

Add `https://YOUR-DOMAIN/api/auth/google/callback` to the Google OAuth client's authorized redirect URIs. Preserve the localhost callback while testing locally.

After deployment, verify existing email login, Google login, saved records, attachment uploads/downloads/deletion and assistant account summaries. A production build and live deployment must pass before retiring XAMPP. The cloud import is complete, but publishing source code alone does not verify production hosting.

Reference: [Astro on Vercel](https://vercel.com/docs/frameworks/frontend/astro).
