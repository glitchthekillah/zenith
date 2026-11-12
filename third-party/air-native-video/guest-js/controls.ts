export const VIDEO_CONTROLS_ATTRIBUTE = 'data-air-video-controls'
export type VideoControlsTarget = Element | Iterable<Element>

interface ControlRegistration {
  count: number
  previousValue: string | null
}

const controlRegistrations = new WeakMap<Element, ControlRegistration>()

/** Mark arbitrary DOM as UI belonging to a player. */
export function registerVideoControls(target: VideoControlsTarget): () => void {
  const elements = target instanceof Element ? [target] : [...target]
  for (const element of elements) {
    const existing = controlRegistrations.get(element)
    if (existing) {
      existing.count += 1
      continue
    }
    controlRegistrations.set(element, {
      count: 1,
      previousValue: element.getAttribute(VIDEO_CONTROLS_ATTRIBUTE),
    })
    element.setAttribute(VIDEO_CONTROLS_ATTRIBUTE, '')
  }
  let active = true
  return () => {
    if (!active) return
    active = false
    for (const element of elements) {
      const existing = controlRegistrations.get(element)
      if (!existing) continue
      existing.count -= 1
      if (existing.count > 0) continue
      controlRegistrations.delete(element)
      if (existing.previousValue === null) element.removeAttribute(VIDEO_CONTROLS_ATTRIBUTE)
      else element.setAttribute(VIDEO_CONTROLS_ATTRIBUTE, existing.previousValue)
    }
  }
}
