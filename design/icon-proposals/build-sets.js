const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const exStart = html.indexOf('const EX = {');
const exEnd = html.indexOf('\n};', exStart);
const exBody = html.slice(exStart, exEnd);
const exercises = [];
for (const line of exBody.split('\n')) {
  const id = line.match(/^  ([a-z0-9]+):/);
  const cat = line.match(/cat:'(chest|back|shoulders|arms|legs|core)'/);
  const name = line.match(/en:'([^']*)'/);
  if (id && cat) exercises.push({ id: id[1], cat: cat[1], name: name ? name[1] : id[1] });
}
const iconStart = html.indexOf('function svg(inner)');
const iconEnd = html.indexOf('if(ACTIVE_ICON_SET');
const context = { window: {} };
vm.runInContext(html.slice(iconStart, iconEnd) + '\nthis.ICONS = ICONS;', vm.createContext(context));
const current = context.ICONS;

const COLORS = { chest: '#C7F36B', back: '#82D69B', shoulders: '#D9A441', arms: '#8FB8F3', legs: '#E08A5B', core: '#B9BDC4' };

function variant(name) {
  const n = name.toLowerCase();
  if (/curl|skull|tricep|bicep|pushdown/.test(n)) return 'arms';
  if (/squat|deadlift|lunge|thrust|calf|leg /.test(n)) return 'legs';
  if (/row|pull|pulldown|face pull/.test(n)) return 'back';
  if (/raise|shoulder|overhead|press/.test(n) && /shoulder|lateral|overhead/.test(n)) return 'shoulders';
  if (/plank|crunch|core|dead bug|hollow/.test(n)) return 'core';
  if (/bench|push-up|push up|chest|dip|fly/.test(n)) return 'chest';
  return null;
}

function paths(cat, name) {
  const kind = variant(name) || cat;
  const dumbbell = /dumbbell|αλτήρ|push-up|push up|band/.test(name.toLowerCase());
  if (kind === 'chest') {
    return dumbbell
      ? '<path d="M9 24c2-8 6-8 8 0M23 24c2-8 6-8 8 0"/><circle cx="9" cy="24" r="2.2"/><circle cx="31" cy="24" r="2.2"/><path d="M14 18h12"/>'
      : '<path d="M7 27h26"/><path d="M11 27V16h18v11"/><circle cx="11" cy="16" r="3"/><circle cx="29" cy="16" r="3"/>';
  }
  if (kind === 'back') {
    return '<path d="M8 13h7l5 7 5-7h7"/><path d="M13 20v9h14v-9"/><path d="M16 29v4M24 29v4"/>';
  }
  if (kind === 'shoulders') {
    return '<path d="M20 7v9"/><path d="M10 16h20"/><circle cx="10" cy="16" r="3"/><circle cx="30" cy="16" r="3"/><path d="M15 30c1-6 9-6 10 0"/>';
  }
  if (kind === 'arms') {
    return '<path d="M13 9v8l7 4 7-4V9"/><circle cx="13" cy="9" r="2.4"/><circle cx="27" cy="9" r="2.4"/><path d="M20 21v11"/>';
  }
  if (kind === 'legs') {
    return '<path d="M15 8h10v6l5 16h-5l-3-8-3 8h-5l5-16z"/>';
  }
  return '<path d="M7 25c5-9 21-9 26 0"/><path d="M12 25v6h16v-6"/><path d="M20 13v7"/>';
}

function wrap(style, inner) {
  if (style === 'line') {
    return `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  }
  if (style === 'duotone') {
    return `<svg viewBox="0 0 40 40" fill="currentColor" fill-opacity="0.22" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  }
  return `<svg viewBox="0 0 40 40" fill="currentColor" stroke="none">${inner}</svg>`;
}

const sets = { line: {}, duotone: {}, glyph: {} };
exercises.forEach((ex) => {
  const inner = paths(ex.cat, ex.name);
  sets.line[ex.id] = wrap('line', inner);
  sets.duotone[ex.id] = wrap('duotone', inner);
  sets.glyph[ex.id] = wrap('glyph', inner);
});

const out = `// Proposal sets only. The app keeps ACTIVE_ICON_SET = 'current'.\n// Swap by setting that constant to 'line', 'duotone', or 'glyph'.\nwindow.ICON_PROPOSALS = ${JSON.stringify(sets)};\n`;
fs.writeFileSync(path.join(__dirname, 'sets.js'), out);

function cell(svg, color, label) {
  return `<div class="cell"><div class="icon" style="color:${color}">${svg || ''}</div><div class="label">${label}</div></div>`;
}
function sheet(title, pick) {
  const cells = exercises.map((ex) => cell(pick(ex), COLORS[ex.cat], ex.id + ' · ' + ex.name)).join('');
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>
  body{margin:0;background:#101214;color:#f4f6f8;font:14px/1.3 ui-sans-serif,system-ui,sans-serif;padding:28px;}
  h1{font-size:22px;margin:0 0 6px;}
  p{color:#a7adb4;margin:0 0 18px;}
  .grid{display:flex;flex-wrap:wrap;gap:14px;}
  .cell{width:148px;}
  .icon{width:52px;height:52px;background:#1c2126;border-radius:14px;display:flex;align-items:center;justify-content:center;}
  .icon svg{width:52px;height:52px;}
  .label{margin-top:6px;font-size:11px;color:#c5cbd1;}
</style>
<h1>${title}</h1>
<p>Shown at the in-app size (52px) on the app background.</p>
<div class="grid">${cells}</div>`;
}
fs.writeFileSync(path.join(__dirname, 'preview-line.html'), sheet('Line icons', (ex) => sets.line[ex.id]));
fs.writeFileSync(path.join(__dirname, 'preview-duotone.html'), sheet('Duotone icons', (ex) => sets.duotone[ex.id]));
fs.writeFileSync(path.join(__dirname, 'preview-glyph.html'), sheet('Glyph icons', (ex) => sets.glyph[ex.id]));

const rows = exercises.map((ex) => {
  const cols = [
    ['Current', current[ex.id]],
    ['Line', sets.line[ex.id]],
    ['Duotone', sets.duotone[ex.id]],
    ['Glyph', sets.glyph[ex.id]]
  ].map(([name, svg]) => `<div class="mini"><div class="icon" style="color:${COLORS[ex.cat]}">${svg || ''}</div><span>${name}</span></div>`).join('');
  return `<div class="row"><div class="who">${ex.id}<br>${ex.name}</div>${cols}</div>`;
}).join('');
fs.writeFileSync(path.join(__dirname, 'preview-compare.html'), `<!doctype html><meta charset="utf-8"><title>Icon comparison</title>
<style>
  body{margin:0;background:#101214;color:#f4f6f8;font:13px/1.3 ui-sans-serif,system-ui,sans-serif;padding:24px;}
  h1{font-size:22px;margin:0 0 8px;}
  p{color:#a7adb4;margin:0 0 16px;}
  .row{display:flex;gap:16px;align-items:center;padding:8px 0;border-top:1px solid #2a3036;}
  .who{width:220px;color:#c5cbd1;}
  .mini{width:70px;text-align:center;font-size:10px;color:#a7adb4;}
  .icon{width:52px;height:52px;margin:0 auto 4px;background:#1c2126;border-radius:14px;display:flex;align-items:center;justify-content:center;}
  .icon svg{width:52px;height:52px;}
</style>
<h1>Current vs proposed workout icons</h1>
<p>Same 52px tile and app background. The app still uses the current set.</p>
${rows}`);

console.log('exercises', exercises.length, 'current', Object.keys(current).length);
