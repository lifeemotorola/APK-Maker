#!/usr/bin/env python3
"""Pinned source + user-supplied model acquisition. No LFS pointer accepted.
Outputs are generated caches, never new tracked binary copies. Model archives
remain in the user's main-branch commit; the working branch is not switched.
"""
import argparse
import hashlib
from pathlib import Path
import shutil
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.cache' / 'demucs-native'
MODEL_COMMIT = 'b2b6ed2f48bcc9e432c8a4c9a0af3d78e475bb58'
CPP_COMMIT = '4edae497a114de1ccb17ac9b4a2b8fc0144714d7'
EIGEN_COMMIT = 'ce10ea5f1a177cdd2086e0ba13a5ab2cae0a4b44'
MODEL_SHA = '72b17c42d308982ddb5069bc3bf48b81a5aac4cb6516e4366c0fa7cef6df0064'
MODEL_SIZE = 83994361


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def fetch_archive(repo, commit):
    path = CACHE / (repo.split('/')[-1] + '-' + commit + '.tar.gz')
    if not path.exists():
        temp = path.with_suffix('.part')
        with urllib.request.urlopen('https://codeload.github.com/' + repo + '/tar.gz/' + commit, timeout=120) as src, temp.open('wb') as out:
            shutil.copyfileobj(src, out)
        temp.replace(path)
    return path


def sources():
    cpp, eigen = CACHE / 'cpp', CACHE / 'eigen'
    if not (cpp / '.pinned').exists():
        cpp.mkdir(exist_ok=True)
        with tarfile.open(fetch_archive('sevagh/demucs.cpp', CPP_COMMIT)) as archive:
            prefix = 'demucs.cpp-' + CPP_COMMIT + '/'
            for member in archive.getmembers():
                rel = member.name.removeprefix(prefix)
                if member.isfile() and (rel.startswith('src/') or rel == 'LICENSE'):
                    target = cpp / rel
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(archive.extractfile(member).read())
        # Upstream's invariant errors must not terminate an Android process.
        for name in ['src/crosstransformer.cpp', 'src/layers.cpp']:
            p = cpp / name
            text = p.read_text()
            assert text.count('std::exit(1);') == 1
            p.write_text('#include <stdexcept>\n' + text.replace('std::exit(1);', 'throw std::runtime_error("Demucs invariant failed");'))
        (cpp / '.pinned').write_text(CPP_COMMIT)
    if not (eigen / '.pinned').exists():
        eigen.mkdir(exist_ok=True)
        with tarfile.open(fetch_archive('sevagh/demucs-android', EIGEN_COMMIT)) as archive:
            prefix = 'demucs-android-' + EIGEN_COMMIT + '/app/src/main/cpp/eigen/'
            for member in archive.getmembers():
                if not member.name.startswith(prefix) or not member.isfile():
                    continue
                rel = member.name[len(prefix):]
                if rel.startswith(('Eigen/', 'unsupported/')) or rel.startswith('COPYING.'):
                    target = eigen / rel
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(archive.extractfile(member).read())
        (eigen / '.pinned').write_text(EIGEN_COMMIT)
    return cpp, eigen


def model():
    output = CACHE / 'ggml-model-htdemucs-4s-f16.bin'
    if output.exists() and output.stat().st_size == MODEL_SIZE and digest(output) == MODEL_SHA:
        return output
    import py7zr
    # codeload serves actual Git blobs, unlike the upstream model's LFS pointer.
    archive = fetch_archive('lifeemotorola/APK-Maker', MODEL_COMMIT)
    joined = CACHE / 'model.7z'
    with tarfile.open(archive) as src, joined.open('wb') as out:
        for number in range(1, 9):
            name = 'APK-Maker-' + MODEL_COMMIT + '/android-choirtune/ggml-model-htdemucs-4s-f16.7z.' + str(number).zfill(3)
            shutil.copyfileobj(src.extractfile(name), out)
    extracted = CACHE / 'model-extracted'
    extracted.mkdir(exist_ok=True)
    with py7zr.SevenZipFile(joined) as src:
        if src.getnames() != ['ggml-model-htdemucs-4s-f16.bin']:
            raise RuntimeError('Unexpected archive members')
        src.extractall(extracted)
    candidate = extracted / output.name
    if candidate.stat().st_size != MODEL_SIZE or digest(candidate) != MODEL_SHA:
        raise RuntimeError('Model size/SHA-256 mismatch; refusing to bundle')
    shutil.copyfile(candidate, output)
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--sources-only', action='store_true')
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    cpp, eigen = sources()
    print('Pinned Demucs C++ and MPL2-only Eigen ready:', cpp, eigen)
    if not args.sources_only:
        print('Verified embedded model:', model(), MODEL_SIZE, MODEL_SHA)
