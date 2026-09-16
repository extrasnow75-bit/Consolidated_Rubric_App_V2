/**
 * The rubric types the main process needs.
 *
 * Deliberately a copy of the matching declarations in src/types.ts rather than an import of them.
 * The main and renderer processes compile under separate tsconfigs with different libs, and
 * src/types.ts pulls in DOM-flavoured declarations that do not belong in a Node build. These are
 * plain data shapes that cross IPC, so a small duplication is cheaper than making one file serve
 * two compilation targets.
 *
 * Keep the two in step. They describe the same JSON.
 */

export enum PointStyle {
  RANGE = 'RANGE',
  SINGLE = 'SINGLE',
}

export enum ProcessingType {
  SINGLE = 'SINGLE',
  MULTIPLE = 'MULTIPLE',
}

export interface GenerationSettings {
  totalPoints: number
  pointStyle: PointStyle
  processingType: ProcessingType
}

export interface RubricRating {
  text: string
  points: string
}

export interface RubricCriterion {
  category: string
  description: string
  exemplary: RubricRating
  proficient: RubricRating
  developing: RubricRating
  unsatisfactory: RubricRating
  totalPoints: number
}

export interface RubricData {
  title: string
  criteria: RubricCriterion[]
  totalPoints: number
}

export interface RubricMeta {
  name: string
  totalPoints: string
  scoringMethod: 'ranges' | 'fixed'
}

/** A file on its way to Gemini. `data` is base64, which crosses IPC unchanged. */
export interface Attachment {
  name: string
  mimeType: string
  data: string
}
