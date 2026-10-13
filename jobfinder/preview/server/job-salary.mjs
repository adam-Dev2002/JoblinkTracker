import { jobSalaryListingUrl, salaryFromHtml } from '../scripts/job-salary.mjs'
import { jobListingIdentity } from '../scripts/job-identity.ts'
import { body, checkWrite, current, fail, json, limit } from './core.mjs'

const maxBytes = 2000000
export function createSalaryLookup({ fetcher = (...args) => fetch(...args), now = Date.now } = {}) {
  const cache = new Map(), pending = new Map()
  async function lookup(value) {
    const url = jobSalaryListingUrl(value)
    if (!url) return { url: value, salary: '', state: 'unsupported' }
    const key = jobListingIdentity(url)
    const stored = cache.get(key)
    if (stored && stored.expires > now()) return { ...stored.result, url: value }
    if (pending.has(key)) return { ...await pending.get(key), url: value }
    const work = (async () => {
      let result = { salary: '', state: 'unavailable' }
      try {
        const signal = AbortSignal.timeout(5000)
        let destination = url
        for (let redirect = 0; redirect < 4; redirect++) {
          const response = await fetcher(destination, { redirect: 'manual', signal, headers: { 'User-Agent': 'Joblink/1.0 (salary from original listing)', Accept: 'text/html,application/xhtml+xml' } })
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location')
            await response.body?.cancel()
            if (!location) break
            const next = jobSalaryListingUrl(new URL(location, destination).href)
            if (!next || jobListingIdentity(next) !== key) break
            destination = next
            continue
          }
          const contentType = response.headers.get('content-type') || ''
          if (!response.ok || (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) || Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); break }
          const reader = response.body?.getReader()
          if (!reader) break
          const chunks = []
          let size = 0
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.length
            if (size > maxBytes) { await reader.cancel(); throw new Error('Listing too large') }
            chunks.push(value)
          }
          const html = Buffer.concat(chunks).toString('utf8')
          if (/<title[^>]*>[^<]*(?:just a moment|access denied|verify|captcha)|id=["']challenge-form/i.test(html)) break
          const salary = salaryFromHtml(html, destination)
          result = { salary, state: salary ? 'found' : 'not-disclosed' }
          break
        }
      } catch { /* Salary lookup is optional; a blocked source never prevents tracking. */ }
      cache.delete(key)
      cache.set(key, { result, expires: now() + (result.state === 'unavailable' ? 60000 : 600000) })
      if (cache.size > 256) cache.delete(cache.keys().next().value)
      return result
    })()
    pending.set(key, work)
    try { return { ...await work, url: value } } finally { pending.delete(key) }
  }
  return async function lookupMany(urls) {
    const results = new Array(urls.length)
    let next = 0
    await Promise.all(Array.from({ length: Math.min(4, urls.length) }, async () => {
      while (next < urls.length) { const index = next++; results[index] = await lookup(urls[index]) }
    }))
    return results
  }
}
export const lookupJobSalaries = createSalaryLookup()

export async function jobSalaryRequest(request) {
  if (request.method !== 'POST') fail(405, 'Method not allowed.')
  const user = await current(request, true)
  checkWrite(request)
  const input = await body(request)
  if (!Array.isArray(input.urls) || !input.urls.length || input.urls.length > 20 || input.urls.some(url => typeof url !== 'string' || url.length > 2048)) fail(422, 'Provide 1 to 20 listing URLs.')
  if (await limit('job-salary:' + user.id, 60)) fail(429, 'Too many salary requests. Try again later.')
  return json({ results: await lookupJobSalaries([...new Set(input.urls)]) })
}
