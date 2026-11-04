import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BANK_ROOT, plainSupplyPath, xml } from './v1-release-supply.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const key = m => [m.group, m.artifact, m.version].join(':');
const reportKey = m => [m.organization, m.name, m.revision].join(':');
const child = (n, name) => n?.children.find(c => c.name === name);
const children = (n, name) => n?.children.filter(c => c.name === name) ?? [];
const text = (n, name) => child(n, name)?.text.trim() ?? '';
const pathKey = file => {
  const parts = file.split('/');
  return [parts.slice(1, -3).join('.'), parts.at(-3), parts.at(-2)].join(':');
};
function resolve(value, properties) {
  for (let i = 0; i < 32 && /\$\{/u.test(value); i++) {
    const next = value.replace(/\$\{([^}]+)\}/gu, (raw, name) => Object.hasOwn(properties, name) ? properties[name] : raw);
    if (next === value) break;
    value = next;
  }
  assert.ok(value && !/\$\{/u.test(value), 'unresolved property: ' + value);
  return value;
}

export function analyzeCapturedSupply({ supply, manifestSha256 }) {
  plainSupplyPath(supply, { directory: true });
  const manifestFile = join(supply, 'SUPPLY-MANIFEST.json');
  plainSupplyPath(manifestFile);
  const manifestBytes = readFileSync(manifestFile);
  assert.match(manifestSha256, /^[a-f0-9]{64}$/u);
  assert.equal(sha(manifestBytes), manifestSha256, 'manifest hash differs');
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.schemaVersion, 'bank-existing-supply-manifest/v1');
  assert.equal(manifest.captureVerified, true);
  const inventory = new Map(), used = new Map();
  for (const row of manifest.files) {
    assert.ok(typeof row.file === 'string' && row.file.split('/').every(p => p && p !== '.' && p !== '..') && !row.file.startsWith('/') && !row.file.includes('\\'), 'unsafe captured path');
    assert.ok(!inventory.has(row.file), 'duplicate captured path');
    assert.match(row.sha256, /^[a-f0-9]{64}$/u);
    const file = join(supply, row.file);
    plainSupplyPath(file);
    const bytes = readFileSync(file);
    assert.equal(sha(bytes), row.sha256, 'captured file hash differs: ' + row.file);
    assert.equal(bytes.length, row.bytes, 'captured file length differs');
    inventory.set(row.file, row);
  }
  const read = file => {
    assert.ok(inventory.has(file), 'metadata not in captured inventory: ' + file);
    const bytes = readFileSync(join(supply, file));
    assert.equal(sha(bytes), inventory.get(file).sha256, 'metadata changed during analysis');
    used.set(file, inventory.get(file).sha256);
    return bytes.toString('utf8');
  };
  function capturedArtifact(artifact) {
    assert.ok(inventory.has(artifact.file), 'captured artifact missing from inventory');
    assert.equal(typeof artifact.sha256, 'string', 'captured artifact hash required');
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(inventory.get(artifact.file).sha256, artifact.sha256, 'captured artifact binding differs');
    if (artifact.module && artifact.file.startsWith('maven/')) assert.equal(pathKey(artifact.file), artifact.module, 'captured artifact path identity differs');
  }
  for (const artifact of manifest.artifacts.filter(a => ['resolved-artifact', 'bootstrap-artifact'].includes(a.role))) capturedArtifact(artifact);
  const documents = new Map(), poms = new Map(), issues = [];
  for (const row of manifest.files.filter(r => r.file.startsWith('maven/') && r.file.endsWith('.pom'))) {
    const doc = xml(read(row.file));
    assert.equal(doc.name, 'project');
    documents.set(row.file, doc);
    const k = pathKey(row.file), existing = poms.get(k);
    if (existing) assert.equal(inventory.get(existing).sha256, row.sha256, 'ambiguous POM coordinate');
    else poms.set(k, row.file);
  }
  const effective = new Map(), propertyInputs = new Map(), visiting = new Set();
  function properties(file) {
    if (effective.has(file)) return effective.get(file);
    assert.ok(!visiting.has(file), 'cyclic captured parent POM');
    visiting.add(file);
    try {
      const doc = documents.get(file);
      const local = Object.fromEntries((child(doc, 'properties')?.children ?? []).map(n => [n.name, n.text.trim()]));
      const parent = child(doc, 'parent');
      let inherited = {}, parentKey = null, inheritedFiles = [];
      if (parent) {
        parentKey = ['groupId', 'artifactId', 'version'].map(n => resolve(text(parent, n), local)).join(':');
        const parentFile = poms.get(parentKey);
        assert.ok(parentFile, 'parent POM not captured: ' + parentKey);
        inherited = properties(parentFile);
        inheritedFiles = propertyInputs.get(parentFile);
      }
      const result = { ...inherited, ...local };
      const [group, artifact, version] = pathKey(file).split(':');
      for (const [name, value] of Object.entries({ groupId: group, artifactId: text(doc, 'artifactId') || artifact, version })) {
        result['project.' + name] = value;
        result['pom.' + name] = value;
      }
      if (parentKey) for (const [i, name] of ['groupId', 'artifactId', 'version'].entries()) {
        result['project.parent.' + name] = parentKey.split(':')[i];
        result['pom.parent.' + name] = parentKey.split(':')[i];
      }
      assert.equal(resolve(text(doc, 'groupId') || result['project.parent.groupId'], result), group, 'POM declared group differs from path');
      assert.equal(resolve(text(doc, 'version') || result['project.parent.version'], result), version, 'POM declared version differs from path');
      const declaredArtifact = resolve(text(doc, 'artifactId'), result);
      if (declaredArtifact !== artifact) {
        assert.ok(Object.hasOwn(result, 'scalaVersion') && Object.hasOwn(result, 'sbtVersion'), 'POM artifact identity differs from path');
        assert.equal(artifact, declaredArtifact + '_' + resolve(result.scalaVersion, result) + '_' + resolve(result.sbtVersion, result), 'POM cross-built identity differs from path');
      }
      effective.set(file, result);
      propertyInputs.set(file, [...inheritedFiles, { file, sha256: inventory.get(file).sha256 }]);
      return result;
    } finally { visiting.delete(file); }
  }
  const requests = [];
  for (const [file, doc] of documents) {
    let props;
    try { props = properties(file); }
    catch (error) { issues.push({ file, kind: 'effective-properties-unavailable', detail: error.message }); continue; }
    const groups = [
      ['dependency', '/project/dependencies/dependency', children(child(doc, 'dependencies'), 'dependency')],
      ['managed-dependency', '/project/dependencyManagement/dependencies/dependency', children(child(child(doc, 'dependencyManagement'), 'dependencies'), 'dependency')],
      ['parent', '/project/parent', children(doc, 'parent')]
    ];
    for (const [kind, xpath, nodes] of groups) for (const [i, node] of nodes.entries()) {
      const expressions = Object.fromEntries(['groupId', 'artifactId', 'version', 'scope', 'type', 'optional'].map(n => [n, text(node, n)]));
      const row = { from: pathKey(file), file, sha256: inventory.get(file).sha256, xpath: xpath + '[' + (i + 1) + ']', kind, expressions,
        propertyInputs: propertyInputs.get(file),
        collectorEligible: kind === 'dependency' && !!expressions.version && !['test', 'system', 'import'].includes(expressions.scope || 'compile') && expressions.optional !== 'true',
        exclusions: children(child(node, 'exclusions'), 'exclusion').map(n => ({ groupId: text(n, 'groupId'), artifactId: text(n, 'artifactId') })) };
      try {
        row.module = ['groupId', 'artifactId', 'version'].map(n => resolve(expressions[n], props)).join(':');
      } catch (error) {
        row.module = null;
        row.unresolved = error.message;
        row.unresolvedKind = expressions.version ? 'unresolved-expression' : 'version-not-explicit';
      }
      row.unresolvedFields = {};
      for (const [field, fallback] of [['scope', 'compile'], ['type', 'jar'], ['optional', 'false']]) {
        try { row[field] = resolve(expressions[field] || fallback, props); }
        catch (error) { row[field] = null; row.unresolvedFields[field] = error.message; }
      }
      requests.push(row);
    }
  }

  const occurrences = [], reports = [], details = [];
  for (const report of manifest.inputLock.reports) {
    assert.ok(['app', 'meta'].includes(report.role));
    const file = 'evidence/update-' + report.role + '-' + report.sha256 + '.json';
    assert.equal(inventory.get(file)?.sha256, report.sha256, 'captured report pin differs');
    const data = JSON.parse(read(file));
    assert.ok(Array.isArray(data.configurations));
    reports.push({ role: report.role, file, sha256: report.sha256 });
    for (const [ci, config] of data.configurations.entries()) {
      assert.ok(typeof config.configuration?.name === 'string' && Array.isArray(config.modules));
      details.push({ report: file, pointer: '/configurations/' + ci + '/details', values: config.details ?? null });
      for (const [mi, entry] of config.modules.entries()) {
        assert.equal(typeof entry.evicted, 'boolean', 'explicit report eviction flag required');
        assert.ok(Array.isArray(entry.artifacts));
        const artifacts = entry.artifacts.map(pair => {
          assert.ok(Array.isArray(pair) && pair.length === 2 && pair[1].startsWith('file:'));
          const origin = fileURLToPath(pair[1]);
          const references = manifest.artifacts.filter(a => a.source === origin && a.role === 'resolved-artifact');
          const matches = [...new Map(references.map(a => [JSON.stringify([a.module, a.file, a.sha256]), a])).values()];
          if (!entry.evicted) assert.equal(matches.length, 1, 'selected report artifact must map uniquely to captured artifact');
          const captured = matches[0];
          if (captured) {
            capturedArtifact(captured);
            const axes = entry.module.extraAttributes ?? {}, m = entry.module;
            const cross = axes.scalaVersion && axes.sbtVersion ? m.name + '_' + axes.scalaVersion + '_' + axes.sbtVersion : null;
            assert.ok(captured.module === reportKey(m) || (cross && captured.module === [m.organization, cross, m.revision].join(':')), 'reported/captured module identity differs');
          }
          return { metadata: pair[0], sourceUri: pair[1], capturedFile: captured?.file ?? null, capturedModule: captured?.module ?? null };
        });
        occurrences.push({ id: occurrences.length, report: file, role: report.role, configuration: config.configuration.name,
          pointer: '/configurations/' + ci + '/modules/' + mi, module: reportKey(entry.module),
          buildAxes: entry.module.extraAttributes ?? {}, descriptorConfigurations: entry.module.configurations ?? null,
          exclusions: entry.module.exclusions ?? [], callers: entry.callers ?? null, evicted: entry.evicted,
          missingArtifacts: entry.missingArtifacts ?? [], problem: entry.problem ?? null, artifacts });
      }
    }
  }
  const native = occurrence => {
    const [group, artifact, version] = occurrence.module.split(':'), found = [];
    for (const item of occurrence.artifacts) {
      if (!item.capturedFile) continue;
      const record = manifest.modules.find(m => key(m.module) === item.capturedModule && m.artifacts.includes(item.capturedFile));
      if (!record) continue;
      for (const file of record.metadata) {
        const doc = file.endsWith('.pom') ? documents.get(file) : xml(read(file));
        let layout = null;
        if (file.startsWith('ivy/')) {
          assert.equal(doc.name, 'ivy-module', 'Ivy document root differs');
          const revisionRoot = dirname(dirname(file));
          assert.ok(item.capturedFile.startsWith('ivy/') && record.artifacts.some(a => a.startsWith('ivy/') && dirname(dirname(a)) === revisionRoot), 'Ivy descriptor/artifact layout differs');
          if (revisionRoot !== dirname(dirname(item.capturedFile))) continue;
          const info = child(doc, 'info')?.attributes;
          assert.ok(info && info.organisation === group && info.module === artifact && info.revision === version, 'Ivy identity differs');
          const parts = file.split('/');
          assert.deepEqual(parts.slice(0, 3), ['ivy', group, artifact], 'Ivy path identity differs');
          assert.deepEqual(parts.slice(-3), [version, 'ivys', 'ivy.xml'], 'Ivy revision path differs');
          const axes = parts.slice(3, -3);
          assert.ok(axes.length === 0 || axes.length === 2 && axes[0].startsWith('scala_') && axes[1].startsWith('sbt_'), 'unsupported Ivy axes layout');
          for (const [index, axis, prefix] of [[0, 'scalaVersion', 'scala_'], [1, 'sbtVersion', 'sbt_']]) {
            if (occurrence.buildAxes[axis]) assert.equal(axes[index], prefix + occurrence.buildAxes[axis], 'Ivy build axis differs');
          }
          layout = 'ivy';
        } else if (doc && record.module.artifact !== artifact) {
          const axes = occurrence.buildAxes;
          if (!axes.scalaVersion || !axes.sbtVersion) continue;
          assert.equal(record.module.artifact, artifact + '_' + axes.scalaVersion + '_' + axes.sbtVersion, 'cross-built coordinate differs');
          if (!effective.has(file)) continue;
          const props = effective.get(file);
          assert.ok([artifact, record.module.artifact].includes(resolve(text(doc, 'artifactId'), props)), 'POM artifact identity differs');
          assert.equal(resolve(text(doc, 'groupId') || props['project.parent.groupId'], props), group);
          assert.equal(resolve(text(doc, 'version') || props['project.parent.version'], props), version);
          const resolvedAxes = {};
          try {
            for (const axis of ['scalaVersion', 'sbtVersion']) resolvedAxes[axis] = resolve(props[axis], props);
          } catch (error) {
            if (!issues.some(i => i.file === file && i.kind === 'native-build-axes-unavailable'))
              issues.push({ file, kind: 'native-build-axes-unavailable', detail: error.message });
            continue;
          }
          for (const axis of ['scalaVersion', 'sbtVersion']) assert.equal(resolvedAxes[axis], axes[axis], 'POM build axis differs');
          layout = 'cross-built-maven';
        }
        if (layout) found.push({ layout, file, sha256: inventory.get(file).sha256, occurrence: occurrence.id, capturedModule: item.capturedModule, artifact: item.capturedFile });
      }
    }
    return found;
  };
  const blockers = manifest.unresolved.filter(r => r.code === 'missing-pom');
  const nativeByOccurrence = new Map(occurrences.filter(o => !o.evicted && blockers.some(b => b.module === o.module))
    .map(o => [o.id, native(o)]));
  const rows = blockers.map(blocker => {
    const [group, artifact] = blocker.module.split(':'), same = occurrences.filter(o => o.module.startsWith(group + ':' + artifact + ':'));
    const selected = same.filter(o => o.module === blocker.module && !o.evicted);
    const evictionOccurrences = same.filter(o => o.module === blocker.module && o.evicted);
    const evidenceComplete = issues.length === 0 && reports.some(r => r.role === 'app') && reports.some(r => r.role === 'meta') &&
      !occurrences.some(o => o.problem || o.missingArtifacts.length) && !requests.some(r => r.collectorEligible && (r.module === null || Object.keys(r.unresolvedFields).length));
    const alternatives = same.filter(o => o.module !== blocker.module && !o.evicted && o.artifacts.length);
    const nativeDescriptors = selected.flatMap(o => nativeByOccurrence.get(o.id));
    const matchingRequests = requests.map((r, index) => ({ r, index })).filter(({ r }) => r.module === blocker.module);
    const eligible = matchingRequests.filter(({ r }) => r.collectorEligible);
    const bootstrap = manifest.artifacts.filter(a => a.role === 'bootstrap-artifact' && a.module.startsWith(group + ':' + artifact + ':') && a.module !== blocker.module)
      .map(a => ({ module: a.module, file: a.file, sha256: a.sha256, role: a.role }));
    let classification = 'requires-further-evidence';
    if (nativeDescriptors.some(d => d.layout === 'ivy')) classification = 'selected-native-ivy-descriptor';
    else if (nativeDescriptors.some(d => d.layout === 'cross-built-maven')) classification = 'selected-cross-built-maven-descriptor';
    else if (evidenceComplete && !selected.length && eligible.length && eligible.every(({ r }) => r.scope === 'provided')) classification = 'unselected-provided-only-eligible-requests';
    else if (evidenceComplete && !selected.length && eligible.some(({ r }) => r.scope === 'compile') && alternatives.length) classification = 'unselected-compile-report-alternative';
    else if (evidenceComplete && !selected.length && eligible.some(({ r }) => r.scope === 'compile') && bootstrap.length) classification = 'unselected-compile-bootstrap-alternative';
    return { module: blocker.module, originalBlocker: blocker, classification, requestEdges: matchingRequests.map(x => x.index),
      selectedOccurrences: selected.map(o => o.id), alternativeOccurrences: alternatives.map(o => o.id),
      reportedEvictedOccurrences: evictionOccurrences.map(o => o.id),
      evidenceCompleteForGrouping: evidenceComplete, nativeDescriptors, bootstrapAlternatives: bootstrap, evictionReasonProven: false,
      coldResolverRequirement: 'unknown', downloadRequiredProven: false, historicalBlockerProducerTrace: 'not-captured' };
  });
  const counts = {};
  for (const row of rows) counts[row.classification] = (counts[row.classification] ?? 0) + 1;
  const unresolvedRequestCounts = {};
  for (const request of requests.filter(r => r.module === null)) unresolvedRequestCounts[request.unresolvedKind] = (unresolvedRequestCounts[request.unresolvedKind] ?? 0) + 1;
  for (const [file, row] of inventory) assert.equal(sha(readFileSync(join(supply, file))), row.sha256, 'captured supply changed during analysis');
  assert.equal(sha(readFileSync(manifestFile)), manifestSha256);
  return { schemaVersion: 'bank-captured-supply-analysis/v1', supply, manifestSha256,
    capturedFilesVerified: inventory.size, reports, metadataInputs: Object.fromEntries(used), occurrences, details, requests, issues, rows, counts, unresolvedRequestCounts,
    missingPomCount: rows.length, missingLicenseEvidence: manifest.unresolved.filter(x => x.code === 'missing-license-evidence'),
    derivedBridgeGaps: manifest.unresolved.filter(x => x.code === 'derived-compiler-bridge-rebuild-unverified'),
    existingBlockersUnchanged: true, licensesReassigned: false, releaseAccepted: false, coldResolverClosureVerified: false,
    limitations: ['POM declarations are not resolver traversal history', 'Provided scope and alternative versions do not establish metadata exclusion',
      'No effective dependency-management/profile/conflict-resolution engine', 'Related-module licenses do not license a plugin'] };
}

export function writeSupplyAnalysis(config, output) {
  plainSupplyPath(output, { fresh: true });
  assert.ok(relative(join(BANK_ROOT, '.scratch'), output).split('/').every(p => p && p !== '..'), 'output must be owned bank scratch');
  plainSupplyPath(dirname(output), { directory: true });
  assert.deepEqual(Object.keys(config).sort(), ['manifestSha256', 'supply']);
  const result = analyzeCapturedSupply(config);
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    assert.ok(process.argv.length === 6 && process.argv[2] === '--config' && process.argv[4] === '--output', 'expected --config PATH --output PATH');
    const config = JSON.parse(readFileSync(plainSupplyPath(process.argv[3]), 'utf8'));
    const result = writeSupplyAnalysis(config, process.argv[5]);
    console.log(JSON.stringify({ missingPomCount: result.missingPomCount, counts: result.counts, unresolvedMetadata: result.issues.length, unresolvedRequestCounts: result.unresolvedRequestCounts, releaseAccepted: false }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
