import { gzipSync, gunzipSync } from 'node:zlib'

// Public feed data only. Coalesce concurrent requests and keep repeat searches
// off the database. Compress persistent payloads to avoid transferring full HTML
// descriptions from the database on every cold start.
export function createFeedCache({ read, write, fetcher = fetch, now = Date.now }) {
  const memory = new Map(),
    pending = new Map()
  const remember = (key, entry) => {
    memory.delete(key)
    memory.set(key, entry)
    if (memory.size > 24) memory.delete(memory.keys().next().value)
    return entry.payload
  }
  return async function cached(key, url, headers = {}, seconds = 21600) {
    const existing = memory.get(key)
    if (existing && existing.expiresAt > now()) return existing.payload
    if (pending.has(key)) return pending.get(key)
    const work = (async () => {
      const storageKey = 'feed-v2:' + key
      try {
        const stored = await read(storageKey)
        if (stored && Date.parse(stored.expires_at) > now()) {
          const payload = stored.payload?.encoding === 'gzip-base64-v1' ? JSON.parse(gunzipSync(Buffer.from(stored.payload.data, 'base64'), { maxOutputLength: 25000000 }).toString('utf8')) : stored.payload
          return remember(key, { payload, expiresAt: Date.parse(stored.expires_at) })
        }
      } catch {
        /* A cache outage must not prevent public feed access. */
      }
      const response = await fetcher(url, { headers: { 'User-Agent': 'Joblink/1.0', ...headers }, signal: AbortSignal.timeout(8000) })
      if (!response.ok) throw new Error('The source is temporarily unavailable. Please try again later.')
      const payload = await response.json()
      const expiresAt = now() + seconds * 1000
      remember(key, { payload, expiresAt })
      try {
        await write(storageKey, { encoding: 'gzip-base64-v1', data: gzipSync(JSON.stringify(payload)).toString('base64') }, new Date(expiresAt).toISOString())
      } catch {
        /* The fresh in-memory feed still serves this request. */
      }
      return payload
    })()
    pending.set(key, work)
    try {
      return await work
    } finally {
      pending.delete(key)
    }
  }
}
