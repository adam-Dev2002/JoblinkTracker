import { googleJobQuery, googleJobListingUrl, type GoogleJobFilters } from './google-job-query'
import { jobListingIdentity } from './job-identity'

export const jobsPerPage = 12
export type GoogleJobResult = { url: string; listingUrl?: string; title: string; content?: string; visibleUrl?: string; pagemap?: Record<string, unknown>; richSnippet?: Record<string, unknown> }
type GoogleElement = { execute: (query: string) => void; clearAllResults: () => void }
type ReadyCallback = (name: string, query: string, promos: GoogleJobResult[], results: GoogleJobResult[], div: HTMLElement) => boolean
type GoogleWindow = Window & {
  __gcse?: { parsetags: string; initializationCallback: () => void; searchCallbacks: { web: { starting: (name: string, query: string) => string; ready: ReadyCallback; rendered: () => void } } }
  google?: { search?: { cse?: { element?: { render: (config: object) => void; getElement: (name: string) => GoogleElement | null } } } }
}
export function createGoogleJobSearch(root: HTMLElement, renderResults: (results: GoogleJobResult[]) => void, onStatusChange: () => void = () => {}) {
  const panel = root.querySelector<HTMLElement>('[data-google-jobs]')!
  const status = root.querySelector<HTMLElement>('[data-google-jobs-status]')!
  const host = root.querySelector<HTMLElement>('[data-google-jobs-host]')!
  const engineId = root.dataset.googleEngineId || ''
  const googleWindow = window as GoogleWindow
  const name = 'joblink-google-jobs'
  const pageResults = new Map<number, GoogleJobResult[]>()
  let initialization: Promise<void> | null = null
  let latestQuery = ''
  let active = false
  let requestedPage = 1
  let pagePending = false
  let resultReady = false
  let availableCount = 0
  let neededCount = jobsPerPage
  let providerPageSize = 0
  let generation = 0
  let scheduled = false
  let publishedState = ''
  let resultTimer: ReturnType<typeof setTimeout> | undefined
  const nativePages = () => Array.from(host.querySelectorAll<HTMLElement>('.gsc-cursor-page'))
    .map(element => ({ element, page: Number(element.textContent?.trim()) }))
    .filter(value => Number.isInteger(value.page) && value.page > 0)
  const unreadPage = () => nativePages().find(value => !pageResults.has(value.page))
  // Unread provider pages are capacity, not an exact count of filtered matches.
  const remainingResultCapacity = () => active && pageResults.size
    ? nativePages().filter(value => !pageResults.has(value.page)).length * (providerPageSize || jobsPerPage)
    : 0
  const hasMore = () => active && (pagePending || (!resultReady && panel.dataset.searchFailed !== 'true') || Boolean(unreadPage()))
  const publish = () => {
    const state = [active, pagePending, resultReady, hasMore(), remainingResultCapacity(), panel.getAttribute('aria-busy'), panel.dataset.searchFailed].join(':')
    if (state === publishedState) return
    publishedState = state
    onStatusChange()
  }
  const setStatus = (message: string, announcementOnly = false) => {
    status.textContent = message
    status.classList.toggle('visually-hidden', announcementOnly)
  }
  const finish = (message: string, failed = false) => {
    clearTimeout(resultTimer)
    pagePending = false
    panel.setAttribute('aria-busy', 'false')
    panel.dataset.searchFailed = String(failed)
    setStatus(message, !failed)
    publish()
  }
  const allResults = () => {
    const unique = new Map<string, GoogleJobResult>()
    for (const [, results] of [...pageResults].sort(([a], [b]) => a - b)) {
      for (const result of results) {
        const key = jobListingIdentity(result.listingUrl || result.url)
        if (key && !unique.has(key)) unique.set(key, result)
      }
    }
    return [...unique.values()]
  }
  const fillPage = () => {
    if (!active || !resultReady || pagePending || panel.dataset.searchFailed === 'true') { publish(); return }
    const next = availableCount < neededCount ? unreadPage() : undefined
    if (!next) { panel.setAttribute('aria-busy', 'false'); publish(); return }
    requestedPage = next.page
    pagePending = true
    panel.setAttribute('aria-busy', 'true')
    setStatus('Loading more matching jobs…', true)
    publish()
    clearTimeout(resultTimer)
    resultTimer = setTimeout(() => finish('More job results could not load. Try searching again.', true), 15000)
    next.element.click()
  }
  const scheduleFill = () => {
    if (scheduled) return
    scheduled = true
    const current = generation
    requestAnimationFrame(() => {
      if (current !== generation) return
      scheduled = false
      fillPage()
    })
  }
  const ready: ReadyCallback = (_name, query, promos, results, div) => {
    if (!active || query !== latestQuery) return true
    div.replaceChildren()
    // Provider containers keep attribution and promotions, never application cards.
    for (const promo of promos || []) {
      try {
        const url = new URL(promo.url)
        if (!['https:', 'http:'].includes(url.protocol)) continue
        const link = document.createElement('a')
        link.href = url.href
        link.textContent = 'Promotion: ' + new DOMParser().parseFromString(promo.title, 'text/html').body.textContent
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.className = 'd-block mb-3'
        div.append(link)
      } catch { /* Ignore malformed promotional URLs. */ }
    }
    providerPageSize = Math.max(providerPageSize, results?.length || 0)
    pageResults.set(requestedPage, (results || []).map(result => ({ ...result, listingUrl: googleJobListingUrl(result.url) })).filter(result => result.listingUrl))
    pagePending = false
    resultReady = false
    renderResults(allResults())
    finish('Job search results updated.')
    return true
  }
  const initialize = () => {
    if (initialization) return initialization
    initialization = new Promise<void>((resolve, reject) => {
      let settled = false
      const script = document.createElement('script')
      const timer = setTimeout(() => failed('Google search took too long to load. Try searching again.'), 12000)
      const failed = (message: string) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        script.remove()
        initialization = null
        reject(new Error(message))
      }
      googleWindow.__gcse = {
        parsetags: 'explicit',
        initializationCallback: () => {
          if (settled) return
          const api = googleWindow.google?.search?.cse?.element
          if (!api) { failed('Google search could not initialize. Try again.'); return }
          api.render({ div: host, tag: 'searchresults-only', gname: name, attributes: { autoSearchOnLoad: false, enableHistory: false, enableImageSearch: false, webSearchResultSetSize: jobsPerPage, linkTarget: '_blank' } })
          settled = true
          clearTimeout(timer)
          resolve()
        },
        searchCallbacks: {
          web: {
            starting: (_name, query) => {
              if (active && query === latestQuery) {
                panel.setAttribute('aria-busy', 'true')
                setStatus('Searching job listings…', true)
                clearTimeout(resultTimer)
                resultTimer = setTimeout(() => finish('Google results could not load. Try searching again.', true), 15000)
                publish()
              }
              return query
            },
            ready,
            rendered: scheduleFill,
          },
        },
      }
      script.src = 'https://cse.google.com/cse.js?cx=' + encodeURIComponent(engineId)
      script.async = true
      script.addEventListener('error', () => failed('Google search could not load. Check your connection or try another feed.'), { once: true })
      document.head.append(script)
    })
    return initialization
  }
  return {
    hasMore,
    remainingResultCapacity,
    updateResultCount(count: number, options: { needed?: number; live?: boolean } = {}) {
      availableCount = count
      neededCount = options.needed ?? jobsPerPage
      if (options.live !== false) resultReady = true
      if (active && resultReady && !pagePending && panel.dataset.searchFailed !== 'true')
        panel.setAttribute('aria-busy', String(availableCount < neededCount && Boolean(unreadPage())))
      if (options.live !== false) scheduleFill()
    },
    retry() { panel.dataset.searchFailed = 'false'; scheduleFill() },
    hide() {
      active = false
      generation++
      scheduled = false
      clearTimeout(resultTimer)
      panel.classList.add('d-none')
      panel.setAttribute('aria-busy', 'false')
      publish()
    },
    async search(filters: GoogleJobFilters) {
      generation++
      scheduled = false
      clearTimeout(resultTimer)
      pageResults.clear()
      providerPageSize = 0
      requestedPage = 1
      pagePending = false
      resultReady = false
      active = true
      panel.classList.remove('d-none')
      panel.setAttribute('aria-busy', 'true')
      panel.dataset.searchFailed = 'false'
      setStatus('Searching job listings…', true)
      const query = googleJobQuery(filters)
      latestQuery = query
      googleWindow.google?.search?.cse?.element?.getElement(name)?.clearAllResults()
      publish()
      if (!engineId) { finish('Google job search is not connected yet. Choose another job feed for now.', true); return }
      try {
        await initialize()
        if (!active || query !== latestQuery) return
        const element = googleWindow.google?.search?.cse?.element?.getElement(name)
        if (!element) throw new Error('Google search is not ready yet. Try searching again.')
        element.execute(query)
      } catch (error) {
        if (active && query === latestQuery) finish(error instanceof Error ? error.message : 'Google search is unavailable. Try again.', true)
      }
    },
  }
}
