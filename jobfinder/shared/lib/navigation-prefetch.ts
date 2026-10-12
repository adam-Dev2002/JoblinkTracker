import { getSession } from './client-session'
import { readPageData, writePageData } from './page-data-cache'

// Astro prefetches the destination HTML/assets. Warm its dynamic feed too.
const pending = new Set<string>()
async function warm(link: HTMLAnchorElement) {
  const url = new URL(link.href, location.href)
  if (url.origin !== location.origin || link.target === '_blank') return
  if ((navigator as Navigator & { connection?: { saveData: boolean } }).connection?.saveData) return
  const path = url.pathname.replace(/\/$/, '')
  if (!['/news', '/job-listing'].includes(path) || path === location.pathname.replace(/\/$/, '')) return
  try {
    const session = await getSession()
    if (!session.user) return
    let key = 'news', endpoint = '/api/jobs/news'
    const owner = path === '/news' ? 'public' : session.user.id
    if (path === '/job-listing') {
      const filters = readPageData<{ values: string[] }>('job-filters', session.user.id)?.values
      const source = filters?.[1] || 'all'
      if (source === 'google') return
      const query = new URLSearchParams({ q: filters?.[0] || '', source }).toString()
      key = 'jobs:' + query
      endpoint = '/api/jobs/search?' + query
    }
    if (pending.has(key) || readPageData(key, owner)) return
    pending.add(key)
    try {
      const response = await fetch(endpoint, { credentials: 'same-origin', signal: AbortSignal.timeout(15000) })
      if (!response.ok) return
      const data = await response.json()
      writePageData(key, owner, path === '/news' ? data.articles : data)
    } finally {
      pending.delete(key)
    }
  } catch {
    // Prefetching is optional; the destination provides its normal retry UI.
  }
}
for (const event of ['mouseover', 'focusin']) {
  document.querySelector('.jobify-shell')?.addEventListener(event, event => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]')
    if (link) void warm(link)
  })
}
