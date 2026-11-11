import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('apk_publish', ROOT / 'scripts/apk-store/publish.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class PublishTests(unittest.TestCase):
    def test_real_archive_structure_crc_badging_and_digest(self):
        with tempfile.TemporaryDirectory() as directory:
            apk, badging = Path(directory) / 'App.apk', Path(directory) / 'badging.txt'
            with zipfile.ZipFile(apk, 'w') as archive:
                archive.writestr('AndroidManifest.xml', b'test manifest fixture')
                archive.writestr('classes.dex', b'test dex fixture')
            badging.write_text("package: name='test' versionName='1.5'\nminSdkVersion:'23'\n")
            version, sdk, digest = publisher.inspect_apk(apk, badging)
            self.assertEqual((version, sdk), ('1.5', '23'))
            self.assertEqual(len(digest), 64)
            with zipfile.ZipFile(apk, 'w') as archive:
                archive.writestr('not-an-apk.txt', b'fixture')
            with self.assertRaises(ValueError):
                publisher.inspect_apk(apk, badging)

    def test_label_and_run_identity(self):
        label = publisher.label_for('1.5', '23', 'a' * 64, 'b' * 40, '12345')
        self.assertIn('version=1.5;', label)
        self.assertEqual(publisher.existing_run(label), 12345)
        self.assertEqual(publisher.existing_run(None), 0)
        with self.assertRaises(ValueError):
            publisher.label_for('1.5', '23', 'a' * 64, 'not-a-commit', '1')

    def test_pull_requests_branches_and_forks_cannot_publish(self):
        for env in [
            {'GITHUB_REPOSITORY': publisher.REPO, 'GITHUB_REF': 'refs/heads/main', 'GITHUB_EVENT_NAME': 'pull_request'},
            {'GITHUB_REPOSITORY': publisher.REPO, 'GITHUB_REF': 'refs/heads/arena/test', 'GITHUB_EVENT_NAME': 'push'},
            {'GITHUB_REPOSITORY': 'other/fork', 'GITHUB_REF': 'refs/heads/main', 'GITHUB_EVENT_NAME': 'push'},
        ]:
            with patch.dict('os.environ', env, clear=True), patch.object(publisher, 'gh') as gh:
                with self.assertRaises(RuntimeError):
                    publisher.main()
                gh.assert_not_called()

    def test_not_found_is_distinct_from_auth_or_rate_limit_failure(self):
        with patch.object(publisher, 'gh', return_value=subprocess.CompletedProcess([], 1, '{"message":"Not Found"}', '404')):
            self.assertIsNone(publisher.get_release())
        with patch.object(publisher, 'gh', return_value=subprocess.CompletedProcess([], 1, '{"message":"API rate limit exceeded"}', '403')):
            with self.assertRaises(RuntimeError):
                publisher.get_release()

    def test_successful_job_downloads_validates_creates_release_and_uploads_apk(self):
        env = {'GITHUB_REPOSITORY': publisher.REPO, 'GITHUB_REF': 'refs/heads/main', 'GITHUB_EVENT_NAME': 'push', 'GITHUB_SHA': 'b' * 40, 'GITHUB_RUN_ID': '100', 'BUILD_RESULTS': json.dumps({'build-choirtune-apk': {'result': 'success'}})}
        calls = []

        def fake_gh(*args, **kwargs):
            calls.append(args)
            if args[:2] == ('run', 'download'):
                folder = Path(args[args.index('--dir') + 1])
                folder.mkdir(parents=True)
                with zipfile.ZipFile(folder / 'ChoirTune.apk', 'w') as archive:
                    archive.writestr('AndroidManifest.xml', b'fixture')
                    archive.writestr('classes.dex', b'fixture')
                (folder / 'badging.txt').write_text("package: versionName='1.5'\nminSdkVersion:'23'\n")
            return subprocess.CompletedProcess([], 0, '', '')

        with patch.dict('os.environ', env, clear=True), patch.object(publisher, 'get_release', return_value=None), patch.object(publisher, 'gh', side_effect=fake_gh):
            publisher.main()
        self.assertEqual([call[:2] for call in calls], [('run', 'download'), ('release', 'create'), ('release', 'upload')])
        upload = calls[-1]
        self.assertTrue(any('ChoirTune.apk#version=1.5;sha256=' in arg for arg in upload))
        self.assertIn('--clobber', upload)

    def test_failed_builds_and_older_runs_preserve_public_assets(self):
        apps = json.loads((ROOT / 'downloads/apps.json').read_text())
        env = {'GITHUB_REPOSITORY': publisher.REPO, 'GITHUB_REF': 'refs/heads/main', 'GITHUB_EVENT_NAME': 'push', 'GITHUB_SHA': 'b' * 40, 'GITHUB_RUN_ID': '100', 'BUILD_RESULTS': json.dumps({a['job']: {'result': 'failure'} for a in apps})}
        with patch.dict('os.environ', env, clear=True), patch.object(publisher, 'get_release', return_value={'assets': []}), patch.object(publisher, 'gh') as gh:
            publisher.main()
            gh.assert_not_called()
        env['BUILD_RESULTS'] = json.dumps({a['job']: {'result': 'success'} for a in apps})
        release = {'assets': [{'name': a['file'], 'label': 'run=101'} for a in apps]}
        with patch.dict('os.environ', env, clear=True), patch.object(publisher, 'get_release', return_value=release), patch.object(publisher, 'gh') as gh:
            publisher.main()
            gh.assert_not_called()


if __name__ == '__main__':
    unittest.main()
