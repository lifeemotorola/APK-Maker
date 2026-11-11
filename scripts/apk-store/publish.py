#!/usr/bin/env python3
"""Publish successful, trusted main-branch APK artifacts as public release files.
Never run against PR artifacts. Failed app jobs keep their previous public APK.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]
REPO = 'lifeemotorola/APK-Maker'
TAG = 'apk-downloads'


def gh(*args, check=True):
    result = subprocess.run(['gh', *args], text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or 'GitHub operation failed')
    return result


def inspect_apk(apk, badging):
    with zipfile.ZipFile(apk) as archive:
        if not {'AndroidManifest.xml', 'classes.dex'}.issubset(archive.namelist()):
            raise ValueError('Missing Android manifest/dex in ' + str(apk))
        if archive.testzip() is not None:
            raise ValueError('Corrupt APK archive: ' + str(apk))
    text = badging.read_text()
    version = re.search(r"versionName='([A-Za-z0-9][A-Za-z0-9._+\-]{0,35})'", text)
    sdk = re.search(r"minSdkVersion:'(\d+)'", text)
    if not version or not sdk:
        raise ValueError('Missing or invalid version/minSdk badging')
    digest = hashlib.sha256()
    with apk.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return version.group(1), sdk.group(1), digest.hexdigest()


def label_for(version, sdk, digest, sha, run):
    if not re.fullmatch(r'[a-f0-9]{40}', sha) or not str(run).isdigit():
        raise ValueError('Invalid source commit/run')
    return f'version={version};sha256={digest};commit={sha};run={run};minSdk={sdk}'


def existing_run(label):
    match = re.search(r'(?:^|;)run=(\d+)(?:;|$)', label or '')
    return int(match.group(1)) if match else 0


def get_release():
    result = gh('api', f'repos/{REPO}/releases/tags/{TAG}', check=False)
    try:
        response = json.loads(result.stdout)
    except json.JSONDecodeError:
        raise RuntimeError(result.stderr or 'Invalid GitHub release response')
    if result.returncode:
        if response.get('message') == 'Not Found':
            return None
        raise RuntimeError(result.stderr or response.get('message', 'Release lookup failed'))
    if response.get('draft'):
        raise RuntimeError('Download release must be public, not a draft')
    return response


def main():
    # Defense in depth: the workflow also restricts event, ref and repository.
    if os.environ.get('GITHUB_REPOSITORY') != REPO or os.environ.get('GITHUB_REF') != 'refs/heads/main' or os.environ.get('GITHUB_EVENT_NAME') not in ('push', 'workflow_dispatch'):
        raise RuntimeError('APK publishing is allowed only for trusted main-branch builds')
    sha, run = os.environ['GITHUB_SHA'], os.environ['GITHUB_RUN_ID']
    if not re.fullmatch(r'[a-f0-9]{40}', sha) or not run.isdigit():
        raise ValueError('Invalid workflow identity')
    results = json.loads(os.environ['BUILD_RESULTS'])
    apps = json.loads((ROOT / 'downloads/apps.json').read_text())
    release = get_release()
    assets = {a['name']: a for a in (release or {}).get('assets', [])}
    prepared, failures = [], []
    with tempfile.TemporaryDirectory(prefix='apk-public-downloads-') as temp:
        for app in apps:
            if results.get(app['job'], {}).get('result') != 'success':
                print('Keep previous public build (job not successful):', app['name'])
                continue
            if existing_run(assets.get(app['file'], {}).get('label')) > int(run):
                print('Skip older workflow than the published build:', app['name'])
                continue
            try:
                folder = Path(temp) / app['id']
                gh('run', 'download', run, '--repo', REPO, '--name', app['artifact'], '--dir', str(folder))
                apks = list(folder.rglob(app['file']))
                badging = list(folder.rglob('badging.txt'))
                if len(apks) != 1 or len(badging) != 1:
                    raise ValueError('Expected exactly one root APK and badging.txt')
                version, sdk, digest = inspect_apk(apks[0], badging[0])
                prepared.append((app, apks[0], label_for(version, sdk, digest, sha, run)))
            except Exception as error:
                failures.append(app['name'] + ': ' + str(error))
        if prepared and release is None:
            gh('release', 'create', TAG, '--repo', REPO, '--target', sha, '--title', 'Android APK downloads', '--prerelease', '--latest=false', '--notes',
               'Rolling collection of successful main-branch APK builds. Download individual .apk files without a GitHub account. These are repository-signed developer builds, not Google Play releases. Each asset label includes its source commit, version and SHA-256. Failed app builds retain their last published version. App source and installation instructions are in the repository.')
        for app, apk, label in prepared:
            try:
                gh('release', 'upload', TAG, str(apk) + '#' + label, '--repo', REPO, '--clobber')
                print('Published:', app['name'], 'https://github.com/' + REPO + '/releases/download/' + TAG + '/' + app['file'])
            except Exception as error:
                failures.append(app['name'] + ': ' + str(error))
    if failures:
        raise RuntimeError('Some APKs could not be published:\n' + '\n'.join(failures))
    print('Public APK publishing complete:', len(prepared), 'files')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('::error::' + str(error), file=sys.stderr)
        sys.exit(1)
