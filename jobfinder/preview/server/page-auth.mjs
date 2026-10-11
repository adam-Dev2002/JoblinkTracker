import { current, cookie, cookieValue } from './core.mjs'
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

export async function redirectToLogin(request, url, isPrerendered) {
  if (isPrerendered || (await current(request))) return null

  const returnTo = `${url.pathname}${url.search}`
  return new Response(null, {
    status: 302,
    headers: {
      'Location': `/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
      'Cache-Control': 'no-store',
    },
  })
}
