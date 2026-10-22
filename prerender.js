// ── VORAB-DARSTELLUNG (Prerender) ────────────────────────────────────────────
// Die Seite füllt Texte, Adressen, Telefonnummern usw. erst per Skript mit den echten
// Praxisdaten. Im rohen HTML (Suchmaschinen ohne JavaScript, Link-Vorschauen, Lesezeichen-
// Dienste) stünde sonst der Vorlagentext. Beim Build lassen wir deshalb das Seitenskript
// einmal in einer Browser-Attrappe laufen (mit der Momentaufnahme als Datenquelle),
// merken uns, was es in Elemente mit id schreibt, und tragen genau das ins HTML ein.

const vm = require('vm');

const WRITABLE = ['textContent', 'innerHTML', 'href', 'src'];

function runPageScript(html, snapshot) {
  const scripts = [...html.matchAll(/<script(?![^>]*type="application)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const writes = {};
  const els = {};
  function el(id) {
    if (els[id]) return els[id];
    const store = { style: { setProperty() {} }, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} } };
    const rec = (k, v) => { (writes[id] = writes[id] || {})[k] = String(v); };
    return (els[id] = new Proxy(store, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'then') return undefined;
        if (k === 'setAttribute') return (name, value) => { if (name === 'href' || name === 'src') rec(name, value); };
        return typeof k === 'string' ? function () { return el('fn:' + id); } : undefined;
      },
      set(t, k, v) { t[k] = v; if (WRITABLE.includes(k) && !id.startsWith('fn:') && !id.startsWith('q:')) rec(k, v); return true; },
    }));
  }
  const snapText = JSON.stringify(snapshot);
  const document = {
    getElementById: id => (id === 'leavio-snapshot' ? { textContent: snapText } : el(id)),
    querySelector: () => el('q:x'), querySelectorAll: () => [], addEventListener() {}, createElement: () => el('q:new'),
    body: el('q:body'), documentElement: el('q:html'), head: el('q:head'), visibilityState: 'hidden', title: '', referrer: '',
  };
  const sandbox = {
    document, console: { log() {} },
    localStorage: { getItem: () => null, setItem() {} },
    AbortController, setTimeout: (f, ms) => (ms < 1000 ? setTimeout(f, 0) : 0), setInterval: () => 0, clearInterval() {},
    location: { pathname: '/', hash: '', search: '' }, IntersectionObserver: class { observe() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }), navigator: {}, history: { replaceState() {} },
    URLSearchParams, encodeURIComponent,
    // Kein Netz: alle Daten kommen aus der Momentaufnahme.
    fetch: async () => { throw new Error('prerender: offline'); },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(scripts.join('\n;\n'), sandbox, { timeout: 10000 });
  return new Promise(resolve => setTimeout(() => resolve(writes), 50));
}

// Findet das Element mit dieser id und gibt { open: [start,end], inner: [start,end], tag } zurück.
function findElement(html, id) {
  const openRe = new RegExp('<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\bid="' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>');
  const m = openRe.exec(html);
  if (!m) return null;
  const tag = m[1].toLowerCase();
  const openStart = m.index, openEnd = m.index + m[0].length;
  if (/\/>$/.test(m[0]) || ['img', 'input', 'br', 'hr', 'meta', 'link'].includes(tag)) {
    return { tag, open: [openStart, openEnd], inner: null };
  }
  const re = new RegExp('<(/?)' + tag + '\\b[^>]*>', 'gi');
  re.lastIndex = openEnd;
  let depth = 1, t;
  while ((t = re.exec(html))) {
    depth += t[1] ? -1 : 1;
    if (depth === 0) return { tag, open: [openStart, openEnd], inner: [openEnd, t.index] };
  }
  return null;
}

function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function applyWrites(html, writes) {
  const applied = [];
  for (const [id, w] of Object.entries(writes)) {
    let found = findElement(html, id);
    if (!found) continue;
    // Innenleben zuerst (ändert Positionen hinter dem Öffnungs-Tag, nicht davor)
    const inner = w.innerHTML !== undefined ? w.innerHTML : w.textContent !== undefined ? escapeText(w.textContent) : undefined;
    if (inner !== undefined && found.inner) {
      html = html.slice(0, found.inner[0]) + inner + html.slice(found.inner[1]);
      applied.push(id);
      found = findElement(html, id);
    }
    for (const attr of ['href', 'src']) {
      if (w[attr] === undefined) continue;
      let openTag = html.slice(found.open[0], found.open[1]);
      const attrRe = new RegExp('(\\s' + attr + '=")[^"]*(")');
      if (attrRe.test(openTag)) {
        openTag = openTag.replace(attrRe, (_, a, b) => a + escapeAttr(w[attr]) + b);
        html = html.slice(0, found.open[0]) + openTag + html.slice(found.open[1]);
        found = findElement(html, id);
      }
    }
  }
  return { html, applied };
}

// Text außerhalb von <script>/<style>: das sehen Suchmaschinen und Link-Vorschauen.
function visibleHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
}

const SAMPLE_PATTERN = /muster|teststra(ß|ss)e|\+43 1 000|beispiel-partner|tel:\+4310000000/i;

function sampleLeftovers(html) {
  const body = visibleHtml(html);
  const found = [];
  for (const m of body.matchAll(new RegExp(SAMPLE_PATTERN.source, 'gi'))) {
    found.push(body.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' '));
  }
  return found;
}

async function prerender(html, snapshot) {
  const writes = await runPageScript(html, snapshot);
  const { html: out, applied } = applyWrites(html, writes);
  return { html: out, applied, leftovers: sampleLeftovers(out) };
}

module.exports = { prerender, runPageScript, applyWrites, findElement, sampleLeftovers, visibleHtml, SAMPLE_PATTERN };
