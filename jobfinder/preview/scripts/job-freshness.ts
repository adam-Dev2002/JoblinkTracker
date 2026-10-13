import { googleJobListingUrl } from './google-job-query'

type Listing = { id: string; source: string; url: string; date?: string }
type Detection = { detectedAt: number; publishedAt?: number }
type History = { owner: number; entries: [string, Detection][] }
export const newJobWindow = 48 * 60 * 60 * 1000
const maxEntries = 5000

function postingTime(value: string | undefined) {
  const date = (value || '').trim()
  if (!date) return undefined
  const timestamp = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(date) ? date + 'T00:00:00Z' : /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(date) ? date.replace(' ', 'T') + 'Z' : date)
  return Number.isFinite(timestamp) ? timestamp : undefined
}
function listingUrlKey(value: string) {
  try {
    const url = new URL(googleJobListingUrl(value) || value)
    if (['https:', 'http:'].includes(url.protocol)) {
      url.hash = ''
      for (const key of [...url.searchParams.keys()]) if (/^utm_|^(?:gclid|fbclid)$/i.test(key)) url.searchParams.delete(key)
      url.searchParams.sort()
      return 'url:' + url.href
    }
  } catch { /* A source ID still identifies listings with a missing URL. */ }
  return null
}
function listingKeys(job: Listing) {
  const urlKey = listingUrlKey(job.url)
  const keys = urlKey ? [urlKey] : []
  if (job.id && job.source) keys.push('source:' + JSON.stringify([job.source, job.id]))
  return keys
}

// Discovery history is separate from the five-minute feed preview. It never
// supplies account data or authentication, and rendering cards never writes it.
export function createJobFreshness(owner: number, options: { storage?: Pick<Storage, 'getItem' | 'setItem'>; now?: () => number } = {}) {
  const now = options.now || Date.now
  const storageKey = 'joblink-job-discovery-v1:' + owner
  let storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = options.storage
  const entries = new Map<string, Detection>()
  try {
    storage ??= window.localStorage
    const saved = JSON.parse(storage.getItem(storageKey) || 'null') as History | null
    if (saved?.owner === owner && Array.isArray(saved.entries)) {
      for (const pair of saved.entries.slice(0, maxEntries)) {
        if (!Array.isArray(pair) || pair.length !== 2) continue
        const [key, entry] = pair
        if (typeof key !== 'string' || !entry || !Number.isFinite(entry.detectedAt) || entry.detectedAt < 0 || entry.detectedAt > now()) continue
        const valid = { detectedAt: entry.detectedAt } as Detection
        if (Number.isFinite(entry.publishedAt)) valid.publishedAt = entry.publishedAt
        const canonicalKey = key.startsWith('url:') ? listingUrlKey(key.slice(4)) || key : key
        const previous = entries.get(canonicalKey)
        if (previous) {
          valid.detectedAt = Math.min(previous.detectedAt, valid.detectedAt)
          if (previous.publishedAt !== undefined) valid.publishedAt = Math.max(previous.publishedAt, valid.publishedAt ?? previous.publishedAt)
        }
        entries.set(canonicalKey, valid)
      }
    }
  } catch { /* Private browsing or unavailable storage retains in-page history. */ }
  const detection = (keys: string[]) => keys.map(key => entries.get(key)).filter((entry): entry is Detection => Boolean(entry)).reduce<Detection | undefined>((oldest, entry) => !oldest || entry.detectedAt < oldest.detectedAt ? entry : oldest, undefined)
  return {
    observe(jobs: Listing[]) {
      const time = now()
      let changed = false
      for (const job of jobs) {
        const keys = listingKeys(job)
        if (!keys.length) continue
        const publishedAt = postingTime(job.date)
        let entry = detection(keys)
        if (!entry) entry = { detectedAt: time, ...(publishedAt !== undefined ? { publishedAt } : {}) }
        else if (publishedAt !== undefined && entry.publishedAt !== publishedAt) { entry = { ...entry, publishedAt }; changed = true }
        for (const key of keys) {
          const previous = entries.get(key)
          if (!previous || previous.detectedAt !== entry.detectedAt || previous.publishedAt !== entry.publishedAt) { entries.set(key, entry); changed = true }
        }
      }
      if (changed) {
        // Retain every detection in the active page. Persist the most recent
        // records so a full history never suppresses badges on new arrivals.
        const recent = entries.size > maxEntries ? [...entries].sort((a, b) => b[1].detectedAt - a[1].detectedAt).slice(0, maxEntries) : [...entries]
        try { storage?.setItem(storageKey, JSON.stringify({ owner, entries: recent } satisfies History)) }
        catch { /* Discovery remains optional when browser storage is full. */ }
      }
    },
    label(job: Listing) {
      const entry = detection(listingKeys(job))
      const publishedAt = postingTime(job.date) ?? entry?.publishedAt
      const time = publishedAt ?? entry?.detectedAt
      if (time === undefined || time > now() || now() - time >= newJobWindow) return null
      return publishedAt !== undefined ? 'Posted within the last 48 hours' : 'Newly discovered within the last 48 hours'
    },
  }
}
