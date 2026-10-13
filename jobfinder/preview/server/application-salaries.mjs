import { body, checkWrite, db, fail, json, limit, query } from './core.mjs'
import { lookupJobSalaries } from './job-salary.mjs'

export async function applicationSalaries(request, user) {
  if (request.method !== 'POST') fail(405, 'Method not allowed.')
  checkWrite(request)
  const input = await body(request)
  if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 20 || input.ids.some(id => !Number.isSafeInteger(id) || id < 1)) fail(422, 'Select 1 to 20 applications.')
  const ids = [...new Set(input.ids)]
  const rows = await query(db().from('workspace_items').select('id,payload').eq('user_id', user.id).eq('kind', 'application').in('id', ids))
  if (rows.length !== ids.length) fail(404, 'Application not found.')
  const missing = rows.filter(row => !String(row.payload.salary || '').trim())
  if (!missing.length) return json({ updated: [] })
  if (await limit('job-salary:' + user.id, 60)) fail(429, 'Too many salary requests. Try again later.')
  const salaries = await lookupJobSalaries(missing.map(row => row.payload.url))
  const updated = (await Promise.all(missing.map(async (row, index) => {
    const salary = salaries[index].salary
    if (!salary) return null
    // Compare the whole stored payload atomically: a concurrent manual salary,
    // status or notes edit must win over this background source lookup.
    const saved = await query(db().from('workspace_items').update({ payload: { ...row.payload, salary } }).eq('user_id', user.id).eq('kind', 'application').eq('id', row.id).eq('payload', JSON.stringify(row.payload)).select('id,payload').maybeSingle())
    return saved ? { id: Number(saved.id), salary: saved.payload.salary } : null
  }))).filter(Boolean)
  return json({ updated })
}
