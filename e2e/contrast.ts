import { expect, type Page } from '@playwright/test'

// D2, brief §9: WCAG AA contrast measured on the rendered screen, against the pixels really behind each text and
// beside each focus ring, so scrims, tinted panels, images and translucent colours all count.

interface TextSample {
  text: string
  /** Text colour as drawn: RGB 0–255 and the alpha of the colour times the opacity of every ancestor. */
  color: [number, number, number, number]
  large: boolean
  rects: { left: number; top: number; width: number; height: number }[]
}

interface RingSample {
  name: string
  /**
   * Per side of the control, the places along it, and at each place points across the band of the ring and its halo,
   * from just inside to just outside.
   */
  sides: [number, number][][][]
  focused: string
  unfocused: string
}

/** Draws the screen as it is, or with every text and focus ring made transparent, and returns it as a data URL. */
async function shot(page: Page, hideText: boolean): Promise<string> {
  const style = hideText
    ? await page.addStyleTag({ content: '*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; transition: none !important }' })
    : null
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' })
  await style?.evaluate((node) => (node as Element).remove())
  return `data:image/png;base64,${png.toString('base64')}`
}

/** The texts of the top layer that are visible and not covered, with their drawn colour and line boxes. */
async function visibleTexts(page: Page): Promise<{ samples: TextSample[]; inactive: number }> {
  // Hit testing must find labels that let clicks through (the hints) as the text on top.
  const reach = await page.addStyleTag({ content: '* { pointer-events: auto !important }' })
  const found = await page.evaluate(() => {
    const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number)
    const layer: Element = [...document.querySelectorAll('dialog[open]')].at(-1) ?? document.body
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
    const samples: TextSample[] = []
    let inactive = 0
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement
      const text = node.textContent?.trim() ?? ''
      if (!parent || !text || parent.closest('script, style, title')) continue
      if (!parent.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      const rects = [...range.getClientRects()].filter((rect) => {
        if (rect.width < 2 || rect.height < 2) return false
        const x = rect.left + rect.width / 2
        const y = rect.top + rect.height / 2
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false
        const hit = document.elementFromPoint(x, y)
        // Text clipped away (screen reader only) or covered by another element is not seen, so it is not measured.
        return hit !== null && parent.contains(hit)
      })
      if (rects.length === 0) continue
      if (parent.closest(':disabled, [aria-disabled="true"]')) inactive++
      const style = getComputedStyle(parent)
      const [r, g, b, a = 1] = parse(style.color)
      let opacity = a
      for (let ancestor: Element | null = parent; ancestor; ancestor = ancestor.parentElement) opacity *= Number(getComputedStyle(ancestor).opacity)
      const size = parseFloat(style.fontSize)
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700)
      samples.push({ text, color: [r, g, b, opacity], large, rects: rects.map(({ left, top, width, height }) => ({ left, top, width, height })) })
    }
    return { samples, inactive }
  })
  await reach.evaluate((node) => (node as Element).remove())
  return found
}

/**
 * Draws every control of the top layer without and with keyboard focus and returns both images and, per side,
 * points across its focus ring: the ring is seen where those pixels change from what was drawn there before.
 */
async function focusRings(page: Page): Promise<RingSample[]> {
  const count = await page.evaluate(() => {
    const layer: ParentNode = [...document.querySelectorAll('dialog[open]')].at(-1) ?? document
    const controls = [...layer.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])')].filter(
      (node) => !(node as HTMLButtonElement).disabled && node.checkVisibility({ visibilityProperty: true }) && node.getBoundingClientRect().width > 1,
    )
    document.querySelectorAll('[data-ring-probe]').forEach((node) => node.removeAttribute('data-ring-probe'))
    controls.forEach((node, index) => node.setAttribute('data-ring-probe', String(index)))
    return controls.length
  })
  const rings: RingSample[] = []
  // A key press first, so a programmatic focus counts as keyboard focus and shows the ring.
  await page.keyboard.press('Shift')
  for (let index = 0; index < count; index++) {
    const probe = page.locator(`[data-ring-probe="${index}"]`)
    await probe.evaluate((node) => {
      node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      ;(document.activeElement as HTMLElement | null)?.blur()
    })
    const unfocused = await shot(page, false)
    const ring = await probe.evaluate((node: HTMLElement) => {
      node.focus()
      const style = getComputedStyle(node)
      const name = `${node.tagName.toLowerCase()} "${(node.getAttribute('aria-label') ?? node.textContent ?? '').trim().slice(0, 30)}"`
      if (!node.matches(':focus-visible') || style.outlineStyle === 'none') return { name, sides: [] }
      const offset = parseFloat(style.outlineOffset)
      const width = parseFloat(style.outlineWidth)
      const box = node.getBoundingClientRect()
      // Distances outward from the border edge; a negative offset draws the ring inside the box.
      const distances = [offset - 1, offset + 0.5, offset + width / 2, offset + width - 0.5, offset + width + 0.5]
      // A quarter, half and three quarters along each side, so a thin line of the picture under one spot does not
      // decide for the whole side.
      const along = [0.25, 0.5, 0.75]
      const sides = [
        (d: number, f: number) => [box.left + box.width * f, box.top - d],
        (d: number, f: number) => [box.left + box.width * f, box.bottom + d],
        (d: number, f: number) => [box.left - d, box.top + box.height * f],
        (d: number, f: number) => [box.right + d, box.top + box.height * f],
      ].map((side) => along.map((f) => distances.map((d) => side(d, f)) as [number, number][]))
      // A side beyond the window edge cannot be drawn by any page; the other sides must show the ring.
      const inside = (places: [number, number][][]) => places.flat().every(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight)
      return { name, sides: sides.map((places) => (inside(places) ? places : [])) }
    })
    expect(ring.sides.flat(2).length, `${ring.name} shows a focus ring`).toBeGreaterThan(0)
    rings.push({ ...ring, unfocused, focused: await shot(page, false) })
  }
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  return rings
}

/** Reads pixels of a screenshot in the page, where a canvas can decode it. */
function readPixels(page: Page, image: string, points: [number, number][]): Promise<[number, number, number][]> {
  return page.evaluate(
    async ({ image, points }) => {
      const bitmap = await createImageBitmap(await (await fetch(image)).blob())
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('No 2d canvas.')
      context.drawImage(bitmap, 0, 0)
      return points.map(([x, y]) => {
        const [r, g, b] = context.getImageData(Math.min(bitmap.width - 1, Math.max(0, Math.floor(x))), Math.min(bitmap.height - 1, Math.max(0, Math.floor(y))), 1, 1).data
        return [r, g, b] as [number, number, number]
      })
    },
    { image, points },
  )
}

function luminance([r, g, b]: number[]): number {
  const channel = (value: number) => {
    const c = value / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrast(first: number[], second: number[]): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

export interface ContrastReport {
  texts: number
  rings: number
  /** Texts on disabled controls; WCAG exempts them, but they are measured and held to the same ratio. */
  inactive: number
  lowestText: number
  lowestRing: number
}

/**
 * Every visible text of the top layer reaches 4.5:1 against the pixels behind it (large text 3:1), and every focus ring
 * changes the pixels it is drawn on by at least 3:1 on every side, so it stands out from the surface next to it.
 */
export async function expectReadableScreen(page: Page, where: string, { rings = true } = {}): Promise<ContrastReport> {
  const { samples, inactive } = await visibleTexts(page)
  const background = await shot(page, true)
  const problems: string[] = []
  let lowestText = Infinity
  for (const sample of samples) {
    const points = sample.rects.flatMap((rect) =>
      [0.2, 0.5, 0.8].flatMap((fx) => [0.3, 0.5, 0.7].map((fy) => [rect.left + rect.width * fx, rect.top + rect.height * fy] as [number, number])),
    )
    const pixels = await readPixels(page, background, points)
    const [r, g, b, alpha] = sample.color
    const ratio = Math.min(
      ...pixels.map((pixel) => {
        const drawn = [r, g, b].map((channel, index) => channel * alpha + pixel[index] * (1 - alpha))
        return contrast(drawn, pixel)
      }),
    )
    lowestText = Math.min(lowestText, ratio)
    const needed = sample.large ? 3 : 4.5
    if (ratio < needed) problems.push(`"${sample.text.slice(0, 40)}" ${ratio.toFixed(2)}:1 < ${needed}:1`)
  }

  let lowestRing = Infinity
  const measured = rings ? await focusRings(page) : []
  for (const ring of measured) {
    const points = ring.sides.flat(2)
    const [before, after] = await Promise.all([readPixels(page, ring.unfocused, points), readPixels(page, ring.focused, points)])
    let read = 0
    ring.sides.forEach((places, sideIndex) => {
      if (places.length === 0) return
      // Across the band the strongest change counts: the ring, or its halo where the ring itself sits on a dark
      // surface. Along the side the weakest place counts, so the ring shows at every one of them.
      const ratio = Math.min(
        ...places.map((band) =>
          Math.max(
            ...band.map(() => {
              const change = contrast(before[read], after[read])
              read++
              return change
            }),
          ),
        ),
      )
      lowestRing = Math.min(lowestRing, ratio)
      if (ratio < 3) problems.push(`focus ring of ${ring.name}, side ${['top', 'bottom', 'left', 'right'][sideIndex]}: ${ratio.toFixed(2)}:1 < 3:1`)
    })
  }
  expect(samples.length, `${where}: texts found`).toBeGreaterThan(0)
  expect(problems, where).toEqual([])
  return { texts: samples.length, rings: measured.length, inactive, lowestText, lowestRing }
}
