import { checkAvailability, availabilityUrl } from './job-availability.mjs'
import { body, current, checkWrite, fail, json, limit } from './core.mjs'

export async function jobAvailability(request) {
  if (request.method !== 'POST') fail(405, 'Method not allowed.')
  const user = await current(request, true)
  checkWrite(request)
  const input = await body(request)
  if (!Array.isArray(input.urls) || !input.urls.length || input.urls.length > 12 || input.urls.some(url => typeof url !== 'string' || url.length > 2048 || !availabilityUrl(url))) fail(422, 'Choose up to 12 supported job listing URLs.')
  if (await limit('job-availability:' + user.id, 120)) fail(429, 'Too many availability checks. Try again later.')
  return json({ jobs: await checkAvailability([...new Set(input.urls)], input.fresh === true) })
}
