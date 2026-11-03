#!/usr/bin/env python3
"""deemoji.py — replace emoji/symbol glyphs in the staged NewsDesk web app
(assets/www, extracted from obs-news-desk.zip) with inline SVG icons or plain
text. Run by build.sh after staging; fails loudly if a replacement does not
apply or if any glyph survives.

Usage: python3 tools/deemoji.py <wwwDir>
"""
import os
import re
import sys

EMOJI = re.compile(
    '[\U0001F000-\U0001FAFF\U0001F1E6-\U0001F1FF\u2600-\u26FF\u2700-\u27BF'
    '\u2B00-\u2BFF\u2190-\u21FF\u2300-\u23FF\u25A0-\u25FF\u2900-\u297F'
    '\u3030\u303D\u3297\u3299\uFE0F\u200D]'
)

def svg(inner, fill=False, q='"'):
    # q = attribute quote char; use q="'" when embedding inside a double-quoted JS string
    f = ('fill=%scurrentColor%s stroke=%snone%s' % (q, q, q, q)) if fill else (
        'fill=%snone%s stroke=%scurrentColor%s stroke-width=%s2%s stroke-linecap=%sround%s stroke-linejoin=%sround%s'
        % (q, q, q, q, q, q, q, q, q, q))
    return f'<svg class={q}de{q} viewBox={q}0 0 24 24{q} {f}>{inner}</svg>'

ICON_CSS = ('<style>.de{width:1em;height:1em;vertical-align:-.14em}'
            '#msgIcon .de{width:44px;height:44px}</style>')

# icon markup used below
PLAY   = svg('<path d="M7 4.5l12 7.5-12 7.5v-15z"/>', fill=True)
PAUSE  = svg('<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>', fill=True)
SKIP   = svg('<path d="M6 4.5l10 7.5-10 7.5v-15z"/><path d="M17 4h3v16h-3z"/>', fill=True)
BOLT   = svg('<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/>', fill=True)
REFRESH= svg('<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>')
BOOK   = svg('<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2V4z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7V4z"/>')
X      = svg('<path d="M18 6L6 18M6 6l12 12"/>')
IMAGE  = svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 15.5l-5-5-9 8.5"/>')
PLUS   = svg('<path d="M12 5v14M5 12h14"/>')
PHONE  = svg('<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M10.5 18.5h3"/>')
POWER  = svg('<path d="M12 2.5V11"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>')
EYE    = svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>')
EXT    = svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>')
TL     = svg('<path d="M17 17L7 7"/><path d="M7 15V7h8"/>')
TR     = svg('<path d="M7 17L17 7"/><path d="M9 7h8v8"/>')
BL     = svg('<path d="M17 7L7 17"/><path d="M15 17H7V9"/>')
BR     = svg('<path d="M7 7l10 10"/><path d="M17 9v8H9"/>')
CAMERA = svg('<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>')
WARN   = svg('<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>')
LOCK   = svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>')
HOUR   = svg('<path d="M6 2h12M6 22h12"/><path d="M8 2v4l4 5 4-5V2"/><path d="M8 22v-4l4-5 4 5v4"/>')
OKC    = svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>')

# (relative file, [(old, new), ...]) — every old must be present, else fail
PATCHES = {
    'control/index.html': [
        ("content:'▸';", "content:'';"),
        ('<button class="btn ghost" id="btnReload">↻ Reload overlay</button>',
         f'<button class="btn ghost" id="btnReload">{REFRESH}Reload overlay</button>'),
        ('<button class="btn ghost" id="btnGuide">⌗ Guides</button>',
         f'<button class="btn ghost" id="btnGuide">{BOOK}Guides</button>'),
        ('<button class="btn primary" id="btnSting">⚡ Sting</button>',
         f'<button class="btn primary" id="btnSting">{BOLT}Sting</button>'),
        ('>Open ↗</a>', f'>{EXT}Open</a>'),
        ('<button id="plStart">▶ Play</button>', f'<button id="plStart">{PLAY}Play</button>'),
        ('<button id="plNext">⏭ Next</button>', f'<button id="plNext">{SKIP}Next</button>'),
        ('<button id="plStop">⏸ Stop</button>', f'<button id="plStop">{PAUSE}Stop</button>'),
        ('· ⏻ toggles', f'· {EYE}toggles'),
        ('<button data-spos="tl">↖ Top left</button>', f'<button data-spos="tl">{TL}Top left</button>'),
        ('<button data-spos="tr">↗ Top right</button>', f'<button data-spos="tr">{TR}Top right</button>'),
        ('<button data-spos="bl">↙ Bottom left</button>', f'<button data-spos="bl">{BL}Bottom left</button>'),
        ('<button data-spos="br">↘ Bottom right</button>', f'<button data-spos="br">{BR}Bottom right</button>'),
        ('<button class="btn sm" id="pipVideoPlay" style="flex:1">▶ Play</button>',
         f'<button class="btn sm" id="pipVideoPlay" style="flex:1">{PLAY}Play</button>'),
        ('↺ From start', f'{REFRESH}From start'),
        ('title="Remove the clip">✕</button>', f'title="Remove the clip">{X}</button>'),
        ('title="Choose image">◫</button>', f'title="Choose image">{IMAGE}</button>'),
        ('title="Show / hide">⏻</button>', f'title="Show / hide">{POWER}</button>'),
        ('title="Clear image"', 'title="Clear image"'),  # no-op guard
        ('>✕</button>', f'>{X}</button>'),
        ('data-none="1">✕<br>No image', f'data-none="1">{X}<br>No image'),
        ('data-upload="1">＋<br>Up', f'data-upload="1">{PLUS}<br>Up'),
        ("' · 🖼 ' + esc(", f"' · {IMAGE} ' + esc("),
        ('📱 Show QR code for a phone', f'{PHONE}Show QR code for a phone'),
        ("$('camShowQr').textContent = '📱 Show the link again';",
         f"$('camShowQr').innerHTML = '{PHONE}Show the link again';"),
        ("$('pipVideoPlay').textContent = S.showPipVideo ? '⏸ Stop' : '▶ Play';",
         f"$('pipVideoPlay').innerHTML = S.showPipVideo ? '{PAUSE}Stop' : '{PLAY}Play';"),
        ('title="Delete file">✕</div>', f'title="Delete file">{X}</div>'),
        ('data-del="${i}" title="remove">✕</div>', f'data-del="${{i}}" title="remove">{X}</div>'),
        ('data-delp="${esc(n)}">✕</span>', f'data-delp="${{esc(n)}}">{X}</span>'),
        ("kind + ' → ' + where", "kind + ' &rarr; ' + where"),
        ('<b>Tools ▸ WebRTC Output</b>', '<b>Tools &rsaquo; WebRTC Output</b>'),
        ('<b>→</b> key', '<b>&rarr;</b> key'),
        ('→', '&rarr;'),  # any remaining prose arrows
    ],
    'camera/index.html': [
        ('content:"⚙ ";opacity:.7', 'content:"";opacity:.7'),
        ('<div class="big" id="msgIcon">📷</div>', f'<div class="big" id="msgIcon">{CAMERA}</div>'),
        ('$("msgIcon").textContent = icon;', '$("msgIcon").innerHTML = icon;'),
        # showMsg("…") args are double-quoted JS strings -> svg attrs must use single quotes
        ('showMsg("⚠️",', 'showMsg("' + WARN.replace('"', "'") + '",'),
        ('showMsg("🔒",', 'showMsg("' + LOCK.replace('"', "'") + '",'),
        ('showMsg("⏳",', 'showMsg("' + HOUR.replace('"', "'") + '",'),
        ('showMsg("📷",', 'showMsg("' + CAMERA.replace('"', "'") + '",'),
        ('showMsg("✅",', 'showMsg("' + OKC.replace('"', "'") + '",'),
    ],
    'overlay/overlay.js': [
        ('→', '->'),
    ],
    'START-HERE.html': [
        ('hit ▶ Play', f'hit {PLAY} Play'),
        ('→', '&rarr;'),
    ],
}

TEXT_EXT = ('.html', '.js', '.css', '.json', '.svg', '.txt')


def main():
    www = sys.argv[1] if len(sys.argv) > 1 else 'app/src/main/assets/www'
    if not os.path.isdir(www):
        print('ERROR: no such dir:', www)
        return 2
    # 1. apply the explicit patches
    for rel, pairs in PATCHES.items():
        p = os.path.join(www, rel)
        if not os.path.isfile(p):
            print('WARN: patch target missing (skipped):', p)
            continue
        s = open(p, encoding='utf-8').read()
        for old, new in pairs:
            if old == new:
                continue
            if old not in s:
                print(f'ERROR: pattern not found in {rel}: {old[:60]!r}')
                return 1
            s = s.replace(old, new)
        if rel.endswith('.html') and '</head>' in s and '.de{' not in s:
            s = s.replace('</head>', ICON_CSS + '</head>', 1)
        open(p, 'w', encoding='utf-8').write(s)
        print('patched', rel)
    # 2. assert nothing staged still contains emoji/symbol glyphs
    bad = 0
    for root, dirs, files in os.walk(www):
        dirs[:] = [d for d in dirs if d not in ('fonts',)]
        for f in files:
            if not f.endswith(TEXT_EXT):
                continue
            p = os.path.join(root, f)
            text = open(p, encoding='utf-8', errors='replace').read()
            hits = {}
            for m in EMOJI.finditer(text):
                hits[m.group(0)] = hits.get(m.group(0), 0) + 1
            if hits:
                bad += 1
                print('EMOJI REMAINS in', p, ':', ' '.join(f'{e!r}x{n}' for e, n in sorted(hits.items())))
    if bad:
        print(f'\n{bad} staged file(s) still contain emoji')
        return 1
    print('staged www is emoji-free')
    return 0


if __name__ == '__main__':
    sys.exit(main())
