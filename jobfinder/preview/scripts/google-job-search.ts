type GoogleElement = { execute: (query: string) => void }
type GoogleWindow = Window & { __gcse?: { callback: () => void }; google?: { search?: { cse?: { element?: { getElement: (name: string) => GoogleElement | undefined } } } } }
const root = document.querySelector<HTMLElement>('[data-google-search]')
if (root?.dataset.engineId) {
  const button = root.querySelector<HTMLAnchorElement>('[data-google-job-search]')!
  const results = root.querySelector<HTMLElement>('[data-google-results]')!
  const status = root.querySelector<HTMLElement>('[data-google-status]')!
  let loading = false
  const execute = () => {
    const element = (window as GoogleWindow).google?.search?.cse?.element?.getElement('joblink-jobs')
    if (!element) return false
    const role = document.querySelector<HTMLInputElement>('#job-query')?.value.trim() || 'jobs'
    const location = document.querySelector<HTMLInputElement>('#job-location')?.value.trim() || 'Philippines'
    element.execute(role + ' jobs ' + location)
    status.textContent = 'Results provided by Google.'
    return true
  }
  button.addEventListener('click', (event) => {
    event.preventDefault()
    results.classList.remove('d-none')
    if (execute() || loading) return
    loading = true
    ;(window as GoogleWindow).__gcse = { callback: () => { loading = false; execute() } }
    const script = document.createElement('script')
    script.src = 'https://cse.google.com/cse.js?cx=' + encodeURIComponent(root.dataset.engineId!)
    script.async = true
    script.addEventListener('error', () => {
      loading = false
      status.textContent = 'Google results could not load. Use the link below to continue.'
      const fallback = document.createElement('a')
      fallback.className = 'btn btn-sm'
      fallback.href = button.href
      fallback.target = '_blank'
      fallback.rel = 'noopener noreferrer'
      fallback.textContent = 'Open Google search'
      status.replaceChildren(document.createTextNode('Google results could not load. '), fallback)
      script.remove()
    }, { once: true })
    document.head.append(script)
  })
}
