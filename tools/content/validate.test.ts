import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Route, Stop } from '../../src/content/types.ts'
import { routeProblems } from './validate.ts'

const text = { en: 'x', cs: 'x' }

function stop(id: string): Stop {
  return {
    id,
    place: text,
    difficulty: 'easy',
    sceneAsset: `scenes/${id}.webp`,
    sceneAlt: text,
    question: text,
    choices: [
      { id: 'a', label: text },
      { id: 'b', label: text },
      { id: 'c', label: text },
      { id: 'd', label: text },
    ],
    correctChoiceId: 'a',
    feedback: text,
    sourceUrls: ['https://example.org/source'],
    photoReferenceUrls: ['https://example.org/photo'],
    verifiedOn: '2026-11-26',
    stability: 'stable',
  }
}

function route(id: string, stopCount: number): Route {
  return {
    id,
    name: text,
    coordinates: { lat: 0, lon: 0 },
    postcardQuestionId: `${id}01`,
    stops: Array.from({ length: stopCount }, (_, index) => stop(`${id}${String(index + 1).padStart(2, '0')}`)),
  }
}

test('a route with ten valid stops passes', () => {
  assert.deepEqual(routeProblems([route('AAA', 10)]), [])
})

test('a route without ten stops is reported', () => {
  assert.deepEqual(routeProblems([route('AAA', 9)]), ['AAA: expected 10 stops, found 9'])
})

test('a stop ID used twice is reported', () => {
  const duplicated = route('AAA', 10)
  duplicated.stops[1] = stop('AAA01')
  assert.deepEqual(routeProblems([duplicated]), ['AAA01: duplicate stop ID'])
})

test('a correct choice outside the choices is reported', () => {
  const broken = route('AAA', 10)
  broken.stops[0] = { ...stop('AAA01'), correctChoiceId: 'z' }
  assert.deepEqual(routeProblems([broken]), ['AAA01: correct choice is not among the choices'])
})
