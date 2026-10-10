import { appUrl } from './core.mjs'

const fallback = '/job-listing'

export function safeReturnTo(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback

  try {
    const origin = new URL(appUrl()).origin
    const target = new URL(value, origin)
    if (target.origin !== origin || /^\/(?:sign-in|sign-up|api)(?:\/|$)/.test(target.pathname)) return fallback

    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return fallback
  }
}
