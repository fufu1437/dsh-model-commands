# Model Commands (@fufu1437/dsh-model-commands)

A DeepSeek Harness (DSH) plugin that turns **commands you declare once** into
**tools the model can call directly**.

You add a command in **Settings → Model commands** (name, description,
arguments, command line). The Host half registers one model-facing tool per
command, so the model invokes it the same way it invokes `bash`, `read`, or
`edit` — no shell round trip, and every argument is typed and described in the
tool schema the model sees.

> 中文文档：[README.zh.md](README.zh.md)

## How it looks to the model

Declaring this command:

```json
{
  "name": "disk_usage",
  "description": "Report free space for one path with df.",
  "command": "df -h {{path}}",
  "args": [
    { "name": "path", "type": "string", "default": "/", "description": "Filesystem or directory to report." }
  ]
}
```

publishes a tool named `disk_usage` with one optional string argument `path`.
Calling it runs `df -h '/'`, and the result the model reads is:

```text
$ df -h '/'
exit code: 0

--- stdout ---
Filesystem      Size  Used Avail Use% Mounted on
/dev/nvme0n1p2  931G  412G  472G  47% /

--- stderr ---
(empty)
```

## Declaring a command

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Tool name the model calls: a letter, then letters, digits, `_`, `-` (max 48). It must not collide with another tool. |
| `description` | yes | The only thing the model reads when choosing between tools. Say *when* to use it. |
| `command` | yes | The shell line to run, with `{{argument}}` placeholders. |
| `args` | no | Argument declarations — see below. |
| `title` | no | Human label shown in the settings list. |
| `cwd` | no | Working directory. Relative paths resolve against the calling session's workspace; absolute paths are still policed by the sandbox. |
| `timeoutMs` | no | Per-command deadline (default 60 s, capped at 1 h). |
| `enabled` | no | `false` keeps the command stored but hidden from the model. |

An argument has:

| Field | Meaning |
|---|---|
| `name` | Matches `{{name}}` in the command line. Must be declared and used exactly once as a placeholder. |
| `type` | `string` (default), `number`, `integer`, or `boolean`. |
| `description` | Goes into the tool's parameter schema, per argument. |
| `required` | `true` makes the model supply it; otherwise a missing value falls back to `default`. |
| `default` | Value used when the model omits the argument. |
| `choices` | For a `string`: the accepted values, exposed as a JSON-Schema `enum` and enforced before running. |
| `trueText` / `falseText` | For a `boolean`: the literal text substituted instead of the value (e.g. `--verbose` vs nothing). |

### How arguments are substituted

Substitution is single-pass and type-directed, which is what keeps a
model-supplied value from becoming shell syntax:

- `string` → wrapped in single quotes (`'` becomes `'\''`), so the value is
  always exactly one word; a value containing `{{other}}` is data, never a
  second expansion;
- `number` / `integer` → must parse as a number, substituted unquoted;
- `boolean` → substitutes only the author-declared `trueText`/`falseText`;
- a `choices` string is validated against its list first.

A command whose placeholders and arguments do not match is rejected by the
Host, and the settings page shows the Host's own diagnostics.

## The settings page

**Settings → Model commands** lists the stored commands. Each row shows the
tool name, its description, and the shell line; `Edit` opens the same fields,
`Delete` removes the command (and its tool). Saving sends the whole table to
the Host, which validates it, persists it, and re-registers the tools in the
same step, so the model sees the new command on its next call.

The table is stored at `<DSH_HOME>/model-commands/commands.json`; the page
shows the exact path. Writes are atomic (write + rename), and one invalid row
is reported without discarding the valid ones.

## Configuration

Everything works with no `config` at all. To override the defaults, edit the
plugin's row in the profile patch:

```yaml
- id: fufu-model-commands
  name: '@fufu1437/dsh-model-commands'
  config:
    storePath: /home/me/.dsh/model-commands/commands.json
    defaultCwd: /home/me/work
    timeoutMs: 120000
```

| Field | Default | Meaning |
|---|---|---|
| `storePath` | `<DSH_HOME>/model-commands/commands.json` | Where the command table lives. |
| `defaultCwd` | calling session's workspace | Fallback directory for commands without `cwd`. |
| `timeoutMs` | `60000` | Default per-command deadline; capped at 1 hour. |

Config is read when the plugin activates, so a change to this row needs a
Harness restart (this profile does not watch plugin module roots).

## Install

```bash
dsh plugin install /absolute/path/to/dsh-model-commands
```

Or, from inside the Harness, call `install_bundle` with the package directory,
a `.tgz`, or the npm package name. After the first install, **refresh the Web
page** so the browser half loads.

### Iterating on the plugin

The bundle is linked, so it can be edited in place. `pnpm run check && pnpm
test` exercises the pure logic without a Harness. For the running process, the
Loader caches the imported Host module, so reload the row after editing
`index.js`: changing that row in the profile patch is applied **live** in this
profile, so flipping the entry's `disabled` in
`<profile>/cordis.patch.yml` (`true`, then `false`) reloads both halves without
a Harness restart. Refresh the page afterwards to pick up the new browser
half; the command table itself survives, because it lives in its own JSON file.


## Behaviour and limits

- Commands run through the composed `ctx.shell` executor, so they inherit the
  deployment's shell (local or sandboxed) and the calling session's sandbox
  policy; a sandbox denial is reported in the result, not thrown away.
- Exit codes are results. Nonzero exits return their stdout/stderr like any
  other run; the model interprets them.
- Output caps and spill files come from the executor, and the result names the
  spill path when a stream was truncated.
- Cancelling the tool call kills the process (`onExpiry: 'kill'`, caller
  abort).
- The package imports only `node:` builtins — no `@deepseek-ai/*` dependency —
  so it publishes as an ordinary npm package and does not break when harness
  internals move.
- Both routes pass the composition's `connection.requestRejection` trust fence
  first; unauthenticated requests get 401/403.

## Not yet (next iterations)

- Per-argument `choices` and `trueText`/`falseText` editors in the settings page
  (the Host already accepts them).
- A "run once" button in the editor to try a command before the model does.
- Reordering, importing/exporting the table, and per-agent visibility.
