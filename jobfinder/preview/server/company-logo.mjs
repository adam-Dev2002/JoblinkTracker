import brands from './company-brands.json' with { type: 'json' }

export function validCompanyLogo(value) {
  if (typeof value !== 'string' || !value) return ''
  if (/^\/static\/company-logos\/[a-z0-9._-]+\.(?:png|jpe?g|webp|svg|ico)$/i.test(value)) return value
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''
  } catch { return '' }
}

export function companyLogo(company = '', provided = '') {
  return validCompanyLogo(provided) || validCompanyLogo(brands[company.trim().toLowerCase()]?.logo)
}
