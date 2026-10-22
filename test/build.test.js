const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync, spawn } = require('child_process');
const b = require('../build.js');

const SETTINGS = { status: 'ok', settings: { practice_name: 'Ordination Dr. Neumann', practice_full_name: 'Ordination Dr. Michael Neumann & Dr. Etelka Neumann', practice_address: 'Hofstattgasse 17/3, 1180 Wien', practice_city: 'Wien', website_docfinder_url: 'https://www.docfinder.at/arzt/neumann' } };
const HOURS = { data: [{ id: 1, display_name: 'Dr. Michael Neumann' }] };
const quiet = () => {};

function fakeFetch(map) {
  return async (url) => {
    const p = new URL(url).pathname;
    const hit = map[p];
    if (hit === undefined) return { ok: false, status: 404, json: async () => ({}) };
    if (hit instanceof Error) throw hit;
    return { ok: true, status: 200, json: async () => hit };
  };
}

test('fetchJson retries and gives up after the given attempts', async () => {
  let calls = 0;
  const f = async () => { calls++; throw new Error('down'); };
  await assert.rejects(b.fetchJson('http://x/y', { fetchImpl: f, attempts: 3, pauseMs: 0, log: quiet }), /down/);
  assert.equal(calls, 3);
});

test('fetchJson succeeds on a later attempt', async () => {
  let calls = 0;
  const f = async () => (++calls < 2 ? { ok: false, status: 503 } : { ok: true, json: async () => ({ a: 1 }) });
  assert.deepEqual(await b.fetchJson('http://x/y', { fetchImpl: f, attempts: 3, pauseMs: 0, log: quiet }), { a: 1 });
});

test('buildSnapshot keeps what it got and lists what is missing', async () => {
  const { snapshot, missing } = await b.buildSnapshot({
    backendUrl: 'http://backend', fetchImpl: fakeFetch({ '/public/settings': SETTINGS, '/public/opening-hours': HOURS }),
    attempts: 1, pauseMs: 0, log: quiet,
  });
  assert.deepEqual(snapshot['/public/settings'], SETTINGS);
  assert.deepEqual(snapshot['/public/opening-hours'], HOURS);
  assert.ok(snapshot.__built > 0);
  assert.deepEqual(missing.sort(), ['/public/staff', '/public/staff-bios', '/public/website-photos']);
});

test('a small practice logo is embedded as data URI, a big or missing one is skipped', async () => {
  const mk = (type, bytes, ok = true) => async () => ({ ok, headers: { get: () => type }, arrayBuffer: async () => new Uint8Array(bytes).buffer });
  const small = await b.fetchLogoDataUri('http://x', { fetchImpl: mk('image/webp', 100) });
  assert.match(small, /^data:image\/webp;base64,/);
  assert.equal(await b.fetchLogoDataUri('http://x', { fetchImpl: mk('image/webp', 200 * 1024) }), null);
  assert.equal(await b.fetchLogoDataUri('http://x', { fetchImpl: mk('text/html', 100) }), null);
  assert.equal(await b.fetchLogoDataUri('http://x', { fetchImpl: mk('image/webp', 100, false) }), null);
  assert.equal(await b.fetchLogoDataUri('http://x', { fetchImpl: async () => { throw new Error('down'); } }), null);
});

test('snapshotToHtml cannot close the script block', () => {
  const html = b.snapshotToHtml({ x: '</script><script>alert(1)</script>', y: ' ' });
  assert.ok(!html.includes('<'));
  assert.equal(JSON.parse(html).x, '</script><script>alert(1)</script>');
});

test('page title and meta come from the real data, never from the sample', () => {
  const m = b.deriveMeta(SETTINGS.settings, {});
  for (const v of Object.values(m)) assert.ok(!/muster/i.test(v), v);
  assert.match(m.fullName, /Neumann/);
  assert.match(m.description, /Hofstattgasse/);
});

test('environment variables win over the data', () => {
  const m = b.deriveMeta(SETTINGS.settings, { PRACTICE_FULL_NAME: 'X', OG_TITLE: 'Y', META_DESCRIPTION: 'Z' });
  assert.deepEqual(m, { fullName: 'X', ogTitle: 'Y', description: 'Z' });
});

test('without data the template keeps its sample defaults (demo only)', () => {
  assert.match(b.deriveMeta(null, {}).fullName, /Muster/);
});

test('writeDist embeds the snapshot and replaces every token', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'site-src-'));
  const out = path.join(src, 'dist');
  fs.writeFileSync(path.join(src, 'index.html'), '<title>__OG_TITLE__</title><script type="application/json" id="leavio-snapshot">__SNAPSHOT__</script><a href="__PORTAL_URL__">__BACKEND_URL__</a>');
  fs.writeFileSync(path.join(src, 'logo.png'), 'bin');
  fs.mkdirSync(path.join(src, 'test'));
  fs.writeFileSync(path.join(src, 'test', 'x.js'), 'secret');
  const snap = { __built: 1, '/public/settings': SETTINGS, '/public/opening-hours': HOURS };
  b.writeDist(b.makeReplacements(snap), src, out);
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.ok(!/__[A-Z_]+__/.test(html), html);
  const json = html.match(/id="leavio-snapshot">(.*?)<\/script>/s)[1];
  assert.deepEqual(JSON.parse(json), snap);
  assert.ok(fs.existsSync(path.join(out, 'logo.png')));
  assert.ok(!fs.existsSync(path.join(out, 'test')), 'tests must not be published');
});

test('makeReplacements reads the settings out of the backend answer wrapper', () => {
  const r = b.makeReplacements({ __built: 1, '/public/settings': SETTINGS, '/public/opening-hours': HOURS });
  assert.match(r.__PRACTICE_FULL_NAME__, /Neumann/);
  assert.ok(!/muster/i.test(r.__OG_TITLE__ + r.__META_DESCRIPTION__));
});

test('the sample DocFinder link is replaced by the real one, or by the own site on real customer pages', () => {
  const real = b.makeReplacements({ __built: 1, '/public/settings': SETTINGS, '/public/opening-hours': HOURS });
  assert.equal(real['https://www.docfinder.at/suche/arzt/ergebnis?searchterm=muster+wien'], 'https://www.docfinder.at/arzt/neumann');
});

test('with an embedded practice logo the page never contacts leavio.at for the placeholder', () => {
  const withLogo = b.makeReplacements({ __built: 1, __logo: 'data:image/webp;base64,AAAA', '/public/settings': SETTINGS, '/public/opening-hours': HOURS });
  assert.match(withLogo['https://leavio.at/leavio-logo.png'], /^data:image\/gif;base64,/);
  const without = b.makeReplacements({ __built: 1, '/public/settings': SETTINGS, '/public/opening-hours': HOURS });
  assert.equal(without['https://leavio.at/leavio-logo.png'], 'https://leavio.at/leavio-logo.png');
});

test('no snapshot is written as null (page then relies on cache/live)', () => {
  assert.equal(b.makeReplacements(null).__SNAPSHOT__, 'null');
});

// ---- whole build run against a fake backend --------------------------------------------
function startBackend(routes) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const hit = routes[req.url.split('?')[0]];
      if (hit === undefined) { res.writeHead(404); return res.end('{}'); }
      if (hit === 'down') { res.writeHead(503); return res.end('{}'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(hit));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function runBuild(port, extraEnv) {
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-run-'));
    for (const f of ['build.js', 'index.html']) fs.copyFileSync(path.join(__dirname, '..', f), path.join(dir, f));
    const child = spawn(process.execPath, [path.join(dir, 'build.js')], {
      env: { PATH: process.env.PATH, BUILD_ATTEMPTS: '1', BUILD_PAUSE_MS: '0', BACKEND_URL: `http://127.0.0.1:${port}`, ...extraEnv },
    });
    let out = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => out += d);
    child.on('close', code => resolve({ code, out, dir }));
  });
}

test('production build is aborted when the backend data is missing', async () => {
  const server = await startBackend({ '/public/settings': 'down', '/public/opening-hours': HOURS });
  const r = await runBuild(server.address().port, { ROBOTS: 'index, follow' });
  server.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Build abgebrochen/);
  assert.ok(!fs.existsSync(path.join(r.dir, 'dist')), 'no dist must be produced');
}, { timeout: 120000 });

test('production build with data contains the real name and the snapshot, no sample title', async () => {
  const server = await startBackend({ '/public/settings': SETTINGS, '/public/opening-hours': HOURS });
  const r = await runBuild(server.address().port, { ROBOTS: 'index, follow' });
  server.close();
  assert.equal(r.code, 0, r.out);
  const html = fs.readFileSync(path.join(r.dir, 'dist', 'index.html'), 'utf8');
  assert.match(html, /<title>[^<]*Neumann/);
  assert.ok(html.includes('"practice_full_name"'));
  assert.ok(!/__SNAPSHOT__/.test(html));
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(!/muster/i.test(head), 'sample text in <head>');
}, { timeout: 120000 });

test('demo/staging build without data still succeeds', async () => {
  const server = await startBackend({ '/public/settings': 'down' });
  const r = await runBuild(server.address().port, {});
  server.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /WARNUNG/);
}, { timeout: 120000 });
