// P32 existing-file collector only. No process execution, network, generation, or dist writes.
// Config/API contract: see cliUsage below. A successful capture is NOT release acceptance.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants, copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

export const BANK_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const FROZEN_RUNTIME = Object.freeze({
  'net.imadz:monarch-core_2.13:0.2.1-p23.20261027.1': '046ce5a54d4900674b9d87396bd57aefd93070e74e00b90820147c043c506b09',
  'net.imadz:monarch-persistence_2.13:0.2.1-p23.20261027.1': '5cf3dd2784fad05fe42102b1c5df16685bc814318e2a21121c458eb26e8205bd',
  'net.imadz:saga-core_2.13:0.2.1-p23.20261027.1': 'f20ad61eba670d2766cd39a1f75bd236351d0069b0480bb85d7335ffff93f8cf'
});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fileSha = file => sha(readFileSync(file));
const json = file => JSON.parse(readFileSync(plainSupplyPath(file), 'utf8'));
const sorted = xs => [...xs].sort();
const digest = value => { assert.match(value, /^(?:sha256:)?[a-f0-9]{64}$/u, 'SHA256 required'); return value.replace(/^sha256:/u, ''); };
const coordinate = m => [m.group, m.artifact, m.version].join(':');
const moduleOf = m => ({ group: m.organization, artifact: m.name, version: m.revision });
const within = (root, file) => file === root || file.startsWith(root + '/');
const relPath = value => {
  assert.ok(typeof value === 'string' && value && !isAbsolute(value) && !value.includes('\\') && !value.includes('\0') && value.split('/').every(p => p && p !== '.' && p !== '..'), 'normalized relative path required');
  return value;
};
const checkedModule = m => {
  assert.ok(m && ['group', 'artifact', 'version'].every(k => typeof m[k] === 'string' && /^[A-Za-z0-9_.+-]+$/u.test(m[k])), 'concrete module coordinate required');
  return m;
};

export function plainSupplyPath(file, { fresh = false, directory = false } = {}) {
  assert.ok(typeof file === 'string' && isAbsolute(file) && resolve(file) === file && !file.includes('\\') && !file.includes('\0'), 'normalized absolute path required');
  let parent = file;
  while (!lstatSync(parent, { throwIfNoEntry: false })) parent = dirname(parent);
  assert.ok(!lstatSync(parent).isSymbolicLink() && realpathSync(parent) === parent, 'symlink or aliased ancestor forbidden');
  if (fresh) assert.ok(!lstatSync(file, { throwIfNoEntry: false }), 'exclusive output already exists');
  else {
    const stat = lstatSync(file);
    assert.ok(directory ? stat.isDirectory() : stat.isFile(), 'regular ' + (directory ? 'directory' : 'file') + ' required');
  }
  return file;
}

export function supplyDestination(bankRoot, destination) {
  plainSupplyPath(bankRoot, { directory: true }); plainSupplyPath(destination, { fresh: true });
  const parts = relative(join(bankRoot, '.scratch'), destination).split('/');
  assert.equal(parts.length, 2, 'supply must be directly in an owned bank scratch root');
  assert.match(parts[0], /^p26-p32-bank-v1-[A-Za-z0-9][A-Za-z0-9_.-]*$/u);
  assert.match(parts[1], /^supply-[A-Za-z0-9][A-Za-z0-9_.-]*$/u);
  plainSupplyPath(dirname(destination), { directory: true });
  return destination;
}

function inventory(root, maxFiles = 4096) {
  plainSupplyPath(root, { directory: true });
  const result = Object.create(null);
  function walk(dir) {
    for (const name of sorted(readdirSync(dir))) {
      const file = join(dir, name), stat = lstatSync(file);
      assert.ok(!stat.isSymbolicLink(), 'symlink in inventory: ' + file);
      if (stat.isDirectory()) walk(file);
      else {
        assert.ok(stat.isFile(), 'non-regular inventory entry: ' + file);
        assert.ok(Object.keys(result).length < maxFiles, 'bounded inventory exceeded');
        result[relative(root, file)] = fileSha(file);
      }
    }
  }
  walk(root); return { ...result };
}
function normalizedInventory(values) {
  assert.ok(values && !Array.isArray(values) && typeof values === 'object', 'inventory map required');
  return Object.fromEntries(sorted(Object.keys(values)).map(file => [relPath(file), digest(values[file])]));
}

// All non-evicted artifacts in ALL application AND meta-build configurations, not Test alone.
// Report bytes and source bytes are pinned. An optional inputLock must match this exact result.
export function extractUpdateLock(updateReports) {
  assert.ok(Array.isArray(updateReports) && updateReports.length > 0, 'explicit update reports required');
  assert.equal(new Set(updateReports.map(r => r.file)).size, updateReports.length, 'duplicate update report');
  const rows = new Map(), reports = [], unresolved = [];
  for (const report of updateReports) {
    assert.ok(['app', 'meta'].includes(report.role), 'app or meta report role required');
    plainSupplyPath(report.file);
    const hash = fileSha(report.file);
    if (report.sha256) assert.equal(hash, digest(report.sha256), 'update report hash differs');
    reports.push({ role: report.role, file: report.file, sha256: hash });
    const data = json(report.file);
    assert.ok(Array.isArray(data.configurations), 'not an sbt update report');
    for (const configuration of data.configurations) {
      assert.ok(typeof configuration.configuration?.name === 'string' && Array.isArray(configuration.modules), 'invalid configuration');
      for (const entry of configuration.modules) {
        if (entry.evicted) continue;
        const module = checkedModule(moduleOf(entry.module));
        assert.ok(Array.isArray(entry.artifacts), 'invalid artifacts');
        for (const missing of entry.missingArtifacts ?? []) unresolved.push({ code: 'report-missing-artifact', module: coordinate(module), report: report.file, artifact: missing });
        if (entry.problem) unresolved.push({ code: 'report-module-problem', module: coordinate(module), report: report.file, detail: entry.problem });
        for (const pair of entry.artifacts) {
          assert.ok(Array.isArray(pair) && pair.length === 2 && typeof pair[1] === 'string' && pair[1].startsWith('file:'), 'existing local artifact URI required');
          const source = fileURLToPath(pair[1]);
          // Missing regular files block; symlinks and non-canonical paths are refusals.
          plainSupplyPath(source, { fresh: !lstatSync(source, { throwIfNoEntry: false }) });
          const key = coordinate(module) + '\0' + source;
          const row = rows.get(key) ?? { module, artifact: pair[0], file: source,
            sha256: lstatSync(source, { throwIfNoEntry: false }) ? fileSha(source) : null, uses: [] };
          assert.deepEqual(row.artifact, pair[0], 'same artifact has inconsistent report metadata');
          row.uses.push({ role: report.role, report: report.file, configuration: configuration.configuration.name });
          rows.set(key, row);
        }
      }
    }
  }
  for (const role of ['app', 'meta']) if (!reports.some(r => r.role === role)) unresolved.push({ code: 'missing-update-role', role });
  return { schemaVersion: 'bank-existing-supply-lock/v1', reports: reports.sort((a, b) => a.file.localeCompare(b.file)),
    artifacts: [...rows.values()].sort((a, b) => (coordinate(a.module) + a.file).localeCompare(coordinate(b.module) + b.file)), unresolved };
}

// Small XML reader: no DTD, external entities, resolver, or dependency on a host toolchain.
export function xml(text) {
  assert.ok(text.length <= 4 * 1024 * 1024 && !/<!DOCTYPE|<!ENTITY/iu.test(text), 'unsupported/oversized XML metadata');
  const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (_, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e]);
  const document = { name: '', children: [], text: '' }, stack = [document];
  const tokens = text.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+/gu) ?? [];
  for (const token of tokens) {
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (token.startsWith('<![CDATA[')) { stack.at(-1).text += token.slice(9, -3); continue; }
    if (token.startsWith('</')) { assert.ok(stack.length > 1); assert.equal(stack.pop().qualified, token.slice(2, -1).trim(), 'XML close mismatch'); }
    else if (token.startsWith('<')) {
      const match = /^<([\w:.-]+)([\s\S]*?)\/?\s*>$/u.exec(token); assert.ok(match, 'invalid XML tag');
      const attributes = {};
      for (const a of match[2].matchAll(/([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/gu)) attributes[a[1].split(':').at(-1)] = decode(a[3]);
      const node = { name: match[1].split(':').at(-1), qualified: match[1], attributes, children: [], text: '' };
      stack.at(-1).children.push(node); if (!/\/\s*>$/u.test(token)) stack.push(node);
    } else stack.at(-1).text += decode(token);
  }
  assert.equal(stack.length, 1, 'unclosed XML'); assert.equal(document.children.length, 1, 'one XML root required');
  return document.children[0];
}
const child = (n, name) => n?.children.find(c => c.name === name);
const children = (n, name) => n?.children.filter(c => c.name === name) ?? [];
const textOf = (n, name) => child(n, name)?.text.trim() ?? '';
function interpolate(value, properties) {
  for (let i = 0; i < 32 && /\$\{/u.test(value); i++) {
    const next = value.replace(/\$\{([^}]+)\}/gu, (match, name) => properties[name] ?? match);
    if (next === value) break; value = next;
  }
  assert.ok(value && !/\$\{/u.test(value), 'unresolved Maven property: ' + value); return value;
}

// Read only selected embedded LICENSE/NOTICE texts. ZIP64/encryption/oversize fail closed.
// Archive paths are never used as output paths; evidence is content-addressed.
export function embeddedLicenseEvidence(file) {
  plainSupplyPath(file);
  const stat = lstatSync(file); assert.ok(stat.size <= 256 * 1024 * 1024, 'oversized archive');
  const bytes = readFileSync(file); let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  assert.ok(end >= 0, 'ZIP directory missing');
  assert.equal(bytes.readUInt16LE(end + 4), 0, 'multi-disk ZIP unsupported');
  const count = bytes.readUInt16LE(end + 10); assert.ok(count < 65535, 'ZIP64 unsupported');
  let offset = bytes.readUInt32LE(end + 16); const evidence = []; let implementationVersion = null;
  for (let i = 0; i < count; i++) {
    assert.ok(offset + 46 <= end && bytes.readUInt32LE(offset) === 0x02014b50, 'invalid ZIP directory');
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10), compressed = bytes.readUInt32LE(offset + 20), size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32), local = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'); offset += 46 + nameLength + extra + comment;
    const binary = /\.(?:class|jar|zip|png|jpe?g|gif|ico|pdf)$/iu.test(name);
    const license = !binary && /(?:^|\/)(?:LICENSE|LICENCE|COPYING)(?:[._-][^/]*)?$/iu.test(name);
    const notice = !binary && /(?:^|\/)(?:NOTICE|COPYRIGHT)(?:[._-][^/]*)?$/iu.test(name);
    if (!license && !notice && name !== 'META-INF/MANIFEST.MF') continue;
    assert.ok(!(flags & 1) && size <= 4 * 1024 * 1024 && compressed <= 4 * 1024 * 1024 && [0, 8].includes(method), 'unsupported embedded evidence');
    assert.ok(local + 30 <= bytes.length && bytes.readUInt32LE(local) === 0x04034b50, 'invalid ZIP local header');
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    assert.ok(start + compressed <= bytes.length, 'truncated ZIP evidence');
    const raw = bytes.subarray(start, start + compressed), content = method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: 4 * 1024 * 1024 });
    assert.equal(content.length, size, 'embedded evidence size differs');
    if (name === 'META-INF/MANIFEST.MF') implementationVersion = /^Implementation-Version:\s*(.+)$/mu.exec(content.toString('utf8'))?.[1].trim() ?? null;
    else if (content.length) evidence.push({ entry: name, kind: license ? 'license' : 'notice', sha256: sha(content), contentBase64: content.toString('base64') });
  }
  return { evidence, implementationVersion };
}

function mavenPath(module, filename) { checkedModule(module); return relPath(module.group.replaceAll('.', '/') + '/' + module.artifact + '/' + module.version + '/' + filename); }
function repositoriesFor(options, lock) {
  const repos = options.repositories ?? [];
  assert.ok(Array.isArray(repos));
  const result = repos.map(r => { assert.ok(['maven', 'ivy'].includes(r.layout)); plainSupplyPath(r.root, { directory: true }); return { ...r }; });
  if (options.p23) result.push({ layout: 'maven', root: join(options.p23.root, 'offline-maven') });
  // Coursier paths in the update report themselves define exact repository roots.
  for (const row of lock.artifacts) for (const [marker, layout] of [['/maven2/', 'maven'], ['/sbt-plugin-releases/', 'ivy']]) {
    const index = row.file.indexOf(marker);
    if (index >= 0) result.push({ layout, root: row.file.slice(0, index + marker.length - 1) });
  }
  const unique = new Map();
  for (const repo of result) { plainSupplyPath(repo.root, { directory: true }); unique.set(repo.layout + '\0' + repo.root, repo); }
  return [...unique.values()].sort((a, b) => a.root.localeCompare(b.root));
}

export function discoverExistingSupply(options) {
  assert.ok(options && typeof options === 'object');
  const bankRoot = options.bankRoot ?? BANK_ROOT; plainSupplyPath(bankRoot, { directory: true });
  assert.deepEqual(options.dependencyOverrides ?? [], [], 'dependency overrides forbidden');
  const lock = extractUpdateLock(options.updateReports);
  if (options.inputLock) assert.deepEqual(options.inputLock, lock, 'input lock must map the complete current report inventory (including extra artifacts)');
  const unresolved = [...lock.unresolved], files = new Map(), snapshots = [], modules = new Map(), tools = [], artifacts = [];
  const block = (code, details = {}) => unresolved.push({ code, ...details });
  function add(file, destination, expected, role, historicalOrigin = null) {
    relPath(destination); assert.ok(['maven', 'ivy', 'boot', 'launcher', 'ext', 'licenses', 'evidence'].includes(destination.split('/')[0]), 'non-supply destination forbidden');
    if (!lstatSync(file, { throwIfNoEntry: false })) { plainSupplyPath(file, { fresh: true }); block('missing-local-file', { file, destination, role }); return null; }
    plainSupplyPath(file); const actual = fileSha(file); if (expected) assert.equal(actual, digest(expected), 'source hash differs: ' + file);
    const stat = lstatSync(file), origin = { file, sha256: actual, historicalOrigin };
    const old = files.get(destination);
    if (old) {
      assert.equal(old.sha256, actual, 'conflicting bytes for portable path: ' + destination);
      if (!old.origins.some(o => o.file === file)) old.origins.push(origin);
      if (!old.roles.includes(role)) old.roles.push(role);
    } else files.set(destination, { file: destination, sha256: actual, bytes: stat.size, mode: stat.mode & 0o777, origins: [origin], roles: [role] });
    return destination;
  }
  function inline(destination, contentBase64, role, origin) {
    const bytes = Buffer.from(contentBase64, 'base64'), hash = sha(bytes), old = files.get(destination);
    if (old) { assert.equal(old.sha256, hash); if (!old.origins.some(o => JSON.stringify(o) === JSON.stringify(origin))) old.origins.push(origin); }
    else files.set(destination, { file: destination, sha256: hash, bytes: bytes.length, mode: 0o644, origins: [origin], roles: [role], contentBase64 });
    return destination;
  }
  for (const report of lock.reports) add(report.file, 'evidence/update-' + report.role + '-' + report.sha256 + '.json', report.sha256, 'update-report');
  const repos = repositoriesFor(options, lock);
  const moduleRecord = m => {
    checkedModule(m); const key = coordinate(m);
    if (!modules.has(key)) modules.set(key, { module: m, artifacts: [], metadata: [], licenses: [], notices: [] });
    return modules.get(key);
  };
  function location(file, module) {
    const matches = repos.filter(r => within(r.root, file)).sort((a, b) => b.root.length - a.root.length);
    if (!matches.length) { block('unmapped-artifact-origin', { file, module: coordinate(module) }); return null; }
    const repo = matches[0], path = relPath(relative(repo.root, file));
    if (repo.layout === 'maven') {
      const parts = path.split('/'); assert.ok(parts.length >= 4, 'invalid Maven origin');
      assert.equal(parts.slice(0, -3).join('.'), module.group, 'Maven group differs');
      assert.equal(parts.at(-2), module.version, 'Maven version differs');
      // sbt plugin module IDs are unsuffixed in the report, unlike Maven artifact IDs.
      assert.ok(parts.at(-3) === module.artifact || /^_(?:\d+\.)*\d+_(?:\d+\.)*\d+$/u.test(parts.at(-3).slice(module.artifact.length)) && parts.at(-3).startsWith(module.artifact), 'Maven artifact differs from reported cross-built module');
      module = { ...module, artifact: parts.at(-3) };
    } else {
      const parts = path.split('/'); assert.equal(parts[0], module.group); assert.equal(parts[1], module.artifact);
      assert.ok(path.includes('/' + module.version + '/'), 'Ivy version differs');
    }
    return { repo, path, module };
  }
  function registerArtifact(row, role, counterpart = row.file) {
    const found = location(counterpart, row.module); const record = moduleRecord(found?.module ?? row.module);
    const key = coordinate(record.module);
    const dest = found ? add(counterpart, found.repo.layout + '/' + found.path, row.sha256, role, row.artifact?.url ?? null) : null;
    if (counterpart !== row.file) {
      plainSupplyPath(row.file); assert.equal(fileSha(row.file), digest(row.sha256), 'bootstrap source changed');
      if (dest) add(row.file, dest, row.sha256, role);
    }
    const item = { module: key, source: row.file, repositorySource: counterpart, sha256: row.sha256, file: dest, role, uses: row.uses ?? [] };
    artifacts.push(item); if (dest && !record.artifacts.includes(dest)) record.artifacts.push(dest);
    if (found) {
      record.locations ??= [];
      const entry = { ...found, pomArtifact: row.module.artifact };
      if (!record.locations.some(l => l.repo.root === entry.repo.root && l.path === entry.path && l.pomArtifact === entry.pomArtifact)) record.locations.push(entry);
    }
    return record;
  }
  for (const row of lock.artifacts) {
    const counterpart = options.bootstrap?.artifacts?.find(a => a.file === row.file);
    if (counterpart) {
      assert.equal(digest(counterpart.sha256), row.sha256, 'boot update counterpart differs');
      assert.deepEqual(counterpart.module, row.module, 'boot update coordinate differs');
    }
    registerArtifact(row, 'resolved-artifact', counterpart?.repositoryFile ?? row.file);
  }

  // The P23 repository is small, inventoried supply, NOT the entire host cache.
  let reviews = [];
  if (options.p23) {
    const root = options.p23.root; plainSupplyPath(root, { directory: true });
    const repository = join(root, 'offline-maven'), inventoryFile = join(root, 'OFFLINE-REPOSITORY.json');
    const source = json(inventoryFile); assert.equal(source.schemaVersion, 'offline-maven-inventory/v1');
    assert.ok(Array.isArray(source.files)); assert.equal(new Set(source.files.map(f => f.file)).size, source.files.length, 'duplicate P23 path');
    const expected = normalizedInventory(Object.fromEntries(source.files.map(f => [f.file, f.sha256])));
    assert.deepEqual(inventory(repository), expected, 'P23 repository inventory differs: missing or extra artifact');
    snapshots.push({ root: repository, destinationPrefix: 'maven/', inventory: expected });
    add(inventoryFile, 'evidence/p23-OFFLINE-REPOSITORY.json', null, 'p23-inventory');
    for (const row of source.files) {
      const file = join(repository, row.file); assert.equal(lstatSync(file).size, row.bytes, 'P23 size differs');
      add(file, 'maven/' + row.file, row.sha256, 'p23-supply', row.source);
      if (/\.jar$/u.test(row.file) && !/-(?:sources|javadoc)\.jar$/u.test(row.file)) {
        const parts = row.file.split('/');
        registerArtifact({ file, sha256: row.sha256, module: { group: parts.slice(0, -3).join('.'), artifact: parts.at(-3), version: parts.at(-2) } }, 'p23-artifact');
      }
    }
    const manifestFile = join(root, 'ARTIFACT-MANIFEST.json'), reviewFile = join(root, 'LICENSE-REVIEW.json');
    const manifest = json(manifestFile); assert.equal(manifest.schemaVersion, 'runtime-artifact-manifest/v1');
    assert.equal(manifest.version, '0.2.1-p23.20261027.1', 'runtime version is immutable');
    add(manifestFile, 'evidence/p23-ARTIFACT-MANIFEST.json', null, 'frozen-runtime-manifest');
    const review = json(reviewFile); assert.equal(review.schemaVersion, 'runtime-license-review/v1');
    assert.ok(Array.isArray(review.modules)); reviews = review.modules;
    add(reviewFile, 'evidence/p23-LICENSE-REVIEW.json', null, 'license-review');
    for (const reviewed of reviews) {
      const record = moduleRecord({ group: reviewed.group, artifact: reviewed.artifact, version: reviewed.version });
      for (const declaration of reviewed.declarations ?? []) {
        const evidence = relPath(declaration.evidence), file = join(root, evidence);
        const dest = add(file, 'licenses/p23/' + evidence, declaration.sha256, 'p23-license-declaration');
        if (dest) record.licenses.push({ kind: 'reviewed-local-declaration', name: declaration.name, url: declaration.url, file: dest, sha256: digest(declaration.sha256), method: declaration.method });
      }
      for (const embedded of reviewed.embedded ?? []) {
        const evidence = relPath(embedded.file), dest = add(join(root, evidence), 'licenses/p23/' + evidence, embedded.sha256, 'p23-embedded-evidence');
        const jarHash = digest(embedded.jarSha256);
        if (!record.artifacts.some(f => files.get(f)?.sha256 === jarHash)) { block('license-jar-binding-missing', { module: coordinate(record.module), jarSha256: jarHash, evidence }); continue; }
        if (dest) record.notices.push({ kind: 'reviewed-embedded-evidence', entry: embedded.entry, file: dest, sha256: digest(embedded.sha256), jarSha256: jarHash });
      }
    }
  } else block('missing-p23-supply');

  // Boot directory inventories and counterpart locks must cover EVERY file/JAR, including Scala.
  if (options.bootstrap) {
    const boot = options.bootstrap;
    assert.equal(boot.version, '1.4.9', 'use the published sbt 1.4.9 toolchain');
    assert.match(boot.scalaVersion, /^2\.12\.\d+$/u); plainSupplyPath(boot.baseRoot, { directory: true });
    const paths = ['scala-' + boot.scalaVersion + '/lib', 'scala-' + boot.scalaVersion + '/org.scala-sbt/sbt/' + boot.version];
    assert.deepEqual(sorted((boot.directories ?? []).map(d => d.path)), sorted(paths), 'both exact sbt and Scala boot directories required');
    const bootJars = [];
    for (const directory of boot.directories) {
      assert.ok(Object.keys(directory.inventory ?? {}).some(f => f.endsWith('.jar')), 'nonempty Scala and sbt boot JAR inventories required');
      const path = join(boot.baseRoot, directory.path), expected = normalizedInventory(directory.inventory);
      assert.deepEqual(inventory(path, 1024), expected, 'boot inventory differs (missing or extra file)');
      snapshots.push({ root: path, destinationPrefix: 'boot/' + directory.path + '/', inventory: expected });
      for (const [file, hash] of Object.entries(expected)) {
        const source = join(path, file); add(source, 'boot/' + directory.path + '/' + file, hash, 'bootstrap-file');
        if (file.endsWith('.jar')) bootJars.push(source);
      }
    }
    const derived = boot.derivedArtifacts ?? [];
    assert.deepEqual(sorted([...(boot.artifacts ?? []).map(a => a.file), ...derived.map(a => a.file)]), sorted(bootJars), 'bootstrap counterpart lock must map every boot JAR exactly once');
    for (const row of boot.artifacts) {
      digest(row.sha256); assert.ok(typeof row.repositoryFile === 'string', 'explicit bootstrap repository counterpart required');
      registerArtifact(row, 'bootstrap-artifact', row.repositoryFile);
    }
    for (const row of derived) {
      assert.equal(row.kind, 'locally-compiled-compiler-bridge');
      plainSupplyPath(row.file); assert.equal(fileSha(row.file), digest(row.sha256));
      assert.match(basename(row.file), /^org\.scala-sbt-compiler-bridge_2\.(12|13)-1\.4\.4-bin_/u);
      assert.ok(row.source && row.source.file.endsWith('-sources.jar'), 'published bridge source required');
      assert.equal(row.source.module.group, 'org.scala-sbt');
      assert.ok(['compiler-bridge_2.12', 'compiler-bridge_2.13'].includes(row.source.module.artifact));
      assert.equal(row.source.module.version, '1.4.4');
      registerArtifact(row.source, 'compiler-bridge-source');
      block('derived-compiler-bridge-rebuild-unverified', { file: row.file, sha256: row.sha256, source: row.source.file,
        detail: 'local derived cache is recorded separately, never fabricated as a published Maven artifact; cold rebuild still required' });
    }
  } else block('missing-bootstrap-lock');
  if (!Array.isArray(options.protoc) || options.protoc.length === 0) block('missing-protoc-lock');
  else for (const row of options.protoc) {
    digest(row.sha256); checkedModule(row.module);
    assert.equal(row.module.group, 'com.google.protobuf', 'published protoc coordinate required');
    assert.equal(row.module.artifact, 'protoc', 'a library JAR is not protoc supply');
    const prefix = 'protoc-' + row.module.version + '-', name = basename(row.file);
    assert.ok(name.startsWith(prefix) && /-(?:osx|linux|windows)-(?:x86_64|x86_32|aarch_64)\.exe$/u.test(name), 'classified native protoc executable required');
    const classifier = name.slice(prefix.length, -4), host = ({ darwin: 'osx', linux: 'linux', win32: 'windows' })[process.platform] + '-' + ({ x64: 'x86_64', arm64: 'aarch_64', ia32: 'x86_32' })[process.arch];
    if (classifier !== host) block('protoc-platform-mismatch', { classifier, actualHost: host });
    registerArtifact(row, 'protoc-artifact');
  }
  if (options.launcher) {
    const row = options.launcher; digest(row.sha256);
    assert.equal(row.implementationVersion, '1.4.4', 'pin the actual launcher implementation, not its installation directory');
    const dest = add(row.file, 'launcher/sbt-launch.jar', row.sha256, 'launcher');
    const record = { tool: 'sbt-launcher', implementationVersion: row.implementationVersion, artifacts: dest ? [dest] : [], metadata: [], licenses: [], notices: [] };
    tools.push(record);
    artifacts.push({ tool: record.tool, source: row.file, sha256: row.sha256, file: dest, role: 'launcher', uses: [] });
    // An implementation version is NOT evidence of a Maven sbt-launch artifact version.
    // Include a published counterpart only if its concrete coordinate AND matching bytes are supplied.
    if (row.module || row.repositoryFile) {
      assert.ok(row.module && row.repositoryFile, 'launcher Maven coordinate and counterpart must be supplied together');
      registerArtifact(row, 'published-launcher', row.repositoryFile);
    }
  } else block('missing-launcher-lock');

  // Resolve exact local POMs, inherited parents and imported BOMs. No sibling/cache sweep.
  const pomCache = new Map(), visiting = new Set();
  function readPom(module, preferred = null, pomArtifact = module.artifact) {
    const key = coordinate(checkedModule(module)), cacheKey = key + '\0' + pomArtifact;
    if (visiting.has(key)) { block('cyclic-pom-metadata', { module: key }); return null; }
    if (pomCache.has(cacheKey)) return pomCache.get(cacheKey);
    assert.ok(pomCache.size + visiting.size < 2048, 'bounded metadata closure exceeded');
    visiting.add(key);
    const paths = [...new Set([module.artifact, pomArtifact])].map(name => mavenPath(module, name + '-' + module.version + '.pom'));
    let candidates = repos.filter(r => r.layout === 'maven').flatMap(r => paths.map(path => join(r.root, path)));
    if (preferred) candidates.unshift(preferred);
    candidates = [...new Set(candidates)].filter(f => lstatSync(f, { throwIfNoEntry: false }));
    if (!candidates.length) { block('missing-pom', { module: key, paths }); pomCache.set(cacheKey, null); visiting.delete(key); return null; }
    for (const file of candidates) plainSupplyPath(file);
    const hash = fileSha(candidates[0]); for (const file of candidates) assert.equal(fileSha(file), hash, 'conflicting local POM bytes: ' + key);
    // Keep the publisher's actual POM filename, including legacy unsuffixed sbt plugin names.
    const dest = 'maven/' + mavenPath(module, basename(candidates[0])); for (const file of candidates) add(file, dest, hash, 'maven-metadata');
    const record = moduleRecord(module); if (!record.metadata.includes(dest)) record.metadata.push(dest);
    try {
      const doc = xml(readFileSync(candidates[0], 'utf8')); assert.equal(doc.name, 'project');
      const localProperties = Object.fromEntries((child(doc, 'properties')?.children ?? []).map(p => [p.name, p.text.trim()]));
      const parentNode = child(doc, 'parent'); let parent = null;
      if (parentNode) parent = readPom({ group: interpolate(textOf(parentNode, 'groupId'), localProperties), artifact: interpolate(textOf(parentNode, 'artifactId'), localProperties), version: interpolate(textOf(parentNode, 'version'), localProperties) });
      const properties = { ...(parent?.properties ?? {}), ...localProperties };
      for (const [name, value] of Object.entries({ groupId: module.group, artifactId: module.artifact, version: module.version })) {
        properties['project.' + name] = value; properties['pom.' + name] = value;
      }
      if (parentNode) for (const name of ['groupId', 'artifactId', 'version']) properties['project.parent.' + name] = interpolate(textOf(parentNode, name), properties);
        const declaredArtifact = interpolate(textOf(doc, 'artifactId'), properties);
        assert.ok([module.artifact, pomArtifact].includes(declaredArtifact), 'POM artifact differs');
        record.pomArtifactId = declaredArtifact;
        const inheritedGroup = parent ? parent.group : textOf(parentNode, 'groupId'), inheritedVersion = parent ? parent.version : textOf(parentNode, 'version');
        const effectiveGroup = interpolate(textOf(doc, 'groupId') || inheritedGroup, properties), effectiveVersion = interpolate(textOf(doc, 'version') || inheritedVersion, properties);
        assert.equal(effectiveGroup, module.group, 'POM effective group differs'); assert.equal(effectiveVersion, module.version, 'POM effective version differs');
      const ownLicenses = children(child(doc, 'licenses'), 'license').map(l => ({ kind: 'local-pom-declaration', name: interpolate(textOf(l, 'name'), properties), url: textOf(l, 'url') ? interpolate(textOf(l, 'url'), properties) : null, file: dest, sha256: hash }));
      const licenses = ownLicenses.length ? ownLicenses : parent?.licenses ?? [];
      record.licenses.push(...licenses);
      const result = { properties, licenses, group: effectiveGroup, version: effectiveVersion };
      for (const dependency of children(child(child(doc, 'dependencyManagement'), 'dependencies'), 'dependency')) {
        const type = textOf(dependency, 'type') ? interpolate(textOf(dependency, 'type'), properties) : 'jar';
        const scope = textOf(dependency, 'scope') ? interpolate(textOf(dependency, 'scope'), properties) : 'compile';
        if (type === 'pom' && scope === 'import') readPom({ group: interpolate(textOf(dependency, 'groupId'), properties), artifact: interpolate(textOf(dependency, 'artifactId'), properties), version: interpolate(textOf(dependency, 'version'), properties) });
      }
      pomCache.set(cacheKey, result); visiting.delete(key);
      if (options.followMetadataDependencies === true) {
        for (const dependency of children(child(doc, 'dependencies'), 'dependency')) {
          const scope = textOf(dependency, 'scope') || 'compile';
          if (['test', 'system', 'import'].includes(scope) || textOf(dependency, 'optional') === 'true' || !textOf(dependency, 'version')) continue;
          try {
            readPom({ group: interpolate(textOf(dependency, 'groupId'), properties),
              artifact: interpolate(textOf(dependency, 'artifactId'), properties), version: interpolate(textOf(dependency, 'version'), properties) });
          } catch (error) { block('unresolved-dependency-metadata', { module: key, detail: error.message }); }
        }
      }
      return result;
    } catch (error) { block('unresolved-pom-metadata', { module: key, file: candidates[0], detail: error.message }); pomCache.set(cacheKey, null); visiting.delete(key); return null; }
  }
  const ivyCache = new Map(), ivyVisiting = new Set();
  function readIvy(module, path, repo) {
    const key = coordinate(checkedModule(module)) + '\0' + repo.root + '\0' + path;
    if (ivyCache.has(key)) return ivyCache.get(key);
    if (ivyVisiting.has(key)) { block('cyclic-ivy-metadata', { module: coordinate(module) }); return []; }
    ivyVisiting.add(key);
    const source = join(repo.root, relPath(path)), dest = add(source, 'ivy/' + path, null, 'ivy-metadata');
    const record = moduleRecord(module); let licenses = [];
    if (dest) {
      if (!record.metadata.includes(dest)) record.metadata.push(dest);
      try {
        const doc = xml(readFileSync(source, 'utf8')); assert.equal(doc.name, 'ivy-module');
        const info = child(doc, 'info'); assert.equal(info?.attributes.organisation, module.group); assert.equal(info.attributes.module, module.artifact); assert.equal(info.attributes.revision, module.version);
        licenses = children(info, 'license').filter(l => l.attributes.name).map(l => ({ kind: 'local-ivy-declaration', name: l.attributes.name, url: l.attributes.url ?? null, file: dest, sha256: files.get(dest).sha256 }));
        for (const extension of children(info, 'extends')) {
          const attributes = extension.attributes, parent = checkedModule({ group: attributes.organisation, artifact: attributes.module, version: attributes.revision });
          let parentPath;
          if (attributes.location) {
            assert.ok(!/^[A-Za-z]+:/u.test(attributes.location), 'remote Ivy parent location is not existing supply');
            const parentFile = resolve(dirname(source), attributes.location); assert.ok(within(repo.root, parentFile), 'Ivy parent outside explicit repository');
            parentPath = relPath(relative(repo.root, parentFile));
          } else {
            const parts = path.split('/'); parts[0] = parent.group; parts[1] = parent.artifact; parts[parts.length - 3] = parent.version; parentPath = parts.join('/');
          }
          const inherited = readIvy(parent, parentPath, repo); if (!licenses.length) licenses = inherited;
        }
        record.licenses.push(...licenses);
      } catch (error) { block('unresolved-ivy-metadata', { module: key, detail: error.message }); }
    }
    ivyVisiting.delete(key); ivyCache.set(key, licenses); return licenses;
  }
  for (const module of options.metadataModules ?? []) readPom(checkedModule(module));
  for (const record of [...modules.values()]) {
    if (!record.artifacts.length) continue;
    for (const loc of record.locations ?? []) {
      if (loc.repo.layout === 'ivy') {
        const path = loc.path.split('/').slice(0, -2).join('/') + '/ivys/ivy.xml';
        readIvy(record.module, path, loc.repo);
      } else readPom(record.module, null, loc.pomArtifact);
    }
  }
  for (const record of [...modules.values(), ...tools]) for (const file of record.artifacts) {
    if (!file.endsWith('.jar')) continue;
    const item = files.get(file), source = item.origins[0].file;
    try {
      const embedded = embeddedLicenseEvidence(source);
      if (file === 'launcher/sbt-launch.jar' && embedded.implementationVersion !== '1.4.4') block('launcher-implementation-mismatch', { actual: embedded.implementationVersion });
      for (const evidence of embedded.evidence) {
        const dest = inline('licenses/embedded/' + evidence.sha256 + '.txt', evidence.contentBase64, 'embedded-license-evidence', { file: source, jarSha256: item.sha256, entry: evidence.entry });
        const row = { kind: 'embedded-' + evidence.kind, entry: evidence.entry, file: dest, sha256: evidence.sha256, jarSha256: item.sha256 };
        (evidence.kind === 'license' ? record.licenses : record.notices).push(row);
      }
    } catch (error) { block('embedded-license-read-failed', { module: record.tool ?? coordinate(record.module), source, detail: error.message }); }
  }
  for (const record of [...modules.values(), ...tools]) if (record.artifacts.length && !record.licenses.length) block('missing-license-evidence', { module: record.tool ?? coordinate(record.module), artifacts: record.artifacts });
  for (const [key, expected] of Object.entries(FROZEN_RUNTIME)) {
    const record = modules.get(key), binary = record?.artifacts.find(f => basename(f) === key.split(':')[1] + '-' + key.split(':')[2] + '.jar');
    if (!binary) block('missing-frozen-runtime', { module: key, sha256: expected });
    else assert.equal(files.get(binary).sha256, expected, 'frozen runtime bytes changed');
  }

  // Separate ext tree; provenance must cover its full inventory, including newly added files.
  if (options.ext) {
    const ext = options.ext; plainSupplyPath(ext.root, { directory: true });
    assert.ok(within(bankRoot, ext.root) && !within(join(bankRoot, 'target'), ext.root) && !within(join(bankRoot, 'dist'), ext.root), 'ext must be bank source, never generated/dist');
    const provenance = json(ext.provenance); assert.equal(provenance.schemaVersion, 'bank-release-provenance/v1');
    assert.equal(provenance.handwritten?.root, ext.root, 'ext provenance root differs');
    const expected = normalizedInventory(provenance.handwritten.inventory);
    assert.deepEqual(inventory(ext.root), expected, 'complete ext provenance inventory differs (missing, changed, or extra file)');
    snapshots.push({ root: ext.root, destinationPrefix: 'ext/', inventory: expected });
    add(ext.provenance, 'evidence/ext-provenance.json', null, 'ext-provenance');
    for (const [file, hash] of Object.entries(expected)) add(join(ext.root, file), 'ext/' + file, hash, 'external-source');
  } else block('missing-ext-provenance');
  const platform = { os: process.platform, arch: process.arch };
  if (options.platform) assert.deepEqual(options.platform, platform, 'platform label must describe the actual capture host, not an unverified target');
  // This collection has no ARM/Linux proof and cannot certify even its local platform replay.
  return { schemaVersion: 'bank-existing-supply-discovery/v1', bankRoot, inputLock: lock,
    files: [...files.values()].sort((a, b) => a.file.localeCompare(b.file)), snapshots,
    artifacts, tools, modules: [...modules.values()].map(({ locations: unused, ...record }) => record).sort((a, b) => coordinate(a.module).localeCompare(coordinate(b.module))),
    unresolved, status: unresolved.length ? 'blocked' : 'existing-files-collected',
    scope: { existingFilesOnly: true, dependencyOverridesAppliedByCollector: [], networkUsed: false, generatedIncluded: false,
      platform, platformPortabilityVerified: false, cleanCacheVerified: false, relocationVerified: false,
      legalApproval: false, milestoneAccepted: false, pending: ['main release gate', 'clean-cache replay with no host fallback', 'moved-delivery verification', 'platform-specific acceptance'] } };
}

export function captureExistingSupply(discovery, { destination, bankRoot = BANK_ROOT } = {}) {
  assert.equal(discovery.schemaVersion, 'bank-existing-supply-discovery/v1'); assert.equal(discovery.bankRoot, bankRoot);
  supplyDestination(bankRoot, destination);
  assert.ok(Array.isArray(discovery.files)); assert.equal(new Set(discovery.files.map(f => f.file)).size, discovery.files.length, 'duplicate capture destination');
  // Finish ALL preflights before mkdir/copy. Snapshot checks catch newly added unlisted artifacts.
  const byFile = new Map(discovery.files.map(f => [f.file, f]));
  for (const snapshot of discovery.snapshots) {
    assert.deepEqual(inventory(snapshot.root), snapshot.inventory, 'source inventory changed since discovery');
    for (const [file, hash] of Object.entries(snapshot.inventory)) {
      const mapped = byFile.get(snapshot.destinationPrefix + file);
      assert.ok(mapped && mapped.sha256 === hash && mapped.origins.some(o => o.file === join(snapshot.root, file)), 'complete snapshot mapping required');
    }
  }
  for (const artifact of discovery.artifacts) {
    if (artifact.file) assert.equal(byFile.get(artifact.file)?.sha256, digest(artifact.sha256), 'complete artifact mapping required');
    else assert.ok(discovery.unresolved.some(u => [artifact.source, artifact.repositorySource].includes(u.file) && ['missing-local-file', 'unmapped-artifact-origin'].includes(u.code)), 'unmapped artifact must remain blocked');
  }
  for (const record of [...discovery.modules, ...discovery.tools]) for (const file of [...record.artifacts, ...record.metadata, ...record.licenses.map(l => l.file), ...record.notices.map(l => l.file)]) assert.ok(byFile.has(file), 'complete module/evidence mapping required');
  for (const item of discovery.files) {
    relPath(item.file); assert.ok(['maven', 'ivy', 'boot', 'launcher', 'ext', 'licenses', 'evidence'].includes(item.file.split('/')[0]), 'generated/non-supply output forbidden');
    digest(item.sha256); assert.ok(item.origins.length > 0, 'local origin required');
    if (Object.hasOwn(item, 'contentBase64')) { const bytes = Buffer.from(item.contentBase64, 'base64'); assert.equal(sha(bytes), item.sha256); assert.equal(bytes.length, item.bytes); }
    else for (const origin of item.origins) { plainSupplyPath(origin.file); assert.equal(fileSha(origin.file), item.sha256, 'source changed since discovery'); assert.equal(lstatSync(origin.file).size, item.bytes); }
  }
  mkdirSync(destination); // exclusive, never recursive, never remove a partial capture
  for (const item of discovery.files) {
    const target = join(destination, item.file), parent = dirname(target);
    mkdirSync(parent, { recursive: true }); plainSupplyPath(target, { fresh: true });
    if (Object.hasOwn(item, 'contentBase64')) writeFileSync(target, Buffer.from(item.contentBase64, 'base64'), { flag: 'wx', mode: item.mode });
    else copyFileSync(item.origins[0].file, target, constants.COPYFILE_EXCL);
    assert.equal(fileSha(target), item.sha256, 'captured bytes differ');
  }
  for (const snapshot of discovery.snapshots) assert.deepEqual(inventory(snapshot.root), snapshot.inventory, 'source inventory changed during capture');
  const expected = Object.fromEntries(discovery.files.map(f => [f.file, f.sha256]));
  assert.deepEqual(inventory(destination, Math.max(4096, discovery.files.length + 1)), normalizedInventory(expected), 'complete capture inventory differs');
  const manifest = { ...discovery, schemaVersion: 'bank-existing-supply-manifest/v1', destination,
    files: discovery.files.map(({ contentBase64: unused, ...item }) => item), captureVerified: true,
    // A manifest never turns missing requirements into green, even if copying completed.
    status: discovery.unresolved.length ? 'captured-blocked' : 'captured-awaiting-main-gate' };
  const manifestFile = join(destination, 'SUPPLY-MANIFEST.json');
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return { destination, manifest: manifestFile, manifestSha256: fileSha(manifestFile), files: discovery.files.length,
    unresolved: manifest.unresolved, status: manifest.status, milestoneAccepted: false };
}

export const cliUsage = `Usage: node tools/v1-release-supply.mjs --config /absolute/config.json [--capture /absolute/bank/.scratch/p26-p32-bank-v1-OWNER/supply-ID]
Without --capture: read-only discovery JSON on stdout; exit 2 if unresolved. With --capture: fresh scratch supply only, exit 2 if captured-blocked.
Config (all file/root paths normalized absolute; hashes raw SHA256 or sha256: prefixed):
  bankRoot, updateReports:[{role:"app"|"meta",file,sha256?}], inputLock?:extractUpdateLock(updateReports), dependencyOverrides:[],
  repositories:[{layout:"maven"|"ivy",root}], p23:{root}, ext:{root,provenance}, platform:{os:"darwin",arch:"x64"},
  bootstrap:{version:"1.4.9",scalaVersion:"2.12.12",baseRoot,
    directories:[{path:"scala-2.12.12/lib",inventory:{relativeFile:sha256}},
      {path:"scala-2.12.12/org.scala-sbt/sbt/1.4.9",inventory:{relativeFile:sha256}}],
    artifacts:[{file:bootJar,repositoryFile:existingMavenCounterpart,sha256,module:{group,artifact,version}}]},
  protoc:[{file:existingPlatformExecutable,sha256,module:{group:"com.google.protobuf",artifact:"protoc",version}}],
  launcher:{file:existingLauncher,sha256,implementationVersion:"1.4.4",module?:{group,artifact,version},repositoryFile?:existingPublishedCounterpart}
Repository roots are also derived from exact Coursier maven2/sbt-plugin-releases artifact paths; no host-cache search.
Boot/protoc/launcher are explicit locks because app/meta update reports do not inventory those executables. All boot JARs require matching existing repository counterparts.
Unresolved parent/BOM/plugin/license supply stays blocked. Main owns generation, path rebinding, builds, clean-cache/move testing and dist acceptance.`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), flags = {};
    if (args.length === 1 && args[0] === '--help') { process.stdout.write(cliUsage + '\n'); }
    else {
      for (let i = 0; i < args.length; i += 2) { assert.ok(['--config', '--capture'].includes(args[i]) && args[i + 1] && !flags[args[i]], 'unknown, duplicate, or missing CLI flag'); flags[args[i]] = args[i + 1]; }
      assert.ok(flags['--config'], cliUsage);
      const options = json(flags['--config']), discovery = discoverExistingSupply(options);
      const result = flags['--capture'] ? captureExistingSupply(discovery, { destination: flags['--capture'], bankRoot: options.bankRoot ?? BANK_ROOT }) : discovery;
      process.stdout.write(JSON.stringify(result, null, 2) + '\n'); if (result.unresolved.length) process.exitCode = 2;
    }
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
