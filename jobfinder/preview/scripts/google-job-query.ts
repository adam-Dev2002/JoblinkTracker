export const classifications = ['Virtual assistance', 'Development & IT', 'Design & creative', 'Customer support', 'Sales & marketing', 'Finance & operations', 'Other roles']
const categoryTerms: Record<string, string> = {
  'Virtual assistance': '("virtual assistant" OR "executive assistant" OR administrative)',
  'Development & IT': '(developer OR software OR engineer OR "information technology")',
  'Design & creative': '(designer OR creative OR writer OR "video editor")',
  'Customer support': '("customer support" OR "customer service" OR "technical support")',
  'Sales & marketing': '(sales OR marketing OR SEO OR "social media")',
  'Finance & operations': '(finance OR accountant OR bookkeeper OR operations OR recruiter)',
  'Other roles': '-developer -designer -assistant -support -sales -marketing -finance -accountant -bookkeeper',
}
export type GoogleJobFilters = { keyword: string; classification: string; location: string; employment: string; listingTime: string }
const normalizeSearchText = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim()
export function matchesGoogleJobSearch(filters: Pick<GoogleJobFilters, 'keyword' | 'location'>, title: string, summary: string) {
  const matches = (query: string, text: string) => {
    const groups = query.split(',').map(normalizeSearchText).filter(Boolean)
    const listing = ' ' + normalizeSearchText(text) + ' '
    return !groups.length || groups.some(group => group.split(/\s+/).every(word => listing.includes(' ' + word + ' ')))
  }
  // Google can return related results after dropping search terms. Require the
  // entered words in the listing itself, including cached search previews.
  return matches(filters.keyword, title + ' ' + summary) && matches(filters.location, summary)
}
const siteScope = '(site:onlinejobs.ph/jobseekers/job/ OR site:linkedin.com/jobs/view/ OR site:ph.jobstreet.com/job/ OR site:jobstreet.com.ph/job/ OR site:indeed.com/viewjob OR site:jobs.lever.co OR site:boards.greenhouse.io OR site:job-boards.greenhouse.io OR site:jobs.ashbyhq.com)'
export function googleJobQuery(filters: GoogleJobFilters) {
  const groups = filters.keyword
    .trim()
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const keyword = groups.length > 1 ? '(' + groups.join(' OR ') + ')' : groups[0] || ''
  const employment = filters.employment && filters.employment !== 'Not specified' ? '"' + filters.employment + '"' : ''
  const days = Number(filters.listingTime)
  const since = days > 0 ? 'after:' + new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) : ''
  // The scope already restricts the search to job sites. Adding "jobs" makes
  // broad searches favor directory pages rather than individual listings.
  return [keyword, categoryTerms[filters.classification] || '', filters.location.trim(), employment, since, siteScope].filter(Boolean).join(' ')
}
export function isGoogleJobListing(value: string) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return false
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    if (host === 'onlinejobs.ph') return /^\/jobseekers\/job\/[^/]+/.test(url.pathname)
    if (host === 'linkedin.com') return /^\/jobs\/view\/[^/]+/.test(url.pathname)
    if (['ph.jobstreet.com', 'jobstreet.com.ph'].includes(host)) return /^\/job\/\d+/.test(url.pathname)
    if (host === 'indeed.com' || host.endsWith('.indeed.com')) return url.pathname === '/viewjob' && Boolean(url.searchParams.get('jk'))
    if (host === 'jobs.lever.co' || host === 'jobs.ashbyhq.com') return /^\/[^/]+\/[^/]+\/?$/.test(url.pathname)
    if (['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(host)) return /^\/[^/]+\/jobs\/\d+/.test(url.pathname)
    return false
  } catch {
    return false
  }
}
export function googleJobListingUrl(value: string) {
  try {
    let url = new URL(value)
    if (['google.com', 'www.google.com'].includes(url.hostname) && url.pathname === '/url') {
      url = new URL(url.searchParams.get('q') || url.searchParams.get('url') || '')
    }
    if (!isGoogleJobListing(url.href)) return ''
    url.protocol = 'https:'
    url.hash = ''
    return url.href
  } catch {
    return ''
  }
}
