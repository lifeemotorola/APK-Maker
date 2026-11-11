import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const html = read('index.html');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
assert.equal(ids.length, new Set(ids).size, 'No duplicated controls');
assert.match(html, /By Emmanuel Suah/);
assert.match(html, /<script src="navigation.js"><\/script>/);
assert.match(html, /id="menuBtn"[^>]*aria-expanded="false"/);
for (const part of ['soprano', 'alto', 'tenor', 'bass']) assert.match(html, new RegExp('option value="' + part + '"'));
const home = html.split('id="screen-home"')[1].split('id="screen-tuner"')[0];
assert.match(home, /id="pickBtn"/);
assert.match(home, /id="results"/);
assert.match(home, /Without Demucs/);
assert.doesNotMatch(home, /id="demucsFileInput"/);
assert.match(html.split('id="screen-settings"')[1], /id="demucsFileInput"/);
assert.doesNotMatch(home, /id="(?:serverUrl|startTunerBtn|useDemucs|library)"/);
for (const screen of ['tuner', 'settings', 'library', 'server']) {
  assert.match(html, new RegExp('id="screen-' + screen + '" class="screen hidden" hidden'));
}
class Element {
  constructor(id) {
    this.id = id; this.events = {}; this.attrs = {}; this.hidden = id.startsWith('screen-') && id !== 'screen-home';
    this.classes = new Set(this.hidden ? ['hidden'] : []);
    this.classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) };
    this.clicks = 0;
  }
  addEventListener(name, fn) { this.events[name] = fn; }
  click() { this.clicks++; this.events.click?.({ target: this }); }
  setAttribute(name, value) { this.attrs[name] = value; }
  removeAttribute(name) { delete this.attrs[name]; }
  focus() { focused = this; }
  querySelector() { return this.heading ||= new Element(this.id + '-heading'); }
  showModal() { this.open = true; }
  close() { this.open = false; this.events.close?.(); }
  getBoundingClientRect() { return { left: 0, top: 0, right: 320, bottom: 800 }; }
}
let focused, scrolls = 0;
const elements = Object.fromEntries(ids.map(id => [id, new Element(id)]));
const names = ['home', 'tuner', 'settings', 'library', 'server'];
const links = names.map(name => Object.assign(new Element('link-' + name), { dataset: { screen: name } }));
const back = new Element('back');
const $ = id => elements[id];
$('appMenu').querySelectorAll = () => [$('closeMenuBtn'), ...links];
const sandbox = { document: {
  get activeElement() { return focused; },
  getElementById: $,
  querySelectorAll: selector => selector === '[data-screen]' ? links : selector === '.screen' ? names.map(n => $('screen-' + n)) : [back]
}, window: { scrollTo: () => scrolls++ } };
vm.runInNewContext(read('navigation.js'), sandbox);
$('menuBtn').click();
let prevented = 0;
links.at(-1).focus();
$('appMenu').events.keydown({ key: 'Tab', preventDefault: () => prevented++ });
assert.equal(focused, $('closeMenuBtn'));
$('appMenu').events.keydown({ key: 'Tab', shiftKey: true, preventDefault: () => prevented++ });
assert.equal(focused, links.at(-1));
assert.equal(prevented, 2, 'Focus wraps in both directions');
assert.equal($('appMenu').open, true);
assert.equal($('menuBtn').attrs['aria-expanded'], 'true');
links[2].click();
assert.equal($('appMenu').open, false);
assert.equal($('menuBtn').attrs['aria-expanded'], 'false');
assert.equal($('screen-settings').hidden, false);
assert.equal($('screen-home').hidden, true);
assert.equal(links[2].attrs['aria-current'], 'page');
assert.equal(focused, $('screen-settings').heading);
back.click();
assert.equal($('screen-home').hidden, false);
links[1].click(); links[4].click();
assert.equal($('stopTunerBtn').clicks, 1, 'Leaving tuner stops mic');
assert.equal($('stopDroneBtn').clicks, 1, 'Leaving tuner stops drone');
assert.equal($('screen-server').hidden, false);
const beforeScroll = scrolls;
sandbox.window.ChoirNavigation.show('home', false);
assert.equal($('screen-home').hidden, false, 'Analysis/library import can reveal results');
assert.equal(scrolls, beforeScroll, 'Results retain their own scroll target');
assert.equal($('screen-server').hidden, true);
$('menuBtn').click(); $('closeMenuBtn').click();
assert.equal(focused, $('menuBtn'));
$('menuBtn').click(); $('appMenu').events.click({ target: $('appMenu'), clientX: 350, clientY: 100 });
assert.equal($('appMenu').open, false, 'Backdrop dismisses drawer');
$('menuBtn').click(); $('appMenu').events.click({ target: $('appMenu'), clientX: 200, clientY: 100 });
assert.equal($('appMenu').open, true, 'Inside dialog does not dismiss drawer');
$('appMenu').close(); // Native Escape dismissal fires the same close event.
assert.equal($('menuBtn').attrs['aria-expanded'], 'false');
sandbox.window.ChoirNavigation.show('invalid');
assert.equal($('screen-home').hidden, false);
console.log('CHOIRTUNE NAVIGATION TEST: simple home, credit, menu, focus, dismissal, all screens, tuner cleanup and result navigation PASSED');
