import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

BANK = Path(__file__).resolve().parents[1]
DRIVER = BANK / 'tools/v1-repair-driver.py'
spec = importlib.util.spec_from_file_location('repair_driver', DRIVER)
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


class RepairDriverTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='repair-driver-test-', dir=BANK / '.scratch')
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / 'source.txt'
        self.source.write_text('preserved\n')

    def tearDown(self):
        self.temp.cleanup()

    def config(self, code, tag='run', timeout=5):
        return dict(runRoot=str(self.root), tag=tag, argv=[str(Path(sys.executable).resolve()), '-c', code],
            cwd=str(self.root), env={'PATH': '/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1'},
            authors=[], inputs=[], sourceRoots=[str(self.source)], protected={str(self.source): driver.sha(self.source)},
            timeoutSeconds=timeout)

    def launch(self, config, wait=True):
        path = self.root / (config['tag'] + '-config.json')
        path.write_text(json.dumps(config))
        child = subprocess.Popen([sys.executable, '-B', str(DRIVER), '--config', str(path)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            env={**os.environ, 'REPAIR_SHOULD_NOT_LEAK': 'parent-only', 'PYTHONDONTWRITEBYTECODE': '1'})
        if not wait:
            return child
        stdout, stderr = child.communicate(timeout=20)
        return child.returncode, stdout, stderr

    def test_success_records_environment_and_hashes(self):
        code = 'import os; assert "REPAIR_SHOULD_NOT_LEAK" not in os.environ; print("done")'
        status, _, _ = self.launch(self.config(code))
        self.assertEqual(status, 0)
        result = json.loads((self.root / 'run/result.json').read_text())
        self.assertTrue(result['waited'])
        self.assertEqual(result['sourceChanges'], [])
        self.assertEqual(result['logs']['stdout.log']['sha256'], driver.sha(self.root / 'run/stdout.log'))
        self.assertFalse(result['releaseAccepted'])

    def test_child_failure_is_not_hidden(self):
        status, _, _ = self.launch(self.config('raise SystemExit(7)'))
        self.assertEqual(status, 1)
        self.assertEqual(json.loads((self.root / 'run/result.json').read_text())['exitCode'], 7)

    def test_timeout_waits_and_retains_logs(self):
        status, _, _ = self.launch(self.config('import time; print("started",flush=True); time.sleep(20)', timeout=0.3))
        self.assertEqual(status, 1)
        result = json.loads((self.root / 'run/result.json').read_text())
        self.assertTrue(result['timedOut'] and result['waited'])
        self.assertIn('started', (self.root / 'run/stdout.log').read_text())

    def test_source_change_is_failure(self):
        code = 'from pathlib import Path; Path(' + repr(str(self.source)) + ').write_text("changed")'
        status, _, _ = self.launch(self.config(code))
        self.assertEqual(status, 1)
        result = json.loads((self.root / 'run/result.json').read_text())
        self.assertEqual(result['protectedDrift'], [str(self.source)])

    def test_occupied_namespace_never_overwrites(self):
        config = self.config('print("original")')
        self.assertEqual(self.launch(config)[0], 0)
        before = (self.root / 'run/result.json').read_bytes()
        self.assertEqual(self.launch(config)[0], 2)
        self.assertEqual(before, (self.root / 'run/result.json').read_bytes())

    def test_cancel_and_lock_conflict(self):
        child = self.launch(self.config('import time; time.sleep(20)'), wait=False)
        try:
            deadline = time.monotonic() + 5
            while not (self.root / 'run/started.json').exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue((self.root / 'run/started.json').exists())
            status, _, stderr = self.launch(self.config('print("must not run")', tag='other'))
            self.assertEqual(status, 2)
            self.assertIn('slot is occupied', stderr)
            self.assertFalse((self.root / 'other').exists())
            child.send_signal(signal.SIGTERM)
            child.communicate(timeout=15)
            result = json.loads((self.root / 'run/result.json').read_text())
            self.assertEqual(result['cancelled'], 'SIGTERM')
            self.assertTrue(result['waited'])
        finally:
            if child.poll() is None:
                child.terminate()
                child.communicate(timeout=15)

    def test_launch_failure_retains_receipt(self):
        config = self.config('print("unused")')
        path = self.root / 'config.json'
        path.write_text(json.dumps(config))
        with patch.object(driver.subprocess, 'Popen', side_effect=OSError('fixture launch failure')):
            self.assertEqual(driver.execute(config, path), 1)
        result = json.loads((self.root / 'run/result.json').read_text())
        self.assertIn('fixture launch failure', result['launchError'])
        self.assertFalse(result['waited'])

    def test_missing_source_after_execution_retains_failure(self):
        code = 'from pathlib import Path; Path(' + repr(str(self.source)) + ').unlink()'
        status, _, _ = self.launch(self.config(code))
        self.assertEqual(status, 1)
        result = json.loads((self.root / 'run/result.json').read_text())
        self.assertIn('snapshot root missing', result['verificationError'])
        self.assertEqual(result['exitCode'], 0)

    def test_normal_parent_exit_cleans_lingering_group(self):
        code = 'import subprocess,sys; subprocess.Popen([sys.executable,"-c","import time; time.sleep(20)"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)'
        status, _, _ = self.launch(self.config(code))
        self.assertEqual(status, 1)
        result = json.loads((self.root / 'run/result.json').read_text())
        self.assertTrue(result['lingeringProcessGroup'])
        self.assertTrue(result['processGroupGone'])

    def test_raw_path_and_interpreter_mismatch_rejected(self):
        for value in (str(self.root) + '/.', str(self.root) + '//', str(self.root) + '/x/..'):
            with self.assertRaises(ValueError):
                driver.plain(value)
        script = self.root / 'wrong.mjs'
        script.write_text('fixture')
        config = self.config('unused')
        config.update(argv=[str(Path(sys.executable).resolve()), str(script)], authors=[str(script)])
        with self.assertRaisesRegex(ValueError, 'interpreter mismatch'):
            driver.validate(config)

    def test_invalid_inputs_rejected_before_claim(self):
        for update in ({'tag': '../escape'}, {'env': {'SECRET': 'no'}}, {'timeoutSeconds': 1500},
                       {'argv': ['/bin/sh', '-c', 'true']}, {'argv': [sys.executable, '/missing/script.mjs']}):
            config = {**self.config('print("unused")'), **update}
            with self.assertRaises(ValueError):
                driver.validate(config)
        self.assertFalse((self.root / 'run').exists())


if __name__ == '__main__':
    unittest.main()
