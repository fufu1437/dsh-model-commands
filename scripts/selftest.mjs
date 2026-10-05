/**
 * Self-test for `@fufu1437/dsh-model-commands`.
 *
 * The module under test imports only `node:` builtins, so it runs without a
 * Harness: this exercises argument rendering, table validation, the durable
 * store, and the tool definition the Host hands to `ctx.tools`.
 *
 * Run with `npm test` (or `node scripts/selftest.mjs`) from the package root.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ARG_TYPES, __test } from '../index.js'

const {
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
    detail: 'demo --name {{who}} --count {{count}} --verbose={{verbose}}',
    args: [
      { name: 'who', type: 'string', required: true },
      { name: 'count', type: 'number', default: 3 },
      { name: 'verbose', type: 'boolean', trueText: 'yes', falseText: 'no' },
    ],
    ...overrides,
  }
}

await check('the type set has no integer: number covers integral values', () => {
  assert.deepEqual(ARG_TYPES, ['string', 'number', 'boolean'])
})

await check('renderDetail fills strings verbatim, without quoting', () => {
  const text = renderDetail(sampleCommand(), { who: "it's a name with spaces", count: 5, verbose: true })
  assert.equal(text, "demo --name it's a name with spaces --count 5 --verbose=yes")
})

await check('renderDetail validates numbers and booleans', () => {
  assert.throws(() => renderDetail(sampleCommand(), { who: 'x', count: '1; rm -rf /' }), /must be a number/)
  assert.throws(() => renderDetail(sampleCommand(), { who: 'x', verbose: 'yes' }), /must be a boolean/)
})

await check('renderDetail rejects a missing required argument', () => {
  assert.throws(() => renderDetail(sampleCommand(), {}), /"who" is required/)
})

await check('renderDetail enforces string choices', () => {
  const command = sampleCommand({
    detail: 'demo {{mode}}',
    args: [{ name: 'mode', type: 'string', choices: ['fast', 'slow'] }],
  })
  assert.equal(renderDetail(command, { mode: 'fast' }), 'demo fast')
  assert.throws(() => renderDetail(command, { mode: 'other' }), /must be one of/)
})

await check('renderDetail is single-pass: a value never expands a placeholder', () => {
  const command = sampleCommand({ detail: 'demo {{who}}', args: [{ name: 'who', type: 'string' }] })
  assert.equal(renderDetail(command, { who: '{{who}}' }), 'demo {{who}}')
})

await check('a command without a detail answers with its description', () => {
  const command = normalizeCommand({
    name: 'lookup',
    description: 'A demo command.',
    args: [{ name: 'topic', type: 'string' }],
  }, 0)
  assert.equal(command.ok, true)
  assert.equal(command.value.detail, undefined)
  assert.equal(renderDetail(command.value, { topic: 'anything' }), 'A demo command.')
})

await check('normalizeCommand accepts a detail-only command', () => {
  const result = normalizeCommand(sampleCommand(), 0)
  assert.equal(result.ok, true)
  assert.equal(result.value.args.length, 3)
  assert.equal(result.value.description, 'A demo command.')
})

await check('normalizeCommand accepts an argument-only command', () => {
  const result = normalizeCommand({
    name: 'lookup',
    description: 'Look something up.',
    args: [{ name: 'topic', type: 'string', required: true, description: 'What to look up.' }],
  }, 0)
  assert.equal(result.ok, true)
  assert.equal(result.value.detail, undefined)
  assert.equal(result.value.args.length, 1)
})

await check('normalizeCommand rejects a command with neither a detail nor an argument', () => {
  const result = normalizeCommand({ name: 'empty', description: 'Nothing here.' }, 0)
  assert.equal(result.ok, false)
  assert.match(result.error, /needs a detail \(描述\) or at least one argument/)
})

await check('normalizeCommand migrates the pre-0.2.0 command field into detail', () => {
  const result = normalizeCommand({
    name: 'legacy',
    description: 'Written before 0.2.0.',
    command: 'legacy --help',
  }, 0)
  assert.equal(result.ok, true)
  assert.equal(result.value.detail, 'legacy --help')
  assert.equal(result.value.command, undefined)
})

await check('normalizeCommand rejects undeclared placeholders and unused arguments', () => {
  assert.match(normalizeCommand(sampleCommand({ detail: 'demo {{missing}}' }), 0).error, /undeclared placeholder/)
  assert.match(normalizeCommand(sampleCommand({ detail: 'demo' }), 0).error, /never used/)
})

await check('normalizeCommand rejects bad names, a missing description, and a bad type', () => {
  assert.match(normalizeCommand(sampleCommand({ name: '2bad' }), 0).error, /name must match/)
  assert.match(normalizeCommand(sampleCommand({ description: '   ' }), 0).error, /description is required/)
  assert.match(normalizeCommand(sampleCommand({ args: [{ name: 'x', type: 'integer' }], detail: 'demo {{x}}' }), 0).error, /type must be one of/)
})

await check('normalizeArgument keeps schema-only fields out of the wire shape', () => {
  const argument = normalizeArgument({ name: 'mode', type: 'string', choices: ['a'], default: 'a' }, 0)
  assert.equal(argument.ok, true)
  assert.deepEqual(argument.value, { name: 'mode', type: 'string', choices: ['a'], default: 'a' })
})

await check('validateList keeps valid rows and reports invalid ones', () => {
  const report = validateList([
    sampleCommand(),
    { name: 'bad', description: 'no detail and no args' },
    sampleCommand({ name: 'demo2', detail: 'demo2', args: [] }),
    sampleCommand(),
  ])
  assert.deepEqual(report.commands.map((command) => command.name), ['demo', 'demo2'])
  assert.equal(report.errors.length, 2)
  assert.match(report.errors[0].message, /needs a detail/)
  assert.match(report.errors[1].message, /declared twice/)
})

await check('buildParameters projects the declared arguments', () => {
  const parameters = buildParameters(normalizeCommand(sampleCommand(), 0).value)
  assert.deepEqual(parameters.required, ['who'])
  assert.deepEqual(Object.keys(parameters.properties), ['who', 'count', 'verbose'])
  assert.equal(parameters.properties.count.type, 'number')
  assert.equal(parameters.properties.count.default, 3)
  assert.equal(parameters.additionalProperties, false)
})

await check('resolveConfig honours DSH_HOME', () => {
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = '/tmp/dmc-home'
  try {
    assert.equal(resolveConfig(undefined).storePath, '/tmp/dmc-home/model-commands/commands.json')
    assert.equal(resolveConfig({ storePath: '/tmp/custom.json' }).storePath, '/tmp/custom.json')
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
})

await check('the store round-trips and tolerates a missing file', async () => {
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

await check('createToolDefinition returns the rendered detail', async () => {
  const tool = createToolDefinition(normalizeCommand(sampleCommand(), 0).value)
  const value = await tool.execute({ who: 'world' }, {})
  assert.equal(tool.name, 'demo')
  assert.equal(tool.description, 'A demo command.')
  assert.equal(value, 'demo --name world --count 3 --verbose=no')
  assert.deepEqual(tool.output.render(undefined, value), [{ type: 'text', text: value }])
  assert.deepEqual(tool.parameters.required, ['who'])
})

process.stdout.write(`\n${String(passed)} checks passed\n`)
