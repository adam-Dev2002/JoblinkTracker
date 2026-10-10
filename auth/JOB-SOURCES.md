# Job sources and workspace API

## Live feeds

The feed selector shows free imported sources and JSearch only when its server key is configured. External site searches appear separately.

- **Remotive**: enabled without credentials at `/api/jobs/search`. Feed cached for six hours; source listings are delayed by 24 hours. Listing cards link back to Remotive with attribution. Users can browse listings without signing up. Location eligibility is supplied by the feed and should be checked on the original listing. [Provider documentation](https://github.com/remotive-com/remote-jobs-api)
- **Arbeitnow**: free, no API key, at `/api/jobs/search?source=arbeitnow`. The first provider page is cached for six hours; Joblink displays up to 100 matches. Includes full descriptions, company names, location and remote flags, with links back to Arbeitnow. Coverage is mostly Europe; remote roles may still have country and language restrictions. [Provider documentation](https://www.arbeitnow.com/blog/job-board-api)
- **JSearch**: optional Philippine search connector at `/api/jobs/search?source=jsearch&q=virtual+assistant`. It searches Google for Jobs data with `country=ph`; publisher coverage varies. Results are cached for one hour and require a signed-in Joblink user. [Provider documentation](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch)
- **Career reading**: `/api/jobs/news` uses DEV Community public career/remote-work/productivity articles. `/api/jobs/article?id=...` retrieves provider-supplied article text for the in-page reader. Covers, author attribution, source links, one-hour list caching and one-day article caching are retained. Reader HTML is rendered through a tag and URL allowlist. [API documentation](https://developers.forem.com/api/v1)

Joblink classifies roles with title keyword rules in `jobfinder/preview/server/jobs.mjs` and the legacy `auth/jobs.php`. These are editable heuristic labels, not an AI assessment of a candidate or a guarantee of job suitability.

## Configure Philippine searches

Register for JSearch through RapidAPI and select a plan yourself. Joblink does not purchase a subscription or create a provider account. Add this key inside the existing returned array in `auth/config.local.php`:

```php
'jsearch_api_key' => 'YOUR_RAPIDAPI_KEY',
```

Keep Google credentials and database settings as they are. Save, then select **Philippines · JSearch** in Find work. An empty key returns an explicit unconnected state. API errors return a readable error; they never generate mock jobs. API secrets remain server-side.

Indeed, JobStreet PH, OnlineJobs.ph, LinkedIn and the VA-agency cards are **official-site links**, not connected scanners. Indeed's documented APIs are partner-oriented, and SEEK's documented integrations focus on hiring workflows. Their presence in the directory does not imply import access. JSearch may return their public indexed listings, but coverage is not guaranteed. [Indeed documentation](https://docs.indeed.com/), [SEEK documentation](https://developer.seek.com/).

Google job search is a plain browser link using the entered role and location. It needs no API key and does not import Google results into Joblink. The Google Custom Search JSON API is closed to new customers, so it is not used. [Google documentation](https://developers.google.com/custom-search/v1/overview)

Joblink opens source listings or provider-supplied application links. Clicking Apply creates or updates an **Application opened** record. The user confirms submission to mark it **Applied**; Joblink does not automatically know whether an external application was submitted. External search cards open websites and do not create individual job records.

## Saved workspace

`GET /api/workspace/items` returns the signed-in user's records. `POST` creates/updates an entry, or deletes it with `{ "id": 123, "action": "delete" }`. Writes require the session's CSRF token in `X-CSRF-Token`, enforce origin checks and validate field lengths, URLs, statuses and dates. Updates and deletes always scope IDs to the signed-in owner.

Data lives in `workspace_items`: applications, tasks, events, links and sheet rows. Calendar dates and times use Manila time. CSV exports escape cell contents and guard against spreadsheet formula execution. Sheets are basic editable records, not a spreadsheet formula engine.

## Main files

| File                                     | Role                                                       |
| ---------------------------------------- | ---------------------------------------------------------- |
| `auth/jobs.php`                          | Cached feeds, source normalization and role classification |
| `auth/workspace.php`                     | Authenticated workspace CRUD and validation                |
| `auth/init-db.php`                       | Additive database schema setup                             |
| `preview/components/workspace/WorkspacePage.astro` | Dashboard, Find work, tracker and desk views               |
| `preview/scripts/workspace.ts`           | Forms, filters, calendar, persistence and CSV              |
| `shared/layouts/DefaultLayout.astro`     | Consistent sidebar and app header                          |
| `auth/test-workspace.mjs`                | Browser checks, including ownership and mobile behavior    |

Frontend paths above are relative to `jobfinder/`.

Run browser checks from the project root:

```powershell
.\.local-tools\node-v24.21.0-win-x64\node.exe auth\test-workspace.mjs
```

Both local servers and XAMPP MySQL must be running. Tests create their own accounts and delete them afterward; screenshots go in `auth/runtime/`.

News and job feeds run on a separate local PHP process at port 8082; account and workspace requests use port 8081. The preview uses `preview/local-api-proxy.mjs` for fast local API forwarding, with Astro middleware retained as a fallback. The shared `shared/lib/client-session.ts` deduplicates session reads and uses a short-lived sessionStorage profile preview for rendering only. Authorization is always checked server-side. Logout clears the preview and notifies other open tabs.

## Applying and tracking

Find Work displays provider-supplied employer logos, with initials when a logo is missing or fails to load. Place, role, WFH, and Philippines/worldwide eligibility filters narrow the loaded results; WFH is not a guarantee of worldwide eligibility.

The Apply button saves an account-owned entry as **Application opened** before opening a new tab. When the provider supplies a verified direct application URL, the tab opens that employer page; otherwise the button says **Apply via source** and opens the original job-board listing. Joblink does not invent employer application URLs.

Cross-site submission cannot be observed by Joblink. After submitting on the external website, use **I submitted it** on Find Work or the tracker to mark the entry **Applied**. Opening a page alone does not count as a submitted application. Saved jobs have their own **Saved** status. Repeated Apply clicks reuse the existing record and preserve later statuses.

## Company branding

`company-brands.json` records verified company websites and icon provenance. `refresh-company-logos.mjs` finds raster brand icons from those websites and saves them under `shared/static/company-logos/`. The current feed uses these local icons before the provider URLs, which were returning HTTP 403. Unknown brands retain the provider image or initials. CodeForAI could not be confidently matched to an official brand, so no unrelated logo was assigned.

For automatic discovery of new brands, add `brandfetch_client_id` to `config.local.php`. The optional Brandfetch search integration caches exact company-name matches for seven days. An empty client ID makes no Brandfetch requests. [Provider setup](https://docs.brandfetch.com/reference/brand-search-api). The lookup has not been tested with live credentials.

Indeed PH, JobStreet PH, OnlineJobs.ph and LinkedIn now appear in the Search feed selector. Without JSearch credentials they return an official search link, not imported records. With credentials, the connector searches JSearch using the publisher name and filters returned publishers; coverage depends on that provider. Live publisher imports have not been tested without credentials.
