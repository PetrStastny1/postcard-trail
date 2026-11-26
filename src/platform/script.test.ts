import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { loadScript } from './script.ts'

interface InjectedScript {
  src?: string
  async?: boolean
  readonly listeners: Map<string, () => void>
  addEventListener(type: string, listener: () => void): void
}

/** Stands in for the browser document; keeps each injected script so the test can fire its events. */
function fakeDocument(t: TestContext) {
  const created: string[] = []
  const appended: InjectedScript[] = []
  const document = {
    createElement(tag: string): InjectedScript {
      created.push(tag)
      const listeners = new Map<string, () => void>()
      return { listeners, addEventListener: (type, listener) => listeners.set(type, listener) }
    },
    head: { append: (script: InjectedScript) => appended.push(script) },
  }
  Object.defineProperty(globalThis, 'document', { value: document, configurable: true })
  t.after(() => Reflect.deleteProperty(globalThis, 'document'))
  return { created, appended }
}

test('loadScript appends an async script with the given address and resolves on load', async (t) => {
  const { created, appended } = fakeDocument(t)
  let resolved = false

  const loading = loadScript('https://example.test/sdk.js').then(() => {
    resolved = true
  })
  await Promise.resolve()

  assert.deepEqual(created, ['script'])
  assert.equal(appended.length, 1)
  assert.equal(appended[0]?.src, 'https://example.test/sdk.js')
  assert.equal(appended[0]?.async, true)
  assert.equal(resolved, false)

  appended[0]?.listeners.get('load')?.()
  await loading
  assert.equal(resolved, true)
})

test('loadScript rejects when the script fails to load', async (t) => {
  const { appended } = fakeDocument(t)

  const loading = loadScript('https://example.test/blocked.js')
  appended[0]?.listeners.get('error')?.()

  await assert.rejects(loading, /Failed to load https:\/\/example\.test\/blocked\.js/)
})
