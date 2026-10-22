// Seitenlogik: Funktionen werden aus index.html herausgeschnitten und mit
// Attrappen für fetch/localStorage ausgeführt (kein Browser nötig).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function slice(from, to) {
  const i = HTML.indexOf(from);
  const j = HTML.indexOf(to, i);
  assert.ok(i > -1 && j > i, `marker not found: ${from}`);
  return HTML.slice(i, j);
}

// Baut eine Umgebung mit dem echten Datenquellen-Code aus der Seite.
function makeEnv({ snap = {}, store = {}, fetchImpl } = {}) {
  const code = slice('  var _SNAP = {};', '  // ── PRAXISEINSTELLUNGEN')
    // nur der Block bis zum Ende von _getJson wird gebraucht
    ;
  const end = code.indexOf('  var _doctorsData');
  const src = (end > -1 ? code.slice(0, end) : code);
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  const document = { getElementById: () => ({ textContent: JSON.stringify(snap) }) };
  const factory = new Function('BACKEND_URL', 'document', 'localStorage', 'fetch', 'AbortController', 'setTimeout', 'console',
    src + '\nreturn { _getJson, _readCache, _writeCache, _SNAP };');
  const noTimer = () => 0;
  return { store, api: factory('http://backend', document, localStorage, fetchImpl, AbortController, noTimer, { log() {} }) };
}

const ok = body => async () => ({ ok: true, json: async () => body });

test('the snapshot is applied immediately, before any network answer', async () => {
  const applied = [];
  let release;
  const gate = new Promise(r => { release = r; });
  const { api } = makeEnv({
    snap: { __built: 1000, '/public/settings': { v: 'snap' } },
    fetchImpl: async () => { await gate; return { ok: true, json: async () => ({ v: 'live' }) }; },
  });
  const p = api._getJson('/public/settings', d => applied.push(d.v));
  assert.deepEqual(applied, ['snap'], 'seed must be applied synchronously');
  release();
  await p;
  assert.deepEqual(applied, ['snap', 'live']);
});

test('live data equal to the seed is not applied twice', async () => {
  const applied = [];
  const { api } = makeEnv({ snap: { __built: 1, '/p': { a: 1 } }, fetchImpl: ok({ a: 1 }) });
  await api._getJson('/p', d => applied.push(d));
  assert.equal(applied.length, 1);
});

test('backend down: the seed stays and nothing throws', async () => {
  const applied = [];
  const { api } = makeEnv({ snap: { __built: 1, '/p': { a: 1 } }, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(await api._getJson('/p', d => applied.push(d)), false);
  assert.deepEqual(applied, [{ a: 1 }]);
});

test('backend error status: seed stays, no cache written', async () => {
  const { api, store } = makeEnv({ snap: { __built: 1, '/p': { a: 1 } }, fetchImpl: async () => ({ ok: false, status: 503 }) });
  await api._getJson('/p', () => {});
  assert.deepEqual(Object.keys(store), []);
});

test('no seed and no backend: apply is never called (page stays behind the notice)', async () => {
  const applied = [];
  const { api } = makeEnv({ fetchImpl: async () => { throw new Error('offline'); } });
  await api._getJson('/p', d => applied.push(d));
  assert.deepEqual(applied, []);
});

test('a live answer is cached and used first on the next visit', async () => {
  const store = {};
  const first = makeEnv({ store, fetchImpl: ok({ v: 'live-1' }) });
  await first.api._getJson('/p', () => {});
  const applied = [];
  const second = makeEnv({ store, fetchImpl: async () => { throw new Error('offline'); } });
  await second.api._getJson('/p', d => applied.push(d.v));
  assert.deepEqual(applied, ['live-1']);
});

test('a cache older than the snapshot is ignored', async () => {
  const store = { 'leavio_site_v1:http://backend:/p': JSON.stringify({ t: 500, data: { v: 'old-cache' } }) };
  const applied = [];
  const { api } = makeEnv({ store, snap: { __built: 1000, '/p': { v: 'snap' } }, fetchImpl: async () => { throw new Error('x'); } });
  await api._getJson('/p', d => applied.push(d.v));
  assert.deepEqual(applied, ['snap']);
});

test('a broken cache entry or snapshot never breaks the page', async () => {
  const store = { 'leavio_site_v1:http://backend:/p': '{not json' };
  const applied = [];
  const { api } = makeEnv({ store, fetchImpl: ok({ v: 'live' }) });
  await api._getJson('/p', d => applied.push(d.v));
  assert.deepEqual(applied, ['live']);
});

test('an error inside apply is contained', async () => {
  const { api } = makeEnv({ snap: { __built: 1, '/p': { a: 1 } }, fetchImpl: ok({ a: 2 }) });
  await assert.doesNotReject(api._getJson('/p', () => { throw new Error('render bug'); }));
});

// ---- static guarantees about the page ---------------------------------------------------
test('all five data loaders go through _getJson, none fetches directly', () => {
  for (const p of ['settings', 'staff', 'opening-hours', 'staff-bios', 'website-photos']) {
    assert.ok(HTML.includes(`_getJson('/public/${p}'`), p);
    assert.ok(!HTML.includes(`fetch(BACKEND_URL + '/public/${p}'`), `direct fetch of ${p}`);
  }
});

test('the 2 second timeout shows the update notice instead of revealing the sample', () => {
  assert.ok(!/setTimeout\(_revealBrandPending/.test(HTML), 'timeout must not reveal');
  const timeout = slice('  setTimeout(function() {\n    if (_ready.settings', '  loadPracticeSettings();');
  assert.ok(timeout.includes('_showUpdateNotice()'));
  assert.ok(!timeout.includes('_revealBrandPending'));
});

test('brand placeholders are revealed only after real settings were applied', () => {
  const reveals = HTML.match(/_revealBrandPending\(\);/g) || [];
  assert.equal(reveals.length, 1);
  const i = HTML.indexOf('_ready.settings = true;');
  assert.ok(i > 0 && HTML.indexOf('_revealBrandPending();', i) - i < 120);
});

test('notice markup and the single snapshot slot exist', () => {
  assert.ok(HTML.includes('id="update-notice"'));
  assert.ok(HTML.includes('Wir aktualisieren gerade'));
  assert.equal((HTML.match(/__SNAPSHOT__/g) || []).length, 1);
});

test('the notice is hidden by default and shown/hidden via display, not the hidden attribute', () => {
  const m = HTML.match(/<div id="update-notice" style="([^"]*)"/);
  assert.ok(m && m[1].startsWith('display:none'));
  assert.ok(HTML.includes("el.style.display = 'flex'"));
});
