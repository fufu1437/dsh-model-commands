/**
 * Self-test for `@fufu1437/dsh-model-commands`.
 *
 * The module under test imports only `node:` builtins, so it runs without a
 * Harness: this exercises argument rendering, shell quoting, table validation,
 * the durable store, and the tool definition the Host hands to `ctx.tools`.
 *
 * Run with `pnpm test` (or `node scripts/selftest.mjs`) from the package root.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { __test } from '../index.js'

const {
  quoteShell,
  renderCommand,
  validateList,
  normalizeCommand,
  buildParameters,
  resolveConfig,
  readStore,
  writeStore,
  formatRunResult,
  createToolDefinition,
} = __test

let passed = 0

/**
 * Run one named check.
 * @param label - the check's name.
 * @param body - the assertion body.
 */
async function check(label, body) {
  await body()
  passed += 1
  process.stdout.write(`ok ${String(passed)} - ${label}\n`)
}

/** @returns a minimal valid command for the rendering tests. */
function sampleCommand(overrides = {}) {
  return {
    name: 'demo',
    description: 'A demo command.',
    command: 'demo --name {{who}} --count {{count}} --verbose={{verbose}}',
    args: [
      { name: 'who', type: 'string', required: true },
      { name: 'count', type: 'integer', default: 3 },
      { name: 'verbose', type: 'boolean', trueText: 'yes', falseText: 'no' },
    ],
    ...overrides,
  }
}

await check('quoteShell keeps one word and escapes quotes', () => {
  assert.equal(quoteShell('hello world'), "'hello world'")
  assert.equal(quoteShell("it's"), "'it'\\''s'")
})

await check('renderCommand quotes strings and validates numbers', () => {
  const line = renderCommand(sampleCommand(), { who: 'a b', count: 5, verbose: true })
  assert.equal(line, "demo --name 'a b' --count 5 --verbose=yes")
})

await check('renderCommand makes a hostile string a single inert word', () => {
  const line = renderCommand(sampleCommand(), { who: "'; rm -rf / #" })
  assert.equal(line, "demo --name ''\\''; rm -rf / #' --count 3 --verbose=no")
})

await check('renderCommand rejects a non-numeric number argument', () => {
  assert.throws(() => renderCommand(sampleCommand(), { who: 'x', count: '1; rm -rf /' }), /must be an integer/)
})

await check('renderCommand rejects a missing required argument', () => {
  assert.throws(() => renderCommand(sampleCommand(), {}), /"who" is required/)
})

await check('renderCommand enforces string choices', () => {
  const command = sampleCommand({
    command: 'demo {{mode}}',
    args: [{ name: 'mode', type: 'string', choices: ['fast', 'slow'] }],
  })
  assert.equal(renderCommand(command, { mode: 'fast' }), "demo 'fast'")
  assert.throws(() => renderCommand(command, { mode: 'other' }), /must be one of/)
})

await check('renderCommand is single-pass: a value never expands a placeholder', () => {
  const command = sampleCommand({
    command: 'demo {{who}}',
    args: [{ name: 'who', type: 'string' }],
  })
  assert.equal(renderCommand(command, { who: '{{who}}' }), "demo '{{who}}'")
})

await check('normalizeCommand accepts a well-formed command', () => {
  const result = normalizeCommand(sampleCommand(), 0)
  assert.equal(result.ok, true)
  assert.equal(result.value.args.length, 3)
  assert.equal(result.value.description, 'A demo command.')
})

await check('normalizeCommand rejects an undeclared placeholder', () => {
  const result = normalizeCommand(sampleCommand({ command: 'demo {{missing}}' }), 0)
  assert.equal(result.ok, false)
  assert.match(result.error, /undeclared placeholder/)
})

await check('normalizeCommand rejects an unused argument and a bad name', () => {
  assert.match(normalizeCommand(sampleCommand({ command: 'demo' }), 0).error, /never used/)
  assert.match(normalizeCommand(sampleCommand({ name: '2bad' }), 0).error, /name must match/)
})

await check('validateList keeps valid rows and reports invalid ones', () => {
  const report = validateList([
    sampleCommand(),
    { name: 'bad', description: 'no command' },
    sampleCommand({ name: 'demo2', command: 'demo2', args: [] }),
    sampleCommand(),
  ])
  assert.deepEqual(report.commands.map((command) => command.name), ['demo', 'demo2'])
  assert.equal(report.errors.length, 2)
  assert.match(report.errors[0].message, /command is required/)
  assert.match(report.errors[1].message, /declared twice/)
})

await check('buildParameters projects the declared arguments', () => {
  const parameters = buildParameters(sampleCommand())
  assert.deepEqual(parameters.required, ['who'])
  assert.deepEqual(Object.keys(parameters.properties), ['who', 'count', 'verbose'])
  assert.equal(parameters.properties.count.type, 'integer')
  assert.equal(parameters.properties.count.default, 3)
  assert.equal(parameters.additionalProperties, false)
})

await check('resolveConfig honours DSH_HOME and clamps the timeout', () => {
  const previousHome = process.env.DSH_HOME
  const previousTimeout = process.env.DSH_TIMEOUT
  void previousTimeout
  process.env.DSH_HOME = '/tmp/dmc-home'
  try {
    const resolved = resolveConfig({ timeoutMs: 999_999_999 })
    assert.equal(resolved.storePath, '/tmp/dmc-home/model-commands/commands.json')
    assert.equal(resolved.timeoutMs, 3_600_000)
    assert.equal(resolveConfig(undefined).dshHome, '/tmp/dmc-home')
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
})

await check('the store round-trips and tolerates a corrupt file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dmc-selftest-'))
  const storePath = join(directory, 'nested', 'commands.json')
  try {
    assert.deepEqual(readStore(storePath), [])
    const report = validateList([sampleCommand()])
    await writeStore(storePath, report.commands)
    assert.deepEqual(readStore(storePath).map((command) => command.name), ['demo'])
    const warnings = []
    assert.deepEqual(readStore(join(directory, 'missing.json'), (text) => warnings.push(text)), [])
    assert.equal(warnings.length, 0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

await check('formatRunResult reports exit code, streams, and truncation', () => {
  const text = formatRunResult('demo', {
    exitCode: 2,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 1000,
    stdout: { text: 'out\n', truncated: true, spillPath: '/tmp/spill' },
    stderr: { text: '', truncated: false },
  })
  assert.match(text, /^\$ demo\nexit code: 2/)
  assert.match(text, /--- stdout ---\nout/)
  assert.match(text, /\(empty\)/)
  assert.match(text, /stdout was truncated; full output: \/tmp\/spill/)
})

await check('createToolDefinition wires the tool onto the composed shell', async () => {
  const calls = []
  const runtime = {
    timeoutMs: 1000,
    defaultCwd: undefined,
    sandboxPolicy: () => undefined,
    shell: {
      resolve: (request) => ({ ...request, workdir: request.workdir ?? '/workspace' }),
      execute: async (spec) => {
        calls.push(spec)
        return {
          result: async () => ({
            exitCode: 0,
            signal: null,
            timedOut: false,
            aborted: false,
            timeoutMs: spec.timeoutMs,
            stdout: { text: 'done\n', truncated: false },
            stderr: { text: '', truncated: false },
          }),
        }
      },
    },
  }
  const tool = createToolDefinition(normalizeCommand(sampleCommand(), 0).value, runtime)
  const value = await tool.execute({ who: 'world' }, { agent: { session: { header: { cwd: '/workspace' } } }, signal: undefined })
  assert.equal(tool.name, 'demo')
  assert.match(value, /^\$ demo --name 'world' --count 3 --verbose=no/)
  assert.match(value, /done/)
  assert.equal(calls[0].command, "demo --name 'world' --count 3 --verbose=no")
  assert.equal(calls[0].timeoutMs, 1000)
  assert.deepEqual(tool.output.render(undefined, value), [{ type: 'text', text: value }])
})

process.stdout.write(`\n${String(passed)} checks passed\n`)
