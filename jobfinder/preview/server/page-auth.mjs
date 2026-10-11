import { current, cookie, cookieValue, publicUser, env } from './core.mjs'
import { safeReturnTo } from './return-to.mjs'

export async function redirectSignedIn(request, isPrerendered) {
  if (isPrerendered || !(await current(request))) return null
  return new Response(null, {
    status: 302,
    headers: {
      'Location': safeReturnTo(new URL(request.url).searchParams.get('returnTo')),
      'Cache-Control': 'no-store',
      'Set-Cookie': cookieValue('joblink_session', cookie(request, 'joblink_session')),
    },
  })
}

export async function redirectToLogin(request, url, isPrerendered, locals = {}) {
  if (isPrerendered) return null
  const user = await current(request)
  if (user) {
    const token = cookie(request, 'joblink_csrf')
    if (/^[a-f0-9]{64}$/.test(token)) locals.joblinkSession = {
      user: publicUser(user),
      csrf: token,
      googleEnabled: Boolean(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET')),
    }
    return null
  }

  const returnTo = `${url.pathname}${url.search}`
  return new Response(null, {
    status: 302,
    headers: {
      'Location': `/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
      'Cache-Control': 'no-store',
    },
  })
}
