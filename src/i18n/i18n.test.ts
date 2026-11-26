import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

function messageKeys(file: string): string[] {
  const messages: unknown = JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'))
  assert.ok(typeof messages === 'object' && messages !== null && !Array.isArray(messages), `${file} is an object`)
  for (const [key, value] of Object.entries(messages)) assert.equal(typeof value, 'string', `${file} ${key} is a string`)
  return Object.keys(messages).sort()
}

test('en.json and cs.json have the same keys', () => {
  assert.deepEqual(messageKeys('./cs.json'), messageKeys('./en.json'))
})

test('every plural family has the forms one, few and other', () => {
  const keys = messageKeys('./en.json')
  const families = new Set(keys.filter((key) => /\.(one|few|other)$/.test(key)).map((key) => key.replace(/\.\w+$/, '')))
  for (const family of families) {
    for (const form of ['one', 'few', 'other']) assert.ok(keys.includes(`${family}.${form}`), `${family}.${form}`)
  }
})
