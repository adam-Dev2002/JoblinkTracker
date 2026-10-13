// Match postings without changing the URLs used to open or apply to them.
// A provider's posting ID survives tracking links and edited title slugs.
export function jobListingIdentity(value: string | undefined) {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    let url = new URL(value || '')
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return ''
    if (!url.port && ['google.com', 'www.google.com'].includes(url.hostname) && url.pathname === '/url') {
      url = new URL(url.searchParams.get('q') || url.searchParams.get('url') || '')
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return ''
    const host = url.hostname.replace(/^www\./, '')
    const posting = (provider: string, ...parts: string[]) => JSON.stringify([provider, ...parts])
    if (!url.port) {
      if (host === 'onlinejobs.ph' || /^(?:[a-z]{2}\.|m\.)?linkedin\.com$/.test(host)) {
        const path = host === 'onlinejobs.ph' ? /^\/jobseekers\/job\/([^/]+)\/?$/ : /^\/jobs\/view\/([^/]+)\/?$/
        const id = url.pathname.match(path)?.[1]?.match(/(?:^|-)(\d+)$/)?.[1]
        if (id) return posting(host === 'onlinejobs.ph' ? 'onlinejobs.ph' : 'linkedin.com', id)
      }
      if (['ph.jobstreet.com', 'jobstreet.com.ph'].includes(host)) {
        const id = url.pathname.match(/^\/job\/(\d+)\/?$/)?.[1]
        if (id) return posting('jobstreet.ph', id)
      }
      if ((host === 'indeed.com' || host.endsWith('.indeed.com')) && /^\/(?:viewjob|m\/viewjob|rc\/clk)\/?$/.test(url.pathname)) {
        const id = url.searchParams.get('jk')
        if (id) return posting('indeed.com', id)
      }
      if (['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(host)) {
        const path = url.pathname.match(/^\/([^/]+)\/jobs\/(\d+)(?:\/apply)?\/?$/)
        if (path?.[1] && path[2]) return posting('greenhouse.io', path[1], path[2])
      }
      if (host === 'jobs.lever.co' || host === 'jobs.ashbyhq.com') {
        const path = url.pathname.match(host === 'jobs.lever.co' ? /^\/([^/]+)\/([^/]+)(?:\/apply)?\/?$/ : /^\/([^/]+)\/([^/]+)(?:\/application)?\/?$/)
        if (path?.[1] && path[2]) return posting(host, path[1], path[2])
      }
      if (['remotive.com', 'remotive.io'].includes(host)) {
        const id = url.pathname.match(/^\/remote-jobs\/(?:[^/]+\/)*[^/]*-(\d+)\/?$/)?.[1]
        if (id) return posting('remotive.com', id)
      }
      if (host === 'jobicy.com') {
        const id = url.pathname.match(/^\/jobs\/(\d+)(?:-[^/]+)?\/?$/)?.[1]
        if (id) return posting(host, id)
      }
    }
    // Unknown providers retain their identifying query parameters. Only known
    // tracking fields, application anchors and cosmetic variants are discarded.
    url.protocol = 'https:'
    url.hostname = host
    if (/^#(?:apply|application|description|job-description|details|top)$/i.test(url.hash)) url.hash = ''
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(?:gclid|dclid|fbclid|msclkid|mc_cid|mc_eid|trackingId|trk|gh_src|lever-source|lever-origin)$/i.test(key)) url.searchParams.delete(key)
    }
    url.searchParams.sort()
    return 'url:' + url.href
  } catch {
    return ''
  }
}

export function jobSourceIdentity(source: string | undefined, id: string | undefined) {
  return typeof source === 'string' && typeof id === 'string' && source.trim() && id.trim() ? JSON.stringify([source.trim().toLowerCase(), id.trim()]) : ''
}
