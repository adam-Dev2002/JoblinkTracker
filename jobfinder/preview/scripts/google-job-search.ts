import { googleJobQuery, googleJobListingUrl, type GoogleJobFilters } from './google-job-query'
import { jobListingIdentity } from './job-identity'

export const jobsPerPage = 12
export type GoogleJobResult = { url: string; listingUrl?: string; title: string; content?: string; visibleUrl?: string }
type GoogleElement = { execute: (query: string) => void; clearAllResults: () => void }
type ReadyCallback = (name: string, query: string, promos: GoogleJobResult[], results: GoogleJobResult[], div: HTMLElement) => boolean
type GoogleWindow = Window & {
  __gcse?: { parsetags: string; initializationCallback: () => void; searchCallbacks: { web: { starting: (name: string, query: string) => string; ready: ReadyCallback; rendered: () => void } } }
  google?: { search?: { cse?: { element?: { render: (config: object) => void; getElement: (name: string) => GoogleElement | null } } } }
}
export function createGoogleJobSearch(root: HTMLElement, renderResults: (results: GoogleJobResult[], div: HTMLElement) => void, onStatusChange: () => void = () => {}) {
  const panel = root.querySelector<HTMLElement>('[data-google-jobs]')!
  const status = root.querySelector<HTMLElement>('[data-google-jobs-status]')!
  const host = root.querySelector<HTMLElement>('[data-google-jobs-host]')!
  const engineId = root.dataset.googleEngineId || ''
  const googleWindow = window as GoogleWindow
  const name = 'joblink-google-jobs'
  let initialization: Promise<void> | null = null
  let latestQuery = ''
  let active = false
  let resultCount = 0
  let availableCount = 0
  let requestedPage = 1
  let logicalPage = 1
  let repacking = false
  let pagePending = false
  let resultReady = false
  let hiddenResults = false
  let internalPageClick = false
  let searchGeneration = 0
  let resultsDiv: HTMLElement | null = null
  const pageResults = new Map<number, GoogleJobResult[]>()
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
  const nativePages = () => Array.from(host.querySelectorAll<HTMLElement>('.gsc-cursor-page')).map(element => ({ element, page: Number(element.textContent?.trim()) })).filter(value => Number.isInteger(value.page) && value.page > 0)
  const unreadPage = () => nativePages().find(value => !pageResults.has(value.page))
  const redraw = () => {
    if (!active || !resultsDiv?.isConnected) return
    resultReady = false
    renderResults(allResults(), resultsDiv)
  }
  const changePage = (page: number) => {
    if (!active || pagePending || page < 1) return
    logicalPage = page
    panel.dataset.searchFailed = 'false'
    redraw()
  }
  const fillPage = () => {
    if (!active || !repacking || !resultReady || pagePending || panel.dataset.searchFailed === 'true') return
    if (availableCount >= logicalPage * jobsPerPage) return
    const next = unreadPage()
    if (!next) {
      const last = Math.max(1, Math.ceil(availableCount / jobsPerPage))
      if (logicalPage > last) { logicalPage = last; redraw(); return }
      panel.setAttribute('aria-busy', 'false')
      onStatusChange()
      return
    }
    requestedPage = next.page
    pagePending = true
    resultReady = false
    panel.setAttribute('aria-busy', 'true')
    setStatus('Loading more matching jobs…', true)
    onStatusChange()
    updatePagination()
    clearTimeout(resultTimer)
    resultTimer = setTimeout(() => finish('More job results could not load. Try searching again.'), 15000)
    internalPageClick = true
    try { next.element.click() } finally { internalPageClick = false }
  }
  host.addEventListener('click', event => {
    const target = (event.target as Element).closest<HTMLElement>('.gsc-cursor-page')
    if (!target || internalPageClick) return
    if (pagePending) { event.preventDefault(); event.stopImmediatePropagation(); return }
    requestedPage = Number(target.textContent?.trim()) || 1
    repacking = false
    logicalPage = 1
  }, true)
  const schedulePagination = () => {
    const generation = searchGeneration
    requestAnimationFrame(() => {
      if (!active || generation !== searchGeneration) return
      updatePagination()
      fillPage()
    })
  }
  let resultTimer: ReturnType<typeof setTimeout> | undefined
  const updatePagination = () => {
    if (!active) return
    if (!repacking && resultReady && hiddenResults && nativePages().length > 1) {
      repacking = true
      logicalPage = requestedPage
      panel.setAttribute('aria-busy', 'true')
      redraw()
      return
    }
    const results = host.querySelector<HTMLElement>('.gsc-results.gsc-webResult')
    if (!results) return
    let footer = results.querySelector<HTMLElement>('.gsc-cursor-box')
    if (!footer) {
      footer = document.createElement('div')
      footer.className = 'gsc-cursor-box'
      const branding = results.querySelector('.gcsc-more-maybe-branding-root, .gcsc-branding')
      if (branding?.parentElement === results) results.insertBefore(footer, branding)
      else results.append(footer)
    }
    footer.classList.add('workspace-pagination')
    footer.classList.toggle('d-none', resultCount === 0 && !pagePending)
    const cursor = footer.querySelector<HTMLElement>('.gsc-cursor')
    const pages = Array.from(cursor?.querySelectorAll<HTMLElement>('.gsc-cursor-page') || [])
    const current = Math.max(0, pages.findIndex((page) => page.classList.contains('gsc-cursor-current-page')))
    const pageNumber = repacking ? logicalPage : Number(pages[current]?.textContent?.trim()) || 1
    let count = footer.querySelector<HTMLElement>('[data-google-page-count]')
    if (!count) {
      count = document.createElement('p')
      count.className = 'text-secondary small mb-0 workspace-page-count'
      count.dataset.googlePageCount = ''
      count.setAttribute('role', 'status')
      footer.prepend(count)
    }
    // Google does not provide an exact total of validated job-detail pages.
    count.textContent = `Showing ${resultCount} ${resultCount === 1 ? 'entry' : 'entries'} on page ${pageNumber}`
    if (repacking) {
      cursor?.classList.add('d-none')
      let packed = footer.querySelector<HTMLElement>('[data-google-packed-pages]')
      if (!packed) {
        packed = document.createElement('div')
        packed.className = 'pagination'
        packed.dataset.googlePackedPages = ''
        footer.append(packed)
      }
      const knownPages = Math.max(1, Math.ceil(availableCount / jobsPerPage))
      const lastPage = Math.max(logicalPage, knownPages + (unreadPage() ? 1 : 0))
      packed.replaceChildren()
      const button = (page: number, label: string, disabled = false) => {
        const control = document.createElement('button')
        control.type = 'button'
        control.className = 'page-link'
        control.textContent = label
        control.dataset.googleJobPage = String(page)
        control.disabled = disabled || pagePending
        control.setAttribute('aria-label', /^\d+$/.test(label) ? 'Page ' + label : label + ' page')
        if (label === String(logicalPage)) { control.classList.add('active'); control.setAttribute('aria-current', 'page') }
        control.addEventListener('click', () => changePage(page))
        packed!.append(control)
      }
      if (logicalPage > 1) button(logicalPage - 1, 'Previous')
      for (let page = 1; page <= lastPage; page++) button(page, String(page))
      button(logicalPage + 1, 'Next', logicalPage === lastPage)
      return
    }
    footer.querySelector('[data-google-packed-pages]')?.remove()
    if (!cursor) return
    cursor.classList.remove('d-none')
    cursor.classList.add('pagination')
    cursor.querySelectorAll<HTMLElement>('.gsc-cursor-nav').forEach((nav) => nav.remove())
    const navButton = (label: string, target: number) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'gsc-cursor-nav page-link'
      button.textContent = label
      button.setAttribute('aria-label', label + ' page')
      if (target < 0 || target >= pages.length) button.disabled = true
      else button.addEventListener('click', () => pages[target]?.click())
      return button
    }
    if (current > 0) cursor.prepend(navButton('Previous', current - 1))
    cursor.append(navButton('Next', current + 1))
    for (const page of pages) {
      const selected = page.classList.contains('gsc-cursor-current-page')
      page.classList.add('page-link')
      page.classList.toggle('active', selected)
      page.setAttribute('aria-label', 'Page ' + page.textContent?.trim())
      if (selected) page.setAttribute('aria-current', 'page')
      else page.removeAttribute('aria-current')
    }
  }
  const setStatus = (message: string, announcementOnly = false) => {
    status.textContent = message
    status.classList.toggle('visually-hidden', announcementOnly)
  }
  const finish = (message: string, announcementOnly = false) => {
    clearTimeout(resultTimer)
    panel.setAttribute('aria-busy', 'false')
    panel.dataset.searchFailed = String(!announcementOnly)
    if (!announcementOnly) { pagePending = false; resultReady = false }
    setStatus(message, announcementOnly)
    if (!announcementOnly) root.querySelector('[data-google-jobs-preview] .data-placeholder')?.remove()
    onStatusChange()
  }
  const ready: ReadyCallback = (_name, query, promos, results, div) => {
    if (!active || query !== latestQuery) return true
    div.replaceChildren()
    // Keep Google promotions, branding, ads and pagination intact.
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
      } catch {
        /* Ignore malformed promotional URLs. */
      }
    }
    const listings = (results || []).map((result) => ({ ...result, listingUrl: googleJobListingUrl(result.url) })).filter((result) => result.listingUrl)
    pageResults.set(requestedPage, listings)
    pagePending = false
    resultReady = false
    resultCount = listings.length
    const organic = document.createElement('div')
    div.append(organic)
    resultsDiv = organic
    renderResults(repacking ? allResults() : listings, organic)
    finish(`${listings.length} job ${listings.length === 1 ? 'listing' : 'listings'} on this page.`, true)
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
          if (!api) {
            failed('Google search could not initialize. Try again.')
            return
          }
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
                resultTimer = setTimeout(() => finish('Google results are taking longer than expected. Try searching again or choose a job feed.'), 15000)
              }
              return query
            },
            ready,
            rendered: () => {
              // Google adds its footer after this callback; theme the new nodes.
              // Preserve Google's native page controls and click handlers.
              schedulePagination()
            },
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
    resultPage() { return repacking ? logicalPage : 1 },
    updateResultCount(count: number, options: { available?: number; hidden?: boolean; live?: boolean } = {}) {
      resultCount = count
      availableCount = options.available ?? count
      if (options.live !== false) {
        resultReady = true
        hiddenResults = Boolean(options.hidden)
        if (repacking && availableCount < logicalPage * jobsPerPage) panel.setAttribute('aria-busy', 'true')
        else if (repacking) panel.setAttribute('aria-busy', 'false')
      }
      if (active) setStatus(`${count} job ${count === 1 ? 'listing' : 'listings'} on this page.`, true)
      updatePagination()
      if (options.live !== false) schedulePagination()
    },
    hide() {
      active = false
      searchGeneration++
      clearTimeout(resultTimer)
      panel.classList.add('d-none')
      panel.setAttribute('aria-busy', 'false')
      onStatusChange()
    },
    async search(filters: GoogleJobFilters) {
      searchGeneration++
      clearTimeout(resultTimer)
      pageResults.clear()
      requestedPage = 1
      logicalPage = 1
      repacking = false
      pagePending = false
      resultReady = false
      hiddenResults = false
      resultsDiv = null
      active = true
      panel.classList.remove('d-none')
      panel.setAttribute('aria-busy', 'true')
      panel.dataset.searchFailed = 'false'
      setStatus('Searching job listings…', true)
      const query = googleJobQuery(filters)
      latestQuery = query
      googleWindow.google?.search?.cse?.element?.getElement(name)?.clearAllResults()
      host.querySelectorAll('.google-job-grid, .gsc-cursor-box').forEach(node => node.remove())
      onStatusChange()
      if (!engineId) {
        finish('Google job search is not connected yet. Choose another job feed for now.')
        return
      }
      try {
        await initialize()
        if (!active || query !== latestQuery) return
        const element = googleWindow.google?.search?.cse?.element?.getElement(name)
        if (!element) throw new Error('Google search is not ready yet. Try searching again.')
        element.execute(query)
      } catch (error) {
        if (active && query === latestQuery) finish(error instanceof Error ? error.message : 'Google search is unavailable. Try again.')
      }
    },
  }
}
