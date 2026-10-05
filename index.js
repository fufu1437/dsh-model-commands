/**
 * Host half of `@fufu1437/dsh-model-commands`.
 *
 * One idea: **the user declares a command once, and the model can call it.**
 * Every entry in the plugin's command table becomes a first-class model-facing
 * tool — the same surface as `bash`, `read`, or `edit` — so the model invokes
 * it directly instead of writing a shell script around it.
 *
 * The command table lives in a JSON file under the Harness home
 * (`<DSH_HOME>/model-commands/commands.json`). The browser half of this plugin
 * renders that table as a page in **Settings → Model commands**; the two
 * fenced HTTP routes below are the only way it is read and replaced:
 *
 * - `GET  /dsh-model-commands/commands` returns the stored table;
 * - `POST /dsh-model-commands/commands` replaces it, then re-registers the
 *   model-facing tools in the same step.
 *
 * A command definition carries the model-facing metadata (tool name,
 * description, arguments) and the command line to run. The command line is a
 * template: each `{{arg}}` placeholder is filled from the call's arguments.
 * Each argument is shell-quoted according to its declared type before it is
 * substituted — a model-supplied string can never escape its argument, a
 * `number`/`integer` argument must parse as a number, and a `boolean`
 * argument substitutes only the author-declared `trueText` / `falseText`.
 *
 * Commands run through the composed `ctx.shell` executor, so they inherit the
 * deployment's shell (local or sandboxed) and the calling session's sandbox
 * policy, working directory, and cancellation. Exit codes are results, not
 * failures: the tool returns the exit code plus stdout/stderr exactly as the
 * executor collected them.
 *
 * The module imports nothing outside `node:` builtins, so the published
 * package carries no dependency on unpublished `@deepseek-ai/*` packages and
 * no configuration schema is required for it to work.
 *
 * @module @fufu1437/dsh-model-commands
 */

import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

/** Cordis plugin (function-plugin) name. */
export const name = 'dsh-model-commands'

/** The composed services this plugin cannot work without. */
export const inject = ['tools', 'shell']

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

/** The argument types a command may declare. */
export const ARG_TYPES = ['string', 'number', 'integer', 'boolean']

/** `{{name}}` inside a command template. */
const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

/** Default per-command deadline when neither the command nor the config sets one. */
const DEFAULT_TIMEOUT_MS = 60_000

/** Hard ceiling on a per-command deadline, so the model cannot hang a turn. */
const MAX_TIMEOUT_MS = 3_600_000

/** Where the table lives when the config does not say. */
const DEFAULT_STORE_DIRNAME = 'model-commands'
const DEFAULT_STORE_FILENAME = 'commands.json'

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the Loader row's config into the values this plugin uses.
 * Every field is optional and every field is clamped, so a hand-written
 * `cordis.patch.yml` row can never produce an unusable plugin.
 * @param config - the Loader row's raw config.
 * @returns the resolved configuration.
 */
export function resolveConfig(config) {
  const raw = config !== null && typeof config === 'object' && !Array.isArray(config) ? config : {}
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const storePath = typeof raw.storePath === 'string' && raw.storePath.length > 0
    ? raw.storePath
    : join(dshHome, DEFAULT_STORE_DIRNAME, DEFAULT_STORE_FILENAME)
  const defaultCwd = typeof raw.defaultCwd === 'string' && raw.defaultCwd.length > 0
    ? raw.defaultCwd
    : undefined
  const timeoutMs = Number.isFinite(raw.timeoutMs) && raw.timeoutMs > 0
    ? Math.min(Math.floor(raw.timeoutMs), MAX_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS
  return { dshHome, storePath, defaultCwd, timeoutMs }
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
  if (!isFilledString(raw.command)) {
    return { ok: false, error: `${label}: command is required — it is the shell line this command runs` }
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
  const placeholders = new Set()
  for (const match of raw.command.matchAll(PLACEHOLDER_PATTERN)) placeholders.add(match[1])
  const undeclared = [...placeholders].filter((token) => !seen.has(token))
  if (undeclared.length > 0) {
    return { ok: false, error: `${label}: command uses undeclared placeholder(s) ${undeclared.map((token) => `{{${token}}}`).join(', ')}` }
  }
  for (const token of seen) {
    if (!placeholders.has(token)) {
      return { ok: false, error: `${label}: argument "${token}" is declared but never used in the command line` }
    }
  }
  if (raw.timeoutMs !== undefined && (!Number.isFinite(raw.timeoutMs) || raw.timeoutMs <= 0)) {
    return { ok: false, error: `${label}: timeoutMs must be a positive number` }
  }
  if (raw.cwd !== undefined && (typeof raw.cwd !== 'string' || raw.cwd.length === 0)) {
    return { ok: false, error: `${label}: cwd must be a non-empty string` }
  }
  return {
    ok: true,
    value: {
      name: raw.name,
      description: raw.description.trim(),
      command: raw.command,
      args,
      ...(isFilledString(raw.title) ? { title: raw.title.trim() } : {}),
      ...(typeof raw.cwd === 'string' && raw.cwd.length > 0 ? { cwd: raw.cwd } : {}),
      ...(raw.timeoutMs !== undefined ? { timeoutMs: Math.min(Math.floor(raw.timeoutMs), MAX_TIMEOUT_MS) } : {}),
      ...(raw.enabled === false ? { enabled: false } : {}),
    },
  }
}

/**
 * Normalize a whole table, keeping the valid entries and reporting the rest.
 * One bad row must not cost the user every other command.
 * @param list - the raw entries.
 * @returns normalized commands plus one diagnostic per rejected entry.
 */
export function validateList(list) {
  const commands = []
  const errors = []
  const names = new Set()
  if (!Array.isArray(list)) return { commands, errors: [{ message: 'commands must be an array' }] }
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
  }
  return { commands, errors }
}

/* -------------------------------------------------------------------------- */
/* Rendering a command line                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Quote one value for a POSIX shell word.
 * Single quotes preserve every byte except the quote itself, which is closed,
 * escaped, and reopened — so the result is always exactly one word.
 * @param value - the value to quote.
 * @returns the quoted word.
 */
export function quoteShell(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

/**
 * Fill one declared argument into its placeholder text.
 * @param argument - the normalized declaration.
 * @param raw - the model-supplied value, or undefined.
 * @returns the shell text to substitute.
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
    case 'integer': {
      const numeric = typeof value === 'number' ? value : Number(value)
      if (!Number.isInteger(numeric)) throw new Error(`argument "${argument.name}" must be an integer`)
      return String(numeric)
    }
    default: {
      const text = String(value)
      if (argument.choices !== undefined && !argument.choices.includes(text)) {
        throw new Error(`argument "${argument.name}" must be one of ${argument.choices.map((choice) => JSON.stringify(choice)).join(', ')}`)
      }
      return quoteShell(text)
    }
  }
}

/**
 * Render a command's shell line by substituting every `{{arg}}` placeholder.
 * Substitution is single-pass, so a value that itself contains `{{...}}` is
 * data, never a second round of template expansion.
 * @param command - the normalized definition.
 * @param args - the model-supplied argument object.
 * @returns the shell line to execute.
 * @throws when a declared argument cannot be rendered.
 */
export function renderCommand(command, args) {
  const input = args !== null && typeof args === 'object' && !Array.isArray(args) ? args : {}
  const rendered = new Map()
  for (const argument of command.args) rendered.set(argument.name, renderArgument(argument, input[argument.name]))
  return command.command.replace(PLACEHOLDER_PATTERN, (_match, token) => {
    const text = rendered.get(token)
    if (text === undefined) throw new Error(`command uses undeclared placeholder {{${token}}}`)
    return text
  })
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

/**
 * Format one finished shell run as the text the model reads.
 * @param commandLine - the line that ran.
 * @param result - the executor's run result.
 * @returns the tool result text.
 */
export function formatRunResult(commandLine, result) {
  const lines = [`$ ${commandLine}`]
  lines.push(`exit code: ${result.exitCode === null ? `none (signal ${String(result.signal ?? 'unknown')})` : String(result.exitCode)}`)
  if (result.timedOut) lines.push(`timed out after ${String(result.timeoutMs)}ms`)
  if (result.aborted) lines.push('cancelled')
  if (result.sandbox?.denied === true) lines.push('the sandbox denied this command')
  const stdout = result.stdout?.text ?? ''
  const stderr = result.stderr?.text ?? ''
  lines.push('', '--- stdout ---', stdout.length > 0 ? stdout.replace(/\n$/, '') : '(empty)')
  lines.push('', '--- stderr ---', stderr.length > 0 ? stderr.replace(/\n$/, '') : '(empty)')
  if (result.stdout?.truncated === true) lines.push('', `stdout was truncated; full output: ${String(result.stdout.spillPath ?? 'unavailable')}`)
  if (result.stderr?.truncated === true) lines.push('', `stderr was truncated; full output: ${String(result.stderr.spillPath ?? 'unavailable')}`)
  return lines.join('\n')
}

/* -------------------------------------------------------------------------- */
/* Model-facing tools                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Build the model-facing tool definition for one command.
 * @param command - the normalized command.
 * @param runtime - executor, budgets, and the calling session's policy.
 * @returns a `ctx.tools.register` definition.
 */
export function createToolDefinition(command, runtime) {
  return {
    name: command.name,
    description: command.description,
    parameters: buildParameters(command),
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    },
    async execute(rawArgs, exec) {
      const commandLine = renderCommand(command, rawArgs)
      const policy = runtime.sandboxPolicy(exec)
      const workdir = resolveWorkdir(command.cwd, exec, runtime.defaultCwd, policy)
      const execution = await runtime.shell.execute(runtime.shell.resolve({
        command: commandLine,
        ...(workdir === undefined ? {} : { workdir }),
        timeoutMs: command.timeoutMs ?? runtime.timeoutMs,
        onExpiry: 'kill',
        signal: exec.signal,
        ...(policy === undefined ? {} : { sandboxPolicy: policy }),
      }))
      const result = await execution.result()
      return formatRunResult(commandLine, result)
    },
  }
}

/**
 * Resolve the directory a command runs in.
 * An absolute `cwd` wins; a relative one is resolved against the calling
 * session's workspace, which is also the default when the command declares
 * none. The sandbox policy's workspace root wins over the session header,
 * exactly as the shipped `bash` tool resolves it, so an absolute `cwd`
 * outside the sandbox is still policed by the executor.
 * @param configured - the command's declared `cwd`, if any.
 * @param exec - the tool run context.
 * @param fallback - the plugin's configured default directory, if any.
 * @param policy - the resolved sandbox policy, if any.
 * @returns the working directory, or undefined to let the executor default.
 */
function resolveWorkdir(configured, exec, fallback, policy) {
  const sessionCwd = exec?.agent?.session?.header?.cwd
  const base = policy?.workspaceRoot ?? (typeof sessionCwd === 'string' && sessionCwd.length > 0 ? sessionCwd : undefined) ?? fallback
  if (configured === undefined) return base
  if (isAbsolute(configured)) return configured
  return base === undefined ? configured : join(base, configured)
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
  const state = { commands: [], errors: [], disposers: [] }

  const runtime = {
    shell: ctx.shell,
    timeoutMs: resolved.timeoutMs,
    defaultCwd: resolved.defaultCwd,
    sandboxPolicy(exec) {
      const service = ctx.get('sandboxPolicy')
      if (service === undefined) return undefined
      try {
        return service.resolve(exec?.agent === undefined ? {} : { session: exec.agent.session })
      } catch {
        return undefined
      }
    },
  }

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
        state.disposers.push(ctx.tools.register(createToolDefinition(command, runtime)))
      } catch (error) {
        state.errors.push({ name: command.name, message: String(error?.message ?? error) })
      }
    }
  }

  /**
   * Adopt a validated table: store it, re-register tools, and report.
   * @param list - raw entries from disk or from a request.
   * @returns the accepted commands and every diagnostic.
   */
  const adopt = (list) => {
    const { commands, errors } = validateList(list)
    state.commands = commands
    registerAll()
    state.errors = [...errors, ...state.errors]
    return { commands, errors: state.errors }
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
          sendJson(res, 200, { ok: true, storePath: resolved.storePath, commands: state.commands, errors: state.errors })
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
          sendJson(res, 200, { ok: true, storePath: resolved.storePath, commands: report.commands, errors: report.errors })
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
  quoteShell,
  renderArgument,
  renderCommand,
  buildParameters,
  formatRunResult,
  createToolDefinition,
  COMMANDS_PATH,
}
