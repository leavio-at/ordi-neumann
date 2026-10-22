// Führt das echte Seitenskript (aus dem gebauten dist) in einer Browser-Attrappe aus
// und prüft, was in den Ärzt:innen- und Team-Karten steht.
// Regression: Die Momentaufnahme wurde zu früh angewendet (Tabellen weiter unten im Skript
// waren noch leer), der Fehler blieb unbemerkt, die Karten blieben leer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const b = require('../build.js');

const BACKEND = 'https://backend.example';
const DATA = {
  '/public/settings': { status: 'ok', settings: { practice_name: 'Ordination Dr. Test', practice_full_name: 'Ordination Dr. Anna Test', practice_address: 'Testgasse 1, 1010 Wien', practice_city: 'Wien' } },
  '/public/opening-hours': { data: [{ id: 1, user_id: 1, schedule_key: 'anna', display_name: 'Dr. Anna Test', kassen: '["oegk"]', hours: [{ weekday: 1, time_from: '09:00', time_to: '12:00' }] }] },
  '/public/staff': { status: 'ok', data: [{ id: 3, display_name: 'Berta Assistenz' }] },
  '/public/staff-bios': { status: 'ok', staff: [
    { id: 1, role: 'doctor', schedule_key: 'anna', display_name: 'Dr. Anna Test', bio: { de: 'BIO-ANNA-DE', hu: 'BIO-ANNA-HU', en: 'BIO-ANNA-EN' }, schwerpunkte: { de: ['Vorsorge'], hu: [], en: [] } },
    { id: 3, role: 'assistant', display_name: 'Berta Assistenz', bio: { de: 'BIO-BERTA-DE', hu: '', en: '' } } ] },
  '/public/website-photos': { status: 'ok', photos: [{ id: 31, user_id: 1, category: 'user' }, { id: 33, user_id: 3, category: 'user' }] },
};

function builtHtml() {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'render-src-'));
  fs.copyFileSync(path.join(__dirname, '..', 'index.html'), path.join(src, 'index.html'));
  const snap = { __built: 1, ...DATA };
  b.writeDist(b.makeReplacements(snap), src, path.join(src, 'dist'));
  return fs.readFileSync(path.join(src, 'dist', 'index.html'), 'utf8');
}

function run(html, { backend }) {
  const scripts = [...html.matchAll(/<script(?![^>]*type="application)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const snap = html.match(/id="leavio-snapshot">([\s\S]*?)<\/script>/)[1];
  const els = {};
  const errors = [];
  function el(id) {
    if (els[id]) return els[id];
    const store = { innerHTML: '', textContent: '', style: { setProperty() {} }, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} } };
    return (els[id] = new Proxy(store, {
      get: (t, k) => (k in t ? t[k] : k === 'then' ? undefined : typeof k === 'string' ? function () { return el('fn'); } : undefined),
      set: (t, k, v) => { t[k] = v; return true; },
    }));
  }
  const document = {
    getElementById: id => (id === 'leavio-snapshot' ? { textContent: snap } : el(id)),
    querySelector: () => el('q'), querySelectorAll: () => [], addEventListener() {}, createElement: () => el('new'),
    body: el('body'), documentElement: el('html'), head: el('head'), visibilityState: 'hidden', title: '', referrer: '',
  };
  const store = {};
  const sandbox = {
    document, console: { log: (...a) => { if (String(a[0]).includes('fehlgeschlagen')) errors.push(a.join(' ')); } },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    AbortController, setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 20)), setInterval: () => 0, clearInterval() {},
    location: { pathname: '/', hash: '', search: '' }, IntersectionObserver: class { observe() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }), navigator: {}, history: { replaceState() {} },
    URLSearchParams, encodeURIComponent,
    fetch: async (u) => {
      if (!backend) throw new Error('offline');
      const p = new URL(u).pathname;
      return DATA[p] ? { ok: true, json: async () => DATA[p] } : { ok: false, status: 404 };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(scripts.join('\n;\n'), sandbox);
  return new Promise(r => setTimeout(() => r({ els, errors }), 200));
}

for (const backend of [true, false]) {
  test(`doctor and team cards show photo and biography from the snapshot (backend ${backend ? 'up' : 'down'})`, async () => {
    const { els, errors } = await run(builtHtml(), { backend });
    assert.deepEqual(errors, [], 'rendering the data must not throw');
    const doctors = els['team-doctors-grid'].innerHTML;
    assert.match(doctors, /Dr\. Anna Test/);
    assert.match(doctors, /arzt-photo-img/);
    assert.match(doctors, /BIO-ANNA-DE/);
    const staff = els['staff-rows'].innerHTML;
    assert.match(staff, /Berta Assistenz/);
    assert.match(staff, /BIO-BERTA-DE/);
    assert.match(staff, /public\/photos\/33/);
  });
}
