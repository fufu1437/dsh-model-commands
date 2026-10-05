# Model Commands (@fufu1437/dsh-model-commands)

A DeepSeek Harness (DSH) plugin that makes **a command you register once
something the model can look up**.

You write a **description** (说明) and a **detail** (描述) for a command in
**Settings → Model commands**, and the Host half registers one model-facing tool
for it. The model normally sees only the one-line description in its tool list —
cheap, always present. When it needs the command, it calls the tool and receives
the command's **usage, arguments, and real purpose**, then runs it with the
`bash` it already has.

> 中文文档：[README.zh.md](README.zh.md)

## What the model sees

Registering this command:

```json
{
  "name": "kubectl_logs",
  "description": "Call this when you need the logs of a Kubernetes pod.",
  "detail": "kubectl logs <pod> [-f] [--since=1h]\n\n- <pod>: pod name, required; look it up with kubectl get pods\n- -f: stream the log until Ctrl-C\n- --since: only the recent window, e.g. 1h or 30m\nNote: the current namespace is used unless you pass -n.",
  "args": []
}
```

is one line in the model's tool list:

```text
kubectl_logs — Call this when you need the logs of a Kubernetes pod.
```

and a call to it answers with:

```text
kubectl logs <pod> [-f] [--since=1h]

- <pod>: pod name, required; look it up with kubectl get pods
- -f: stream the log until Ctrl-C
- --since: only the recent window, e.g. 1h or 30m
Note: the current namespace is used unless you pass -n.
```

The model then runs the command with `bash`. **This plugin executes nothing** —
it puts the command's usage and purpose in the model's hands.

## Command fields

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Tool name the model calls: a letter, then letters, digits, `_`, `-` (max 48). It must not collide with another tool. |
| `description` (说明) | yes | The one line in the tool list, and the only thing the model reads when choosing between tools. Say *when* to use it. Max 4096 characters. |
| `detail` (描述) | with args | The body the model receives when it calls the tool: the command's usage, how its arguments are spelled, and what it is for. `{{argument}}` placeholders are allowed. Max 32768 characters. With no detail the tool answers with the description. |
| `args` (参数) | with detail | Argument declarations — see below. |
| `title` | no | Human label shown in the settings list. |
| `enabled` | no | `false` keeps the command stored but hidden from the model. |

**A detail or at least one argument is required.** An entry that only repeats its
own one-line description has nothing to answer with, so the Host rejects it.
Having both is fine and expected — the detail refers to the arguments with
`{{name}}`.

An argument has:

| Field | Meaning |
|---|---|
| `name` | Matches `{{name}}` in the detail; a declared argument must be used there. |
| `type` | `string` (default), `number`, or `boolean`. `number` covers integral values, so there is no separate `integer`. |
| `description` | Goes into the tool's parameter schema, per argument. |
| `required` (必须) | `true` makes the model supply it; otherwise a missing value falls back to `default`. |
| `default` | Value used when the model omits the argument. |
| `choices` | For a `string`: the accepted values, exposed as a JSON-Schema `enum` and enforced before substitution. |
| `trueText` / `falseText` | For a `boolean`: the literal text substituted instead of the value. |

## How `{{argument}}` is substituted

The detail is **plain text**, not a command line, so there is nothing to escape;
substitution is single-pass and type-directed:

- `string` is inserted verbatim;
- `number` must parse as a finite number first;
- `boolean` substitutes only the author-declared `trueText`/`falseText`;
- a `string` with `choices` is validated against its list first;
- substitution happens in one pass, so a value containing `{{other}}` stays
  text.

**The detail accepts any characters.** Only a `{{name}}` that matches a declared
argument is substituted at call time; every other `{{...}}` — placeholder-looking
or not — is returned exactly as written. An unmatched `{{path}}`, or an argument
the detail never mentions, appears as an advisory **warning** at the top of the
settings page (a dismissible banner) and never blocks a save.

### Worked example

| Field | Value |
|---|---|
| Tool name | `kubectl_logs` |
| Description | Call this when you need the logs of a Kubernetes pod. |
| Detail | `kubectl logs {{pod}} -n {{namespace}}{{follow}} --since={{since}}` |
| Arguments | `pod` string, must; `namespace` string, default `default`; `follow` boolean, `trueText` `" -f"`, `falseText` `""`; `since` string, choices `30m / 1h / 6h`, default `1h` |

What the model passes → what the call returns:

| Arguments | Result |
|---|---|
| `{pod:"web-0", namespace:"prod", follow:true, since:"6h"}` | `kubectl logs web-0 -n prod -f --since=6h` |
| `{pod:"web-0"}` (the rest default) | `kubectl logs web-0 -n default --since=1h` |
| `{pod:"{{namespace}}", namespace:"prod"}` | `kubectl logs {{namespace}} -n prod --since=1h` (a value is never re-expanded) |
| `{}` (a must-argument is missing) | the call fails: `argument "pod" is required` |
| `{pod:"x", since:"2h"}` (outside choices) | the call fails: `argument "since" must be one of "30m", "1h", "6h"` |

Other behaviour: `number` is normalized (`"007"` → `7`, `"1e3"` → `1000`, `"abc"`
fails); `boolean` substitutes only your `trueText`/`falseText`; an undeclared
`{{path}}` stays literal.

**A `--help` dump can be pasted straight into the detail** (up to 32768
characters, so a ten-thousand-character help output fits; single braces
`{md5,sha1}`, quotes, backslashes and newlines are preserved). The cost is paid
once, when the model actually calls the command — not on every request.

## The settings page

**Settings → Model commands** lists the stored commands: each row shows the tool
name, the description, the detail's first line, and the argument count. `Edit`
opens the same fields, `Delete` removes the command (and its tool). Saving sends
the whole table to the Host, which validates it, persists it, and re-registers
the tools in the same step, so the model sees the new command on its next call.

The table is stored at `<DSH_HOME>/model-commands/commands.json`; the page shows
the exact path. Writes are atomic (write + rename), and one invalid row is
reported without discarding the valid ones.

> Before 0.2.0 this field was `command`, a shell line that the plugin executed.
> On upgrade an existing `command` value is adopted as `detail`, so no text is
> lost.

## Configuration

Everything works with no `config` at all. To move the table:

```yaml
- id: fufu-model-commands
  name: '@fufu1437/dsh-model-commands'
  config:
    storePath: /home/me/.dsh/model-commands/commands.json
```

| Field | Default | Meaning |
|---|---|---|
| `storePath` | `<DSH_HOME>/model-commands/commands.json` | Where the command table lives. |

Config is read when the plugin activates, so a change to this row needs the row
to be reloaded (see below).

## Install

```bash
npm install @fufu1437/dsh-model-commands
dsh plugin install @fufu1437/dsh-model-commands
```

Or, from inside the Harness, call `install_bundle` with the package directory,
a `.tgz`, or the npm package name. After the first install, **refresh the Web
page** so the browser half loads.

### Iterating on the plugin

`npm run check && npm test` exercises the pure logic without a Harness. What the
*running* Harness picks up differs per half:

- **`client.js`** is read from disk by the client-module registry, so reloading
  the plugin row (flip the entry's `disabled` in `<profile>/cordis.patch.yml`,
  `true` then `false`) and refreshing the page is enough.
- **`index.js` is not live-reloaded.** This profile's `hmr` row is configured
  with `root: []`, and the Loader caches the imported module, so re-creating the
  row re-runs `apply` from the **already-loaded** code — the route comes back,
  but it is the old build. A Host-half change needs a Harness restart.
  To avoid that, turn on module watching for this directory in the profile
  patch and a saved `index.js` then reloads itself:
  `- id: hmr` / `config: { base: /path/to/dsh-plugin, root: ["."] }`.
- Either way the command table survives, because it lives in its own JSON file.
- To check which Host generation is loaded, save an entry only the new code
  accepts and query `Tool.listTools`: if the tool is missing, the old module is
  still running.

> On this machine the profile at `~/.dsh/profiles/web/cordis.patch.yml` already
> enables that `hmr` row (`base` = this plugin directory, `root: ["."]`), so a
> saved `index.js` reloads the plugin without a Harness restart.

## Behaviour and limits

- **The plugin runs nothing**: no shell, no sandbox policy, no quoting, no exit
  codes. Execution belongs to the tools the deployment already gives the model.
- The one-line description is the standing cost of a command; the detail is paid
  only when the model asks for it.
- The package imports only `node:` builtins — no `@deepseek-ai/*` dependency —
  so it publishes as an ordinary npm package and does not break when harness
  internals move.
- Both routes pass the composition's `connection.requestRejection` trust fence
  first; unauthenticated requests get 401/403.
- Disabling a command (`enabled: false`) affects model visibility only; the table
  keeps the entry.

## Not yet (next iterations)

- Per-argument `choices` and `trueText`/`falseText` editors in the settings page
  (the Host already accepts them).
- A preview button in the editor, so a human can see what the model will get.
- Reordering, importing/exporting, and per-agent visibility.
