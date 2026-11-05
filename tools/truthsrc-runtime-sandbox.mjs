import assert from 'node:assert/strict';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BANK = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HISTORICAL = ['tree', 'v1/tree', '.scratch', 'dist/v1', 'tools/truth-source.mjs'].map(p => join(BANK, p));
const inside = (root, file) => file.toLowerCase() === root.toLowerCase() || file.toLowerCase().startsWith(root.toLowerCase() + '/');
const overlap = (a, b) => inside(a, b) || inside(b, a);
const quote = JSON.stringify;
export const RUNTIME_NETWORK_SCOPE = 'host-local-reserved-ports';
export const RUNTIME_NETWORK_LIMITATION = 'Seatbelt localhost includes wildcard and configured local interface addresses. Fixed source and actual listener checks separately require 127.0.0.1; this is not a hostile-code exact-IPv4 boundary.';

function plain(file) {
  assert.ok(typeof file === 'string' && /^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(file) && resolve(file) === file,
    'canonical plain absolute path required');
  assert.ok(!file.split('/').some(p => ['.', '..', '.scratch'].includes(p.toLowerCase())), 'forbidden path component');
  return file;
}
function port(value) {
  assert.ok(Number.isSafeInteger(value) && value > 1024 && value <= 65535 && ![9000, 2551, 3306, 27017].includes(value), 'explicit unprivileged nonshared port required');
}
function writable(root) {
  plain(root);
  const bankRound = [join(BANK, 'target'), join(BANK, '.local/mock-ta')].some(p => inside(p, root) && !inside(root, p));
  const temporaryRound = /^\/private\/(?:tmp\/[^/]+|var\/tmp\/[^/]+|var\/folders\/[^/]+\/[^/]+\/T\/[^/]+)(?:\/|$)/.test(root);
  assert.ok(bankRound || temporaryRound, 'write root must be a separate bank target/TA round or canonical temporary round');
  assert.ok(!HISTORICAL.some(p => overlap(root, p)), 'write root overlaps protected history');
  assert.ok(!root.split('/').some(p => ['compile', 'classpath', 'classes', 'test-classes'].includes(p.toLowerCase())), 'compile/classpath cannot be writable');
}
function admitted({ evidence, taRoot, readOnlyFiles, httpPort, databasePorts = [], networkScope = 'deny-all' }) {
  writable(evidence); writable(taRoot);
  assert.ok(!overlap(evidence, taRoot), 'write roots must not overlap');
  assert.ok(Array.isArray(readOnlyFiles) && readOnlyFiles.length > 0, 'explicit readOnlyFiles required');
  for (const file of readOnlyFiles) plain(file);
  assert.equal(new Set(readOnlyFiles.map(p => p.toLowerCase())).size, readOnlyFiles.length, 'duplicate read-only path');
  assert.ok(!readOnlyFiles.some(p => inside(p, evidence) || inside(p, taRoot)), 'read-only root overlaps a write root');
  for (let i = 0; i < readOnlyFiles.length; i++) assert.ok(!readOnlyFiles.slice(i + 1).some(p => overlap(p, readOnlyFiles[i])), 'read-only paths must not overlap');
  port(httpPort);
  assert.ok(Array.isArray(databasePorts), 'databasePorts must be an array');
  for (const value of databasePorts) port(value);
  assert.equal(new Set([httpPort, ...databasePorts]).size, databasePorts.length + 1, 'ports must be unique');
  assert.ok(['deny-all', RUNTIME_NETWORK_SCOPE].includes(networkScope), 'unsupported runtime network scope');
  return { evidence, taRoot, readOnlyFiles: [...readOnlyFiles], httpPort, databasePorts: [...databasePorts].sort((a, b) => a - b), networkScope };
}

export function runtimeSandboxText(options) {
  const { evidence, taRoot, httpPort, databasePorts, readOnlyFiles, networkScope } = admitted(options);
  const immutable = [...new Set([...readOnlyFiles, ...['sandbox.sb', 'runtime-sandbox.sb', 'probe.py', 'runtime-probe.py'].map(p => join(evidence, p))])].sort();
  const ancestors = new Set([evidence, taRoot]);
  for (const file of immutable) for (let p = dirname(file); [evidence, taRoot].some(root => inside(root, p)); p = dirname(p)) ancestors.add(p);
  const endpoint = (direction, p) => `(${direction} tcp4 "localhost:${p}")`;
  return ['(version 1)', '(allow default)', '(deny network*)', '(deny file-write*)',
    `(allow file-write* (subpath ${quote(evidence)}) (subpath ${quote(taRoot)}) (literal "/dev/null"))`,
    ...(networkScope === 'deny-all' ? [] : [
      `(allow network-bind ${endpoint('local', httpPort)})`,
      `(allow network-inbound ${endpoint('local', httpPort)})`,
      `(allow network-outbound ${[httpPort, ...databasePorts].map(p => endpoint('remote', p)).join(' ')})`,
    ]),
    `(deny file-read* ${HISTORICAL.map(p => `(subpath ${quote(p)})`).join(' ')})`,
    `(deny file-write* ${immutable.map(p => `(subpath ${quote(p)})`).join(' ')})`,
    '(deny file-write* (regex #"[.](class|jar)$"))',
    `(deny file-write-unlink ${[...ancestors].sort().map(p => `(literal ${quote(p)})`).join(' ')})`, '',
  ].join('\n');
}
export function runtimeDenialSandboxText(options) { return runtimeSandboxText({ ...options, networkScope: 'deny-all' }); }

export function validateRuntimeSandboxPaths(options) {
  const spec = admitted(options);
  for (const file of [spec.evidence, spec.taRoot, ...spec.readOnlyFiles]) {
    let current = '/';
    for (const part of file.slice(1).split('/')) {
      current = join(current, part);
      let stat;
      try { stat = lstatSync(current); }
      catch (error) { if (error.code === 'ENOENT' && file !== spec.evidence && file !== spec.taRoot) break; throw error; }
      assert.ok(!stat.isSymbolicLink() && realpathSync(current) === current, 'symlink or filesystem alias forbidden');
      assert.ok(current === file ? stat.isDirectory() || stat.isFile() && stat.nlink === 1 : stat.isDirectory(), 'plain file/directory required');
      if (file === spec.evidence || file === spec.taRoot) assert.ok(stat.isDirectory(), 'write root must be a directory');
    }
  }
  return true;
}

export function runtimeProbeSource({ canary, positiveNetwork = false, probeName = 'runtime-probe-write', ...options }) {
  assert.match(probeName, /^[a-z][a-z0-9-]{0,80}$/);
  const { evidence, taRoot, httpPort, databasePorts, readOnlyFiles, networkScope } = admitted(options);
  plain(canary);
  assert.ok(![evidence, taRoot].some(root => overlap(root, canary)) && !HISTORICAL.some(p => overlap(p, canary)), 'outside owned canary required');
  assert.equal(typeof positiveNetwork, 'boolean');
  assert.ok(!positiveNetwork || networkScope === RUNTIME_NETWORK_SCOPE, 'positive probe needs explicit registered-port scope');
  return `import errno, os, signal, socket, subprocess, sys
signal.alarm(20)
os.chdir(${quote(evidence)})
def denied(label, action):
    try: action()
    except OSError as error:
        assert error.errno in (errno.EPERM, errno.EACCES), label + ' wrong errno=' + str(error.errno)
        print('DENIED ' + label + ' errno=' + str(error.errno), flush=True)
        return
    raise RuntimeError('UNSAFE allowed ' + label)
def network(family, address, operation, kind=socket.SOCK_STREAM):
    with socket.socket(family, kind) as sock:
        sock.settimeout(0.5)
        if operation == 'bind': sock.bind(address)
        elif operation == 'send': sock.sendto(b'x', address)
        else: sock.connect(address)
def write_attempt(file):
    with open(file, 'ab', buffering=0) as stream: stream.write(b'UNSAFE')
for family, host, label in [(socket.AF_INET, '127.0.0.1', 'ipv4'), (socket.AF_INET6, '::1', 'ipv6')]:
    for operation in ('connect', 'bind'):
        denied(label + '-' + operation, lambda: network(family, (host, 1), operation))
for operation in ('connect', 'bind'):
    denied('ipv6-http-' + operation, lambda: network(socket.AF_INET6, ('::1', ${httpPort}), operation))
denied('unix-bind', lambda: network(socket.AF_UNIX, 'denied.sock', 'bind'))
denied('remote-connect', lambda: network(socket.AF_INET, ('192.0.2.1', ${httpPort}), 'connect'))
for p in [53, ${httpPort}]:
    denied('udp-' + str(p), lambda: network(socket.AF_INET, ('127.0.0.1', p), 'send', socket.SOCK_DGRAM))
for p in ${quote(databasePorts)}:
    denied('database-bind-' + str(p), lambda: network(socket.AF_INET, ('127.0.0.1', p), 'bind'))
${networkScope === 'deny-all' ? `for host in ['127.0.0.1', '0.0.0.0']:
    denied('http-bind-' + host, lambda: network(socket.AF_INET, (host, ${httpPort}), 'bind'))` : ''}
denied('outside-write', lambda: write_attempt(${quote(canary)}))
for suffix in ['class', 'jar']:
    denied('new-' + suffix, lambda: write_attempt(os.path.join(${quote(evidence)}, 'must-not-create.' + suffix)))
for i, file in enumerate(${quote(readOnlyFiles)}):
    if os.path.isdir(file): denied('readonly-' + str(i), lambda: write_attempt(os.path.join(file, 'must-not-create')))
    else: denied('readonly-' + str(i), lambda: write_attempt(file))
for i, file in enumerate(${quote(HISTORICAL)}):
    denied('historical-read-' + str(i), lambda: os.stat(file))
if len(sys.argv) == 1:
    for i, root in enumerate(${quote([evidence, taRoot])}):
        with open(os.path.join(root, ${quote(probeName)}), 'xb') as stream: stream.write(b'owned-write-allowed\\n')
        print('ALLOWED owned-write-' + str(i), flush=True)
with open('/dev/null', 'wb') as stream: stream.write(b'x')
if ${positiveNetwork ? 'True' : 'False'} and len(sys.argv) == 1:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.settimeout(0.5)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind(('127.0.0.1', ${httpPort}))
        server.listen(1)
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as client:
            client.settimeout(0.5)
            client.connect(('127.0.0.1', ${httpPort}))
            peer, address = server.accept()
            with peer:
                peer.settimeout(0.5)
                client.sendall(b'p')
                assert peer.recv(1) == b'p'
    print('ALLOWED ipv4-http-roundtrip', flush=True)
    for p in ${quote(databasePorts)}:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as client:
            client.settimeout(0.5)
            client.connect(('127.0.0.1', p))
        print('ALLOWED database-connect-' + str(p), flush=True)
if len(sys.argv) < 3:
    subprocess.run([sys.executable, '-I', '-S', __file__, *sys.argv[1:], 'child'], check=True, timeout=15, stdin=subprocess.DEVNULL)
print('TRUTHSRC-RUNTIME-SANDBOX-OK scope=${networkScope} depth=' + str(len(sys.argv) - 1), flush=True)
`;
}
