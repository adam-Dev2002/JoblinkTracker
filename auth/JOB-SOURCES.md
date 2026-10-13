# Job sources and workspace API

## Live feeds

Every job source uses one application-owned card grid, one result count and one pagination control. **Show entries** offers 12, 24, 48 and All for every source, including Google. Feed matches appear first, followed by loaded Google matches; duplicate posting identities across sources appear once. Selection covers only displayed cards, and new cards brought forward after a removal are not selected automatically.

Individual and selected-job **Unavailable** actions share the circle-minus icon. **Deselect this page** appears only when every displayed job is selected and the selection contains at least two jobs. Single and partial selections keep the job checkboxes available without that extra button.

Marking jobs **Applied** or **Unavailable** repaginates the combined matches and fills gaps from later jobs. Google provider pages are retrieved only when the requested page needs more matching jobs; loaded results are reused for navigation. All entries loads the accessible provider pages. An emptied last page falls back to remaining jobs. **No results** appears once matching listings and accessible provider pages are exhausted. Failed or pending requests retain their error/loading state. Searches and filter changes reset the provider page pool.

The shared pager shows numbered Google pages as soon as the provider exposes its cursor, without fetching all pages first. Numbers account for unread provider capacity and the selected entry count, then shrink to the exact remaining matches after filtering and deduplication finish. While unread pages remain, the visible range omits a finalized total.

Cards are always rendered directly into the application grid, outside Google's DOM. Google's branding and promotions stay in its widget; native pagination is hidden and used only to retrieve results. This prevents late provider tables, empty wrappers, and spelling suggestions from creating grid cells or a second pager. Run `node auth/test-job-card-layout.mjs` for sparse rows, realistic provider wrappers, exact page sizes, deduplication, filters, sources and mobile layouts; run `node auth/test-job-page-refill.mjs` for status changes, later-page loading, failed requests, restoration and exhaustion.

The Node feed cache keeps up to 24 public feeds in memory, combines simultaneous reads of the same feed, and stores compressed payloads in the existing database cache. Database cache reads have a two-second limit, writes have a 1.5-second limit, and upstream feed requests have an eight-second limit. A database-cache outage falls back to the public provider. Fresh memory hits require no database request. Existing feed TTLs still apply.

The browser reuses successful search responses for five minutes, cancels superseded searches, and limits each search request to 15 seconds. Loaded result pages need no additional request. Initial loads and uncached searches show placeholders; matching cached searches restore their cards while refreshing. Third-party availability and sign-in/database latency can still affect cold page loads.

Job discovery excludes provider-reported closed, filled, inactive and expired listings, zero vacancies, explicit closure notices and elapsed application deadlines. Remotive's active feed retains its six-hour cache to respect the provider's request limits. Arbeitnow, Jobicy and JSearch discovery caches expire after five minutes; Jobicy IDs additionally require an `active` result from its [batch status endpoint](https://github.com/Jobicy/remote-jobs-api#batch-status-check), cached for one minute. Unknown Jobicy statuses are excluded without being classified as closed.

Google results are checked against their original HTTPS job-detail pages before cards appear, including restored previews. Expired JobPosting metadata, closure/filled notices, missing pages and disabled applications are rejected. A current matching JobPosting or active application control confirms an open listing. Blocked, timed-out and unverifiable pages remain unknown and are hidden with a retry message; they are never assumed open. Supported job-board URLs are checked again before Apply and bulk Save. Checks permit only the supported hosts and job-detail paths, validate redirects to the same job, limit response sizes and timeouts, and cache source-page status for one minute. The local PHP rollback invokes the same Node checker using the project's Node 24 runtime.

Open status reflects the source's published data rather than a guarantee of remaining capacity; employers can fill a role before updating their posting. Remotive also documents a [24-hour publication delay](https://github.com/remotive-com/remote-jobs-api). Availability is separate from the user's application tracker status; applied jobs remain hidden from discovery.

Explore jobs uses one keyword box with a search icon and Enter-to-search. Imported-feed searches match job titles, companies, categories and description skills. All words must match a listing; comma-separated groups are alternatives. **Google · job sites** uses Google's official Search Element through that same input. **All job listings** shows feed matches and Google job-site results together when searching. The classification dropdown filters feed categories and refines Google's query. [Google integration and setup guide](GOOGLE-JOB-SEARCH.md).

Searches with no matching listings show a single, larger **No results** message and hide selection and pagination controls. Google cards must contain the entered keyword words in their title or summary, and location words in their summary; related results that omit those words are excluded, including cached previews. The result count covers combined, deduplicated matches loaded for the search and updates when more Google results arrive. Google employment, date and classification filters refine its query; confirm those details on the original listing. Run `node auth/test-job-empty-search.mjs` against the local preview for isolated empty-search, cache, stale-response and result-count checks.


- **Remotive**: enabled without credentials at `/api/jobs/search`. Feed cached for six hours; source listings are delayed by 24 hours. Listing cards link back to Remotive with attribution. Users can browse listings without signing up. Location eligibility is supplied by the feed and should be checked on the original listing. [Provider documentation](https://github.com/remotive-com/remote-jobs-api)
- **All job listings**: combines cached Remotive, Arbeitnow and Jobicy results, deduplicates listing URLs and continues when one provider is unavailable.
- **Jobicy**: free remote jobs with employer logos and descriptions. Uses the public listing URL, retains source attribution and caches the first 100 listings for six hours. Direct ATS links require a separate commercial agreement; this connector sends no payment key. [Provider documentation](https://jobicy.com/jobs-rss-feed)
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

Joblink opens source listings or provider-supplied application links. Clicking Apply opens a new tab without creating or updating a tracker record. Use **Save** to bookmark a job or **Applied** to record a submitted application; Joblink does not automatically know whether an external application was submitted.

## Saved workspace

`GET /api/workspace/items` returns the signed-in user's records. `POST` creates/updates an entry, or deletes it with `{ "id": 123, "action": "delete" }`. Writes require the session's CSRF token in `X-CSRF-Token`, enforce origin checks and validate field lengths, URLs, statuses and dates. Updates and deletes always scope IDs to the signed-in owner.

Data lives in `workspace_items`: applications, tasks, events, links and sheet rows. Calendar dates and times use Manila time. CSV exports escape cell contents and guard against spreadsheet formula execution. Sheets are basic editable records, not a spreadsheet formula engine.

Applications and Sheet show 10 records per page by default, with Previous, numbered pages, Next and a visible range. Their top-left **Show entries** control offers 10, 25, 50, 100 and All. The header checkbox and **Select this page** toggle act only on the displayed rows; selections leaving the page or current filters are cleared. Choosing All permits deliberate selection of all filtered rows on one page. Entry-count choices restore from the account-scoped tab cache. Search/filter/sort and entry-count changes return to page 1; edits retain the current page and deletions clamp it to the last valid page. Changing a sheet page waits for queued cell saves. Selected CSV exports and bulk deletes include only the current selection; the separate Export CSV action still exports the entire workspace table.

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

News and job feeds run on a separate local PHP process at port 8082; account and workspace requests use port 8081. The preview uses `preview/local-api-proxy.mjs` for local PHP API forwarding. The deployed Supabase app uses native Node API routes and has no root-level routing middleware. The public home page is prerendered; returning users are checked after the page loads and sent to `/dashboard`. Protected pages and APIs remain uncached. Protected pages include an escaped, public session snapshot from their server authorization check, avoiding a duplicate browser session request. Forced checks still run on resume and cross-tab logout. The shared `shared/lib/client-session.ts` deduplicates reads and uses a short-lived sessionStorage profile preview for rendering only. Authorization is always checked server-side. Logout clears the preview and notifies other open tabs. Vercel functions run in Frankfurt (`fra1`) alongside the Supabase database. Landing and authentication pages use `preview/scss/public.scss`; hover/focus prefetching is enabled for selected navigation links.

## Applying and tracking

Application statuses share one color palette in the tracker, edit dialog, search suggestions and dashboard: Saved is gray, Application opened azure, Unavailable orange, Applied blue, Interview purple, Offer green, Rejected red and Ghosted amber. Status text remains visible and the controls retain native keyboard operation. Light and dark themes use contrasting text with tinted backgrounds.

Salaries retain the amount or range, disclosed currency and pay period. Feed normalization reads Remotive salary text, [Jobicy salary fields](https://github.com/Jobicy/remote-jobs-api), [JSearch salary fields](https://www.openwebninja.com/api/jsearch), and salary statements in job descriptions. Google summaries and structured result data can also supply pay. No currency or pay estimate is inferred when the employer has not disclosed it.

The cloud API can retrieve pay from supported original listing pages at `POST /api/jobs/salary` with `{ "urls": ["https://..."] }`. This is authenticated and CSRF protected, accepts at most 20 URLs, validates supported HTTPS hosts and job-detail paths, validates redirects to the same posting, limits response sizes and timeouts, and caches public salary results. JSON-LD JobPosting salaries take precedence over labeled page text. Unsupported, blocked and undisclosed sources leave the salary empty and do not prevent saving a job.

Explicit Save, Applied and Unavailable actions fetch missing salary before saving; opening a source link still does not create a record. Existing applications with blank salary fields refresh on the visible tracker page through `POST /api/workspace/salaries` with `{ "ids": [123] }`. Owner checks apply to every ID. Updates compare the stored payload atomically so concurrent edits and manually entered salaries win. Salary refreshes preserve notes and application status and update the account-scoped page cache.

Run `node auth/test-job-salary.mjs` for extraction and source request checks, `node auth/test-application-salaries.mjs` for fixture browser checks, and `node auth/test-application-salary-api.mjs` for temporary-account cloud persistence, CSRF, ownership and concurrent-edit checks. The API test cleans up its temporary accounts afterward.

Find Work displays provider-supplied employer logos, with initials when a logo is missing or fails to load. Keyword search, location, employment type, and listing time narrow the results. Remote-work tags are not a guarantee of worldwide eligibility.

The Apply button opens a new tab without saving an application. When the provider supplies a verified direct application URL, the tab opens that employer page; otherwise the button says **Apply via source** and opens the original job-board listing. The same behavior applies to the job details dialog. Joblink does not invent employer application URLs.

Cross-site submission cannot be observed by Joblink. After submitting on the external website, use the **Applied** button on the job card or set its tracker status to **Applied**. Use **Save** to bookmark a job with the **Saved** status. Repeated Apply clicks leave the tracker unchanged, including existing statuses and notes. Existing **Application opened** records remain editable in the tracker.

## Company branding

`company-brands.json` records verified company websites and icon provenance. `refresh-company-logos.mjs` finds raster brand icons from those websites and saves them under `shared/static/company-logos/`. The current feed uses these local icons before the provider URLs, which were returning HTTP 403. Unknown brands retain the provider image or initials. CodeForAI could not be confidently matched to an official brand, so no unrelated logo was assigned.

For automatic discovery of new brands, add `brandfetch_client_id` to `config.local.php`. The optional Brandfetch search integration caches exact company-name matches for seven days. An empty client ID makes no Brandfetch requests. [Provider setup](https://docs.brandfetch.com/reference/brand-search-api). The lookup has not been tested with live credentials.
