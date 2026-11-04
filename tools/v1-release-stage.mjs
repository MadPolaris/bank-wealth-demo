import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [stage, bundle, ...args] = process.argv.slice(2);
assert.equal(resolve(bundle), bundle);
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const load = file => import(pathToFileURL(join(bundle, 'js-generator', file)).href);

if (stage === 'admission') {
  assert.equal(args.length, 1);
  const [out] = args;
  const { compileProductSet } = await load('lib/products/compile.mjs');
  const { generateProductCli } = await load('lib/products/generate-cli.mjs');
  const measurement = json(join(bundle, 'admission/request.json'));
  const compiled = compileProductSet(measurement);
  assert.deepEqual(compiled.diagnostics, []);
  assert.deepEqual(compiled.result, json(join(bundle, 'admission/compiled.json')));
  assert.ok(measurement.documents.some(d => d.value.artifactContracts?.some(a => a.id === 'measurement-service')));
  const { serviceApplicationFixture } = await load('test/service-application-fixture.mjs');
  const nonfinancial = serviceApplicationFixture();
  const nfCompilation = compileProductSet(nonfinancial.request);
  assert.deepEqual(nfCompilation.diagnostics, []);
  save(join(out, 'nonfinancial-compiled.json'), nfCompilation.result);
  const documents = nonfinancial.request.documents.map((d, i) => { const file = 'document-' + i + '.json'; save(join(out, file), d.value); return { id: d.id, schemaVersion: d.schemaVersion, file }; });
  save(join(out, 'nonfinancial-files.json'), { ...nonfinancial.request, schemaVersion: 'truthsrc.product-input-files/v1', documents });
  const opts = json(join(bundle, 'options-template.json'));
  opts.runtimeArtifact.repository = pathToFileURL(join(bundle, 'supply/maven')).href + '/';
  opts.service.externalSourceRoots = [join(bundle, 'supply/ext/scala')];
  nonfinancial.options.runtimeArtifact = opts.runtimeArtifact;
  save(join(out, 'nonfinancial-options.json'), nonfinancial.options);
  assert.equal((await generateProductCli(['--request', join(out, 'nonfinancial-files.json'), '--generator', join(bundle, 'js-generator/generators/scala-cqrs-play-service'), '--options-json', join(out, 'nonfinancial-options.json'), '--out', join(out, 'nonfinancial-js')])).applied, true);
  const invalidOptions = [{ ...opts, service: { ...opts.service, artifact: 'missing-service' } }, { ...opts, runtimeArtifact: { ...opts.runtimeArtifact, sha256: '0'.repeat(64) } }];
  const rejected = [];
  for (const [i, options] of invalidOptions.entries()) {
    const optionsFile = join(out, 'invalid-options-' + i + '.json'), target = join(out, 'rejected-js-' + i);
    save(optionsFile, options);
    let error;
    try { await generateProductCli(['--request', join(bundle, 'inputs/files.json'), '--generator', join(bundle, 'js-generator/generators/scala-cqrs-play-service'), '--options-json', optionsFile, '--out', target]); }
    catch (e) { error = e; }
    assert.ok(error); assert.equal(existsSync(target), false);
    rejected.push({ target, error: error.message, targetAbsent: true });
  }
  save(join(out, 'JS.json'), { nonfinancialTypedProductAccepted: true, nonfinancialPublicGeneration: join(out, 'nonfinancial-js'), rejected });
} else if (stage === 'generate') {
  const [target, options] = args;
  assert.equal(args.length, 2);
  const { readProductRequest } = await load('lib/products/cli.mjs');
  const { compileProductSet } = await load('lib/products/compile.mjs');
  const { generateProductCli } = await load('lib/products/generate-cli.mjs');
  const request = readProductRequest(join(bundle, 'inputs/files.json'));
  assert.deepEqual(request, json(join(bundle, 'inputs/request.json')));
  const compiled = compileProductSet(request);
  assert.deepEqual(compiled.diagnostics, []);
  assert.deepEqual(compiled.result, json(join(bundle, 'inputs/compiled.json')));
  const { bankServiceRequest } = await import('./v1-service-inputs.mjs');
  assert.deepEqual(bankServiceRequest(), request, 'full captured request differs from authored truth');
  const argv = ['--request', join(bundle, 'inputs/files.json'), '--generator', join(bundle, 'js-generator/generators/scala-cqrs-play-service'), '--options-json', options, '--out', target];
  assert.equal((await generateProductCli([...argv, '--plan'])).applied, false);
  assert.equal((await generateProductCli(argv)).applied, true);
} else if (stage === 'provenance') {
  assert.equal(args.length, 3);
  const [target, repeat, output] = args;
  const { verifyGeneratedProvenance, verifyStableGeneration } = await import('./v1-release-provenance.mjs');
  save(output, {
    schemaVersion: 'bank-release-generation/v2',
    generated: await verifyGeneratedProvenance(target, json(join(bundle, 'inputs/request.json'))),
    repeated: await verifyGeneratedProvenance(repeat, json(join(bundle, 'inputs/request.json'))),
    stable: verifyStableGeneration(target, repeat),
  });
} else if (stage === 'build-config') {
  assert.equal(args.length, 2);
  const [support, output] = args;
  const { coldRepositoryText, coldBootProperties } = await import('./v1-release-cold.mjs');
  const repositories = ['maven', 'ivy'].map(layout => ({ name: 'release-' + layout, layout, root: join(bundle, 'supply', layout) }));
  writeFileSync(join(output, 'repositories'), coldRepositoryText(repositories), { flag: 'wx' });
  writeFileSync(join(output, 'sbt.boot.properties'), coldBootProperties(repositories), { flag: 'wx' });
  const properties = {
    'bank.mock-ta.node': join(support, 'bin/node'),
    'bank.mock-ta.worker': join(support, 'bank/tools/v1-service-mock-ta-worker.mjs'),
    'bank.mock-ta.owned-root': join(support, 'bank/.scratch/p26-p32-bank-v1-59o__arv/ta-application-tests'),
    'bank.mock-ta.joint-root': join(support, 'bank/.scratch/p24-p25-bank-joint-fkcd3jwe'),
  };
  save(join(output, 'BUILD-CONFIG.json'), { tasks: [
    'debug',
    'set Test / unmanagedSourceDirectories += file(' + JSON.stringify(join(support, 'tests/scala')) + ')',
    'set libraryDependencies ++= Seq("com.h2database" % "h2" % "2.2.224" % Test, "com.typesafe.play" %% "play-test" % "2.8.18" % Test, "org.iq80.leveldb" % "leveldb" % "0.12" % Test)',
    'set Test / javaOptions ++= Seq(' + Object.entries(properties).map(([k, v]) => JSON.stringify('-D' + k + '=' + v)).join(', ') + ')',
    'set Test / envVars ++= Map("TRUTHSRC_ROOT" -> ' + JSON.stringify(join(support, 'metarch-truthsrc')) + ', "GIT_CEILING_DIRECTORIES" -> ' + JSON.stringify(support) + ')',
  ] });
} else if (stage === 'final-provenance') {
  assert.equal(args.length, 2);
  const [work, output] = args;
  const { verifyGeneratedProvenance, verifyStableGeneration, verifyHandwrittenProvenance } = await import('./v1-release-provenance.mjs');
  const { bankServiceRequest } = await import('./v1-service-inputs.mjs');
  const request = bankServiceRequest();
  assert.deepEqual(request, json(join(bundle, 'inputs/request.json')));
  const chains = {};
  for (const chain of ['js', 'bc']) {
    const build = json(join(work, 'builds', chain, 'BUILD.json'));
    const repeated = json(join(work, 'generation', chain, 'RESULT.json')).stable.right;
    chains[chain] = { generated: await verifyGeneratedProvenance(build.target, request, { afterBuild: true }), stable: verifyStableGeneration(build.target, repeated, { afterBuild: true }) };
  }
  const handwritten = await verifyHandwrittenProvenance(join(bundle, 'bank/v1/handwritten'), request, json(join(bundle, 'bank/v1/integration/HANDWRITTEN-SOURCE-MAP.json')));
  const before = json(join(bundle, 'bank/v1/formal-inputs/release-service-631/bank-v1.json'));
  const current = request.documents.find(d => d.id === 'bank-v1').value;
  const i = current.artifactContracts.findIndex(a => a.id === 'bank-service');
  const previous = structuredClone(current), pages = previous.artifactContracts[i].deployment.service.pages;
  assert.ok(pages); delete previous.artifactContracts[i].deployment.service.pages;
  assert.deepEqual(previous, before, 'existing legal source increment must be exactly the authored pages declaration');
  const pointer = '/artifactContracts/' + i + '/deployment/service/pages';
  assert.ok(handwritten.entries.some(e => e.file.endsWith('/web/BankBrowserPages.scala') && e.references.some(r => r.pointer === pointer + '/renderer')));
  save(output, { schemaVersion: 'bank-final-release-provenance/v2', chains, handwritten, legalIncrement: { pointer, beforeAbsent: true, after: pages, inheritedAuthoredIncrement: true, finalBuilds: ['js', 'bc'].map(chain => ({ chain, file: join(work, 'builds', chain, 'BUILD.json') })) } });
} else if (stage === 'certify') {
  assert.equal(args.length, 2);
  const { certifyRelease } = await import('./v1-release-certify.mjs');
  save(args[1], await certifyRelease({ bundle, work: args[0] }));
} else if (stage === 'accept-installed') {
  assert.equal(args.length, 3);
  const { acceptInstalledRelease } = await import('./v1-release-finalize.mjs');
  await acceptInstalledRelease({ bundle, work: args[0], candidate: args[1], candidateWork: args[2] });
} else if (stage === 'promote') {
  assert.equal(args.length, 2);
  const { promoteDistribution } = await import('./v1-release-dist.mjs');
  await promoteDistribution({ bundle, work: args[0], destination: args[1] });
} else if (stage === 'http') {
  assert.equal(args.length, 4);
  const [target, receipt, ownedRoot, java] = args;
  const { runHttpAcceptance } = await import('./v1-http-acceptance.mjs');
  await runHttpAcceptance({ target, buildReceipt: receipt, ownedRoot, java });
} else if (stage === 'recovery') {
  assert.equal(args.length, 7);
  const [target, receipt, ownedRoot, java, node, caseName, namespace] = args;
  const { runBankCrashRecovery } = await import('./v1-crash-recovery.mjs');
  await runBankCrashRecovery({ synthetic: true, target, buildReceipt: receipt, ownedRoot, java, node, worker: join(bundle, 'bank/tools/v1-service-mock-ta-worker.mjs'), caseName, namespace, classpath: json(receipt).classpath });
} else {
  throw new Error('unknown fixed release stage');
}
