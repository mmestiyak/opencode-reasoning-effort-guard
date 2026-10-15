import { describe, expect, test } from "vitest"

import { clampEffort, decideEffort, parseOptions, ruleFor } from "../src/guard"

describe("clampEffort", () => {
  test("keeps a value the model accepts", () => {
    expect(clampEffort("high", ["none", "high", "max"])).toBe("high")
  })

  test("clamps the common low/medium/high case onto River's DeepSeek set", () => {
    expect(clampEffort("low", ["none", "high", "max"])).toBe("high")
    expect(clampEffort("medium", ["none", "high", "max"])).toBe("high")
  })

  test("does not switch reasoning off to satisfy a graded request", () => {
    // "low" is equidistant from "none" and "high"; it must not pick "none".
    expect(clampEffort("low", ["none", "high"])).toBe("high")
  })

  test("still uses none when it is the closest accepted value", () => {
    expect(clampEffort("minimal", ["none", "max"])).toBe("none")
  })

  test("can turn reasoning off when that is what was asked for", () => {
    expect(clampEffort("none", ["max"])).toBe("max")
    expect(clampEffort("off", ["none", "high"])).toBe("none")
  })

  test("breaks ties toward the higher level", () => {
    expect(clampEffort("medium", ["low", "high"])).toBe("high")
  })

  test("falls back to a graded value for an unknown request", () => {
    expect(clampEffort("extreme", ["none", "high", "max"])).toBe("high")
  })

  test("keeps unrecognised accepted values when nothing is recognisable", () => {
    expect(clampEffort("medium", ["custom"])).toBe("custom")
  })

  test("leaves the request alone when nothing is configured", () => {
    expect(clampEffort("medium", [])).toBe("medium")
  })
})

describe("parseOptions", () => {
  test("reads models and mode", () => {
    const { rules, mode } = parseOptions({
      models: { "river/deepseek-v4.1-flash": ["none", "high", "max"] },
      onUnsupported: "warn",
    })
    expect(mode).toBe("warn")
    expect(rules).toEqual([
      { providerID: "river", modelID: "deepseek-v4.1-flash", allowed: ["none", "high", "max"] },
    ])
  })

  test("keeps a provider wildcard", () => {
    const { rules } = parseOptions({ models: { "river/*": ["none", "high"] } })
    expect(rules[0]).toEqual({ providerID: "river", modelID: "*", allowed: ["none", "high"] })
  })

  test("drops malformed entries instead of throwing", () => {
    const { rules } = parseOptions({
      models: {
        "no-slash": ["high"],
        "river/": ["high"],
        "/model": ["high"],
        "river/empty": [],
        "river/not-array": "high",
        "river/mixed": ["high", 3],
      },
    })
    expect(rules).toEqual([])
  })

  test("defaults to clamp and tolerates missing options", () => {
    expect(parseOptions(undefined).mode).toBe("clamp")
    expect(parseOptions({ onUnsupported: "explode" }).mode).toBe("clamp")
    expect(parseOptions({}).rules).toEqual([])
  })
})

describe("ruleFor", () => {
  const rules = parseOptions({
    models: { "river/*": ["none", "high"], "river/special": ["low"] },
  }).rules

  test("prefers an exact model over the wildcard", () => {
    expect(ruleFor(rules, "river", "special")?.allowed).toEqual(["low"])
    expect(ruleFor(rules, "river", "other")?.allowed).toEqual(["none", "high"])
  })

  test("returns nothing for an unconfigured provider", () => {
    expect(ruleFor(rules, "anthropic", "claude")).toBeUndefined()
  })
})

describe("decideEffort", () => {
  const rules = parseOptions({
    models: {
      "river/deepseek-v4.1-flash": ["none", "high", "max"],
      "river/*": ["low", "high"],
    },
  }).rules

  test("rewrites a synthesized variant the provider rejects", () => {
    expect(
      decideEffort(rules, { providerID: "river", modelID: "deepseek-v4.1-flash", variant: "medium" }),
    ).toEqual({ requested: "medium", supported: "high" })
  })

  test("leaves an accepted variant alone", () => {
    expect(
      decideEffort(rules, { providerID: "river", modelID: "deepseek-v4.1-flash", variant: "max" }),
    ).toBeUndefined()
  })

  test("prefers an explicit override over the variant", () => {
    expect(
      decideEffort(rules, {
        providerID: "river",
        modelID: "deepseek-v4.1-flash",
        variant: "high",
        override: "medium",
      }),
    ).toEqual({ requested: "medium", supported: "high" })
  })

  test("ignores a blank override and falls back to the variant", () => {
    expect(
      decideEffort(rules, { providerID: "river", modelID: "deepseek-v4.1-flash", variant: "medium", override: "  " }),
    ).toEqual({ requested: "medium", supported: "high" })
  })

  test("does nothing without a variant or an override", () => {
    expect(decideEffort(rules, { providerID: "river", modelID: "deepseek-v4.1-flash" })).toBeUndefined()
  })

  test("uses the provider wildcard for other models", () => {
    expect(decideEffort(rules, { providerID: "river", modelID: "glm-5.3-flash", variant: "medium" })).toEqual({
      requested: "medium",
      supported: "high",
    })
  })

  test("does nothing for a provider with no rule", () => {
    expect(decideEffort(rules, { providerID: "anthropic", modelID: "claude", variant: "medium" })).toBeUndefined()
  })
})
