/**
 * Marks a scroller with `has-more` while its content continues below the bottom edge, so a cut-off control reads as
 * "scroll for more". Watches the scroller, its children (text size, re-renders) and the scroll position.
 */
export function markMoreContent(scroller: HTMLElement): void {
  const update = () => scroller.classList.toggle('has-more', scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 1)
  const sizes = new ResizeObserver(update)
  const watchChildren = () => {
    for (const child of scroller.children) sizes.observe(child)
  }
  sizes.observe(scroller)
  watchChildren()
  new MutationObserver(() => {
    watchChildren()
    update()
  }).observe(scroller, { childList: true })
  scroller.addEventListener('scroll', update, { passive: true })
}
