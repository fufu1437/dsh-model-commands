/**
 * Host half of `@fufu1437/dsh-model-commands`.
 *
 * One idea: **your own skills, authored in the Settings page.**
 *
 * Every stored entry is published into the Harness skill registry through
 * `ctx.skills.registerProvider(...)`, so an entry behaves exactly like a shipped
 * skill: the model's catalog carries its `name` + `description` (cheap, always
 * present), the built-in `skill` tool loads the body on demand, and nothing is
 * executed — a skill is text the model reads, never a command this plugin runs.
 *
 * The plugin therefore registers **no tools of its own** and imports nothing
 * outside `node:` builtins: it owns a JSON table, publishes it as skills, and
 * serves the two fenced routes the settings page uses.
 *
 * Table: `<DSH_HOME>/model-commands/skills.json`
 *
 * - `GET  /dsh-model-commands/skills` returns the stored table;
 * - `POST /dsh-model-commands/skills` replaces it, validates it, persists it,
 *   and invalidates the skill catalog so the next request sees the change.
 *
 * @module @fufu1437/dsh-model-commands
 */

import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

/** Cordis plugin (function-plugin) name. */
export const name = 'dsh-model-commands'

/** The composed services this plugin cannot work without. */
export const inject = ['skills']

/** Route prefix owned by this plugin. */
const ROUTE_PREFIX = '/dsh-model-commands'

/** The skill-table route: `GET` reads it, `POST` replaces it. */
export const SKILLS_PATH = `${ROUTE_PREFIX}/skills`

/** The provider name every published skill carries. */
export const PROVIDER_NAME = 'model-commands'

/** Where a published candidate sits among same-named entries in one layer. */
const PROVIDER_RANK = 500

/** The whole table must fit in one request body; anything larger is hostile. */
const MAX_BODY_BYTES = 4 * 1024 * 1024

/** Skill names are the `skill` tool's lookup key, so they are strict kebab-case. */
export const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Ceilings, so one entry cannot flood the catalog or the context window. */
const NAME_MAX_LENGTH = 64
const DESCRIPTION_MAX_LENGTH = 4096
const WHEN_TO_USE_MAX_LENGTH = 1024
const CONTENT_MAX_LENGTH = 65_536

/** Where the table lives when the config does not say. */
const DEFAULT_STORE_DIRNAME = 'model-commands'
const DEFAULT_STORE_FILENAME = 'skills.json'

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the Loader row's config into the values this plugin uses.
 * Every field is optional, so a hand-written `cordis.patch.yml` row can never
 * produce an unusable plugin.
 * @param config - the Loader row's raw config.
 * @returns the resolved configuration.
 */
export function resolveConfig(config) {
  const raw = config !== null && typeof config === 'object' && !Array.isArray(config) ? config : {}
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const storePath = typeof raw.storePath === 'string' && raw.storePath.length > 0
    ? raw.storePath
    : join(dshHome, DEFAULT_STORE_DIRNAME, DEFAULT_STORE_FILENAME)
  const maxSkills = Number.isFinite(raw.maxSkills) && raw.maxSkills > 0 ? Math.floor(raw.maxSkills) : 200
  return { dshHome, storePath, maxSkills }
}

/* -------------------------------------------------------------------------- */
/* Table (durable store)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Read the stored skill table synchronously.
 * A missing file is an empty table; a corrupt file is an empty table plus a
 * warning, because refusing to start over unreadable user data would be worse
 * than starting empty and letting the user re-save from the settings page.
 * @param storePath - absolute path of the JSON table.
 * @param onWarn - receives a human-readable warning, when one happens.
 * @returns the stored raw entries.
 */
export function readStore(storePath, onWarn) {
  let text
  try {
    text = readFileSync(storePath, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') onWarn?.(`could not read ${storePath}: ${String(error?.message ?? error)}`)
    return []
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    onWarn?.(`${storePath} is not valid JSON (${String(error?.message ?? error)}); starting with no skills`)
    return []
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.skills
  if (!Array.isArray(list)) {
    onWarn?.(`${storePath} has no "skills" array; starting with no skills`)
    return []
  }
  return list
}

/**
 * Replace the stored table atomically: write a sibling temporary file, then
 * rename it over the target so a crash never leaves a half-written table.
 * @param storePath - absolute path of the JSON table.
 * @param skills - the normalized skills to persist.
 * @returns the bytes written.
 */
export async function writeStore(storePath, skills) {
  const body = `${JSON.stringify({ version: 2, skills }, null, 2)}\n`
  await mkdir(dirname(storePath), { recursive: true })
  const temporary = `${storePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, body, 'utf8')
  await rename(temporary, storePath)
  return body.length
}

/* -------------------------------------------------------------------------- */
/* Skill records                                                              */
/* -------------------------------------------------------------------------- */

/** @param value - candidate. @returns whether it is a non-empty string. */
function isFilledString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Normalize and validate one skill entry.
 *
 * The shape mirrors a filesystem skill: a kebab-case `name`, a `description`
 * that is the model's whole selection signal, an optional `whenToUse`, the body
 * `content`, and the invocation policy the registry consumes.
 *
 * @param raw - the raw entry from the table.
 * @param index - its position, used in diagnostics.
 * @returns `{ ok: true, value, warnings }` or `{ ok: false, error }`.
 */
export function normalizeSkill(raw, index) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: `skill #${String(index + 1)} must be an object` }
  }
  const label = isFilledString(raw.name) ? `skill "${raw.name}"` : `skill #${String(index + 1)}`
  if (typeof raw.name !== 'string' || !NAME_PATTERN.test(raw.name) || raw.name.length > NAME_MAX_LENGTH) {
    return { ok: false, error: `${label}: name must be kebab-case (${String(NAME_PATTERN)}, at most ${String(NAME_MAX_LENGTH)} characters)` }
  }
  if (!isFilledString(raw.description)) {
    return { ok: false, error: `${label}: description is required — it is the only thing the model reads when choosing a skill` }
  }
  if (raw.description.length > DESCRIPTION_MAX_LENGTH) {
    return { ok: false, error: `${label}: description must be at most ${String(DESCRIPTION_MAX_LENGTH)} characters` }
  }
  if (!isFilledString(raw.content)) {
    return { ok: false, error: `${label}: content is required — it is the body the model receives when it loads the skill` }
  }
  if (raw.content.length > CONTENT_MAX_LENGTH) {
    return { ok: false, error: `${label}: content must be at most ${String(CONTENT_MAX_LENGTH)} characters` }
  }
  if (raw.whenToUse !== undefined && (typeof raw.whenToUse !== 'string' || raw.whenToUse.length > WHEN_TO_USE_MAX_LENGTH)) {
    return { ok: false, error: `${label}: whenToUse must be a string of at most ${String(WHEN_TO_USE_MAX_LENGTH)} characters` }
  }
  const warnings = []
  if (raw.userInvocable === true && raw.modelInvocable === false) {
    warnings.push(`${label}: only you can invoke it (the model cannot see it)`)
  }
  return {
    ok: true,
    warnings,
    value: {
      id: isFilledString(raw.id) ? raw.id : randomUUID(),
      name: raw.name,
      description: raw.description.trim(),
      ...(isFilledString(raw.whenToUse) ? { whenToUse: raw.whenToUse.trim() } : {}),
      content: raw.content,
      modelInvocable: raw.modelInvocable !== false,
      userInvocable: raw.userInvocable === true,
      enabled: raw.enabled !== false,
      source: raw.source === 'model' ? 'model' : 'user',
      createdAt: isFilledString(raw.createdAt) ? raw.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  }
}

/**
 * Normalize a whole table, keeping the valid entries and reporting the rest.
 * One bad row must not cost the user every other skill.
 * @param list - the raw entries.
 * @param maxSkills - the accepted entry ceiling.
 * @returns normalized skills, one diagnostic per rejected entry, and warnings.
 */
export function validateList(list, maxSkills = 200) {
  const skills = []
  const errors = []
  const warnings = []
  const names = new Set()
  if (!Array.isArray(list)) return { skills, errors: [{ message: 'skills must be an array' }], warnings }
  if (list.length > maxSkills) return { skills, errors: [{ message: `at most ${String(maxSkills)} skills; got ${String(list.length)}` }], warnings }
  for (const [index, raw] of list.entries()) {
    const normalized = normalizeSkill(raw, index)
    if (!normalized.ok) {
      errors.push({ index, message: normalized.error })
      continue
    }
    if (names.has(normalized.value.name)) {
      errors.push({ index, name: normalized.value.name, message: `skill "${normalized.value.name}" is declared twice` })
      continue
    }
    names.add(normalized.value.name)
    skills.push(normalized.value)
    for (const message of normalized.warnings ?? []) warnings.push({ index, name: normalized.value.name, message })
  }
  return { skills, errors, warnings }
}

/* -------------------------------------------------------------------------- */
/* Publishing to the skill registry                                           */
/* -------------------------------------------------------------------------- */

/** @param skill - a stored skill. @returns the registry-consumable summary. */
export function skillSummary(skill) {
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
    invocation: {
      modelInvocable: skill.modelInvocable !== false,
      userInvocable: skill.userInvocable === true,
    },
    source: 'runtime',
    provider: PROVIDER_NAME,
  }
}

/**
 * Build one provider candidate: the summary plus the rank and the opaque
 * locator `get()` receives back.
 * @param skill - a stored skill.
 * @returns the candidate.
 */
export function skillCandidate(skill) {
  return { ...skillSummary(skill), rank: PROVIDER_RANK, locator: skill.id }
}

/**
 * Build the skill provider this plugin registers.
 * `list` publishes every enabled entry — invocation policy is the consumer's
 * business — and `get` returns the body for the entry whose id the locator
 * names.
 * @param state - the live table holder.
 * @returns the provider.
 */
export function createSkillProvider(state) {
  const find = (locator) => state.skills.find((skill) => skill.id === locator)
  return {
    name: PROVIDER_NAME,
    async list() {
      return {
        candidates: state.skills.filter((skill) => skill.enabled !== false).map(skillCandidate),
        complete: true,
      }
    },
    async get(candidate) {
      const skill = find(candidate.locator)
      if (skill === undefined || skill.enabled === false) return undefined
      return { ...skillSummary(skill), content: skill.content, metadata: { id: skill.id, updatedAt: skill.updatedAt } }
    },
  }
}

/* -------------------------------------------------------------------------- */
/* HTTP helpers                                                               */
/* -------------------------------------------------------------------------- */

/** @param res - the response. @param status - the status code. @param body - the JSON body. */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}

/** @param res - the response. @param allow - the allowed method. */
function sendMethodNotAllowed(res, allow) {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.end()
}

/**
 * Read a bounded request body.
 * @param req - the request.
 * @returns the body text, or null when it exceeds the cap.
 */
async function readBoundedBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

/* -------------------------------------------------------------------------- */
/* Plugin body                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Host plugin body: load the table, publish it as skills, and expose the fenced
 * routes the settings page uses to read and replace it.
 * @param ctx - Host context.
 * @param config - the Loader row's config.
 */
export function apply(ctx, config) {
  const resolved = resolveConfig(config)
  const state = { skills: [], errors: [], warnings: [], invalidate: () => {} }

  /**
   * Adopt a validated table and publish it.
   * @param list - raw entries from disk or from a request.
   * @returns the accepted skills, every diagnostic, and the warnings.
   */
  const adopt = (list) => {
    const { skills, errors, warnings } = validateList(list, resolved.maxSkills)
    state.skills = skills
    state.errors = errors
    state.warnings = warnings
    state.invalidate()
    return { skills, errors, warnings }
  }

  ctx.effect(() => {
    const dispose = ctx.skills.registerProvider((control) => {
      state.invalidate = () => { control.invalidate() }
      return createSkillProvider(state)
    })
    adopt(readStore(resolved.storePath, (warning) => ctx.logger?.warn?.(`dsh-model-commands: ${warning}`)))
    return () => {
      state.invalidate = () => {}
      dispose()
    }
  }, 'dsh-model-commands: skill provider')

  // The settings page is optional: in a profile without the browser carrier the
  // skills are still published, and only the editor disappears.
  ctx.inject(['webServer', 'connection'], (routeCtx) => {
    /** Serializes table writes so two quick saves cannot interleave. */
    let tail = Promise.resolve()

    /**
     * Flag names another provider already publishes: the registry settles a
     * collision by layer and rank, so a same-named skill silently hides one of
     * the two. Cheap to check here, because a save lists the catalog anyway.
     * @param skills - the accepted table.
     * @returns one warning per colliding name.
     */
    const collisionWarnings = async (skills) => {
      const findings = []
      try {
        const existing = await ctx.skills.list({})
        const foreign = new Set(existing.filter((entry) => entry.provider !== PROVIDER_NAME).map((entry) => entry.name))
        for (const skill of skills) {
          if (foreign.has(skill.name)) findings.push({ name: skill.name, message: `skill "${skill.name}" already exists from another provider; one of the two will shadow the other` })
        }
      } catch (error) {
        ctx.logger?.warn?.(`dsh-model-commands: could not list existing skills: ${String(error?.message ?? error)}`)
      }
      return findings
    }

    routeCtx.effect(() => routeCtx.webServer.register({
      kind: 'exact',
      path: SKILLS_PATH,
      handler: async (req, res) => {
        const rejection = routeCtx.connection.requestRejection(req)
        if (rejection !== undefined) {
          res.statusCode = rejection
          res.end()
          return
        }
        if (req.method === 'GET') {
          sendJson(res, 200, { ok: true, storePath: resolved.storePath, skills: state.skills, errors: state.errors, warnings: state.warnings })
          return
        }
        if (req.method !== 'POST') {
          sendMethodNotAllowed(res, 'GET, POST')
          return
        }
        if (String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
          sendJson(res, 415, { ok: false, code: 'unsupported-media-type', message: 'content-type must be application/json' })
          return
        }
        const text = await readBoundedBody(req)
        if (text === null) {
          sendJson(res, 413, { ok: false, code: 'body-too-large', message: `request body must be at most ${String(MAX_BODY_BYTES)} bytes` })
          return
        }
        let body
        try {
          body = JSON.parse(text)
        } catch {
          sendJson(res, 400, { ok: false, code: 'invalid-json', message: 'body must be JSON' })
          return
        }
        if (body === null || typeof body !== 'object' || !Array.isArray(body.skills)) {
          sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'body must be an object with a "skills" array' })
          return
        }
        const write = tail.then(async () => {
          const report = adopt(body.skills)
          await writeStore(resolved.storePath, report.skills)
          return { ...report, warnings: [...report.warnings, ...await collisionWarnings(report.skills)] }
        })
        tail = write.then(() => undefined, () => undefined)
        try {
          const report = await write
          ctx.logger?.info?.(`dsh-model-commands: saved ${String(report.skills.length)} skill(s)`)
          sendJson(res, 200, { ok: true, storePath: resolved.storePath, skills: report.skills, errors: report.errors, warnings: report.warnings })
        } catch (error) {
          ctx.logger?.warn?.(`dsh-model-commands: save failed: ${String(error?.message ?? error)}`)
          sendJson(res, 500, { ok: false, code: 'save-failed', message: String(error?.message ?? error) })
        }
      },
    }), `dsh-model-commands: GET/POST ${SKILLS_PATH}`)
  })
}

/**
 * Internals exported for this package's own tests. Not a public API: the
 * Loader composes this module only through {@link apply}.
 */
export const __test = {
  resolveConfig,
  readStore,
  writeStore,
  normalizeSkill,
  validateList,
  skillSummary,
  skillCandidate,
  createSkillProvider,
  SKILLS_PATH,
}
