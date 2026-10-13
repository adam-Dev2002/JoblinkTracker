const currencies = 'USD|PHP|EUR|GBP|AUD|CAD|NZD|SGD|HKD|JPY|INR|MYR|AED|SAR|ZAR|CHF|SEK|NOK|DKK|PLN|BRL|MXN'
const amount = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?\\s*[kK]?'
const currency = `(?:${currencies}|US\\$|A\\$|C\\$|[$₱€£₹¥])`
const money = new RegExp(`(${currency})\\s*(${amount})(?:\\s*(?:[-–—]|to)\\s*(${currency})?\\s*(${amount}))?`, 'gi')
const interval = /^\s*(?:(?:\/|per\s+|a\s+|an\s+)?(hours?|hrs?|h|days?|weeks?|wks?|months?|mos?|years?|yrs?|hourly|daily|weekly|monthly|annually|annual|yearly))\b/i
const periods = { hour: 'hour', hours: 'hour', hourly: 'hour', hr: 'hour', hrs: 'hour', h: 'hour', day: 'day', days: 'day', daily: 'day', week: 'week', weeks: 'week', weekly: 'week', wk: 'week', wks: 'week', month: 'month', months: 'month', monthly: 'month', mo: 'month', mos: 'month', year: 'year', years: 'year', yearly: 'year', annual: 'year', annually: 'year', yr: 'year', yrs: 'year' }
const clean = value => {
  if (typeof value !== 'string') return ''
  return value.slice(0, 2500000)
    .replace(/<(script|style|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(?:p|div|h[1-6]|br|li|section|tr|td)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(nbsp|amp|quot|apos|lt|gt|dollar|pound|euro);/gi, (_, name) => ({ nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', dollar: '$', pound: '£', euro: '€' })[name.toLowerCase()])
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => { const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code); return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '' })
    .replace(/[\t\r\u00a0 ]+/g, ' ').replace(/ *\n */g, '\n').trim()
}
const numeric = value => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).trim()
  if (!new RegExp(`^${amount}$`).test(text)) return null
  const number = Number(text.replace(/[,\sKk]/g, '')) * (/k$/i.test(text) ? 1000 : 1)
  return Number.isFinite(number) && number > 0 && number <= 1000000000 ? number : null
}
const numberText = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
const currencyText = value => {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return new RegExp(`^(?:${currencies}|US\\$|A\\$|C\\$|[$₱€£₹¥])$`).test(text) ? text : ''
}

export function jobSalaryListingUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return ''
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return ''
    const host = url.hostname.replace(/^www\./, '')
    const path = url.pathname
    const supported = host === 'onlinejobs.ph' ? /^\/jobseekers\/job\/[^/]+\/?$/.test(path)
      : /^(?:[a-z]{2}\.|m\.)?linkedin\.com$/.test(host) ? /^\/jobs\/view\/[^/]+\/?$/.test(path)
      : ['ph.jobstreet.com', 'jobstreet.com.ph'].includes(host) ? /^\/job\/\d+\/?$/.test(path)
      : /^(?:[a-z]{2}\.)?indeed\.com$/.test(host) ? /^\/(?:viewjob|m\/viewjob|rc\/clk)\/?$/.test(path) && Boolean(url.searchParams.get('jk'))
      : ['jobs.lever.co', 'jobs.ashbyhq.com'].includes(host) ? /^\/[^/]+\/[^/]+(?:\/apply|\/application)?\/?$/.test(path)
      : ['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(host) ? /^\/[^/]+\/jobs\/\d+(?:\/apply)?\/?$/.test(path)
      : ['remotive.com', 'remotive.io'].includes(host) ? /^\/remote-jobs\/(?:[^/]+\/)+[^/]+\/?$/.test(path)
      : host === 'jobicy.com' ? /^\/jobs\/\d+(?:-[^/]+)?\/?$/.test(path)
      : host === 'arbeitnow.com' ? /^\/jobs\/(?:companies\/)?[^/]+\/?$/.test(path) : false
    if (!supported) return ''
    url.protocol = 'https:'
    url.hash = ''
    return url.href
  } catch { return '' }
}

export function formatSalary({ currency, min, max, value, unit } = {}) {
  const code = currencyText(currency), low = numeric(min), high = numeric(max), exact = numeric(value)
  if (!code || (low === null && high === null && exact === null) || (low !== null && high !== null && high < low)) return ''
  const range = exact !== null ? numberText(exact) : low !== null && high !== null ? low === high ? numberText(low) : `${numberText(low)}–${numberText(high)}` : low !== null ? `From ${numberText(low)}` : `Up to ${numberText(high)}`
  const period = typeof unit === 'string' ? periods[unit.toLowerCase().trim()] : ''
  return `${code} ${range}${period ? '/' + period : ''}`
}

export function salaryFromText(value, { labeledOnly = false } = {}) {
  const text = clean(value).slice(0, 60000)
  const find = (fragment, labeled) => {
    for (const match of fragment.matchAll(new RegExp(money))) {
      const before = fragment.slice(Math.max(0, match.index - 65), match.index)
      if (/bonus|allowance|equipment|reimburse|referral|training fee|funding|revenue|insurance|budget/i.test(before)) continue
      if (match[3] && currencyText(match[3]) !== currencyText(match[1])) continue
      const after = fragment.slice(match.index + match[0].length)
      // Never interpret a partial decimal, time or account number as pay.
      if (/^[\d.,]/.test(after)) continue
      const unit = after.match(interval)?.[1]
      if (!labeled && !unit) continue
      let low = match[2], high = match[4]
      if (high && /k$/i.test(high) && !/k$/i.test(low) && numeric(low) < 1000) low += 'k'
      if (high && /k$/i.test(low) && !/k$/i.test(high) && numeric(high) < 1000) high += 'k'
      const salary = formatSalary({ currency: match[1], ...(high ? { min: low, max: high } : { value: low }), unit })
      if (salary) return salary
    }
    return ''
  }
  for (const label of text.matchAll(/\b(?:salary(?:\s*\/\s*range)?|compensation|base pay|pay rate|wages?)\b\s*[:\-]?/gi)) {
    const fragment = text.slice(label.index + label[0].length, label.index + label[0].length + 180).split('\n').slice(0, 3).join(' ')
    if (/^\s*(?:negotiable|competitive|not (?:disclosed|specified)|undisclosed)\b/i.test(fragment)) continue
    const salary = find(fragment, true)
    if (salary) return salary
  }
  return labeledOnly ? '' : find(text, false)
}

export function salaryFromJob(row, depth = 0) {
  if (!row || typeof row !== 'object' || depth > 4) return ''
  const structured = formatSalary({ currency: row.salaryCurrency || row.job_salary_currency || row.salary_currency, min: row.salaryMin ?? row.job_min_salary ?? row.min_salary, max: row.salaryMax ?? row.job_max_salary ?? row.max_salary, value: typeof row.salary === 'number' ? row.salary : typeof row.job_salary === 'number' ? row.job_salary : undefined, unit: row.salaryPeriod || row.job_salary_period || row.salary_period })
  if (structured) return structured
  const base = row.baseSalary || row.basesalary || (typeof row.salary === 'object' ? row.salary : null)
  if (base && typeof base === 'object') {
    const quantity = typeof base.value === 'object' ? base.value : base
    const salary = formatSalary({ currency: base.currency || quantity.currency, min: quantity.minValue, max: quantity.maxValue, value: typeof base.value === 'object' ? quantity.value : base.value, unit: quantity.unitText || base.unitText })
    if (salary) return salary
  }
  for (const value of [row.salary, row.job_salary_string, row.job_salary]) {
    const text = clean(value).slice(0, 500)
    if (text && !/^(?:n\/?a|none|null|not (?:disclosed|specified)|negotiable|competitive|0)$/i.test(text)) return text
  }
  for (const value of [row.description, row.jobDescription, row.job_description, row.content]) {
    const salary = salaryFromText(value)
    if (salary) return salary
  }
  for (const data of [row.pagemap?.jobposting, row.richSnippet?.jobposting, row.richSnippet?.jobPosting]) {
    for (const item of Array.isArray(data) ? data.slice(0, 5) : data ? [data] : []) {
      const salary = salaryFromJob(item, depth + 1)
      if (salary) return salary
    }
  }
  return ''
}

export function salaryFromHtml(html, expectedUrl = '') {
  if (typeof html !== 'string') return ''
  const postings = []
  const walk = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 10) return
    if (Array.isArray(value)) { for (const entry of value.slice(0, 100)) walk(entry, depth + 1); return }
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']]
    if (types.some(type => typeof type === 'string' && /(?:^|\/)JobPosting$/.test(type))) postings.push(value)
    for (const entry of Object.values(value)) if (entry && typeof entry === 'object') walk(entry, depth + 1)
  }
  for (const script of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(script[1])) } catch { /* A malformed block must not hide valid salary data elsewhere. */ }
  }
  const canonical = value => { try { const url = new URL(value); return url.origin.replace('://www.', '://') + url.pathname.replace(/\/$/, '') } catch { return '' } }
  if (postings.length > 1) {
    const matching = postings.filter(row => expectedUrl && canonical(row.url || row['@id']) === canonical(expectedUrl))
    return matching.length === 1 ? salaryFromJob(matching[0]) : ''
  }
  if (postings.length) {
    const salary = salaryFromJob(postings[0])
    if (salary) return salary
  }
  return salaryFromText(html, { labeledOnly: true })
}
