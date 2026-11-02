import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, TOOL_ROOT } from '../tools/truth-source.mjs';
import { inventory, readTestReports, verifyGeneratedSurface } from '../tools/qualify-domain.mjs';

const { preflightPaths } = await import(pathToFileURL(join(TOOL_ROOT, 'src/core/apply-preflight.mjs')).href);
function fixture(run) {
  const base = join(ROOT, '.scratch');
  preflightPaths(base, ['domain-runner-check']);
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'domain-runner-'));
  try { return run(root); } finally { rmSync(root, { recursive: true }); }
}
function xml(root, attributes = 'name="fixture.DomainSpec" tests="1" failures="0" errors="0" skipped="0"', body = '<testcase name="generated command"/>') {
  const directory = join(root, 'target/test-reports');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'TEST-domain.xml'), `<testsuite ${attributes}>${body}</testsuite>`);
}

test('qualification report uses actual suite/testcase counts and file fingerprints', () => fixture((root) => {
  xml(root);
  const report = readTestReports(root);
  assert.equal(report.passed, 1);
  assert.equal(report.failed, 0);
  assert.equal(report.skipped, 0);
  assert.match(report.suites[0].sha256, /^[a-f0-9]{64}$/);
}));

test('no Scala reports cannot qualify persistent execution', () => fixture((root) => {
  assert.throws(() => readTestReports(root), /No Scala test reports/);
}));

for (const [name, attributes, body, error] of [
  ['failed', 'name="x" tests="1" failures="1" errors="0"', '<testcase><failure/></testcase>', /did not pass/],
  ['skipped', 'name="x" tests="1" failures="0" errors="0" skipped="1"', '<testcase><skipped/></testcase>', /did not pass/],
  ['dishonest zero failure count', 'name="x" tests="1" failures="0" errors="0"', '<testcase><error>broken</error></testcase>', /did not pass/],
  ['missing count', 'name="x" tests="1" failures="0"', '<testcase/>', /invalid errors/],
  ['count mismatch', 'name="x" tests="2" failures="0" errors="0"', '<testcase/>', /count mismatch/],
  ['zero required tests', 'name="x" tests="0" failures="0" errors="0"', '', /did not pass/],
]) test(`qualification rejects ${name} Scala evidence`, () => fixture((root) => {
  xml(root, attributes, body);
  assert.throws(() => readTestReports(root), error);
}));

function generatedFixture(root, { guards = '// RULE-1\n      if (!(p.txid.nonEmpty)) err("1", "bad")', fold = 'status = "DONE"', fields = 'txid: String' } = {}) {
  const base = join(root, 'generated/main/scala/fixture/wealth/qualification/domain');
  mkdirSync(join(base, 'invariant/params'), { recursive: true });
  mkdirSync(join(base, 'entities/behaviors'), { recursive: true });
  writeFileSync(join(base, 'invariant/FundOrderRules.scala'), `  object RecordRule extends InvariantRule {\n    def apply = {\n      ${guards}\n      else Right(List(Recorded(p.txid)))\n    }\n  }`);
  writeFileSync(join(base, 'invariant/params/FundOrderRuleParams.scala'), `final case class RecordParams(${fields})`);
  writeFileSync(join(base, 'entities/behaviors/FundOrderEventHandler.scala'), `    case event: Recorded =>\n      state.copy(${fold})\n`);
  return { invariant: { rules: [{ commandName: 'Record', guards: [{ ref: 'RULE-1', cond: 'p.txid.nonEmpty' }], produces: ['Recorded'] }], paramDefs: { Record: { fields: [{ name: 'txid', type: 'String' }] } } }, aggregate: { events: [{ name: 'Recorded', fields: [{ name: 'txid', dataType: 'String' }], bindings: [{ slot: 'txid', expr: 'param.txid' }], foldAssignments: [{ slot: 'status', expr: 'literal:DONE' }] }] } };
}

test('generated surface checks actual guard, parameter, constructor and full fold expressions', () => fixture((root) => {
  assert.equal(verifyGeneratedSurface(generatedFixture(root), root).foldAssignmentSets, true);
}));

for (const [name, change, error] of [
  ['extra short-circuit', { guards: '// RULE-1\n      if (!(p.txid.nonEmpty)) err("1", "bad")\n      else if (true) Right(Nil)' }, /Extra\/omitted/],
  ['changed fold outcome', { fold: 'status = "FAILED"' }, /fold assignment/],
  ['additional erasing fold', { fold: 'status = "DONE", committedSubscriptions = Map.empty' }, /fold assignment/],
  ['missing authored guard', { guards: 'if (!(p.txid.nonEmpty)) err("1", "bad")' }, /generated guard/],
  ['changed parameter type', { fields: 'txid: Long' }, /parameter order\/type/],
]) test(`generated qualification rejects ${name}`, () => fixture((root) => {
  assert.throws(() => verifyGeneratedSurface(generatedFixture(root, change), root), error);
}));


test('qualification inventory refuses symlinked artifacts instead of hashing referenced files', () => fixture((root) => {
  writeFileSync(join(root, 'actual'), 'content');
  symlinkSync(join(root, 'actual'), join(root, 'alias'));
  assert.throws(() => inventory(root), /Non-regular qualification input/);
}));
