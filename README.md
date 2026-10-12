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

Workspace pages restore the last loaded data from an account-scoped, five-minute tab cache, then refresh in the background. Successful edits update that cache; an older refresh cannot overwrite a newer edit. Job filters, feed pages, Google result previews, and news stories also survive navigation. Signing out or changing accounts clears the previews. The cache never supplies authentication or CSRF tokens.

First visits show shared placeholders rather than zero counts or empty tables. Failed refreshes retain existing content and offer retry controls. Settings and account menus use the server-verified profile on their first render. Sidebar links use [Astro prefetch](https://docs.astro.build/en/guides/prefetch/) for HTML/assets and warm job/news feeds on hover or keyboard focus. Run `node auth/test-page-loading.mjs` against the local preview to verify delayed responses, navigation, refresh failures, edits, and account isolation without writing to the database.

See [job source setup and API mapping](auth/JOB-SOURCES.md) for live feed details, Philippine search configuration and workspace storage.

## Folder map

| Folder | Purpose |
| --- | --- |
| `jobfinder/preview/` | Main app: pages, components, scripts and Vercel configuration |
| `jobfinder/preview/server/` | Node API for login, workspace, jobs, news and assistant |
| `jobfinder/shared/` | Shared layouts, UI components, logos and images |
| `jobfinder/core/` | Bootstrap/Tabler styles and JavaScript |
| `migration/` | Supabase schema, runtime SQL and data migration tools |
| `auth/` | Original PHP/MySQL backend for local rollback |
| `.local-tools/` | Local development tools; excluded from Git |
| `.migration-data/` | Private database backups; excluded from Git |

Start the app with `start-preview.ps1`. Deploy the folder `jobfinder/preview` to Vercel. The private cloud environment lives at `jobfinder/preview/.env`.

Main pages are grouped inside `jobfinder/preview/pages/`. UI components are grouped by feature, and unused demo pages are in `jobfinder/preview/template-examples/`. See [the application folder guide](jobfinder/preview/README.md) for the page-to-folder map.

Google profile photos are refreshed when the user signs in with Google. Older Google accounts need one fresh Google sign-in to obtain a photo. Email accounts use initials; failed or missing photos fall back to the same default avatar. The API accepts Google-hosted HTTPS photo URLs only.

## AI assistant

The bottom-right Joblink assistant has a server-side Gemini/OpenAI connector. [Setup and privacy details](auth/ASSISTANT.md). It remains in setup mode until an API key is supplied.
