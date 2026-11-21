'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('keine Schriften und keine Verbindungen zu Google Fonts: Systemschriften', () => {
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.doesNotMatch(html, /'Cormorant Garamond'|'Inter', sans-serif|Cormorant Garamond,serif/);
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.doesNotMatch(csp, /fonts\./); assert.match(csp, /font-src 'self' data:;/); assert.match(csp, /connect-src __BACKEND_URL__;/);
  assert.match(html, /--font-sans:\s+system-ui/); assert.match(html, /--font-serif:\s+'Iowan Old Style'/);
});

test('Formulierung: eine ganz normale Ordination, kein "Digitale Ordination" mehr, in allen drei Sprachen', () => {
  assert.doesNotMatch(html, /Digitale Ordination|Digitális rendelő|Digital practice/);
  assert.match(html, /Ihre Ordination mit Erfahrung und Herz\.\n    <\/h1>/);
  assert.match(html, /h1: 'Ihre Ordination mit Erfahrung und Herz\.'/);
  assert.match(html, /h1: 'Az Ön rendelője tapasztalattal és szívvel\.'/);
  assert.match(html, /h1: "Your practice with experience and heart\."/);
  assert.doesNotMatch(html, /h1: [^\n]*<br>|h1: [^\n]*<em>/, 'Überschrift ohne erzwungene Umbrüche und ohne hervorgehobenes Wort');
  assert.match(html, /\.display, \.heading \{ text-wrap: balance; \}/);
  assert.doesNotMatch(html, /-webkit-background-clip: text/, 'kein farbiger Verlaufstext');
  assert.match(html, /id="portal-eyebrow">Online-Service</); assert.match(html, /eyebrow: 'Online-Service'/);
});

test('Farben bleiben die der Praxis: die neue Gestaltung nutzt nur die Variablen --rose und --gold, keine festen Hauptfarben', () => {
  const a = html.indexOf('MODERNE GESTALTUNG'); const block = html.slice(a, html.indexOf('</style>', a));
  assert.ok(block.length > 3000);
  assert.match(block, /var\(--rose\)/); assert.match(block, /var\(--gold\)/); assert.match(block, /var\(--rose-deep\)/);
  for (const fixed of ['#1B2A4A', '#14213a', '#7CA98A', '#1b2a4a', '#7ca98a', '#eaf1ec']) assert.ok(!block.includes(fixed), 'fest eingetragene Farbe ' + fixed);
  assert.match(html, /root\.setProperty\('--rose', s\.portal_color_primary\)/); assert.match(html, /root\.setProperty\('--gold', s\.portal_color_accent\)/);
});

test('Einblenden beim Scrollen: schadet nicht ohne JavaScript, bei reduzierter Bewegung oder in Tests ohne Browser', () => {
  assert.match(html, /\.js-reveal \.reveal \{ opacity: 0;/);       // versteckt wird nur, wenn das Skript die Klasse gesetzt hat
  assert.match(html, /prefers-reduced-motion: reduce/);
  const a = html.indexOf('// Sanftes Einblenden beim Scrollen.'); const js = html.slice(a, html.indexOf('</script>', a));
  assert.match(js, /typeof IntersectionObserver === 'undefined'/); assert.match(js, /catch \(e\) \{\}/); assert.match(js, /setTimeout\(function \(\) \{ els\.forEach/);
  // ohne Browserumgebung (vm-Test, Vorab-Darstellung) wirft es nicht
  const vm = require('vm'); assert.doesNotThrow(() => vm.runInNewContext(js.replace(/^[^\n]*\n/, ''), {}));
});

test('Navigation, Knöpfe und Karten sind abgerundet; Mobilansicht hat eigene Regeln', () => {
  const a = html.indexOf('MODERNE GESTALTUNG'); const block = html.slice(a, html.indexOf('</style>', a));
  for (const x of ['nav {', '.btn-primary, .btn-outline', '.leistung-item {', '.arzt-card {', '.portal-section {', '.kontakt-map {', '.review-card {']) assert.ok(block.includes(x), x);
  assert.match(block, /border-radius: 999px/); assert.match(block, /@media \(max-width: 900px\)/); assert.match(block, /@media \(max-width: 480px\)/);
});

test('Anheben beim Darüberfahren: die Hilfsklassen des Einblendens werden danach entfernt (sonst blieben Karten starr)', () => {
  const a = html.indexOf('// Sanftes Einblenden beim Scrollen.'); const js = html.slice(a, html.indexOf('</script>', a));
  assert.match(js, /function done\(el\) \{ el\.classList\.add\('in'\); setTimeout\(function \(\) \{ el\.classList\.remove\('reveal', 'in'\); \}, 900\); \}/);
  assert.match(js, /if \(e\.isIntersecting\) \{ done\(e\.target\)/); assert.match(js, /el\.classList\.contains\('reveal'\)\) done\(el\)/);
  // Ablauf mit vorgetäuschtem Browser: nach dem Einblenden und 900 ms sind beide Klassen wieder weg
  const vm = require('vm'); const timers = []; let cb = null;
  const mkEl = () => { const c = new Set(); return { classList: { add: x => c.add(x), remove: (...xs) => xs.forEach(x => c.delete(x)), contains: x => c.has(x) }, c }; };
  const el = mkEl();
  const ctx = { IntersectionObserver: class { constructor(f) { cb = f; } observe() {} unobserve() {} }, document: { querySelectorAll: () => [el], documentElement: mkEl() }, window: { matchMedia: () => ({ matches: false }) }, setTimeout: (f, ms) => timers.push([f, ms]) };
  vm.runInNewContext(js.replace(/^[^\n]*\n/, ''), ctx);
  assert.ok(el.c.has('reveal')); cb([{ isIntersecting: true, target: el }]); assert.ok(el.c.has('in'));
  timers.filter(t => t[1] === 900).forEach(t => t[0]()); assert.ok(!el.c.has('reveal') && !el.c.has('in'));
});

test('Online-Service: der Kasten zeigt Symbole für Termin, Rezept und Befund statt einer leeren weißen Fläche; Farben nur aus den Variablen', () => {
  assert.equal((html.match(/class="portal-tile"/g) || []).length, 3);
  assert.doesNotMatch(html, /stroke="#1B2A4A"/, 'keine fest eingetragene Hauptfarbe im Symbol');
  assert.match(html, /\.portal-iframe-overlay \{ position: relative; inset: auto; min-height: 340px; background: transparent;/);
  assert.match(html, /id="portal-badge"/); assert.match(html, /id="portal-widget-title"/);
  assert.match(html, /\.portal-tile \{ animation: none; \}/, 'bei reduzierter Bewegung keine Animation');
  assert.doesNotMatch(html, /class="portal-dot"/);
});

test('Partner: nur die Partner aus dem Dashboard, nie Beispiel-Partner (weder beim Laden, noch beim Öffnen, noch bei leerer oder fehlender Antwort)', () => {
  assert.doesNotMatch(html, /STATIC_PARTNERS|Partner Muster|Partner Beispiel|beispiel-partner|Fachgebiet A/);
  assert.match(html, /onclick="openModal\('partner'\); loadPartners\(\); return false;">Partner<\/a>/);
  const a = html.indexOf('async function loadPartners() {'); const fn = html.slice(a, html.indexOf('\n  }\n', a) + 5);
  const vm = require('vm');
  const run = async (fetchImpl, lastPartners) => {
    const calls = []; const el = { innerHTML: 'Wird geladen' };
    const ctx = { document: { getElementById: () => el }, BACKEND_URL: 'https://b.example', AbortController: class { constructor() { this.signal = {}; } abort() {} }, setTimeout: () => 0, fetch: fetchImpl,
      renderPartners: p => { calls.push(p); el.innerHTML = 'liste'; }, _lastPartners: lastPartners, currentLang: 'en', console: { log() {} },
      PARTNERS_UNAVAILABLE: { de: 'de', hu: 'hu', en: 'The partner list is currently unavailable.' } };
    vm.createContext(ctx); vm.runInContext(fn + '\nthis.f = loadPartners;', ctx); await ctx.f();
    return { calls, html: el.innerHTML, url: ctx.url };
  };
  return (async () => {
    const live = [{ name: 'Dr. Echt', specialty: 'Urologie' }];
    let r = await run(async u => ({ ok: true, json: async () => ({ data: live }) })); assert.deepEqual(r.calls, [live]);
    r = await run(async () => ({ ok: true, json: async () => ({ data: [] }) })); assert.deepEqual(r.calls, [[]], 'leere Liste wird als leer angezeigt, nicht durch Beispiele ersetzt');
    r = await run(async () => { throw new Error('offline'); }); assert.equal(r.calls.length, 0); assert.match(r.html, /The partner list is currently unavailable\./);
    r = await run(async () => ({ ok: false, status: 503 })); assert.match(r.html, /currently unavailable/);
    r = await run(async () => { throw new Error('offline'); }, [{ name: 'Dr. Alt' }]); assert.equal(r.html, 'Wird geladen', 'schon geladene Liste bleibt bei einem Fehler stehen');
  })();
});

test('Praxislogo im Startbereich ist deutlich größer und wird in höherer Auflösung geladen', () => {
  assert.match(html, /#hero-logo-img \{ width: clamp\(260px, 30vw, 460px\) !important; \}/);
  assert.match(html, /@media \(max-width: 900px\) \{ #hero-logo-img \{ width: min\(80vw, 340px\) !important; \} \}/);
  assert.match(html, /'hero-logo-img': 880/);
  assert.match(html, /'nav-logo-img': 320/); assert.match(html, /'footer-logo-img': 200/);
});

test('Bewertungen: die Beschriftungs-Pille ist auf dem getönten Hintergrund sichtbar (weiß)', () => {
  assert.match(html, /\.reviews-section \.section-header \.label \{ background: #fff; \}/);
});

test('Überschrift im Startbereich ist so groß, dass der Satz in zwei bis drei Zeilen passt, nicht in vier', () => {
  assert.match(html, /\.display \{ font-family: var\(--font-serif\); font-weight: 500; font-size: clamp\(2\.2rem, 3\.9vw, 3\.5rem\);/);
  assert.match(html, /\.heading \{ font-family: var\(--font-sans\); font-weight: 650;/, 'Überschriften leichter statt wuchtig');
});

test('Abstände zwischen den Abschnitten sind eng (höchstens 4,5 rem oben und unten)', () => {
  const a = html.indexOf('MODERNE GESTALTUNG'); const block = html.slice(a, html.indexOf('</style>', a));
  for (const sel of ['.section, .ueber-section', '.kontakt-section', '.reviews-section']) {
    const m = new RegExp(sel.replace(/[.,]/g, c => '\\' + c) + ' \\{[^}]*padding: clamp\\(([\\d.]+)rem, ([\\d.]+)vw, ([\\d.]+)rem\\)').exec(block);
    assert.ok(m, sel); assert.ok(parseFloat(m[3]) <= 4.5, sel + ' oben/unten höchstens 4,5rem');
  }
  assert.match(block, /\.portal-section \{[^}]*padding: clamp\(2\.2rem, 5vw, 4rem\) 6vw;/);
});

test('Alle Fotos reagieren beim Darüberfahren: Teamfotos (wie bisher), Ärztinnen/Ärzte und Ordinationsassistenz heben sich und zoomen', () => {
  assert.match(html, /\.team-atmo-item:hover img \{ transform: scale\(1\.03\); \}/);
  assert.match(html, /\.arzt-card:hover, \.lisa-row:hover \{ transform: translateY\(-4px\);/);
  assert.match(html, /\.arzt-card:hover \.arzt-photo-wrap img, \.lisa-row:hover \.lisa-photo-wrap img \{ transform: scale\(1\.05\); \}/);
});

test('Datenschutzfenster der Website entspricht der Patientenseite im Portal (Leavio e.U., Resend EU-Region, seven, Sentry ohne Fehlertexte, Sicherungen 30 Tage)', () => {
  const a = html.indexOf('id="modal-datenschutz"'); const m = html.slice(a, html.indexOf('id="modal-', a + 30));
  for (const f of ['Leavio e.U.', 'Plus Five Five, Inc. (Resend)', 'EU-Region Irland', 'seven communications', 'Functional Software, Inc. (Sentry)', 'keine Fehlertexte, Anfrageinhalte oder Nutzerangaben', 'Datensicherungen des Portals', 'SMS oder E-Mail']) assert.ok(m.includes(f), f);
  assert.doesNotMatch(m, /IP-Adressen werden nicht gespeichert|nur anonymisierte Fehlermeldungen|Render Inc\.|Resend Inc\./);
});

test('Handy: der Knopf in der unteren Leiste wird auch aufgedeckt, wenn er im HTML nach dem Skript steht; das Menü ist eine schwebende Karte und schließt sich', () => {
  assert.match(html, /document\.addEventListener\('DOMContentLoaded', function \(\) \{\s*if \(_brandPendingRevealed\) document\.querySelectorAll\('\.logo-pending, \.brand-pending'\)/);
  assert.ok(html.indexOf('id="sticky-portal-bar"') > html.indexOf('function _revealBrandPending()'), 'Leiste steht nach dem Skript (daher das späte Aufdecken)');
  assert.match(html, /position:absolute;top:70px;left:0;right:0;background:#fff;[^']*border-radius:24px/);
  assert.match(html, /document\.querySelectorAll\('\.nav-links a\[href\^="#"\]'\)\.forEach/);
});
