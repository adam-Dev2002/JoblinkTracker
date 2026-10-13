export { applicationStatuses, normalizeApplicationStatus } from '../server/application-status.mjs'

export const applicationStatusColors: Record<string, string> = {
  Saved: 'secondary',
  Unavailable: 'orange',
  Applied: 'green',
  Interview: 'green',
  Offer: 'green',
  Rejected: 'maroon',
  Ghosted: 'secondary',
}

export const applicationStatusColor = (status: string) => applicationStatusColors[status] || 'secondary'
