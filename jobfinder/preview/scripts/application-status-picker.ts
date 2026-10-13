import { applicationStatusColor } from './application-status'

const chevron = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" class="application-status-chevron"><path d="m6 9 6 6 6-6"/></svg>'
const check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" class="application-status-check"><path d="m5 12 4 4L19 6"/></svg>'

export function attachApplicationStatusPicker(root: HTMLElement) {
  // Keep native selects for form submission and browsers without popovers.
  if (!('showPopover' in HTMLElement.prototype)) return { refresh() {}, close() {} }
  const menu = document.createElement('div')
  menu.id = 'application-status-options'
  menu.className = 'application-status-menu'
  menu.popover = 'auto'
  menu.setAttribute('role', 'listbox')
  menu.setAttribute('aria-label', 'Application status')
  root.append(menu)
  let control: HTMLSelectElement | null = null
  let trigger: HTMLButtonElement | null = null
  let active = -1
  let sequence = 0
  let search = ''
  let searchedAt = 0
  const options = () => Array.from(menu.querySelectorAll<HTMLButtonElement>('[role=option]'))
  const close = () => {
    if (menu.matches(':popover-open')) menu.hidePopover()
    trigger?.setAttribute('aria-expanded', 'false')
    trigger?.removeAttribute('aria-activedescendant')
  }
  const sync = (select: HTMLSelectElement, button: HTMLButtonElement) => {
    button.dataset.statusColor = applicationStatusColor(select.value)
    button.querySelector('[data-status-label]')!.textContent = select.selectedOptions[0]?.textContent || select.value
    button.disabled = select.disabled
  }
  const activate = (index: number) => {
    const entries = options()
    if (!entries.length) return
    active = (index + entries.length) % entries.length
    const entry = entries[active]!
    entries.forEach((entry, i) => entry.dataset.active = String(i === active))
    trigger?.setAttribute('aria-activedescendant', entry.id)
    entry.scrollIntoView({ block: 'nearest' })
  }
  const position = () => {
    if (!trigger || !menu.matches(':popover-open')) return
    if (!trigger.isConnected) { close(); return }
    const anchor = trigger.getBoundingClientRect()
    menu.style.width = `${Math.min(Math.max(anchor.width, 200), innerWidth - 24)}px`
    const box = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(12, Math.min(anchor.left, innerWidth - box.width - 12))}px`
    const top = anchor.bottom + 6 + box.height <= innerHeight - 12 ? anchor.bottom + 6 : anchor.top - box.height - 6
    menu.style.top = `${Math.max(12, Math.min(top, innerHeight - box.height - 12))}px`
  }
  const choose = (index: number) => {
    if (!control || !trigger || !control.options[index] || control.disabled) return
    const select = control, button = trigger, value = select.options[index]!.value
    close()
    button.focus({ preventScroll: true })
    if (value === select.value) return
    select.value = value
    sync(select, button)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const open = (select: HTMLSelectElement, button: HTMLButtonElement) => {
    close()
    control = select
    trigger = button
    search = ''
    menu.replaceChildren()
    Array.from(select.options).forEach((option, index) => {
      const entry = document.createElement('button')
      entry.type = 'button'
      entry.className = 'application-status-option'
      entry.id = `${menu.id}-${index}`
      entry.tabIndex = -1
      entry.dataset.statusColor = applicationStatusColor(option.value)
      entry.setAttribute('role', 'option')
      entry.setAttribute('aria-selected', String(option.selected))
      entry.innerHTML = '<span class="application-status-dot" aria-hidden="true"></span><span data-status-label></span>' + (option.selected ? check : '')
      entry.querySelector('[data-status-label]')!.textContent = option.textContent
      entry.addEventListener('pointerdown', event => event.preventDefault())
      entry.addEventListener('pointermove', () => activate(index))
      entry.addEventListener('click', () => choose(index))
      menu.append(entry)
    })
    menu.showPopover()
    button.setAttribute('aria-expanded', 'true')
    position()
    activate(Math.max(0, select.selectedIndex))
  }
  menu.addEventListener('toggle', () => {
    if (!menu.matches(':popover-open')) {
      trigger?.setAttribute('aria-expanded', 'false')
      trigger?.removeAttribute('aria-activedescendant')
    }
  })
  window.addEventListener('resize', close)
  document.addEventListener('scroll', event => {
    if (!(event.target instanceof Node) || !menu.contains(event.target)) position()
  }, true)
  return {
    close,
    refresh() {
      if (trigger && !trigger.isConnected) close()
      root.querySelectorAll<HTMLSelectElement>('select.application-status-control').forEach(select => {
        if (select.closest('.application-status-picker')) return
        const wrapper = document.createElement('div')
        wrapper.className = 'application-status-picker'
        select.before(wrapper)
        wrapper.append(select)
        select.classList.add('visually-hidden')
        select.tabIndex = -1
        select.setAttribute('aria-hidden', 'true')
        const button = document.createElement('button')
        button.type = 'button'
        button.id = `${select.id || 'application-status-' + ++sequence}-trigger`
        button.className = 'application-status-trigger'
        button.setAttribute('role', 'combobox')
        button.setAttribute('aria-haspopup', 'listbox')
        button.setAttribute('aria-expanded', 'false')
        button.setAttribute('aria-controls', menu.id)
        if (select.hasAttribute('aria-label')) button.setAttribute('aria-label', select.getAttribute('aria-label')!)
        for (const label of Array.from(select.labels || [])) label.htmlFor = button.id
        button.innerHTML = '<span class="application-status-dot" aria-hidden="true"></span><span data-status-label></span>' + chevron
        wrapper.append(button)
        sync(select, button)
        select.addEventListener('change', () => sync(select, button))
        button.addEventListener('click', () => {
          if (trigger === button && menu.matches(':popover-open')) close()
          else open(select, button)
        })
        button.addEventListener('keydown', event => {
          const expanded = trigger === button && menu.matches(':popover-open')
          if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); close(); return }
          if (event.key === 'Tab') { close(); return }
          if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
            event.preventDefault()
            event.stopPropagation()
            if (!expanded) { open(select, button); return }
            if (event.key === 'Enter' || event.key === ' ') choose(active)
            else activate(event.key === 'Home' ? 0 : event.key === 'End' ? options().length - 1 : active + (event.key === 'ArrowDown' ? 1 : -1))
          } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault()
            if (!expanded) open(select, button)
            const now = Date.now()
            search = (now - searchedAt < 700 ? search : '') + event.key.toLowerCase()
            searchedAt = now
            const index = Array.from(select.options).findIndex(option => option.textContent?.toLowerCase().startsWith(search))
            if (index >= 0) activate(index)
          }
        })
      })
    },
  }
}
