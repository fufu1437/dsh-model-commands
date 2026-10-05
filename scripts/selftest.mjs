/**
 * Self-test for `@fufu1437/dsh-model-commands`.
 *
 * The module under test imports only `node:` builtins, so it runs without a
 * Harness: this exercises record validation, the durable table, and the skill
 * provider the registry consumes.
 *
 * Run with `npm test` (or `node scripts/selftest.mjs`) from the package root.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { NAME_PATTERN, PROVIDER_NAME, __test } from '../index.js'

const {
  resolveConfig,
  readStore,
  writeStore,
  normalizeSkill,
  validateList,
  skillSummary,
  skillCandidate,
  createSkillProvider,
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

/** @returns a minimal valid entry. */
function sampleSkill(overrides = {}) {
  return {
    name: 'disk-usage',
    description: 'Report free space for one path with df.',
    content: '# Disk usage\n\nRun `df -h <path>` and read the Avail column.',
    ...overrides,
  }
}

await check('resolveConfig honours DSH_HOME and the row overrides', () => {
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = '/tmp/dmc-home'
  try {
    const resolved = resolveConfig(undefined)
    assert.equal(resolved.storePath, '/tmp/dmc-home/model-commands/skills.json')
    assert.equal(resolved.maxSkills, 200)
    assert.equal(resolveConfig({ storePath: '/tmp/custom.json', maxSkills: 5 }).storePath, '/tmp/custom.json')
    assert.equal(resolveConfig({ maxSkills: 5 }).maxSkills, 5)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
})

await check('normalizeSkill accepts a well-formed entry and fills the defaults', () => {
  const result = normalizeSkill(sampleSkill(), 0)
  assert.equal(result.ok, true)
  assert.equal(result.value.name, 'disk-usage')
  assert.equal(result.value.modelInvocable, true)
  assert.equal(result.value.userInvocable, false)
  assert.equal(result.value.enabled, true)
  assert.equal(result.value.source, 'user')
  assert.equal(typeof result.value.id, 'string')
  assert.match(result.value.updatedAt, /^\d{4}-/)
  assert.deepEqual(result.warnings, [])
})

await check('normalizeSkill preserves an existing id, createdAt, and source', () => {
  const result = normalizeSkill(sampleSkill({ id: 'abc', createdAt: '2026-01-01T00:00:00.000Z', source: 'model' }), 0)
  assert.equal(result.value.id, 'abc')
  assert.equal(result.value.createdAt, '2026-01-01T00:00:00.000Z')
  assert.equal(result.value.source, 'model')
})

await check('the name must be kebab-case', () => {
  assert.equal(NAME_PATTERN.test('disk-usage'), true)
  assert.equal(NAME_PATTERN.test('disk_usage'), false)
  assert.equal(NAME_PATTERN.test('Disk-Usage'), false)
  assert.equal(NAME_PATTERN.test('disk usage'), false)
  for (const name of ['disk_usage', 'Disk-Usage', '-lead', 'trail-', '']) {
    const result = normalizeSkill(sampleSkill({ name }), 0)
    assert.equal(result.ok, false, `${name} should be rejected`)
    assert.match(result.error, /kebab-case/)
  }
})

await check('description and content are required', () => {
  assert.match(normalizeSkill(sampleSkill({ description: '   ' }), 0).error, /description is required/)
  assert.match(normalizeSkill(sampleSkill({ content: '' }), 0).error, /content is required/)
  assert.match(normalizeSkill(sampleSkill({ description: 'x'.repeat(4097) }), 0).error, /description must be at most/)
  assert.match(normalizeSkill(sampleSkill({ content: 'x'.repeat(65_537) }), 0).error, /content must be at most/)
  assert.match(normalizeSkill(sampleSkill({ whenToUse: 'x'.repeat(1025) }), 0).error, /whenToUse must be/)
  assert.match(normalizeSkill('nope', 0).error, /must be an object/)
})

await check('a user-only entry warns that the model cannot see it', () => {
  const result = normalizeSkill(sampleSkill({ userInvocable: true, modelInvocable: false }), 0)
  assert.equal(result.ok, true)
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /only you can invoke it/)
})

await check('validateList keeps valid rows and reports invalid ones', () => {
  const report = validateList([
    sampleSkill(),
    { name: 'bad name', description: 'x', content: 'y' },
    sampleSkill({ name: 'other' }),
    sampleSkill(),
  ])
  assert.deepEqual(report.skills.map((skill) => skill.name), ['disk-usage', 'other'])
  assert.equal(report.errors.length, 2)
  assert.match(report.errors[0].message, /kebab-case/)
  assert.match(report.errors[1].message, /declared twice/)
})

await check('validateList enforces the table ceiling and the array shape', () => {
  assert.match(validateList({}, 5).errors[0].message, /skills must be an array/)
  assert.match(validateList([sampleSkill()], 0).errors[0].message, /at most 0 skills/)
})

await check('the published summary mirrors the skill contract', () => {
  const skill = normalizeSkill(sampleSkill({ whenToUse: 'When df is available.', userInvocable: true }), 0).value
  const summary = skillSummary(skill)
  assert.deepEqual(Object.keys(summary).sort(), ['description', 'invocation', 'name', 'provider', 'source', 'whenToUse'])
  assert.equal(summary.provider, PROVIDER_NAME)
  assert.equal(summary.source, 'runtime')
  assert.deepEqual(summary.invocation, { modelInvocable: true, userInvocable: true })
  const candidate = skillCandidate(skill)
  assert.equal(candidate.locator, skill.id)
  assert.equal(typeof candidate.rank, 'number')
})

await check('the provider lists enabled entries and loads a body by locator', async () => {
  const state = {
    skills: validateList([
      sampleSkill(),
      sampleSkill({ name: 'hidden-one', enabled: false }),
    ]).skills,
  }
  const provider = createSkillProvider(state)
  assert.equal(provider.name, PROVIDER_NAME)
  const listed = await provider.list({})
  assert.equal(listed.complete, true)
  assert.deepEqual(listed.candidates.map((candidate) => candidate.name), ['disk-usage'])
  const loaded = await provider.get(listed.candidates[0], {})
  assert.equal(loaded.name, 'disk-usage')
  assert.match(loaded.content, /df -h/)
  assert.equal((await provider.get({ locator: 'missing' }, {})), undefined)
  const disabled = state.skills.find((skill) => skill.name === 'hidden-one')
  assert.equal((await provider.get({ locator: disabled.id }, {})), undefined)
})

await check('the table round-trips and tolerates a missing file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dmc-selftest-'))
  const storePath = join(directory, 'nested', 'skills.json')
  try {
    assert.deepEqual(readStore(storePath), [])
    const report = validateList([sampleSkill()])
    await writeStore(storePath, report.skills)
    assert.deepEqual(readStore(storePath).map((skill) => skill.name), ['disk-usage'])
    const warnings = []
    assert.deepEqual(readStore(join(directory, 'missing.json'), (text) => warnings.push(text)), [])
    assert.equal(warnings.length, 0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

process.stdout.write(`\n${String(passed)} checks passed\n`)
