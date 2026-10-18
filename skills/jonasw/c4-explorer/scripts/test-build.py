#!/usr/bin/env python3
"""Verify model validation, source snapshots, CLI errors and atomic bundling."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('builder', Path(__file__).with_name('build-explorer.py'))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='c4 build ')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'module.py'
        self.source.write_text('\n'.join(f'value_{i} = {i}' for i in range(60)) + '\n', encoding='utf-8')
        self.model = json.loads((Path(__file__).parent / 'fixtures/repository-model.json').read_text(encoding='utf-8'))
        self.model_path = self.root / 'model.json'
        self.output = self.root / 'output.html'
        original = builder.command
        self.git = patch.object(builder, 'command', side_effect=lambda args, **kwargs: 'a' * 40 if args[0] == 'git' else original(args, **kwargs))
        self.git.start()
        self.addCleanup(self.git.stop)

    def save_model(self):
        self.model_path.write_text(json.dumps(self.model), encoding='utf-8')

    def test_excerpts_are_numbered_bounded_and_hashed(self):
        proof = builder.hydrate(self.model, self.root)['evidence']['entry']
        self.assertTrue(proof['excerpt'].startswith('   2 value_1 = 1'))
        self.assertIn('19 further lines omitted', proof['excerpt'])
        self.assertEqual(proof['sha256'], hashlib.sha256(self.source.read_bytes()).hexdigest())
        self.assertNotIn('excerpt', self.model['evidence']['entry'])

    def test_stale_revision_and_invalid_range_fail(self):
        self.model['snapshot']['revision'] = 'b' * 40
        with self.assertRaises(builder.BuildError): builder.hydrate(self.model, self.root)
        self.model['snapshot']['revision'] = 'a' * 40
        self.model['evidence']['entry']['endLine'] = 61
        with self.assertRaises(builder.BuildError): builder.hydrate(self.model, self.root)

    def test_external_and_secret_paths_fail(self):
        for path in ['../outside.py', str(self.source), '.env', 'secrets/token.txt']:
            with self.subTest(path=path):
                self.model['evidence']['entry']['path'] = path
                with self.assertRaises(builder.BuildError): builder.hydrate(self.model, self.root)

    def test_symlinks_do_not_bypass_source_boundaries(self):
        link = self.root / 'link.py'
        link.symlink_to(self.root.parent / 'outside.py')
        self.model['evidence']['entry']['path'] = 'link.py'
        with self.assertRaises(builder.BuildError): builder.hydrate(self.model, self.root)
        link.unlink()
        secret = self.root / '.env'
        secret.write_text('SECRET=example', encoding='utf-8')
        link.symlink_to(secret)
        with self.assertRaises(builder.BuildError): builder.hydrate(self.model, self.root)

    def test_build_escapes_model_content_and_preserves_marker_text(self):
        self.model['note'] = '</ScRiPt><script>untrusted()</script> /* C4_ENGINE */'
        self.save_model()
        builder.build(self.output, self.model_path, self.root)
        document = self.output.read_text(encoding='utf-8')
        self.assertNotIn('<script>untrusted()', document)
        self.assertIn('\\u003c/ScRiPt>', document)
        self.assertIn('/* C4_ENGINE */', document)
        self.assertNotIn('C4DemoSource', document)
        self.assertEqual(document.count('<script>'), 2)
        self.assertEqual(builder.inline_script('</SCRIPT>'), '<\\/SCRIPT>')

    def test_invalid_model_fails_before_replacing_existing_output(self):
        self.output.write_text('previous artifact', encoding='utf-8')
        self.model['views'][0]['nodes'][0]['childView'] = 'missing'
        self.save_model()
        with self.assertRaises(builder.BuildError): builder.build(self.output, self.model_path, self.root)
        self.assertEqual(self.output.read_text(encoding='utf-8'), 'previous artifact')

    def test_failed_write_preserves_previous_artifact_and_cleans_temp(self):
        self.output.write_text('previous artifact', encoding='utf-8')
        with patch.object(builder.os, 'replace', side_effect=OSError('disk unavailable')):
            with self.assertRaises(OSError): builder.build(self.output)
        self.assertEqual(self.output.read_text(encoding='utf-8'), 'previous artifact')
        self.assertEqual(list(self.root.glob('.c4-*.tmp')), [])

    def test_replacing_an_artifact_preserves_its_permissions(self):
        self.output.write_text('previous artifact', encoding='utf-8')
        self.output.chmod(0o640)
        builder.build(self.output)
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o640)

    def test_check_mode_reads_sources_without_writing_output(self):
        self.save_model()
        self.assertIsNone(builder.build(None, self.model_path, self.root, check=True))
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.root.glob('.c4-*.tmp')), [])

    def test_duplicate_json_keys_and_non_json_constants_fail(self):
        for text in ['{"name":"one","name":"two"}', '{"value":NaN}']:
            self.model_path.write_text(text, encoding='utf-8')
            with self.assertRaises(builder.BuildError): builder.load_model(self.model_path)

    def test_source_and_shell_cannot_be_overwritten(self):
        self.assertRaises(builder.BuildError, builder.build, builder.ASSETS / 'shell.html')
        source_html = self.root / 'source.html'
        source_html.write_text('Original source', encoding='utf-8')
        self.model['evidence']['entry'].update(path='source.html', line=1, endLine=1)
        self.save_model()
        self.assertRaises(builder.BuildError, builder.build, source_html, self.model_path, self.root)
        self.assertEqual(source_html.read_text(encoding='utf-8'), 'Original source')

    def test_actionable_cli_error_without_traceback(self):
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            result = builder.main(['--model', str(self.model_path)])
        self.assertEqual(result, 1)
        self.assertIn('--model and --repo-root', stderr.getvalue())
        self.assertNotIn('Traceback', stderr.getvalue())

    def test_demo_mode_and_paths_with_spaces(self):
        destination = self.root / 'nested path' / 'demo.html'
        self.assertEqual(builder.build(destination), destination.resolve())
        self.assertIn('C4DemoSource', destination.read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
