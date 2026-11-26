// Contract shared by the content, logic and app areas. Only the director changes it.

export type Locale = 'en' | 'cs'

export type Localized = Record<Locale, string>

export type Difficulty = 'easy' | 'hard' | 'expert'

export type Stability = 'stable' | 'changeable'

export interface Choice {
  id: string
  label: Localized
}

export interface Stop {
  /** Stable ID from the city file heading, e.g. `PAR01`. Also identifies the scene. */
  id: string
  /** Result text, shown only after the answer. It names the correct choice for 30 stops. */
  place: Localized
  difficulty: Difficulty
  /**
   * Always `scenes/<id>.webp`, relative to the site base (`public/scenes/`).
   * Placeholder and final illustrations share this path, so a final scene replaces the file only.
   * Which scenes are still placeholders is listed in `public/scenes/placeholders.json`, not here.
   */
  sceneAsset: string
  sceneAlt: Localized
  question: Localized
  /** Source order from the city file. The displayed order is decided by the run. */
  choices: [Choice, Choice, Choice, Choice]
  correctChoiceId: string
  feedback: Localized
  sourceUrls: string[]
  photoReferenceUrls: string[]
  /** `YYYY-MM-DD` taken from the city file header. */
  verifiedOn: string
  stability: Stability
  /** What may change and must be rechecked before a release. Present only when `stability` is `changeable`. */
  changeableFact?: string
  /** Editorial note for expert stops: the visible feature that rules out the other choices. */
  distinguishingFeature?: string
}

export interface Route {
  /** Equal to the city file name, e.g. `paris`. */
  id: string
  name: Localized
  coordinates: { lat: number; lon: number }
  postcardQuestionId: string
  /** Exactly ten stops in route order. */
  stops: Stop[]
}

export interface Postcard {
  stopId: string
  sceneAsset: string
  sentence: Localized
}

/** Everything the title, map, collection and daily screens need without loading a route. */
export interface CatalogCity {
  id: string
  name: Localized
  coordinates: { lat: number; lon: number }
  postcard: Postcard
}

export interface CatalogVersion {
  /** `YYYY-MM-DD` in UTC from which this version is used for the daily challenge. */
  effectiveUtcDate: string
  /** All released routes in unlock order, including routes the player has not unlocked. */
  orderedCityIds: string[]
}

export interface Catalog {
  /** Released cities in unlock order. */
  cities: CatalogCity[]
  /** Ascending by `effectiveUtcDate`. */
  versions: CatalogVersion[]
}
