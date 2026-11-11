#!/usr/bin/env python3
"""Artifact gate: real model bytes, ARM64 ELF, 16 KiB LOADs, JNI exports, UI.
This is a packaging check, not proof of Android runtime execution.
"""
import hashlib
from pathlib import Path
import struct
import sys
import zipfile


def verify(path):
    with zipfile.ZipFile(path) as apk:
        name = 'assets/demucs/ggml-model-htdemucs-4s-f16.bin'
        info = apk.getinfo(name)
        assert info.file_size == 83994361, 'Model must not be a Git LFS pointer'
        sha = hashlib.sha256()
        with apk.open(name) as src:
            for block in iter(lambda: src.read(1024 * 1024), b''):
                sha.update(block)
        assert sha.hexdigest() == '72b17c42d308982ddb5069bc3bf48b81a5aac4cb6516e4366c0fa7cef6df0064'
        assert 'MIT License' in apk.read('assets/demucs/THIRD-PARTY-NOTICES.txt').decode()
        assert 'MPL' in apk.read('assets/www/licenses.html').decode()
        assert 'demucsBegin' in apk.read('assets/www/local.js').decode()
        assert 'SATB estimates' in apk.read('assets/www/app.js').decode()
        assert 'synthesized pitch guides' in apk.read('assets/www/index.html').decode()
        elf = apk.read('lib/arm64-v8a/libchoirdemucs.so')
        assert elf[:6] == b'\x7fELF\x02\x01', 'Need little-endian ELF64'
        assert struct.unpack_from('<H', elf, 18)[0] == 183, 'Need AArch64'
        phoff = struct.unpack_from('<Q', elf, 32)[0]
        shoff = struct.unpack_from('<Q', elf, 40)[0]
        phsize, phnum, shsize, shnum = struct.unpack_from('<HHHH', elf, 54)
        loads = 0
        for i in range(phnum):
            ph = struct.unpack_from('<IIQQQQQQ', elf, phoff + phsize * i)
            if ph[0] == 1:
                loads += 1
                assert ph[7] >= 16384, 'Native LOAD not 16 KiB page aligned'
                assert ph[2] % 16384 == ph[3] % 16384
        assert loads > 0
        sections = [struct.unpack_from('<IIQQQQIIQQ', elf, shoff + i * shsize) for i in range(shnum)]
        symbols = set()
        for section in sections:
            if section[1] != 11:
                continue
            strings_section = sections[section[6]]
            strings = elf[strings_section[4]:strings_section[4] + strings_section[5]]
            for at in range(section[4], section[4] + section[5], section[9]):
                name_offset, binding, _, index = struct.unpack_from('<IBBH', elf, at)
                if index and binding >> 4 in (1, 2):
                    symbols.add(strings[name_offset:].split(b'\0', 1)[0].decode())
        for method in ['reset', 'cancelNative', 'progressNative', 'runNative']:
            assert 'Java_com_choirtune_app_DemucsController_' + method in symbols, 'Missing JNI method ' + method
        assert b'libc++_shared.so\0' not in elf, 'C++ runtime must be statically linked'
    print('APK verified: exact 83,994,361-byte model, ARM64 JNI exports, 16 KiB ELF LOADs, licenses and offline UI')


if __name__ == '__main__':
    verify(Path(sys.argv[1]))
