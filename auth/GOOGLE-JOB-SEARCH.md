# Google-powered job search

Joblink now uses the existing keyword box for Google job-site searches. Choose **Google · job sites** to search only Google, or **All job listings** to search the imported feeds and Google together. Google loads when you search, so opening Explore jobs does not wait for Google.

This integration uses Google's official **Programmable Search Element**, with custom result cards through its documented results-ready callback. Google's attribution, ads, and result pagination remain in the Search Element. It does not scrape Google's results pages or use the Custom Search JSON API, which is closed to new customers. [Search Element documentation](https://developers.google.com/custom-search/docs/element), [JSON API availability](https://developers.google.com/custom-search/v1/overview).

The widget uses `webSearchResultSetSize: 'filtered_cse'`, requesting up to 10 results per page across 10 pages. A blank keyword searches the supported job-detail URL scope directly; it does not add the generic word `jobs`, which can favor directory pages that the listing filter excludes. Google determines the available matches, so narrow searches may return fewer listings or pages.

## Configure the search engine

Your project already has a Search Engine ID configured. To manage which sites it searches, sign in to the [Programmable Search Engine control panel](https://programmablesearchengine.google.com/controlpanel/all) with the Google account that owns that engine. If it is not listed in your account, create your own engine and use its ID below.

1. Select the engine, or choose **Add** to create one named **Joblink job listings**.
2. Under **Overview → Sites to search**, add these job-detail URL patterns, one per line:

   ```text
   www.onlinejobs.ph/jobseekers/job/*
   www.linkedin.com/jobs/view/*
   ph.jobstreet.com/job/*
   www.jobstreet.com.ph/job/*
   *.indeed.com/viewjob*
   jobs.lever.co/*/*
   boards.greenhouse.io/*/jobs/*
   job-boards.greenhouse.io/*/jobs/*
   jobs.ashbyhq.com/*/*
   ```

3. Use **site search**, rather than whole-web search. Keep image search off. Joblink also restricts each query and checks organic result URLs against the supported job-detail paths, so articles, home pages, and unrelated websites do not become job cards. New Google engines support up to **50 domains**. [Google's site-pattern instructions](https://support.google.com/programmable-search/answer/12397162?hl=en).
4. Copy the **Search engine ID**, also called `cx`. You do not need a Google JSON API key for this integration.
5. Put the ID in your private `jobfinder/preview/.env`:

   ```dotenv
   GOOGLE_SEARCH_ENGINE_ID=YOUR_ENGINE_ID
   ```

   The ID is a public widget identifier. Joblink uses this setting first and the existing `googleSearchEngineId` in `jobfinder/shared/lib/site.ts` as its fallback. For deployment, set the same environment variable in Vercel and redeploy.
6. Restart the preview with `start-preview.ps1`, open `/job-listing`, choose **Google · job sites**, and search for **virtual assistant**. You should see Google's attribution, job cards, and Google's own page controls when more results are available.

You can adjust link colors and fonts under **Look and feel** in the Google control panel. The surrounding search, classification dropdown, cards, and saving controls use Joblink's Bootstrap design.

## Classification and other filters

The classification dropdown filters imported jobs by their assigned role category. For Google it adds relevant category terms to the query. Location and employment type similarly refine Google's query. Listing time adds a Google date constraint; Google's page dates are not guaranteed to be the employer's posting date. Confirm the full job details on the original listing.

Google results provide a title, URL, and summary. Joblink does not invent a salary, employer, employment type, or posting date when that information is absent. **View / apply** opens the original job page. Saving keeps a bookmark in your application tracker; opening the page does not mean you have submitted an application.

**Select up to 50 new jobs** chooses at most 50 unsaved matches across loaded feed pages and the current Google page. The total selection is capped at 50, including selections outside the current filters or Google page. Additional checkboxes are disabled until space is available. Saved jobs are skipped by bulk selection; individual selection remains available for export. Source website and original-listing links open in new tabs. Source icons fall back to a built-in icon if the favicon cannot load.

## If you need structured Google for Jobs data

Google-indexed web results and structured **Google for Jobs** listings are different integrations. To receive structured company, salary, employment type, and posting-date fields, Joblink already has an optional server-side JSearch connector. It is a third-party provider with its own account, key, plan, and publisher coverage. No subscription or provider account has been created for you.

If you choose that provider, obtain its RapidAPI key and add `JSEARCH_API_KEY` to the private Node environment, then restart the preview. The **JSearch - connected feed** option appears only when configured. Keep that key server-side. [JSearch provider documentation](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch).

The supported Google widget is the integration used by this change. Google's Custom Search JSON API is closed to new customers and existing access ends January 1, 2027, so creating a new JSON API key is not the setup path here. [Google's current notice](https://developers.google.com/custom-search/v1/overview).
