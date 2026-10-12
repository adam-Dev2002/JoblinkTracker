import { googleJobListingUrl } from '../scripts/google-job-query.ts'
import { hasClosureNotice, isClosedListing, plainJobText } from '../scripts/job-availability.mjs'

export function availabilityUrl(value) {
  const listing = googleJobListingUrl(value)
  if (!listing) return ''
  const url = new URL(listing)
  if (url.protocol !== 'https:' || url.port) return ''
  url.hash = ''
  return url.href
}
function listingIdentity(value) {
  const normalized = availabilityUrl(value)
  if (!normalized) return ''
  const url = new URL(normalized)
  const host = url.hostname.replace(/^www\./, '')
  const path = url.pathname.replace(/\/$/, '')
  if (path === '/viewjob') return host + '?jk=' + url.searchParams.get('jk')
  if (host === 'onlinejobs.ph' || host === 'linkedin.com') return host + ':' + (path.match(/(?:-|\/)(\d+)$/)?.[1] || path)
  return host + path
}
export function pageAvailability(html, url, now = Date.now()) {
  const visible = plainJobText(html)
  if (hasClosureNotice(html)) return 'closed'
  if (/verify (?:you are|you're) human|access denied|security check|just a moment|(?:complete|solve) (?:the |this )?captcha|captcha (?:challenge|required)|unusual traffic/i.test(visible)) return 'unknown'
  const heading = plainJobText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1])
  if (isClosedListing({ title: heading })) return 'closed'
  if (/^(?:sign in|log\s?in|register|job search|jobs|careers|page not found|404)$/i.test(heading)) return 'unknown'
  const postings = []
  const visit = value => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value || typeof value !== 'object') return
    if ([value['@type']].flat().some(type => /(?:^|\/)JobPosting$/.test(String(type)))) postings.push(value)
    if (value['@graph']) visit(value['@graph'])
    if (value.mainEntity) visit(value.mainEntity)
  }
  for (const script of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(script[1])) } catch { /* Malformed metadata cannot establish availability. */ }
  }
  const identity = value => { try { return listingIdentity(new URL(value, url).href) } catch { return '' } }
  const matching = postings.filter(posting => identity(posting.url || posting.mainEntityOfPage?.['@id'] || posting.mainEntityOfPage) === identity(url))
  const posting = matching[0] || (postings.length === 1 && !postings[0].url && !postings[0].mainEntityOfPage ? postings[0] : null)
  if (posting && isClosedListing(posting, now)) return 'closed'
  let activeControl = false, disabledControl = false
  for (const control of html.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    if (!/^apply (?:now|for this (?:job|position)|to this (?:job|position))\s*[↗→]?$/i.test(plainJobText(control[3]))) continue
    if (/\bdisabled\b|aria-disabled\s*=\s*["']true/i.test(control[2])) disabledControl = true
    else activeControl = true
  }
  if (disabledControl && !activeControl) return 'unknown'
  if (posting?.title && posting.hiringOrganization && posting.description) return 'open'
  // Some boards, notably OnlineJobs.ph, use an application prompt instead of JSON-LD.
  if (!heading) return 'unknown'
  if (/please (?:log\s?in|sign in) or register as (?:a )?jobseeker to apply for this job/i.test(visible)) return 'open'
  if (activeControl) return 'open'
  return 'unknown'
}
function publishedJobApi(value) {
  const url = new URL(value), parts = url.pathname.split('/').filter(Boolean)
  if (url.hostname === 'jobs.lever.co' && parts.length === 2) return { provider: 'lever', id: parts[1], url: `https://api.lever.co/v0/postings/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}?mode=json` }
  if (['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(url.hostname) && parts.length === 3 && parts[1] === 'jobs') return { provider: 'greenhouse', id: parts[2], url: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(parts[0])}/jobs/${encodeURIComponent(parts[2])}` }
  return null
}
async function boundedPageText(response) {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks = []; let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > 1500000) { await reader.cancel(); throw new Error('Page too large') }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function createAvailabilityChecker({ fetcher = fetch, now = Date.now } = {}) {
  const cache = new Map(), pending = new Map()
  const check = async (value, fresh = false) => {
    const url = availabilityUrl(value)
    if (!url) return { url: String(value || ''), status: 'unknown' }
    const stored = cache.get(url)
    if (!fresh && stored?.expires > now()) return stored.result
    if (pending.has(url)) return pending.get(url)
    const work = (async () => {
      let status = 'unknown', target = url
      try {
        const signal = AbortSignal.timeout(6000)
        const sourceApi = publishedJobApi(url)
        if (sourceApi) {
          try {
            const response = await fetcher(sourceApi.url, { redirect: 'error', signal, headers: { Accept: 'application/json', 'User-Agent': 'Joblink/1.0' } })
            if ([404, 410].includes(response.status)) { status = 'closed'; await response.body?.cancel() }
            else if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
              const job = JSON.parse(await boundedPageText(response))
              if (String(job.id) === sourceApi.id && (sourceApi.provider === 'lever' ? job.text && job.hostedUrl : job.title && job.absolute_url)) status = isClosedListing(job, now()) ? 'closed' : 'open'
            } else await response.body?.cancel()
          } catch { /* Fall back to the listing page; failures are not closures. */ }
        }
        for (let redirects = 0; status === 'unknown' && redirects < 4; redirects++) {
          const response = await fetcher(target, { redirect: 'manual', signal, headers: { 'User-Agent': 'Joblink/1.0 (job availability check)', Accept: 'text/html' } })
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location')
            const next = location && availabilityUrl(new URL(location, target).href)
            await response.body?.cancel()
            if (!next || listingIdentity(next) !== listingIdentity(url)) break
            target = next
            continue
          }
          if ([404, 410].includes(response.status)) { status = 'closed'; await response.body?.cancel(); break }
          if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) { await response.body?.cancel(); break }
          status = pageAvailability(await boundedPageText(response), target, now())
          break
        }
      } catch { /* Network failures remain unknown, never open or closed. */ }
      const result = { url, status, checkedAt: new Date(now()).toISOString() }
      cache.set(url, { result, expires: now() + (status === 'unknown' ? 15000 : 60000) })
      if (cache.size > 1000) cache.delete(cache.keys().next().value)
      return result
    })()
    pending.set(url, work)
    try { return await work } finally { pending.delete(url) }
  }
  return async (urls, fresh = false) => {
    const results = new Array(urls.length)
    let index = 0
    await Promise.all(Array.from({ length: Math.min(6, urls.length) }, async () => {
      while (index < urls.length) { const current = index++; results[current] = await check(urls[current], fresh) }
    }))
    return results
  }
}
export const checkAvailability = createAvailabilityChecker()
