import { attachSuggestions } from './search-suggestions'
import { attachTrackedJobSearch } from './application-tracker'
import { attachTableActions } from './table-actions'
import { companyLogo, validCompanyLogo } from '../server/company-logo.mjs'
import { getSession } from '@shared/lib/client-session'
import { readPageData, writePageData } from '@shared/lib/page-data-cache'
import { wasPrerendered, whenPageActive } from '@shared/lib/page-activation'
import { createGoogleJobSearch, jobsPerPage, type GoogleJobResult } from './google-job-search'
import { googleJobListingUrl } from './google-job-query'
import { isClosedListing } from './job-availability.mjs'
import { makeApplicationIndex } from './application-index'
type Kind = 'application' | 'task' | 'task_status' | 'event' | 'link' | 'sheet'
type Attachment = { id: number; name: string; mime: string; size: number }
const sheetSelection = new Set<number>()
const hiddenSheetColumns = new Set<string>()
let visibleSheetIds: number[] = []
let visibleApplicationIds: number[] = []
let applicationPage = 1
let selectedApplicationId: number | null = null
const applicationSelection = new Set<number>()
let deletingApplicationRows = false
let sheetPage = 1
const workspaceRowsPerPage = 10
const recentApplicationLimit = 7
let deletingSheetRows = false
let sheetWriteQueue: Promise<void> = Promise.resolve()
type Entry = { id: number; kind: Kind; attachments?: Attachment[]; payload: Record<string, string> & { title: string; company: string; url: string; salary: string; status: string; notes: string; date: string; time: string; value: string } }
type Job = { id: string; title: string; company: string; location: string; role: string; url: string; applyUrl?: string; source: string; salary: string; date: string; direct: boolean; logo: string; workMode: string; employmentType: string; description: string; availability?: string }
const root = document.querySelector<HTMLElement>('[data-workspace-view]')!
const view = root.dataset.workspaceView!
const select = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!
const tableActionArrow = select<HTMLTemplateElement>('[data-table-action-arrow]')?.innerHTML || ''
const loginUrl = () => `/sign-in?returnTo=${encodeURIComponent(location.pathname + location.search)}`
const htmlEscape = (value: string | number | null | undefined) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' })
const today = () => dateFormatter.format(new Date())
const safeUrl = (value: string | undefined) => {
  if (value?.startsWith('/static/company-logos/') && !value.includes('..')) return value
  try {
    const url = new URL(value || '')
    return ['http:', 'https:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}
let items: Entry[] = []
let cacheOwner: number | null = null
let workspaceRevision = 0
let cachedWorkspace: Entry[] | null = null
let cachedWorkspaceOwner: number | null = null
let cachedWorkspaceRevision = -1
let indexedWorkspace: Entry[] | null = null
let indexedWorkspaceRevision = -1
let applicationIndex: ReturnType<typeof makeApplicationIndex<Entry>> | null = null
let jobs: Job[] = []
const jobSelection = new Map<string, Job>()
const googleJobs = new Map<string, Job>()
let googleResultsHost: HTMLElement | null = null
let visibleGoogleJobIds: string[] = []
let googleRenderGeneration = 0
const findJob = (id: string) => jobs.find((job) => job.id === id) || googleJobs.get(id)
const googleJobSearch =
  view === 'jobs'
    ? createGoogleJobSearch(root, (results, div) => {
        void renderGoogleJobs(results, div).catch(() => error('Google job listings could not be displayed. Try searching again.'))
      })
    : null
let visibleJobIds: string[] = []
let savingSelectedJobs = false
const pendingJobSaves = new Set<string>()
let jobsLoading = false
let jobSearchInitialized = false
let jobPage = 1
let jobSearchController: AbortController | null = null
type JobFeed = { jobs: Job[]; message: string; source?: string; mode?: string; searchUrl?: string; nextPage?: number | null; total?: number | null }
const jobFeedCache = new Map<string, { time: number; data: JobFeed }>()
let jobRequest = 0
let csrf = ''
let signedIn = false
let loaded = false
root.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((button) => {
  button.disabled = true
})
let month = new Date(today() + 'T12:00:00')
let editing: Entry | null = null
let modalPrefill: Record<string, string> = {}
let modalKind: Kind = 'application'
let restoreFocus: HTMLElement | null = null
const appStatuses = ['Saved', 'Application opened', 'Unavailable', 'Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted']
let taskStatuses = ['To do', 'In progress', 'Done']
const empty = (message: string) => `<div class="workspace-empty">${htmlEscape(message)}</div>`
function error(message: string) {
  const box = select('[data-workspace-error]')
  box.textContent = message
  box.classList.remove('d-none')
}
function clearError() {
  select('[data-workspace-error]').classList.add('d-none')
}
async function api(path: string, body?: object, signal?: AbortSignal) {
  const response = await fetch('/api/' + path, { credentials: 'same-origin', signal: signal ?? null, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) } : {}) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Unable to load your workspace.')
  if (body && path.startsWith('workspace/')) {
    workspaceRevision++
    window.dispatchEvent(new Event('joblink-workspace-changed'))
  }
  return data
}
function owned(kind: Kind) {
  return items.filter((item) => item.kind === kind)
}
function entriesPerPage(kind: 'application' | 'sheet' | 'job', count: number) {
  const value = select<HTMLSelectElement>(`[data-${kind}-entries]`)?.value
  return value === 'all' ? Math.max(1, count) : Number(value) || (kind === 'job' ? jobsPerPage : workspaceRowsPerPage)
}
function togglePageSelection(selection: Set<number>, ids: number[]) {
  const deselect = ids.length > 0 && ids.every(id => selection.has(id))
  for (const id of ids) if (deselect) selection.delete(id); else selection.add(id)
}
function cacheWorkspace() {
  if (cacheOwner === null || (cachedWorkspace === items && cachedWorkspaceOwner === cacheOwner && cachedWorkspaceRevision === workspaceRevision)) return
  writePageData('workspace', cacheOwner, items)
  cachedWorkspace = items
  cachedWorkspaceOwner = cacheOwner
  cachedWorkspaceRevision = workspaceRevision
}
function updateTableSelection(kind: 'application' | 'sheet') {
  const selection = kind === 'application' ? applicationSelection : sheetSelection
  const ids = kind === 'application' ? visibleApplicationIds : visibleSheetIds
  const busy = kind === 'application' ? deletingApplicationRows : deletingSheetRows
  const visible = new Set(ids)
  for (const id of selection) if (!visible.has(id)) selection.delete(id)
  const all = select<HTMLInputElement>(`[data-${kind}-all]`)
  all.checked = ids.length > 0 && ids.every(id => selection.has(id))
  all.indeterminate = selection.size > 0 && !all.checked
  all.disabled = !ids.length || busy
  select(`[data-${kind}-selection-toolbar]`).classList.toggle('d-none', !selection.size)
  select(`[data-${kind}-selected-count]`).textContent = kind === 'sheet' && !selection.size ? '' : `${selection.size} selected`
  select(`[data-${kind}-select-label]`).textContent = all.checked ? 'Deselect this page' : 'Select this page'
  select(`[data-${kind}-bulk-label]`).textContent = busy ? 'Removing...' : `Remove selected (${selection.size})`
  select<HTMLButtonElement>(`[data-${kind}-bulk]`).disabled = !selection.size || busy
  select<HTMLButtonElement>(`[data-${kind}-select]`).disabled = busy
  select<HTMLButtonElement>(`[data-${kind}-export-selected]`).disabled = busy
  select<HTMLSelectElement>(`[data-${kind}-entries]`).disabled = busy
  select(`[data-${kind}-rows]`).setAttribute('aria-busy', String(busy))
  root.querySelectorAll<HTMLInputElement>(`[data-${kind}-pick]`).forEach(input => {
    input.checked = selection.has(Number(input.getAttribute(`data-${kind}-pick`)))
    input.disabled = busy
    input.closest('tr')?.classList.toggle('table-active', input.checked)
  })
  root.querySelectorAll<HTMLButtonElement>(`[data-${kind}-actions]`).forEach(button => { button.disabled = busy })
}
function actionButtons(item: Entry) {
  return `<div class="d-flex gap-2"><button class="btn btn-sm btn-outline-secondary" data-edit="${item.id}">Edit</button><button class="btn btn-sm btn-outline-danger" data-delete="${item.id}" aria-label="Remove ${htmlEscape(item.payload.title)}">Remove</button></div>`
}
function statusSelect(item: Entry, statuses: string[]) {
  return `<select class="form-select form-select-sm" data-entry-status="${item.id}" aria-label="Status for ${htmlEscape(item.payload.title)}">${statuses.map((status) => `<option ${status === item.payload.status ? 'selected' : ''}>${htmlEscape(status)}</option>`).join('')}</select>`
}
const tableActions = ['applications', 'sheet'].includes(view) ? attachTableActions(root, id => owned(view === 'applications' ? 'application' : 'sheet').find(item => item.id === id)) : null
function filteredApplications() {
  const query = select<HTMLInputElement>('[data-item-search]').value.trim().toLowerCase()
  const status = select<HTMLSelectElement>('[data-status-filter]').value
  const company = select<HTMLSelectElement>('[data-application-company]').value
  return owned('application').filter(item => (!status || item.payload.status === status) && (!company || item.payload.company === company) && (selectedApplicationId !== null ? item.id === selectedApplicationId : Object.values(item.payload).join(' ').toLowerCase().includes(query)))
}
const dashboardCompanyLogos = new Map<string, string>()
const companyKey = (company: string) => company.trim().toLowerCase()
function storedApplicationLogo(item: Entry) {
  return companyLogo(item.payload.company || '', item.payload.logo || '') || dashboardCompanyLogos.get(companyKey(item.payload.company || '')) || ''
}
function applicationLogo(item: Entry) {
  const stored = storedApplicationLogo(item)
  if (stored) return stored
  // Fall back to the listing site's favicon, like the source icon on job cards.
  try {
    const url = new URL(safeUrl(item.payload.url) || '')
    return ['https:', 'http:'].includes(url.protocol) ? 'https://www.google.com/s2/favicons?' + new URLSearchParams({ domain: url.hostname.replace(/^www\./, ''), sz: '64' }) : ''
  } catch {
    return ''
  }
}
async function restoreDashboardLogos() {
  const recent = owned('application').sort((a, b) => b.id - a.id).slice(0, recentApplicationLimit)
  const sourceFor = (item: Entry) => (item.payload.source || /^Source:\s*(Remotive|Jobicy|Arbeitnow)\b/i.exec(item.payload.notes || '')?.[1] || '').toLowerCase()
  const sources = new Set(recent.filter(item => item.payload.company && !storedApplicationLogo(item)).map(sourceFor).filter(source => ['remotive', 'jobicy', 'arbeitnow'].includes(source)))
  await Promise.allSettled(Array.from(sources, async source => {
    const feed = await searchJobFeed('', source, AbortSignal.timeout(15000))
    let changed = false
    for (const item of recent.filter(item => sourceFor(item) === source && !storedApplicationLogo(item))) {
      const matches = feed.jobs.filter(job => companyKey(job.company) === companyKey(item.payload.company))
      const job = matches.find(job => safeUrl(job.url) === safeUrl(item.payload.url) || job.id === item.payload.jobId) || matches[0]
      const logo = validCompanyLogo(job?.logo)
      if (logo) { dashboardCompanyLogos.set(companyKey(item.payload.company), logo); changed = true }
    }
    if (changed && root.isConnected) render()
  }))
}
function render() {
  // Never confuse a pending or failed request with a genuinely empty workspace.
  if (!loaded) return
  cacheWorkspace()
  if (view === 'jobs' && jobSearchInitialized) {
    for (const [id, job] of jobSelection) if (!selectableJob(job)) jobSelection.delete(id)
    renderGoogleJobCards()
    if (jobs.length || !jobsLoading) renderJobs(false)
  }
  taskStatuses = ['To do', 'In progress', 'Done', ...owned('task_status').map((item) => item.payload.title)]
  const currentDate = today()
  const apps = owned('application'),
    tasks = owned('task'),
    events = owned('event')
      .filter((item) => item.payload.date >= currentDate)
      .sort((a, b) => (a.payload.date + a.payload.time).localeCompare(b.payload.date + b.payload.time))
  if (view === 'dashboard') {
    const stats: Record<string, number> = { applications: apps.filter(isApplied).length, interviews: apps.filter((i) => i.payload.status === 'Interview').length, tasks: tasks.filter((i) => i.payload.status !== 'Done').length, events: events.length }
    for (const [key, value] of Object.entries(stats)) select(`[data-stat="${key}"]`).textContent = String(value)
    select('[data-dashboard-applications]').innerHTML = apps.length
      ? `<ul class="list-group list-group-flush dashboard-application-list" aria-label="Recent applications">${apps
          .sort((a, b) => b.id - a.id)
          .slice(0, recentApplicationLimit)
          .map((item) => {
            const initials = (item.payload.company || item.payload.title).trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0] || '').join('').toUpperCase()
            const logo = applicationLogo(item)
            return `<li class="list-group-item dashboard-application-item" data-dashboard-application="${item.id}"><span class="avatar bg-secondary-lt rounded-3 position-relative"><span aria-hidden="true" data-dashboard-logo-fallback>${htmlEscape(initials)}</span>${logo ? `<img class="company-logo-fill" data-dashboard-company-logo src="${htmlEscape(logo)}" alt="${htmlEscape(item.payload.company)} logo" loading="lazy" decoding="async" referrerpolicy="no-referrer" />` : ''}</span><div class="dashboard-application-copy"><button type="button" class="dashboard-application-title" data-edit="${item.id}" title="${htmlEscape(item.payload.title)}" aria-label="Edit application ${htmlEscape(item.payload.title)}">${htmlEscape(item.payload.title)}</button><div class="dashboard-application-meta text-secondary"><span>${htmlEscape(item.payload.company || 'Company not specified')}</span>${item.payload.date ? `<time datetime="${htmlEscape(item.payload.date)}">${htmlEscape(item.payload.date)}</time>` : ''}</div></div><span class="badge bg-secondary-lt dashboard-application-status">${htmlEscape(item.payload.status)}</span></li>`
          })
          .join('')}</ul>`
      : empty('Your applications will appear here. Start with Find work or add one to your tracker.')
    root.querySelectorAll<HTMLImageElement>('[data-dashboard-company-logo]').forEach(image => image.addEventListener('error', () => image.remove(), { once: true }))
    select('[data-dashboard-tasks]').innerHTML =
      tasks
        .filter((i) => i.payload.status !== 'Done')
        .slice(0, 5)
        .map((i) => `<div class="border-bottom pb-3 mb-3"><strong>${htmlEscape(i.payload.title)}</strong><div class="text-secondary small">${htmlEscape(i.payload.date || 'No due date')}   ${htmlEscape(i.payload.status)}</div></div>`)
        .join('') || empty('A clear desk. Add a task when you are ready.')
  }
  if (view === 'applications') {
    tableActions?.close()
    const submitted = apps.filter(isApplied)
    const stats: Record<string, string | number> = {
      total: apps.length,
      open: apps.filter((i) => ['Applied', 'Interview', 'Offer'].includes(i.payload.status)).length,
      interview: apps.filter((i) => i.payload.status === 'Interview').length,
      offer: apps.filter((i) => i.payload.status === 'Offer').length,
      reply: submitted.length ? Math.round((apps.filter((i) => ['Interview', 'Offer', 'Rejected'].includes(i.payload.status)).length / submitted.length) * 100) + '%' : '0%',
    }
    for (const [key, value] of Object.entries(stats)) select(`[data-application-stat="${key}"]`).textContent = String(value)
    const companyFilter = select<HTMLSelectElement>('[data-application-company]')
    const previousCompany = companyFilter.value
    const companies = Array.from(new Set(apps.map(item => item.payload.company).filter(Boolean))).sort((a, b) => a.localeCompare(b))
    companyFilter.innerHTML = '<option value="">All companies</option>' + companies.map(company => `<option value="${htmlEscape(company)}">${htmlEscape(company)}</option>`).join('')
    companyFilter.value = companies.includes(previousCompany) ? previousCompany : ''
    const filtered = filteredApplications()
    const sort = select<HTMLSelectElement>('[data-application-sort]').value
    filtered.sort((a, b) => sort === 'oldest' ? (a.payload.date || '').localeCompare(b.payload.date || '') || a.id - b.id : ['title', 'company', 'status'].includes(sort) ? (a.payload[sort] || '').localeCompare(b.payload[sort] || '') : (b.payload.date || '').localeCompare(a.payload.date || ''))
    const perPage = entriesPerPage('application', filtered.length)
    applicationPage = Math.min(applicationPage, Math.max(1, Math.ceil(filtered.length / perPage)))
    const pageRows = filtered.slice((applicationPage - 1) * perPage, applicationPage * perPage)
    visibleApplicationIds = pageRows.map(item => item.id)
    select('[data-application-filter-count]').textContent = `${filtered.length} of ${apps.length} jobs`
    const activeFilters = Number(Boolean(select<HTMLSelectElement>('[data-status-filter]').value)) + Number(Boolean(companyFilter.value))
    const filterBadge = select('[data-application-filter-badge]')
    filterBadge.textContent = String(activeFilters)
    filterBadge.classList.toggle('d-none', activeFilters === 0)
    renderPagination(select('[data-application-pagination]'), filtered.length, applicationPage, 'data-application-page', 'applications', deletingApplicationRows, perPage)
    select('[data-application-rows]').innerHTML = pageRows
      .map((i) => {
        const initials = (i.payload.company || i.payload.title).trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0] || '').join('').toUpperCase()
        const logo = applicationLogo(i)
        return `<tr class="${applicationSelection.has(i.id) ? 'table-active' : ''}"><td><input type="checkbox" class="form-check-input m-0" data-application-pick="${i.id}" aria-label="Select ${htmlEscape(i.payload.title)} at ${htmlEscape(i.payload.company || 'unspecified company')}" ${applicationSelection.has(i.id) ? 'checked' : ''} /></td><td class="text-nowrap text-secondary">${htmlEscape(i.payload.date)}</td><td><strong>${htmlEscape(i.payload.title)}</strong>${safeUrl(i.payload.url) ? `<div><a href="${htmlEscape(safeUrl(i.payload.url))}" target="_blank" rel="noopener noreferrer" class="small">Original listing &nearr;</a></div>` : ''}</td><td><div class="d-flex align-items-center gap-2"><span class="avatar avatar-sm bg-secondary-lt rounded-3 position-relative flex-shrink-0"><span aria-hidden="true">${htmlEscape(initials)}</span>${logo ? `<img class="company-logo-fill" data-company-logo src="${htmlEscape(logo)}" alt="${htmlEscape(i.payload.company)} logo" loading="lazy" decoding="async" referrerpolicy="no-referrer" />` : ''}</span><span>${htmlEscape(i.payload.company || '—')}</span></div></td><td class="text-secondary">${htmlEscape(i.payload.salary || '—')}</td><td>${statusSelect(i, appStatuses)}</td><td class="text-secondary" style="min-width:160px">${htmlEscape(i.payload.notes || '—')}</td><td class="text-end"><button type="button" class="btn workspace-row-actions" data-application-actions="${i.id}" aria-label="Actions for ${htmlEscape(i.payload.title)}" aria-haspopup="menu" aria-controls="workspace-row-menu" aria-expanded="false">Actions ${tableActionArrow}</button></td></tr>`
      })
      .join('')
    root.querySelectorAll<HTMLImageElement>('[data-application-rows] img[data-company-logo]').forEach((image) => image.addEventListener('error', () => image.remove(), { once: true }))
    updateTableSelection('application')
    select('[data-application-empty]').innerHTML = filtered.length ? '' : empty(apps.length ? 'No tracked jobs match your search. Clear the search or choose another status.' : 'No applications yet. Add one or save a job from Find work.')
  }
  if (view === 'taskboard') {
    select('[data-task-board]').style.setProperty('--board-columns', taskStatuses.length === 4 ? '2' : '3')
    const palettes = [
      ['#3185df', '#eaf3ff'],
      ['#8070df', '#f0edff'],
      ['#27a77f', '#e8f8f1'],
      ['#d28a23', '#fff5df'],
      ['#c35886', '#fcecf3'],
    ]
    select('[data-task-board]').innerHTML =
      taskStatuses
        .map((status, index) => {
          const group = tasks.filter((item) => item.payload.status === status),
            custom = owned('task_status').find((item) => item.payload.title === status),
            palette = palettes[index % palettes.length]!
          return `<section class="task-lane" data-lane="${htmlEscape(status)}" aria-label="${htmlEscape(status)} tasks" style="--lane-accent:${palette[0]};--lane-tint:${palette[1]}"><div class="task-lane-header"><div class="d-flex align-items-center gap-2" style="min-width:0"><span class="task-lane-dot"></span><h3 class="mb-0 text-break">${htmlEscape(status)}</h3><span class="task-lane-count">${group.length}</span></div><div class="d-flex">${custom ? `<button class="btn btn-icon btn-sm text-danger" data-delete-status="${custom.id}" aria-label="Remove list ${htmlEscape(status)}">&times;</button>` : ''}</div></div><div class="task-lane-body" data-task-column="${htmlEscape(status)}">${group.map((item) => `<div class="task-card" draggable="true" data-task-card="${item.id}"><h3 class="mb-2">${htmlEscape(item.payload.title)}</h3><div class="task-notes text-secondary small" tabindex="0" aria-label="Notes for ${htmlEscape(item.payload.title)}">${htmlEscape(item.payload.notes)}</div>${item.payload.date ? `<div class="text-secondary small my-3">Due ${htmlEscape(item.payload.date)}</div>` : ''}${statusSelect(item, taskStatuses)}<div class="mt-3">${actionButtons(item)}</div></div>`).join('') || empty('No cards yet.')}</div><button class="trello-add-card" data-add="task" data-task-status="${htmlEscape(status)}" aria-label="Add a card to ${htmlEscape(status)}">+ Add a card</button></section>`
        })
        .join('') + '<button class="trello-add-list" data-add="task_status">+ Add another list</button>'
  }
  if (view === 'calendar') {
    select('[data-month-title]').textContent = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(month)
    const first = new Date(month.getFullYear(), month.getMonth(), 1),
      start = new Date(first)
    start.setDate(1 - first.getDay())
    let html = ''
    for (let n = 0; n < 42; n++) {
      const date = new Date(start)
      date.setDate(start.getDate() + n)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      html += `<div data-calendar-cell="${key}" class="calendar-day ${key === currentDate ? 'today' : ''} ${date.getMonth() !== month.getMonth() ? 'text-secondary bg-light' : ''}"><button class="btn btn-sm p-1 border-0" data-calendar-add="${key}" ${key === currentDate ? 'aria-current="date"' : ''} aria-label="Add event on ${key}">${date.getDate()}</button>${owned(
        'event',
      )
        .filter((i) => i.payload.date === key)
        .map((i) => `<button class="calendar-event w-100 border-0 text-start" data-edit="${i.id}" title="${htmlEscape(i.payload.title)}">${htmlEscape(i.payload.time)} ${htmlEscape(i.payload.title)}</button>`)
        .join('')}</div>`
    }
    select('[data-calendar]').innerHTML = html
  }
  if (view === 'calendar' || view === 'news')
    select('[data-event-list]').innerHTML =
      events
        .slice(0, 15)
        .map(
          (i) =>
            `<div class="p-3 border-bottom"><div class="d-flex justify-content-between gap-2"><div><strong>${htmlEscape(i.payload.title)}</strong><div class="small text-secondary mt-1">${htmlEscape(i.payload.date)} ${htmlEscape(i.payload.time)}   Manila</div><div class="small text-secondary">${htmlEscape(i.payload.notes)}</div></div>${actionButtons(i)}</div></div>`,
        )
        .join('') || empty('No upcoming events. Add interviews, deadlines, or career events to your calendar.')
  if (view === 'links') {
    const query = select<HTMLInputElement>('[data-item-search]').value.toLowerCase(),
      list = owned('link').filter((i) => Object.values(i.payload).join(' ').toLowerCase().includes(query))
    select('[data-link-list]').innerHTML =
      list
        .map(
          (i) =>
            `<div class="col-md-6 col-xl-4"><div class="card h-100"><div class="card-body"><a href="${htmlEscape(safeUrl(i.payload.url))}" target="_blank" rel="noopener noreferrer" class="job-title">${htmlEscape(i.payload.title)} &nearr;</a><p class="small text-secondary mt-2">${htmlEscape(i.payload.notes)}</p>${actionButtons(i)}</div></div></div>`,
        )
        .join('') || `<div class="col-12">${empty('Save job boards, company career pages, and useful resources here.')}</div>`
  }
  if (view === 'sheet') {
    tableActions?.close()
    const query = select<HTMLInputElement>('[data-sheet-search]').value.toLowerCase(),
      filter = select<HTMLSelectElement>('[data-sheet-filter]').value
    const companyFilter = select<HTMLSelectElement>('[data-sheet-company]'),
      company = companyFilter.value,
      sort = select<HTMLSelectElement>('[data-sheet-sort]').value
    companyFilter.replaceChildren()
    const any = document.createElement('option')
    any.value = ''
    any.textContent = 'All companies / categories'
    companyFilter.append(any)
    for (const name of [
      ...new Set(
        owned('sheet')
          .map((row) => row.payload.company)
          .filter(Boolean),
      ),
    ].sort()) {
      const option = document.createElement('option')
      option.value = name
      option.textContent = name
      companyFilter.append(option)
    }
    companyFilter.value = company
    const activeCompany = companyFilter.value
    const rows = owned('sheet').filter(
      (row) =>
        (!activeCompany || row.payload.company === activeCompany) &&
        Object.values(row.payload).join(' ').toLowerCase().includes(query) &&
        (filter === 'all' || (filter === 'files' && (row.attachments?.length || 0) > 0) || (filter === 'images' && row.attachments?.some((a) => a.mime.startsWith('image/'))) || (filter === 'none' && !row.attachments?.length)),
    )
    rows.sort((a, b) => (sort === 'title' ? a.payload.title.localeCompare(b.payload.title) : sort === 'company' ? a.payload.company.localeCompare(b.payload.company) : sort === 'oldest' ? a.id - b.id : b.id - a.id))
    const perPage = entriesPerPage('sheet', rows.length)
    sheetPage = Math.min(sheetPage, Math.max(1, Math.ceil(rows.length / perPage)))
    const pageStart = (sheetPage - 1) * perPage
    const pageRows = rows.slice(pageStart, pageStart + perPage)
    visibleSheetIds = pageRows.map((row) => row.id)
    renderPagination(select('[data-sheet-pagination]'), rows.length, sheetPage, 'data-sheet-page', 'rows', deletingSheetRows, perPage)
    const filterBadge = select('[data-sheet-filter-badge]')
    const activeFilters = Number(filter !== 'all') + Number(Boolean(activeCompany))
    filterBadge.textContent = String(activeFilters)
    filterBadge.classList.toggle('d-none', activeFilters === 0)
    select('[data-sheet-count]').textContent = rows.length + ' of ' + owned('sheet').length + ' rows'
    select('[data-sheet-rows]').innerHTML = pageRows
      .map(
        (i, rowIndex) =>
          `<tr class="${sheetSelection.has(i.id) ? 'table-active' : ''}"><td><input type="checkbox" class="form-check-input m-0" data-sheet-pick="${i.id}" aria-label="Select ${htmlEscape(i.payload.title)}" ${sheetSelection.has(i.id) ? 'checked' : ''} /></td><td class="text-secondary">${pageStart + rowIndex + 1}</td>${['title', 'company', 'value', 'notes'].map((field) => `<td data-sheet-column="${field}"><input class="form-control" value="${htmlEscape(i.payload[field])}" data-sheet-id="${i.id}" data-sheet-field="${field}" aria-label="${field} for ${htmlEscape(i.payload.title)}" /></td>`).join('')}<td data-sheet-column="attachments">${(i.attachments || []).map((a) => `<a class="d-flex align-items-center gap-2 mb-2 small" href="/api/workspace/attachments?id=${a.id}" target="_blank" rel="noopener">${a.mime.startsWith('image/') ? `<img src="/api/workspace/attachments?id=${a.id}&preview=1" alt="${htmlEscape(a.name)}" width="36" height="36" style="object-fit:cover;border-radius:5px" />` : ''}${htmlEscape(a.name)}</a>`).join('') || '<span class="text-secondary">—</span>'}</td><td class="text-end"><button type="button" class="btn workspace-row-actions" data-sheet-actions="${i.id}" aria-label="Actions for ${htmlEscape(i.payload.title)}" aria-haspopup="menu" aria-controls="workspace-row-menu" aria-expanded="false">Actions ${tableActionArrow}</button></td></tr>`,
      )
      .join('')
    root.querySelectorAll<HTMLElement>('[data-sheet-column]').forEach((cell) => cell.classList.toggle('d-none', hiddenSheetColumns.has(cell.dataset.sheetColumn!)))
    updateTableSelection('sheet')
    select('[data-sheet-empty]').innerHTML = rows.length ? '' : empty(owned('sheet').length ? 'No rows match your filters. Clear filters to see all rows.' : 'Your sheet is empty. Add your first row to start organizing information.')
  }
}
const labels: Record<string, string> = { title: 'Title / role', company: 'Company', url: 'Original website URL', salary: 'Salary / range', status: 'Status', notes: 'Notes', date: 'Date', time: 'Time (Manila)', value: 'Value' }
const fields: Record<Kind, string[]> = { application: ['title', 'company', 'url', 'salary', 'status', 'date', 'notes'], task: ['title', 'status', 'date', 'notes'], task_status: ['title'], event: ['title', 'date', 'time', 'notes'], link: ['title', 'url', 'notes'], sheet: ['title', 'company', 'value', 'notes'] }
function openModal(kind: Kind, item: Entry | null = null, prefill: Record<string, string> = {}) {
  if (!loaded) return
  if (!signedIn) {
    location.assign(loginUrl())
    return
  }
  editing = item
  modalPrefill = prefill
  modalKind = kind
  restoreFocus = document.activeElement as HTMLElement
  const data = item?.payload || prefill
  select('#entry-modal-title').textContent = (item ? 'Edit ' : 'Add ') + { application: 'application', task: 'task', task_status: 'list', event: 'event', link: 'link', sheet: 'row' }[kind]
  select('[data-entry-fields]').innerHTML = fields[kind]
    .map((field) => {
      const value = data[field] ?? (field === 'date' ? today() : field === 'status' ? (kind === 'task' ? 'To do' : 'Applied') : '')
      const id = 'entry-' + field,
        required = field === 'title' || (kind === 'event' && field === 'date') || (kind === 'link' && field === 'url')
      const input =
        field === 'notes'
          ? `<textarea class="form-control" id="${id}" name="${field}" maxlength="4000" rows="3">${htmlEscape(value)}</textarea>`
          : field === 'status'
            ? `<select class="form-select" id="${id}" name="status">${(kind === 'task' ? taskStatuses : appStatuses).map((s) => `<option ${s === value ? 'selected' : ''}>${htmlEscape(s)}</option>`).join('')}</select>`
            : `<input class="form-control" id="${id}" name="${field}" type="${['url', 'date', 'time'].includes(field) ? field : 'text'}" value="${htmlEscape(value)}" maxlength="500" ${required ? 'required' : ''} />`
      return `<div class="mb-3"><label class="form-label" for="${id}">${kind === 'task_status' ? 'Status name' : labels[field]}</label>${input}</div>`
    })
    .join('')
  if (kind === 'sheet')
    select('[data-entry-fields]').insertAdjacentHTML(
      'beforeend',
      '<div class="mb-3"><label class="form-label" for="entry-attachments">Pictures or files</label><input class="form-control" id="entry-attachments" type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.csv,.docx,.xlsx" /><div class="form-hint">Up to 3 files per upload, 2 MB each. Existing files remain attached.</div></div>',
    )
  select('[data-entry-modal]').classList.remove('d-none')
  select<HTMLInputElement>('#entry-title').focus()
}
window.addEventListener('jobify-save-article', (event) => {
  openModal('link', null, (event as CustomEvent<Record<string, string>>).detail)
})
function closeModal() {
  select('[data-entry-modal]').classList.add('d-none')
  restoreFocus?.focus()
}
async function save(kind: Kind, payload: Record<string, string>, id = 0, renderAfter = true) {
  const data = await api('workspace/items', { kind, payload, id })
  const index = items.findIndex((i) => i.id === data.item.id)
  if (index >= 0) {
    data.item.attachments = items[index]?.attachments || []
    items[index] = data.item
  } else items.unshift(data.item)
  cacheWorkspace()
  if (renderAfter) {
    if (!id && kind === 'application') applicationPage = 1
    if (!id && kind === 'sheet') sheetPage = 1
    render()
  }
  return data.item as Entry
}
let detailsFocus: HTMLElement | null = null
function closeJobDetails() {
  select('[data-job-details-modal]').classList.add('d-none')
  document.body.classList.remove('job-details-open')
  detailsFocus?.focus()
}
function showJobDetails(id: string) {
  const job = findJob(id)
  if (!job) return
  detailsFocus = document.activeElement as HTMLElement
  select('[data-details-title]').textContent = job.title
  select('[data-details-company]').textContent = job.company || new URL(job.url).hostname
  select('[data-details-description]').textContent = job.description || 'The source has not supplied a description for this job. Open the original listing for full details.'
  select('[data-details-tags]').innerHTML = [job.location, job.employmentType || 'Not specified', job.workMode, job.salary]
    .filter(Boolean)
    .map((value) => `<span class="job-tag">${htmlEscape(value)}</span>`)
    .join('')
  const logo = select('[data-details-logo]')
  logo.replaceChildren()
  logo.innerHTML = companyPlaceholder()
  if (safeUrl(job.logo)) {
    const image = document.createElement('img')
    image.src = safeUrl(job.logo)
    image.alt = job.company + ' logo'
    image.style.cssText = 'width:100%;height:100%;object-fit:contain;background:white;padding:4px;border-radius:inherit'
    image.addEventListener('load', () => logo.replaceChildren(image), { once: true })
  }
  const source = select('[data-details-source]')
  source.replaceChildren()
  source.append(document.createTextNode('Description supplied by ' + job.source + '. '))
  const website = document.createElement('a')
  website.href = new URL(safeUrl(job.url)).origin
  website.textContent = 'Visit source website ↗'
  website.className = 'd-inline-block'
  website.target = '_blank'
  website.rel = 'noopener noreferrer'
  website.dataset.jobSourceWebsite = ''
  source.append(website)
  const apply = select<HTMLAnchorElement>('[data-details-apply]')
  apply.href = safeUrl(job.url)
  apply.dataset.applyJob = job.id
  apply.textContent = job.direct ? 'Apply on company site' : 'Apply via source'
  select('[data-details-save]').dataset.track = job.id
  select('[data-job-details-modal]').classList.remove('d-none')
  document.body.classList.add('job-details-open')
  select('[data-job-close]').focus()
}
select('[data-job-details-modal]').addEventListener('click', (event) => {
  if (event.target === select('[data-job-details-modal]')) closeJobDetails()
})
document.addEventListener('keydown', (event) => {
  const modal = select('[data-job-details-modal]')
  if (modal.classList.contains('d-none')) return
  if (event.key === 'Escape') closeJobDetails()
  if (event.key === 'Tab') {
    const controls = Array.from(modal.querySelectorAll<HTMLElement>('button,a[href]'))
    const first = controls[0],
      last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }
})
let confirmationResolve: ((value: boolean) => void) | null = null
let confirmationAccepted = false
let confirmationFocus: HTMLElement | null = null
function confirmRemoval(message: string, title = 'Remove entry?'): Promise<boolean> {
  if (confirmationResolve) return Promise.resolve(false)
  confirmationFocus = document.activeElement as HTMLElement
  confirmationAccepted = false
  select('#workspace-confirm-title').textContent = title
  select('[data-confirm-message]').textContent = message
  return new Promise((resolve) => {
    confirmationResolve = resolve
    select<HTMLButtonElement>('[data-confirm-trigger]').click()
  })
}
select('[data-confirm-accept]').addEventListener('click', () => {
  confirmationAccepted = true
})
select('[data-confirm-modal]').addEventListener('hidden.bs.modal', () => {
  confirmationResolve?.(confirmationAccepted)
  confirmationResolve = null
  confirmationFocus?.focus()
})
let removalInProgress = false
const removalNouns: Record<Kind, string> = { application: 'application', sheet: 'row', task: 'task', event: 'event', link: 'link', task_status: 'list' }
function showRemovalSuccess(message: string) {
  select('[data-removal-success-message]').textContent = message
  select<HTMLButtonElement>('[data-removal-success-trigger]').click()
}
select('[data-removal-success-modal]').addEventListener('shown.bs.modal', () => {
  select('[data-removal-success-close]').focus()
})
select('[data-removal-success-modal]').addEventListener('hidden.bs.modal', () => {
  const fallback = root.querySelector<HTMLElement>('[data-application-all]:not(:disabled),[data-sheet-all]:not(:disabled),[data-job-select-all]:not(:disabled),#job-query,[data-add]:not(:disabled),[data-month-prev]')
  const focus = confirmationFocus?.isConnected && !confirmationFocus.hasAttribute('disabled') ? confirmationFocus : fallback
  focus?.focus({ preventScroll: true })
})
async function removeSelectedEntries(kind: 'application' | 'sheet', selection: Set<number>) {
  const ids = Array.from(selection)
  let removed = 0
  try {
    for (let offset = 0; offset < ids.length; offset += 200) {
      const data = await api('workspace/items', { action: 'bulk-delete', kind, ids: ids.slice(offset, offset + 200) })
      const removedIds = new Set<number>(data.deleted)
      items = items.filter(item => !removedIds.has(item.id))
      removedIds.forEach(id => selection.delete(id))
      removed += removedIds.size
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unable to remove the selected entries. Please try again.'
    throw new Error(removed ? `${removed} ${removalNouns[kind]}${removed === 1 ? '' : 's'} removed. ${message}` : message)
  }
  return `${removed} ${removalNouns[kind]}${removed === 1 ? ' was' : 's were'} removed. Any attached files were removed too.`
}
root.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement
  if (target.dataset.jobCard && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault()
    showJobDetails(target.dataset.jobCard)
  }
})
let draggedTask: number | null = null
root.addEventListener('dragstart', (event) => {
  const card = (event.target as Element).closest<HTMLElement>('[data-task-card]')
  if (!card) return
  draggedTask = Number(card.dataset.taskCard)
  event.dataTransfer?.setData('text/plain', String(draggedTask))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  card.classList.add('dragging')
})
root.addEventListener('dragover', (event) => {
  const lane = (event.target as Element).closest<HTMLElement>('.task-lane')
  if (lane && draggedTask !== null) {
    event.preventDefault()
    root.querySelectorAll('.drag-target').forEach((el) => el.classList.remove('drag-target'))
    lane.classList.add('drag-target')
  }
})
root.addEventListener('dragend', () => {
  draggedTask = null
  root.querySelectorAll('.dragging,.drag-target').forEach((el) => el.classList.remove('dragging', 'drag-target'))
})
async function dropTask(event: DragEvent) {
  const lane = (event.target as Element).closest<HTMLElement>('.task-lane')
  if (!lane || draggedTask === null) return
  event.preventDefault()
  const item = items.find((row) => row.id === draggedTask && row.kind === 'task')
  draggedTask = null
  root.querySelectorAll('.dragging,.drag-target').forEach((el) => el.classList.remove('dragging', 'drag-target'))
  if (!item || !lane.dataset.lane || item.payload.status === lane.dataset.lane) return
  try {
    await save('task', { ...item.payload, status: lane.dataset.lane }, item.id)
  } catch (e) {
    error(e instanceof Error ? e.message : 'Unable to move this card.')
    render()
  }
}
root.addEventListener('drop', (event) => {
  void dropTask(event)
})
async function handleClick(event: Event) {
  if ((event.target as Element).closest('[data-job-pick]')) return
  const target = (event.target as Element).closest<HTMLElement>('button,a,[data-calendar-cell],[data-job-card]')
  if (!target) return
  if (target.getAttribute('aria-disabled') === 'true') {
    event.preventDefault()
    return
  }
  if (target.dataset.applicationActions || target.dataset.sheetActions) {
    if (view === 'sheet') await sheetWriteQueue
    tableActions?.open(target as HTMLButtonElement)
    return
  }
  clearError()
  try {
    if (target.closest('[data-workspace-row-menu]')) tableActions?.close(true)
    if (target.hasAttribute('data-application-clear-filters')) {
      select<HTMLInputElement>('[data-item-search]').value = ''
      select<HTMLSelectElement>('[data-status-filter]').value = ''
      select<HTMLSelectElement>('[data-application-company]').value = ''
      selectedApplicationId = null
      applicationPage = 1
      applicationSearch?.close()
      render()
    }
    if (target.hasAttribute('data-application-select')) {
      togglePageSelection(applicationSelection, visibleApplicationIds)
      updateTableSelection('application')
      select('[data-application-all]').focus({ preventScroll: true })
    }
    if (target.hasAttribute('data-application-export-selected')) exportCsv('application', owned('application').filter(item => applicationSelection.has(item.id)))
    if (target.hasAttribute('data-application-bulk') && !removalInProgress && !deletingApplicationRows && applicationSelection.size && (await confirmRemoval('Remove ' + applicationSelection.size + ' selected applications and their attachments? This cannot be undone.', 'Remove selected applications?'))) {
      removalInProgress = true
      deletingApplicationRows = true
      updateTableSelection('application')
      let message = ''
      try {
        message = await removeSelectedEntries('application', applicationSelection)
      } finally {
        removalInProgress = false
        deletingApplicationRows = false
        render()
      }
      showRemovalSuccess(message)
    }
    if (target.dataset.applicationPage && !deletingApplicationRows) {
      applicationPage = Number(target.dataset.applicationPage)
      render()
      select('[data-application-table]').scrollIntoView({ block: 'start' })
      root.querySelector<HTMLButtonElement>(`[data-application-page="${applicationPage}"]`)?.focus({ preventScroll: true })
    }
    if (target.dataset.sheetPage && !deletingSheetRows) {
      await sheetWriteQueue
      sheetPage = Number(target.dataset.sheetPage)
      render()
      select('[data-sheet-table]').scrollIntoView({ block: 'start' })
      root.querySelector<HTMLButtonElement>(`[data-sheet-page="${sheetPage}"]`)?.focus({ preventScroll: true })
    }
    if (target.dataset.jobPage && !jobsLoading && !savingSelectedJobs) {
      select('[data-job-bulk-status]').classList.add('d-none')
      jobPage = Number(target.dataset.jobPage)
      renderJobs(false)
      select('.job-results-panel').scrollIntoView({ block: 'start' })
      root.querySelector<HTMLButtonElement>(`[data-job-page="${jobPage}"]`)?.focus({ preventScroll: true })
    }
    if (target.hasAttribute('data-job-bulk-save')) await saveSelectedJobs()
    if (target.hasAttribute('data-job-bulk-apply')) await saveSelectedJobs('Applied')
    if (target.hasAttribute('data-job-bulk-export')) exportSelectedJobs()
    if (target.hasAttribute('data-job-deselect') && !savingSelectedJobs) {
      jobSelection.clear()
      updateJobSelection()
    }
    if (target.hasAttribute('data-job-source-website') || target.hasAttribute('data-job-source-listing')) {
      event.preventDefault()
      const url = safeUrl(target.getAttribute('href') || '')
      if (url) {
        const popup = window.open('about:blank', '_blank')
        if (!popup) {
          error('Your browser blocked the source tab. Allow pop-ups for Joblink and try again.')
          return
        }
        popup.opener = null
        popup.location.href = url
      }
      return
    }
    if (target.hasAttribute('data-sheet-select')) {
      togglePageSelection(sheetSelection, visibleSheetIds)
      updateTableSelection('sheet')
    }
    if (target.hasAttribute('data-sheet-export-selected')) {
      await sheetWriteQueue
      exportCsv('sheet', owned('sheet').filter(item => sheetSelection.has(item.id)))
    }
    if (target.hasAttribute('data-sheet-clear-filters')) {
      sheetPage = 1
      select<HTMLInputElement>('[data-sheet-search]').value = ''
      select<HTMLSelectElement>('[data-sheet-filter]').value = 'all'
      select<HTMLSelectElement>('[data-sheet-company]').value = ''
      render()
    }
    if (target.hasAttribute('data-sheet-bulk') && !removalInProgress && !deletingSheetRows && sheetSelection.size && (await confirmRemoval('Remove ' + sheetSelection.size + ' selected rows and their attachments? This cannot be undone.', 'Remove selected rows?'))) {
      removalInProgress = true
      deletingSheetRows = true
      updateTableSelection('sheet')
      let message = ''
      try {
        await sheetWriteQueue
        message = await removeSelectedEntries('sheet', sheetSelection)
      } finally {
        removalInProgress = false
        deletingSheetRows = false
        render()
      }
      showRemovalSuccess(message)
    }
    if (target.dataset.jobCard) showJobDetails(target.dataset.jobCard)
    if (target.dataset.deleteStatus && !removalInProgress && (await confirmRemoval('Remove this list? Its tasks will move to To do.', 'Remove list?'))) {
      removalInProgress = true
      try {
        const data = await api('workspace/items', { action: 'delete-status', id: Number(target.dataset.deleteStatus) })
        items = items.filter((item) => item.id !== data.deleted)
        for (const item of data.updated) {
          const index = items.findIndex((current) => current.id === item.id)
          if (index >= 0) items[index] = item
        }
        render()
        showRemovalSuccess('The list was removed. Its tasks were moved to To do.')
      } finally {
        removalInProgress = false
      }
    }
    if (target.dataset.jobDetails) showJobDetails(target.dataset.jobDetails)
    if (target.hasAttribute('data-job-close')) closeJobDetails()
    if (target.dataset.applyJob) {
      event.preventDefault()
      if (!loaded) {
        error('Your account is still loading. Please try again in a moment.')
        return
      }
      const job = findJob(target.dataset.applyJob)
      if (!job || !safeUrl(job.url)) return
      if (!signedIn) {
        sessionStorage.setItem('jobify-pending-application', JSON.stringify(job))
        location.assign(loginUrl())
        return
      }
      const popup = window.open('about:blank', '_blank')
      if (!popup) {
        error('Your browser blocked the application tab. Allow pop-ups for Jobify and try again.')
        return
      }
      popup.opener = null
      target.setAttribute('aria-disabled', 'true')
      try {
        const data = await api('workspace/items', {
          action: 'open-application',
          kind: 'application',
          payload: { title: job.title, company: job.company, url: job.url, salary: job.salary, status: 'Application opened', date: today(), jobId: job.id, source: job.source, location: job.location, logo: validCompanyLogo(job.logo), notes: 'Source: ' + job.source },
        })
        const item = data.item as Entry
        const index = items.findIndex((i) => i.id === item.id)
        if (index >= 0) items[index] = item
        else items.unshift(item)
        cacheWorkspace()
        popup.location.href = safeUrl(job.applyUrl || job.url)
        closeJobDetails()
        render()
      } catch (e) {
        popup.close()
        throw e
      } finally {
        target.removeAttribute('aria-disabled')
      }
    }
    if ((target.dataset.markAppliedJob || target.dataset.markUnavailableJob) && !savingSelectedJobs && loaded) {
      const job = findJob((target.dataset.markAppliedJob || target.dataset.markUnavailableJob)!)
      if (job && !pendingJobSaves.has(job.id)) {
        pendingJobSaves.add(job.id)
        updateJobSelection()
        try {
          if (target.dataset.markUnavailableJob) {
            confirmationFocus = target
            await markJobUnavailable(job)
            showRemovalSuccess('The job was marked unavailable and removed from your listings. Change its tracker status to Saved to restore it.')
          } else await markJobApplied(job)
        } finally {
          pendingJobSaves.delete(job.id)
          updateJobSelection()
        }
      }
    }
    if (target.dataset.confirmApplication) {
      const item = items.find((i) => i.id === Number(target.dataset.confirmApplication))
      if (item) {
        const button = target as HTMLButtonElement
        button.disabled = true
        try {
          await save('application', { ...item.payload, status: 'Applied', date: today() }, item.id)
        } finally {
          button.disabled = false
        }
      }
    }
    if (target.hasAttribute('data-modal-close')) closeModal()
    if (target.dataset.add) openModal(target.dataset.add as Kind, null, target.dataset.taskStatus ? { status: target.dataset.taskStatus } : {})
    if (target.dataset.edit) {
      if (view === 'sheet') await sheetWriteQueue
      const item = items.find((i) => i.id === Number(target.dataset.edit))
      if (item) openModal(item.kind, item)
    }
    if (target.dataset.delete && !removalInProgress) {
      if (view === 'sheet') await sheetWriteQueue
      const id = Number(target.dataset.delete)
      const item = items.find(item => item.id === id)
      if (item && (await confirmRemoval(`Remove this ${removalNouns[item.kind]} and any attached files? This cannot be undone.`, `Remove ${removalNouns[item.kind]}?`))) {
        removalInProgress = true
        try {
          await api('workspace/items', { id, action: 'delete' })
          items = items.filter((i) => i.id !== id)
          render()
          showRemovalSuccess(`The ${removalNouns[item.kind]} was removed.${item.attachments?.length ? ' Any attached files were removed too.' : ''}`)
        } finally {
          removalInProgress = false
        }
      }
    }
    if (target.dataset.track) {
      if (savingSelectedJobs) return
      const job = findJob(target.dataset.track)
      if (job) closeJobDetails()
      if (job) openModal('application', null, { title: job.title, company: job.company, url: job.url, salary: job.salary, status: 'Saved', date: today(), jobId: job.id, source: job.source, location: job.location, logo: validCompanyLogo(job.logo), notes: 'Source: ' + job.source })
    }
    if (target.dataset.calendarAdd || target.dataset.calendarCell) openModal('event', null, { date: target.dataset.calendarAdd || target.dataset.calendarCell! })
    if (target.hasAttribute('data-month-prev')) {
      month.setMonth(month.getMonth() - 1, 1)
      render()
    }
    if (target.hasAttribute('data-month-next')) {
      month.setMonth(month.getMonth() + 1, 1)
      render()
    }
    if (target.hasAttribute('data-month-today')) {
      month = new Date(today() + 'T12:00:00')
      render()
    }
    if (target.dataset.export) {
      if (target.dataset.export === 'sheet') await sheetWriteQueue
      exportCsv(target.dataset.export as Kind)
    }
  } catch (e) {
    error(e instanceof Error ? e.message : 'Unable to save your changes.')
  }
}
root.addEventListener('click', (event) => {
  void handleClick(event)
})
async function handleChange(event: Event) {
  const target = event.target as HTMLInputElement
  try {
    if (target.matches('[data-entries-control]')) {
      if (cacheOwner !== null) writePageData('entries:' + view, cacheOwner, target.value)
      if (view === 'applications') { applicationPage = 1; applicationSelection.clear(); render() }
      if (view === 'sheet') { await sheetWriteQueue; sheetPage = 1; sheetSelection.clear(); render() }
      if (view === 'jobs') { jobPage = 1; jobSelection.clear(); select('[data-job-bulk-status]').classList.add('d-none'); renderJobs(false) }
      return
    }
    if (target.dataset.applicationPick) {
      const id = Number(target.dataset.applicationPick)
      if (target.checked) applicationSelection.add(id)
      else applicationSelection.delete(id)
      updateTableSelection('application')
      select<HTMLInputElement>(`[data-application-pick="${id}"]`)?.focus({ preventScroll: true })
    }
    if (target.hasAttribute('data-application-all')) {
      for (const id of visibleApplicationIds) {
        if (target.checked) applicationSelection.add(id)
        else applicationSelection.delete(id)
      }
      updateTableSelection('application')
      select('[data-application-all]').focus({ preventScroll: true })
    }
    if (target.dataset.jobPick && !savingSelectedJobs) {
      select('[data-job-bulk-status]').classList.add('d-none')
      const job = findJob(target.dataset.jobPick)
      if (job && target.checked && selectableJob(job)) jobSelection.set(job.id, job)
      else jobSelection.delete(target.dataset.jobPick)
      updateJobSelection()
    }
    if (target.hasAttribute('data-job-select-all') && !savingSelectedJobs) {
      select('[data-job-bulk-status]').classList.add('d-none')
      if (!target.checked) jobSelection.clear()
      else {
        for (const job of jobsInSelectionScope()) jobSelection.set(job.id, job)
      }
      updateJobSelection()
    }
    if (target.hasAttribute('data-sheet-column-toggle')) {
      if (target.checked) hiddenSheetColumns.delete(target.value)
      else hiddenSheetColumns.add(target.value)
      root.querySelectorAll<HTMLElement>('[data-sheet-column]').forEach(cell => cell.classList.toggle('d-none', hiddenSheetColumns.has(cell.dataset.sheetColumn!)))
    }
    if (target.dataset.sheetPick) {
      const id = Number(target.dataset.sheetPick)
      if (target.checked) sheetSelection.add(id)
      else sheetSelection.delete(id)
      updateTableSelection('sheet')
    }
    if (target.hasAttribute('data-sheet-all')) {
      for (const id of visibleSheetIds)
        if (target.checked) sheetSelection.add(id)
        else sheetSelection.delete(id)
      updateTableSelection('sheet')
    }
    if (target.dataset.entryStatus) {
      const i = items.find((i) => i.id === Number(target.dataset.entryStatus))
      if (i) await save(i.kind, { ...i.payload, status: target.value }, i.id)
    }
    if (target.dataset.sheetId) {
      const id = Number(target.dataset.sheetId),
        field = target.dataset.sheetField!,
        value = target.value
      select('[data-sheet-save-status]').textContent = 'Saving changes...'
      const write = sheetWriteQueue.then(async () => {
        const i = items.find((i) => i.id === id)
        if (i) await save('sheet', { ...i.payload, [field]: value }, id, false)
      })
      sheetWriteQueue = write.catch(() => {
        /* The change handler shows the failure. */
      })
      const pendingWrite = sheetWriteQueue
      await write
      if (sheetWriteQueue === pendingWrite) select('[data-sheet-save-status]').textContent = 'Changes saved.'
    }
  } catch (e) {
    error(e instanceof Error ? e.message : 'Unable to save.')
    if (target.dataset.sheetId) select('[data-sheet-save-status]').textContent = 'Changes could not be saved. Try again.'
    render()
  }
}
root.addEventListener('change', (event) => {
  void handleChange(event)
})
// Google handles events inside its widget. Capture our card controls first so
// its handlers cannot swallow details, save, selection, or source-link clicks.
root.addEventListener(
  'click',
  (event) => {
    if (!(event.target as Element).closest('.google-job-card')) return
    event.stopPropagation()
    void handleClick(event)
  },
  true,
)
root.addEventListener(
  'change',
  (event) => {
    if (!(event.target as Element).closest('.google-job-card')) return
    event.stopPropagation()
    void handleChange(event)
  },
  true,
)
root.addEventListener(
  'keydown',
  (event) => {
    const target = event.target as HTMLElement
    if (!target.closest('.google-job-card') || !['Enter', ' '].includes(event.key)) return
    const id = target.dataset.jobCard || target.dataset.jobDetails
    if (id) {
      event.preventDefault()
      event.stopPropagation()
      showJobDetails(id)
    } else if (target.hasAttribute('data-job-pick') && event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      const input = target as HTMLInputElement
      if (!input.disabled) {
        input.checked = !input.checked
        void handleChange(event)
      }
    } else if (target.hasAttribute('data-track') || target.hasAttribute('data-confirm-application') || target.hasAttribute('data-mark-applied-job') || target.hasAttribute('data-mark-unavailable-job') || (target.tagName === 'A' && event.key === 'Enter')) {
      event.preventDefault()
      event.stopPropagation()
      if (!(target instanceof HTMLButtonElement) || !target.disabled) void handleClick(event)
    }
  },
  true,
)
async function handleSubmit(event: Event) {
  event.preventDefault()
  const form = event.currentTarget as HTMLFormElement,
    button = form.querySelector<HTMLButtonElement>('[type="submit"]')!
  const original = editing?.payload || modalPrefill
  const data = { ...modalPrefill, ...editing?.payload, ...Object.fromEntries(new FormData(form)) } as Record<string, string>
  if (modalKind === 'application' && companyKey(data.company || '') !== companyKey(original.company || '')) data.logo = ''
  button.disabled = true
  clearError()
  try {
    const files = Array.from(form.querySelector<HTMLInputElement>('#entry-attachments')?.files || [])
    if (files.length > 3 || files.some((file) => file.size > 2097152)) throw new Error('Choose up to 3 files, 2 MB each.')
    const item = await save(modalKind, data, editing?.id || 0)
    editing = item
    for (const file of files) {
      const upload = new FormData()
      upload.append('itemId', String(item.id))
      upload.append('files[]', file)
      const response = await fetch('/api/workspace/attachments', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf }, body: upload })
      const result = await response.json()
      if (!response.ok) {
        const picker = form.querySelector<HTMLInputElement>('#entry-attachments')
        if (picker) picker.value = ''
        throw new Error((result.error || 'Upload failed.') + ' Your row and earlier uploads were saved. Select only the remaining files to retry.')
      }
      item.attachments = [...(item.attachments || []), ...result.attachments]
      workspaceRevision++
      window.dispatchEvent(new Event('joblink-workspace-changed'))
      render()
    }
    closeModal()
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unable to save.'
    error(message)
    const existing = form.querySelector('[data-upload-error]')
    existing?.remove()
    const notice = document.createElement('div')
    notice.className = 'alert alert-danger'
    notice.dataset.uploadError = ''
    notice.textContent = message
    select('[data-entry-fields]').prepend(notice)
  } finally {
    button.disabled = false
  }
}
select<HTMLFormElement>('[data-entry-form]').addEventListener('submit', (event) => {
  void handleSubmit(event)
})
select('[data-entry-modal]').addEventListener('click', (event) => {
  if (event.target === select('[data-entry-modal]')) closeModal()
})
document.addEventListener('keydown', (event) => {
  if (select('[data-entry-modal]').classList.contains('d-none')) return
  if (event.key === 'Escape') closeModal()
  if (event.key === 'Tab') {
    const focusable = Array.from(select('[data-entry-modal]').querySelectorAll<HTMLElement>('button,input,textarea,select,a[href]')).filter((el) => !el.hasAttribute('disabled'))
    const first = focusable[0],
      last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }
})
root.querySelector('[data-sheet-search]')?.addEventListener('input', () => {
  sheetPage = 1
  render()
})
for (const selector of ['[data-sheet-filter]', '[data-sheet-company]', '[data-sheet-sort]'])
  root.querySelector(selector)?.addEventListener('change', () => {
    sheetPage = 1
    render()
  })
const applicationSearch = view === 'applications' ? attachTrackedJobSearch(
  select<HTMLInputElement>('[data-item-search]'),
  select('[data-application-suggestions]'),
  () => {
    const status = select<HTMLSelectElement>('[data-status-filter]').value
    const company = select<HTMLSelectElement>('[data-application-company]').value
    return owned('application').filter(item => (!status || item.payload.status === status) && (!company || item.payload.company === company))
  },
  () => { selectedApplicationId = null; applicationPage = 1; render() },
  id => { selectedApplicationId = id; applicationPage = 1; render() },
) : null
if (view !== 'applications') root.querySelector('[data-item-search]')?.addEventListener('input', () => render())
for (const selector of ['[data-status-filter]', '[data-application-company]']) root.querySelector(selector)?.addEventListener('change', () => {
  applicationSearch?.close()
  selectedApplicationId = null
  applicationPage = 1
  render()
})
root.querySelector('[data-application-sort]')?.addEventListener('change', () => {
  applicationSearch?.close()
  applicationPage = 1
  render()
})
function exportCsv(kind: Kind, entries = owned(kind)) {
  const columns = fields[kind]
  const encode = (s: string) => '"' + (/^[=+@-]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"'
  const csv = [columns.map(encode).join(','), ...entries.map((i) => columns.map((c) => encode(i.payload[c] || '')).join(','))].join('\r\n')
  const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `jobify-${kind}-${today()}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function companyPlaceholder() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-label="Company logo unavailable"><rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V4h6v3M8 11h1m6 0h1m-8 4h1m6 0h1"/></svg>'
}
function updateJobSelection() {
  const busy = savingSelectedJobs || !loaded
  const all = select<HTMLInputElement>('[data-job-select-all]')
  const scope = jobsInSelectionScope()
  const visibleIds = scope.map(job => job.id)
  for (const id of jobSelection.keys()) if (!visibleIds.includes(id)) jobSelection.delete(id)
  const selectedVisible = visibleIds.filter((id) => jobSelection.has(id)).length
  const hasSelection = jobSelection.size > 0
  all.checked = scope.length > 0 && selectedVisible === scope.length
  all.indeterminate = selectedVisible > 0 && !all.checked
  all.disabled = busy || jobsLoading || scope.length === 0
  select('[data-job-selection-label]').textContent = all.checked ? 'Deselect this page' : 'Select this page'
  const googleOnly = select<HTMLSelectElement>('#job-source').value === 'google'
  select('[data-job-selection-scope]').textContent = 'Current page only'
  select('[data-job-selected-count]').textContent = `${jobSelection.size} selected`
  select('[data-job-entries-control]').classList.toggle('d-none', googleOnly)
  select<HTMLSelectElement>('[data-job-entries]').disabled = busy || jobsLoading
  select('[data-job-selection-actions]').classList.toggle('d-none', !hasSelection)
  for (const name of ['deselect', 'bulk-save', 'bulk-apply', 'bulk-export']) select<HTMLButtonElement>(`[data-job-${name}]`).disabled = busy || !hasSelection
  select('[data-job-selection-toolbar]').setAttribute('aria-busy', String(savingSelectedJobs))
  select('[data-job-selection-toolbar]').classList.toggle('d-none', scope.length === 0)
  root.querySelectorAll<HTMLInputElement>('[data-job-pick]').forEach((input) => {
    input.checked = jobSelection.has(input.dataset.jobPick!)
    input.disabled = busy || jobsLoading
    input.closest('[data-job-card]')?.classList.toggle('border-primary', input.checked)
  })
  root.querySelectorAll<HTMLButtonElement>('[data-track],[data-mark-applied-job],[data-mark-unavailable-job]').forEach((button) => {
    button.disabled = busy || pendingJobSaves.has((button.dataset.track || button.dataset.markAppliedJob || button.dataset.markUnavailableJob)!)
  })
  root.querySelectorAll<HTMLAnchorElement>('[data-apply-job]').forEach(link => {
    if (pendingJobSaves.has(link.dataset.applyJob!)) {
      link.setAttribute('aria-disabled', 'true')
      link.dataset.jobSaveBusy = ''
    } else if (link.hasAttribute('data-job-save-busy')) {
      link.removeAttribute('aria-disabled')
      delete link.dataset.jobSaveBusy
    }
  })
}
function getApplicationIndex() {
  if (!applicationIndex || indexedWorkspace !== items || indexedWorkspaceRevision !== workspaceRevision) {
    applicationIndex = makeApplicationIndex(owned('application'))
    indexedWorkspace = items
    indexedWorkspaceRevision = workspaceRevision
  }
  return applicationIndex
}
function trackedApplication(job: Job) {
  return getApplicationIndex().lookup(job)
}
function isApplied(item: Entry) {
  return ['Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted'].includes(item.payload.status)
}
function hasApplied(job: Job) {
  const item = trackedApplication(job)
  return Boolean(item && isApplied(item))
}
function selectableJob(job: Job) {
  // Saving or opening a listing never makes its card ineligible for selection.
  return !isClosedListing(job) && !getApplicationIndex().isUnavailable(job) && !hasApplied(job)
}
function jobsInSelectionScope() {
  return [...new Set([...visibleJobIds, ...visibleGoogleJobIds])]
    .map(findJob)
    .filter((job): job is Job => Boolean(job && selectableJob(job)))
}
function renderJobCard(job: Job, google?: { domain: string; origin: string; iconUrl: string }) {
  const id = htmlEscape(job.id)
  const title = htmlEscape(job.title)
  const logo = google
    ? `${companyPlaceholder().replace('Company logo unavailable', 'Source icon unavailable')}<img data-source-icon src="${htmlEscape(google.iconUrl)}" alt="${htmlEscape(google.domain)} source icon" loading="lazy" referrerpolicy="no-referrer" />`
    : `<span data-company-placeholder>${companyPlaceholder()}</span>${safeUrl(job.logo) ? `<img data-company-logo src="${htmlEscape(safeUrl(job.logo))}" alt="${htmlEscape(job.company)} logo" loading="lazy" referrerpolicy="no-referrer" />` : ''}`
  const identity = google
    ? `<a class="google-job-source fw-semibold" data-job-source-website href="${htmlEscape(google.origin)}" target="_blank" rel="noopener noreferrer" aria-label="Visit ${htmlEscape(google.domain)} website">${htmlEscape(google.domain)} &nearr;</a><span class="text-secondary small">Found on Google</span>`
    : `<div class="fw-semibold">${htmlEscape(job.company)}</div><span class="text-secondary small" data-job-location>${htmlEscape(job.location)}</span>`
  const metadata = `<div class="d-flex flex-wrap gap-2"><span class="job-tag">${htmlEscape(job.role || 'Job listing')}</span><span class="job-tag">${htmlEscape(job.workMode || 'Check listing')}</span><span class="job-tag">${htmlEscape(job.employmentType || 'Not specified')}</span>${job.salary ? `<span class="job-tag">${htmlEscape(job.salary)}</span>` : ''}</div>`
  const source = google
    ? `Source: Google &middot; <a data-job-source-listing href="${htmlEscape(job.url)}" target="_blank" rel="noopener noreferrer">Original listing &nearr;</a>`
    : `Source: <a href="${htmlEscape(safeUrl(job.url))}" target="_blank" rel="noopener noreferrer">${htmlEscape(job.source)}</a>${job.date ? ' | ' + htmlEscape(job.date.slice(0, 10)) : ''}`
  return `<article class="card job-card${google ? ' google-job-card' : ''}" data-job-card="${id}" tabindex="0" aria-label="Read description for ${title}">
    <div class="card-body d-flex flex-column">
      <div class="d-flex align-items-center gap-3 mb-3">
        <span class="avatar bg-white border rounded-3 position-relative text-blue flex-shrink-0">${logo}</span>
        <div class="job-card-identity flex-grow-1">${identity}</div>
        <input type="checkbox" class="form-check-input job-pick ms-auto" data-job-pick="${id}" aria-label="Select ${title}${google ? '' : ' at ' + htmlEscape(job.company)}" />
      </div>
      <h3 class="job-title"><button class="job-title-link" data-job-details="${id}">${title}</button></h3>
      <button class="job-details-link" data-job-details="${id}">Read job description &rarr;</button>
      <div class="job-card-metadata mb-3">${metadata}</div>
      <p class="text-secondary small mb-3">${source}</p>
      <div class="job-card-footer">
        <div class="d-flex gap-2 job-card-actions">
          <a class="btn btn-primary flex-grow-1" href="${htmlEscape(safeUrl(job.applyUrl || job.url))}" target="_blank" rel="noopener noreferrer" data-apply-job="${id}">${job.direct ? 'Apply on company site' : 'Apply via source'} &nearr;</a>
          <button class="btn" data-track="${id}" aria-label="Save ${title}">Save</button>
        </div>
        <button type="button" class="btn btn-outline-success" data-mark-applied-job="${id}" aria-label="Mark as applied: ${title}">Mark as applied</button>
        <button type="button" class="btn btn-outline-secondary" data-mark-unavailable-job="${id}" aria-label="Mark unavailable: ${title}">Mark unavailable</button>
      </div>
    </div>
  </article>`
}
async function renderGoogleJobs(results: GoogleJobResult[], div: HTMLElement) {
  const generation = ++googleRenderGeneration
  select('[data-job-bulk-status]').classList.add('d-none')
  googleResultsHost = null
  const cachedPreview = select('[data-google-jobs-preview]')
  if (div !== cachedPreview) {
    cachedPreview.replaceChildren()
    cachedPreview.classList.add('d-none')
  }
  visibleGoogleJobIds = []
  updateJobSelection()
  const text = (value: string) => new DOMParser().parseFromString(value, 'text/html').body.textContent?.trim() || ''
  const listings = await Promise.all(
    results.map(async (result) => {
      const url = safeUrl(result.listingUrl || result.url)
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url))
      const id =
        'google:' +
        Array.from(new Uint8Array(hash))
          .map((value) => value.toString(16).padStart(2, '0'))
          .join('')
      return {
        id,
        title: text(result.title).slice(0, 500),
        company: '',
        location: '',
        role: '',
        url,
        applyUrl: safeUrl(result.url),
        source: 'Google · ' + new URL(url).hostname,
        salary: '',
        date: '',
        direct: false,
        logo: '',
        workMode: 'Check listing',
        employmentType: 'Not specified',
        description: 'Google search summary:\n\n' + text(result.content || '') + '\n\nOpen the original listing for the full description, employer details, and posting date.',
      } as Job
    }),
  )
  if (generation !== googleRenderGeneration || !div.isConnected || select('[data-google-jobs]').classList.contains('d-none')) return
  if (div !== cachedPreview) {
    cachedPreview.replaceChildren()
    cachedPreview.classList.add('d-none')
    if (cacheOwner !== null) writePageData(googleCacheKey(), cacheOwner, results)
  }
  googleJobs.clear()
  for (const job of listings) googleJobs.set(job.id, job)
  googleResultsHost = div
  renderGoogleJobCards()
}
function renderGoogleJobCards() {
  const div = googleResultsHost
  if (!div?.isConnected || select('[data-google-jobs]').classList.contains('d-none')) return
  const listings = Array.from(googleJobs.values()).filter(selectableJob)
  visibleGoogleJobIds = listings.map((job) => job.id)
  div.innerHTML =
    '<div class="google-job-grid">' +
    listings
      .map((job) => {
        const website = new URL(job.url)
        const domain = website.hostname.replace(/^www\./, '')
        const iconUrl = 'https://www.google.com/s2/favicons?' + new URLSearchParams({ domain: website.hostname, sz: '64' })
        return renderJobCard(job, { domain, origin: website.origin, iconUrl })
      })
      .join('') +
    (listings.length ? '' : '<p class="text-secondary mb-0">No unapplied jobs available on this Google results page. Try another page or broader keywords.</p>') +
    '</div>'
  div.querySelectorAll<HTMLImageElement>('[data-source-icon]').forEach((image) => image.addEventListener('error', () => image.remove(), { once: true }))
  if (select<HTMLSelectElement>('#job-source').value === 'google') select('[data-job-count]').textContent = `${listings.length} results on this page`
  googleJobSearch?.updateResultCount(listings.length)
  updateJobSelection()
}
function jobBulkStatus(message: string) {
  const status = select('[data-job-bulk-status]')
  status.textContent = message
  status.classList.remove('d-none')
}
function jobApplicationPayload(job: Job, status: string) {
  return { title: job.title, company: job.company, url: job.url, salary: job.salary || '', status, date: today(), jobId: job.id, source: job.source, location: job.location, logo: validCompanyLogo(job.logo), notes: 'Source: ' + job.source }
}
async function markJobApplied(job: Job, renderAfter = true) {
  const existing = trackedApplication(job)
  if (existing && isApplied(existing)) { if (renderAfter) render(); return existing }
  return save('application', existing ? { ...existing.payload, status: 'Applied', date: today() } : jobApplicationPayload(job, 'Applied'), existing?.id || 0, renderAfter)
}
async function markJobUnavailable(job: Job) {
  const existing = trackedApplication(job)
  return save('application', existing ? { ...existing.payload, status: 'Unavailable' } : jobApplicationPayload(job, 'Unavailable'), existing?.id || 0)
}
async function saveSelectedJobs(status: 'Saved' | 'Applied' = 'Saved') {
  if (savingSelectedJobs || !loaded || !jobSelection.size) return
  if (!signedIn) {
    location.assign(loginUrl())
    return
  }
  savingSelectedJobs = true
  updateJobSelection()
  const selectedJobs = Array.from(jobSelection.values())
  let saved = 0,
    skipped = 0,
    failed = 0
  let failureMessage = ''
  try {
    for (const job of selectedJobs) {
      jobBulkStatus(`${status === 'Applied' ? 'Marking selected jobs as applied' : 'Saving selected jobs'}… ${saved + skipped + failed} of ${selectedJobs.length}`)
      const existing = trackedApplication(job)
      if (existing && (status === 'Saved' || isApplied(existing))) {
        skipped++
        jobSelection.delete(job.id)
        continue
      }
      try {
        if (status === 'Applied') await markJobApplied(job, false)
        else await save('application', jobApplicationPayload(job, 'Saved'), 0, false)
        saved++
        jobSelection.delete(job.id)
      } catch (e) {
        failed++
        failureMessage = e instanceof Error ? e.message : 'Unable to save.'
      }
    }
    jobBulkStatus(`${saved} ${saved === 1 ? 'job' : 'jobs'} ${status === 'Applied' ? 'marked as applied' : 'saved'}.${skipped ? ` ${skipped} already ${status === 'Applied' ? 'applied' : 'in your tracker'}.` : ''}${failed ? ` ${failed} could not be ${status === 'Applied' ? 'marked as applied' : 'saved'} and remain selected. Try ${status === 'Applied' ? 'Mark selected as applied' : 'Save selected'} again.` : ''}`)
    if (failed) error(failureMessage)
  } finally {
    savingSelectedJobs = false
    render()
    updateJobSelection()
  }
}
function exportSelectedJobs() {
  if (savingSelectedJobs || !jobSelection.size) return
  const columns = ['title', 'company', 'location', 'employmentType', 'salary', 'source', 'url'] as const
  const cell = (value: string) => '"' + value.replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""') + '"'
  const csv = [columns.map(cell).join(','), ...Array.from(jobSelection.values()).map((job) => columns.map((column) => cell(job[column] || '')).join(','))].join('\r\n')
  const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `joblink-selected-jobs-${today()}.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function renderPagination(nav: HTMLElement, count: number, page: number, attribute: string, noun: string, busy = false, perPage = workspaceRowsPerPage) {
  const pages = Math.ceil(count / perPage)
  nav.classList.toggle('d-none', count === 0)
  if (count === 0) {
    nav.innerHTML = ''
    return
  }
  const button = (targetPage: number, label: string, disabled = false) =>
    `<li class="page-item ${targetPage === page && /^\d+$/.test(label) ? 'active' : ''}"><button type="button" class="page-link" ${attribute}="${targetPage}" ${disabled || busy ? 'disabled' : ''} ${targetPage === page && /^\d+$/.test(label) ? 'aria-current="page"' : ''} aria-label="${/^\d+$/.test(label) ? 'Page ' + label : label + ' page'}">${label}</button></li>`
  const window = [...new Set([1, ...Array.from({ length: 5 }, (_, i) => page - 2 + i), pages])].filter((page) => page > 0 && page <= pages).sort((a, b) => a - b)
  let links = page > 1 ? button(page - 1, 'Previous') : ''
  window.forEach((page, index) => {
    if (index > 0 && page - window[index - 1]! > 1) links += '<li class="page-item disabled"><span class="page-link" aria-hidden="true">…</span></li>'
    links += button(page, String(page))
  })
  links += button(page + 1, 'Next', page === pages)
  nav.innerHTML = `<p class="text-secondary small mb-0 workspace-page-count" role="status">Showing ${(page - 1) * perPage + 1}–${Math.min(page * perPage, count)} of ${count} ${noun}</p>${pages > 1 ? `<ul class="pagination mb-0">${links}</ul>` : ''}`
}
function renderJobPagination(count: number) {
  renderPagination(select('[data-job-pagination]'), count, jobPage, 'data-job-page', 'results', savingSelectedJobs, entriesPerPage('job', count))
}
function renderJobs(resetPage = true) {
  if (resetPage) { jobPage = 1; select('[data-job-bulk-status]').classList.add('d-none') }
  if (cacheOwner !== null) writePageData('job-filters', cacheOwner, { values: jobFilterValues(), page: jobPage })
  if (select<HTMLSelectElement>('#job-source').value === 'google') {
    visibleJobIds = []
    select('[data-job-results]').innerHTML = ''
    select('[data-job-pagination]').classList.add('d-none')
    select('[data-job-count]').textContent = `${visibleGoogleJobIds.length} results on this page`
    updateJobSelection()
    return
  }
  const location = select<HTMLInputElement>('#job-location').value.trim().toLowerCase(),
    employment = select<HTMLSelectElement>('#job-employment').value,
    listingTime = select<HTMLSelectElement>('#job-listing-time').value,
    classification = select<HTMLSelectElement>('#job-classification').value
  const now = Date.now(),
    cutoff = now - Number(listingTime) * 86400000
  const list = jobs.filter((j) => {
    // Feed timestamps without an offset are interpreted in UTC on every device.
    const date = (j.date || '').trim()
    const timestamp = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(date) ? date + 'T00:00:00Z' : /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(date) ? date.replace(' ', 'T') + 'Z' : date)
    return selectableJob(j) && (!classification || j.role === classification) && (!location || j.location.toLowerCase().includes(location)) && (!employment || (j.employmentType || 'Not specified') === employment) && (!listingTime || (Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= now))
  })
  const perPage = entriesPerPage('job', list.length)
  jobPage = Math.min(jobPage, Math.max(1, Math.ceil(list.length / perPage)))
  const pageJobs = list.slice((jobPage - 1) * perPage, jobPage * perPage)
  visibleJobIds = pageJobs.map(job => job.id)
  renderJobPagination(list.length)
  select('[data-job-count]').textContent = `${list.length} results`
  select('[data-job-results]').innerHTML =
    pageJobs
      .map((job) => `<div class="col-md-6 col-xl-4">${renderJobCard(job)}</div>`)
      .join('') || `<div class="col-12">${empty('No jobs match your search. Try broader keywords or filters.')}</div>`
  root.querySelectorAll<HTMLImageElement>('[data-company-logo]').forEach((image) => image.addEventListener('error', () => image.remove(), { once: true }))
  updateJobSelection()
}
async function searchJobFeed(q: string, source: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ q, source })
  const key = params.toString()
  const cached = jobFeedCache.get(key)
  if (cached && Date.now() - cached.time < 300000) return cached.data
  const data = (await api('jobs/search?' + key, undefined, signal)) as JobFeed
  jobFeedCache.set(key, { time: Date.now(), data })
  if (cacheOwner !== null) writePageData('jobs:' + key, cacheOwner, data)
  if (jobFeedCache.size > 12) jobFeedCache.delete(jobFeedCache.keys().next().value!)
  return data
}
const jobFilterIds = ['job-query', 'job-source', 'job-location', 'job-employment', 'job-listing-time', 'job-classification']
function jobFilterValues() {
  return jobFilterIds.map(id => select<HTMLInputElement | HTMLSelectElement>('#' + id).value)
}
function googleCacheKey() {
  return 'google:' + root.dataset.googleEngineId + ':' + JSON.stringify(jobFilterValues())
}
function searchGoogleJobs() {
  const source = select<HTMLSelectElement>('#job-source').value
  root.dataset.jobSource = source
  const filters = {
    keyword: select<HTMLInputElement>('#job-query').value,
    location: select<HTMLInputElement>('#job-location').value,
    employment: select<HTMLSelectElement>('#job-employment').value,
    listingTime: select<HTMLSelectElement>('#job-listing-time').value,
    classification: select<HTMLSelectElement>('#job-classification').value,
  }
  googleRenderGeneration++
  visibleGoogleJobIds = []
  if (source === 'google' || (source === 'all' && filters.keyword.trim())) {
    void googleJobSearch?.search(filters)
    const preview = select('[data-google-jobs-preview]')
    const cached = cacheOwner === null ? null : readPageData<GoogleJobResult[]>(googleCacheKey(), cacheOwner)
    if (cached && !select('[data-google-jobs-host]').querySelector('.google-job-card')) {
      preview.classList.remove('d-none')
      void renderGoogleJobs(cached, preview)
    } else if (!select('[data-google-jobs]').querySelector('.google-job-card') && select('[data-google-jobs]').getAttribute('aria-busy') === 'true') {
      preview.innerHTML = select<HTMLTemplateElement>('[data-job-placeholder]').innerHTML
      preview.classList.remove('d-none')
    }
  } else googleJobSearch?.hide()
}
async function loadJobs(preservePage = false) {
  const request = ++jobRequest
  jobSearchController?.abort()
  jobSearchController = new AbortController()
  jobsLoading = true
  select('[data-job-bulk-status]').classList.add('d-none')
  visibleJobIds = []
  updateJobSelection()
  clearError()
  searchGoogleJobs()
  select('[data-job-pagination]').classList.add('d-none')
  const q = select<HTMLInputElement>('#job-query').value,
    source = select<HTMLSelectElement>('#job-source').value
  const cached = cacheOwner === null ? null : readPageData<JobFeed>('jobs:' + new URLSearchParams({ q, source }).toString(), cacheOwner)
  if (cached && source !== 'google') {
    jobs = cached.jobs
    select('[data-feed-message]').textContent = cached.message
    renderJobs(!preservePage)
    preservePage = true
    jobsLoading = false
    updateJobSelection()
  } else if (!jobs.length) {
    select('[data-job-results]').innerHTML = '<div class="col-12">' + select<HTMLTemplateElement>('[data-job-placeholder]').innerHTML + '</div>'
    select('[data-feed-message]').textContent = 'Loading job listings…'
  }
  const form = select<HTMLFormElement>('[data-job-search]')
  form.setAttribute('aria-busy', 'true')
  try {
    if (source === 'google') {
      jobs = []
      select('[data-feed-message]').textContent = 'Google searches indexed job-detail pages. Review each original listing before applying.'
      renderJobs(!preservePage)
      return
    }
    const data = await searchJobFeed(q, source, AbortSignal.any([jobSearchController.signal, AbortSignal.timeout(15000)]))
    if (request !== jobRequest) return
    jobs = [...data.jobs]
    select('[data-feed-message]').textContent = data.message
    if (!cached || JSON.stringify(cached.jobs) !== JSON.stringify(data.jobs) || cached.message !== data.message) renderJobs(!preservePage)
    if (data.mode === 'external' && safeUrl(data.searchUrl))
      select('[data-job-results]').innerHTML =
        `<div class="col-12"><div class="card card-body text-center"><h3>Search ${htmlEscape(data.source)} directly</h3><p class="text-secondary">${htmlEscape(data.message)}</p><a class="btn btn-primary align-self-center" href="${htmlEscape(safeUrl(data.searchUrl))}" target="_blank" rel="noopener noreferrer">Open official search &nearr;</a></div></div>`
  } catch (e) {
    if (request !== jobRequest) return
    if (jobs.length) {
      select('[data-feed-message]').textContent = 'Could not refresh the feed. Showing the last loaded listings.'
    } else {
      select('[data-job-results]').innerHTML = '<div class="col-12">' + empty('Job listings could not load. Try another feed or search again.') + '</div>'
      select('[data-feed-message]').textContent = 'The feed is currently unavailable. Try another feed or search again later.'
    }
    error(e instanceof Error && e.name === 'TimeoutError' ? 'This feed took too long to respond. Please try another feed or search again later.' : e instanceof Error ? e.message : 'Unable to search.')
  } finally {
    if (request === jobRequest) {
      jobsLoading = false
      form.setAttribute('aria-busy', 'false')
      updateJobSelection()
    }
  }
}
window.addEventListener('jobify-session', (event) => {
  const user = (event as CustomEvent<{ id: number } | null>).detail
  if (loaded && (!user || user.id !== cacheOwner)) {
    signedIn = Boolean(user)
    loaded = false
    cacheOwner = null
    items = []
    root.hidden = true
    if (user) location.reload()
    else location.replace(loginUrl())
  }
})
function initJobSearch() {
  const previous = cacheOwner === null ? null : readPageData<{ values: string[]; page: number }>('job-filters', cacheOwner)
  if (previous) {
    jobFilterIds.forEach((id, index) => {
      const field = select<HTMLInputElement | HTMLSelectElement>('#' + id)
      const value = previous.values[index]
      if (typeof value === 'string' && (!(field instanceof HTMLSelectElement) || Array.from(field.options).some(option => option.value === value))) field.value = value
    })
    jobPage = Math.max(1, previous.page || 1)
  }
  jobSearchInitialized = true
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  const searchNow = () => {
    clearTimeout(searchTimer)
    void loadJobs()
  }
  select<HTMLFormElement>('[data-job-search]').addEventListener('submit', (event) => {
    event.preventDefault()
    searchNow()
  })
  select('#job-source').addEventListener('change', searchNow)
  select('#job-location').addEventListener('input', () => {
    renderJobs()
    clearTimeout(searchTimer)
    searchTimer = setTimeout(searchGoogleJobs, 500)
  })
  select('#job-query').addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(searchNow, 350)
  })
  for (const selector of ['#job-employment', '#job-listing-time', '#job-classification'])
    select(selector).addEventListener('change', () => {
      renderJobs()
      searchGoogleJobs()
    })
  attachSuggestions(select<HTMLInputElement>('#job-query'), select('#job-query-suggestions'), () => [...jobs.map((job) => job.title), 'Virtual assistant', 'Executive assistant', 'Customer support', 'Software developer', 'Web developer', 'Graphic designer', 'Social media manager', 'Bookkeeper', 'Data entry'], searchNow)
  attachSuggestions(
    select<HTMLInputElement>('#job-location'),
    select('#job-location-suggestions'),
    () => [...jobs.flatMap((job) => job.location.split(/[,;]/).map((location) => location.trim())), 'Philippines', 'Manila', 'Cebu', 'Davao', 'Worldwide', 'USA', 'United Kingdom', 'Canada', 'Australia'],
    () => {
      renderJobs()
      searchGoogleJobs()
    },
  )
  return loadJobs(true)
}
async function init() {
  const revision = workspaceRevision
  // Start independent reads together, then reconcile the account-scoped preview.
  const workspaceRequest = api('workspace/items').then(data => ({ data, error: null }), (error: unknown) => ({ data: null, error }))
  let initialJobs: Promise<void> | null = null
  const markReady = () => {
    loaded = true
    root.dataset.ready = 'true'
    root.setAttribute('aria-busy', 'false')
    root.querySelector('[data-workspace-loading]')?.classList.add('d-none')
    root.querySelectorAll<HTMLButtonElement>('[data-add]').forEach(button => { button.disabled = false })
    root.querySelectorAll<HTMLSelectElement>('[data-entries-control]').forEach(field => { field.disabled = savingSelectedJobs || deletingApplicationRows || deletingSheetRows })
  }
  try {
    const session = await getSession()
    signedIn = Boolean(session.user)
    csrf = session.csrf
    if (!signedIn) {
      location.replace(loginUrl())
      return
    }
    cacheOwner = session.user!.id
    const entries = select<HTMLSelectElement>('[data-entries-control]')
    const savedEntries = readPageData<string>('entries:' + view, cacheOwner)
    if (entries && savedEntries && Array.from(entries.options).some(option => option.value === savedEntries)) entries.value = savedEntries
    const cached = readPageData<Entry[]>('workspace', cacheOwner)
    if (cached) {
      items = cached
      markReady()
      render()
    }
    initialJobs = view === 'jobs' ? initJobSearch() : null
    const result = await workspaceRequest
    if (!signedIn || cacheOwner === null) return
    if (result.error) throw result.error
    if (revision === workspaceRevision) {
      const fresh = result.data.items as Entry[]
      const changed = !loaded || JSON.stringify(items) !== JSON.stringify(fresh)
      items = fresh
      markReady()
      if (changed) render()
      else cacheWorkspace()
    }
    if (view === 'dashboard') void restoreDashboardLogos()
  } catch (e) {
    error(loaded ? 'Could not refresh your workspace. Showing your last loaded data.' : e instanceof Error ? e.message : 'Unable to load workspace.')
    select('[data-workspace-retry]').classList.remove('d-none')
    if (!loaded) root.dataset.loadFailed = 'true'
  } finally {
    root.setAttribute('aria-busy', 'false')
    root.querySelector('[data-workspace-loading]')?.classList.add('d-none')
  }
  if (view === 'jobs') {
    await initialJobs
    updateJobSelection()
    await whenPageActive()
    const pending = sessionStorage.getItem('jobify-pending-application')
    if (pending && signedIn) {
      try {
        const job = JSON.parse(pending) as Job
        if (safeUrl(job.url)) {
          if (!jobs.some((j) => j.id === job.id)) jobs.unshift(job)
          showJobDetails(job.id)
        }
      } catch {
        /* Invalid pending entries are ignored. */
      }
      sessionStorage.removeItem('jobify-pending-application')
    }
  }

}
select('[data-workspace-retry]').addEventListener('click', () => location.reload())
void init()
if (wasPrerendered) void whenPageActive().then(async () => {
  // Reconcile edits made after preparation without blocking display or
  // resetting the user's filters and page selection.
  const revision = workspaceRevision
  try {
    const session = await getSession(true)
    if (!loaded || session.user?.id !== cacheOwner) return
    csrf = session.csrf
    const data = await api('workspace/items')
    if (revision !== workspaceRevision || !signedIn) return
    if (JSON.stringify(items) !== JSON.stringify(data.items)) {
      items = data.items
      render()
    }
  } catch {
    if (loaded) error('Could not refresh your workspace. Showing your last loaded data.')
  }
})
