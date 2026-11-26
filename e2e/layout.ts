import { expect, type Page } from '@playwright/test'

/** Sizes every screen must handle: minimum portrait and landscape, the Poki frames and a desktop. */
export const layoutSizes = [
  { width: 320, height: 568 },
  { width: 568, height: 320 },
  { width: 640, height: 360 },
  { width: 836, height: 470 },
  { width: 1031, height: 580 },
  { width: 1440, height: 900 },
] as const

export interface LayoutOptions {
  /** Controls to check. Defaults to every button, link and form control. */
  controls?: string
}

/**
 * Checks the screen as shown: no horizontal scrolling, controls at least 44 × 44 CSS px, no two controls overlapping,
 * every scroller whose content continues below its bottom edge shows the `has-more` signal, and every control
 * visible and on top either at once or after scrolling it into view. With a modal dialog open, only the dialog's
 * controls count, because the screen behind it is inert.
 */
export async function expectUsableLayout(page: Page, { controls = 'button, a[href], input, select, textarea, [role="switch"]' }: LayoutOptions = {}) {
  // The signal follows resize observers, so it is polled before anything below scrolls.
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('*')]
          .filter((node) => {
            const overflowY = getComputedStyle(node).overflowY
            const scrolls = (overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1
            return scrolls && node.scrollHeight - node.scrollTop - node.clientHeight > 1 && !node.classList.contains('has-more')
          })
          .map((node) => `${node.tagName.toLowerCase()}.${node.className} hides content below without the has-more signal`),
      ),
    )
    .toEqual([])

  const problems = await page.evaluate((selector) => {
    const found: string[] = []
    const describe = (control: Element) =>
      `${control.tagName.toLowerCase()} "${(control.getAttribute('aria-label') ?? control.textContent ?? '').trim().slice(0, 40)}"`
    const shown = (control: Element) => {
      const style = getComputedStyle(control)
      const rect = control.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1
    }

    if (document.documentElement.scrollWidth > innerWidth) found.push(`page scrolls horizontally (${document.documentElement.scrollWidth} > ${innerWidth})`)
    for (const node of document.querySelectorAll('*')) {
      const overflowX = getComputedStyle(node).overflowX
      if ((overflowX === 'auto' || overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 1) {
        found.push(`${node.tagName.toLowerCase()}.${node.className} scrolls horizontally`)
      }
    }

    const layer: ParentNode = document.querySelector('dialog[open]') ?? document
    const targets = [...layer.querySelectorAll(selector)].filter(shown)

    for (const control of targets) {
      const rect = control.getBoundingClientRect()
      if (rect.width < 44 - 0.5 || rect.height < 44 - 0.5) {
        found.push(`${describe(control)} is ${Math.round(rect.width)} × ${Math.round(rect.height)}`)
      }
    }

    for (const [index, first] of targets.entries()) {
      for (const second of targets.slice(index + 1)) {
        if (first.contains(second) || second.contains(first)) continue
        const a = first.getBoundingClientRect()
        const b = second.getBoundingClientRect()
        const width = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (width > 1 && height > 1) found.push(`${describe(first)} overlaps ${describe(second)}`)
      }
    }

    const onTop = (control: Element) => {
      const rect = control.getBoundingClientRect()
      const points = [
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
        [rect.left + rect.width * 0.25, rect.top + rect.height * 0.25],
        [rect.left + rect.width * 0.75, rect.top + rect.height * 0.75],
      ]
      return points.every(([x, y]) => {
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false
        const hit = document.elementFromPoint(x, y)
        return hit !== null && control.contains(hit)
      })
    }
    for (const control of targets) {
      if (onTop(control)) continue
      control.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      if (!onTop(control)) found.push(`${describe(control)} cannot be seen`)
    }
    return found
  }, controls)
  expect(problems).toEqual([])
}
