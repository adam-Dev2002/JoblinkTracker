export const applicationStatusColors: Record<string, string> = {
  Saved: 'secondary',
  'Application opened': 'azure',
  Unavailable: 'orange',
  Applied: 'blue',
  Interview: 'purple',
  Offer: 'green',
  Rejected: 'red',
  Ghosted: 'yellow',
}

export const applicationStatuses = Object.keys(applicationStatusColors)

export const applicationStatusColor = (status: string) => applicationStatusColors[status] || 'secondary'
