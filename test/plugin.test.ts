import { expect, test } from "vitest"

import plugin from "../src/index"

type Event = {
  model: { providerID: string; id: string; variant?: string }
  options: Record<string, unknown>
}

/** A stand-in for OpenCode's plugin context that captures registered hooks. */
function fakeContext(options: unknown) {
  const hooks: { providerID?: string; callback: (event: Event) => void }[] = []
  const ctx = {
    options,
    session: {
      hook: async (name: string, callback: (event: Event) => void, opts?: { providerID?: string }) => {
        expect(name).toBe("context")
        hooks.push({ providerID: opts?.providerID, callback })
        return { dispose: async () => {} }
      },
    },
  }
  return { ctx, hooks }
}

const setup = (plugin as unknown as { setup: (ctx: unknown) => Promise<unknown> }).setup

test("registers one hook per configured provider", async () => {
  const { ctx, hooks } = fakeContext({
    models: { "river/deepseek-v4.1-flash": ["none", "high", "max"], "acme/*": ["low", "high"] },
  })
  await setup(ctx)
  expect(hooks.map((hook) => hook.providerID)).toEqual(["river", "acme"])
})

test("rewrites a synthesized variant the provider rejects", async () => {
  const { ctx, hooks } = fakeContext({ models: { "river/deepseek-v4.1-flash": ["none", "high", "max"] } })
  await setup(ctx)

  const event: Event = {
    model: { providerID: "river", id: "deepseek-v4.1-flash", variant: "medium" },
    options: {},
  }
  hooks[0]!.callback(event)
  expect(event.options.reasoningEffort).toBe("high")
})

test("leaves an accepted variant untouched", async () => {
  const { ctx, hooks } = fakeContext({ models: { "river/deepseek-v4.1-flash": ["none", "high", "max"] } })
  await setup(ctx)

  const event: Event = {
    model: { providerID: "river", id: "deepseek-v4.1-flash", variant: "max" },
    options: {},
  }
  hooks[0]!.callback(event)
  expect(event.options.reasoningEffort).toBeUndefined()
})

test("ignores traffic for a model with no rule", async () => {
  const { ctx, hooks } = fakeContext({ models: { "river/deepseek-v4.1-flash": ["none", "high", "max"] } })
  await setup(ctx)

  const event: Event = { model: { providerID: "river", id: "something-else", variant: "medium" }, options: {} }
  hooks[0]!.callback(event)
  expect(event.options.reasoningEffort).toBeUndefined()
})
