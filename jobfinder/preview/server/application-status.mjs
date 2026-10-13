export const applicationStatuses = ['Saved', 'Unavailable', 'Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted']

/** @param {string} status */
export const normalizeApplicationStatus = status => status === 'Application opened' ? 'Saved' : status
