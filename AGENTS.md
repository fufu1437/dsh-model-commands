# AGENTS.md

`@fufu1437/dsh-model-commands` is a DeepSeek Harness (DSH) plugin bundle that
turns commands the user declares into **model-facing tools**. It is a
standalone, dependency-free npm package: a Host half (`index.js`) that keeps the
command table and registers one `ctx.tools` definition per command, and a
browser half (`client.js`) that renders the table as a page in **Settings →
Model commands**.

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
| `scripts/selftest.mjs` | The suite: pure functions plus one tool-definition run against a stub shell |

## Model experience

**The declared command IS the tool.** There is no wrapper tool and no
indirection: one table row becomes exactly one `ctx.tools.register` definition
whose name, description, and `parameters` schema are what the model reads.

- **`description` is the only selection signal the model gets.** It is required
  and must say *when* to use the command; validation rejects an empty or
  whitespace-only description rather than defaulting one.
- **Argument descriptions live on the argument**, in the generated schema —
  never restated in the tool description.
- The result text is a stable, greppable shape: `$ <line>`, `exit code: …`,
  then `--- stdout ---` and `--- stderr ---` sections. Keep it; the model reads
  it literally.
- Exit codes are results, not failures. Never turn a nonzero exit into a
  thrown error; only a *pre-execution* problem (missing required argument,
  wrong type) throws.

## Substitution invariants — do not weaken these

`renderCommand` is single-pass and type-directed. It is the whole security
model; a shortcut here is a shell-injection defect.

- `string` is quoted by `quoteShell` (`'` → `'\''`) and is therefore always
  exactly one word. Never interpolate a string value unquoted.
- `number` / `integer` must parse as a finite number / integer before
  substitution. Never pass the raw model text through.
- `boolean` substitutes only the author-declared `trueText` / `falseText`;
  model input never reaches the command line for that argument.
- A `string` with `choices` is validated against the list first.
- Substitution happens in one `String.replace` pass, so a value that contains
  `{{other}}` is data, never a second expansion. Do not "fix" a nested
  placeholder by looping the replacement.
- Every placeholder must be declared and every declared argument must be used;
  `normalizeCommand` rejects both mismatches with a per-command message.

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

## Verification

- `npm run check && npm test` must pass before any commit that touches
  `index.js`, `client.js`, or the suite. New behavior needs new assertions.
- The security-relevant assertions are the quoting ones: a hostile string must
  come out as one inert word, a non-numeric `number` must throw, and a value
  containing `{{x}}` must not expand. Do not delete them.
- A Host-half change is **not live** in a running Harness until the row is
  reloaded: the Loader caches the imported module. In the profile used here,
  flipping the entry's `disabled` in `<profile>/cordis.patch.yml`
  (`true`, then `false`) reloads live; refresh the page for the browser half.
  The command table survives, because it lives in its own JSON file.
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
- Use `cordis_inspect_query` (`Service`, `Event`, `Config`, `Slots`, `Theme`)
  before relying on a Harness API; the installed Harness is the authority.
