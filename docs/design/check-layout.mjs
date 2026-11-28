import { chromium } from '@playwright/test'
const [base, out] = process.argv.slice(2)
const sizes = { '375x812': [375, 812], '320x568': [320, 568], '568x320': [568, 320], '844x390': [844, 390], '640x360': [640, 360], '1440x900': [1440, 900] }
const runs = []
for (const state of ['question', 'result', 'loading', 'error', 'fifty', 'untimed']) for (const size of Object.keys(sizes)) runs.push({ state, size, lang: 'en' })
for (const state of ['result-correct', 'result-timeout']) for (const size of ['375x812', '568x320', '1440x900']) runs.push({ state, size, lang: 'en' })
for (const state of ['question', 'result']) for (const size of ['320x568', '568x320', '640x360']) runs.push({ state, size, lang: 'cs' })
runs.push({ state: 'question', size: '375x812', lang: 'en', focus: 'choice' })
runs.push({ state: 'result', size: '375x812', lang: 'en', focus: 'next' })
runs.push({ state: 'question', size: '375x812', lang: 'en', scheme: 'dark' })
// The portrait result holds the zoom in its band: both languages, light and dark, on the smallest and a large phone.
for (const lang of ['en', 'cs']) for (const size of ['320x568', '375x812']) for (const scheme of ['light', 'dark']) {
  const run = { state: 'result', size, lang, ...(scheme === 'dark' ? { scheme } : {}) }
  if (!runs.some((each) => each.state === run.state && each.size === size && each.lang === lang && !each.focus && each.scheme === run.scheme)) runs.push(run)
}

const inspect = () => {
  const shown = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0 && !el.closest('[aria-hidden="true"]') }
  const covered = (el) => {
    const r = el.getBoundingClientRect()
    const fx = (f) => r.left + r.width * f, fy = (f) => r.top + r.height * f
    const points = [[fx(0.2), fy(0.25)], [fx(0.8), fy(0.25)], [fx(0.2), fy(0.75)], [fx(0.8), fy(0.75)], [fx(0.5), fy(0.5)], [fx(0.5), r.top + 1.5], [fx(0.5), r.bottom - 1.5]]
    return points.some(([x, y]) => { if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return true; const hit = document.elementFromPoint(x, y); return !(hit && (el.contains(hit) || hit.closest('.choice-mark')?.parentElement === el)) })
  }
  const targets = [...document.querySelectorAll('.choice, .lifeline, .timer, .next, .scene-error button, .icon-button, .zoom-button, .question, .result-verdict, .result-sentence')].filter(shown)
  // Each element must be fully visible at once, or after scrolling it into view (the panel scrolls).
  const scrollers = [...document.querySelectorAll('.play-main, .panel')]
  const reachable = (el) => {
    if (!covered(el)) return true
    for (const block of ['nearest', 'center', 'start', 'end']) { el.scrollIntoView({ block }); if (!covered(el)) return true }
    for (const position of [0, 1e6]) { scrollers.forEach((s) => s.scrollTo(0, position)); if (!covered(el)) return true }
    return false
  }
  const hidden = targets.filter((el) => !reachable(el)).map((el) => el.className.baseVal ?? el.className)
  // Controls that must be visible without scrolling.
  document.querySelectorAll('.play-main, .panel').forEach((el) => el.scrollTo(0, 0))
  if (document.querySelector('.play').dataset.state === 'result') {
    if (matchMedia('(orientation: landscape)').matches) document.querySelector('.choices').scrollIntoView({ block: 'start' })
    else document.querySelector('.action-row').scrollIntoView({ block: 'end' })
  }
  window.markMore()
  const mustSee = [...document.querySelectorAll('.timer, .lifeline, .next, .result-verdict, .zoom-button')].filter(shown)
  const notInView = mustSee.filter(covered).map((el) => el.className)
  const brokenWords = []
  for (const label of document.querySelectorAll('.choice-label')) {
    if (!shown(label)) continue
    const node = label.firstChild; if (!node) continue
    const text = node.textContent; let start = 0
    for (const word of text.split(/(?=[\s-])|(?<=[\s-])/)) {
      const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + word.length); start += word.length
      if (word.trim() && new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1) brokenWords.push(word)
    }
    if (label.scrollWidth > label.clientWidth + 1) brokenWords.push('overflow:' + text)
  }
  // A choice hidden in the question state needs a visible sign that content continues.
  const state = document.querySelector('.play').dataset.state
  const choicesOut = [...document.querySelectorAll('.choice')].filter(shown).filter(covered).length
  const unsignalled = state !== 'result' && choicesOut > 0 && !document.querySelector('.action-row').classList.contains('has-more')
  // The scene can be enlarged in the question and the result, from exactly one button.
  const zooms = [...document.querySelectorAll('.zoom-button')].filter(shown).length
  const zoomsExpected = state === 'loading' || state === 'error' ? 0 : 1
  const small = [...document.querySelectorAll('button')].filter(shown).filter((b) => { const r = b.getBoundingClientRect(); return r.width < 44 || r.height < 44 }).map((b) => b.className)
  return { unsignalled, choicesOut, scene: Math.round(document.querySelector('.scene-frame').getBoundingClientRect().width), hidden, notInView, brokenWords, small, zooms, zoomsExpected, stacked: document.querySelector('.choices').classList.contains('is-stacked'), scrollX: document.documentElement.scrollWidth > innerWidth }
}

const browser = await chromium.launch()
const sceneBySize = {}
for (const run of runs) {
  const [width, height] = sizes[run.size]
  const page = await browser.newPage({ viewport: { width, height }, colorScheme: run.scheme ?? 'light' })
  const query = new URLSearchParams({ state: run.state, lang: run.lang, ...(run.focus ? { focus: run.focus } : {}) })
  await page.goto(`${base}/docs/design/prototype/question.html?${query}`)
  const name = `${run.state}.${run.lang}.${run.size}${run.focus ? '.focus-' + run.focus : ''}${run.scheme ? '.dark' : ''}`
  await page.screenshot({ path: `${out}/${name}.png` })
  const c = await page.evaluate(inspect)
  const key = run.lang + run.size
  if (!['error'].includes(run.state)) (sceneBySize[key] ??= new Set()).add(c.scene)
  const problems = [c.hidden.length && 'hidden=' + c.hidden, c.notInView.length && 'notInView=' + c.notInView, c.brokenWords.length && 'broken=' + c.brokenWords, c.small.length && 'small=' + c.small, c.scrollX && 'scrollX', c.unsignalled && 'hiddenChoicesWithoutSignal', c.zooms !== c.zoomsExpected && `zooms=${c.zooms}`].filter(Boolean)
  process.stdout.write(`${name} scene=${c.scene} stacked=${c.stacked} choicesBelow=${c.choicesOut} ${problems.length ? 'PROBLEMS ' + problems.join(' ') : 'ok'}\n`)
  await page.close()
}
for (const [key, set] of Object.entries(sceneBySize)) process.stdout.write(`scene size ${key}: ${[...set].join(', ')} ${set.size === 1 ? 'same in all states' : 'DIFFERS'}\n`)
await browser.close()
