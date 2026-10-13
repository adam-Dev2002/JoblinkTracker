type TableEntry = { id: number; payload: { title: string; status?: string } }

export function attachTableActions(root: HTMLElement, entry: (id: number) => TableEntry | undefined) {
  const menu = root.querySelector<HTMLElement>('[data-workspace-row-menu]')!
  let trigger: HTMLButtonElement | null = null
  const close = (restoreFocus = false) => {
    if (!menu.matches(':popover-open')) return
    menu.hidePopover()
    trigger?.setAttribute('aria-expanded', 'false')
    if (restoreFocus) trigger?.focus({ preventScroll: true })
  }
  const controls = () => Array.from(menu.querySelectorAll<HTMLButtonElement>('[role=menuitem]')).filter(button => !button.hidden && !button.disabled)
  const position = () => {
    if (!trigger || !menu.matches(':popover-open')) return
    const anchor = trigger.getBoundingClientRect()
    const box = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(12, Math.min(anchor.right - box.width, innerWidth - box.width - 12))}px`
    const below = anchor.bottom + 6
    const top = below + box.height <= innerHeight - 12 ? below : anchor.top - box.height - 6
    menu.style.top = `${Math.max(12, Math.min(top, innerHeight - box.height - 12))}px`
  }
  const open = (button: HTMLButtonElement) => {
    if (trigger === button && menu.matches(':popover-open')) { close(true); return }
    close()
    const item = entry(Number(button.dataset.applicationActions || button.dataset.sheetActions))
    if (!item) return
    trigger = button
    const mark = menu.querySelector<HTMLButtonElement>('[data-table-mark]')
    if (mark) {
      mark.hidden = !['Saved', 'Application opened'].includes(item.payload.status || '')
      mark.dataset.confirmApplication = String(item.id)
    }
    menu.querySelector<HTMLButtonElement>('[data-table-edit]')!.dataset.edit = String(item.id)
    const remove = menu.querySelector<HTMLButtonElement>('[data-table-delete]')!
    remove.dataset.delete = String(item.id)
    remove.setAttribute('aria-label', `Remove ${item.payload.title}`)
    menu.showPopover()
    button.setAttribute('aria-expanded', 'true')
    position()
    controls()[0]?.focus({ preventScroll: true })
  }
  menu.addEventListener('beforetoggle', event => {
    if ((event as ToggleEvent).newState === 'closed') trigger?.setAttribute('aria-expanded', 'false')
  })
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.stopPropagation()
      close(true)
      if (event.key === 'Escape') event.preventDefault()
      return
    }
    const buttons = controls()
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      event.stopPropagation()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next]?.focus()
    }
  })
  window.addEventListener('resize', () => close())
  document.addEventListener('scroll', event => {
    if (!menu.matches(':popover-open') || (event.target instanceof Node && menu.contains(event.target))) return
    const anchor = trigger?.getBoundingClientRect()
    if (!trigger?.isConnected || !anchor || anchor.bottom < 0 || anchor.top > innerHeight) close()
    else position()
  }, true)
  return { close, open }
}
