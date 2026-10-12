import { getSession, type SessionUser } from './client-session'
import { readPageData, writePageData } from './page-data-cache'
import { whenPageActive } from './page-activation'

// Astro prefetches the destination HTML/assets. Warm its dynamic feed too.
const pending = new Set<string>()
const shell = document.querySelector('.jobify-shell')
const navigationPaths = new Set(['/dashboard', '/applications', '/job-listing', '/news', '/desk/taskboard', '/desk/calendar', '/desk/links', '/desk/sheet', '/settings'])
const connection = (navigator as Navigator & { connection?: { saveData: boolean; effectiveType?: string } }).connection
const canPrepare = () => navigator.onLine && !connection?.saveData && !/2g/.test(connection?.effectiveType || '')
let rules: HTMLScriptElement | null = null
let currentUser: SessionUser | null = null
let preparedProfile = ''
function discardPreparedPages() {
  rules?.remove()
  rules = null
  preparedProfile = ''
  shell?.querySelectorAll<HTMLAnchorElement>('[data-joblink-navigation]').forEach(link => {
    link.dataset.astroPrefetch = ''
    delete link.dataset.joblinkNavigation
  })
}
function prepareNavigation(user: SessionUser | null) {
  const profile = user ? JSON.stringify(user) : ''
  if (rules && preparedProfile === profile && canPrepare()) return
  discardPreparedPages()
  if (!shell || !user || !canPrepare() || !HTMLScriptElement.supports?.('speculationrules')) return
  for (const link of shell.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const url = new URL(link.href, location.href)
    if (url.origin === location.origin && navigationPaths.has(url.pathname) && url.pathname !== location.pathname && !url.search && !url.hash && !link.target && !link.hasAttribute('download')) {
      link.dataset.joblinkNavigation = ''
      link.dataset.astroPrefetch = 'false'
    }
  }
  // Prepare links the user approaches; full documents retain normal script
  // lifecycles and server authorization, including on the prepared page.
  rules = document.createElement('script')
  rules.type = 'speculationrules'
  rules.textContent = JSON.stringify({ prerender: [{ where: { selector_matches: 'a[data-joblink-navigation]' }, eagerness: 'moderate' }] })
  document.head.append(rules)
  preparedProfile = profile
}
function updateNavigation(user: SessionUser | null) {
  currentUser = user
  // A hidden prepared document must not prepare further destinations.
  if (!user) discardPreparedPages()
  void whenPageActive().then(() => prepareNavigation(currentUser))
}
window.addEventListener('jobify-session', event => updateNavigation((event as CustomEvent<SessionUser | null>).detail))
// Discard prepared documents after an edit so they cannot restore an old row.
window.addEventListener('joblink-workspace-changed', discardPreparedPages)
if (shell && canPrepare()) void getSession().then(session => updateNavigation(session.user)).catch(() => {})
async function warm(link: HTMLAnchorElement) {
  const url = new URL(link.href, location.href)
  if (url.origin !== location.origin || link.target === '_blank') return
  if (!canPrepare()) return
  // Resume preparation on the next interaction after an edit evicts old pages.
  if (!rules && currentUser) prepareNavigation(currentUser)
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
for (const event of ['mouseover', 'focusin', 'touchstart']) {
  shell?.addEventListener(event, event => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]')
    if (link) void warm(link)
  }, { passive: true })
}
