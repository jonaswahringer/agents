#!/usr/bin/env python3
"""Exercise the public sync command against local Git histories and a temporary home."""
import pathlib
import shutil
import subprocess
import tempfile
import unittest
import os

ROOT = pathlib.Path(__file__).resolve().parents[1]


def run(*args, cwd=None, env=None, data=None):
    return subprocess.run(args, cwd=cwd, env=env, input=data, capture_output=True)


def skill(name, first='original', last='original'):
    lines = ['---', f'name: {name}', 'description: A fixture skill.', '---', first]
    lines += [f'Unchanged line {i}.' for i in range(30)]
    return ('\n'.join(lines + [last]) + '\n').encode()


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='agents sync test ')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.source = self.root / 'agents checkout'
        self.upstream = self.root / 'upstream repo'
        self.home = self.root / 'temporary home'
        self.home.mkdir()
        self.env = dict(os.environ, HOME=str(self.home))
        self.env.pop('AGENTS_SOURCE_DIR', None)
        for path in [self.source, self.upstream]:
            path.mkdir()
            result = run('git', 'init', '--quiet', str(path))
            self.assertEqual(result.returncode, 0, result.stderr)
        for relative in ['bin/agents', 'tools/skills-sync.sh']:
            target = self.source / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / relative, target)
        run('git', '-C', str(self.upstream), 'symbolic-ref', 'HEAD', 'refs/heads/main')
        self.base_files = {
            'LICENSE': (b'MIT fixture license\n', '100644'),
            'skills/old/alpha/SKILL.md': (skill('alpha'), '100644'),
            'skills/old/alpha/obsolete.txt': (b'old reference\n', '100644'),
            'skills/old/alpha/helper.sh': (b'#!/bin/sh\nexit 0\n', '100644'),
            'skills/old/alpha/data.bin': (b'\x00base\n', '100644'),
        }
        self.baseline = self.import_tree(self.base_files, 1)
        self.next_files = {
            'LICENSE': self.base_files['LICENSE'],
            'skills/engineering/alpha/SKILL.md': (skill('alpha', first='upstream edit'), '100644'),
            'skills/engineering/alpha/helper.sh': (b'#!/bin/sh\nexit 0\n', '100755'),
            'skills/engineering/alpha/data.bin': (b'\x00base\n', '100644'),
            'skills/engineering/alpha/reference/new.txt': (b'new reference\n', '100644'),
            'skills/engineering/beta/SKILL.md': (skill('beta'), '100644'),
        }
        self.latest = self.import_tree(self.next_files, 2)
        self.group = self.source / 'skills/fixture'
        self.group.mkdir(parents=True)
        for path, (data, mode) in self.base_files.items():
            if path == 'LICENSE':
                target = self.group / path
            else:
                target = self.group / 'alpha' / path.split('/alpha/', 1)[1]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        (self.group / 'local-only').mkdir()
        (self.group / 'local-only/SKILL.md').write_bytes(skill('local-only'))
        self.manifest = self.group / 'upstream.tsv'
        self.manifest.write_text(
            f'repository\t{self.upstream}\nref\tmain\ncommit\t{self.baseline}\n'
            'skill\talpha\tskills/engineering/alpha\nlocal\tlocal-only\n'
        )
        self.private = self.home / '.config/agents'
        self.private.mkdir(parents=True)
        (self.private / 'selected-skills').write_text('fixture/alpha\n')
        (self.private / 'profile').mkdir()
        (self.private / 'profile/about-me').write_text('Private answers\n')
        self.private_before = self.snapshot(self.home)

    def import_tree(self, files, mark):
        # Import synthetic test history without committing in the real repository.
        stream = f'commit refs/heads/main\nmark :{mark}\ncommitter Fixture <fixture@example.test> {mark} +0000\ndata 7\nfixture\n'.encode()
        if mark > 1:
            parent = run('git', '-C', str(self.upstream), 'rev-parse', 'main').stdout.strip()
            stream += b'from ' + parent + b'\n'
        stream += b'deleteall\n'
        for path, (data, mode) in sorted(files.items()):
            stream += f'M {mode} inline {path}\ndata {len(data)}\n'.encode() + data + b'\n'
        stream += b'\ndone\n'
        result = run('git', '-C', str(self.upstream), 'fast-import', '--quiet', data=stream)
        self.assertEqual(result.returncode, 0, result.stderr)
        return run('git', '-C', str(self.upstream), 'rev-parse', 'main').stdout.decode().strip()

    def snapshot(self, directory):
        return {str(p.relative_to(directory)): (p.read_bytes(), bool(p.stat().st_mode & 0o111))
                for p in directory.rglob('*') if p.is_file()}

    def sync(self, *args, success=True):
        result = run('/bin/bash', str(self.source / 'bin/agents'), 'skills', 'sync', 'fixture', *args, env=self.env)
        message = (result.stdout + result.stderr).decode(errors='replace')
        if success:
            self.assertEqual(result.returncode, 0, message)
        else:
            self.assertNotEqual(result.returncode, 0, message)
        self.assertEqual(self.snapshot(self.home), self.private_before, 'sync changed private installer state')
        self.assertFalse((self.source / 'skills/.sync-fixture.lock').exists(), 'sync left a lock')
        return message

    def unchanged_after_failure(self, *args):
        before = self.snapshot(self.group)
        message = self.sync(*args, success=False)
        self.assertEqual(self.snapshot(self.group), before, 'failed sync changed source files')
        return message

    def test_dry_run_keeps_every_file(self):
        before = self.snapshot(self.group)
        output = self.sync('--dry-run')
        self.assertIn('skills/engineering/beta', output)
        self.assertEqual(self.snapshot(self.group), before)

    def test_merge_keeps_local_edits_and_updates_resources_and_modes(self):
        (self.group / 'alpha/SKILL.md').write_bytes(skill('alpha', last='local edit'))
        (self.group / 'alpha/custom.txt').write_text('Local reference\n')
        self.sync()
        self.assertEqual((self.group / 'alpha/SKILL.md').read_bytes(), skill('alpha', first='upstream edit', last='local edit'))
        self.assertFalse((self.group / 'alpha/obsolete.txt').exists())
        self.assertTrue((self.group / 'alpha/helper.sh').stat().st_mode & 0o111)
        self.assertEqual((self.group / 'alpha/reference/new.txt').read_text(), 'new reference\n')
        self.assertEqual((self.group / 'alpha/custom.txt').read_text(), 'Local reference\n')
        self.assertEqual((self.group / 'local-only/SKILL.md').read_bytes(), skill('local-only'))
        self.assertFalse((self.group / 'beta').exists())
        self.assertIn(self.latest, self.manifest.read_text())
        before = self.snapshot(self.group)
        self.sync()
        self.assertEqual(self.snapshot(self.group), before, 'second sync changed source')

    def test_conflict_publishes_nothing(self):
        (self.group / 'alpha/SKILL.md').write_bytes(skill('alpha', first='conflicting local edit'))
        output = self.unchanged_after_failure()
        self.assertIn('Conflict: fixture/alpha/SKILL.md', output)
        self.assertIn('no source files changed', output)

    def test_modified_file_deleted_upstream_is_a_conflict(self):
        (self.group / 'alpha/obsolete.txt').write_text('local edit\n')
        self.assertIn('Conflict: fixture/alpha/obsolete.txt', self.unchanged_after_failure())

    def test_binary_changes_on_both_sides_are_a_conflict(self):
        (self.group / 'alpha/data.bin').write_bytes(b'\x00local edit\n')
        files = dict(self.next_files)
        files['skills/engineering/alpha/data.bin'] = (b'\x00upstream edit\n', '100644')
        self.import_tree(files, 3)
        self.assertIn('Conflict: fixture/alpha/data.bin', self.unchanged_after_failure())

    def test_local_resource_deletion_is_preserved(self):
        (self.group / 'alpha/data.bin').unlink()
        self.sync()
        self.assertFalse((self.group / 'alpha/data.bin').exists())

    def test_import_one_candidate_and_keep_future_local_edits(self):
        self.sync('--add', 'beta')
        self.assertEqual((self.group / 'beta/SKILL.md').read_bytes(), skill('beta'))
        self.assertIn('skill\tbeta\tskills/engineering/beta', self.manifest.read_text())
        (self.group / 'beta/SKILL.md').write_bytes(skill('beta', last='local beta edit'))
        self.sync()
        self.assertEqual((self.group / 'beta/SKILL.md').read_bytes(), skill('beta', last='local beta edit'))
        self.assertIn('already has a manifest entry', self.unchanged_after_failure('--add', 'beta'))

    def test_candidate_cannot_take_over_an_existing_local_directory(self):
        (self.group / 'beta').mkdir()
        (self.group / 'beta/SKILL.md').write_bytes(skill('beta', first='local skill'))
        self.assertIn('refusing to take over', self.unchanged_after_failure('--add', 'beta'))

    def test_removed_skill_requires_manifest_decision(self):
        self.import_tree({'LICENSE': self.next_files['LICENSE']}, 3)
        self.assertIn('removed or moved upstream', self.unchanged_after_failure())

    def test_invalid_upstream_metadata_is_rejected(self):
        files = dict(self.next_files)
        files['skills/engineering/alpha/SKILL.md'] = (skill('wrong-name'), '100644')
        self.import_tree(files, 3)
        self.assertIn('invalid upstream metadata', self.unchanged_after_failure())

    def test_upstream_symlink_is_rejected(self):
        files = dict(self.next_files)
        files['skills/engineering/alpha/linked.txt'] = (b'/tmp/outside', '120000')
        self.import_tree(files, 3)
        self.assertIn('unsupported file or link', self.unchanged_after_failure())

    def test_unsafe_manifest_path_is_rejected(self):
        self.manifest.write_text(self.manifest.read_text().replace('skills/engineering/alpha', 'skills/../alpha'))
        self.assertIn('invalid upstream skill path', self.unchanged_after_failure())

    def test_ref_pins_to_baseline_without_importing_new_candidates(self):
        self.manifest.write_text(self.manifest.read_text().replace('skills/engineering/alpha', 'skills/old/alpha'))
        self.sync('--ref', self.baseline)
        self.assertEqual((self.group / 'alpha/SKILL.md').read_bytes(), skill('alpha'))
        self.assertIn(self.baseline, self.manifest.read_text())

    def test_installed_snapshot_cannot_sync(self):
        shutil.rmtree(self.source / '.git')
        self.assertIn('Git checkout', self.unchanged_after_failure())

    def test_missing_license_is_imported(self):
        (self.group / 'LICENSE').unlink()
        self.sync()
        self.assertEqual((self.group / 'LICENSE').read_bytes(), self.next_files['LICENSE'][0])


if __name__ == '__main__':
    unittest.main()
