import { googleJobListingUrl } from './google-job-query'

type Listing = { id: string; source: string; url: string; date?: string }
type Detection = { detectedAt: number; publishedAt?: number; newAt?: number }
type History = { owner: number; entries: [string, Detection][]; channels: string[] }
export const newJobWindow = 48 * 60 * 60 * 1000
const maxEntries = 5000
const maxChannels = 128

function postingTime(value: string | undefined) {
  const date = (value || '').trim()
  if (!date) return undefined
  const timestamp = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(date) ? date + 'T00:00:00Z' : /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(date) ? date.replace(' ', 'T') + 'Z' : date)
  return Number.isFinite(timestamp) ? timestamp : undefined
}
function listingKeys(job: Listing) {
  const keys: string[] = []
  try {
    const url = new URL(googleJobListingUrl(job.url) || job.url)
    if (['https:', 'http:'].includes(url.protocol)) {
      url.hash = ''
      for (const key of [...url.searchParams.keys()]) if (/^utm_|^(?:gclid|fbclid)$/i.test(key)) url.searchParams.delete(key)
      keys.push('url:' + url.href)
    }
  } catch { /* A source ID still identifies listings with a missing URL. */ }
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
  const channels = new Set<string>()
  try {
    storage ??= window.localStorage
    const saved = JSON.parse(storage.getItem(storageKey) || 'null') as History | null
    if (saved?.owner === owner && Array.isArray(saved.entries) && Array.isArray(saved.channels)) {
      for (const pair of saved.entries.slice(0, maxEntries)) {
        if (!Array.isArray(pair) || pair.length !== 2) continue
        const [key, entry] = pair
        if (typeof key !== 'string' || !entry || !Number.isFinite(entry.detectedAt) || entry.detectedAt < 0 || entry.detectedAt > now()) continue
        const valid = { detectedAt: entry.detectedAt } as Detection
        if (Number.isFinite(entry.publishedAt)) valid.publishedAt = entry.publishedAt
        if (Number.isFinite(entry.newAt) && entry.newAt! >= 0 && entry.newAt! <= now()) valid.newAt = entry.newAt
        entries.set(key, valid)
      }
      for (const channel of saved.channels.slice(0, maxChannels)) if (typeof channel === 'string') channels.add(channel)
    }
  } catch { /* Private browsing or unavailable storage retains in-page history. */ }
  const detection = (keys: string[]) => keys.map(key => entries.get(key)).filter((entry): entry is Detection => Boolean(entry)).reduce<Detection | undefined>((oldest, entry) => !oldest || entry.detectedAt < oldest.detectedAt ? entry : oldest, undefined)
  return {
    observe(jobs: Listing[], channel: string, live = true) {
      const baseline = channels.has(channel)
      const time = now()
      let changed = false
      for (const job of jobs) {
        const keys = listingKeys(job)
        if (!keys.length) continue
        const publishedAt = postingTime(job.date)
        let entry = detection(keys)
        if (!entry) entry = { detectedAt: time, ...(publishedAt !== undefined ? { publishedAt } : baseline && live ? { newAt: time } : {}) }
        else if (publishedAt !== undefined && entry.publishedAt !== publishedAt) { entry = { ...entry, publishedAt }; changed = true }
        for (const key of keys) {
          if (entries.has(key) || entries.size < maxEntries) {
            const previous = entries.get(key)
            if (!previous || previous.detectedAt !== entry.detectedAt || previous.newAt !== entry.newAt || previous.publishedAt !== entry.publishedAt) { entries.set(key, entry); changed = true }
          }
        }
      }
      if (!baseline && channels.size < maxChannels) { channels.add(channel); changed = true }
      if (changed) {
        try { storage?.setItem(storageKey, JSON.stringify({ owner, entries: [...entries], channels: [...channels] } satisfies History)) }
        catch { /* Discovery remains optional when browser storage is full. */ }
      }
    },
    label(job: Listing) {
      const entry = detection(listingKeys(job))
      const publishedAt = postingTime(job.date) ?? entry?.publishedAt
      const time = publishedAt ?? entry?.newAt
      if (time === undefined || time > now() || now() - time >= newJobWindow) return null
      return publishedAt !== undefined ? 'Posted within the last 48 hours' : 'Newly discovered within the last 48 hours'
    },
  }
}
