/** Resolves once the script has run. Rejects when it is blocked (ad blockers) or fails to load. */
export function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.addEventListener('load', () => resolve())
    script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)))
    document.head.append(script)
  })
}
