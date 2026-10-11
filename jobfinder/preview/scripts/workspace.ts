import { attachSuggestions } from './search-suggestions'
import { getSession } from '@shared/lib/client-session'
type Kind = 'application' | 'task' | 'task_status' | 'event' | 'link' | 'sheet'
type Attachment = { id: number; name: string; mime: string; size: number }
const sheetSelection = new Set<number>()
const hiddenSheetColumns = new Set<string>()
let visibleSheetIds: number[] = []
let deletingSheetRows = false
let sheetWriteQueue: Promise<void> = Promise.resolve()
type Entry = { id: number; kind: Kind; attachments?: Attachment[]; payload: Record<string, string> & { title: string; company: string; url: string; salary: string; status: string; notes: string; date: string; time: string; value: string } }
type Job = { id: string; title: string; company: string; location: string; role: string; url: string; source: string; salary: string; date: string; direct: boolean; logo: string; workMode: string; employmentType: string; description: string }
const root = document.querySelector<HTMLElement>('[data-workspace-view]')!
const view = root.dataset.workspaceView!
const select = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!
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
async function api(path: string, body?: object) {
  const response = await fetch('/api/' + path, { credentials: 'same-origin', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) } : {}) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Unable to load your workspace.')
  return data
}
function owned(kind: Kind) {
  return items.filter((item) => item.kind === kind)
}
function actionButtons(item: Entry) {
  return `<div class="d-flex gap-2"><button class="btn btn-sm" data-edit="${item.id}">Edit</button><button class="btn btn-sm text-danger" data-delete="${item.id}" aria-label="Delete ${htmlEscape(item.payload.title)}">Delete</button></div>`
}
function statusSelect(item: Entry, statuses: string[]) {
  return `<select class="form-select form-select-sm" data-entry-status="${item.id}" aria-label="Status for ${htmlEscape(item.payload.title)}">${statuses.map((status) => `<option ${status === item.payload.status ? 'selected' : ''}>${htmlEscape(status)}</option>`).join('')}</select>`
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
      ? `<div class="table-responsive"><table class="table mb-0"><tbody>${apps
          .slice(0, 5)
          .map((item) => `<tr><td><strong>${htmlEscape(item.payload.title)}</strong><div class="text-secondary small">${htmlEscape(item.payload.company)}</div></td><td><span class="badge bg-primary-lt">${htmlEscape(item.payload.status)}</span></td><td>${htmlEscape(item.payload.date)}</td></tr>`)
          .join('')}</tbody></table></div>`
      : empty('Your applications will appear here. Start with Find work or add one to your tracker.')
    select('[data-dashboard-tasks]').innerHTML =
      tasks
        .filter((i) => i.payload.status !== 'Done')
        .slice(0, 5)
        .map((i) => `<div class="border-bottom pb-3 mb-3"><strong>${htmlEscape(i.payload.title)}</strong><div class="text-secondary small">${htmlEscape(i.payload.date || 'No due date')}   ${htmlEscape(i.payload.status)}</div></div>`)
        .join('') || empty('A clear desk. Add a task when you are ready.')
  }
  if (view === 'applications') {
    const stats: Record<string, string | number> = {
      total: apps.length,
      open: apps.filter((i) => ['Applied', 'Interview', 'Offer'].includes(i.payload.status)).length,
      interview: apps.filter((i) => i.payload.status === 'Interview').length,
      offer: apps.filter((i) => i.payload.status === 'Offer').length,
      reply: apps.some((i) => !['Saved', 'Application opened'].includes(i.payload.status)) ? Math.round((apps.filter((i) => ['Interview', 'Offer', 'Rejected'].includes(i.payload.status)).length / apps.filter((i) => !['Saved', 'Application opened'].includes(i.payload.status)).length) * 100) + '%' : '0%',
    }
    for (const [key, value] of Object.entries(stats)) select(`[data-application-stat="${key}"]`).textContent = String(value)
    const query = select<HTMLInputElement>('[data-item-search]').value.toLowerCase(),
      status = select<HTMLSelectElement>('[data-status-filter]').value
    const filtered = apps.filter((i) => (!status || i.payload.status === status) && Object.values(i.payload).join(' ').toLowerCase().includes(query))
    select('[data-application-rows]').innerHTML = filtered
      .map(
        (i) =>
          `<tr><td class="text-nowrap">${htmlEscape(i.payload.date)}</td><td><strong>${htmlEscape(i.payload.title)}</strong>${safeUrl(i.payload.url) ? `<div><a href="${htmlEscape(safeUrl(i.payload.url))}" target="_blank" rel="noopener noreferrer" class="small">Original listing &nearr;</a></div>` : ''}</td><td>${htmlEscape(i.payload.company)}</td><td>${htmlEscape(i.payload.salary || ' ')}</td><td>${statusSelect(i, appStatuses)}</td><td style="min-width:160px">${htmlEscape(i.payload.notes)}</td><td>${i.payload.status === 'Application opened' ? `<button class="btn btn-sm btn-primary mb-2" data-confirm-application="${i.id}">I submitted it</button>` : ''}${actionButtons(i)}</td></tr>`,
      )
      .join('')
    select('[data-application-empty]').innerHTML = filtered.length ? '' : empty('No applications yet. Add one or save a job from Find work.')
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
    for (const id of sheetSelection) if (!items.some((row) => row.id === id)) sheetSelection.delete(id)
    select<HTMLButtonElement>('[data-sheet-bulk]').disabled = sheetSelection.size === 0 || deletingSheetRows
    select<HTMLButtonElement>('[data-sheet-clear-selection]').disabled = sheetSelection.size === 0 || deletingSheetRows
    const hiddenSelected = Array.from(sheetSelection).filter((id) => !visibleSheetIds.includes(id)).length
    select('[data-sheet-selected-count]').textContent = hiddenSelected ? `${hiddenSelected} selected outside current filters` : ''
    select('[data-sheet-bulk]').textContent = 'Delete selected (' + sheetSelection.size + ')'
    const all = select<HTMLInputElement>('[data-sheet-all]')
    all.checked = rows.length > 0 && rows.every((row) => sheetSelection.has(row.id))
    all.indeterminate = rows.some((row) => sheetSelection.has(row.id)) && !all.checked
    select('[data-sheet-count]').textContent = rows.length + ' of ' + owned('sheet').length + ' rows'
    select('[data-sheet-rows]').innerHTML = rows
      .map(
        (i, rowIndex) =>
          `<tr><td><input type="checkbox" class="form-check-input" data-sheet-pick="${i.id}" aria-label="Select ${htmlEscape(i.payload.title)}" ${sheetSelection.has(i.id) ? 'checked' : ''} /></td><td class="text-secondary small">${rowIndex + 1}</td>${['title', 'company', 'value', 'notes'].map((field) => `<td data-sheet-column="${field}"><input class="form-control form-control-sm" value="${htmlEscape(i.payload[field])}" data-sheet-id="${i.id}" data-sheet-field="${field}" aria-label="${field} for ${htmlEscape(i.payload.title)}" /></td>`).join('')}<td data-sheet-column="attachments">${(i.attachments || []).map((a) => `<a class="d-flex align-items-center gap-2 mb-2 small" href="/api/workspace/attachments?id=${a.id}" target="_blank" rel="noopener">${a.mime.startsWith('image/') ? `<img src="/api/workspace/attachments?id=${a.id}&preview=1" alt="${htmlEscape(a.name)}" width="36" height="36" style="object-fit:cover;border-radius:5px" />` : ''}${htmlEscape(a.name)}</a>`).join('')}<button class="btn btn-sm" data-edit="${i.id}">Attach / edit</button></td><td><button class="btn btn-sm text-danger" data-delete="${i.id}" aria-label="Delete row">Delete</button></td></tr>`,
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
  if (renderAfter) render()
  return data.item as Entry
}
let detailsFocus: HTMLElement | null = null
function closeJobDetails() {
  select('[data-job-details-modal]').classList.add('d-none')
  document.body.classList.remove('job-details-open')
  detailsFocus?.focus()
}
function showJobDetails(id: string) {
  const job = jobs.find((item) => item.id === id)
  if (!job) return
  detailsFocus = document.activeElement as HTMLElement
  select('[data-details-title]').textContent = job.title
  select('[data-details-company]').textContent = job.company
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
  const link = document.createElement('a')
  link.href = safeUrl(job.url)
  link.textContent = 'View original listing'
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  source.append(link)
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
  const target = (event.target as Element).closest<HTMLElement>('button,a,[data-calendar-cell],[data-job-card]')
  if (!target) return
  if (target.getAttribute('aria-disabled') === 'true') {
    event.preventDefault()
    return
  }
  clearError()
  try {
    if (target.hasAttribute('data-application-tracker')) sessionStorage.removeItem('jobify-opened-application')
    if (target.hasAttribute('data-sheet-select')) {
      visibleSheetIds.forEach((id) => sheetSelection.add(id))
      render()
    }
    if (target.hasAttribute('data-sheet-clear-selection')) {
      sheetSelection.clear()
      render()
    }
    if (target.hasAttribute('data-sheet-clear-filters')) {
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
      const job = jobs.find((j) => j.id === target.dataset.applyJob)
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
        popup.location.href = safeUrl(job.url)
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
      const item = items.find((i) => i.id === Number(target.dataset.edit))
      if (item) openModal(item.kind, item)
    }
    if (target.dataset.delete) {
      const id = Number(target.dataset.delete)
      if (await confirmDelete('Delete this entry and any attached files? This cannot be undone.')) {
        await api('workspace/items', { id, action: 'delete' })
        items = items.filter((i) => i.id !== id)
        render()
      }
    }
    if (target.dataset.track) {
      const job = jobs.find((j) => j.id === target.dataset.track)
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
    if (target.dataset.export) exportCsv(target.dataset.export as Kind)
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
root.querySelector('[data-sheet-search]')?.addEventListener('input', render)
root.querySelector('[data-sheet-filter]')?.addEventListener('change', render)
root.querySelector('[data-sheet-company]')?.addEventListener('change', render)
root.querySelector('[data-sheet-sort]')?.addEventListener('change', render)
root.querySelector('[data-item-search]')?.addEventListener('input', render)
root.querySelector('[data-status-filter]')?.addEventListener('change', render)
function exportCsv(kind: Kind) {
  const columns = fields[kind]
  const encode = (s: string) => '"' + (/^[=+@-]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"'
  const csv = [columns.map(encode).join(','), ...owned(kind).map((i) => columns.map((c) => encode(i.payload[c] || '')).join(','))].join('\r\n')
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
function renderJobs() {
  const role = select<HTMLSelectElement>('#job-role').value,
    location = select<HTMLInputElement>('#job-location').value.trim().toLowerCase(),
    employment = select<HTMLSelectElement>('#job-employment').value
  const list = jobs.filter((j) => (!role || j.role === role) && (!location || j.location.toLowerCase().includes(location)) && (!employment || (j.employmentType || 'Not specified') === employment))
  select('[data-job-count]').textContent = `${list.length} results`
  select('[data-job-results]').innerHTML =
    list
      .map(
        (j) =>
          `<div class="col-md-6 col-xl-4"><div class="card job-card" data-job-card="${htmlEscape(j.id)}" tabindex="0" aria-label="Read description for ${htmlEscape(j.title)}" style="cursor:pointer"><div class="card-body d-flex flex-column"><div class="d-flex align-items-center gap-3 mb-3"><span class="avatar bg-white border rounded-3 position-relative text-blue" style="flex-shrink:0;width:48px;height:48px"><span data-company-placeholder>${companyPlaceholder()}</span>${safeUrl(j.logo) ? `<img data-company-logo src="${htmlEscape(safeUrl(j.logo))}" alt="${htmlEscape(j.company)} logo" loading="lazy" referrerpolicy="no-referrer" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:white;padding:4px;border-radius:inherit" />` : ''}</span><div style="min-width:0"><div class="fw-semibold">${htmlEscape(j.company)}</div><span class="text-secondary small" data-job-location>${htmlEscape(j.location)}</span></div></div><h3 class="job-title"><button class="job-title-link" data-job-details="${htmlEscape(j.id)}">${htmlEscape(j.title)}</button></h3><button class="job-details-link" data-job-details="${htmlEscape(j.id)}">Read job description &rarr;</button><div class="d-flex flex-wrap gap-2 mt-2 mb-3"><span class="job-tag">${htmlEscape(j.role)}</span><span class="job-tag">${htmlEscape(j.workMode)}</span><span class="job-tag">${htmlEscape(j.employmentType || 'Not specified')}</span>${j.salary ? `<span class="job-tag">${htmlEscape(j.salary)}</span>` : ''}</div><p class="text-secondary small">Source: <a href="${htmlEscape(safeUrl(j.url))}" target="_blank" rel="noopener noreferrer">${htmlEscape(j.source)}</a>${j.date ? ' | ' + htmlEscape(j.date.slice(0, 10)) : ''}</p><div class="d-flex gap-2 mt-auto"><a class="btn btn-primary flex-grow-1" href="${htmlEscape(safeUrl(j.url))}" target="_blank" rel="noopener noreferrer" data-apply-job="${htmlEscape(j.id)}">${j.direct ? 'Apply on company site' : 'Apply via source'} &nearr;</a><button class="btn" data-track="${htmlEscape(j.id)}" aria-label="Save ${htmlEscape(j.title)}">Save</button></div></div></div></div>`,
      )
      .join('') || `<div class="col-12">${empty('No matching roles or locations. Try broader filters or search the official sources below.')}</div>`
  root.querySelectorAll<HTMLImageElement>('[data-company-logo]').forEach((image) => image.addEventListener('error', () => image.remove(), { once: true }))
}
function renderSources() {
  const q = select<HTMLInputElement>('#job-query').value || 'virtual assistant',
    encoded = encodeURIComponent(q),
    location = select<HTMLInputElement>('#job-location').value.trim() || 'Philippines'
  const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(q + ' jobs ' + location)}`
  select<HTMLAnchorElement>('[data-google-job-search]').href = googleSearchUrl
  const sources: [string, string, string][] = [
    ['Google job search', 'Search jobs and company career pages across the web', `https://www.google.com/search?q=${encodeURIComponent(q + ' jobs ' + location)}`],
    ['Indeed PH', 'Philippine jobs across industries', `https://ph.indeed.com/jobs?q=${encoded}&l=Philippines`],
    ['JobStreet PH', 'Company opportunities in the Philippines', `https://ph.jobstreet.com/jobs?keywords=${encoded}`],
    ['OnlineJobs.ph', 'Remote roles for Filipino professionals', `https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=${encoded}`],
    ['LinkedIn Jobs', 'Professional roles and company careers', `https://www.linkedin.com/jobs/search/?keywords=${encoded}&location=Philippines`],
    ['Athena', 'Executive assistance careers', 'https://www.athena.com/careers'],
    ['Cyberbacker', 'Virtual assistance opportunities', 'https://cyberbacker.ph/careers/'],
  ]
  select('[data-job-sources]').innerHTML = sources
    .map(
      ([name, description, url]) =>
        `<div class="col-md-6 col-xl-4"><div class="card"><div class="card-body"><span class="badge bg-blue-lt mb-2">External search</span><h3>${name}</h3><p class="text-secondary small">${description}</p><a href="${htmlEscape(url)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm">Open search &nearr;</a></div></div></div>`,
    )
    .join('')
}
async function loadJobs() {
  const request = ++jobRequest
  clearError()
  select('[data-job-results]').innerHTML = empty('Searching this source...')
  renderSources()
  select('[data-feed-message]').textContent = 'Loading the job feed '
  const form = select<HTMLFormElement>('[data-job-search]')
  form.setAttribute('aria-busy', 'true')
  try {
    const q = select<HTMLInputElement>('#job-query').value,
      source = select<HTMLSelectElement>('#job-source').value
    const data = await api('jobs/search?' + new URLSearchParams({ q, source }).toString())
    if (request !== jobRequest) return
    jobs = data.jobs
    select('[data-feed-message]').textContent = data.message
    renderJobs()
    if (data.mode === 'external' && safeUrl(data.searchUrl))
      select('[data-job-results]').innerHTML =
        `<div class="col-12"><div class="card card-body text-center"><h3>Search ${htmlEscape(data.source)} directly</h3><p class="text-secondary">${htmlEscape(data.message)}</p><a class="btn btn-primary align-self-center" href="${htmlEscape(safeUrl(data.searchUrl))}" target="_blank" rel="noopener noreferrer">Open official search &nearr;</a></div></div>`
  } catch (e) {
    if (request !== jobRequest) return
    jobs = []
    renderJobs()
    select('[data-feed-message]').textContent = 'The feed is currently unavailable.'
    error(e instanceof Error ? e.message : 'Unable to search.')
  } finally {
    if (request === jobRequest) form.setAttribute('aria-busy', 'false')
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
  select('#job-role').addEventListener('change', renderJobs)
  select('#job-location').addEventListener('input', () => {
    renderJobs()
    renderSources()
  })
  select('#job-query').addEventListener('input', () => {
    renderSources()
    clearTimeout(searchTimer)
    searchTimer = setTimeout(searchNow, 350)
  })
  select('#job-employment').addEventListener('change', renderJobs)
  attachSuggestions(select<HTMLInputElement>('#job-query'), select('#job-query-suggestions'), () => [...jobs.map((job) => job.title), 'Virtual assistant', 'Executive assistant', 'Customer support', 'Software developer', 'Web developer', 'Graphic designer', 'Social media manager', 'Bookkeeper', 'Data entry'], searchNow)
  attachSuggestions(select<HTMLInputElement>('#job-location'), select('#job-location-suggestions'), () => [...jobs.flatMap((job) => job.location.split(/[,;]/).map((location) => location.trim())), 'Philippines', 'Manila', 'Cebu', 'Davao', 'Worldwide', 'USA', 'United Kingdom', 'Canada', 'Australia'], renderJobs)
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
