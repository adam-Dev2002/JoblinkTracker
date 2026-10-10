# JoblinkTracker

Job discovery and personal workspace using Bootstrap/Tabler, Astro, a Node API and Supabase. The original PHP/MySQL backend remains available for local rollback.

See [Vercel deployment setup](DEPLOYMENT.md) and [database migration](migration/README.md). Private credentials and database backups are excluded from Git.

## Run locally

With the private cloud environment configured, the launcher uses Supabase. The legacy PHP mode requires MySQL in XAMPP. From this folder, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-preview.ps1
```

Open http://localhost:3000/job-listing. Signup: `/sign-up`. Login: `/sign-in`. Account settings: `/settings`. The old `/account` route redirects to settings.

After pulling database changes, apply the non-destructive schema updates:

```powershell
C:\xampp\php\php.exe auth\init-db.php
```

## Workspace

Open `/` for the dashboard, `/job-listing` for Find work, `/applications` for the tracker, `/news` for career reading and events, and `/desk/taskboard`, `/desk/calendar`, `/desk/links`, `/desk/sheet` for daily tools. Account settings are at `/settings`.

See [job source setup and API mapping](auth/JOB-SOURCES.md) for live feed details, Philippine search configuration and workspace storage.

## Folder map

| Location                                                     | Purpose                                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `start-preview.ps1`                                          | Starts the PHP auth service and Astro preview                              |
| `auth/config.local.php`                                      | Private database and Google credentials; ignored by Git                    |
| `auth/config.example.php`                                    | Configuration template without credentials                                 |
| `auth/bootstrap.php`                                         | Configuration validation, database connection, profile and session helpers |
| `auth/router.php`                                            | Signup, login, logout, Google authorization and callback endpoints         |
| `auth/init-db.php`                                           | Creates tables and applies additive schema changes                         |
| `auth/test-auth.mjs`, `auth/test-account.php`                | Browser authentication checks and generated test account cleanup           |
| `auth/runtime/`                                              | Generated sessions and test screenshots; ignored by Git                    |
| `auth/README.md`                                             | Database and Google setup instructions                                     |
| `tabler-dev/tabler-dev/preview/pages/`                       | Website routes, including jobs and account pages                           |
| `tabler-dev/tabler-dev/preview/components/JoblinkAuth.astro` | Signup and login interface                                                 |
| `tabler-dev/tabler-dev/preview/middleware.ts`                | Forwards local authentication requests to PHP                              |
| `tabler-dev/tabler-dev/shared/components/UserAvatar.astro`   | Google photo and default initials/icon rendering                           |
| `tabler-dev/tabler-dev/shared/components/navbar/`            | Joblink logo and account header                                            |
| `tabler-dev/tabler-dev/shared/static/`                       | Images, icons and Joblink favicon                                          |
| `tabler-dev/tabler-dev/shared/lib/site.ts`                   | Site name and descriptions                                                 |
| `tabler-dev/tabler-dev/core/`                                | Template styles, JavaScript and bundled assets                             |
| `.local-tools/`                                              | Portable Node.js, pnpm and dependency cache needed for local development   |

The remaining template demos, docs and source files belong to the original UI kit. Shared components reference its assets and data, so they are retained. Generated dependency folders, built assets and local credentials should not be edited as app source.

Google profile photos are refreshed when the user signs in with Google. Older Google accounts need one fresh Google sign-in to obtain a photo. Email accounts use initials; failed or missing photos fall back to the same default avatar. The API accepts Google-hosted HTTPS photo URLs only.

## AI assistant

The bottom-right Joblink assistant has a server-side Gemini/OpenAI connector. [Setup and privacy details](auth/ASSISTANT.md). It remains in setup mode until an API key is supplied.
