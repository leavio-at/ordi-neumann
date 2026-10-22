// Render Build Command für diese Static Site: node build.js
// Publish Directory: dist
//
// Ersetzt Platzhalter in index.html durch Werte aus Render-Umgebungsvariablen,
// damit dieselbe Codebasis pro Kunde (echt oder fiktiver Testkunde auf
// Staging) mit unterschiedlichem Backend/Portal/Domain deploybar ist - nach
// exakt demselben Muster wie product/portal/frontend/build.js.
//
// MOMENTAUFNAHME DER PRAXISDATEN: Beim Bauen werden die öffentlichen Daten
// der Praxis (Name, Kontakt, Ärzt:innen, Ordinationszeiten ...) vom Backend
// geholt und fest in die Seite eingebettet (<script id="leavio-snapshot">).
// Die Seite zeigt damit auch dann die echten Daten, wenn das Backend gerade
// nicht antwortet (Deploy, Neustart, Kaltstart) - sie holt sich danach live
// die aktuellsten Werte, Änderungen im Dashboard erscheinen also weiterhin
// sofort ohne neuen Build. Für echte Kundenseiten (ROBOTS=index... oder
// REQUIRE_SNAPSHOT=1) bricht der Build ab, wenn die Daten nicht geholt werden
// können: Render lässt dann die bisherige, funktionierende Version online,
// statt eine Seite mit Vorlagentext zu veröffentlichen.

const fs = require('fs');
const path = require('path');

const BACKEND_URL = process.env.BACKEND_URL || 'https://leavio-staging-backend.onrender.com';
const SITE_URL     = process.env.SITE_URL     || 'https://ordi.leavio.at';
const PORTAL_URL   = process.env.PORTAL_URL   || 'https://portal.leavio.at';
// Rein aus der Backend-URL abgeleitet, nicht aus einer Einstellung - siehe
// Begründung in product/portal/frontend/build.js (IS_STAGING dort).
const IS_STAGING = BACKEND_URL.includes('staging');
const ROBOTS = process.env.ROBOTS || 'noindex, nofollow';
// Echte Kundenseite = für Suchmaschinen freigegeben oder ausdrücklich verlangt.
const REQUIRE_SNAPSHOT = process.env.REQUIRE_SNAPSHOT === '1' || /^index/i.test(ROBOTS);

// Pfade, deren Antwort eingebettet wird. REQUIRED müssen im Produktivbau da sein.
const SNAPSHOT_PATHS = ['/public/settings', '/public/opening-hours', '/public/staff', '/public/staff-bios', '/public/website-photos'];
const REQUIRED_PATHS = ['/public/settings', '/public/opening-hours'];

const SAMPLE_WORD = /muster/i;
// Standardlogo der Vorlage (liegt auf leavio.at): auf einer Kundenseite soll der Browser
// keinen fremden Server kontaktieren. Ist das Praxislogo eingebettet, wird der
// Platzhalter durch ein durchsichtiges 1x1-Bild ersetzt (das Logo kommt danach live
// vom Backend, bei Ausfall aus der Momentaufnahme).
const LEAVIO_DEFAULT_LOGO = 'https://leavio.at/leavio-logo.png';
const BLANK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const DOCFINDER_DEFAULT = 'https://www.docfinder.at/suche/arzt/ergebnis?searchterm=muster+wien';

async function fetchJson(url, { fetchImpl = fetch, attempts = 3, timeoutMs = 60000, pauseMs = 5000, log = console.log } = {}) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      const resp = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return await resp.json();
    } catch (e) {
      lastError = e;
      log(`  ${url}: Versuch ${i}/${attempts} fehlgeschlagen (${e.message})`);
      if (i < attempts && pauseMs) await new Promise(r => setTimeout(r, pauseMs));
    }
  }
  throw lastError;
}

// Liefert { snapshot, missing }. snapshot enthält nur erfolgreich geholte Pfade.
async function buildSnapshot(opts = {}) {
  const backend = opts.backendUrl || BACKEND_URL;
  const snapshot = { __built: Date.now() };
  const missing = [];
  for (const p of SNAPSHOT_PATHS) {
    try {
      snapshot[p] = await fetchJson(backend + p, opts);
    } catch (e) {
      missing.push(p);
    }
  }
  const logo = await fetchLogoDataUri(backend, opts);
  if (logo) snapshot.__logo = logo;
  return { snapshot, missing };
}

// Praxislogo als data:-URI (nur wenn klein): damit erscheint es auch, wenn das Backend
// gerade nicht antwortet. Optional - ohne Logo bleibt der Standard der Seite.
const LOGO_MAX_BYTES = 150 * 1024;
async function fetchLogoDataUri(backendUrl, { fetchImpl = fetch, timeoutMs = 60000 } = {}) {
  try {
    const resp = await fetchImpl(backendUrl + '/public/logo?w=320', { signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) return null;
    const type = (resp.headers && resp.headers.get && resp.headers.get('content-type')) || '';
    if (!/^image\/(webp|png|jpeg)/.test(type)) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!buf.length || buf.length > LOGO_MAX_BYTES) return null;
    return 'data:' + type.split(';')[0] + ';base64,' + buf.toString('base64');
  } catch (e) {
    return null;
  }
}

// Der JSON-Block steht in HTML: "<" maskieren, damit nichts den Block beenden kann.
function snapshotToHtml(snapshot) {
  return JSON.stringify(snapshot)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// Title/Meta/JSON-LD-Startwerte aus den echten Daten (Env-Variablen haben Vorrang).
function deriveMeta(settings, env = process.env) {
  const s = settings || {};
  const fullName = s.practice_full_name || s.practice_name || '';
  const addr = s.practice_address || '';
  const city = s.practice_city || '';
  return {
    fullName: env.PRACTICE_FULL_NAME || fullName || 'Ordination Dr. Max Muster & Dr. Erika Muster',
    ogTitle: env.OG_TITLE || (fullName ? fullName + (city ? ' – ' + city : '') : 'Ordination Dr. Muster – Musterordination Wien'),
    description: env.META_DESCRIPTION || (fullName
      ? fullName + (addr ? ' – ' + addr : '') + '. Jetzt online Termin anfragen.'
      : 'OA Dr. Max Muster & OÄ Dr. Erika Muster – Musterordination in 1010 Wien. Jetzt online Termin anfragen.'),
  };
}

function makeReplacements(snapshot) {
  const settings = ((snapshot || {})['/public/settings'] || {}).settings;
  const meta = deriveMeta(settings);
  const docfinder = (settings && settings.website_docfinder_url) || (REQUIRE_SNAPSHOT ? SITE_URL : DOCFINDER_DEFAULT);
  return {
    __BACKEND_URL__: BACKEND_URL,
    __PORTAL_URL__:  PORTAL_URL,
    __SITE_URL__:    SITE_URL,
    __PRACTICE_FULL_NAME__: meta.fullName,
    __OG_TITLE__: meta.ogTitle,
    __META_DESCRIPTION__: meta.description,
    // Für eine echte Kundenseite auf "index, follow" setzen (Render Env Var
    // ROBOTS=index, follow) - für Demo/Staging/Vorlage bleibt sie unauffindbar.
    __ROBOTS__: ROBOTS,
    __SNAPSHOT__: snapshot ? snapshotToHtml(snapshot) : 'null',
    // Muster-Suchlink der Vorlage (JSON-LD sameAs, Bewertungs-Link): durch den
    // echten DocFinder-Link ersetzen; ohne Eintrag bei echten Kundenseiten auf
    // die eigene Seiten-URL, damit Suchmaschinen keinen Muster-Link sehen.
    [DOCFINDER_DEFAULT]: docfinder,
    [LEAVIO_DEFAULT_LOGO]: (snapshot && snapshot.__logo) ? BLANK_PIXEL : LEAVIO_DEFAULT_LOGO,
  };
}

const TEXT_EXTENSIONS = new Set(['.html', '.js', '.json']);
const SKIP = new Set(['build.js', 'dist', 'node_modules', '.git', 'test', 'package.json']);

function writeDist(replacements, src, out) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out);
  for (const entry of fs.readdirSync(src)) {
    if (SKIP.has(entry)) continue;
    const srcPath = path.join(src, entry);
    const outPath = path.join(out, entry);

    if (fs.statSync(srcPath).isDirectory()) {
      fs.cpSync(srcPath, outPath, { recursive: true });
      continue;
    }

    if (TEXT_EXTENSIONS.has(path.extname(entry))) {
      let content = fs.readFileSync(srcPath, 'utf8');
      // Der Snapshot-Wert wird zuletzt eingesetzt und nie durch andere Tokens verändert.
      for (const [token, value] of Object.entries(replacements)) {
        if (token === '__SNAPSHOT__') continue;
        content = content.split(token).join(value);
      }
      content = content.split('__SNAPSHOT__').join(replacements.__SNAPSHOT__);
      fs.writeFileSync(outPath, content);
    } else {
      fs.copyFileSync(srcPath, outPath);
    }
  }
}

async function main() {
  const log = console.log;
  log(`Hole Praxisdaten von ${BACKEND_URL} ...`);
  // Wiederholungen/Pause sind für Tests überschreibbar (sonst dauert ein Fehlerfall Minuten).
  const { snapshot, missing } = await buildSnapshot({
    log,
    attempts: Number(process.env.BUILD_ATTEMPTS) || 3,
    pauseMs: process.env.BUILD_PAUSE_MS !== undefined ? Number(process.env.BUILD_PAUSE_MS) : 5000,
  });
  const missingRequired = missing.filter(p => REQUIRED_PATHS.includes(p));

  if (missingRequired.length && REQUIRE_SNAPSHOT) {
    console.error(`FEHLER: Pflichtdaten nicht erreichbar: ${missingRequired.join(', ')}`);
    console.error('Build abgebrochen, damit keine Seite mit Vorlagentext veröffentlicht wird. Render behält die bisherige Version.');
    process.exit(1);
  }
  const usable = missingRequired.length ? null : snapshot;
  if (!usable) log('WARNUNG: keine Momentaufnahme (nur für Demo/Staging/Vorlage zulässig)');
  missing.filter(p => !REQUIRED_PATHS.includes(p)).forEach(p => log(`Hinweis: ${p} nicht geholt (optional)`));

  const replacements = makeReplacements(usable);

  if (REQUIRE_SNAPSHOT) {
    for (const t of ['__PRACTICE_FULL_NAME__', '__OG_TITLE__', '__META_DESCRIPTION__']) {
      if (SAMPLE_WORD.test(replacements[t])) {
        console.error(`FEHLER: ${t} enthält Vorlagentext ("${replacements[t]}"). Build abgebrochen.`);
        process.exit(1);
      }
    }
  }

  const OUT = path.join(__dirname, 'dist');
  writeDist(replacements, __dirname, OUT);

  log('Build complete →', OUT);
  for (const [token, value] of Object.entries(replacements)) {
    log(` ${token} = ${token === '__SNAPSHOT__' ? (usable ? `${value.length} Zeichen` : 'keine') : value}`);
  }
}

module.exports = { fetchLogoDataUri, fetchJson, buildSnapshot, snapshotToHtml, deriveMeta, makeReplacements, writeDist, SNAPSHOT_PATHS, REQUIRED_PATHS };

if (require.main === module) {
  main().catch(e => { console.error('Build fehlgeschlagen:', e); process.exit(1); });
}
