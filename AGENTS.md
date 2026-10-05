# AGENTS.md

`@fufu1437/dsh-model-commands` is a DeepSeek Harness (DSH) plugin bundle that
lets a user author **their own skills** from the Settings page. It is a
standalone, dependency-free npm package: a Host half (`index.js`) that owns a
JSON table and publishes it into the skill registry, and a browser half
(`client.js`) that renders the table as a page in **Settings → Model commands**.

Read [README.md](README.md) for behavior and [README.zh.md](README.zh.md) for the
Chinese page; both describe the same product and must move together.

## Commands

```bash
npm run check            # node --check on both halves
npm test                 # self-test of validation, the table, and the provider
npm pack --dry-run       # inspect the published file list
npm publish --dry-run    # packaging + lifecycle + registry, no upload
```

Everything is plain ESM JavaScript: no build step, no TypeScript, no test
framework.

## Layout

| Path | Role |
|---|---|
| `index.js` | Host half: skill records, validation, the durable table, the skill-registry provider, the `GET`/`POST /dsh-model-commands/skills` route |
| `client.js` | Browser half: the `settings.section` page (kicker + title + intro, entry cards, the editor, dismissible banners) |
| `cordis.patch.yml` | Bundle patch that inserts the one Host row |
| `locale/en.json`, `locale/zh.json` | Plugin display metadata read by the Plugin Manager (`meta.title`, `meta.description`) |
| `icon.svg` | Plugin icon, declared as a top-level `icon` in the manifest |
| `scripts/selftest.mjs` | The suite: pure functions plus the provider contract |

## What the plugin is, and is not

- **It executes nothing.** No shell, no sandbox, no evaluation of user code, and
  no tools of its own. An entry is a skill: text the model reads on demand. If a
  future request needs execution, that is a different product decision and a
  different plugin, not a quiet addition here.
- **It publishes through `ctx.skills.registerProvider`.** The model's catalog,
  the `skill` tool, invocation policy, and layer/rank resolution all belong to the
  harness; this plugin only supplies candidates and bodies. Do not re-implement
  catalog behaviour, and do not register a parallel tool surface for the same
  entries.
- **An entry mirrors a filesystem skill**: kebab-case `name`, required
  `description` (the whole selection signal), optional `whenToUse`, and the body
  `content`. Keep those names: they are the registry's contract, not ours.
- **`list()` publishes every enabled entry, invocation policy included.** Which
  consumers see it (model, human command surface) is their decision, made from
  `invocation.modelInvocable` / `invocation.userInvocable`. Do not filter inside
  the provider.
- **`registerProvider` runs synchronously during `apply`**, inside the plugin's
  effect, and the disposer is returned. Registration failures are contained per
  entry — one broken row must never take the table down.

## Table and routes

- The JSON table is the single source of truth; the published catalog is derived.
  A save must **persist first, then re-publish and invalidate** in the same step,
  so the model's next request sees it.
- `control.invalidate()` is the only way a change reaches the catalog. Call it
  after every adopt (initial load included) — a save that only rewrites the file
  is invisible until the next restart.
- Writes are atomic: write a sibling temporary file, then `rename`. Never write
  the table in place.
- One invalid row must never discard the others. `validateList` keeps what is
  valid and returns one diagnostic per rejected row.
- **`errors` block a save; `warnings` never do.** A collision with another
  provider's name, and an entry only the user can invoke, are warnings — the
  registry settles shadows by layer and rank, so refusing the save would be
  wrong.
- Every route calls `connection.requestRejection(req)` before doing anything
  else. That fence plus the browser-session cookie is what makes the table
  user-only.
- Request bodies are bounded and the content type is checked before parsing.

## Packaging — the npm artifact is the product

- Import `node:` builtins only. **Never import `@deepseek-ai/*`**: those packages
  resolve for a linked out-of-tree plugin only through `peerDependencies` (not
  `dependencies`), and a local copy would be a second instance. Staying
  dependency-free is also why this plugin declares no `Config` schema and owns its
  own storage and routes instead of the `settings` namespace.
- Keep `dsh.bundle.patch`, `dsh.client`, `exports`, `icon`, `files`, and
  `publishConfig` working. If the runtime needs a new file, add it to `files`.
- The browser half registers through the plain module-loader format
  (`window.__ModuleLoader__.load({ id: '<package name>', factory })`) and its `id`
  must equal the package name.

## Client half

- Do not import any Harness Client package, including
  `@deepseek-ai/dsh-client-ui-primitives`. Copy the markup or CSS you need and
  rename its classes.
- Style with theme tokens only (`--dsw-alias-*`), each with a literal fallback, so
  a renamed token degrades appearance instead of breaking rendering. Own the
  injected stylesheet through a plugin effect.
- Every visible string exists in both the `zh` and `en` dictionaries, and the
  fallback translator answers when the locale service is absent.
- **Never pre-validate in the browser.** The page submits and renders the Host's
  own diagnostics — one validation authority, in `index.js`.
- Keep the page shape: a small uppercase kicker over the title, a one-paragraph
  intro, a round `+` action, entry cards (mono name, badges, description, and a
  plain-text `Edit` / `Disable` / `Delete` row), and an editor card that replaces
  the list while it is open. That shape is what makes it read as one of the
  harness's own management pages.
- Every banner carries its own close button, and a rejected save keeps the editor
  open: the draft is the only copy of what the user typed.
- Do not write DOM outside the component or append to `document.body`.

## Verification

- `npm run check && npm test` must pass before any commit that touches
  `index.js`, `client.js`, or the suite. New behavior needs new assertions.
- The load-bearing assertions are the contract ones: kebab-case names, a required
  description and body, the size ceilings, duplicate-name rejection, the summary
  shape (`invocation`, `source: 'runtime'`, `provider`), and that the provider
  lists only enabled entries while `get` resolves a body by locator and refuses a
  disabled or unknown one. Do not delete them.
- **Proof that the model really sees an entry** is the skill catalog the harness
  hands the agent: after saving an entry, the next request's available-skills list
  contains it. That is the end-to-end check — registration alone proves nothing.
- A Host-half change is **not live** until the module is re-imported: the Loader
  caches the generation, and re-creating the row re-runs `apply` from that cached
  code. This machine enables `hmr` watching for the plugin directory, so a saved
  `index.js` reloads itself. Only `client.js` is re-read from disk by the
  client-module registry; refresh the page after a row reload.
- Evidence that the page really mounted is the live slot occupant:
  `Slots.listSubTree` root `settings.section` must list id `fufu-model-commands`.
- Never claim visual verification without browser control; report the limitation
  instead.

## Releasing

```bash
npm version patch          # commit + tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
npm publish                # publishConfig pins access=public + registry.npmjs.org
```

- Publishing and pushing a release are the maintainer's call. Do not publish or
  push a tag without an explicit instruction.
- After `npm publish` the packument can 404 for a few minutes while the CDN
  catches up; `dist-tags` shows the new `latest` first. That is propagation, not
  failure — do not republish on it.
- The auth token must sit under the correctly spelled
  `//registry.npmjs.org/:_authToken` key; a token stored without the slash before
  the colon is never read, and publishing then fails with a misleading 2FA error.
  The default registry on this machine is a mirror, so `publishConfig.registry` is
  what keeps `npm publish` pointed at npmjs.org.

## Sharp edges in DSH

- **A third-party bundle cannot declare an editable `Config` cheaply.** The
  settings form domain requires `@deepseek-ai/schemastery`, and a linked plugin
  resolves that only through `peerDependencies`; there is no shipped generic
  schema-driven form renderer anyway. That is why the table lives in a JSON file
  and is edited by this plugin's own page.
- **The skills registry is layered per scope**, and a provider registers into the
  layer of the context that calls `registerProvider`. A plugin row registers
  globally; a preset-mounted plugin would register for that preset only.
- **`dsh.client.inject` is package-name ordering, not cordis injection.** The
  client half loads only while a Loader row mounting this package is active.
- **The Client module graph re-reads a bundle when an entry's fiber is
  (re)created**, not on every page load. Refresh after a reload; a stale graph
  serves the previous `client.js` bytes.
- **A Host module is cached for the whole process when `hmr.root` is empty.** An
  edit plus a row flip changes nothing: the same module generation runs again, and
  an old validation message can resurface from a build that is no longer on disk.
  Enabling `hmr` module watching avoids the restart entirely.
- Use `cordis_inspect_query` (`Service`, `Event`, `Config`, `Slots`, `Theme`)
  before relying on a Harness API; the installed Harness is the authority.
