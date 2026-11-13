#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { doctor, nodeSupported, requestedStages, validateSupplyOptions } from './bank-workshop-supply.mjs';

export const HELP = `Bank workshop — current source, anchors, code and service evidence

node tools/bank-workshop.mjs doctor --through source|anchors|code|service
  [--archive <absolute-file> --runtime-supply <absolute-prepared-directory>]
  [--java-home <absolute-JDK11>]
  [--lease <absolute-json> --browser-module <absolute-file> --browser-executable <absolute-file>]
  [--probe-resources] [--format human|json]
node tools/bank-workshop.mjs verify --through source|anchors|code|service --run <new-bank-target-child>
  [--archive <absolute-file> --runtime-supply <absolute-prepared-directory>]
  [--java-home <absolute-JDK11>]
  [--lease <absolute-json> --browser-module <absolute-file> --browser-executable <absolute-file>]
  [--format human|json]
node tools/bank-workshop.mjs report --run <existing-bank-target-child> [--format human|json]
node tools/bank-workshop.mjs view --run <existing-bank-target-child> --html <new-file> [--format human|json]
node tools/bank-workshop.mjs start|status|stop <session flags> [--format human|json]

source needs neither archive nor runtime supply and rejects both unused flags.
For anchors/code/service, BOTH --archive and --runtime-supply are required:
  clean1134 supplies the frozen compiler/toolchain and third-party dependencies;
  an existing receipt.json + maven/ directory supplies the selected 0.3.0 engines.
The prepared directory must match truthsrc.project.json. Verification only reads it;
build composes an exclusive offline supply, excluding the archive's old engines.
No prepare command, implicit download or P23 fallback is dispatched.
service includes TWO fresh fixed-test builds and a THIRD fresh runtime build,
all runtime windows and browser checks. No downgrade, old receipts or resume.
Doctor reads metadata only unless --probe-resources is explicit (no JVM/container start).
report/view/session use the run's sealed supply; no runtime override is accepted.
Session commands delegate to bank-workshop-session.mjs; unavailable is an error.
See docs/BANK-WORKSHOP.md. No download, cleanup, frozen runtime repair or publication.`;

export function parseWorkshopArgs(args) {
  const [command, ...input] = args;
  if (!command || command === '--help' || command === 'help' || input.length === 1 && input[0] === '--help') return { help: true };
  if (!['doctor', 'verify', 'report', 'view', 'start', 'status', 'stop'].includes(command)) throw new Error('unknown command');
  let format = 'human';
  const rest = [], seen = new Set();
  for (let i = 0; i < input.length; i++) {
    if (input[i] !== '--format') { rest.push(input[i]); continue; }
    if (seen.has('format') || !['human', 'json'].includes(input[i + 1])) throw new Error('format must be human or json, once');
    seen.add('format'); format = input[++i];
  }
  if (['start', 'status', 'stop'].includes(command)) {
    if (rest.includes('--runtime-supply') || rest.includes('--archive')) throw new Error('session uses sealed supply only');
    return { command, format, args: rest };
  }
  const options = {};
  const fields = { '--through': 'through', '--run': 'run', '--html': 'html', '--archive': 'archive', '--runtime-supply': 'runtimeSupply',
    '--lease': 'lease', '--java-home': 'javaHome', '--browser-module': 'browserModule', '--browser-executable': 'browserExecutable' };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (seen.has(flag)) throw new Error('duplicate flag');
    seen.add(flag);
    if (flag === '--probe-resources' && command === 'doctor') { options.probeResources = true; continue; }
    const field = fields[flag];
    if (!field || !rest[i + 1] || rest[i + 1].startsWith('--') || command === 'report' && field !== 'run'
      || command === 'view' && !['run', 'html'].includes(field) || command !== 'view' && field === 'html') throw new Error('unknown or incomplete flag');
    options[field] = rest[++i];
  }
  if (!['report', 'view'].includes(command)) {
    requestedStages(options.through);
    validateSupplyOptions(options, { required: command === 'verify' });
    if (options.through !== 'service' && (options.lease || options.browserModule || options.browserExecutable || options.probeResources))
      throw new Error('service-only options require --through service');
  }
  if (['verify', 'report', 'view'].includes(command) && !options.run) throw new Error('explicit --run required');
  if (command === 'view' && !options.html) throw new Error('explicit --html required');
  return { command, format, options };
}

export function humanResult(result) {
  if (result.schemaVersion === 'bank.workshop-doctor/v1') return [
    `银行前置检查：${result.passed ? '元数据就绪' : '阻断'}（不是构建/服务通过）`,
    ...result.checks.map(row => `  ${row.status.padEnd(7)} ${row.id} [${row.kind}] ${row.detail}`),
    '未启动 JVM/容器；缺材料不自动下载。',
  ].join('\n');
  if (result.schemaVersion === 'bank.workshop-report/v1') return [
    `银行完整验收：${result.fullPipelinePassed ? '通过' : '未完成'}`,
    `请求范围 ${result.through}：${result.requestedScopePassed ? '通过' : '未通过'}；执行类型 ${result.executionKind}`,
    ...(result.legacy ? ['历史 v1/P23 证据复核；不代表当前 0.3.0 验收。'] : []),
    ...(result.runtimeVersion ? [`封存运行库 ${result.runtimeVersion}；供给 ${result.runtimeSupply}`] : []),
    `快照 ${result.snapshot ?? '未取得'}；代码 ${result.codeDigest ?? '未取得'}`,
    ...result.stages.map(row => `  ${row.status.padEnd(7)} ${row.id}（只读复核 ${row.rechecked ? '通过' : '未通过/未执行'}）`),
    ...result.diagnostics.map(row => `  ${row.code}: ${row.message}`),
    `保留记录 ${result.run}`,
    '交付材料/真人上手验收未签收；runtime retry/backoff/deadline 仍 OPEN。',
  ].join('\n');
  if (result.schemaVersion === 'bank.workshop-view/v1') return [
    '银行知识图与验收卡已导出', `打开 ${result.url}`, `代码 ${result.codeDigest}`,
    `完整银行管线：${result.fullPipelinePassed ? '通过' : '未完成'}；快照不会自动刷新。`,
  ].join('\n');
  if (result.schemaVersion === 'bank.workshop-session/v1') return [
    result.help ?? `银行体验会话：${['starting', 'ready', 'stopping', 'closed', 'blocked'].includes(result.status) ? result.status : '未确认'}`,
    ...(result.session ? [`会话记录 ${result.session}`] : []),
    ...(result.owner ? [`Owner ${result.owner}`] : []),
    ...(result.url ? [`本地页面 ${result.url}`] : []),
    ...(result.loginFile ? [`私有登录材料 ${result.loginFile}（不要分享内容）`] : []),
    ...(result.failure ? [`失败阶段 ${result.failure.phase ?? 'unknown'} · ${result.failure.code ?? 'SESSION_BLOCKED'}`, result.failure.message] : []),
    ...(result.message ? [result.message] : []),
    '凭据只按会话模块的私有交付方式取得；停止不等于清库。',
  ].join('\n');
  // Never print arbitrary returned credentials or infer an unknown module's success.
  return '未知结果类型；请使用 --format json 查看该模块的脱敏结果。';
}

export async function workshopCli(args, { session } = {}) {
  const parsed = parseWorkshopArgs(args);
  if (parsed.help) return { help: true, text: HELP, exitCode: 0 };
  const { command, format, options } = parsed;
  let result;
  if (command === 'doctor') result = await doctor(options);
  else {
    if (!nodeSupported()) throw new Error('Node >=22.13 required before importing SQLite');
    if (['start', 'status', 'stop'].includes(command)) {
      const handler = session ?? (await import('./bank-workshop-session.mjs')).sessionCli;
      if (typeof handler !== 'function') throw new Error('session implementation unavailable');
      result = await handler(command, parsed.args);
    } else if (command === 'view') {
      const { exportWorkshopView } = await import('./bank-workshop-view.mjs');
      result = await exportWorkshopView(options);
    } else {
      const { verifyWorkshop, reportWorkshop } = await import('./bank-workshop-verification.mjs');
      result = await (command === 'verify' ? verifyWorkshop(options) : reportWorkshop(options));
    }
  }
  // Session module owns exit semantics; never silently manufacture passed=true.
  const passed = result?.requestedScopePassed ?? result?.passed;
  const exitCode = typeof result?.exitCode === 'number' ? result.exitCode : passed === true ? 0 : 2;
  return { result, format, exitCode, text: format === 'json' ? JSON.stringify(result) : humanResult(result) };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { const result = await workshopCli(process.argv.slice(2)); console.log(result.text); process.exitCode = result.exitCode; }
  catch (error) {
    // Only fixed argument diagnostics may reach the CLI; never print raw errors.
    const messages = {
      WORKSHOP_SOURCE_SUPPLY_UNUSED: 'Source scope does not consume --archive or --runtime-supply. Remove both flags; no supply was read.',
      WORKSHOP_ARCHIVE_REQUIRED: 'Anchors/code/service require --archive for the clean1134 toolchain plus --runtime-supply for existing 0.3.0 engines. Nothing was prepared or downloaded.',
      WORKSHOP_RUNTIME_SUPPLY_REQUIRED: 'Anchors/code/service require --runtime-supply pointing to an existing 0.3.0 receipt.json + maven/ directory matching the project. Nothing was prepared or downloaded.',
      WORKSHOP_SUPPLY_PATH_INVALID: 'Archive and runtime-supply paths must be canonical absolute paths. Use --help; no supply was substituted.',
    };
    const known = Object.hasOwn(messages, error?.code);
    const result = { passed: false, code: known ? error.code : 'WORKSHOP_ENTRY_BLOCKED',
      message: known ? messages[error.code] : 'Invalid arguments, unavailable implementation or unreadable run. Use --help; no success was inferred.' };
    console.error(process.argv.includes('json') ? JSON.stringify(result) : result.code + ': ' + result.message);
    process.exitCode = 2;
  }
}
