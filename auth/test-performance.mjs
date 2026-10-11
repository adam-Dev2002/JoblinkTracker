import { chromium } from '../jobfinder/node_modules/playwright/index.mjs'
import { loadEnv } from '../jobfinder/node_modules/vite/dist/node/index.js'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

const environment = loadEnv('development', fileURLToPath(new URL('../jobfinder/preview/', import.meta.url)), '')
for (const [key, value] of Object.entries(environment)) process.env[key] ??= value
const cloud = process.env.JOBLINK_BACKEND === 'supabase'
const email = `auth-test-${Date.now()}@example.invalid`
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const context = await browser.newContext({ baseURL: 'http://localhost:3000' })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  // Account service outages must not prevent the public page from rendering.
  await page.route('**/api/auth/session', route => route.abort())
  const home = await page.goto('/', { waitUntil: 'networkidle' })
  assert.equal(home.status(), 200)
  assert.equal(new URL(page.url()).pathname, '/')
  await page.getByRole('heading', { name: 'Find work. Move forward.' }).waitFor()
  assert.equal(await page.locator('[data-workspace-view]').count(), 0)
  assert.equal(await page.locator('script[src*="tabler.js"],script[src*="tabler.min.js"]').count(), 0)
  assert.equal(await page.locator('[data-ai-widget]').count(), 0)
  const cssUrl = await page.locator('link[rel="stylesheet"]').first().getAttribute('href')
  assert.match(cssUrl, /public(?:\.min)?\.css$/)
  assert.equal((await context.request.get(cssUrl)).status(), 200)
  assert.equal(await page.locator('.skip-link').evaluate(element => getComputedStyle(element).clip), 'rect(0px, 0px, 0px, 0px)')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: 'auth/runtime/landing-fast-mobile.png', fullPage: true })
  await page.unroute('**/api/auth/session')
  await page.getByRole('link', { name: 'Find work', exact: true }).first().click()
  await page.waitForURL('**/sign-in?returnTo=%2Fjob-listing')
  await page.getByLabel('Email address', { exact: true }).waitFor()
  await page.setViewportSize({ width: 1280, height: 900 })
  assert.ok(await page.locator('[data-jobify-auth]').evaluate(element => element.getBoundingClientRect().width) <= 500, 'Keep the sign-in form compact on desktop')

  const initial = await (await context.request.get('/api/auth/session')).json()
  const name = 'Performance </script><script>window.sessionInjection=true</script>'
  const registration = await context.request.post('/api/auth/register', {
    data: { name, email, password: 'Performance-only-password-2026' },
    headers: { 'X-CSRF-Token': initial.csrf },
  })
  assert.equal(registration.status(), 201)
  let sessionRequests = 0
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/auth/session') sessionRequests++ })
  const dashboard = await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
  assert.equal(dashboard.headers()['cache-control'], 'no-store')
  await page.locator('[data-ready=true]').waitFor()
  assert.equal(await page.locator('[data-workspace-view]').getAttribute('aria-busy'), 'false')
  assert.equal(await page.evaluate(() => window.sessionInjection), undefined)
  if (cloud) {
    assert.equal(sessionRequests, 0, 'Reuse the verified server session instead of checking it again')
    const snapshot = JSON.parse(await page.locator('#joblink-initial-session').textContent())
    assert.equal(snapshot.user.email, email)
  }
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForURL('**/dashboard')
  await page.locator('[data-ready=true]').waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS: public landing works without auth; smaller CSS; mobile layout; login gate; private dashboard; session reuse; escaped session data; returning-user redirect.')
} finally {
  await browser.close()
  if (cloud) {
    const { db, query } = await import('../jobfinder/preview/server/core.mjs')
    await query(db().from('users').delete().eq('email', email))
  } else {
    execFileSync('C:/xampp/php/php.exe', [fileURLToPath(new URL('./test-account.php', import.meta.url)), email, 'cleanup'])
  }
}
