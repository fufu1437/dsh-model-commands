# AGENTS.md

`@fufu1437/dsh-model-commands` is a DeepSeek Harness (DSH) plugin bundle that
turns commands into **model-facing lookup tools**. It is a standalone,
dependency-free npm package: a Host half (`index.js`) that keeps the command
table and registers one `ctx.tools` definition per command, and a browser half
(`client.js`) that renders the table as a page in **Settings → Model commands**.

Read [README.md](README.md) for behavior and [README.zh.md](README.zh.md) for
the Chinese page; both describe the same product and must move together.

## Commands

```bash
npm run check            # node --check on both halves
npm test                 # self-test of rendering, validation, the store, and the tool definition
npm pack --dry-run       # inspect the published file list
npm publish --dry-run    # packaging + lifecycle + registry, no upload
```

Everything is plain ESM JavaScript: no build step, no TypeScript, no test
framework.

## Layout

| Path | Role |
|---|---|
| `index.js` | Host half: command-table store, argument rendering, tool definitions, the `GET`/`POST /dsh-model-commands/commands` route |
| `client.js` | Browser half: the `settings.section` page (list, editor, Host diagnostics) |
| `cordis.patch.yml` | Bundle patch that inserts the one Host row |
| `locale/en.json`, `locale/zh.json` | Plugin display metadata read by the Plugin Manager (`meta.title`, `meta.description`) |
| `icon.svg` | Plugin icon, declared as a top-level `icon` in the manifest |
| `scripts/selftest.mjs` | The suite: pure functions plus one tool-definition call |

## What the plugin is, and is not

- **It executes nothing.** No shell, no sandbox policy, no quoting, no exit
  codes, no process. It puts a command's usage, arguments, and purpose in the
  model's hands; the model runs it with the tools the deployment already
  provides. Do not add an execution path back here without the maintainer asking
  for it explicitly — the whole design is "documentation loaded on demand".
- **The declared command IS the tool.** One table row becomes exactly one
  `ctx.tools.register` definition; there is no wrapper tool and no indirection.
- **Two pieces of text, two jobs.** `description` (说明) is the one line in the
  model's tool list and the only thing the model reads when choosing between
  tools; it is required. `detail` (描述) is the body a call returns — usage,
  flags, real purpose; it is optional, and with no detail the tool answers with
  the description.
- **A detail or at least one argument is required.** An entry that only repeats
  its own one-line description has nothing to answer with; `normalizeCommand`
  rejects it with a per-command message.
- **The detail is the only thing a call costs.** Keep the result bare: the
  rendered detail, nothing else. Do not prepend a header, a command-line echo, or
  a usage banner.

## Substitution invariants — do not weaken these

`renderDetail` is single-pass and type-directed. The values are plain text (no
shell exists here), but the validation is what keeps a model-supplied value from
being silently mangled or from widening a `choices` contract.

- `string` is inserted verbatim; never trim, quote, or otherwise rewrite it.
- `number` must parse as a finite number before insertion.
- `boolean` substitutes only the author-declared `trueText` / `falseText`;
  model input never reaches the text for that argument.
- A `string` with `choices` is validated against the list first.
- Substitution happens in one `String.replace` pass, so a value that contains
  `{{other}}` is data, never a second expansion. Do not "fix" a nested
  placeholder by looping the replacement.
- **Only a declared argument name is substituted; every other `{{...}}` is
  literal.** The detail must accept any text a user pastes, so a placeholder with
  no matching argument is a warning, never a rejection. Do not reintroduce a hard
  placeholder/argument cross-check.
- An unmatched placeholder, an argument the detail never mentions, and arguments
  with no detail at all are reported through the `warnings` channel (advisory,
  shown as a dismissible banner). Keep them out of `errors`, which blocks a save.
- There is no `integer` type: `number` covers integral values deliberately.

## Table and routes

- The JSON table is the single source of truth; the live tool registrations are
  a derived cache. A save must **persist first and re-register in the same
  step**, and one save at a time (the route serializes writes).
- Writes are atomic: write a sibling temporary file, then `rename`. Never write
  the table in place.
- One invalid row must never discard the others. `validateList` keeps what is
  valid and returns one diagnostic per rejected row; registration failures
  (for example a name already taken by another tool) are collected the same way
  instead of throwing away the table.
- `command` is the pre-0.2.0 name of `detail`. It is still read as a fallback so
  an upgrade does not lose text; it is never written back.
- Every route calls `connection.requestRejection(req)` before doing anything
  else. That fence plus the browser-session cookie is what makes the table
  user-only.
- Request bodies are bounded and the content type is checked before parsing.

## Packaging — the npm artifact is the product

- Import `node:` builtins only. **Never import `@deepseek-ai/*`**: those
  packages resolve for a linked out-of-tree plugin only through
  `peerDependencies` (not `dependencies`), and a local copy would be a second
  instance. The published artifact must stay installable and loadable with zero
  dependencies, which is also why this plugin declares no `Config` and owns its
  own storage and routes instead of the `settings` namespace.
- Keep `dsh.bundle.patch`, `dsh.client`, `exports`, `icon`, `files`, and
  `publishConfig` working. If the runtime needs a new file, add it to `files`.
- The browser half registers through the plain module-loader format
  (`window.__ModuleLoader__.load({ id: '<package name>', factory })`) and its
  `id` must equal the package name.

## Client half

- Do not import any Harness Client package, including
  `@deepseek-ai/dsh-client-ui-primitives`. Copy the markup or CSS you need and
  rename its classes.
- Style with theme tokens only (`--dsw-alias-*`), each with a literal fallback,
  so a renamed token degrades appearance instead of breaking rendering. Own the
  injected stylesheet through a plugin effect.
- Every visible string exists in both the `zh` and `en` dictionaries, and the
  fallback translator answers when the locale service is absent.
- Never pre-validate in the browser. The page submits and renders the Host's own
  diagnostics — one validation authority, in `index.js`.
- Do not write DOM outside the component or append to `document.body`.
- When the Host rejects a save, keep the editor open: the draft is the only
  copy of what the user typed.
- The argument table is a six-column grid; the header labels carry the same
  inline padding as the controls they label, and the argument button fills its
  column. Keep the header and the rows aligned when you touch that CSS.

## Verification

- `npm run check && npm test` must pass before any commit that touches
  `index.js`, `client.js`, or the suite. New behavior needs new assertions.
- The load-bearing assertions are the substitution ones: a `number` that is not
  a number must throw, a value containing `{{x}}` must not expand, `choices`
  must be enforced, and a command with neither detail nor argument must be
  rejected. Do not delete them.
- A Host-half change is **not live** until the Harness process restarts: the
  Loader caches the imported module, and re-creating the row re-runs `apply`
  from that **cached** generation — the route comes back, but it is the old
  build. Only the client half is re-read from disk by the client-module
  registry, so flipping the entry's `disabled` in
  `<profile>/cordis.patch.yml` (`true`, then `false`) plus a page refresh is
  enough for `client.js`. The command table survives either way, because it
  lives in its own JSON file.
- Evidence that a registration really reached the model is the live tool
  schema: query `cordis_inspect_query` (`Tool.listTools`) after a reload.
  Evidence that the page really mounted is the live slot occupant:
  `Slots.listSubTree` root `settings.section` must list id
  `fufu-model-commands`.
- Never claim visual verification without browser control; report the
  limitation instead.

## Releasing

```bash
npm version patch          # commit + tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
npm publish                # publishConfig pins access=public + registry.npmjs.org
```

- Publishing and pushing a release are the maintainer's call. Do not publish
  or push a tag without an explicit instruction.
- After `npm publish` the packument can 404 for a few minutes while the CDN
  catches up; `dist-tags` shows the new `latest` first. That is propagation, not
  failure — do not republish on it.
- The auth token must sit under the correctly spelled
  `//registry.npmjs.org/:_authToken` key; a token stored without the slash
  before the colon is never read, and publishing then fails with a misleading
  2FA error. The default registry on this machine is a mirror, so
  `publishConfig.registry` is what keeps `npm publish` pointed at npmjs.org.

## Sharp edges in DSH

- **A third-party bundle cannot declare an editable `Config` cheaply.** The
  settings form domain requires `@deepseek-ai/schemastery`, and a linked plugin
  resolves that only through `peerDependencies`; there is no shipped generic
  schema-driven form renderer anyway. That is why the table lives in a JSON file
  and is edited by this plugin's own page.
- **`dsh.client.inject` is package-name ordering, not cordis injection.** The
  client half loads only while a Loader row mounting this package is active.
- **The Client module graph re-reads a bundle when an entry's fiber is
  (re)created**, not on every page load. Refresh after a reload; a stale graph
  serves the previous `client.js` bytes.
- **A Host module is cached for the whole process when `hmr.root` is empty.**
  An edit plus a row flip changes nothing: the same module generation runs
  again, and an old validation message can resurface from a build that is no
  longer on disk. To tell which generation is loaded, store an entry only the
  new code accepts and query `Tool.listTools` — a missing tool means the old
  module is live. Enabling `hmr` module watching avoids the restart entirely.
- Use `cordis_inspect_query` (`Service`, `Event`, `Config`, `Slots`, `Theme`)
  before relying on a Harness API; the installed Harness is the authority.
