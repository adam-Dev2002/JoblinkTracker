import { googleJobListingUrl } from './google-job-query'

type Application = { id: number; payload: { url?: string; jobId?: string; source?: string; status?: string } }
type Candidate<T> = { item: T; order: number; applied: boolean }
type Match<T> = { first: Candidate<T>; applied?: Candidate<T> }
const appliedStatuses = new Set(['Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted'])

function listingIdentity(value: string | undefined) {
  const google = googleJobListingUrl(value || '')
  if (google) return google
  if (value?.startsWith('/static/company-logos/') && !value.includes('..')) return value
  try {
    const url = new URL(value || '')
    return ['http:', 'https:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

// Keep only the first match and first applied match per identity. Rebuild this
// index when workspace records change, rather than scanning them for each card.
export function makeApplicationIndex<T extends Application>(applications: T[]) {
  const byUrl = new Map<string, Match<T>>()
  const bySourceId = new Map<string, Match<T>>()
  const unavailableUrls = new Set<string>()
  const unavailableSourceIds = new Set<string>()
  const remember = (index: Map<string, Match<T>>, key: string, candidate: Candidate<T>) => {
    const match = index.get(key)
    if (!match) index.set(key, { first: candidate, ...(candidate.applied ? { applied: candidate } : {}) })
    else if (candidate.applied && !match.applied) match.applied = candidate
  }
  applications.forEach((item, order) => {
    const candidate = { item, order, applied: appliedStatuses.has(item.payload.status || '') }
    const url = listingIdentity(item.payload.url)
    remember(byUrl, url, candidate)
    if (item.payload.status === 'Unavailable') unavailableUrls.add(url)
    if (typeof item.payload.jobId === 'string' && typeof item.payload.source === 'string') {
      const sourceId = JSON.stringify([item.payload.source, item.payload.jobId])
      remember(bySourceId, sourceId, candidate)
      if (item.payload.status === 'Unavailable') unavailableSourceIds.add(sourceId)
    }
  })
  return {
    isUnavailable(job: { url: string; id: string; source: string }): boolean {
      return Boolean(job.url && unavailableUrls.has(listingIdentity(job.url))) || unavailableSourceIds.has(JSON.stringify([job.source, job.id]))
    },
    lookup(job: { url: string; id: string; source: string }): T | undefined {
      const url = job.url ? byUrl.get(listingIdentity(job.url)) : undefined
      const sourceId = bySourceId.get(JSON.stringify([job.source, job.id]))
      const urlMatch = url?.applied || url?.first
      const sourceMatch = sourceId?.applied || sourceId?.first
      if (!urlMatch) return sourceMatch?.item
      if (!sourceMatch) return urlMatch.item
      if (urlMatch.applied !== sourceMatch.applied) return (urlMatch.applied ? urlMatch : sourceMatch).item
      return (urlMatch.order <= sourceMatch.order ? urlMatch : sourceMatch).item
    },
  }
}
