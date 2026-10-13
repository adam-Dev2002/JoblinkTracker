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

Workspace actions use **Remove** and **Remove selected** consistently. A shared success dialog appears after the server confirms a removal, including attached-file cleanup. Cancelled or failed requests never show success; partially completed batches keep the remaining selection available for retry. Table selection and column visibility update existing rows without rebuilding them, unchanged data avoids repeated cache writes, and job cards use an indexed application lookup. Run `node auth/test-workspace-removal.mjs` against the local preview for isolated browser checks, and `node jobfinder/node_modules/tsx/dist/cli.mjs auth/test-application-index.mjs` for lookup correctness and repeated-access checks.

Every job card also offers **Mark unavailable** for closed or completed postings. The selection toolbar offers **Mark selected unavailable** for multiple postings on the current page. Successful saves hide those cards; failed saves remain selected for retry. This saves an account-specific **Unavailable** tracker status and hides the listing from feeds, Google results, cached previews, and selection counts. It never counts as a submitted application. Change the tracker status to **Saved** to restore the listing. Run `node auth/test-job-unavailable.mjs` against the local preview to verify persistence, restoration, failed-save retries, keyboard/mobile controls, and account isolation using temporary accounts that are cleaned up afterward. Run `node auth/test-job-bulk-unavailable.mjs` for isolated bulk-action and small-screen toolbar checks.

Supported browsers also prepare workspace navigation destinations as users approach links, so a ready page can appear immediately on click. Preparation runs only for signed-in users on eligible connections, retains normal server authorization, and is discarded after edits or sign-out. Pending job dialogs wait until the user actually visits the page. Other browsers keep normal Astro prefetch and cached data. First visits, expired previews, and pages that are not ready can still need loading time. Run `node auth/test-navigation-preparation.mjs` to verify actual browser activation with a delayed local API, fallback navigation, selection, and invalidation without writing to the database.

Applications and Sheet bulk deletion send their record type and validate every selected ID against the signed-in owner before removing files or rows. The cloud API deletes each batch in one database statement, so this works with older installed workspace SQL helpers. After backend changes, verify the running preview and restart it if it still serves old behavior. Run `node auth/test-workspace-bulk-delete.mjs` against the cloud preview to check actual deletion, reload persistence, attachment cleanup and account isolation using temporary accounts that are removed afterward.

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
