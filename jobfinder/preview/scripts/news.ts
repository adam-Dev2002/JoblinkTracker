export {}
type Story = { id: number; title: string; url: string; source: string; author: string; date: string; image: string; description: string; minutes: number; tags: string[]; body?: string }
const root = document.querySelector<HTMLElement>('[data-news-experience]')!
const el = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!
const escapeHtml = (value: string | number) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const placeholder = '/static/photos/a-woman-works-at-a-desk-with-a-laptop-and-a-cup-of-coffee.jpg'
let stories: Story[] = []
let topic = 'all'
let visibleCount = 9
let selected: Story | null = null
let readerRequest = 0
let fontSize = 16
let previousFocus: HTMLElement | null = null
const url = (value: string) => {
  try {
    const parsed = new URL(value)
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : ''
  } catch {
    return ''
  }
}
async function fetchNews(path: string) {
  const response = await fetch('/api/jobs/' + path, { signal: AbortSignal.timeout(30000) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Unable to load the story.')
  return data
}
function renderStories() {
  const query = el<HTMLInputElement>('[data-news-search]').value.toLowerCase()
  const filtered = stories.filter((s) => (topic === 'all' || s.tags.includes(topic)) && [s.title, s.author, s.description, ...s.tags].join(' ').toLowerCase().includes(query))
  el('[data-news-count]').textContent = `Showing ${Math.min(visibleCount, filtered.length)} of ${filtered.length} stories`
  el('[data-news-list]').innerHTML =
    filtered
      .slice(0, visibleCount)
      .map((story, index) => {
        const featured = index === 0 && topic === 'all' && !query
        return `<div class="news-bento-story ${featured ? 'featured-tile' : ''}"><article class="card story-card ${featured ? 'story-featured' : ''}"><button class="story-cover-button" data-read-story="${story.id}" aria-label="Read ${escapeHtml(story.title)}"><img class="story-cover" src="${escapeHtml(url(story.image) || placeholder)}" alt="${story.image ? 'Article cover' : 'Illustrative workspace cover'}" loading="${index < 2 ? 'eager' : 'lazy'}" /><span class="story-overlay">${escapeHtml(story.tags[0] || 'Career')} / ${story.minutes} min read</span></button><div class="card-body"><div class="story-meta mb-2"><span>${escapeHtml(story.author)}</span><time>${escapeHtml(story.date.slice(0, 10))}</time></div><h3><button class="story-title-button" data-read-story="${story.id}">${escapeHtml(story.title)}</button></h3><p class="story-excerpt">${escapeHtml(story.description)}</p><div class="d-flex justify-content-between align-items-center"><button class="story-read" data-read-story="${story.id}">Read story &rarr;</button><span class="text-secondary small">DEV Community</span></div></div></article></div>`
      })
      .join('') || '<div class="col-12"><div class="card card-body text-center text-secondary">No matching stories. Try another topic or search term.</div></div>'
  el('[data-news-more]').classList.toggle('d-none', filtered.length <= visibleCount)
  root.querySelectorAll<HTMLImageElement>('.story-cover').forEach((img) =>
    img.addEventListener(
      'error',
      () => {
        if (!img.src.endsWith(placeholder)) {
          img.src = placeholder
          img.alt = 'Illustrative workspace cover'
        }
      },
      { once: true },
    ),
  )
}
function sanitizeArticle(html: string, source: string): DocumentFragment {
  const documentInput = new DOMParser().parseFromString(html, 'text/html')
  const fragment = document.createDocumentFragment()
  const allowed = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'blockquote', 'pre', 'code', 'br', 'hr', 'a', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'details', 'summary', 'div', 'span'])
  const discard = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'link', 'meta', 'form', 'input', 'button', 'textarea', 'select'])
  const copy = (node: Node, parent: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent || ''))
      return
    }
    if (!(node instanceof Element)) return
    const name = node.tagName.toLowerCase()
    if (discard.has(name)) return
    if (!allowed.has(name)) {
      for (const child of node.childNodes) copy(child, parent)
      return
    }
    const clean = document.createElement(name)
    const resolve = (attribute: string) => {
      try {
        return url(new URL(node.getAttribute(attribute) || '', source).href)
      } catch {
        return ''
      }
    }
    if (name === 'a') {
      const href = resolve('href')
      if (href) {
        clean.setAttribute('href', href)
        clean.setAttribute('target', '_blank')
        clean.setAttribute('rel', 'noopener noreferrer')
      }
    }
    if (name === 'img') {
      const src = resolve('src')
      if (!src || !node.getAttribute('src')) return
      clean.setAttribute('src', src)
      clean.setAttribute('alt', node.getAttribute('alt') || 'Article image')
      clean.setAttribute('loading', 'lazy')
      clean.setAttribute('referrerpolicy', 'no-referrer')
    }
    for (const child of node.childNodes) copy(child, clean)
    parent.appendChild(clean)
  }
  for (const child of documentInput.body.childNodes) copy(child, fragment)
  return fragment
}
function closeReader() {
  readerRequest++
  el('[data-news-reader]').classList.add('d-none')
  document.body.classList.remove('reading-open')
  previousFocus?.focus()
}
async function openReader(id: number) {
  const story = stories.find((s) => s.id === id)
  if (!story) return
  selected = story
  previousFocus = document.activeElement as HTMLElement
  const request = ++readerRequest
  el('[data-news-reader]').classList.remove('d-none')
  document.body.classList.add('reading-open')
  el('[data-reader-close]').focus()
  el('[data-reader-article]').classList.add('d-none')
  el('[data-reader-status]').classList.remove('d-none')
  el('[data-reader-status]').textContent = 'Opening the story...'
  el('[data-read-progress]').style.width = '0'
  try {
    const data = await fetchNews('article?id=' + id)
    if (request !== readerRequest) return
    const article = data.article as Story
    selected = article
    el('[data-reader-title]').textContent = article.title
    el('[data-reader-tags]').textContent = article.tags.join(' / ')
    el('[data-reader-author]').textContent = `By ${article.author} | ${article.date.slice(0, 10)} | ${article.minutes} min read`
    const img = el<HTMLImageElement>('[data-reader-cover]')
    img.src = url(article.image) || placeholder
    img.alt = article.image ? 'Article cover' : 'Illustrative workspace cover'
    img.onerror = () => {
      img.onerror = null
      img.src = placeholder
    }
    el('[data-reader-body]').replaceChildren(sanitizeArticle(article.body || '<p>This article has no available body.</p>', article.url))
    el<HTMLAnchorElement>('[data-reader-source]').href = url(article.url)
    el('[data-reader-status]').classList.add('d-none')
    el('[data-reader-article]').classList.remove('d-none')
    el('[data-reader-scroll]').scrollTop = 0
  } catch (error) {
    if (request === readerRequest) el('[data-reader-status]').textContent = error instanceof Error ? error.message : 'Unable to open this story.'
  }
}
root.addEventListener('click', (event) => {
  const target = (event.target as Element).closest<HTMLElement>('button')
  if (!target) return
  if (target.dataset.readStory) void openReader(Number(target.dataset.readStory))
  if (target.dataset.newsTopic) {
    topic = target.dataset.newsTopic
    visibleCount = 9
    root.querySelectorAll<HTMLElement>('[data-news-topic]').forEach((button) => {
      const active = button.dataset.newsTopic === topic
      button.classList.toggle('btn-primary', active)
      button.classList.toggle('btn-white', !active)
      button.setAttribute('aria-pressed', String(active))
    })
    renderStories()
  }
  if (target.hasAttribute('data-reader-close')) closeReader()
  if (target.hasAttribute('data-reader-larger')) {
    fontSize = Math.min(22, fontSize + 1)
    el('[data-reader-body]').style.setProperty('--reader-font', fontSize + 'px')
  }
  if (target.hasAttribute('data-reader-smaller')) {
    fontSize = Math.max(14, fontSize - 1)
    el('[data-reader-body]').style.setProperty('--reader-font', fontSize + 'px')
  }
  if (target.hasAttribute('data-reader-save') && selected) {
    const story = selected
    closeReader()
    window.dispatchEvent(new CustomEvent('jobify-save-article', { detail: { title: story.title, url: story.url, notes: `Article by ${story.author} on DEV Community` } }))
  }
})
el('[data-news-reader]').addEventListener('click', (event) => {
  if (event.target === el('[data-news-reader]')) closeReader()
})
el('[data-reader-scroll]').addEventListener('scroll', () => {
  const scroll = el('[data-reader-scroll]'),
    height = scroll.scrollHeight - scroll.clientHeight
  el('[data-read-progress]').style.width = (height > 0 ? (scroll.scrollTop / height) * 100 : 100) + '%'
})
document.addEventListener('keydown', (event) => {
  if (el('[data-news-reader]').classList.contains('d-none')) return
  if (event.key === 'Escape') closeReader()
  if (event.key === 'Tab') {
    const controls = Array.from(el('[data-news-reader]').querySelectorAll<HTMLElement>('button,a[href]')).filter((node) => !node.closest('.d-none'))
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
el('[data-news-search]').addEventListener('input', () => {
  visibleCount = 9
  renderStories()
})
el('[data-news-more]').addEventListener('click', () => {
  visibleCount += 8
  renderStories()
})
async function load() {
  const button = el<HTMLButtonElement>('[data-news-refresh]')
  button.disabled = true
  try {
    const data = await fetchNews('news')
    stories = data.articles
    renderStories()
  } catch (error) {
    el('[data-news-list]').innerHTML = `<div class="col-12"><div class="card card-body text-secondary">${escapeHtml(error instanceof Error ? error.message : 'News is unavailable.')}</div></div>`
  } finally {
    button.disabled = false
  }
}
el('[data-news-refresh]').addEventListener('click', () => {
  void load()
})
void load()
