// Vorab-Darstellung: Das rohe HTML (ohne JavaScript) muss die echten Praxisdaten enthalten.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const b = require('../build.js');
const pr = require('../prerender.js');
const { settings, data } = require('./fixtures.js');

function built(snapshot) {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-src-'));
  fs.copyFileSync(path.join(__dirname, '..', 'index.html'), path.join(src, 'index.html'));
  b.writeDist(b.makeReplacements(snapshot), src, path.join(src, 'dist'));
  return fs.readFileSync(path.join(src, 'dist', 'index.html'), 'utf8');
}
const snap = { __built: 1, ...data };
const inner = (html, id) => { const f = pr.findElement(html, id); return f && f.inner ? html.slice(f.inner[0], f.inner[1]) : null; };

test('raw HTML shows the real practice data, not the template text', async () => {
  const r = await pr.prerender(built(snap), snap);
  assert.deepEqual(r.leftovers, [], 'sample text left in visible HTML: ' + r.leftovers.join(' | '));
  assert.match(inner(r.html, 'hero-eyebrow'), /Ordination Dr\. Test · Wien/);
  assert.match(inner(r.html, 'hero-sub'), /Dr\. Anna Test und Dr\. Paul Probe/);
  assert.match(inner(r.html, 'impressum-arzt-name'), /Anna Test &amp; Dr\. Paul Probe/);
  assert.match(inner(r.html, 'times-addr'), /Probegasse 5\/2, 1230 Wien/);
  assert.match(r.html, /<a id="times-phone-a" href="tel:\+43155512134">\+43 1 555 12 34<\/a>/);
  assert.match(inner(r.html, 'review-text-1'), /Sehr freundlich/);
  assert.match(inner(r.html, 'team-doctors-grid'), /BIO-ANNA|Bio Anna/);
});

test('without real data the leftovers are reported (that is what aborts a production build)', async () => {
  const empty = { __built: 1, '/public/settings': { settings: { practice_full_name: 'X' } }, '/public/opening-hours': { data: [] } };
  const r = await pr.prerender(built(empty), empty);
  assert.ok(r.leftovers.length > 0);
});

test('prerendering keeps the markup balanced', async () => {
  const before = built(snap);
  const after = (await pr.prerender(before, snap)).html;
  const strip = h => pr.visibleHtml(h);
  for (const tag of ['div', 'span', 'a', 'p', 'strong', 'section', 'h3']) {
    const open = (strip(after).match(new RegExp('<' + tag + '\\b', 'g')) || []).length;
    const close = (strip(after).match(new RegExp('</' + tag + '>', 'g')) || []).length;
    assert.equal(open, close, tag);
  }
});

test('prerendering only touches elements with an id and leaves the scripts alone', async () => {
  const before = built(snap);
  const after = (await pr.prerender(before, snap)).html;
  const scripts = h => [...h.matchAll(/<script[\s\S]*?<\/script>/g)].map(m => m[0]).join('');
  assert.equal(scripts(after), scripts(before));
});

test('findElement handles nested tags of the same name', () => {
  const html = '<div id="a"><div>x</div><div>y</div></div><div id="b">z</div>';
  const f = pr.findElement(html, 'a');
  assert.equal(html.slice(f.inner[0], f.inner[1]), '<div>x</div><div>y</div>');
  const g = pr.findElement(html, 'b');
  assert.equal(html.slice(g.inner[0], g.inner[1]), 'z');
});

test('JSON-LD gets the real address and hours, unknown guesses are removed', () => {
  const html = b.patchJsonLd(built(snap), snap);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld.address.streetAddress, 'Probegasse 5/2');
  assert.equal(ld.address.postalCode, '1230');
  assert.equal(ld.telephone, '+43 1 555 12 34');
  assert.equal(ld.email, 'ordi@probe.example');
  assert.deepEqual(ld.openingHoursSpecification.map(s => s.dayOfWeek + s.opens + s.closes).sort(),
    ['Monday09:00' + '12:00', 'Wednesday14:00' + '18:00']);
  for (const k of ['geo', 'priceRange', 'medicalSpecialty']) assert.ok(!(k in ld), k);
  assert.ok(!/Teststra|1010/.test(JSON.stringify(ld)));
});
