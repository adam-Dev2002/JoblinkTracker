// Tab-scoped previews speed up navigation. They never authorize an API action.
const prefix = 'joblink-page-data-v1:'
const maxAge = 5 * 60 * 1000
const maxEntries = 16

export function readPageData<T>(key: string, owner: number | 'public'): T | null {
  try {
    const entry = JSON.parse(sessionStorage.getItem(prefix + key) || 'null') as { owner: number | 'public'; time: number; data: T } | null
    if (!entry || entry.owner !== owner) return null
    if (Date.now() - entry.time > maxAge || entry.time > Date.now()) {
      sessionStorage.removeItem(prefix + key)
      return null
    }
    return entry.data
  } catch {
    return null
  }
}

export function writePageData<T>(key: string, owner: number | 'public', data: T) {
  try {
    const keys = Object.keys(sessionStorage).filter(key => key.startsWith(prefix))
    if (keys.length >= maxEntries && !sessionStorage.getItem(prefix + key)) {
      // Keep the shared workspace and current filters when many searches fill
      // the cache; discard the oldest optional feed/article preview instead.
      const candidates = keys.filter(key => ![prefix + 'workspace', prefix + 'job-filters'].includes(key))
      const time = (key: string) => {
        try { return Number(JSON.parse(sessionStorage.getItem(key) || 'null')?.time) || 0 }
        catch { return 0 }
      }
      candidates.sort((a, b) => time(a) - time(b))
      if (candidates[0]) sessionStorage.removeItem(candidates[0])
    }
    sessionStorage.setItem(prefix + key, JSON.stringify({ owner, time: Date.now(), data }))
  } catch {
    // Browsing and edits still work when storage is unavailable or full.
  }
}

export function clearPageData() {
  try {
    Object.keys(sessionStorage).filter(key => key.startsWith(prefix)).forEach(key => sessionStorage.removeItem(key))
  } catch {
    // Storage is optional.
  }
}
