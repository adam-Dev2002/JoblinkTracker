# Google job-site search inside Joblink

The current engine `a0303a067c89c4c3d` is configured in `jobfinder/shared/lib/site.ts`. Its public ID ships with the app, so no additional Vercel variable is required to activate this engine. `GOOGLE_SEARCH_ENGINE_ID` can override it when switching engines.

1. Open https://programmablesearchengine.google.com/ and create a search engine called Joblink Jobs.
2. Add job sites, one per entry: ph.indeed.com, ph.jobstreet.com, www.onlinejobs.ph, and www.linkedin.com/jobs/. Add employer career sites as needed.
3. Choose web search results and create the engine. New engines search selected sites; they do not provide unrestricted whole-web search.
4. In the engine's Overview page, copy Search engine ID (cx). This identifier is public; do not copy a Google Cloud API key.
5. Add GOOGLE_SEARCH_ENGINE_ID=YOUR_ENGINE_ID to the private jobfinder/preview/.env, then restart the local preview.
6. Add the same variable in Vercel Environment Variables and redeploy the latest main commit.

The Google button uses the role and location inputs. With the ID configured it loads Google's search-results element inside Joblink; otherwise it opens normal Google search in a new tab. Search results link to the job websites, and individual jobs can be added manually to the application tracker. The free API feeds continue providing descriptions and tracked Apply actions inside Joblink.

The search element requires JavaScript and may be blocked by browser privacy extensions. Google's indexing and each site's public content determine coverage. This is separate from the Custom Search JSON API, which is closed to new customers.

References: https://support.google.com/programmable-search/answer/12495704 and https://support.google.com/programmable-search/answer/12465937
