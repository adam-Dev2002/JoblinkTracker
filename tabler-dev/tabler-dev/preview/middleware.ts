import { defineMiddleware } from 'astro:middleware'

export const onRequest = defineMiddleware(async ({ request, url }, next) => {
  if (process.env.JOBLINK_BACKEND === 'supabase' || import.meta.env.JOBLINK_BACKEND === 'supabase') return next()
  if (!['/api/auth/', '/api/jobs/', '/api/workspace/', '/api/assistant/'].some((prefix) => url.pathname.startsWith(prefix))) return next()
  const headers = new Headers()
  for (const name of ['content-type', 'cookie', 'origin', 'x-csrf-token']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  try {
    return await fetch(`http://127.0.0.1:${url.pathname.startsWith('/api/assistant/') ? 8083 : url.pathname.startsWith('/api/jobs/') ? 8082 : 8081}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? null : await request.arrayBuffer(),
      redirect: 'manual',
      signal: AbortSignal.timeout(65000),
    })
  } catch {
    return new Response(JSON.stringify({ error: 'Account service is unavailable. Please try again later.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  }
})
