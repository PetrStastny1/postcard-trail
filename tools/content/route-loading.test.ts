import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '../..')

test('loadRoute imports every route lazily through a non-eager glob', () => {
  const source = readFileSync(path.join(repoRoot, 'src/content/index.ts'), 'utf8')
  assert.match(source, /export function loadRoute\(cityId: string\): Promise<Route>/)
  assert.match(source, /import\.meta\.glob<Route>\('\.\/routes\/\*\.json'/)
  assert.doesNotMatch(source, /eager/)
  assert.doesNotMatch(source, /from '\.\/routes\//, 'no static route import')
  assert.match(source, /Promise\.reject\(new Error\(`Unknown route "\$\{cityId\}"`\)\)/)
})

test('the first catalog date appears only in src/content/catalog.json and tests', () => {
  const firstDate = JSON.parse(readFileSync(path.join(repoRoot, 'src/content/catalog.json'), 'utf8')).versions[0]
    .effectiveUtcDate as string
  const matches = ['src', 'tools']
    .flatMap((dir) => readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: 'utf8' }).map((file) => path.join(dir, file)))
    .filter((file) => statSync(path.join(repoRoot, file)).isFile() && !file.endsWith('.test.ts'))
    .filter((file) => readFileSync(path.join(repoRoot, file), 'utf8').includes(firstDate))
  assert.deepEqual(matches, ['src/content/catalog.json'])
})
