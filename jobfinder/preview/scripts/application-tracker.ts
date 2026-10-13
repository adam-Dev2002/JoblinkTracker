import { applicationStatusColor } from './application-status'

type Application = { id: number; payload: Record<string, string> & { title: string; company: string; status: string } }

export function attachTrackedJobSearch(input: HTMLInputElement, list: HTMLElement, applications: () => Application[], onQuery: () => void, onChoose: (id: number) => void) {
  let options: Application[] = []
  let active = -1
  let blurTimer: ReturnType<typeof setTimeout> | undefined
  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-autocomplete', 'list')
  input.setAttribute('aria-controls', list.id)
  input.setAttribute('aria-expanded', 'false')
  input.autocomplete = 'off'
  const close = () => {
    list.classList.add('d-none')
    input.setAttribute('aria-expanded', 'false')
    input.removeAttribute('aria-activedescendant')
    active = -1
  }
  const choose = (index: number) => {
    const item = options[index]
    if (!item) return
    input.value = item.payload.title
    close()
    onChoose(item.id)
  }
  const show = () => {
    clearTimeout(blurTimer)
    const query = input.value.trim().toLowerCase()
    options = applications().filter(item => Object.values(item.payload).join(' ').toLowerCase().includes(query))
    list.replaceChildren()
    active = -1
    input.removeAttribute('aria-activedescendant')
    if (!options.length) {
      close()
      return
    }
    options.forEach((item, index) => {
      const option = document.createElement('button')
      option.type = 'button'
      option.className = 'suggestion-option'
      option.id = `${list.id}-${index}`
      option.setAttribute('role', 'option')
      option.setAttribute('aria-selected', 'false')
      const copy = document.createElement('span')
      copy.className = 'application-suggestion-copy'
      const title = document.createElement('strong')
      title.textContent = item.payload.title
      const company = document.createElement('small')
      company.className = 'text-secondary'
      company.textContent = item.payload.company || 'Company not specified'
      copy.append(title, company)
      const status = document.createElement('span')
      status.className = 'badge application-status-badge'
      status.dataset.statusColor = applicationStatusColor(item.payload.status)
      status.textContent = item.payload.status
      option.append(copy, status)
      option.addEventListener('pointerdown', event => event.preventDefault())
      option.addEventListener('click', () => choose(index))
      list.append(option)
    })
    list.classList.remove('d-none')
    input.setAttribute('aria-expanded', 'true')
  }
  input.addEventListener('input', () => { onQuery(); show() })
  input.addEventListener('focus', show)
  input.addEventListener('click', show)
  input.addEventListener('blur', () => { blurTimer = setTimeout(close, 100) })
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape' || event.key === 'Tab') close()
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (list.classList.contains('d-none')) show()
      if (!options.length) return
      active = active < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1) : (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
      list.querySelectorAll('[role=option]').forEach((option, index) => option.setAttribute('aria-selected', String(index === active)))
      input.setAttribute('aria-activedescendant', `${list.id}-${active}`)
      list.children[active]?.scrollIntoView({ block: 'nearest' })
    }
    if (event.key === 'Enter' && !list.classList.contains('d-none') && active >= 0) {
      event.preventDefault()
      choose(active)
    }
  })
  document.addEventListener('click', event => {
    if (event.target !== input && !list.contains(event.target as Node)) close()
  })
  return { close }
}
