#!/usr/bin/env python3
"""Bundle actual upstream licenses and source locations with the APK."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
DEPS = ROOT / '.cache' / 'demucs-native'
DEMUCSPY_LICENSE = '''MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
'''

text = '''Choir Tune Finder: embedded on-device inference notices

Model: original htdemucs four-source weights by Meta/Demucs, converted to f16
by sevagh/demucs.cpp, supplied by the app owner in eight archive parts.
https://github.com/facebookresearch/demucs
https://github.com/sevagh/demucs.cpp
Model SHA-256: 72b17c42d308982ddb5069bc3bf48b81a5aac4cb6516e4366c0fa7cef6df0064

Demucs C++: 4edae497a114de1ccb17ac9b4a2b8fc0144714d7 (MIT).
Two process-exit invariant failures changed to C++ exceptions in our build.

Eigen headers: unmodified Eigen/ and unsupported/ from vendored Eigen at
https://github.com/sevagh/demucs-android/tree/ce10ea5f1a177cdd2086e0ba13a5ab2cae0a4b44/app/src/main/cpp/eigen
Only Eigen headers are used from that repository, not the GPL Android app.
Compiled with EIGEN_MPL2_ONLY; Eigen source and license notices are retained.
The pinned source archive above is the corresponding unmodified source.

Native bridge/transport source and build recipe:
https://github.com/lifeemotorola/APK-Maker/tree/main/android-choirtune/native

Demucs weights and separation are not a SATB-trained choir model. Blended
vocals are a model estimate, and four SATB practice tracks are synthesized
pitch estimates, not isolated singers.

=== Original Demucs license ===
''' + DEMUCSPY_LICENSE
text += '\n=== Demucs C++ license ===\n' + (DEPS / 'cpp/LICENSE').read_text()
for path in sorted((DEPS / 'eigen').glob('COPYING.*')):
    text += '\n=== Eigen ' + path.name + ' ===\n' + path.read_text()
Path(sys.argv[1]).write_text(text)
