// Render Build Command für diese Static Site: node build.js
// Publish Directory: dist
//
// Ersetzt Platzhalter in index.html durch Werte aus Render-Umgebungsvariablen,
// damit dieselbe Codebasis pro Kunde (echt oder fiktiver Testkunde auf
// Staging) mit unterschiedlichem Backend/Portal/Domain deploybar ist - nach
// exakt demselben Muster wie product/portal/frontend/build.js.

const fs = require('fs');
const path = require('path');

const BACKEND_URL = process.env.BACKEND_URL || 'https://leavio-staging-backend.onrender.com';
const SITE_URL     = process.env.SITE_URL     || 'https://ordi.leavio.at';
const PORTAL_URL   = process.env.PORTAL_URL   || 'https://portal.leavio.at';
// Rein aus der Backend-URL abgeleitet, nicht aus einer Einstellung - siehe
// Begründung in product/portal/frontend/build.js (IS_STAGING dort).
const IS_STAGING = BACKEND_URL.includes('staging');

const REPLACEMENTS = {
  __BACKEND_URL__: BACKEND_URL,
  __PORTAL_URL__:  PORTAL_URL,
  __SITE_URL__:    SITE_URL,
  // Praxisname/-fachrichtung sind zur Build-Zeit nur ein sinnvoller
  // Startwert für Title/Meta/JSON-LD - loadPracticeSettings() überschreibt
  // sie zur Laufzeit sofort mit den echten, aktuellen Werten aus
  // /public/settings (kann sich ändern, ohne dass neu deployt wird).
  __PRACTICE_FULL_NAME__: process.env.PRACTICE_FULL_NAME || 'Ordination Dr. Max Muster & Dr. Erika Muster',
  __OG_TITLE__: process.env.OG_TITLE || 'Ordination Dr. Muster – Musterordination Wien',
  __META_DESCRIPTION__: process.env.META_DESCRIPTION || 'OA Dr. Max Muster & OÄ Dr. Erika Muster – Musterordination in 1010 Wien. Jetzt online Termin anfragen.',
  // Für eine echte Kundenseite auf "index, follow" setzen (Render Env Var
  // ROBOTS=index, follow) - für Demo/Staging/Vorlage bleibt sie unauffindbar.
  __ROBOTS__: process.env.ROBOTS || 'noindex, nofollow',
};

const TEXT_EXTENSIONS = new Set(['.html', '.js', '.json']);
const SKIP = new Set(['build.js', 'dist', 'node_modules', '.git']);

const SRC = __dirname;
const OUT = path.join(__dirname, 'dist');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);

for (const entry of fs.readdirSync(SRC)) {
  if (SKIP.has(entry)) continue;
  const srcPath = path.join(SRC, entry);
  const outPath = path.join(OUT, entry);

  if (fs.statSync(srcPath).isDirectory()) {
    fs.cpSync(srcPath, outPath, { recursive: true });
    continue;
  }

  if (TEXT_EXTENSIONS.has(path.extname(entry))) {
    let content = fs.readFileSync(srcPath, 'utf8');
    for (const [token, value] of Object.entries(REPLACEMENTS)) {
      content = content.split(token).join(value);
    }
    fs.writeFileSync(outPath, content);
  } else {
    fs.copyFileSync(srcPath, outPath);
  }
}

console.log('Build complete →', OUT);
for (const [token, value] of Object.entries(REPLACEMENTS)) {
  console.log(` ${token} = ${value}`);
}
