const terminal = /^(?:closed|filled|full|expired|inactive|unavailable|removed|deleted|archived|cancelled|canceled)$/i
const closure = /\b(?:this\s+)?(?:job(?:\s+(?:post(?:ing)?|listing|opening))?|advert|position|vacancy|role)\s+(?:(?:has|have)\s+(?:already\s+)?been|is|was)\s+(?:already\s+)?(?:closed|filled|full|expired|removed|no longer available)\b|\b(?:no longer|not)\s+accepting\s+(?:new\s+)?applications\b|\bapplications?\s+(?:are\s+|is\s+)?(?:closed|full)\b|\ball\s+(?:positions|vacancies|slots)\s+(?:have been\s+|are\s+)?filled\b/i

export function plainJobText(value) {
  return String(value || '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp|quot|apos|#39);/gi, value => ({ '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&apos;': "'", '&#39;': "'" }[value.toLowerCase()] || value)).replace(/\s+/g, ' ').trim()
}
export function hasClosureNotice(value) {
  const text = plainJobText(value).replace(/\b(?:until|before)\s+(?:the\s+)?(?:job|position)\s+is\s+(?:closed|filled)\b/gi, '')
  if (closure.test(text)) return true
  const lines = String(value || '').replace(/<br\s*\/?\s*>|<\/(?:p|div|h[1-6])>/gi, '\n').split(/\r?\n/).map(plainJobText)
  return lines.some(line => /^(?:role overview\s*)?(?:position|role|job|vacancy)\s+(?:filled|closed|expired)[.!]?$/i.test(line))
}
export function isClosedListing(row, now = Date.now()) {
  if (['availability', 'status', 'job_status', 'jobStatus'].some(field => terminal.test(String(row[field] || '').trim()))) return true
  if (['active', 'is_active', 'job_is_active', 'acceptingApplications'].some(field => row[field] === false || row[field] === 0 || row[field] === 'false')) return true
  if (['closed', 'filled', 'expired', 'is_closed', 'job_is_expired'].some(field => row[field] === true || row[field] === 1 || row[field] === 'true')) return true
  if (row.totalJobOpenings === 0 || row.vacancies === 0) return true
  for (const field of ['validThrough', 'expires_at', 'expiration_date', 'job_valid_through', 'job_offer_expiration_datetime_utc']) {
    const value = row[field]
    if (!value) continue
    // A date-only deadline remains valid through the end of that UTC day.
    const deadline = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T23:59:59.999Z' : value)
    if (Number.isFinite(deadline) && deadline < now) return true
  }
  const title = plainJobText(row.title || row.jobTitle || row.job_title)
  return /^(?:\[|\()?\s*(?:closed|filled|expired|hiring closed)\s*(?:\]|\)|[-:–—]|$)/i.test(title) || /\b(?:position|role|job|vacancy)\s+(?:filled|closed|expired)\b/i.test(title) || hasClosureNotice(title) || hasClosureNotice(row.description || row.jobDescription || row.job_description || row.content)
}
