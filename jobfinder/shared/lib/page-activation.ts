// Read-only preparation can run early; one-time user flows wait for a visit.
export const wasPrerendered = Boolean((document as Document & { prerendering?: boolean }).prerendering)
export function whenPageActive(): Promise<void> {
  if (!(document as Document & { prerendering?: boolean }).prerendering) return Promise.resolve()
  return new Promise(resolve => document.addEventListener('prerenderingchange', () => resolve(), { once: true }))
}
