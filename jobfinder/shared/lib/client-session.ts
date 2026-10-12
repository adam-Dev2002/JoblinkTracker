import { clearPageData } from './page-data-cache'
export type SessionUser = { id: number; name: string; email: string; provider: string; avatarUrl: string | null; emailVerified: boolean }
export type Session = { user: SessionUser | null; csrf: string; googleEnabled: boolean }
let pending: Promise<Session> | null = null
let checkedAt = 0
const cacheKey = 'jobify-profile-preview'
let initialSession: Session | null = null
try {
  const element = document.getElementById('joblink-initial-session')
  if (element) initialSession = JSON.parse(element.textContent || 'null') as Session
} catch {
  /* Fall back to a server check if the snapshot is unavailable. */
}
let verifiedProfile: SessionUser | null | undefined = initialSession?.user
function storedProfile(): SessionUser | null {
  try {
    const cache = JSON.parse(sessionStorage.getItem(cacheKey) || 'null') as { user: SessionUser; time: number } | null
    return cache && Date.now() - cache.time < 300000 ? cache.user : null
  } catch {
    return null
  }
}
export function cachedProfile(): SessionUser | null {
  return verifiedProfile === undefined ? storedProfile() : verifiedProfile
}
export function getSession(force = false): Promise<Session> {
  if (pending && !force && Date.now() - checkedAt < 60000) return pending
  checkedAt = Date.now()
  const snapshot = !force ? initialSession : null
  initialSession = null
  // This snapshot came from the same server authorization check as this page.
  // Forced checks still query the server, including cross-tab logout and resume.
  const read = snapshot ? Promise.resolve(snapshot) : fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) })
    .then(async (response) => {
      if (!response.ok) throw new Error('Account service is unavailable. Please try again.')
      return (await response.json()) as Session
    })
  pending = read.then((session) => {
    try {
      const previous = storedProfile()
      if (!session.user || (previous && previous.id !== session.user.id)) clearPageData()
      if (session.user) sessionStorage.setItem(cacheKey, JSON.stringify({ user: session.user, time: Date.now() }))
      else sessionStorage.removeItem(cacheKey)
    } catch {
      /* Preview caching is optional. */
    }
    verifiedProfile = session.user
    window.dispatchEvent(new CustomEvent('jobify-session', { detail: session.user }))
    return session
  })
    .catch((error: unknown) => {
      pending = null
      throw error
    })
  return pending
}
export function clearProfile() {
  clearPageData()
  pending = null
  initialSession = null
  verifiedProfile = null
  try {
    sessionStorage.removeItem(cacheKey)
  } catch {
    /* Storage may be disabled. */
  }
  window.dispatchEvent(new CustomEvent('jobify-session', { detail: null }))
  const channel = new BroadcastChannel('jobify-session')
  channel.postMessage('signed-out')
  channel.close()
}
const channel = new BroadcastChannel('jobify-session')
channel.addEventListener('message', () => {
  clearPageData()
  pending = null
  verifiedProfile = null
  try {
    sessionStorage.removeItem(cacheKey)
  } catch {
    /* Storage may be disabled. */
  }
  void getSession(true).catch(() => {
    /* Next action will retry. */
  })
})
window.addEventListener('pageshow', (event) => {
  if (event.persisted)
    void getSession(true).catch(() => {
      /* Retry on the next action. */
    })
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible')
    void getSession(true).catch(() => {
      /* Retry on the next action. */
    })
})
