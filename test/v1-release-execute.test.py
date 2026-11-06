import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('release_execute', ROOT / 'tools/v1-release-execute.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class ReleaseExecutionTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='release-executor-', dir=ROOT / '.scratch'))

    def test_copy_checks_hash_and_refuses_overwrite(self):
        source = self.root / 'source'
        source.write_text('source')
        target = self.root / 'nested/output'
        with self.assertRaises(ValueError):
            mod.copy_file(source, target, '0' * 64)
        self.assertFalse(target.exists())
        mod.copy_file(source, target, mod.sha(source))
        self.assertEqual(target.read_text(), 'source')
        with self.assertRaises(ValueError):
            mod.copy_file(source, target)

    def test_symlink_and_alias_rejected(self):
        source = self.root / 'source'
        source.write_text('source')
        link = self.root / 'link'
        link.symlink_to(source)
        with self.assertRaises(ValueError):
            mod.plain(link)
        with self.assertRaises(ValueError):
            mod.inventory(self.root)

    def test_bundle_tamper_fails(self):
        (self.root / 'source').write_text('source')
        mod.save(self.root / 'BUNDLE.json', {'files': {'source': mod.sha(self.root/'source')}})
        mod.verify_bundle(self.root)
        (self.root / 'source').write_text('changed')
        with self.assertRaises(ValueError):
            mod.verify_bundle(self.root)

    def test_inventory_exact_build_exclusion(self):
        (self.root/'project/target').mkdir(parents=True)
        (self.root/'project/target/cache').write_text('cache')
        (self.root/'project/build.properties').write_text('sbt.version=1.4.9')
        self.assertEqual(set(mod.inventory(self.root, ['project/target'])), {'project/build.properties'})

    def test_retired_tree_refuses_before_candidate_creation(self):
        if (ROOT / 'v1/tree/workshop.yaml').exists():
            self.skipTest('historical checkout still contains its author tree')
        target = self.root / 'retired-candidate'
        config = {'schemaVersion': 'bank-v1-execution/v2', 'bundle': str(target),
                  'workId': 'retired-source-test', 'javaHome': '/unused', 'python': '/unused',
                  'sources': {key: '/unused' for key in
                              ['jsCapture', 'bcCapture', 'bcRuntime', 'support', 'options', 'license', 'admissionFixture']}}
        with self.assertRaisesRegex(ValueError, 'historical release source tree is retired'):
            mod.capture(config)
        self.assertFalse(target.exists())

    def test_invalid_config_cannot_create_candidate(self):
        target = self.root/'candidate'
        with self.assertRaises(ValueError):
            mod.capture({'bundle': str(target), 'argv':['anything']})
        self.assertFalse(target.exists())


if __name__ == '__main__':
    unittest.main()
