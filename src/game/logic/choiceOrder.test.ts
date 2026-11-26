import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Choice, Stop } from '../../content/types.ts'
import { keepsSourceOrder, permutedChoiceIds, shuffledChoiceIds, type RandomSource } from './choiceOrder.ts'

const text = { en: 'x', cs: 'x' }

function stop(id: string, choiceIds: [string, string, string, string]): Stop {
  const choices = choiceIds.map((choiceId): Choice => ({ id: choiceId, label: text }))
  return {
    id,
    place: text,
    difficulty: 'easy',
    sceneAsset: `scenes/${id}.webp`,
    sceneAlt: text,
    question: text,
    choices: [choices[0], choices[1], choices[2], choices[3]],
    correctChoiceId: choiceIds[0],
    feedback: text,
    sourceUrls: ['https://example.org/source'],
    photoReferenceUrls: ['https://example.org/photo'],
    verifiedOn: '2026-11-26',
    stability: 'stable',
  }
}

const parisStop = stop('PAR01', ['a', 'b', 'c', 'd'])
const metroStop = stop('B09', ['M1', 'M2', 'M3', 'M4'])

function constant(value: number): RandomSource {
  return () => value
}

function sequence(values: number[]): RandomSource {
  let index = 0
  return () => values[index++ % values.length]
}

function countingCalls(random: RandomSource): { random: RandomSource; calls: () => number } {
  let calls = 0
  return {
    random: () => {
      calls++
      return random()
    },
    calls: () => calls,
  }
}

test('a random source that always returns 0 gives the exact Fisher–Yates order', () => {
  assert.deepEqual(shuffledChoiceIds(parisStop, constant(0)), ['b', 'c', 'd', 'a'])
})

test('a random source that always returns 0.999 keeps the source order', () => {
  assert.deepEqual(shuffledChoiceIds(parisStop, constant(0.999)), ['a', 'b', 'c', 'd'])
})

test('a mixed random source gives the exact Fisher–Yates order', () => {
  // index 3 swaps with 1, index 2 with 2, index 1 with 0
  assert.deepEqual(shuffledChoiceIds(parisStop, sequence([0.25, 0.9, 0.1])), ['d', 'a', 'c', 'b'])
})

test('a shuffle uses three random draws and returns a permutation of the four choice IDs', () => {
  const counted = countingCalls(sequence([0.4, 0.7, 0.2]))
  const order = shuffledChoiceIds(parisStop, counted.random)
  assert.equal(counted.calls(), 3)
  assert.deepEqual([...order].sort(), ['a', 'b', 'c', 'd'])
})

test('the shuffle does not change the source order of the stop', () => {
  shuffledChoiceIds(parisStop, constant(0))
  assert.deepEqual(
    parisStop.choices.map((choice) => choice.id),
    ['a', 'b', 'c', 'd'],
  )
})

test('permutation 0 is the source order, 1 swaps the last two and 23 reverses it', () => {
  assert.deepEqual(permutedChoiceIds(parisStop, 0), ['a', 'b', 'c', 'd'])
  assert.deepEqual(permutedChoiceIds(parisStop, 1), ['a', 'b', 'd', 'c'])
  assert.deepEqual(permutedChoiceIds(parisStop, 23), ['d', 'c', 'b', 'a'])
})

test('all 24 permutation numbers give different permutations in lexicographic order', () => {
  const orders = Array.from({ length: 24 }, (_, permutationNumber) => permutedChoiceIds(parisStop, permutationNumber).join(''))
  assert.equal(new Set(orders).size, 24)
  assert.deepEqual(orders, [...orders].sort())
  for (const order of orders) assert.deepEqual(order.split('').sort(), ['a', 'b', 'c', 'd'])
})

test('B09 keeps the source order for any random source and draws no randomness', () => {
  const counted = countingCalls(constant(0))
  assert.deepEqual(shuffledChoiceIds(metroStop, counted.random), ['M1', 'M2', 'M3', 'M4'])
  assert.deepEqual(shuffledChoiceIds(metroStop, constant(0.999)), ['M1', 'M2', 'M3', 'M4'])
  assert.equal(counted.calls(), 0)
})

test('B09 keeps the source order for every permutation number', () => {
  for (let permutationNumber = 0; permutationNumber < 24; permutationNumber++) {
    assert.deepEqual(permutedChoiceIds(metroStop, permutationNumber), ['M1', 'M2', 'M3', 'M4'])
  }
})

test('only B09 keeps the source order', () => {
  assert.equal(keepsSourceOrder('B09'), true)
  assert.equal(keepsSourceOrder('B08'), false)
  assert.equal(keepsSourceOrder('PAR01'), false)
})
