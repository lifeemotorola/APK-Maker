#!/usr/bin/env python3
"""check_no_emoji.py — fail if any emoji/symbol glyphs remain in the given files/dirs.

Usage: python3 scripts/check_no_emoji.py <path> [path...]

Scans text files (.js .ts .tsx .jsx .html .css .json .xml .java .vue .md .py .sh .yml)
under the given paths for emoji and emoji-presentation symbol glyphs (pictographs,
misc symbols, dingbats, arrows, geometric shapes, keycaps...). Binary files and
node_modules/build dirs are skipped. Exit 1 with a report if anything is found.
"""
import os
import re
import sys

EMOJI = re.compile(
    '[\U0001F000-\U0001FAFF'   # pictographs & emoticons
    '\U0001F1E6-\U0001F1FF'   # flags
    '\u2600-\u26FF'           # misc symbols (sun, warning, gear...)
    '\u2700-\u27BF'           # dingbats (check, cross, arrows...)
    '\u2B00-\u2BFF'           # stars, arrows
    '\u2190-\u21FF'           # arrows
    '\u2300-\u23FF'           # misc technical (hourglass, pause, eject...)
    '\u25A0-\u25FF'           # geometric shapes
    '\u2900-\u297F'
    '\u3030\u303D\u3297\u3299'
    '\uFE0F\u200D]'
)
TEXT_EXT = ('.js', '.ts', '.tsx', '.jsx', '.html', '.css', '.json', '.xml',
            '.java', '.vue', '.md', '.py', '.sh', '.yml', '.yaml', '.txt', '.svg')
# obs-news-desk/ is the gitignored upstream tree extracted from the zip at build
# time; the APK gets the de-emoji-patched staged copy (checked in build.sh)
SKIP_DIRS = {'node_modules', 'build', '.git', 'dist', '.next', 'obs-news-desk'}
# the de-emoji patcher necessarily contains the glyphs it replaces (mapping keys)
SKIP_FILES = {'deemoji.py'}


def iter_files(path):
    if os.path.isfile(path):
        if os.path.basename(path) not in SKIP_FILES:
            yield path
        return
    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f in SKIP_FILES:
                continue
            if f.endswith(TEXT_EXT):
                yield os.path.join(root, f)


def main():
    targets = sys.argv[1:]
    if not targets:
        print('usage: check_no_emoji.py <path> [path...]')
        return 2
    bad = 0
    for t in targets:
        for p in iter_files(t):
            try:
                text = open(p, encoding='utf-8', errors='replace').read()
            except OSError:
                continue
            hits = {}
            for m in EMOJI.finditer(text):
                hits[m.group(0)] = hits.get(m.group(0), 0) + 1
            if hits:
                bad += 1
                summary = ' '.join(f'{e!r}x{n}' for e, n in sorted(hits.items()))
                print(f'EMOJI FOUND in {p}: {summary}')
    if bad:
        print(f'\n{bad} file(s) still contain emoji/symbol glyphs')
        return 1
    print(f'no emoji found in {len(targets)} target(s)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
