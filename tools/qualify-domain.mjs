import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, TOOL_ROOT, assertSnapshotStable, filesUnder, loadBindings, loadSnapshot, protectionReport, sha256, sourceGates } from './truth-source.mjs';
import { validateArtifacts, validateDeclarations } from './artifacts.mjs';
import { validateCashContract } from './cash-contract.mjs';

const EMITTERS = ['aggregate-dsl', 'invariant-dsl', 'command-dsl', 'valueobject-dsl'];
const TEMPLATE = join(ROOT, 'qualification/fund-order-cash');
const RUNS = join(ROOT, '.scratch/domain-qualification');
const DEFAULT_JAVA = '/Library/Java/JavaVirtualMachines/adoptopenjdk-11.jdk/Contents/Home';
const DEFAULT_CACHE = '/Users/zhongdj/Library/Caches/Coursier/v1/https/repo1.maven.org/maven2';
const DEFAULT_BOOT = '/Users/zhongdj/.sbt/boot';
const preflightFile = join(TOOL_ROOT, 'src/core/apply-preflight.mjs');
const loadedPreflight = closure([preflightFile]);
const { preflightPaths } = await import(pathToFileURL(preflightFile).href);
if (JSON.stringify(closure([preflightFile])) !== JSON.stringify(loadedPreflight)) throw new Error('Preflight dependency changed during import.');

export function inventory(directory) {
  return filesUnder(directory).map((file) => {
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error(`Non-regular qualification input: ${file}`);
    return { file: relative(directory, file), sha256: sha256(readFileSync(file)) };
  });
}

function closure(entries) {
  const visited = new Set();
  const visit = (file) => {
    if (visited.has(file)) return;
    if (!file.startsWith(`${TOOL_ROOT}/`)) throw new Error(`Emitter dependency outside truthsrc: ${file}`);
    visited.add(file);
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) visit(resolve(dirname(file), match[1]));
  };
  entries.forEach(visit);
  return [...visited].sort().map((file) => ({ file: relative(TOOL_ROOT, file), sha256: sha256(readFileSync(file)) }));
}

export function generationFingerprint() {
  if (JSON.stringify(closure([preflightFile])) !== JSON.stringify(loadedPreflight)) throw new Error('Preflight sources changed since module load.');
  const sources = closure([...EMITTERS.map((name) => join(TOOL_ROOT, `generators/${name}/emit.mjs`)), preflightFile]);
  const local = ['tools/domain-spec.mjs', 'tools/qualify-domain.mjs'].map((file) => ({ file, sha256: sha256(readFileSync(join(ROOT, file))) }));
  const templates = inventory(TEMPLATE);
  return { sha256: sha256(JSON.stringify({ sources, local, templates })), sources, local, templates };
}

function stable(snapshot, fingerprint) {
  assertSnapshotStable(snapshot);
  if (generationFingerprint().sha256 !== fingerprint.sha256) throw new Error('Generation inputs changed during qualification; no successful receipt.');
  if (!protectionReport().ok) throw new Error('Protected source/coordination file changed during qualification.');
}

function writeOwned(root, path, content) {
  const { root: checkedRoot, targets } = preflightPaths(root, [path]);
  if (checkedRoot !== resolve(root)) throw new Error(`Aliased qualification output root: ${root}`);
  const file = targets.get(path);
  if (existsSync(file)) throw new Error(`Refusing existing qualification output: ${file}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, { flag: 'wx' });
  return file;
}

function command(root, label, executable, args, { cwd = root, env = process.env, timeout = 600000 } = {}) {
  const result = spawnSync(executable, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
  const log = writeOwned(root, `logs/${label}.log`, `${result.stdout || ''}${result.stderr || ''}`);
  const record = { label, executable, args, cwd, exitCode: result.status, signal: result.signal, log: relative(root, log) };
  if (result.error) record.error = result.error.message;
  writeOwned(root, `logs/${label}.json`, `${JSON.stringify(record, null, 2)}\n`);
  if (result.error || result.status !== 0) throw new Error(`${label} failed (${result.status ?? result.error?.code}); evidence: ${log}`);
  return { record, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function generatedRuleBody(text, name) {
  const marker = `object ${name}Rule extends`;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`Missing generated rule object: ${name}`);
  const end = text.indexOf('\n  }', start + marker.length);
  if (end < 0) throw new Error(`Unclosed generated rule object: ${name}`);
  return text.slice(start, end + 4);
}

export function verifyGeneratedSurface(specs, target) {
  const base = join(target, 'generated/main/scala/fixture/wealth/qualification');
  const protocol = readFileSync(join(base, 'application/aggregates/FundOrderProtocol.scala'), 'utf8');
  const entity = readFileSync(join(base, 'domain/entities/FundOrderEntity.scala'), 'utf8');
  const rules = readFileSync(join(base, 'domain/invariant/FundOrderRules.scala'), 'utf8');
  const handler = readFileSync(join(base, 'domain/entities/behaviors/FundOrderEventHandler.scala'), 'utf8');
  const parameters = readFileSync(join(base, 'domain/invariant/params/FundOrderRuleParams.scala'), 'utf8');
  const fields = (rows) => rows.map((field) => `${field.name}: ${field.optional ? `Option[${field.dataType}] = None` : field.dataType}`).join(', ');
  if (!entity.includes(`case class FundOrderState(${fields(specs.aggregate.stateFields)})`)) throw new Error('Generated full-state field order/type changed.');
  for (const event of specs.aggregate.events) if (!entity.includes(`case class ${event.name}(${fields(event.fields)}) extends FundOrderEvent`)) throw new Error(`Generated event payload changed: ${event.name}`);
  for (const cmd of specs.aggregate.commands) {
    const reply = (specs.aggregate.queryCommands || []).includes(cmd.name) ? 'GetFundOrderStateReply' : 'FundOrderReply';
    const data = fields(cmd.fields);
    const signature = `case class ${cmd.name}(${data ? `${data}, ` : ''}replyTo: ActorRef[${reply}])`;
    if (!protocol.includes(signature)) throw new Error(`Generated command parameter order/type/reply changed: ${cmd.name}`);
  }
  for (const rule of specs.invariant.rules) {
    const name = rule.commandName || rule.command || rule.name;
    const body = generatedRuleBody(rules, name);
    let cursor = 0;
    for (const guard of rule.guards) {
      const id = guard.ref;
      const marker = `// ${id}`;
      const index = body.indexOf(marker, cursor);
      if (index < cursor || body.indexOf(marker, index + marker.length) >= 0) throw new Error(`Missing/duplicate/out-of-order generated guard: ${name}/${id}`);
      const condition = body.indexOf(guard.cond, index);
      if (condition < index) throw new Error(`Generated guard condition changed: ${name}/${id}`);
      cursor = condition + guard.cond.length;
    }
    if ((body.match(/\bif\s*\(/g) || []).length !== rule.guards.length) throw new Error(`Extra/omitted generated command guard: ${name}`);
    for (const eventName of rule.produces) {
      const event = specs.aggregate.events.find((entry) => entry.name === eventName);
      if (!event) throw new Error(`Missing selected generated event: ${eventName}`);
      const args = event.fields.map((field) => {
        const binding = event.bindings.find((entry) => entry.slot === field.name);
        if (!binding) throw new Error(`Missing source event binding: ${eventName}.${field.name}`);
        if (binding.expr.startsWith('literal:')) return JSON.stringify(binding.expr.slice('literal:'.length));
        return binding.expr.replace(/^param\./, 'p.');
      }).join(', ');
      if (!body.includes(`${eventName}(${args})`)) throw new Error(`Generated event constructor/bindings changed: ${name}/${eventName}`);
    }
    const expected = specs.invariant.paramDefs[name].fields.map((field) => `${field.name}: ${field.type}`).join(', ');
    if (!parameters.includes(`case class ${name}Params(${expected})`)) throw new Error(`Generated parameter order/type changed: ${name}`);
  }
  for (const event of specs.aggregate.events) {
    const marker = `case event: ${event.name} =>`;
    let start = handler.indexOf(marker);
    if (start < 0) start = handler.indexOf(`case event: ${event.name}`);
    if (start < 0) throw new Error(`Missing generated fold case: ${event.name}`);
    const next = handler.indexOf('\n    case ', start + 5);
    const body = handler.slice(start, next < 0 ? handler.length : next);
    const copy = body.match(/state\.copy\(([^\n]+)\)/);
    if (!copy) throw new Error(`Missing generated state.copy: ${event.name}`);
    const expected = (event.foldAssignments || []).map((fold) => {
      const value = (expr) => String(expr).startsWith('literal:') ? JSON.stringify(String(expr).slice('literal:'.length)) : String(expr);
      if (fold.op === 'put') return `${fold.slot} = state.${fold.slot} + (${fold.key} -> ${value(fold.value)})`;
      if (fold.op === 'remove') return `${fold.slot} = state.${fold.slot} - ${fold.key}`;
      if (fold.op) throw new Error(`Unsupported expected fold operation: ${fold.op}`);
      return `${fold.slot} = ${value(fold.expr)}`;
    }).join(', ');
    if (copy[1] !== expected) throw new Error(`Generated fold assignment set/expression changed: ${event.name}`);
  }
  return { guardOrder: true, parameterOrder: true, eventConstructors: true, foldAssignmentSets: true };
}

function emit(root, bundle, pass) {
  const target = join(root, pass);
  mkdirSync(target, { recursive: false });
  const specs = bundle.materialize(target);
  const base = 'generated/main/scala/fixture/wealth/qualification';
  const agg = `${base}/application/aggregates`;
  const inv = `${base}/domain/invariant`;
  const invPath = join(target, inv);
  const aggPath = join(target, agg);
  mkdirSync(invPath, { recursive: true });
  mkdirSync(aggPath, { recursive: true });
  const invoke = (name, spec, destination, label = name) => {
    const specPath = writeOwned(target, `specs/${label}.json`, `${JSON.stringify(spec, null, 2)}\n`);
    const emitter = join(TOOL_ROOT, `generators/${name}/emit.mjs`);
    return command(root, `${pass}-${label}`, process.execPath, [emitter, specPath, destination], { cwd: target });
  };
  const operations = [];
  operations.push(invoke('aggregate-dsl', specs.aggregate, aggPath));
  operations.push(invoke('invariant-dsl', specs.invariant, invPath));
  operations.push(invoke('command-dsl', specs.command, join(aggPath, 'behaviors/FundOrderCommandHelpers.scala')));
  for (const value of specs.valueObjects) {
    const destination = join(target, base, `domain/values/${value.name}.scala`);
    mkdirSync(dirname(destination), { recursive: true });
    operations.push(invoke('valueobject-dsl', value.spec, destination, `valueobject-${value.name}`));
  }
  const specInventory = ['aggregate', 'invariant', 'command'].map((key) => ({ file: `specs/${key}-dsl.json`, spec: specs[key] }));
  for (const file of filesUnder(join(target, 'generated'))) {
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error(`Unsafe generated file: ${file}`);
    if (!file.includes('/factories/')) {
      const text = readFileSync(file, 'utf8');
      if (text.includes('???') || /TODO 不可翻译|GEN_SKIPPED|unknown structured fold op|passed through verbatim/.test(text)) throw new Error(`Unqualified generated executable: ${file}`);
    }
  }
  const surface = verifyGeneratedSurface(specs, target);
  return { target, specs, surface, specInventory, operations: operations.map((operation) => operation.record), outputs: inventory(join(target, 'generated')) };
}

function copyTemplate(root) {
  const files = inventory(TEMPLATE);
  for (const entry of files) writeOwned(root, entry.file, readFileSync(join(TEMPLATE, entry.file)));
  return files;
}

function cloneBoot(root, existing) {
  const boot = join(root, 'build-cache/boot');
  const paths = ['scala-2.12.12/lib', 'scala-2.12.12/org.scala-sbt/sbt/1.4.9'];
  for (const path of paths) {
    const source = join(existing, path);
    if (!existsSync(source)) throw new Error(`Missing read-only sbt boot input: ${source}`);
    const inputs = inventory(source);
    for (const entry of inputs) {
      if (entry.file.endsWith('.lock')) continue;
      writeOwned(boot, `${path}/${entry.file}`, readFileSync(join(source, entry.file)));
    }
  }
  return boot;
}

export function readTestReports(root) {
  const reports = filesUnder(join(root, 'target/test-reports'), (name) => name.endsWith('.xml'));
  if (!reports.length) throw new Error('No Scala test reports produced; persistent acceptance unavailable.');
  const suites = reports.map((file) => {
    const text = readFileSync(file, 'utf8');
    const suite = text.match(/<testsuite\s([^>]+)>/);
    if (!suite) throw new Error(`Malformed test report: ${file}`);
    const attributes = Object.fromEntries([...suite[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
    const number = (key) => {
      if (!/^\d+$/.test(attributes[key] || '')) throw new Error(`Missing/invalid ${key} count: ${file}`);
      return Number(attributes[key]);
    };
    const tests = number('tests'), failures = number('failures'), errors = number('errors');
    const skipped = attributes.skipped == null ? 0 : number('skipped');
    if (/<(?:failure|error|skipped)(?:\s|\/|>)/.test(text) || failures || errors || skipped || !tests) throw new Error(`Required Scala suite did not pass completely: ${file}`);
    const caseCount = [...text.matchAll(/<testcase(?:\s|>)/g)].length;
    if (caseCount !== tests) throw new Error(`Test report count mismatch: ${file}`);
    return { name: attributes.name, tests, failures, errors, skipped, file: relative(root, file), sha256: sha256(text) };
  });
  return { passed: suites.reduce((sum, suite) => sum + suite.tests, 0), failed: 0, skipped: 0, suites };
}

function qualifyScala(root) {
  const javaHome = resolve(process.env.BANKWEALTH_JAVA_HOME || DEFAULT_JAVA);
  const cache = resolve(process.env.BANKWEALTH_MAVEN_CACHE || DEFAULT_CACHE);
  const oldBoot = resolve(process.env.BANKWEALTH_SBT_BOOT || DEFAULT_BOOT);
  const launcher = resolve(process.env.BANKWEALTH_SBT_LAUNCHER || join(cache, 'org/scala-sbt/sbt-launch/1.4.9/sbt-launch-1.4.9.jar'));
  const java = join(javaHome, 'bin/java');
  const javaVersion = command(root, 'java-version', java, ['-version']);
  if (!/version "11\./.test(javaVersion.stderr + javaVersion.stdout)) throw new Error('Generated domain qualification requires JDK 11.');
  const launcherHash = sha256(readFileSync(launcher));
  const localLauncher = writeOwned(root, 'build-cache/sbt-launch.jar', readFileSync(launcher));
  const boot = cloneBoot(root, oldBoot);
  const home = join(root, 'build-cache/home');
  const tmp = join(root, 'build-cache/tmp');
  for (const directory of [home, tmp]) mkdirSync(directory, { recursive: true });
  const repositories = writeOwned(root, 'build-cache/repositories', `[repositories]\nread-only-cache: ${pathToFileURL(cache).href}/\nmaven-central: https://repo.maven.apache.org/maven2/\n`);
  const env = { ...process.env, JAVA_HOME: javaHome, HOME: home, TMPDIR: tmp, COURSIER_CACHE: join(root, 'build-cache/coursier'), XDG_CACHE_HOME: join(root, 'build-cache/xdg'), SBT_OPTS: '', JAVA_OPTS: '', JDK_JAVA_OPTIONS: '', JAVA_TOOL_OPTIONS: '', _JAVA_OPTIONS: '' };
  const properties = [`-Duser.home=${home}`, `-Djava.io.tmpdir=${tmp}`, `-Dsbt.boot.directory=${boot}`, `-Dsbt.global.base=${join(root, 'build-cache/global')}`, `-Dsbt.ivy.home=${join(root, 'build-cache/ivy')}`, `-Dsbt.coursier.home=${join(root, 'build-cache/coursier')}`, '-Dsbt.override.build.repos=true', `-Dsbt.repository.config=${repositories}`, '-Dsbt.supershell=false', '-Dsbt.server.autostart=false', '-Dsbt.task.cpus=2'];
  const result = command(root, 'scala-acceptance', java, [...properties, '-Xmx2g', '-jar', localLauncher, 'compile', 'Test / compile', 'test', 'show Compile / fullClasspath', 'show Test / fullClasspath'], { env });
  const dependencyPaths = [...new Set([...result.stdout.matchAll(/Attributed\(([^\r\n)]+\.jar)\)/g)].map((match) => match[1]))].sort();
  if (!dependencyPaths.length) throw new Error('No resolved dependency jar inventory; qualification receipt unavailable.');
  const dependencies = dependencyPaths.map((file) => ({ file, sha256: sha256(readFileSync(file)) }));
  const common = dependencies.find((entry) => entry.file.endsWith('common-core_2.13-0.2.jar'));
  if (!common) throw new Error('Qualification did not resolve the selected common-core 0.2 artifact.');
  if (sha256(readFileSync(launcher)) !== launcherHash) throw new Error('Read-only sbt launcher changed during qualification.');
  return { javaHome, javaVersion: (javaVersion.stderr + javaVersion.stdout).trim(), javaExecutableSha256: sha256(readFileSync(java)), sbtVersion: '1.4.9', launcher: { file: launcher, sha256: launcherHash }, repositories: { cache, central: 'https://repo.maven.apache.org/maven2/' }, operations: [javaVersion.record, result.record], environment: { JAVA_HOME: env.JAVA_HOME, HOME: env.HOME, TMPDIR: env.TMPDIR, COURSIER_CACHE: env.COURSIER_CACHE, XDG_CACHE_HOME: env.XDG_CACHE_HOME }, dependencies, tests: readTestReports(root) };
}

export async function qualifyDomain({ executeScala = false } = {}) {
  const snapshot = loadSnapshot();
  const source = sourceGates(snapshot);
  const checks = { declarations: validateDeclarations(snapshot), proposals: validateArtifacts(snapshot), cash: validateCashContract(snapshot), protection: protectionReport() };
  if (source.structure.hard.length || !source.saga.ok || !source.execution.ok || !source.lowering.ok || checks.declarations.errors.length || checks.proposals.errors.length || checks.cash.errors.length || !checks.protection.ok) throw new Error('Source gates failed; no generation performed.');
  const specModule = join(ROOT, 'tools/domain-spec.mjs');
  const specHash = sha256(readFileSync(specModule));
  const { buildDomainSpec, materializeDomainSpecs } = await import(`./domain-spec.mjs?sha256=${specHash}`);
  if (sha256(readFileSync(specModule)) !== specHash) throw new Error('Domain adapter changed during import.');
  const logical = buildDomainSpec(snapshot, loadBindings());
  const fingerprint = generationFingerprint();
  stable(snapshot, fingerprint);
  preflightPaths(RUNS, ['ownership-check']);
  mkdirSync(RUNS, { recursive: true });
  const root = mkdtempSync(join(RUNS, 'run-'));
  const initial = { schemaVersion: 'bank-wealth.domain-qualification/v1', sourceFingerprint: snapshot.sourceFingerprint, canonicalSha256: snapshot.canonicalSha256, truthTool: snapshot.tool, generationInputs: fingerprint, manifest: logical.manifest, logicalSpecsSha256: sha256(JSON.stringify(logical)), node: { version: process.version, executable: process.execPath, sha256: sha256(readFileSync(process.execPath)) }, runtimeBindingVerified: false, runnable: false, protobuf: 'not-run', sagaHost: 'not-run', cashEffects: 'not-run', applicationRecovery: 'not-run', codeBackAnchoring: 'not-run' };
  writeOwned(root, 'input.json', `${JSON.stringify(initial, null, 2)}\n`);
  try {
    const bundle = { materialize: (target) => materializeDomainSpecs(logical, target) };
    const first = emit(root, bundle, 'first');
    const second = emit(root, bundle, 'second');
    if (JSON.stringify(first.outputs) !== JSON.stringify(second.outputs)) throw new Error('Generated output bytes differ between independent runs.');
    stable(snapshot, fingerprint);
    const project = first.target;
    const templateInputs = copyTemplate(project);
    const scala = executeScala ? qualifyScala(project) : null;
    stable(snapshot, fingerprint);
    const report = { ...initial, acceptanceStatus: scala ? 'generated-domain-persistence-qualified' : 'generated-only-not-qualified', generated: { deterministic: true, surface: first.surface, files: first.outputs, operations: [...first.operations, ...second.operations], physicalSpecsSha256: [sha256(JSON.stringify(first.specs)), sha256(JSON.stringify(second.specs))] }, templateInputs, scala, persistentAkkaQualified: Boolean(scala), snapshotRecoveryQualified: Boolean(scala) };
    writeOwned(root, 'result.json', `${JSON.stringify(report, null, 2)}\n`);
    return { root, result: join(root, 'result.json'), report };
  } catch (error) {
    writeOwned(root, 'failure.json', `${JSON.stringify({ ...initial, acceptanceStatus: 'blocked', persistentAkkaQualified: false, error: error.message }, null, 2)}\n`);
    throw new Error(`${error.message}\nRetained qualification evidence: ${root}`, { cause: error });
  }
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') { console.log('Usage: node tools/qualify-domain.mjs --generate|--test\nFresh owned specs/generated project/cache only; no full app, Saga, cash execution or protobuf certification.'); return; }
  if (args.length !== 1 || !['--generate', '--test'].includes(args[0])) throw new Error('Usage: node tools/qualify-domain.mjs --generate|--test');
  const result = await qualifyDomain({ executeScala: args[0] === '--test' });
  console.log(JSON.stringify({ root: result.root, result: result.result, acceptanceStatus: result.report.acceptanceStatus, tests: result.report.scala?.tests, runtimeBindingVerified: false, runnable: false }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
