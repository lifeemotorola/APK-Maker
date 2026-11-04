#!/usr/bin/env python3
"""Build web/guide-src.json from the reference PDF (android-jsmaster/javascript.pdf).

- extracts the text layer of every page (pypdf)
- REMOVES all author/publisher details (names, Packt, copyright, ISBN, about-the-author)
- keeps every chapter, section, step, exercise and project page (the content)
- maps each book chapter to related JS Mastery topic ids
Output: web/guide-src.json  (copied to assets/www/data/guide.json by build.sh)
"""
import json, re, sys, os
import pypdf

PDF = sys.argv[1] if len(sys.argv) > 1 else '/tmp/javascript.pdf'
OUT = 'web/guide-src.json'

r = pypdf.PdfReader(PDF)
pages = [(pg.extract_text() or '') for pg in r.pages]

# ---- scrub author / publisher details (user requirement) -------------------
SCRUB = [
    (re.compile(r'\bLaurence\b\s*\bLars\b', re.I), ''),
    (re.compile(r'\bLaurence\b', re.I), ''),
    (re.compile(r'\bLars\b', re.I), ''),
    (re.compile(r'[Pp]ackt[A-Za-z]*'), 'the publisher'),
    (re.compile(r'packt\.[a-z]+', re.I), ''),
    (re.compile(r'feedback@\S+|copyright@\S+', re.I), ''),
    (re.compile(r'Copyright\s*©.*', re.I), ''),
    (re.compile(r'ISBN[^\n]*', re.I), ''),
    (re.compile(r'All rights reserved\..*', re.I), ''),
    (re.compile(r'No part of this book.*', re.I), ''),
    (re.compile(r'First published:.*', re.I), ''),
    (re.compile(r'Published by.*', re.I), ''),
    (re.compile(r'Senior Publishing.*', re.I), ''),
    (re.compile(r'(Group|Publishing) Product Manager.*', re.I), ''),
    (re.compile(r'\bAbout the (Author|Technical Reviewer|Contributors?)\b.*', re.I), ''),
]
def scrub(t):
    for rx, rep in SCRUB:
        t = rx.sub(rep, t)
    return t

pages = [scrub(t) for t in pages]
pages = [t for t in pages if len(t.strip()) > 40]  # drop cover/copyright/blank pages

# ---- chapters from the Table of Contents pages ------------------------------
toc_idx = [i for i, t in enumerate(pages) if 'Table of Contents' in t]
last_toc = toc_idx[-1] if toc_idx else 0
chap_toc = []  # (n, title)
for i in toc_idx:
    for line in pages[i].splitlines():
        m = re.match(r'^Chapter\s+(\d+)\s*:\s*(.+?)\s+[0-9xvi\[\] ]+$', line.strip())
        if m and all(int(m.group(1)) != n for n, _ in chap_toc):
            chap_toc.append((int(m.group(1)), m.group(2).strip()))
chap_toc.sort()
print('TOC chapters:', chap_toc)

# body starts: a page whose text begins with 'Chapter N'
starts = {}
for i in range(last_toc + 1, len(pages)):
    m = re.match(r'^Chapter\s+(\d+)\s*$', pages[i].strip(), re.M)
    if m:
        n = int(m.group(1))
        if n not in starts:
            starts[n] = i
chapters = []
for n, title in chap_toc:
    if n in starts:
        chapters.append({'n': n, 'title': title, 'start': starts[n]})
# appendix (answers) after the last chapter
last_start = max(c['start'] for c in chapters)
appx = None
for i in range(last_start + 1, len(pages)):
    if re.search(r'^Appendix', pages[i], re.M):
        appx = i
        break
for k, c in enumerate(chapters):
    c['end'] = (chapters[k + 1]['start'] - 1) if k + 1 < len(chapters) else (appx - 1 if appx else len(pages) - 1)
if appx:
    chapters.append({'n': 0, 'title': 'Appendix — Practice Exercise, Project and Self-Check Quiz Answers', 'start': appx, 'end': len(pages) - 1})

# ---- sections per chapter from TOC pages ------------------------------------
sec_re = re.compile(r'^(?!Chapter\b)(?!Table of Contents)(.+?)\s+(?:\[?\s*[0-9xvi]+\s*\]?|[0-9]+)\s*$')
sections = {c['n']: [] for c in chapters}
cur = None
for i in toc_idx:
    for line in pages[i].splitlines():
        line = line.strip()
        if not line:
            continue
        m = re.match(r'^Chapter\s+(\d+)\s*:', line)
        if m:
            cur = int(m.group(1))
            continue
        if cur in sections:
            m2 = sec_re.match(line)
            if m2 and 3 < len(m2.group(1)) < 90 and m2.group(1)[0].isupper():
                title = m2.group(1).strip().rstrip('.')
                if title not in sections[cur]:
                    sections[cur].append(title)

# ---- map chapters to related JS Mastery topic ids ---------------------------
TOPIC_MAP = {
    1: ['welcome', 'console-debug', 'data-types', 'variables'],
    2: ['variables', 'data-types', 'numbers', 'strings', 'operators', 'comparison', 'type-coercion'],
    3: ['arrays', 'objects', 'array-methods', 'destructuring', 'spread-rest'],
    4: ['if-else', 'comparison', 'operators', 'try-catch'],
    5: ['loops-for', 'loops-while'],
    6: ['functions', 'scope', 'arrow-functions', 'callbacks', 'hof', 'closures', 'recursion'],
    7: ['objects', 'classes', 'inheritance', 'prototypes', 'this-keyword'],
    8: ['array-methods', 'map-filter', 'reduce', 'find-some-every', 'sorting', 'string-methods',
        'json', 'dates', 'numbers', 'regex', 'timers', 'promises', 'async-await', 'generators', 'iterators'],
    9: ['dom'],
    10: ['dom', 'callbacks'],
    11: ['dom', 'callbacks', 'event-loop', 'timers'],
    12: ['promises', 'async-await', 'modules', 'memory', 'testing', 'proxy', 'template-strings',
         'try-catch', 'spread-rest', 'destructuring', 'final-project'],
    13: ['promises', 'async-await', 'timers', 'event-loop'],
    14: ['modules', 'memory', 'testing', 'regex'],
    15: ['json', 'promises', 'async-await', 'timers', 'final-project'],
    0: ['testing', 'final-project'],
}
for c in chapters:
    c['sections'] = sections.get(c['n'], [])
    c['topics'] = TOPIC_MAP.get(c['n'], [])

guide = {
    'title': 'JavaScript: Beginner to Professional — full in-app guide',
    'note': 'Complete step-by-step reference guide included with the course (author and publisher details omitted). Every chapter, section, exercise and project page is below — read it offline inside the app.',
    'chapters': chapters,
    'pages': [{'i': i, 't': t} for i, t in enumerate(pages)],
}
blob = json.dumps(guide)
for tok in ['Laurence', 'Lars', 'Packt', 'packt', 'Copyright', 'ISBN']:
    assert tok not in blob, 'scrub failed for ' + tok
json.dump(guide, open(OUT, 'w'), ensure_ascii=False, separators=(',', ':'))
print('chapters:', len(chapters), '| pages kept:', len(pages), '| guide-src.json:', os.path.getsize(OUT), 'bytes')
print('chapters:', [(c['n'], c['title'][:45], c['start'], c['end'], len(c['sections'])) for c in chapters])
