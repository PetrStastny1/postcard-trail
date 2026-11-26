/**
 * Marks a scroller with `has-more` while its content continues below the bottom edge, so a cut-off control reads as
 * "scroll for more". Watches the scroller, its children (text size, re-renders) and the scroll position.
 */
export function markMoreContent(scroller: HTMLElement): void {
  const update = () => scroller.classList.toggle('has-more', hidesContentBelow(scroller))
  const sizes = new ResizeObserver(update)
  sizes.observe(scroller)
  for (const child of scroller.children) sizes.observe(child)
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.removedNodes) if (node instanceof Element) sizes.unobserve(node)
      for (const node of record.addedNodes) if (node instanceof Element) sizes.observe(node)
    }
    update()
  }).observe(scroller, { childList: true })
  scroller.addEventListener('scroll', update, { passive: true })
}

/**
 * Measured on the children, not on scrollHeight: overflow made only of the scroller's own bottom padding (kept for
 * focus rings) hides nothing, and the fade would dim a row that is fully in view.
 */
function hidesContentBelow(scroller: HTMLElement): boolean {
  if (scroller.scrollHeight <= scroller.clientHeight + 1) return false
  const visibleBottom = scroller.getBoundingClientRect().top + scroller.clientTop + scroller.clientHeight
  const contentBottom = Math.max(...[...scroller.children].map((child) => child.getBoundingClientRect().bottom))
  return contentBottom - visibleBottom > 1
}
