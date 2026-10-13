import { jobListingIdentity, jobSourceIdentity } from './job-identity'

type Application = { id: number; payload: { url?: string; jobId?: string; source?: string; status?: string } }
type Candidate<T> = { item: T; order: number; applied: boolean }
type Match<T> = { first: Candidate<T>; applied?: Candidate<T> }
const appliedStatuses = new Set(['Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted'])

// Keep only the first match and first applied match per identity. Rebuild this
// index when workspace records change, rather than scanning them for each card.
export function makeApplicationIndex<T extends Application>(applications: T[]) {
  const byUrl = new Map<string, Match<T>>()
  const bySourceId = new Map<string, Match<T>>()
  const unavailableUrls = new Set<string>()
  const unavailableSourceIds = new Set<string>()
  const hiddenUrls = new Set<string>()
  const hiddenSourceIds = new Set<string>()
  const remember = (index: Map<string, Match<T>>, key: string, candidate: Candidate<T>) => {
    if (!key) return
    const match = index.get(key)
    if (!match) index.set(key, { first: candidate, ...(candidate.applied ? { applied: candidate } : {}) })
    else if (candidate.applied && !match.applied) match.applied = candidate
  }
  applications.forEach((item, order) => {
    const payload = item.payload
    const candidate = { item, order, applied: appliedStatuses.has(payload.status || '') }
    const url = jobListingIdentity(payload.url)
    const sourceId = jobSourceIdentity(payload.source, payload.jobId)
    const unavailable = payload.status === 'Unavailable'
    remember(byUrl, url, candidate)
    remember(bySourceId, sourceId, candidate)
    if (url && unavailable) unavailableUrls.add(url)
    if (sourceId && unavailable) unavailableSourceIds.add(sourceId)
    if (url && (candidate.applied || unavailable)) hiddenUrls.add(url)
    if (sourceId && (candidate.applied || unavailable)) hiddenSourceIds.add(sourceId)
  })
  return {
    isHidden(job: { url: string; id: string; source: string }): boolean {
      return hiddenUrls.has(jobListingIdentity(job.url)) || hiddenSourceIds.has(jobSourceIdentity(job.source, job.id))
    },
    isUnavailable(job: { url: string; id: string; source: string }): boolean {
      return unavailableUrls.has(jobListingIdentity(job.url)) || unavailableSourceIds.has(jobSourceIdentity(job.source, job.id))
    },
    lookup(job: { url: string; id: string; source: string }): T | undefined {
      const url = byUrl.get(jobListingIdentity(job.url))
      const sourceId = bySourceId.get(jobSourceIdentity(job.source, job.id))
      const urlMatch = url?.applied || url?.first
      const sourceMatch = sourceId?.applied || sourceId?.first
      if (!urlMatch) return sourceMatch?.item
      if (!sourceMatch) return urlMatch.item
      if (urlMatch.applied !== sourceMatch.applied) return (urlMatch.applied ? urlMatch : sourceMatch).item
      return (urlMatch.order <= sourceMatch.order ? urlMatch : sourceMatch).item
    },
  }
}
