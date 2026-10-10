import { request } from 'node:http'
/** @returns {import('astro').AstroIntegration} */
export function localApiProxy() {
  return {
    name: 'jobify-local-api',
    hooks: {
      'astro:server:setup': ({ server }) => {
        server.middlewares.use((req, res, next) => {
          if (!/^\/api\/(auth|workspace|jobs|assistant)\//.test(req.url || '')) {
            next()
            return
          }
          const port = (req.url || '').startsWith('/api/assistant/') ? 8083 : (req.url || '').startsWith('/api/jobs/') ? 8082 : 8081
          const upstream = request({ hostname: '127.0.0.1', port, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, (incoming) => {
            res.statusCode = incoming.statusCode || 502
            for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined && !['connection', 'transfer-encoding', 'keep-alive'].includes(name)) res.setHeader(name, value)
            incoming.pipe(res)
          })
          upstream.setTimeout(65000, () => upstream.destroy(new Error('timeout')))
          upstream.on('error', () => {
            if (!res.headersSent) {
              res.statusCode = 503
              res.setHeader('Content-Type', 'application/json')
              res.setHeader('Cache-Control', 'no-store')
              res.end(JSON.stringify({ error: 'Account or feed service is temporarily unavailable.' }))
            } else res.end()
          })
          req.on('aborted', () => upstream.destroy())
          req.pipe(upstream)
        })
      },
    },
  }
}
