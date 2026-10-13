import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { chromium } from '../jobfinder/node_modules/playwright/index.mjs'
import { loadEnv } from '../jobfinder/node_modules/vite/dist/node/index.js'
import { fileURLToPath } from 'node:url'

for (const [key, value] of Object.entries(loadEnv('development', fileURLToPath(new URL('../jobfinder/preview/', import.meta.url)), ''))) process.env[key] ??= value
const { db, query } = await import('../jobfinder/preview/server/core.mjs')
const baseURL = process.env.JOBLINK_BASE_URL || 'http://127.0.0.1:3000'
const users = []
const paths = []
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })

try {
  const context = await browser.newContext({ baseURL, reducedMotion: 'reduce' })
  const other = await browser.newContext({ baseURL })
  const anonymous = await browser.newContext({ baseURL })
  async function register(client) {
    const { csrf } = await (await client.request.get('/api/auth/session')).json()
    const response = await client.request.post('/api/auth/register', {
      headers: { 'X-CSRF-Token': csrf },
      data: { name: 'Bulk deletion test', email: `auth-test-bulk-${Date.now()}-${randomBytes(4).toString('hex')}@example.invalid`, password: 'Test-only-password-2026' },
    })
    assert.equal(response.status(), 201, await response.text())
    const { user } = await response.json()
    users.push(user.id)
    return { id: user.id, csrf: (await (await client.request.get('/api/auth/session')).json()).csrf }
  }
  const owner = await register(context)
  const foreignOwner = await register(other)
  async function seed(user, kind, count, title = kind) {
    return query(db().from('workspace_items').insert(Array.from({ length: count }, (_, index) => ({
      user_id: user.id, kind,
      payload: { title: `${title} ${index + 1}`, company: 'Test company', status: kind === 'application' ? 'Saved' : 'To do', date: '2026-10-13', url: '', notes: '', salary: '', value: '', time: '' },
    }))).select('id,kind'))
  }
  const applications = await seed(owner, 'application', 53)
  const [sheet] = await seed(owner, 'sheet', 1)
  const [task] = await seed(owner, 'task', 1)
  const [status] = await seed(owner, 'task_status', 1, 'Custom status')
  const [foreignApplication] = await seed(foreignOwner, 'application', 1)
  const [foreignSheet] = await seed(foreignOwner, 'sheet', 1)
  const initialIds = [...applications, sheet, task, status].map(row => Number(row.id)).sort((a, b) => a - b)
  const read = async client => (await (await client.request.get('/api/workspace/items')).json()).items
  const post = data => context.request.post('/api/workspace/items', { headers: { 'X-CSRF-Token': owner.csrf }, data })

  assert.equal((await anonymous.request.post('/api/workspace/items', { data: { action: 'bulk-delete', kind: 'application', ids: [applications[0].id] } })).status(), 401)
  assert.equal((await context.request.post('/api/workspace/items', { data: { action: 'bulk-delete', kind: 'application', ids: [applications[0].id] } })).status(), 403)
  for (const kind of ['task', 'task_status', 'link', 'unknown']) {
    assert.equal((await post({ action: 'bulk-delete', kind, ids: [task.id] })).status(), 422)
  }
  for (const ids of [[], [0], [-1], ['1'], [1.5], Array(201).fill(applications[0].id)]) {
    assert.equal((await post({ action: 'bulk-delete', kind: 'application', ids })).status(), 422)
  }
  for (const data of [
    { kind: 'application', ids: [applications[0].id, foreignApplication.id] },
    { kind: 'application', ids: [applications[0].id, Number.MAX_SAFE_INTEGER] },
    { kind: 'application', ids: [applications[0].id, sheet.id] },
    { kind: 'sheet', ids: [sheet.id, foreignSheet.id] },
    { kind: 'sheet', ids: [sheet.id, task.id] },
    { ids: [applications[0].id] },
  ]) {
    assert.equal((await post({ action: 'bulk-delete', ...data })).status(), 404)
  }
  assert.deepEqual((await read(context)).map(row => row.id).sort((a, b) => a - b), initialIds, 'Rejected batches must leave every local row intact')
  console.log('PASS: invalid and unauthorized bulk-delete requests leave all selected records intact.')

  const upload = await context.request.post('/api/workspace/attachments', {
    headers: { 'X-CSRF-Token': owner.csrf, Origin: new URL(baseURL).origin },
    multipart: { itemId: String(sheet.id), 'files[]': { name: 'bulk-delete-test.txt', mimeType: 'text/plain', buffer: Buffer.from('Temporary bulk deletion test attachment') } },
  })
  assert.equal(upload.status(), 201, await upload.text())
  const [attachment] = (await upload.json()).attachments
  const files = await query(db().from('workspace_attachments').select('storage_path').eq('user_id', owner.id))
  paths.push(...files.map(file => file.storage_path))

  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  const errors = []
  const batches = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/workspace/items') {
      const input = request.postDataJSON()
      if (input.action === 'bulk-delete') batches.push(input)
    }
  })
  await context.route('https://www.google.com/s2/favicons?*', route => route.abort())
  async function open(view, count) {
    const prefix = view === 'applications' ? 'application' : 'sheet'
    await page.goto(view === 'applications' ? '/applications' : '/desk/sheet')
    await page.locator('[data-ready=true]').waitFor()
    await page.locator(`[data-${prefix}-rows] tr`).first().waitFor()
    await page.locator(`[data-${prefix}-entries]`).selectOption('all')
    await page.waitForFunction(({ prefix, count }) => document.querySelectorAll(`[data-${prefix}-rows] tr`).length === count, { prefix, count })
    await page.locator(`[data-${prefix}-all]`).check()
    return prefix
  }
  async function deleteSelection(prefix, count) {
    await page.locator(`[data-${prefix}-bulk]`).click()
    assert.equal(await page.locator('[data-confirm-accept]').innerText(), 'Remove')
    await page.locator('[data-confirm-accept]').click()
    await page.locator(prefix === 'application' ? '[data-application-filter-count]' : '[data-sheet-count]').filter({ hasText: /^0 of 0 (jobs|rows)$/ }).waitFor()
    assert.equal(await page.locator(`[data-${prefix}-selection-toolbar]`).isVisible(), false)
    assert.equal(await page.locator('[data-workspace-error]').isVisible(), false)
    await page.locator('[data-removal-success-modal]').waitFor({ state: 'visible' })
    assert.equal(await page.locator('[data-removal-success-title]').innerText(), 'Removed successfully')
    const noun = prefix === 'application' ? 'application' : 'row'
    assert.ok((await page.locator('[data-removal-success-message]').innerText()).startsWith(`${count} ${noun}${count === 1 ? ' was' : 's were'} removed.`))
    await page.locator('[data-removal-success-close]').click()
    await page.locator('[data-removal-success-modal]').waitFor({ state: 'hidden' })
  }

  await open('applications', 53)
  await page.locator('[data-application-bulk]').click()
  await page.locator('[data-confirm-modal]').getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.locator('[data-confirm-modal]').waitFor({ state: 'hidden' })
  assert.equal((await read(context)).filter(row => row.kind === 'application').length, 53, 'Cancel must preserve all 53 applications')
  assert.equal(batches.length, 0)
  assert.equal(await page.locator('[data-removal-success-modal]').isVisible(), false)
  await deleteSelection('application', 53)
  assert.equal(batches.length, 1)
  assert.equal(batches[0].kind, 'application')
  assert.equal(batches[0].ids.length, 53)
  await page.reload()
  await page.locator('[data-ready=true]').waitFor()
  await page.locator('[data-application-filter-count]').filter({ hasText: /^0 of 0 jobs$/ }).waitFor()
  assert.deepEqual((await read(context)).map(row => row.id).sort((a, b) => a - b), [sheet.id, task.id, status.id].sort((a, b) => a - b))
  assert.equal((await context.request.get(`/api/workspace/attachments?id=${attachment.id}`)).status(), 200, 'Application deletion must preserve Sheet attachments')
  console.log('PASS: the real tracker deletes 53 selected applications, cancel preserves them, and deleted rows stay removed after reload.')

  await seed(owner, 'application', 205, 'Large batch')
  await open('applications', 205)
  await deleteSelection('application', 205)
  assert.deepEqual(batches.slice(1).map(input => [input.kind, input.ids.length]), [['application', 200], ['application', 5]])
  assert.equal((await read(context)).filter(row => row.kind === 'application').length, 0)

  const [duplicate] = await seed(owner, 'application', 1)
  const duplicateResponse = await post({ action: 'bulk-delete', kind: 'application', ids: [duplicate.id, duplicate.id] })
  assert.equal(duplicateResponse.status(), 200, await duplicateResponse.text())
  assert.deepEqual((await duplicateResponse.json()).deleted, [duplicate.id])
  const [individual] = await seed(owner, 'application', 1)
  const singleResponse = await post({ action: 'delete', id: individual.id })
  assert.equal(singleResponse.status(), 200, await singleResponse.text())
  assert.equal((await read(context)).some(row => row.id === individual.id), false)

  await open('sheet', 1)
  await deleteSelection('sheet', 1)
  assert.equal(batches.at(-1).kind, 'sheet')
  assert.equal((await context.request.get(`/api/workspace/attachments?id=${attachment.id}`)).status(), 404)
  assert.equal((await query(db().from('workspace_attachments').select('id').eq('user_id', owner.id))).length, 0)
  assert.ok((await db().storage.from('joblink-attachments').download(paths[0])).error, 'Deleted attachment bytes must be removed from Storage')
  const [legacySheet] = await seed(owner, 'sheet', 1)
  const legacyResponse = await post({ action: 'bulk-delete', ids: [legacySheet.id] })
  assert.equal(legacyResponse.status(), 200, await legacyResponse.text())
  assert.deepEqual((await legacyResponse.json()).deleted, [legacySheet.id], 'Older Sheet clients retain their default kind')
  assert.deepEqual((await read(context)).map(row => row.id).sort((a, b) => a - b), [task.id, status.id].sort((a, b) => a - b))
  assert.deepEqual((await read(other)).map(row => row.id).sort((a, b) => a - b), [foreignApplication.id, foreignSheet.id].sort((a, b) => a - b))
  assert.deepEqual(errors, [])
  console.log('PASS: batches over 200, duplicate IDs, single delete, Sheet attachment cleanup, older clients, CSRF, invalid IDs/types, missing rows, and cross-account protection.')
} finally {
  await browser.close()
  try {
    if (paths.length) {
      const { error } = await db().storage.from('joblink-attachments').remove(paths)
      if (error) throw new Error('Could not clean up temporary test attachments')
    }
  } finally {
    for (const id of users) await query(db().from('users').delete().eq('id', id))
  }
}
