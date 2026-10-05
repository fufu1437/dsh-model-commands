# Model Commands (@fufu1437/dsh-model-commands)

A DeepSeek Harness (DSH) plugin that lets you **author your own skills in the
Settings page**.

Every entry you write is published into the Harness **skill registry**, so it
behaves exactly like a shipped skill: the model's catalog carries one line
(`name` + `description`), the built-in `skill` tool loads the body only when it
is needed, and **the plugin executes nothing** — a skill is text the model reads,
never a command that runs.

> 中文文档：[README.zh.md](README.zh.md)

## Why skills rather than tools

DSH already ships the deferred-loading machinery: a skill catalog costs one line
per entry on every request, and the body is paid for once, when the model asks
for it. This plugin adds a **table, a Settings page, and a registry provider** on
top of that — it registers no tools of its own, so there is nothing new for the
model to learn and nothing to keep in sync with the harness.

| | Declared here | Shipped skills (a `skills` folder) |
|---|---|---|
| Where it lives | `<DSH_HOME>/model-commands/skills.json` | files on disk |
| Who edits it | Settings → Model commands | your editor |
| Model-facing behaviour | identical | identical |

## The page

**Settings → Model commands** shows one card per entry — the name, badges
(`user`/`model`, `disabled`, `only you`), the description, and a text action row
(`Edit` / `Disable` / `Delete`). The round **+** in the top right opens the
editor:

| Field | Meaning |
|---|---|
| **Name** | kebab-case (`disk-usage`); the key the model loads. |
| **Description** | Required. The only thing in the standing catalog, and the whole basis for the model's decision. |
| **When to use** | Optional extra trigger text, carried in the catalog too. |
| **Body** | Markdown the model receives after loading. A pasted `--help` output is fine (up to 65 536 characters). |
| **Model can invoke** | On by default: the entry appears in the model's skill catalog. |
| **You can too** | Off by default: additionally lists it on the human command surface. |
| **Enabled** | Off keeps the entry stored but out of the catalog. |

Saving writes the whole table atomically, re-publishes it, and invalidates the
skill catalog, so the change is visible to the model on its next step — no
restart, no reload.

Validation is the Host's, and the page renders its diagnostics: **errors** (bad
name, missing description or body, oversized body, duplicate name) block the
save; **warnings** (a name another provider already publishes, an entry only you
can invoke) appear as a dismissible banner and never block.

## Configuration

```yaml
- id: fufu-model-commands
  name: '@fufu1437/dsh-model-commands'
  config:
    storePath: /home/me/.dsh/model-commands/skills.json
    maxSkills: 200
```

| Field | Default | Meaning |
|---|---|---|
| `storePath` | `<DSH_HOME>/model-commands/skills.json` | Where the table lives. |
| `maxSkills` | `200` | Entry ceiling. |

## Install

```bash
npm install @fufu1437/dsh-model-commands
dsh plugin install @fufu1437/dsh-model-commands
```

Or, from inside the Harness, call `install_bundle` with the package directory, a
`.tgz`, or the npm package name. After the first install, **refresh the Web
page** so the browser half loads.

### Iterating on the plugin

`npm run check && npm test` exercises the pure logic without a Harness.

- **`client.js`** is read from disk by the client-module registry: reload the
  plugin row (flip the entry's `disabled` in `<profile>/cordis.patch.yml`,
  `true` then `false`) and refresh the page.
- **`index.js`** needs module watching or a Harness restart. On this machine the
  profile already enables watching for this directory (`hmr` with
  `base` = the plugin directory, `root: ["."]`), so a saved `index.js` reloads
  itself.

## Behaviour and limits

- **Nothing is executed.** The plugin reads and writes one JSON file, publishes
  skills, and serves two fenced routes. There is no shell, no sandbox, no
  evaluation of user code.
- The table is the single source of truth; the published catalog is derived, so a
  save persists first and re-publishes in the same step.
- Writes are atomic (temporary file + rename), and one invalid row is reported
  without discarding the valid ones.
- Both routes pass the composition's `connection.requestRejection` trust fence
  first; unauthenticated requests get 401/403.
- The package imports only `node:` builtins — no `@deepseek-ai/*` dependency — so
  it publishes as an ordinary npm package and does not break when harness
  internals move.
- A name another provider already publishes is a warning, not an error: the
  registry settles the collision by layer and rank, so one of the two shadows the
  other.

## Migration from 0.2.x

Up to 0.2.0 an entry declared a command line and the plugin registered one
model-facing tool per entry. That is gone: an entry is a skill now, stored in
`skills.json`. An old `commands.json` is **left untouched and no longer read** —
paste its text into the new editor if you want it back, or, for a folder of
files, use the built-in filesystem skill roots instead (for example
`~/.dsh/skills/`).

## Not yet (next iterations)

- Model-authored entries (a `skill_create`-style toolset behind the user's
  approval), mirroring how `dsh-custom-tool` lets the model grow its own tools.
- Import/export and reordering.
- Per-project scoping (the provider already receives the view's `cwd`, so this is
  a storage decision, not an API one).
