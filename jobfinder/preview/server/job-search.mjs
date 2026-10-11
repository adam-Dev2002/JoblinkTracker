const normalize = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()

// Every word in a group must match; comma-separated groups are alternatives.
// Search only provider-supplied listing fields, never general web pages.
export function matchesJobQuery(query, fields) {
  const groups = normalize(query)
    .split(',')
    .map((group) => group.trim().split(/\s+/).filter(Boolean))
    .filter((group) => group.length)
  if (!groups.length) return true
  const listing = normalize(fields.filter(Boolean).join(' '))
  return groups.some((words) => words.every((word) => listing.includes(word)))
}
