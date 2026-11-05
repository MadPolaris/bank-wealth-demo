import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { startDatabaseRelay } from './truthsrc-runtime-db-relay.mjs';

const IMAGES = Object.freeze({ mysql: 'sha256:8eccfc5e5aebbf3a49375b13956a88cd244d13ac6b25b52dec792b7526363b19',
  mongo: 'sha256:0010f63d26952bd3960fac5513c64a1cf7d6299f31fa7b54ac1b36633ee04333' });
const LABEL = 'bank.owner', RUN = 'bank.runtime', MAX_OUTPUT = 16 * 1024 * 1024;
const require = (ok, message = 'Owned database operation rejected.') => { if (!ok) throw new Error(message); };
const id = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(done => setTimeout(done, ms));
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' :
  value !== null && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value);
const databaseName = name => require(typeof name === 'string' && /^[a-z][a-z0-9_]{0,59}$/.test(name) &&
  !['admin', 'local', 'config', 'mysql', 'sys', 'information_schema', 'performance_schema'].includes(name), 'Invalid application database name.');
const inspectFormat = '{"id":{{json .Id}},"owner":{{json (index .Config.Labels "bank.owner")}},"run":{{json (index .Config.Labels "bank.runtime")}}}';

// Mongo 4.4 shell renders BSON values losslessly. Keep each rendered document as
// an opaque string in outer JSON; never eval it or coerce Long/Binary to JS values.
const MONGO_SCRIPT = `function control(operation) {
  try {
    var admin = new Mongo('127.0.0.1:27017').getDB('admin');
    if (!admin.auth(cat('/run/secrets/root-user'), cat('/run/secrets/root-password'))) quit(2);
    if (admin.runCommand({getCmdLineOpts: 1}).parsed.security.authorization !== 'enabled') quit(2);
    if (operation.kind === 'initialize') {
      if (admin.runCommand({createUser: cat('/run/secrets/app-user'), pwd: cat('/run/secrets/app-password'), roles: ['readWriteAnyDatabase']}).ok !== 1) quit(2);
    } else if (operation.kind === 'snapshot') {
      var probe = tojsononeline({long: new NumberLong('9223372036854775807'), binary: new BinData(0, 'AAEC'), decimal: new NumberDecimal('123.4500')});
      if (probe.indexOf('9223372036854775807') < 0 || probe.indexOf('AAEC') < 0 || probe.indexOf('123.4500') < 0) throw new Error('BSON rendering lost exact data');
      var database = admin.getSiblingDB(operation.database);
      var collections = database.getCollectionNames().filter(function(n) { return n.indexOf('system.') !== 0; }).sort();
      print(JSON.stringify(collections.map(function(name) {
        var docs = []; database.getCollection(name).find({}).maxTimeMS(10000).forEach(function(doc) { docs.push(tojsononeline(doc)); });
        return {name: name, documents: docs};
      }))); return;
    }
    if (admin.runCommand({ping: 1}).ok !== 1) quit(2);
    print('{"ok":1}');
  } catch (_) { quit(2); }
}
`;

// Docker control deliberately does not use the JVM sandbox runner. Only bounded
// memory is captured; raw Docker output, stdin and exceptions never reach receipts.
function dockerCommand(spawnImpl, executable, args, input, timeoutMs, configDirectory) {
  return new Promise(resolveResult => {
    let child, timer, killTimer, reapTimer, size = 0, failed = false, ended = false;
    const chunks = [];
    const finish = code => {
      if (ended) return; ended = true;
      [timer, killTimer, reapTimer].forEach(clearTimeout);
      resolveResult({ code: failed ? null : code, stdout: failed ? '' : Buffer.concat(chunks).toString('utf8') });
    };
    const terminate = () => {
      if (failed || ended) return; failed = true;
      try { child.kill('SIGTERM'); } catch { /* reap below */ }
      killTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* bounded reap below */ }
        reapTimer = setTimeout(() => { child.stdout?.destroy(); child.stderr?.destroy(); child.stdin?.destroy(); }, 1000);
      }, 1000);
    };
    try {
      child = spawnImpl(executable, args, { env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', DOCKER_CONFIG: configDirectory }, stdio: ['pipe', 'pipe', 'pipe'] });
      child.once('error', () => { failed = true; finish(null); });
      child.once('close', finish);
      for (const [stream, keep] of [[child.stdout, true], [child.stderr, false]]) {
        stream.on('data', data => { size += data.length; if (size > MAX_OUTPUT) terminate(); else if (keep && !failed) chunks.push(Buffer.from(data)); });
        stream.on('error', terminate);
      }
      child.stdin.on('error', terminate);
      timer = setTimeout(terminate, timeoutMs);
      child.stdin.end(input);
    } catch { if (child) terminate(); else { failed = true; finish(null); } }
  });
}

/**
 * start() -> {mysql:{host,port,username,password,containerId,rootPasswordFile,
 *   rootDefaultsFile,containerRootDefaultsFile}, mongo:{host,port,username,password,
 *   authSource,uri,containerId}}. These are PRIVATE in-memory config, never receipts.
 * createSchema(name) -> {name,jdbcUrl,username,password}; names chosen by controller.
 * mongoSnapshot(name) -> {collections:[{name,count,sha256}],sha256}; quiesce writers
 * first for a cross-collection comparison (this is not a transactional snapshot).
 * credentialsList includes fresh actual/URI-encoded values plus optional secrets[].
 * Tests may inject runner({executable,args,input,timeoutMs}) -> {code,stdout,stderr?},
 * or spawnImpl. Neither injection is a production sandbox/security boundary.
 */
export class OwnedRuntimeDatabases {
  #options; #credentials; #token = randomBytes(12).toString('hex'); #containers = new Map(); #networks = [];
  #private; #receiptFd; #state = 'new'; #startPromise; #stopPromise; #schemas = new Set(); #unresolved = new Set(); #controlHashes = {}; #commands = []; #relays = [];
  constructor({ evidence, owner, mysqlPort = 18762, mongoPort = 18763, docker = '/usr/local/bin/docker', secrets = [],
    runner, spawnImpl = spawn, commandTimeoutMs = 15000, readyAttempts = 320, wait = delay, signal, relayFactory = startDatabaseRelay } = {}) {
    require(typeof owner === 'string' && /^[a-z][a-z0-9_-]{0,59}$/.test(owner), 'Invalid database owner namespace.');
    for (const path of [evidence, docker]) require(typeof path === 'string' && isAbsolute(path) && resolve(path) === path && !/[\0\r\n,]/.test(path), 'Canonical absolute paths required.');
    require([mysqlPort, mongoPort].every(p => Number.isInteger(p) && p > 1024 && p <= 65535 && ![9000, 2551, 27017, 3306].includes(p)) && mysqlPort !== mongoPort, 'Invalid or reserved database ports.');
    require(Array.isArray(secrets) && secrets.every(s => typeof s === 'string' && s.length > 0), 'Invalid supplemental secrets.');
    require(![owner, evidence, docker].some(value => secrets.some(s => [s, encodeURI(s), encodeURIComponent(s)].some(secret => value.includes(secret)))), 'Secret forbidden in metadata.');
    require((runner === undefined || typeof runner === 'function') && typeof spawnImpl === 'function' && typeof wait === 'function');
    require(Number.isInteger(commandTimeoutMs) && commandTimeoutMs > 0 && commandTimeoutMs <= 60000 && Number.isInteger(readyAttempts) && readyAttempts > 0 && readyAttempts <= 320);
    require(signal === undefined || signal instanceof AbortSignal, 'Invalid cancellation signal.');
    this.#options = { evidence, owner, mysqlPort, mongoPort, docker, secrets: [...secrets], runner, spawnImpl, commandTimeoutMs, readyAttempts, wait, signal, relayFactory };
    const password = () => randomBytes(32).toString('hex'), username = () => 'bank_' + randomBytes(10).toString('hex');
    this.#credentials = { mysql: { username: username(), password: password(), rootPassword: password() },
      mongo: { username: username(), password: password(), rootUsername: username(), rootPassword: password() } };
  }
  get credentialsList() {
    return [...new Set([...Object.values(this.#credentials).flatMap(Object.values), ...this.#options.secrets].flatMap(s => [s, encodeURI(s), encodeURIComponent(s)]))];
  }
  get readOnlyPaths() { return [join(this.#options.evidence, 'private'), join(this.#options.evidence, 'mysql-data'), join(this.#options.evidence, 'mongo-data')]; }
  assertControlsUnchanged() {
    for (const [file, sha256] of Object.entries(this.#controlHashes)) {
      require(realpathSync(file) === file && lstatSync(file).isFile() && lstatSync(file).nlink === 1, 'Database control identity changed.');
      require(hash(readFileSync(file)) === sha256, 'Database control bytes changed.');
    }
  }
  #captureControls() {
    const visit = root => {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        const file = join(root, entry.name);
        require(!entry.isSymbolicLink(), 'Database control symlink.');
        if (entry.isDirectory()) visit(file);
        else this.#controlHashes[file] = hash(readFileSync(file));
      }
    };
    visit(this.#private);
  }
  async #command(args, input = '') {
    const o = this.#options, argv = ['--host', 'unix:///var/run/docker.sock', ...args];
    require(![o.docker, ...argv].some(value => this.credentialsList.some(secret => value.includes(secret))), 'Secret forbidden in Docker arguments.');
    try {
      const result = await (o.runner ? o.runner({ executable: o.docker, args: argv, input, timeoutMs: o.commandTimeoutMs }) :
        dockerCommand(o.spawnImpl, o.docker, argv, input, o.commandTimeoutMs, join(this.#private, 'docker-config')));
      this.#commands.push({ command: [o.docker, ...argv], code: result?.code ?? null });
      require(result?.code === 0 && !result.timedOut && typeof result.stdout === 'string' && Buffer.byteLength(result.stdout) <= MAX_OUTPUT);
      return result.stdout.trim();
    } catch { throw new Error('Owned Docker command failed.'); }
  }
  async #owned(kind) {
    const container = this.#containers.get(kind); require(container && id(container));
    const inspected = JSON.parse(await this.#command(['container', 'inspect', '--format', inspectFormat, container]));
    require(inspected.id === container && inspected.owner === this.#options.owner && inspected.run === this.#token, 'Container ownership verification failed.');
    return container;
  }
  async #sql(input) {
    return this.#command(['exec', '-i', await this.#owned('mysql'), 'mysql', '--defaults-extra-file=/run/secrets/client.cnf', '--batch', '--skip-column-names'], input);
  }
  async #mongo(operation) {
    // Only nonsecret script text enters command substitution; passwords are read by
    // the mounted script, not expanded by the shell, Docker argv or environment.
    return this.#command(['exec', '-i', await this.#owned('mongo'), 'sh', '-c', 'exec mongo --quiet --norc --nodb --eval "$(cat)"'],
      'load("/run/secrets/control.js"); control(' + JSON.stringify(operation) + ');\n');
  }
  start() {
    require(this.#state === 'new', 'Databases can only be started once.'); this.#state = 'starting';
    this.#startPromise = this.#start(); return this.#startPromise;
  }
  async #start() {
    const o = this.#options;
    try {
      require(realpathSync(o.evidence) === o.evidence && lstatSync(o.evidence).isDirectory(), 'Evidence must be an existing plain directory.');
      this.#receiptFd = openSync(join(o.evidence, 'database-stop.json'), 'wx', 0o600);
      const privateRoot = join(o.evidence, 'private');
      try { mkdirSync(privateRoot, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      require(realpathSync(privateRoot) === privateRoot && lstatSync(privateRoot).isDirectory() && (lstatSync(privateRoot).mode & 0o777) === 0o700 && lstatSync(privateRoot).uid === process.getuid());
      this.#private = join(privateRoot, 'databases-' + this.#token); mkdirSync(this.#private, { mode: 0o700 });
      mkdirSync(join(this.#private, 'docker-config'), { mode: 0o700 });
      for (const kind of ['mysql', 'mongo']) {
        mkdirSync(join(o.evidence, kind + '-data'), { mode: 0o700 });
        const directory = join(this.#private, kind); mkdirSync(directory, { mode: 0o700 });
        const c = this.#credentials[kind], write = (name, text) => writeFileSync(join(directory, name), text, { flag: 'wx', mode: 0o600 });
        write('root-password', c.rootPassword); write('app-password', c.password); write('app-user', c.username);
        if (kind === 'mysql') write('client.cnf', '[client]\nuser=root\nprotocol=SOCKET\nsocket=/tmp/mysql.sock\npassword=' + c.rootPassword + '\n');
        else { write('root-user', c.rootUsername); write('control.js', MONGO_SCRIPT); }
        require(await this.#command(['image', 'inspect', '--format', '{{.Id}}', IMAGES[kind]]) === IMAGES[kind], 'Cached image ID mismatch.');
      }
      o.signal?.throwIfAborted();
      for (const kind of ['mysql', 'mongo']) {
        o.signal?.throwIfAborted();
        const name = 'truthsrc-runtime-20261105-' + this.#token.slice(0, 12) + '-' + kind, label = ['--label', LABEL + '=' + o.owner, '--label', RUN + '=' + this.#token];
        const network = await this.#command(['network', 'create', '--driver', 'bridge', '--internal', ...label, name]);
        require(id(network)); this.#networks.push(network);
        const cidfile = join(this.#private, kind + '.cid'), directory = join(this.#private, kind);
        const env = kind === 'mysql' ? ['-e', 'MYSQL_ROOT_PASSWORD_FILE=/run/secrets/root-password', '-e', 'MYSQL_ROOT_HOST=localhost'] :
          ['-e', 'MONGO_INITDB_ROOT_USERNAME_FILE=/run/secrets/root-user', '-e', 'MONGO_INITDB_ROOT_PASSWORD_FILE=/run/secrets/root-password'];
        o.signal?.throwIfAborted();
        this.#unresolved.add(name);
        try {
          const container = await this.#command(['run', '--detach', '--pull=never', '--name', name, '--cidfile', cidfile, ...label,
            '--network', network, '--user', process.getuid() + ':' + process.getgid(),
            '--mount', 'type=bind,src=' + join(o.evidence, kind + '-data') + ',dst=' + (kind === 'mysql' ? '/var/lib/mysql' : '/data/db'),
            '--mount', 'type=bind,src=' + directory + ',dst=/run/secrets,readonly', ...env, IMAGES[kind],
            ...(kind === 'mysql' ? ['--secure-file-priv=NULL', '--socket=/tmp/mysql.sock', '--pid-file=/tmp/mysql.pid'] : ['mongod', '--auth', '--bind_ip_all'])]);
          require(id(container)); this.#containers.set(kind, container); this.#unresolved.delete(name);
        } finally {
          // Docker writes this newly reserved path even if its client fails after create.
          try { const captured = readFileSync(cidfile, 'utf8').trim(); if (id(captured)) { this.#containers.set(kind, captured); this.#unresolved.delete(name); } chmodSync(cidfile, 0o600); } catch { /* unresolved creations remain failed, never claimed by name */ }
        }
        const readyDeadline = Date.now() + 180_000;
        let ready = false;
        for (let attempt = 0; attempt < o.readyAttempts && !ready && Date.now() < readyDeadline; attempt++) {
          o.signal?.throwIfAborted();
          try { ready = kind === 'mysql' ? await this.#sql("SELECT @@global.skip_networking;\n") === '0' : await this.#mongo({ kind: 'ping' }) === '{"ok":1}'; } catch { /* bounded readiness retry */ }
          if (!ready && attempt + 1 < o.readyAttempts) await o.wait(500);
        }
        require(ready, 'Owned database readiness failed.');
        if (kind === 'mysql') {
          const c = this.#credentials.mysql;
          await this.#sql("CREATE USER 'root'@'%' IDENTIFIED BY '" + c.rootPassword + "';\nGRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;\nCREATE USER '" + c.username + "'@'%' IDENTIFIED BY '" + c.password + "';\n");
        } else require(await this.#mongo({ kind: 'initialize' }) === '{"ok":1}');
        o.signal?.throwIfAborted();
        const relay = await o.relayFactory({ docker: o.docker, containerId: await this.#owned(kind), hostPort: o[kind + 'Port'],
          containerPort: kind === 'mysql' ? 3306 : 27017, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', DOCKER_CONFIG: join(this.#private, 'docker-config') } });
        this.#relays.push(relay);
      }
      this.#captureControls();
      this.#state = 'ready';
      const mysql = this.#credentials.mysql, mongo = this.#credentials.mongo;
      return { mysql: { host: '127.0.0.1', port: o.mysqlPort, username: mysql.username, password: mysql.password, containerId: this.#containers.get('mysql'),
        rootPasswordFile: join(this.#private, 'mysql/root-password'), rootDefaultsFile: join(this.#private, 'mysql/client.cnf'), containerRootDefaultsFile: '/run/secrets/client.cnf' },
      mongo: { host: '127.0.0.1', port: o.mongoPort, username: mongo.username, password: mongo.password, authSource: 'admin', containerId: this.#containers.get('mongo'),
        uri: 'mongodb://' + encodeURIComponent(mongo.username) + ':' + encodeURIComponent(mongo.password) + '@127.0.0.1:' + o.mongoPort + '/?authSource=admin' } };
    } catch {
      await this.#shutdown(); throw new Error('Owned database start failed; inspect database-stop.json.');
    }
  }
  async createSchema(name) {
    databaseName(name); require(this.#state === 'ready' && !this.#schemas.has(name), 'Schema must be new and databases ready.');
    this.#options.signal?.throwIfAborted(); this.assertControlsUnchanged();
    // Backtick quoting alone does NOT escape MySQL database-grant '_' wildcards.
    const c = this.#credentials.mysql, grant = name.replaceAll('_', '\\_');
    try { await this.#sql('CREATE DATABASE `' + name + '`;\nGRANT ALL PRIVILEGES ON `' + grant + "`.* TO '" + c.username + "'@'%';\n"); }
    catch { throw new Error('Owned schema creation failed.'); }
    this.#schemas.add(name);
    return { name, jdbcUrl: 'jdbc:mysql://127.0.0.1:' + this.#options.mysqlPort + '/' + name + '?useSSL=false&allowPublicKeyRetrieval=true', username: c.username, password: c.password };
  }
  async mongoSnapshot(database) {
    databaseName(database); require(this.#state === 'ready');
    this.#options.signal?.throwIfAborted(); this.assertControlsUnchanged();
    try {
      const raw = JSON.parse(await this.#mongo({ kind: 'snapshot', database })); require(Array.isArray(raw));
      const seen = new Set(), collections = raw.map(({ name, documents }) => {
        require(typeof name === 'string' && /^[A-Za-z0-9_.-]{1,255}$/.test(name) && !name.startsWith('system.') && !seen.has(name) && Array.isArray(documents));
        require(!this.credentialsList.some(secret => name.includes(secret))); seen.add(name);
        return { name, count: documents.length, sha256: hash('[' + documents.map(canonical).sort().join(',') + ']') };
      }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      return { collections, sha256: hash(canonical(collections)) };
    } catch { throw new Error('Owned Mongo snapshot failed.'); }
  }
  async stop() { if (this.#startPromise) await this.#startPromise.catch(() => {}); return this.#shutdown(); }
  #shutdown() {
    if (this.#stopPromise) return this.#stopPromise;
    this.#state = 'stopping';
    this.#stopPromise = (async () => {
      const relays = [];
      for (const relay of this.#relays) {
        try { relays.push(await relay.close()); } catch { relays.push({ closed: false }); }
      }
      const containers = [];
      for (const [kind, containerId] of this.#containers) {
        let stopped = false;
        try {
          await this.#command(['stop', '--time', '10', await this.#owned(kind)]);
          const running = await this.#command(['container', 'inspect', '--format', '{{.State.Running}}', containerId]);
          stopped = running === 'false';
        } catch { /* fixed public failure only */ }
        containers.push({ kind, containerId, stopped });
      }
      let controlsUnchanged = true;
      try { this.assertControlsUnchanged(); } catch { controlsUnchanged = false; }
      const receipt = { schemaVersion: 'bank.truthsrc-runtime-databases/v1', owner: this.#options.owner,
        containers, relays, networks: [...this.#networks], commands: this.#commands, unresolvedCreations: [...this.#unresolved], controlsUnchanged,
        preserved: true, stopped: containers.every(c => c.stopped) && relays.every(r => r.closed) && this.#unresolved.size === 0 && controlsUnchanged };
      this.#state = 'stopped';
      if (this.#receiptFd !== undefined) {
        const fd = this.#receiptFd; this.#receiptFd = undefined;
        try { require(fstatSync(fd).isFile()); writeFileSync(fd, JSON.stringify(receipt, null, 2) + '\n'); fsyncSync(fd); }
        finally { closeSync(fd); }
      }
      return receipt;
    })();
    return this.#stopPromise;
  }
}
