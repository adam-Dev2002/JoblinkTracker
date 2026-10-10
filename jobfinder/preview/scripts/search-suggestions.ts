export function attachSuggestions(input: HTMLInputElement, list: HTMLElement, values: () => string[], choose: () => void) {
  let options: string[] = []
  let active = -1
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
  const highlight = () => {
    list.querySelectorAll('[role=option]').forEach((node, index) => node.setAttribute('aria-selected', String(index === active)))
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', list.id + '-' + active)
      list.children[active]?.scrollIntoView({ block: 'nearest' })
    }
  }
  const select = (index: number) => {
    const value = options[index]
    if (!value) return
    input.value = value
    close()
    choose()
  }
  const show = () => {
    const query = input.value.trim().toLowerCase()
    const normalized = query === 'va' ? 'virtual assistant' : query
    options = Array.from(new Set(values().filter(Boolean)))
      .filter((value) => !normalized || value.toLowerCase().includes(normalized))
      .sort((a, b) => Number(b.toLowerCase().startsWith(normalized)) - Number(a.toLowerCase().startsWith(normalized)))
      .slice(0, 8)
    list.replaceChildren()
    active = -1
    if (!options.length) {
      close()
      return
    }
    options.forEach((value, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'suggestion-option'
      button.id = list.id + '-' + index
      button.setAttribute('role', 'option')
      button.setAttribute('aria-selected', 'false')
      button.textContent = value
      button.addEventListener('pointerdown', (event) => event.preventDefault())
      button.addEventListener('click', () => select(index))
      list.appendChild(button)
    })
    list.classList.remove('d-none')
    input.setAttribute('aria-expanded', 'true')
    input.removeAttribute('aria-activedescendant')
  }
  input.addEventListener('input', show)
  input.addEventListener('focus', show)
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (list.classList.contains('d-none')) show()
      if (!options.length) return
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
      highlight()
    }
    if (event.key === 'Enter' && !list.classList.contains('d-none') && active >= 0) {
      event.preventDefault()
      select(active)
    }
    if (event.key === 'Tab') close()
  })
  input.addEventListener('blur', () => setTimeout(close, 100))
  document.addEventListener('click', (event) => {
    if (event.target !== input && !list.contains(event.target as Node)) close()
  })
}
