import type { APIRoute } from 'astro'

export const prerender = false
const publicPages = ['/sign-in', '/sign-up']
const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const GET: APIRoute = ({ url }) => {
  const origin = (process.env.APP_URL || url.origin).replace(/\/$/, '')
  const entries = publicPages.map(path => '<url><loc>' + escapeXml(origin + path) + '</loc></url>').join('')
  return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + entries + '</urlset>', { headers: { 'Content-Type': 'application/xml; charset=utf-8' } })
}
