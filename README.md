# opencode-reasoning-effort-guard

Stop OpenCode sending a reasoning effort the provider rejects.

## The problem

For a model that is not in the models.dev catalog, OpenCode has nothing to read, so it assumes the only reasoning levels are `low`, `medium`, and `high`. If the provider accepts a different set, OpenCode can send a value it will refuse, and you get back a generic error instead of an answer:

```
400 invalid_request_error
Invalid inference request. Check the model's supported parameters and input limits.
```

River is a good example. Its `deepseek-ai/DeepSeek-V4.1-Flash` accepts `none`, `high`, and `max` only, so `medium` fails. Declaring `variants` by hand fixes it for one model at a time; this plugin is the safety net underneath that, for every model you configure.

## Install

```sh
opencode plugin add github:mmestiyak/opencode-reasoning-effort-guard
```

Or once it is on npm:

```sh
opencode plugin add opencode-reasoning-effort-guard
```

## Configure

Give each model the effort values it accepts, in `opencode.json(c)`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-reasoning-effort-guard",
      "options": {
        "models": {
          "river/deepseek-v4.1-flash": ["none", "high", "max"],
          "river/glm-5.3-flash": ["low", "high", "max"],
          "river/*": ["none", "high"]
        }
      }
    }
  ]
}
```

## What it does

Right before a model call, the guard looks at the reasoning effort in play and, if the model does not accept it, replaces it with the nearest value it does accept.

| Requested | Model accepts | Sent |
| --- | --- | --- |
| `high` | `none`, `high`, `max` | `high` (unchanged) |
| `medium` | `none`, `high`, `max` | `high` |
| `low` | `none`, `high`, `max` | `high` |
| `minimal` | `none`, `max` | `none` |
| `off` | `none`, `high` | `none` |

Rules:

- Ties go to the higher level, so a graded request does not drop to an off value (`none`, `off`, `disabled`) when both are equally close.
- An unrecognised level resolves to the lowest graded value, never to off. Unrecognised accepted values are used only when nothing recognisable is available.

The guard only changes the value on the wire. It does not edit your configuration or hide the unsupported level in the UI.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `models` | `{ [key: string]: string[] }` | `{}` | Accepted effort values per `"provider/model"`, or per `"provider/*"`. |
| `onUnsupported` | `"clamp"` \| `"warn"` | `"clamp"` | `"warn"` also logs a line naming the requested and replacement values. |

An exact `"provider/model"` entry wins over `"provider/*"`. Malformed entries are ignored rather than throwing, so a typo cannot stop OpenCode from starting.

## How it works

It registers a `context` session hook, scoped to each configured provider, that runs immediately before a request is dispatched.

The requested level is read from `event.options.reasoningEffort` if a request override set it, otherwise from `event.model.variant`. The variant matters: when OpenCode synthesizes `low`/`medium`/`high` for an uncatalogued model, the chosen level arrives as `event.model.variant` and its setting is applied as a model default, so it never appears in `event.options`. The guard writes the corrected value to `event.options.reasoningEffort`, and a request override takes precedence over a model default, so the corrected value is what the provider receives.

All the decision logic lives in `src/guard.ts` with no OpenCode imports, so it can be read and tested on its own.

## Local development

A plugin discovered from a `.opencode/plugins/` directory is loaded without options, so the guard has no rules and does nothing. To exercise it while working on it, supply the options yourself:

```ts
// .opencode/plugins/guard-local.ts
import guard from "/absolute/path/to/opencode-reasoning-effort-guard/src/index.ts"

export default {
  id: "reasoning-effort-guard-local",
  async setup(ctx: any) {
    return guard.setup({
      ...ctx,
      options: {
        models: { "river/deepseek-v4.1-flash": ["none", "high", "max"] },
        onUnsupported: "warn",
      },
    })
  },
}
```

## Development

```sh
npm install
npm test
npm run typecheck
```

## License

MIT
