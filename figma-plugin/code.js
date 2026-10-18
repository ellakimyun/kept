// Kept for Figma: browse your saved fonts and pairs, then use them on the canvas.
// Runs in Figma's plugin sandbox. No build step: this file is loaded as-is.

const STORE_KEY = 'kept.plugin.v1';
const DEFAULT_HEAD = 'The quiet return of the serif';
const DEFAULT_BODY = 'After a decade of geometric sans everywhere, editors are reaching for warmth again: softer curves, visible ink traps, and type that sounds like a person instead of a product.';

figma.showUI(__html__, { width: 380, height: 640, themeColors: true, title: 'Kept' });

/* ---------- storage ---------- */
function emptyStore() { return { saved: {}, pairs: [], notes: {}, shelves: {}, importedAt: null }; }
async function loadStore() {
  const s = (await figma.clientStorage.getAsync(STORE_KEY)) || emptyStore();
  const base = emptyStore();
  for (const k in base) if (s[k] === undefined) s[k] = base[k];
  return s;
}
async function saveStore(s) { await figma.clientStorage.setAsync(STORE_KEY, s); }

/* ---------- fonts available in Figma ---------- */
let fontMap = null; // family -> [style, ...]
async function fonts() {
  if (fontMap) return fontMap;
  fontMap = new Map();
  for (const f of await figma.listAvailableFontsAsync()) {
    const fam = f.fontName.family;
    if (!fontMap.has(fam)) fontMap.set(fam, []);
    fontMap.get(fam).push(f.fontName.style);
  }
  return fontMap;
}

const WEIGHTS = [[/hairline|\bthin/i, 100], [/(extra|ultra)[ -]?light/i, 200], [/(semi|demi)[ -]?bold|\bdemi\b/i, 600], [/(extra|ultra)[ -]?bold/i, 800], [/black|heavy|\bultra\b/i, 900], [/light/i, 300], [/medium/i, 500], [/bold/i, 700]];
function weightOf(s) { for (const [re, w] of WEIGHTS) if (re.test(s)) return w; return 400; }
const isItalic = (s) => /italic|oblique/i.test(s);

// Choose the style in `family` closest to `wanted` (keeps bold bold, italic italic).
function pickStyle(styles, wanted) {
  if (!styles || !styles.length) return null;
  if (wanted && styles.includes(wanted)) return wanted;
  const w = weightOf(wanted || 'Regular'), it = isItalic(wanted || '');
  const ranked = styles.slice().sort((a, b) =>
    (isItalic(a) !== it) - (isItalic(b) !== it) || Math.abs(weightOf(a) - w) - Math.abs(weightOf(b) - w) ||
    (/^(regular|roman|book|normal)$/i.test(b) - /^(regular|roman|book|normal)$/i.test(a)));
  return ranked[0];
}
const regularOf = (styles) => pickStyle(styles, 'Regular');

/* ---------- selection ---------- */
function selectedTextNodes() {
  const out = [];
  for (const n of figma.currentPage.selection) {
    if (n.type === 'TEXT') out.push(n);
    else if ('findAll' in n) for (const t of n.findAll((x) => x.type === 'TEXT')) { out.push(t); if (out.length >= 300) break; }
    if (out.length >= 300) break;
  }
  return out;
}
function sizeOf(node) { return typeof node.fontSize === 'number' ? node.fontSize : Math.max(...node.getStyledTextSegments(['fontSize']).map((s) => s.fontSize)); }
function sendSelection() {
  const nodes = selectedTextNodes();
  figma.ui.postMessage({ type: 'selection', count: nodes.length });
}
figma.on('selectionchange', sendSelection);

// Work out heading / body / caption from font sizes when the user picks "Auto".
function rolesFor(nodes) {
  const sizes = [...new Set(nodes.map(sizeOf))].sort((a, b) => b - a);
  return nodes.map((n) => {
    if (nodes.length === 1) return 'heading';
    const s = sizeOf(n);
    if (s === sizes[0]) return 'heading';
    if (sizes.length >= 3 && s === sizes[sizes.length - 1]) return 'caption';
    if (sizes.length === 2 && s <= 13) return 'caption';
    return 'body';
  });
}

async function applyFonts(families, role) {
  const nodes = selectedTextNodes();
  if (!nodes.length) return { ok: false, message: 'Select one or more text layers first.' };
  const map = await fonts();
  const roles = role === 'auto' ? rolesFor(nodes) : nodes.map(() => role);
  let changed = 0, skipped = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i], family = families[roles[i]] || families.body || families.heading;
    const styles = map.get(family);
    if (!styles || node.hasMissingFont) { skipped++; continue; }
    const segs = node.getStyledTextSegments(['fontName']);
    for (const seg of segs) {
      const target = { family, style: pickStyle(styles, seg.fontName.style) };
      await figma.loadFontAsync(seg.fontName);
      await figma.loadFontAsync(target);
      node.setRangeFontName(seg.start, seg.end, target);
    }
    changed++;
  }
  const msg = changed ? `Applied to ${changed} text layer${changed === 1 ? '' : 's'}.` : 'Nothing changed.';
  return { ok: changed > 0, message: msg + (skipped ? ` Skipped ${skipped} (font missing in Figma).` : '') };
}

/* ---------- canvas helpers ---------- */
function hexToRgb(hex) { const h = (hex || '#F4F3F0').replace('#', ''); return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 }; }
function inkFor(bg) { const c = hexToRgb(bg); return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) > 0.55 ? { r: 0.055, g: 0.055, b: 0.051 } : { r: 0.96, g: 0.957, b: 0.94 }; }
async function makeText(chars, fontName, size, opts) {
  await figma.loadFontAsync(fontName);
  const t = figma.createText();
  t.fontName = fontName; t.characters = chars; t.fontSize = size;
  t.lineHeight = { unit: 'PERCENT', value: (opts && opts.lh) || 120 };
  if (opts && opts.tracking) t.letterSpacing = { unit: 'PERCENT', value: opts.tracking };
  if (opts && opts.upper) t.textCase = 'UPPER';
  t.fills = [{ type: 'SOLID', color: opts.ink, opacity: (opts && opts.opacity) || 1 }];
  return t;
}
function placeAndSelect(node) {
  const c = figma.viewport.center;
  node.x = Math.round(c.x - node.width / 2); node.y = Math.round(c.y - node.height / 2);
  figma.currentPage.appendChild(node);
  figma.currentPage.selection = [node];
  figma.viewport.scrollAndZoomIntoView([node]);
}
function frame(name, bg, width) {
  const f = figma.createFrame();
  f.name = name; f.layoutMode = 'VERTICAL'; f.primaryAxisSizingMode = 'AUTO'; f.counterAxisSizingMode = 'FIXED';
  f.resize(width, 100); f.paddingLeft = f.paddingRight = 48; f.paddingTop = f.paddingBottom = 48; f.itemSpacing = 24;
  f.fills = [{ type: 'SOLID', color: hexToRgb(bg) }];
  return f;
}
function fill(node) { node.layoutAlign = 'STRETCH'; node.textAutoResize = 'HEIGHT'; }

async function fontNameFor(family, wanted) {
  const map = await fonts(), styles = map.get(family);
  if (!styles) return null;
  return { family, style: wanted ? pickStyle(styles, wanted) : regularOf(styles) };
}

async function insertPairCard(pair) {
  const h = await fontNameFor(pair.heading), b = await fontNameFor(pair.body), c = await fontNameFor(pair.caption || pair.body);
  const missing = [[h, pair.heading], [b, pair.body], [c, pair.caption]].filter((x) => !x[0]).map((x) => x[1]);
  if (missing.length) return { ok: false, message: `${missing.join(', ')} isn’t available in Figma.` };
  const bg = pair.bg || '#F4F3F0', ink = inkFor(bg);
  const card = frame(`Kept pair · ${pair.heading} + ${pair.body}`, bg, 560);
  const top = await makeText(`${pair.heading} + ${pair.body}`, c, 11, { ink, tracking: 8, upper: true, opacity: 0.7, lh: 140 });
  const head = await makeText(pair.head || DEFAULT_HEAD, h, 48, { ink, lh: 105 });
  const body = await makeText(pair.text || DEFAULT_BODY, b, 16, { ink, lh: 155, opacity: 0.85 });
  const foot = await makeText('Kept · ' + [pair.heading, pair.body, pair.caption].filter(Boolean).join(' / '), c, 11, { ink, tracking: 8, upper: true, opacity: 0.6, lh: 140 });
  for (const t of [top, head, body, foot]) { card.appendChild(t); fill(t); }
  card.itemSpacing = 24; head.paragraphSpacing = 0;
  placeAndSelect(card);
  return { ok: true, message: 'Pair card added to the canvas.' };
}

async function insertSpecimen(family) {
  const map = await fonts(), styles = map.get(family);
  if (!styles) return { ok: false, message: `${family} isn’t available in Figma.` };
  const ordered = styles.slice().sort((a, b) => isItalic(a) - isItalic(b) || weightOf(a) - weightOf(b)).slice(0, 12);
  const ink = inkFor('#F4F3F0');
  const card = frame(`Kept specimen · ${family}`, '#F4F3F0', 720);
  card.itemSpacing = 16;
  const label = { family: 'Inter', style: 'Regular' };
  card.appendChild(await makeText(`${styles.length} style${styles.length === 1 ? '' : 's'}`, label, 11, { ink, tracking: 8, upper: true, opacity: 0.6 }));
  const title = await makeText(family, await fontNameFor(family), 72, { ink, lh: 100 });
  card.appendChild(title); fill(title);
  for (const st of ordered) {
    const row = figma.createFrame();
    row.name = st; row.layoutMode = 'HORIZONTAL'; row.counterAxisAlignItems = 'BASELINE'; row.primaryAxisSizingMode = 'FIXED'; row.counterAxisSizingMode = 'AUTO';
    row.itemSpacing = 24; row.fills = []; row.paddingTop = row.paddingBottom = 12;
    row.strokes = [{ type: 'SOLID', color: ink, opacity: 0.15 }]; row.strokeTopWeight = 1; row.strokeBottomWeight = 0; row.strokeLeftWeight = 0; row.strokeRightWeight = 0;
    const l = await makeText(st, label, 10, { ink, tracking: 6, upper: true, opacity: 0.6 }); l.resize(112, l.height); l.textAutoResize = 'HEIGHT';
    const s = await makeText('Clear type, quiet confidence.', { family, style: st }, 28, { ink, lh: 115 });
    row.appendChild(l); row.appendChild(s); s.layoutGrow = 1; s.textAutoResize = 'HEIGHT';
    card.appendChild(row); row.layoutAlign = 'STRETCH';
  }
  placeAndSelect(card);
  return { ok: true, message: 'Specimen added to the canvas.' };
}

async function createStyles(pair) {
  const parts = [['Heading', pair.heading, 48, 105, 0], ['Body', pair.body, 16, 155, 0], ['Caption', pair.caption || pair.body, 12, 140, 8]];
  const existing = await figma.getLocalTextStylesAsync();
  let made = 0, updated = 0;
  for (const [role, family, size, lh, tracking] of parts) {
    const fn = await fontNameFor(family);
    if (!fn) return { ok: false, message: `${family} isn’t available in Figma.` };
    await figma.loadFontAsync(fn);
    const name = `Kept/${pair.heading} + ${pair.body}/${role}`;
    let st = existing.find((s) => s.name === name);
    if (st) updated++; else { st = figma.createTextStyle(); st.name = name; made++; }
    st.fontName = fn; st.fontSize = size;
    st.lineHeight = { unit: 'PERCENT', value: lh };
    st.letterSpacing = { unit: 'PERCENT', value: tracking };
    st.description = `Kept pair · ${role.toLowerCase()} · ${family}`;
  }
  return { ok: true, message: made ? `Added ${made} text styles under Kept/${pair.heading} + ${pair.body}.` : `Updated ${updated} existing text styles.` };
}

/* ---------- import from a Kept backup ---------- */
function mergeBackup(s, data) {
  let fonts = 0, pairs = 0;
  for (const [fam, at] of Object.entries(data.saved || {})) if (!s.saved[fam]) { s.saved[fam] = at; fonts++; }
  const have = new Set(s.pairs.map((p) => p.k));
  for (const p of data.pairs || []) if (p && p.heading && p.body && !have.has(p.k)) { s.pairs.push(p); have.add(p.k); pairs++; }
  Object.assign(s.notes, data.notes || {});
  for (const f of data.families || []) s.shelves[f.family] = (data.moves && data.moves[f.family]) || f.auto;
  s.importedAt = new Date().toISOString();
  return { fonts, pairs };
}

/* ---------- messages from the UI ---------- */
async function snapshot() {
  const s = await loadStore(), map = await fonts();
  const families = [...map.keys()].sort((a, b) => a.localeCompare(b));
  const styleCounts = {};
  for (const [fam, st] of map) styleCounts[fam] = st.length;
  return { type: 'state', store: s, families, styleCounts };
}

figma.ui.onmessage = async (msg) => {
  try {
    const s = await loadStore();
    let reply = null;
    switch (msg.type) {
      case 'ready': figma.ui.postMessage(await snapshot()); sendSelection(); return;
      case 'import': {
        const r = mergeBackup(s, msg.data); await saveStore(s);
        reply = { ok: true, message: `Loaded ${r.fonts} font${r.fonts === 1 ? '' : 's'} and ${r.pairs} pair${r.pairs === 1 ? '' : 's'} from Kept.` };
        break;
      }
      case 'toggle-save':
        if (s.saved[msg.family]) delete s.saved[msg.family]; else s.saved[msg.family] = new Date().toISOString();
        await saveStore(s); break;
      case 'save-pair': {
        const p = msg.pair; p.k = [p.heading, p.body, p.caption].join('|'); p.at = new Date().toISOString();
        if (!s.pairs.some((x) => x.k === p.k)) s.pairs.unshift(p);
        await saveStore(s); reply = { ok: true, message: 'Pair saved.' }; break;
      }
      case 'remove-pair': s.pairs = s.pairs.filter((p) => p.k !== msg.k); await saveStore(s); break;
      case 'clear': await saveStore(emptyStore()); reply = { ok: true, message: 'Cleared everything stored in this plugin.' }; break;
      case 'apply': reply = await applyFonts(msg.families, msg.role || 'auto'); break;
      case 'insert-card': reply = await insertPairCard(msg.pair); break;
      case 'insert-specimen': reply = await insertSpecimen(msg.family); break;
      case 'create-styles': reply = await createStyles(msg.pair); break;
      case 'resize': figma.ui.resize(380, Math.max(480, Math.min(900, msg.height | 0))); return;
    }
    figma.ui.postMessage(await snapshot());
    if (reply) figma.ui.postMessage(Object.assign({ type: 'notice' }, reply));
  } catch (e) {
    figma.ui.postMessage({ type: 'notice', ok: false, message: 'Something went wrong: ' + (e && e.message ? e.message : String(e)) });
  }
};
