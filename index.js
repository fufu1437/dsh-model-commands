/**
 * Host half of `@fufu1437/dsh-model-commands`.
 *
 * One idea: **declare a command once, and the model can look it up.**
 * Every entry in the plugin's table becomes a model-facing tool — the same
 * surface as `bash`, `read`, or `edit` — so the model gets one command's usage,
 * flags, and real purpose on demand instead of carrying every command's
 * documentation in its prompt from the first turn.
 *
 * A definition carries two pieces of text:
 *
 * - `description` (说明) is the one line the model reads when choosing between
 *   tools. It is required, and it is the only thing an idle tool costs.
 * - `detail` (描述) is the body the model receives when it calls the tool: what
 *   the command does, how its arguments are spelled, and when it is the right
 *   one. It is optional, and when it is absent the tool answers with the
 *   description. At least one of `detail` and `args` must be present, so an
 *   entry always has something to say.
 *
 * `detail` may contain `{{argument}}` placeholders filled from the call's
 * arguments, so one entry can cover several related invocations. **Only a
 * placeholder whose name is a declared argument is substituted; every other
 * `{{...}}` stays exactly as written**, so pasting a real `--help` dump can
 * never fail validation. Substitution is single-pass and type-directed (see
 * `renderDetail`), and the arguments are projected onto a JSON Schema the model
 * sees. A placeholder with no matching argument, or an argument the detail never
 * mentions, is reported as a warning the settings page shows — never as a
 * rejection.
 *
 * This plugin runs nothing. It hands the model the exact command line, its
 * flags, and its purpose; the model executes it with the tools the deployment
 * already provides.
 *
 * The table lives in a JSON file under the Harness home
 * (`<DSH_HOME>/model-commands/commands.json`). The browser half renders it as a
 * page in **Settings → Model commands**; the two fenced HTTP routes below are
 * the only way it is read and replaced:
 *
 * - `GET  /dsh-model-commands/commands` returns the stored table;
 * - `POST /dsh-model-commands/commands` replaces it, then re-registers the
 *   model-facing tools in the same step.
 *
 * The module imports nothing outside `node:` builtins, so the published package
 * carries no dependency on unpublished `@deepseek-ai/*` packages and no
 * configuration schema is required for it to work.
 *
 * @module @fufu1437/dsh-model-commands
 */

import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Cordis plugin (function-plugin) name. */
export const name = 'dsh-model-commands'

/** The composed services this plugin cannot work without. */
export const inject = ['tools']

/** Route prefix owned by this plugin. */
const ROUTE_PREFIX = '/dsh-model-commands'

/** The command-table route: `GET` reads it, `POST` replaces it. */
export const COMMANDS_PATH = `${ROUTE_PREFIX}/commands`

/** The whole table must fit in one request body; anything larger is hostile. */
const MAX_BODY_BYTES = 1024 * 1024

/** Tool names become function names for the model, so they are strict. */
export const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/

/** Argument names must be usable as `{{placeholders}}` and as identifiers. */
export const ARG_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,47}$/

/**
 * The argument types a command may declare. `number` covers integral values
 * too, so there is no separate `integer` type.
 */
export const ARG_TYPES = ['string', 'number', 'boolean']

/** `{{name}}` inside a description. */
const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

/** Ceiling on the one-line selection signal. */
const DESCRIPTION_MAX_LENGTH = 4096

/** Ceiling on the returned body; it is paid for on every call. */
const DETAIL_MAX_LENGTH = 32768

/** Where the table lives when the config does not say. */
const DEFAULT_STORE_DIRNAME = 'model-commands'
const DEFAULT_STORE_FILENAME = 'commands.json'

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
  return { dshHome, storePath }
}

/* -------------------------------------------------------------------------- */
/* Command table (durable store)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Read the stored command table synchronously.
 * A missing file is an empty table; a corrupt file is an empty table plus a
 * warning, because refusing to start over unreadable user data would be worse
 * than starting empty and letting the user re-save from the settings page.
 * @param storePath - absolute path of the JSON table.
 * @param onWarn - receives a human-readable warning, when one happens.
 * @returns the stored raw command entries.
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
    onWarn?.(`${storePath} is not valid JSON (${String(error?.message ?? error)}); starting with no commands`)
    return []
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.commands
  if (!Array.isArray(list)) {
    onWarn?.(`${storePath} has no "commands" array; starting with no commands`)
    return []
  }
  return list
}

/**
 * Replace the stored table atomically: write a sibling temporary file, then
 * rename it over the target so a crash never leaves a half-written table.
 * @param storePath - absolute path of the JSON table.
 * @param commands - the normalized commands to persist.
 * @returns the bytes written.
 */
export async function writeStore(storePath, commands) {
  const body = `${JSON.stringify({ version: 1, commands }, null, 2)}\n`
  await mkdir(dirname(storePath), { recursive: true })
  const temporary = `${storePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, body, 'utf8')
  await rename(temporary, storePath)
  return body.length
}

/* -------------------------------------------------------------------------- */
/* Command definitions                                                        */
/* -------------------------------------------------------------------------- */

/** @param value - candidate. @returns whether it is a non-empty string. */
function isFilledString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Normalize and validate one argument declaration.
 * @param raw - the raw declaration from the table.
 * @param index - its position, used in diagnostics.
 * @returns `{ ok: true, value }` or `{ ok: false, error }`.
 */
export function normalizeArgument(raw, index) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: `argument #${String(index + 1)} must be an object` }
  }
  const at = `argument "${String(raw.name ?? `#${String(index + 1)}`)}"`
  if (typeof raw.name !== 'string' || !ARG_NAME_PATTERN.test(raw.name)) {
    return { ok: false, error: `${at}: name must match ${String(ARG_NAME_PATTERN)}` }
  }
  const type = raw.type ?? 'string'
  if (!ARG_TYPES.includes(type)) {
    return { ok: false, error: `${at}: type must be one of ${ARG_TYPES.join(', ')}` }
  }
  const value = {
    name: raw.name,
    type,
    ...(isFilledString(raw.description) ? { description: raw.description.trim() } : {}),
    ...(raw.required === true ? { required: true } : {}),
  }
  if (raw.default !== undefined) {
    if (typeof raw.default !== 'string' && typeof raw.default !== 'number' && typeof raw.default !== 'boolean') {
      return { ok: false, error: `${at}: default must be a string, number, or boolean` }
    }
    value.default = raw.default
  }
  if (raw.choices !== undefined) {
    if (type !== 'string' || !Array.isArray(raw.choices) || raw.choices.length === 0
      || raw.choices.some((choice) => typeof choice !== 'string')) {
      return { ok: false, error: `${at}: choices is only valid for a string argument and must be a non-empty array of strings` }
    }
    value.choices = [...raw.choices]
    if (value.default !== undefined && !value.choices.includes(value.default)) {
      return { ok: false, error: `${at}: default must be one of its choices` }
    }
  }
  if (raw.trueText !== undefined || raw.falseText !== undefined) {
    if (type !== 'boolean') return { ok: false, error: `${at}: trueText/falseText are only valid for a boolean argument` }
    value.trueText = typeof raw.trueText === 'string' ? raw.trueText : 'true'
    value.falseText = typeof raw.falseText === 'string' ? raw.falseText : 'false'
  }
  return { ok: true, value }
}

/**
 * Normalize and validate one command definition.
 *
 * `detail` is optional and `args` is optional, but **at least one of them must
 * be present**: an entry that only repeats its own one-line description has
 * nothing to answer with. A definition written before version 0.2.0 carries its
 * body in `command`; that value is adopted as `detail`, so upgrading does not
 * lose text.
 *
 * @param raw - the raw definition from the table.
 * @param index - its position, used in diagnostics.
 * @returns `{ ok: true, value }` or `{ ok: false, error }`.
 */
export function normalizeCommand(raw, index) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: `command #${String(index + 1)} must be an object` }
  }
  const label = isFilledString(raw.name) ? `command "${raw.name}"` : `command #${String(index + 1)}`
  if (typeof raw.name !== 'string' || !NAME_PATTERN.test(raw.name)) {
    return { ok: false, error: `${label}: name must match ${String(NAME_PATTERN)} (letters, digits, "_" and "-")` }
  }
  if (!isFilledString(raw.description)) {
    return { ok: false, error: `${label}: description is required — it is the only thing the model reads when choosing this command` }
  }
  if (raw.description.length > DESCRIPTION_MAX_LENGTH) {
    return { ok: false, error: `${label}: description must be at most ${String(DESCRIPTION_MAX_LENGTH)} characters` }
  }
  for (const field of ['detail', 'command']) {
    if (raw[field] !== undefined && typeof raw[field] !== 'string') {
      return { ok: false, error: `${label}: ${field} must be a string` }
    }
  }
  // `command` is the pre-0.2.0 name of this field; its text is documentation,
  // so it migrates as-is.
  const detail = isFilledString(raw.detail) ? raw.detail : (isFilledString(raw.command) ? raw.command : undefined)
  if (detail !== undefined && detail.length > DETAIL_MAX_LENGTH) {
    return { ok: false, error: `${label}: detail must be at most ${String(DETAIL_MAX_LENGTH)} characters` }
  }
  const rawArgs = raw.args === undefined ? [] : raw.args
  if (!Array.isArray(rawArgs)) return { ok: false, error: `${label}: args must be an array` }
  const args = []
  const seen = new Set()
  for (const [argIndex, entry] of rawArgs.entries()) {
    const normalized = normalizeArgument(entry, argIndex)
    if (!normalized.ok) return { ok: false, error: `${label}: ${normalized.error}` }
    if (seen.has(normalized.value.name)) return { ok: false, error: `${label}: argument "${normalized.value.name}" is declared twice` }
    seen.add(normalized.value.name)
    args.push(normalized.value)
  }
  if (detail === undefined && args.length === 0) {
    return { ok: false, error: `${label}: a command needs a detail (描述) or at least one argument, so a call has something to answer with` }
  }
  // Placeholders and arguments are reported, never enforced: the detail accepts
  // any text, so a pasted help dump is always savable. Only a placeholder whose
  // name is a declared argument is substituted at call time.
  const warnings = []
  if (detail === undefined) {
    if (args.length > 0) {
      warnings.push(`${label}: no detail, so ${args.length === 1 ? 'the argument' : 'the arguments'} never affect the answer (the tool returns the description)`)
    }
  } else {
    const placeholders = new Set()
    for (const match of detail.matchAll(PLACEHOLDER_PATTERN)) placeholders.add(match[1])
    for (const token of placeholders) {
      if (!seen.has(token)) warnings.push(`${label}: {{${token}}} has no matching argument and will stay literal`)
    }
    for (const token of seen) {
      if (!placeholders.has(token)) warnings.push(`${label}: argument "${token}" is never used in the detail`)
    }
  }
  return {
    ok: true,
    value: {
      name: raw.name,
      description: raw.description.trim(),
      ...(detail === undefined ? {} : { detail: detail.trim() }),
      args,
      ...(isFilledString(raw.title) ? { title: raw.title.trim() } : {}),
      ...(raw.enabled === false ? { enabled: false } : {}),
    },
    warnings,
  }
}

/**
 * Normalize a whole table, keeping the valid entries and reporting the rest.
 * One bad row must not cost the user every other command.
 * @param list - the raw entries.
 * @returns normalized commands, one diagnostic per rejected entry, and the
 * advisory warnings of the accepted entries.
 */
export function validateList(list) {
  const commands = []
  const errors = []
  const warnings = []
  const names = new Set()
  if (!Array.isArray(list)) return { commands, errors: [{ message: 'commands must be an array' }], warnings }
  for (const [index, raw] of list.entries()) {
    const normalized = normalizeCommand(raw, index)
    if (!normalized.ok) {
      errors.push({ index, message: normalized.error })
      continue
    }
    if (names.has(normalized.value.name)) {
      errors.push({ index, name: normalized.value.name, message: `command "${normalized.value.name}" is declared twice` })
      continue
    }
    names.add(normalized.value.name)
    commands.push(normalized.value)
    for (const message of normalized.warnings ?? []) warnings.push({ index, name: normalized.value.name, message })
  }
  return { commands, errors, warnings }
}

/* -------------------------------------------------------------------------- */
/* Rendering the returned body                                                */
/* -------------------------------------------------------------------------- */

/**
 * Fill one declared argument into its placeholder text.
 * The value is inserted as plain text: this plugin builds no command line, so
 * nothing here is shell syntax and nothing needs quoting.
 * @param argument - the normalized declaration.
 * @param raw - the model-supplied value, or undefined.
 * @returns the text to substitute.
 * @throws when a required value is missing or a value has the wrong type.
 */
export function renderArgument(argument, raw) {
  const missing = raw === undefined || raw === null
  let value = missing ? argument.default : raw
  if (value === undefined) {
    if (argument.required === true) throw new Error(`argument "${argument.name}" is required`)
    value = argument.type === 'boolean' ? false : ''
  }
  switch (argument.type) {
    case 'boolean': {
      if (typeof value !== 'boolean') throw new Error(`argument "${argument.name}" must be a boolean`)
      return value ? (argument.trueText ?? 'true') : (argument.falseText ?? 'false')
    }
    case 'number': {
      const numeric = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(numeric)) throw new Error(`argument "${argument.name}" must be a number`)
      return String(numeric)
    }
    default: {
      const text = String(value)
      if (argument.choices !== undefined && !argument.choices.includes(text)) {
        throw new Error(`argument "${argument.name}" must be one of ${argument.choices.map((choice) => JSON.stringify(choice)).join(', ')}`)
      }
      return text
    }
  }
}

/**
 * Render the body a call returns.
 * Substitution is single-pass, so a value that itself contains `{{...}}` is
 * data, never a second round of template expansion. Only a placeholder whose
 * name is a declared argument is replaced; every other `{{...}}` is left exactly
 * as written, so the detail may contain any characters. A command with no detail
 * answers with its description.
 * @param command - the normalized definition.
 * @param args - the model-supplied argument object.
 * @returns the text the model receives.
 * @throws when a declared argument cannot be rendered.
 */
export function renderDetail(command, args) {
  if (command.detail === undefined) return command.description
  const input = args !== null && typeof args === 'object' && !Array.isArray(args) ? args : {}
  const rendered = new Map()
  for (const argument of command.args) rendered.set(argument.name, renderArgument(argument, input[argument.name]))
  return command.detail.replace(PLACEHOLDER_PATTERN, (match, token) => rendered.get(token) ?? match)
}

/**
 * Project a command's arguments onto the JSON Schema the model sees.
 * @param command - the normalized definition.
 * @returns the tool's `parameters` schema.
 */
export function buildParameters(command) {
  const properties = {}
  const required = []
  for (const argument of command.args) {
    const property = { type: argument.type }
    if (argument.description !== undefined) property.description = argument.description
    if (argument.choices !== undefined) property.enum = argument.choices
    if (argument.default !== undefined) property.default = argument.default
    properties[argument.name] = property
    if (argument.required === true) required.push(argument.name)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

/* -------------------------------------------------------------------------- */
/* Model-facing tools                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Build the model-facing tool definition for one command.
 * The tool answers with the command's detail, so a long usage text is loaded
 * only when the model actually asks for it.
 * @param command - the normalized command.
 * @returns a `ctx.tools.register` definition.
 */
export function createToolDefinition(command) {
  return {
    name: command.name,
    description: command.description,
    parameters: buildParameters(command),
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    },
    execute(rawArgs, exec) {
      exec?.signal?.throwIfAborted?.()
      return renderDetail(command, rawArgs)
    },
  }
}

/* -------------------------------------------------------------------------- */
/* HTTP routes (the settings page's data plane)                                */
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
 * Host plugin body: load the table, register one tool per command, and expose
 * the fenced routes the settings page uses to read and replace the table.
 * @param ctx - Host context.
 * @param config - the Loader row's config.
 */
export function apply(ctx, config) {
  const resolved = resolveConfig(config)
  const state = { commands: [], errors: [], warnings: [], disposers: [] }

  /**
   * Replace the live tool registrations with the current table.
   * Each command is registered independently: a name already taken by another
   * tool is reported and skipped instead of taking the whole table down.
   */
  const registerAll = () => {
    for (const dispose of state.disposers) {
      try {
        dispose()
      } catch {
        /* an already-disposed registration must not block the rest */
      }
    }
    state.disposers = []
    state.errors = []
    for (const command of state.commands) {
      if (command.enabled === false) continue
      try {
        state.disposers.push(ctx.tools.register(createToolDefinition(command)))
      } catch (error) {
        state.errors.push({ name: command.name, message: String(error?.message ?? error) })
      }
    }
  }

  /**
   * Adopt a validated table: store it, re-register tools, and report.
   * @param list - raw entries from disk or from a request.
   * @returns the accepted commands, every diagnostic, and the advisory warnings.
   */
  const adopt = (list) => {
    const { commands, errors, warnings } = validateList(list)
    state.commands = commands
    registerAll()
    state.errors = [...errors, ...state.errors]
    state.warnings = warnings
    return { commands, errors: state.errors, warnings: state.warnings }
  }

  ctx.effect(() => {
    adopt(readStore(resolved.storePath, (warning) => ctx.logger?.warn?.(`dsh-model-commands: ${warning}`)))
    return () => {
      for (const dispose of state.disposers) {
        try {
          dispose()
        } catch {
          /* teardown is best-effort */
        }
      }
      state.disposers = []
    }
  }, 'dsh-model-commands: model-facing tools')

  // The settings page is optional: in a profile without the browser carrier the
  // tools above still work, and only the editor disappears.
  ctx.inject(['webServer', 'connection'], (routeCtx) => {
    /** Serializes table writes so two quick saves cannot interleave. */
    let tail = Promise.resolve()

    routeCtx.effect(() => routeCtx.webServer.register({
      kind: 'exact',
      path: COMMANDS_PATH,
      handler: async (req, res) => {
        const rejection = routeCtx.connection.requestRejection(req)
        if (rejection !== undefined) {
          res.statusCode = rejection
          res.end()
          return
        }
        if (req.method === 'GET') {
          sendJson(res, 200, { ok: true, storePath: resolved.storePath, commands: state.commands, errors: state.errors, warnings: state.warnings })
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
        if (body === null || typeof body !== 'object' || !Array.isArray(body.commands)) {
          sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'body must be an object with a "commands" array' })
          return
        }
        const write = tail.then(async () => {
          const report = adopt(body.commands)
          await writeStore(resolved.storePath, report.commands)
          return report
        })
        tail = write.then(() => undefined, () => undefined)
        try {
          const report = await write
          ctx.logger?.info?.(`dsh-model-commands: saved ${String(report.commands.length)} command(s)`)
          sendJson(res, 200, { ok: true, storePath: resolved.storePath, commands: report.commands, errors: report.errors, warnings: report.warnings })
        } catch (error) {
          ctx.logger?.warn?.(`dsh-model-commands: save failed: ${String(error?.message ?? error)}`)
          sendJson(res, 500, { ok: false, code: 'save-failed', message: String(error?.message ?? error) })
        }
      },
    }), `dsh-model-commands: GET/POST ${COMMANDS_PATH}`)
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
  normalizeArgument,
  normalizeCommand,
  validateList,
  renderArgument,
  renderDetail,
  buildParameters,
  createToolDefinition,
  COMMANDS_PATH,
}
