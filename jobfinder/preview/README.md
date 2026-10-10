# Joblink application folders

| Folder | What to edit here |
| --- | --- |
| pages/ | Website URLs; each page folder contains index.astro |
| pages/job-listing/ | Find work page at /job-listing |
| pages/applications/ | Application tracker at /applications |
| pages/news/ | News and events at /news |
| pages/settings/ | Profile settings at /settings |
| pages/sign-in/, pages/sign-up/ | Login and registration |
| pages/desk/ | Task board, calendar, links and sheet; selected by [tool].astro |
| pages/api/ | Astro entry point for /api endpoints |
| components/auth/ | Login and registration UI |
| components/news/ | News cards and reader UI |
| components/workspace/ | Dashboard, jobs, tracker and desk UI |
| scripts/ | Browser behavior for jobs, news and workspace tools |
| server/ | Node backend: authentication, database, jobs and assistant |
| template-examples/ | Original UI-kit examples, kept outside the app routes |

The dashboard is pages/index.astro. Shared layouts and navigation are in ../shared/, and Bootstrap/Tabler styles are in ../core/.

Private server settings are in .env; copy .env.example when configuring another environment. Deployment instructions are in ../../DEPLOYMENT.md.
