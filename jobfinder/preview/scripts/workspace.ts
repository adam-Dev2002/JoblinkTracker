import { attachSuggestions } from './search-suggestions'
import { attachTrackedJobSearch } from './application-tracker'
import { attachTableActions } from './table-actions'
import { getSession } from '@shared/lib/client-session'
import { createGoogleJobSearch, type GoogleJobResult } from './google-job-search'
type Kind = 'application' | 'task' | 'task_status' | 'event' | 'link' | 'sheet'
type Attachment = { id: number; name: string; mime: string; size: number }
const sheetSelection = new Set<number>()
const hiddenSheetColumns = new Set<string>()
let visibleSheetIds: number[] = []
let applicationPage = 1
let selectedApplicationId: number | null = null
const applicationSelection = new Set<number>()
let sheetPage = 1
const workspaceRowsPerPage = 10
const recentApplicationLimit = 7
let deletingSheetRows = false
let sheetWriteQueue: Promise<void> = Promise.resolve()
type Entry = { id: number; kind: Kind; attachments?: Attachment[]; payload: Record<string, string> & { title: string; company: string; url: string; salary: string; status: string; notes: string; date: string; time: string; value: string } }
type Job = { id: string; title: string; company: string; location: string; role: string; url: string; applyUrl?: string; source: string; salary: string; date: string; direct: boolean; logo: string; workMode: string; employmentType: string; description: string }
const root = document.querySelector<HTMLElement>('[data-workspace-view]')!
const view = root.dataset.workspaceView!
const select = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!
const tableActionArrow = select<HTMLTemplateElement>('[data-table-action-arrow]')?.innerHTML || ''
const loginUrl = () => `/sign-in?returnTo=${encodeURIComponent(location.pathname + location.search)}`
const htmlEscape = (value: string | number | null | undefined) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
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
let jobs: Job[] = []
const jobSelection = new Map<string, Job>()
const maxSelectedJobs = 50
const googleJobs = new Map<string, Job>()
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
let jobsLoading = false
let jobPage = 1
const jobsPerPage = 12
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
let modalKind: Kind = 'application'
let restoreFocus: HTMLElement | null = null
const appStatuses = ['Saved', 'Application opened', 'Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted']
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
  return data
}
function owned(kind: Kind) {
  return items.filter((item) => item.kind === kind)
}
function actionButtons(item: Entry) {
  return `<div class="d-flex gap-2"><button class="btn btn-sm btn-outline-secondary" data-edit="${item.id}">Edit</button><button class="btn btn-sm btn-outline-danger" data-delete="${item.id}" aria-label="Delete ${htmlEscape(item.payload.title)}">Delete</button></div>`
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
function render() {
  taskStatuses = ['To do', 'In progress', 'Done', ...owned('task_status').map((item) => item.payload.title)]
  const apps = owned('application'),
    tasks = owned('task'),
    events = owned('event')
      .filter((item) => item.payload.date >= today())
      .sort((a, b) => (a.payload.date + a.payload.time).localeCompare(b.payload.date + b.payload.time))
  if (view === 'dashboard') {
    const stats: Record<string, number> = { applications: apps.filter((i) => !['Saved', 'Application opened'].includes(i.payload.status)).length, interviews: apps.filter((i) => i.payload.status === 'Interview').length, tasks: tasks.filter((i) => i.payload.status !== 'Done').length, events: events.length }
    for (const [key, value] of Object.entries(stats)) select(`[data-stat="${key}"]`).textContent = String(value)
    select('[data-dashboard-applications]').innerHTML = apps.length
      ? `<ul class="list-group list-group-flush dashboard-application-list" aria-label="Recent applications">${apps
          .sort((a, b) => b.id - a.id)
          .slice(0, recentApplicationLimit)
          .map((item) => {
            const initials = (item.payload.company || item.payload.title).trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0] || '').join('').toUpperCase()
            return `<li class="list-group-item dashboard-application-item" data-dashboard-application="${item.id}"><span class="avatar bg-secondary-lt rounded-3" aria-hidden="true">${htmlEscape(initials)}</span><div class="dashboard-application-copy"><button type="button" class="dashboard-application-title" data-edit="${item.id}" title="${htmlEscape(item.payload.title)}" aria-label="Edit application ${htmlEscape(item.payload.title)}">${htmlEscape(item.payload.title)}</button><div class="dashboard-application-meta text-secondary"><span>${htmlEscape(item.payload.company || 'Company not specified')}</span>${item.payload.date ? `<time datetime="${htmlEscape(item.payload.date)}">${htmlEscape(item.payload.date)}</time>` : ''}</div></div><span class="badge bg-secondary-lt dashboard-application-status">${htmlEscape(item.payload.status)}</span></li>`
          })
          .join('')}</ul>`
      : empty('Your applications will appear here. Start with Find work or add one to your tracker.')
    select('[data-dashboard-tasks]').innerHTML =
      tasks
        .filter((i) => i.payload.status !== 'Done')
        .slice(0, 5)
        .map((i) => `<div class="border-bottom pb-3 mb-3"><strong>${htmlEscape(i.payload.title)}</strong><div class="text-secondary small">${htmlEscape(i.payload.date || 'No due date')}   ${htmlEscape(i.payload.status)}</div></div>`)
        .join('') || empty('A clear desk. Add a task when you are ready.')
  }
  if (view === 'applications') {
    tableActions?.close()
    const stats: Record<string, string | number> = {
      total: apps.length,
      open: apps.filter((i) => ['Applied', 'Interview', 'Offer'].includes(i.payload.status)).length,
      interview: apps.filter((i) => i.payload.status === 'Interview').length,
      offer: apps.filter((i) => i.payload.status === 'Offer').length,
      reply: apps.some((i) => !['Saved', 'Application opened'].includes(i.payload.status)) ? Math.round((apps.filter((i) => ['Interview', 'Offer', 'Rejected'].includes(i.payload.status)).length / apps.filter((i) => !['Saved', 'Application opened'].includes(i.payload.status)).length) * 100) + '%' : '0%',
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
    for (const id of applicationSelection) if (!apps.some(item => item.id === id)) applicationSelection.delete(id)
    const visibleSelection = filtered.filter(item => applicationSelection.has(item.id)).length
    const outside = applicationSelection.size - visibleSelection
    const all = select<HTMLInputElement>('[data-application-all]')
    all.disabled = filtered.length === 0
    all.checked = filtered.length > 0 && visibleSelection === filtered.length
    all.indeterminate = visibleSelection > 0 && visibleSelection < filtered.length
    select('[data-application-selection-toolbar]').classList.toggle('d-none', applicationSelection.size === 0)
    select('[data-application-selected-count]').textContent = `${applicationSelection.size} selected${outside ? ` · ${outside} outside current filters` : ''}`
    select('[data-application-filter-count]').textContent = `${filtered.length} of ${apps.length} jobs`
    const activeFilters = Number(Boolean(select<HTMLSelectElement>('[data-status-filter]').value)) + Number(Boolean(companyFilter.value))
    const filterBadge = select('[data-application-filter-badge]')
    filterBadge.textContent = String(activeFilters)
    filterBadge.classList.toggle('d-none', activeFilters === 0)
    applicationPage = Math.min(applicationPage, Math.max(1, Math.ceil(filtered.length / workspaceRowsPerPage)))
    renderPagination(select('[data-application-pagination]'), filtered.length, applicationPage, 'data-application-page', 'applications')
    select('[data-application-rows]').innerHTML = filtered
      .slice((applicationPage - 1) * workspaceRowsPerPage, applicationPage * workspaceRowsPerPage)
      .map(
        (i) =>
          `<tr class="${applicationSelection.has(i.id) ? 'table-active' : ''}"><td><input type="checkbox" class="form-check-input m-0" data-application-pick="${i.id}" aria-label="Select ${htmlEscape(i.payload.title)} at ${htmlEscape(i.payload.company || 'unspecified company')}" ${applicationSelection.has(i.id) ? 'checked' : ''} /></td><td class="text-nowrap text-secondary">${htmlEscape(i.payload.date)}</td><td><strong>${htmlEscape(i.payload.title)}</strong>${safeUrl(i.payload.url) ? `<div><a href="${htmlEscape(safeUrl(i.payload.url))}" target="_blank" rel="noopener noreferrer" class="small">Original listing &nearr;</a></div>` : ''}</td><td>${htmlEscape(i.payload.company)}</td><td class="text-secondary">${htmlEscape(i.payload.salary || '—')}</td><td>${statusSelect(i, appStatuses)}</td><td class="text-secondary" style="min-width:160px">${htmlEscape(i.payload.notes || '—')}</td><td class="text-end"><button type="button" class="btn workspace-row-actions" data-application-actions="${i.id}" aria-label="Actions for ${htmlEscape(i.payload.title)}" aria-haspopup="menu" aria-controls="workspace-row-menu" aria-expanded="false">Actions ${tableActionArrow}</button></td></tr>`,
      )
      .join('')
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
          return `<section class="task-lane" data-lane="${htmlEscape(status)}" aria-label="${htmlEscape(status)} tasks" style="--lane-accent:${palette[0]};--lane-tint:${palette[1]}"><div class="task-lane-header"><div class="d-flex align-items-center gap-2" style="min-width:0"><span class="task-lane-dot"></span><h3 class="mb-0 text-break">${htmlEscape(status)}</h3><span class="task-lane-count">${group.length}</span></div><div class="d-flex">${custom ? `<button class="btn btn-icon btn-sm text-danger" data-delete-status="${custom.id}" aria-label="Delete status ${htmlEscape(status)}">&times;</button>` : ''}</div></div><div class="task-lane-body" data-task-column="${htmlEscape(status)}">${group.map((item) => `<div class="task-card" draggable="true" data-task-card="${item.id}"><h3 class="mb-2">${htmlEscape(item.payload.title)}</h3><div class="task-notes text-secondary small" tabindex="0" aria-label="Notes for ${htmlEscape(item.payload.title)}">${htmlEscape(item.payload.notes)}</div>${item.payload.date ? `<div class="text-secondary small my-3">Due ${htmlEscape(item.payload.date)}</div>` : ''}${statusSelect(item, taskStatuses)}<div class="mt-3">${actionButtons(item)}</div></div>`).join('') || empty('No cards yet.')}</div><button class="trello-add-card" data-add="task" data-task-status="${htmlEscape(status)}" aria-label="Add a card to ${htmlEscape(status)}">+ Add a card</button></section>`
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
      html += `<div data-calendar-cell="${key}" class="calendar-day ${key === today() ? 'today' : ''} ${date.getMonth() !== month.getMonth() ? 'text-secondary bg-light' : ''}"><button class="btn btn-sm p-1 border-0" data-calendar-add="${key}" ${key === today() ? 'aria-current="date"' : ''} aria-label="Add event on ${key}">${date.getDate()}</button>${owned(
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
    visibleSheetIds = rows.map((row) => row.id)
    sheetPage = Math.min(sheetPage, Math.max(1, Math.ceil(rows.length / workspaceRowsPerPage)))
    const pageStart = (sheetPage - 1) * workspaceRowsPerPage
    const pageRows = rows.slice(pageStart, pageStart + workspaceRowsPerPage)
    renderPagination(select('[data-sheet-pagination]'), rows.length, sheetPage, 'data-sheet-page', 'rows', deletingSheetRows)
    for (const id of sheetSelection) if (!items.some((row) => row.id === id)) sheetSelection.delete(id)
    select<HTMLButtonElement>('[data-sheet-bulk]').disabled = sheetSelection.size === 0 || deletingSheetRows
    select<HTMLButtonElement>('[data-sheet-clear-selection]').disabled = sheetSelection.size === 0 || deletingSheetRows
    select('[data-sheet-selection-toolbar]').classList.toggle('d-none', sheetSelection.size === 0)
    const filterBadge = select('[data-sheet-filter-badge]')
    const activeFilters = Number(filter !== 'all') + Number(Boolean(activeCompany))
    filterBadge.textContent = String(activeFilters)
    filterBadge.classList.toggle('d-none', activeFilters === 0)
    const hiddenSelected = Array.from(sheetSelection).filter((id) => !visibleSheetIds.includes(id)).length
    const otherPages = Array.from(sheetSelection).filter((id) => visibleSheetIds.includes(id) && !pageRows.some((row) => row.id === id)).length
    select('[data-sheet-selected-count]').textContent = sheetSelection.size ? `${sheetSelection.size} selected${hiddenSelected ? ` · ${hiddenSelected} selected outside current filters` : ''}${otherPages ? ` · ${otherPages} on other pages` : ''}` : ''
    select('[data-sheet-bulk-label]').textContent = 'Delete selected (' + sheetSelection.size + ')'
    const all = select<HTMLInputElement>('[data-sheet-all]')
    all.disabled = rows.length === 0 || deletingSheetRows
    all.checked = rows.length > 0 && rows.every((row) => sheetSelection.has(row.id))
    all.indeterminate = rows.some((row) => sheetSelection.has(row.id)) && !all.checked
    select('[data-sheet-count]').textContent = rows.length + ' of ' + owned('sheet').length + ' rows'
    select('[data-sheet-rows]').innerHTML = pageRows
      .map(
        (i, rowIndex) =>
          `<tr class="${sheetSelection.has(i.id) ? 'table-active' : ''}"><td><input type="checkbox" class="form-check-input m-0" data-sheet-pick="${i.id}" aria-label="Select ${htmlEscape(i.payload.title)}" ${sheetSelection.has(i.id) ? 'checked' : ''} /></td><td class="text-secondary">${pageStart + rowIndex + 1}</td>${['title', 'company', 'value', 'notes'].map((field) => `<td data-sheet-column="${field}"><input class="form-control" value="${htmlEscape(i.payload[field])}" data-sheet-id="${i.id}" data-sheet-field="${field}" aria-label="${field} for ${htmlEscape(i.payload.title)}" /></td>`).join('')}<td data-sheet-column="attachments">${(i.attachments || []).map((a) => `<a class="d-flex align-items-center gap-2 mb-2 small" href="/api/workspace/attachments?id=${a.id}" target="_blank" rel="noopener">${a.mime.startsWith('image/') ? `<img src="/api/workspace/attachments?id=${a.id}&preview=1" alt="${htmlEscape(a.name)}" width="36" height="36" style="object-fit:cover;border-radius:5px" />` : ''}${htmlEscape(a.name)}</a>`).join('') || '<span class="text-secondary">—</span>'}</td><td class="text-end"><button type="button" class="btn workspace-row-actions" data-sheet-actions="${i.id}" aria-label="Actions for ${htmlEscape(i.payload.title)}" aria-haspopup="menu" aria-controls="workspace-row-menu" aria-expanded="false">Actions ${tableActionArrow}</button></td></tr>`,
      )
      .join('')
    root.querySelectorAll<HTMLElement>('[data-sheet-column]').forEach((cell) => cell.classList.toggle('d-none', hiddenSheetColumns.has(cell.dataset.sheetColumn!)))
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
function confirmDelete(message: string): Promise<boolean> {
  if (confirmationResolve) return Promise.resolve(false)
  confirmationFocus = document.activeElement as HTMLElement
  confirmationAccepted = false
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
      select<HTMLSelectElement>('[data-status-filter]').value = ''
      select<HTMLSelectElement>('[data-application-company]').value = ''
      selectedApplicationId = null
      applicationPage = 1
      applicationSearch?.close()
      render()
    }
    if (target.hasAttribute('data-application-clear-selection')) {
      applicationSelection.clear()
      render()
    }
    if (target.hasAttribute('data-application-export-selected')) exportCsv('application', owned('application').filter(item => applicationSelection.has(item.id)))
    if (target.dataset.applicationPage) {
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
    if (target.dataset.jobPage && !jobsLoading) {
      jobPage = Number(target.dataset.jobPage)
      renderJobs(false)
      select('.job-results-panel').scrollIntoView({ block: 'start' })
      root.querySelector<HTMLButtonElement>(`[data-job-page="${jobPage}"]`)?.focus({ preventScroll: true })
    }
    if (target.hasAttribute('data-job-bulk-save')) await saveSelectedJobs()
    if (target.hasAttribute('data-job-bulk-export')) exportSelectedJobs()
    if (target.hasAttribute('data-job-clear-selection') && !savingSelectedJobs) {
      jobSelection.clear()
      select('[data-job-bulk-status]').classList.add('d-none')
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
    if (target.hasAttribute('data-application-tracker')) sessionStorage.removeItem('jobify-opened-application')
    if (target.hasAttribute('data-sheet-select')) {
      visibleSheetIds.forEach((id) => sheetSelection.add(id))
      render()
    }
    if (target.hasAttribute('data-sheet-export-selected')) {
      await sheetWriteQueue
      exportCsv('sheet', owned('sheet').filter(item => sheetSelection.has(item.id)))
    }
    if (target.hasAttribute('data-sheet-clear-selection')) {
      sheetSelection.clear()
      render()
    }
    if (target.hasAttribute('data-sheet-clear-filters')) {
      sheetPage = 1
      select<HTMLInputElement>('[data-sheet-search]').value = ''
      select<HTMLSelectElement>('[data-sheet-filter]').value = 'all'
      select<HTMLSelectElement>('[data-sheet-company]').value = ''
      render()
    }
    if (target.hasAttribute('data-sheet-bulk') && !deletingSheetRows && sheetSelection.size && (await confirmDelete('Delete ' + sheetSelection.size + ' selected rows and their attachments, including any hidden by filters? This cannot be undone.'))) {
      deletingSheetRows = true
      const selectedIds = Array.from(sheetSelection)
      render()
      try {
        await sheetWriteQueue
        for (let offset = 0; offset < selectedIds.length; offset += 200) {
          const data = await api('workspace/items', { action: 'bulk-delete', ids: selectedIds.slice(offset, offset + 200) })
          items = items.filter((row) => !data.deleted.includes(row.id))
          data.deleted.forEach((id: number) => sheetSelection.delete(id))
        }
      } finally {
        deletingSheetRows = false
        render()
      }
    }
    if (target.dataset.jobCard) showJobDetails(target.dataset.jobCard)
    if (target.dataset.deleteStatus && (await confirmDelete('Delete this status? Its tasks will move to To do.'))) {
      const data = await api('workspace/items', { action: 'delete-status', id: Number(target.dataset.deleteStatus) })
      items = items.filter((item) => item.id !== data.deleted)
      for (const item of data.updated) {
        const index = items.findIndex((current) => current.id === item.id)
        if (index >= 0) items[index] = item
      }
      render()
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
          payload: { title: job.title, company: job.company, url: job.url, salary: job.salary, status: 'Application opened', date: today(), jobId: job.id, source: job.source, location: job.location, notes: 'Source: ' + job.source },
        })
        const item = data.item as Entry
        const index = items.findIndex((i) => i.id === item.id)
        if (index >= 0) items[index] = item
        else items.unshift(item)
        popup.location.href = safeUrl(job.applyUrl || job.url)
        sessionStorage.setItem('jobify-opened-application', String(item.id))
        closeJobDetails()
        showApplicationModal(item)
      } catch (e) {
        popup.close()
        throw e
      } finally {
        target.removeAttribute('aria-disabled')
      }
    }
    if (target.dataset.confirmApplication) {
      const item = items.find((i) => i.id === Number(target.dataset.confirmApplication))
      if (item) {
        const inModal = target.hasAttribute('data-application-submit')
        const button = target as HTMLButtonElement
        button.disabled = true
        try {
          await save('application', { ...item.payload, status: 'Applied', date: today() }, item.id)
          sessionStorage.removeItem('jobify-opened-application')
          if (inModal) updateApplicationModal(items.find((i) => i.id === item.id)!)
        } catch (e) {
          if (!inModal) throw e
          const box = select('[data-application-error]')
          box.textContent = e instanceof Error ? e.message : 'Unable to update your application. Try again.'
          box.classList.remove('d-none')
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
    if (target.dataset.delete) {
      if (view === 'sheet') await sheetWriteQueue
      const id = Number(target.dataset.delete)
      if (await confirmDelete('Delete this entry and any attached files? This cannot be undone.')) {
        await api('workspace/items', { id, action: 'delete' })
        items = items.filter((i) => i.id !== id)
        render()
      }
    }
    if (target.dataset.track) {
      if (savingSelectedJobs) return
      const job = findJob(target.dataset.track)
      if (job) closeJobDetails()
      if (job) openModal('application', null, { title: job.title, company: job.company, url: job.url, salary: job.salary, status: 'Saved', date: today(), jobId: job.id, source: job.source, location: job.location, notes: 'Source: ' + job.source })
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
    if (target.dataset.applicationPick) {
      const id = Number(target.dataset.applicationPick)
      if (target.checked) applicationSelection.add(id)
      else applicationSelection.delete(id)
      render()
      select<HTMLInputElement>(`[data-application-pick="${id}"]`)?.focus({ preventScroll: true })
    }
    if (target.hasAttribute('data-application-all')) {
      for (const item of filteredApplications()) {
        if (target.checked) applicationSelection.add(item.id)
        else applicationSelection.delete(item.id)
      }
      render()
      select('[data-application-all]').focus({ preventScroll: true })
    }
    if (target.dataset.jobPick && !savingSelectedJobs) {
      select('[data-job-bulk-status]').classList.add('d-none')
      const job = findJob(target.dataset.jobPick)
      if (job && target.checked && (jobSelection.has(job.id) || jobSelection.size < maxSelectedJobs)) jobSelection.set(job.id, job)
      else if (job && target.checked) jobBulkStatus(`You can select up to ${maxSelectedJobs} jobs at a time. Save or clear your selection before selecting more.`)
      else jobSelection.delete(target.dataset.jobPick)
      updateJobSelection()
    }
    if (target.hasAttribute('data-job-select-all') && !savingSelectedJobs) {
      select('[data-job-bulk-status]').classList.add('d-none')
      for (const job of [...jobs, ...googleJobs.values()].filter((job) => [...visibleJobIds, ...visibleGoogleJobIds].includes(job.id))) {
        if (target.checked) {
          if (jobSelection.has(job.id)) continue
          if (jobSelection.size >= maxSelectedJobs) break
          if (!trackedApplication(job)) jobSelection.set(job.id, job)
        } else jobSelection.delete(job.id)
      }
      if (target.checked && jobSelection.size === maxSelectedJobs) jobBulkStatus(`Selected ${maxSelectedJobs} jobs. Save or clear this batch before selecting more.`)
      else if (target.checked && jobSelection.size === 0) jobBulkStatus('These matching jobs are already in your tracker.')
      updateJobSelection()
    }
    if (target.hasAttribute('data-sheet-column-toggle')) {
      if (target.checked) hiddenSheetColumns.delete(target.value)
      else hiddenSheetColumns.add(target.value)
      render()
    }
    if (target.dataset.sheetPick) {
      const id = Number(target.dataset.sheetPick)
      if (target.checked) sheetSelection.add(id)
      else sheetSelection.delete(id)
      render()
    }
    if (target.hasAttribute('data-sheet-all')) {
      for (const id of visibleSheetIds)
        if (target.checked) sheetSelection.add(id)
        else sheetSelection.delete(id)
      render()
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
    } else if (target.hasAttribute('data-track') || (target.tagName === 'A' && event.key === 'Enter')) {
      event.preventDefault()
      event.stopPropagation()
      void handleClick(event)
    }
  },
  true,
)
async function handleSubmit(event: Event) {
  event.preventDefault()
  const form = event.currentTarget as HTMLFormElement,
    button = form.querySelector<HTMLButtonElement>('[type="submit"]')!
  const data = Object.fromEntries(new FormData(form)) as Record<string, string>
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
let applicationFocus: HTMLElement | null = null
function updateApplicationModal(item: Entry) {
  const opened = item.payload.status === 'Application opened'
  select('#application-follow-up-title').textContent = opened ? 'Did you submit your application?' : 'Application tracked'
  select('[data-application-title]').textContent = item.payload.title
  select('[data-application-message]').textContent = opened ? 'Complete the application on the source website. If you have submitted it, mark it as Applied here. Otherwise, you can do this later from your tracker.' : `This application is tracked as ${item.payload.status}.`
  select<HTMLAnchorElement>('[data-application-source]').href = safeUrl(item.payload.url)
  const submit = select<HTMLButtonElement>('[data-application-submit]')
  submit.dataset.confirmApplication = String(item.id)
  submit.classList.toggle('d-none', !opened)
  select('[data-application-later]').textContent = opened ? 'Not yet' : 'Done'
  select('[data-application-error]').classList.add('d-none')
  select('[data-application-success]').classList.toggle('d-none', item.payload.status !== 'Applied')
}
function showApplicationModal(item: Entry) {
  applicationFocus = document.activeElement as HTMLElement
  updateApplicationModal(item)
  if (!select('[data-application-modal]').classList.contains('show')) select<HTMLButtonElement>('[data-application-modal-trigger]').click()
}
select('[data-application-modal]').addEventListener('hidden.bs.modal', () => {
  sessionStorage.removeItem('jobify-opened-application')
  if (applicationFocus?.isConnected) applicationFocus.focus()
})
function companyPlaceholder() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-label="Company logo unavailable"><rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V4h6v3M8 11h1m6 0h1m-8 4h1m6 0h1"/></svg>'
}
function updateJobSelection() {
  const busy = savingSelectedJobs || !loaded
  const all = select<HTMLInputElement>('[data-job-select-all]')
  const visibleIds = [...visibleJobIds, ...visibleGoogleJobIds]
  const selectedVisible = visibleIds.filter((id) => jobSelection.has(id)).length
  const hidden = jobSelection.size - selectedVisible
  const batchSize = Math.min(visibleIds.length, maxSelectedJobs - hidden)
  all.checked = batchSize > 0 && selectedVisible >= batchSize
  all.indeterminate = selectedVisible > 0 && !all.checked
  all.disabled = busy || jobsLoading || visibleIds.length === 0 || (jobSelection.size >= maxSelectedJobs && selectedVisible === 0)
  const googleOnly = select<HTMLSelectElement>('#job-source').value === 'google'
  select('[data-job-selection-scope]').textContent = googleOnly ? 'This Google results page' : visibleGoogleJobIds.length ? 'All feed pages and this Google page' : 'Across all pages'
  select('[data-job-selected-count]').textContent = `${jobSelection.size} selected · Max ${maxSelectedJobs}${hidden ? ` (${hidden} outside current results)` : ''}`
  for (const name of ['bulk-save', 'bulk-export', 'clear-selection']) select<HTMLButtonElement>(`[data-job-${name}]`).disabled = busy || jobSelection.size === 0
  select('[data-job-selection-toolbar]').setAttribute('aria-busy', String(savingSelectedJobs))
  root.querySelectorAll<HTMLInputElement>('[data-job-pick]').forEach((input) => {
    input.checked = jobSelection.has(input.dataset.jobPick!)
    input.disabled = busy || jobsLoading || (jobSelection.size >= maxSelectedJobs && !input.checked)
    input.closest('[data-job-card]')?.classList.toggle('border-primary', input.checked)
  })
  root.querySelectorAll<HTMLButtonElement>('[data-track]').forEach((button) => {
    button.disabled = busy
  })
}
function trackedApplication(job: Job) {
  return owned('application').find((item) => (job.url && safeUrl(item.payload.url) === safeUrl(job.url)) || (item.payload.jobId === job.id && item.payload.source === job.source))
}
async function renderGoogleJobs(results: GoogleJobResult[], div: HTMLElement) {
  const generation = ++googleRenderGeneration
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
  if (generation !== googleRenderGeneration || select('[data-google-jobs]').classList.contains('d-none')) return
  googleJobs.clear()
  for (const job of listings) googleJobs.set(job.id, job)
  visibleGoogleJobIds = listings.map((job) => job.id)
  div.innerHTML =
    '<div class="google-job-grid">' +
    listings
      .map((job) => {
        const website = new URL(job.url)
        const domain = website.hostname.replace(/^www\./, '')
        const preview = text(results.find((result) => safeUrl(result.listingUrl || result.url) === job.url)?.content || '')
        const iconUrl = 'https://www.google.com/s2/favicons?' + new URLSearchParams({ domain: website.hostname, sz: '64' })
        return `<article class="card job-card google-job-card" data-job-card="${job.id}" tabindex="0" aria-label="View details for ${htmlEscape(job.title)}"><div class="card-body d-flex flex-column"><div class="d-flex align-items-center gap-3 mb-3"><span class="avatar bg-white border rounded-3 position-relative text-blue flex-shrink-0">${companyPlaceholder().replace('Company logo unavailable', 'Source icon unavailable')}<img data-source-icon src="${htmlEscape(iconUrl)}" alt="${htmlEscape(domain)} source icon" loading="lazy" referrerpolicy="no-referrer" /></span><div class="flex-grow-1" style="min-width:0"><a class="google-job-source fw-semibold" data-job-source-website href="${htmlEscape(website.origin)}" target="_blank" rel="noopener noreferrer" aria-label="Visit ${htmlEscape(domain)} website">${htmlEscape(domain)} &nearr;</a><div class="small text-secondary mt-1">Found on Google</div></div><input type="checkbox" class="form-check-input job-pick ms-auto" data-job-pick="${job.id}" aria-label="Select ${htmlEscape(job.title)}" /></div><h3 class="job-title"><button class="job-title-link" data-job-details="${job.id}">${htmlEscape(job.title)}</button></h3><p class="google-job-preview text-secondary small mb-3">${htmlEscape(preview)}</p><div class="d-flex flex-wrap gap-3 mb-3"><button class="job-details-link mb-0" data-job-details="${job.id}">Read job description &rarr;</button><a class="small" data-job-source-listing href="${htmlEscape(job.url)}" target="_blank" rel="noopener noreferrer">Original listing &nearr;</a></div><div class="d-flex gap-2 mt-auto"><a class="btn btn-primary flex-grow-1" href="${htmlEscape(job.applyUrl || job.url)}" target="_blank" rel="noopener noreferrer" data-apply-job="${job.id}">Apply via source &nearr;</a><button class="btn" data-track="${job.id}" aria-label="Save ${htmlEscape(job.title)}">Save</button></div></div></article>`
      })
      .join('') +
    (listings.length ? '' : '<p class="text-secondary mb-0">No matching job-detail pages on this Google results page. Try another page or broader keywords.</p>') +
    '</div>'
  div.querySelectorAll<HTMLImageElement>('[data-source-icon]').forEach((image) => image.addEventListener('error', () => image.remove(), { once: true }))
  if (select<HTMLSelectElement>('#job-source').value === 'google') select('[data-job-count]').textContent = `${listings.length} results on this page`
  updateJobSelection()
}
function jobBulkStatus(message: string) {
  const status = select('[data-job-bulk-status]')
  status.textContent = message
  status.classList.remove('d-none')
}
async function saveSelectedJobs() {
  if (savingSelectedJobs || !loaded || !jobSelection.size) return
  if (!signedIn) {
    location.assign(loginUrl())
    return
  }
  savingSelectedJobs = true
  updateJobSelection()
  const selectedJobs = Array.from(jobSelection.values()).slice(0, maxSelectedJobs)
  let saved = 0,
    skipped = 0,
    failed = 0
  let failureMessage = ''
  try {
    for (const job of selectedJobs) {
      jobBulkStatus(`Saving selected jobs… ${saved + skipped + failed} of ${selectedJobs.length}`)
      const existing = trackedApplication(job)
      if (existing) {
        skipped++
        jobSelection.delete(job.id)
        continue
      }
      try {
        await save('application', { title: job.title, company: job.company, url: job.url, salary: job.salary || '', status: 'Saved', date: today(), jobId: job.id, source: job.source, location: job.location, notes: 'Source: ' + job.source }, 0, false)
        saved++
        jobSelection.delete(job.id)
      } catch (e) {
        failed++
        failureMessage = e instanceof Error ? e.message : 'Unable to save.'
      }
    }
    jobBulkStatus(`${saved} ${saved === 1 ? 'job' : 'jobs'} saved.${skipped ? ` ${skipped} already in your tracker.` : ''}${failed ? ` ${failed} could not be saved and remain selected. Try Save selected again.` : ''}`)
    if (failed) error(failureMessage)
  } finally {
    savingSelectedJobs = false
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
  nav.classList.toggle('d-none', pages <= 1)
  if (pages <= 1) {
    nav.innerHTML = ''
    return
  }
  const button = (targetPage: number, label: string, disabled = false) =>
    `<li class="page-item ${targetPage === page && /^\d+$/.test(label) ? 'active' : ''}"><button type="button" class="page-link" ${attribute}="${targetPage}" ${disabled || busy ? 'disabled' : ''} ${targetPage === page && /^\d+$/.test(label) ? 'aria-current="page"' : ''} aria-label="${/^\d+$/.test(label) ? 'Page ' + label : label + ' page'}">${label}</button></li>`
  const window = [...new Set([1, ...Array.from({ length: 5 }, (_, i) => page - 2 + i), pages])].filter((page) => page > 0 && page <= pages).sort((a, b) => a - b)
  let links = button(page - 1, 'Previous', page === 1)
  window.forEach((page, index) => {
    if (index > 0 && page - window[index - 1]! > 1) links += '<li class="page-item disabled"><span class="page-link" aria-hidden="true">…</span></li>'
    links += button(page, String(page))
  })
  links += button(page + 1, 'Next', page === pages)
  nav.innerHTML = `<p class="text-secondary small text-center mb-2" role="status">Showing ${(page - 1) * perPage + 1}–${Math.min(page * perPage, count)} of ${count} ${noun}</p><ul class="pagination mb-0">${links}</ul>`
}
function renderJobPagination(count: number) {
  renderPagination(select('[data-job-pagination]'), count, jobPage, 'data-job-page', 'results', false, jobsPerPage)
}
function renderJobs(resetPage = true) {
  if (resetPage) jobPage = 1
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
    return (!classification || j.role === classification) && (!location || j.location.toLowerCase().includes(location)) && (!employment || (j.employmentType || 'Not specified') === employment) && (!listingTime || (Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= now))
  })
  visibleJobIds = list.map((job) => job.id)
  jobPage = Math.min(jobPage, Math.max(1, Math.ceil(list.length / jobsPerPage)))
  renderJobPagination(list.length)
  select('[data-job-count]').textContent = `${list.length} results`
  select('[data-job-results]').innerHTML =
    list
      .slice((jobPage - 1) * jobsPerPage, jobPage * jobsPerPage)
      .map(
        (j) =>
          `<div class="col-md-6 col-xl-4"><div class="card job-card" data-job-card="${htmlEscape(j.id)}" tabindex="0" aria-label="Read description for ${htmlEscape(j.title)}" style="cursor:pointer"><div class="card-body d-flex flex-column"><div class="d-flex align-items-center gap-3 mb-3"><span class="avatar bg-white border rounded-3 position-relative text-blue" style="flex-shrink:0;width:48px;height:48px"><span data-company-placeholder>${companyPlaceholder()}</span>${safeUrl(j.logo) ? `<img data-company-logo src="${htmlEscape(safeUrl(j.logo))}" alt="${htmlEscape(j.company)} logo" loading="lazy" referrerpolicy="no-referrer" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:white;padding:4px;border-radius:inherit" />` : ''}</span><div style="min-width:0"><div class="fw-semibold">${htmlEscape(j.company)}</div><span class="text-secondary small" data-job-location>${htmlEscape(j.location)}</span></div><input type="checkbox" class="form-check-input job-pick ms-auto" data-job-pick="${htmlEscape(j.id)}" aria-label="Select ${htmlEscape(j.title)} at ${htmlEscape(j.company)}" /></div><h3 class="job-title"><button class="job-title-link" data-job-details="${htmlEscape(j.id)}">${htmlEscape(j.title)}</button></h3><button class="job-details-link" data-job-details="${htmlEscape(j.id)}">Read job description &rarr;</button><div class="d-flex flex-wrap gap-2 mt-2 mb-3"><span class="job-tag">${htmlEscape(j.role)}</span><span class="job-tag">${htmlEscape(j.workMode)}</span><span class="job-tag">${htmlEscape(j.employmentType || 'Not specified')}</span>${j.salary ? `<span class="job-tag">${htmlEscape(j.salary)}</span>` : ''}</div><p class="text-secondary small">Source: <a href="${htmlEscape(safeUrl(j.url))}" target="_blank" rel="noopener noreferrer">${htmlEscape(j.source)}</a>${j.date ? ' | ' + htmlEscape(j.date.slice(0, 10)) : ''}</p><div class="d-flex gap-2 mt-auto"><a class="btn btn-primary flex-grow-1" href="${htmlEscape(safeUrl(j.url))}" target="_blank" rel="noopener noreferrer" data-apply-job="${htmlEscape(j.id)}">${j.direct ? 'Apply on company site' : 'Apply via source'} &nearr;</a><button class="btn" data-track="${htmlEscape(j.id)}" aria-label="Save ${htmlEscape(j.title)}">Save</button></div></div></div></div>`,
      )
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
  if (jobFeedCache.size > 12) jobFeedCache.delete(jobFeedCache.keys().next().value!)
  return data
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
  if (source === 'google' || (source === 'all' && filters.keyword.trim())) void googleJobSearch?.search(filters)
  else googleJobSearch?.hide()
}
async function loadJobs() {
  const request = ++jobRequest
  jobSearchController?.abort()
  jobSearchController = new AbortController()
  jobsLoading = true
  visibleJobIds = []
  updateJobSelection()
  clearError()
  searchGoogleJobs()
  select('[data-job-pagination]').classList.add('d-none')
  if (!jobs.length)
    select('[data-job-results]').innerHTML = Array.from(
      { length: 3 },
      () => '<div class="col-md-6 col-xl-4"><div class="card card-body placeholder-glow" aria-hidden="true"><span class="placeholder col-6 mb-3"></span><span class="placeholder col-10 mb-2"></span><span class="placeholder col-8 mb-4"></span><span class="placeholder col-12"></span></div></div>',
    ).join('')
  select('[data-feed-message]').textContent = 'Loading the job feed '
  const form = select<HTMLFormElement>('[data-job-search]')
  form.setAttribute('aria-busy', 'true')
  try {
    const q = select<HTMLInputElement>('#job-query').value,
      source = select<HTMLSelectElement>('#job-source').value
    if (source === 'google') {
      jobs = []
      select('[data-feed-message]').textContent = 'Google searches indexed job-detail pages. Review each original listing before applying.'
      renderJobs()
      return
    }
    const data = await searchJobFeed(q, source, AbortSignal.any([jobSearchController.signal, AbortSignal.timeout(15000)]))
    if (request !== jobRequest) return
    jobs = [...data.jobs]
    select('[data-feed-message]').textContent = data.message
    renderJobs()
    if (data.mode === 'external' && safeUrl(data.searchUrl))
      select('[data-job-results]').innerHTML =
        `<div class="col-12"><div class="card card-body text-center"><h3>Search ${htmlEscape(data.source)} directly</h3><p class="text-secondary">${htmlEscape(data.message)}</p><a class="btn btn-primary align-self-center" href="${htmlEscape(safeUrl(data.searchUrl))}" target="_blank" rel="noopener noreferrer">Open official search &nearr;</a></div></div>`
  } catch (e) {
    if (request !== jobRequest) return
    jobs = []
    renderJobs()
    select('[data-feed-message]').textContent = 'The feed is currently unavailable. Try another feed or search again later.'
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
  if (!(event as CustomEvent<{ id: number } | null>).detail && loaded) {
    signedIn = false
    items = []
    location.replace(loginUrl())
  }
})
function initJobSearch() {
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
  return loadJobs()
}
async function init() {
  // Paint static controls immediately while data is still being fetched.
  const initialJobs = view === 'jobs' ? initJobSearch() : null
  try {
    const session = await getSession()
    signedIn = Boolean(session.user)
    csrf = session.csrf
    if (!signedIn) {
      location.replace(loginUrl())
      return
    }
    items = (await api('workspace/items')).items
    loaded = true
    root.dataset.ready = 'true'
    root.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((button) => {
      button.disabled = false
    })
    render()
  } catch (e) {
    error(e instanceof Error ? e.message : 'Unable to load workspace.')
  } finally {
    root.setAttribute('aria-busy', 'false')
    root.querySelector('[data-workspace-loading]')?.classList.add('d-none')
  }
  if (view === 'jobs') {
    await initialJobs
    updateJobSelection()
    const opened = items.find((i) => i.id === Number(sessionStorage.getItem('jobify-opened-application')))
    if (opened) showApplicationModal(opened)
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

  if (!loaded) render()
}
void init()
