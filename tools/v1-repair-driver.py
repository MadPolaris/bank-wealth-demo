"""Bounded subprocess execution with exclusive evidence and a shared execution lock."""
from pathlib import Path
import argparse
import fcntl
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import time

BANK = Path(__file__).resolve().parents[1]
EXCLUDED = {'target', 'node_modules', '.git', '.bloop', '.bsp', '__pycache__'}
ENV_KEYS = {'HOME', 'JAVA_HOME', 'PATH', 'LANG', 'TMPDIR', 'COURSIER_MODE',
            'COURSIER_CACHE', 'COURSIER_REPOSITORIES', 'PYTHONDONTWRITEBYTECODE'}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def plain(value):
    if not isinstance(value, str) or '\0' in value:
        raise ValueError('canonical absolute path required')
    path = Path(value)
    if not path.is_absolute() or value != str(path.resolve()) or '\\' in value:
        raise ValueError('canonical absolute path required')
    return path


def snapshot(roots):
    result = {}
    for value in roots:
        root = plain(value)
        if not root.exists():
            raise ValueError('snapshot root missing: ' + str(root))
        paths = root.rglob('*') if root.is_dir() else [root]
        for path in sorted(paths):
            if root.is_dir() and set(path.relative_to(root).parts) & EXCLUDED:
                continue
            if path.is_symlink():
                raise ValueError('symlink in source snapshot: ' + str(path))
            if path.is_file():
                result[str(path)] = sha(path)
    return result


def put(path, value):
    with Path(path).open('x', encoding='utf8') as handle:
        json.dump(value, handle, indent=2, ensure_ascii=False)
        handle.write('\n')


def validate(config):
    required = {'runRoot', 'tag', 'argv', 'cwd', 'env', 'authors', 'inputs', 'sourceRoots', 'protected', 'timeoutSeconds'}
    if set(config) != required:
        raise ValueError('unexpected or missing driver configuration fields')
    root = plain(config['runRoot'])
    if not root.is_dir() or not root.is_relative_to(BANK / '.scratch'):
        raise ValueError('runRoot must be an existing owned bank scratch directory')
    if not isinstance(config['tag'], str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}', config['tag']):
        raise ValueError('invalid run tag')
    argv = config['argv']
    if not isinstance(argv, list) or not argv or not all(isinstance(x, str) and '\0' not in x for x in argv):
        raise ValueError('explicit argv required')
    executable = plain(argv[0])
    if not executable.is_file() or not os.access(executable, os.X_OK):
        raise ValueError('executable unavailable')
    if executable.name not in {'node', 'java', 'javac', 'python3', 'python3.10', 'python3.11', 'python3.12', 'docker'}:
        raise ValueError('unsupported executable')
    if not plain(config['cwd']).is_dir():
        raise ValueError('working directory missing')
    if not isinstance(config['env'], dict) or any(k not in ENV_KEYS or not isinstance(v, str) for k, v in config['env'].items()):
        raise ValueError('environment is not an explicit allowlist')
    if any(re.search(r'(password|secret|token)=', arg, re.I) for arg in argv):
        raise ValueError('credentials must not be embedded in argv')
    for key in ('authors', 'inputs', 'sourceRoots'):
        if not isinstance(config[key], list) or not all(isinstance(x, str) for x in config[key]):
            raise ValueError('explicit path list required: ' + key)
        for path in config[key]:
            if not plain(path).exists():
                raise ValueError('input missing: ' + path)
    if not config['sourceRoots']:
        raise ValueError('source roots required')
    if not isinstance(config['protected'], dict):
        raise ValueError('protected file fingerprints required')
    for path, digest in config['protected'].items():
        if not re.fullmatch(r'[0-9a-f]{64}', digest) or sha(plain(path)) != digest:
            raise ValueError('protected file differs: ' + path)
    timeout = config['timeoutSeconds']
    if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or not 0 < timeout <= 540:
        raise ValueError('timeout must be positive and at most 540 seconds')
    for arg in argv[1:]:
        if arg.endswith(('.py', '.mjs')):
            script = plain(arg)
            if not script.is_file() or arg not in config['authors']:
                raise ValueError('script argument must be fingerprinted as an author')
            if (script.suffix == '.py' and not executable.name.startswith('python3')) or (script.suffix == '.mjs' and executable.name != 'node'):
                raise ValueError('script interpreter mismatch')
    return root / config['tag']


def group_exists(pid):
    try:
        os.killpg(pid, 0)
        return True
    except ProcessLookupError:
        return False


def signal_group(pid, sig):
    try:
        os.killpg(pid, sig)
    except ProcessLookupError:
        pass


def cleanup_group(child):
    if child is None:
        return False, True
    lingering = group_exists(child.pid)
    if lingering:
        signal_group(child.pid, signal.SIGTERM)
        deadline = time.monotonic() + 2
        while group_exists(child.pid) and time.monotonic() < deadline:
            time.sleep(0.02)
        if group_exists(child.pid):
            signal_group(child.pid, signal.SIGKILL)
    if child.poll() is None:
        child.wait()
    deadline = time.monotonic() + 2
    while group_exists(child.pid) and time.monotonic() < deadline:
        time.sleep(0.02)
    return lingering, not group_exists(child.pid)


def execute(config, config_path):
    destination = validate(config)
    lock_path = BANK / '.scratch/repair-execution.lock'
    lock_fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(lock_fd)
        raise ValueError('repair execution slot is occupied')
    try:
        destination.mkdir()  # One atomic claim; collisions never overwrite evidence.
        roots = config['sourceRoots'] + config['authors'] + config['inputs'] + [str(Path(__file__).resolve())]
        before = snapshot(roots)
        command = config['argv']
        config_sha = sha(config_path)
        put(destination / 'input.json', dict(schemaVersion='bank-repair-execution-input/v1', config=config,
            configSha256=config_sha, sources=before, executableSha256=sha(command[0])))
        started = time.monotonic()
        child = None
        cancelled = None
        timed_out = False
        stop_time = None
        killed = False
        code = None
        failure = None
        verification_error = None
        lingering = False
        group_gone = True

        def terminate(sig, frame=None):
            nonlocal cancelled, stop_time
            cancelled = signal.Signals(sig).name
            if child is not None and child.poll() is None and stop_time is None:
                stop_time = time.monotonic()
                signal_group(child.pid, signal.SIGTERM)

        prior_handlers = {sig: signal.signal(sig, terminate) for sig in (signal.SIGTERM, signal.SIGINT)}
        try:
            with (destination / 'stdout.log').open('xb') as out, (destination / 'stderr.log').open('xb') as err:
                try:
                    child = subprocess.Popen(command, cwd=config['cwd'], env=config['env'], stdin=subprocess.DEVNULL,
                                             stdout=out, stderr=err, start_new_session=True)
                    put(destination / 'started.json', dict(pid=child.pid, processGroup=child.pid))
                    if cancelled:
                        terminate(signal.SIGTERM)
                    while True:
                        try:
                            code = child.wait(timeout=0.2)
                            break
                        except subprocess.TimeoutExpired:
                            now = time.monotonic()
                            if stop_time is None and now - started >= config['timeoutSeconds']:
                                timed_out = True
                                stop_time = now
                                signal_group(child.pid, signal.SIGTERM)
                            if stop_time is not None and not killed and now - stop_time >= 10:
                                signal_group(child.pid, signal.SIGKILL)
                                killed = True
                except Exception as error:
                    failure = type(error).__name__ + ': ' + str(error)
                finally:
                    lingering, group_gone = cleanup_group(child)
                    if child is not None:
                        code = child.returncode
        finally:
            for sig, handler in prior_handlers.items():
                signal.signal(sig, handler)
        after = {}
        try:
            after = snapshot(roots)
            protected_drift = [p for p, h in config['protected'].items() if not Path(p).is_file() or sha(p) != h]
            configuration_unchanged = sha(config_path) == config_sha
        except (OSError, ValueError) as error:
            verification_error = type(error).__name__ + ': ' + str(error)
            protected_drift = []
            configuration_unchanged = False
        changes = sorted(p for p in before.keys() | after.keys() if before.get(p) != after.get(p))
        report = dict(schemaVersion='bank-repair-execution/v1', argv=command, cwd=config['cwd'],
            pid=child.pid if child else None, waited=child is not None and code is not None, exitCode=code,
            timedOut=timed_out, cancelled=cancelled, killed=killed, launchError=failure,
            verificationError=verification_error, lingeringProcessGroup=lingering, processGroupGone=group_gone,
            elapsedSeconds=round(time.monotonic() - started, 3), sourceBefore=before, sourceAfter=after,
            sourceChanges=changes, protectedDrift=protected_drift, configurationUnchanged=configuration_unchanged,
            logs={name: dict(sha256=sha(destination / name), bytes=(destination / name).stat().st_size)
                  for name in ('stdout.log', 'stderr.log')}, releaseAccepted=False)
        okay = code == 0 and not timed_out and not cancelled and not failure and not verification_error and not lingering and group_gone and not changes and not protected_drift and configuration_unchanged
        report['status'] = 'passed' if okay else 'failed'
        put(destination / 'result.json', report)
        print(json.dumps(dict(evidence=str(destination), status=report['status'], exitCode=code, timedOut=timed_out,
                              sourceChanges=changes, protectedDrift=protected_drift)))
        return 0 if okay else 1
    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        os.close(lock_fd)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    try:
        path = plain(args.config)
        sys.exit(execute(json.loads(path.read_text()), path))
    except (ValueError, FileExistsError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
