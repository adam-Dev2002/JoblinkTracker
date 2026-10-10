import { current } from './core.mjs'

export async function redirectSignedIn(request, isPrerendered) {
  if (isPrerendered || !(await current(request))) return null
  return new Response(null, {
    status: 302,
    headers: { 'Location': '/job-listing', 'Cache-Control': 'no-store' },
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
