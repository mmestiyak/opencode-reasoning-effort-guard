/**
 * All of the guard's logic, kept free of OpenCode imports so it can be read and
 * tested on its own.
 */

/** Effort levels in ascending order, used to pick the nearest accepted value. */
export const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const

export type Effort = (typeof EFFORT_ORDER)[number]

/** Values that mean off. They rank alongside `none`. */
const OFF = new Set(["none", "off", "disabled"])

const MODES = new Set(["clamp", "warn"])

export type UnsupportedMode = "clamp" | "warn"

export interface GuardOptions {
  /** `"provider/model"` or `"provider/*"` to the effort values that model accepts. */
  models?: Record<string, readonly string[]>
  /** `"clamp"` (silent, default) or `"warn"` (clamp and log). */
  onUnsupported?: UnsupportedMode
}

export interface Rule {
  providerID: string
  modelID: string
  allowed: readonly string[]
}

/**
 * Validate raw plugin options. Anything malformed is dropped rather than
 * throwing, so a typo in one entry cannot stop OpenCode from starting.
 */
export function parseOptions(options: unknown): { rules: Rule[]; mode: UnsupportedMode } {
  const opts = (options ?? {}) as GuardOptions
  const mode: UnsupportedMode = MODES.has(opts.onUnsupported as string)
    ? (opts.onUnsupported as UnsupportedMode)
    : "clamp"

  const rules: Rule[] = []
  if (opts.models && typeof opts.models === "object") {
    for (const [key, allowed] of Object.entries(opts.models)) {
      if (!Array.isArray(allowed) || allowed.length === 0) continue
      if (!allowed.every((value) => typeof value === "string" && value.trim() !== "")) continue
      const slash = key.indexOf("/")
      if (slash <= 0 || slash === key.length - 1) continue
      rules.push({ providerID: key.slice(0, slash), modelID: key.slice(slash + 1), allowed })
    }
  }
  return { rules, mode }
}

/** The rule for a model. An exact `provider/model` entry beats `provider/*`. */
export function ruleFor(rules: readonly Rule[], providerID: string, modelID: string): Rule | undefined {
  return (
    rules.find((rule) => rule.providerID === providerID && rule.modelID === modelID) ??
    rules.find((rule) => rule.providerID === providerID && rule.modelID === "*")
  )
}

/**
 * Pick the accepted effort closest to `requested`, by position in EFFORT_ORDER.
 *
 * - Ties go to the higher level, so a graded request does not drop to an off
 *   value when both are equally close.
 * - An unrecognised request resolves to the lowest graded value, never to off.
 * - Values outside EFFORT_ORDER are used only when nothing recognisable is left.
 */
export function clampEffort(requested: string, allowed: readonly string[]): string {
  if (allowed.length === 0) return requested
  if (allowed.includes(requested)) return requested

  const target = rank(requested)
  let best = allowed[0]!
  let bestScore = distance(best, target)
  let bestRank = rank(best)

  for (const value of allowed) {
    const score = distance(value, target)
    const valueRank = rank(value)
    if (score < bestScore || (score === bestScore && valueRank > bestRank)) {
      best = value
      bestScore = score
      bestRank = valueRank
    }
  }
  return best
}

/** The effort in play for a request. */
export interface EffortRequest {
  providerID: string
  modelID: string
  /** The selected variant id, when a variant is in play. */
  variant?: string
  /** An explicit request override (`event.options.reasoningEffort`), when set. */
  override?: unknown
}

export interface Decision {
  requested: string
  supported: string
}

/**
 * The effort to send, when the requested one is not accepted. Returns undefined
 * when there is no rule for the model, or nothing needs changing.
 */
export function decideEffort(rules: readonly Rule[], request: EffortRequest): Decision | undefined {
  const rule = ruleFor(rules, request.providerID, request.modelID)
  if (!rule) return undefined

  const requested = readEffort(request)
  if (requested === undefined || rule.allowed.includes(requested)) return undefined

  return { requested, supported: clampEffort(requested, rule.allowed) }
}

/** An explicit override wins; otherwise the variant id is the requested level. */
function readEffort(request: EffortRequest): string | undefined {
  if (typeof request.override === "string" && request.override.trim() !== "") return request.override
  if (typeof request.variant === "string" && request.variant.trim() !== "") return request.variant
  return undefined
}

function rank(value: string): number {
  const normalised = value.trim().toLowerCase()
  if (OFF.has(normalised)) return 0
  return EFFORT_ORDER.indexOf(normalised as Effort)
}

function distance(value: string, target: number): number {
  const index = rank(value)
  if (index === -1) return Number.POSITIVE_INFINITY
  if (target === -1) return index === 0 ? Number.POSITIVE_INFINITY : index
  return Math.abs(index - target)
}
