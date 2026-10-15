import { Plugin } from "@opencode/plugin"

import { decideEffort, parseOptions } from "./guard"

/**
 * Stop OpenCode sending a reasoning effort the provider rejects.
 *
 * For a model missing from the catalog OpenCode assumes the effort levels are
 * `low`/`medium`/`high` and can send one the provider does not accept, which
 * comes back as a 400. This plugin knows what each model really accepts and
 * rewrites an unsupported request to the nearest accepted value right before the
 * call is dispatched.
 */
export default Plugin.define({
  id: "reasoning-effort-guard",
  async setup(ctx) {
    const { rules, mode } = parseOptions(ctx.options)

    // Register one hook per provider, so unrelated traffic is not inspected.
    const providerIDs = [...new Set(rules.map((rule) => rule.providerID))]
    const registrations = await Promise.all(
      providerIDs.map((providerID) =>
        ctx.session.hook(
          "context",
          (event) => {
            const decision = decideEffort(rules, {
              providerID: event.model.providerID,
              modelID: event.model.id,
              variant: event.model.variant,
              override: event.options.reasoningEffort,
            })
            if (!decision) return

            // A request override wins over the model default the variant set.
            event.options.reasoningEffort = decision.supported

            if (mode === "warn") {
              console.warn(
                `[reasoning-effort-guard] ${event.model.providerID}/${event.model.id}: ` +
                  `"${decision.requested}" is not supported, using "${decision.supported}"`,
              )
            }
          },
          { providerID },
        ),
      ),
    )

    return () => {
      for (const registration of registrations) void registration.dispose()
    }
  },
})
