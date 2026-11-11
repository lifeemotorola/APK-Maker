/* Pastoral — offline sermon generator.
 *
 * Builds a COMPLETE sermon draft (title, scripture ref, key verse, theme,
 * introduction, 3-point outline with verse notes, illustration, application,
 * conclusion, timed delivery notes) from a scripture reference and/or topic
 * keywords, using only the bundled KJV (global bible_data). No network.
 *
 * Exposed as window.PastoralGen in the app and globalThis.PastoralGen in
 * node tests (test_web.mjs imports this file and runs real generations). */
(function (root, factory) {
  var gen = factory();
  root.PastoralGen = gen;
  if (typeof module !== 'undefined' && module.exports) module.exports = gen;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var STOPWORDS = ('the a an and of to in that is for with his her he she it its they them their this these those ' +
    'as at on be by from unto shall will ye you your thou thy thee me my i we us our but or if so not do did doth ' +
    'has have had been am are was were all what which when where who whom how into out up over under again then ' +
    'than there here also let upon your yours ours theirs him hers ours').split(' ');
  var STOP = {};
  STOPWORDS.forEach(function (w) { STOP[w] = 1; });

  var FALLBACK_KW = ['faith', 'hope', 'grace', 'truth', 'peace', 'mercy', 'joy', 'love'];

  function words(text) {
    return String(text || '').toLowerCase()
      .replace(/[^a-z\s']/g, ' ')
      .split(/\s+/)
      .filter(function (w) {
        w = w.replace(/'s$/, '');
        return w.length >= 4 && !STOP[w];
      });
  }

  function keywords(text, count) {
    var freq = {};
    words(text).forEach(function (w) { w = w.replace(/'s$/, ''); freq[w] = (freq[w] || 0) + 1; });
    var out = Object.keys(freq).sort(function (a, b) {
      return freq[b] - freq[a] || (a < b ? -1 : 1);
    });
    return out.slice(0, count || 3);
  }

  function cap(s) {
    s = String(s || '');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  function hash(s) {
    var h = 0;
    s = String(s);
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function clip(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1).trim() + '...' : s;
  }

  function verseNum(v) {
    var p = String(v.ari || '').split(':');
    return parseInt(p[2], 10) || 0;
  }

  function booksOf(bible) {
    var seen = {}, out = [];
    (bible || []).forEach(function (v) {
      var parts = String(v.name || '').split(' ');
      parts.pop();
      var b = parts.join(' ');
      if (b && !seen[b]) { seen[b] = 1; out.push(b); }
    });
    return out;
  }

  /* "Song of Solomon 2:1" -> {book:'Song of Solomon', chapter:2, verse:1, verseEnd:null} */
  function parseRef(ref, bible) {
    var r = String(ref || '').trim();
    if (!r) return null;
    var low = r.toLowerCase();
    var book = null;
    booksOf(bible).forEach(function (b) {
      var bl = b.toLowerCase();
      var bsing = bl.replace(/s$/, ''); // tolerate "Psalm 23" for "Psalms"
      if (low === bl || low.indexOf(bl + ' ') === 0 ||
          low === bsing || low.indexOf(bsing + ' ') === 0) {
        if (!book || b.length > book.length) book = b;
      }
    });
    if (!book) return null;
    var rest = r.slice(book.length).trim();
    var m = rest.match(/^(\d+)(?:\s*:\s*(\d+)(?:\s*-\s*(\d+))?)?/);
    if (!m) return { book: book, chapter: null, verse: null, verseEnd: null };
    return {
      book: book,
      chapter: parseInt(m[1], 10),
      verse: m[2] ? parseInt(m[2], 10) : null,
      verseEnd: m[3] ? parseInt(m[3], 10) : null,
    };
  }

  function chapterVerses(bible, book, chapter) {
    if (!book || !chapter) return [];
    var bi = booksOf(bible).indexOf(book);
    if (bi < 0) return [];
    var prefix = bi + ':' + chapter + ':';
    return (bible || []).filter(function (v) { return String(v.ari || '').indexOf(prefix) === 0; });
  }

  function searchBible(bible, q, limit) {
    var qs = String(q || '').toLowerCase().trim().split(/\s+/).filter(function (w) { return w.length >= 3; });
    if (!qs.length) return [];
    var scored = [];
    (bible || []).forEach(function (v) {
      var t = String(v.verse || '').toLowerCase();
      var s = 0;
      qs.forEach(function (w) { if (t.indexOf(w) >= 0) s += 1; });
      if (s > 0) scored.push({ v: v, s: s });
    });
    scored.sort(function (a, b) { return b.s - a.s || String(a.v.verse).length - String(b.v.verse).length; });
    return scored.slice(0, limit || 10).map(function (x) { return x.v; });
  }

  /* Rotating well-known texts so a one-tap auto-generate with no ref and no
   * topic still produces a full sermon — deterministic per calendar day. */
  var DEFAULT_REFS = [
    'Psalm 23', 'John 3:16', 'Romans 8:28', 'Philippians 4:4', 'Isaiah 40:31',
    'Proverbs 3:5', 'Matthew 11:28', 'Psalm 46', 'Jeremiah 29:11', 'Romans 12:2',
  ];

  function defaultRef(d) {
    var day = d || new Date();
    var key = day.getFullYear() * 10000 + (day.getMonth() + 1) * 100 + day.getDate();
    return DEFAULT_REFS[key % DEFAULT_REFS.length];
  }

  /* Generate a full sermon draft. opts: {ref, topic, duration, bible} */
  function generateSermon(opts) {
    opts = opts || {};
    var bible = opts.bible || [];
    var ref = String(opts.ref || '').trim();
    var topic = String(opts.topic || '').trim();
    var duration = parseInt(opts.duration, 10);
    if (!(duration > 0)) duration = 30;

    var parsed = parseRef(ref, bible);
    var chapter = [];
    var keyVerse = null;
    var refDisp = ref;
    var supports = [];

    if (parsed && parsed.book) {
      if (!parsed.chapter) parsed.chapter = 1;
      chapter = chapterVerses(bible, parsed.book, parsed.chapter);
      if (chapter.length) {
        if (parsed.verse) {
          keyVerse = chapter.filter(function (v) { return verseNum(v) === parsed.verse; })[0] || chapter[0];
        } else if (topic) {
          keyVerse = searchBible(chapter, topic, 1)[0] || chapter[0];
        } else {
          keyVerse = chapter[0];
        }
        if (parsed.verseEnd) {
          refDisp = parsed.book + ' ' + parsed.chapter + ':' + parsed.verse + '-' + parsed.verseEnd;
          supports = chapter.filter(function (v) {
            var n = verseNum(v);
            return n >= parsed.verse && n <= parsed.verseEnd && v !== keyVerse;
          });
        } else if (parsed.verse) {
          refDisp = keyVerse.name;
          supports = chapter.filter(function (v) { return v !== keyVerse; });
        } else {
          refDisp = parsed.book + ' ' + parsed.chapter;
          supports = chapter.filter(function (v) { return v !== keyVerse; });
        }
      }
    }

    if (!keyVerse) {
      /* topic-only (or unparsed ref): search the whole Bible */
      var q = topic || (parsed ? parsed.book : '') || ref || 'love';
      var hits = searchBible(bible, q, 10);
      if (hits.length) {
        keyVerse = hits[0];
        refDisp = keyVerse.name;
        supports = hits.slice(1, 9);
      } else {
        keyVerse = bible[0] || null;
        refDisp = keyVerse ? keyVerse.name : (ref || 'Genesis 1:1');
        supports = (bible || []).slice(1, 9);
      }
    }

    var keyText = keyVerse ? keyVerse.verse : '';
    var bookName = parsed && parsed.book ? parsed.book
      : (keyVerse ? String(keyVerse.name).split(' ').slice(0, -1).join(' ') : 'Scripture');
    var chapterNum = parsed && parsed.chapter ? parsed.chapter : null;

    var kws = keywords(keyText + ' ' + topic + ' ' + bookName, 4);
    for (var fi = 0; kws.length < 3 && fi < FALLBACK_KW.length; fi++) {
      if (kws.indexOf(FALLBACK_KW[fi]) < 0) kws.push(FALLBACK_KW[fi]);
    }
    var k0 = kws[0], k1 = kws[1] || 'grace', k2 = kws[2] || k0;

    var h = hash(ref + '|' + topic + '|' + keyText.slice(0, 40));
    var titles = [
      function () { return cap(k0) + ' in ' + bookName + (chapterNum ? ' ' + chapterNum : ''); },
      function () { return 'Finding ' + cap(k0) + ' in ' + bookName + (chapterNum ? ' ' + chapterNum : ''); },
      function () { return bookName + (chapterNum ? ' ' + chapterNum : '') + ': ' + cap(k0) + ' for Today'; },
      function () { return 'The ' + cap(k1) + ' of ' + cap(k0) + ' (' + bookName + (chapterNum ? ' ' + chapterNum : '') + ')'; },
      function () { return cap(k0) + ' and ' + cap(k1) + ': ' + bookName + (chapterNum ? ' ' + chapterNum : '') + ' Speaks'; },
    ];
    var title = titles[h % titles.length]();

    var theme = 'Based on ' + refDisp + ', God shows us that ' + k0 + (k1 !== k0 ? ' and ' + k1 : '') +
      ' are not just ideas but gifts He gives His people in real life.';

    var intro = [
      'How many of us have needed ' + k0 + ' this week?',
      'In ' + bookName + (chapterNum ? ' chapter ' + chapterNum : '') + ', the Bible opens a window into how God works in ordinary lives.',
      'Our text, ' + refDisp + ', says: "' + clip(keyText, 160) + '"',
      'Big idea: ' + theme,
    ].join('\n');

    function support(i) {
      if (supports[i]) return supports[i];
      var more = searchBible(bible, k0 + ' ' + k1, 20);
      for (var j = 0; j < more.length; j++) {
        if (more[j] !== keyVerse && supports.indexOf(more[j]) < 0) return more[j];
      }
      return null;
    }
    var s1 = support(0), s2 = support(1);
    var points = [
      { h: cap(k0) + ' revealed in ' + refDisp, notes: keyVerse ? keyVerse.name + ' says: "' + clip(keyText, 200) + '"' : '' },
      { h: cap(k1) + ' for our daily walk', notes: s1 ? s1.name + ': "' + clip(s1.verse, 200) + '"' : '' },
      { h: 'Living with ' + cap(k2) + ' today', notes: s2 ? s2.name + ': "' + clip(s2.verse, 200) + '"' : '' },
    ];

    var ills = [
      'Illustration (' + cap(k0) + '): a traveler in a dry land finally finds a spring. That is the surprise of ' + refDisp + ' - when life feels empty, God opens a source of ' + k0 + '. Ask: where am I thirsty right now?',
      'Illustration (' + cap(k0) + '): a lamp is useless hidden under a basket, but on a stand it lights the whole room. ' + refDisp + ' calls us to let ' + k0 + ' shine in our home, our work, and our words this week.',
      'Illustration (' + cap(k0) + '): a sailor caught in a storm learns that the anchor holds. ' + bookName + (chapterNum ? ' ' + chapterNum : '') + ' reminds us that ' + k0 + ' is the anchor when everything else moves.',
    ];
    var illustration = ills[h % ills.length];

    var application = [
      'Where in my life do I most need ' + k0 + ' right now?',
      'What would change this week if ' + refDisp + ' were fully true in my home and my choices?',
      'Who around me needs to hear about ' + k1 + ' today, and how can I share it?',
    ].join('\n');

    var conclusion = cap(k0) + ' is not far away - it is offered in ' + refDisp + '. ' +
      'Today is the day to receive it: trust what God says, act on ' + k1 + ', and pass ' + k0 + ' on to someone who needs it.';

    var introMin = Math.max(2, Math.round(duration * 0.15));
    var conclMin = Math.max(2, Math.round(duration * 0.15));
    var ptMin = Math.max(3, Math.floor((duration - introMin - conclMin) / 3));
    var delivery = 'Timing (' + duration + ' min total): intro ' + introMin + ' min; each of the 3 outline points about ' + ptMin +
      ' min; conclusion ' + conclMin + ' min.\nOpen in prayer - ask for ' + k0 + ' for yourself before you preach it.\nDisplay on screen: ' + refDisp + (keyVerse ? ' - "' + clip(keyText, 120) + '"' : '');

    return {
      title: title,
      ref: refDisp,
      keyVerse: keyText,
      theme: theme,
      intro: intro,
      points: points,
      illustration: illustration,
      application: application,
      conclusion: conclusion,
      delivery: delivery,
      duration: duration,
    };
  }

  return {
    generateSermon: generateSermon,
    defaultRef: defaultRef,
    DEFAULT_REFS: DEFAULT_REFS,
    parseRef: parseRef,
    keywords: keywords,
    booksOf: booksOf,
    chapterVerses: chapterVerses,
    searchBible: searchBible,
  };
});
