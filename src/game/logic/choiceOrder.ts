import type { Stop } from '../../content/types.ts'

/** Returns a number in `[0, 1)`. */
export type RandomSource = () => number

// Brief §3: the M1–M4 line question reads naturally only in its source order.
const sourceOrderStopIds: readonly string[] = ['B09']

export function keepsSourceOrder(stopId: string): boolean {
  return sourceOrderStopIds.includes(stopId)
}

export function shuffledChoiceIds(stop: Stop, random: RandomSource): string[] {
  const choiceIds = stop.choices.map((choice) => choice.id)
  if (keepsSourceOrder(stop.id)) return choiceIds
  for (let index = choiceIds.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[choiceIds[index], choiceIds[swapIndex]] = [choiceIds[swapIndex], choiceIds[index]]
  }
  return choiceIds
}

/** `permutationNumber` 0–23 selects the permutation of source indexes in lexicographic order. */
export function permutedChoiceIds(stop: Stop, permutationNumber: number): string[] {
  const remaining = stop.choices.map((choice) => choice.id)
  if (keepsSourceOrder(stop.id)) return remaining
  const ordered: string[] = []
  let rest = permutationNumber
  while (remaining.length > 0) {
    const blockSize = factorial(remaining.length - 1)
    ordered.push(...remaining.splice(Math.floor(rest / blockSize), 1))
    rest %= blockSize
  }
  return ordered
}

function factorial(count: number): number {
  let product = 1
  for (let factor = 2; factor <= count; factor++) product *= factor
  return product
}
