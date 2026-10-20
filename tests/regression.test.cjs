const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'anthropic-proxy.js'), 'utf8');
function frontendFunction(name) {
  const asyncStart = app.indexOf('async function ' + name + '(');
  const start = asyncStart >= 0 ? asyncStart : app.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  return app.slice(start, app.indexOf('\n}', start) + 2);
}
function front(names, globals = {}) {
  const context = vm.createContext({ console, ...globals });
  vm.runInContext(names.map(frontendFunction).join('\n'), context);
  return context;
}
function worker(fetch) {
  const context = vm.createContext({ console, Response, Request, URL, URLSearchParams,
    TextEncoder, Uint8Array, atob, btoa, fetch });
  vm.runInContext(backend.replace('export default {', 'const worker = {'), context);
  vm.runInContext('getServiceAccountAccessToken = async () => "service-token";', context);
  return context;
}
function json(value, status = 200) { return new Response(JSON.stringify(value), { status }); }
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('all app and Worker scripts compile', () => {
  for (const file of ['index.html', 'admin.html']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of text.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  }
  new vm.Script(backend.replace('export default {', 'const worker = {'));
});

test('revoked and missing accounts cannot consume quota or call Anthropic', async () => {
  for (const status of ['denied', 'pending', 'missing']) {
    const calls = [];
    const c = worker(async url => {
      calls.push(url);
      if (url.includes('accounts:lookup')) return json({ users: [{ localId: 'user-a', email: 'a@example.com' }] });
      if (url.includes('/documents/access/')) return status === 'missing' ? json({}, 404) : json({ fields: { status: { stringValue: status } } });
      throw new Error('Unexpected request: ' + url);
    });
    const res = await c.handleAiProxy({ idToken: 'token', phase: 'onboarding' }, {}, {});
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'access_denied');
    assert.equal(calls.length, 2);
  }
});

test('approved onboarding still gets the free allowance', async () => {
  const writes = [];
  const c = worker(async (url, options = {}) => {
    if (url.includes('accounts:lookup')) return json({ users: [{ localId: 'user-a', email: 'a@example.com' }] });
    if (url.includes('/documents/access/')) return json({ fields: { status: { stringValue: 'approved' } } });
    if (url.includes('/data/subscription')) return json({}, 404);
    if (url.includes('/data/onboarding-usage')) {
      if (options.method === 'PATCH') { writes.push(JSON.parse(options.body)); return json({}); }
      return json({ fields: { value: { stringValue: '{"count":2}' } } });
    }
    if (url === 'https://api.anthropic.com/v1/messages') return json({ content: [{ type: 'text', text: 'Hello' }] });
    throw new Error('Unexpected request: ' + url);
  });
  const res = await c.handleAiProxy({ idToken: 'token', phase: 'onboarding', messages: [] }, {}, {});
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(writes[0].fields.value.stringValue).count, 3);
  assert.equal((await res.json()).content[0].text, 'Hello');
});

test('Pro monthly text and photo limits still enforce their own caps', async () => {
  for (const [photo, limit, prefix] of [[false, 200, 'ai-usage-month:'], [true, 40, 'ai-photo-usage:']]) {
    let count = limit - 1;
    const c = worker(async (url, opts = {}) => {
      assert.ok(decodeURIComponent(url).includes(prefix));
      if (opts.method === 'PATCH') { count = JSON.parse(JSON.parse(opts.body).fields.value.stringValue).count; return json({}); }
      return json({ fields: { value: { stringValue: JSON.stringify({ count }) } } });
    });
    assert.equal((await c.checkAndConsumeQuota('token', 'uid', 'pro', photo)).remaining, 0);
    assert.equal((await c.checkAndConsumeQuota('token', 'uid', 'pro', photo)).ok, false);
    assert.equal(count, limit);
  }
});

test('account cleanup paginates and deletes protected documents using commits', async () => {
  const calls = [];
  const c = worker(async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/data?pageSize=300')) {
      if (url.includes('pageToken=next')) return json({ documents: [{ name: 'projects/p/databases/(default)/documents/users/u/data/ai-photo-usage:2026-10' }] });
      return json({ documents: [{ name: 'projects/p/databases/(default)/documents/users/u/data/onboarding-usage' }], nextPageToken: 'next' });
    }
    return json({});
  });
  await c.deleteUserData('token', 'u');
  const commit = calls.find(call => call.url.endsWith(':commit'));
  assert.equal(JSON.parse(commit.options.body).writes.length, 2);
  assert.equal(calls.at(-1).options.method, 'DELETE');
});

test('self-deletion requires recent verified identity before deleting anything', async () => {
  for (const offset of [600, -600]) {
    let calls = 0;
    const c = worker(async url => {
      calls++;
      assert.ok(url.includes('accounts:lookup'));
      return json({ users: [{ localId: 'real-user' }] });
    });
    const payload = Buffer.from(JSON.stringify({ auth_time: Math.floor(Date.now() / 1000) - offset })).toString('base64url');
    const res = await c.handleDeleteAccount({ idToken: 'header.' + payload + '.signature', targetUid: 'someone-else' }, {}, {});
    assert.equal(res.status, 401);
    assert.equal(calls, 1);
  }
});

test('self-deletion only deletes the verified user and removes access last', async () => {
  const calls = [];
  const c = worker(async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.includes('accounts:lookup')) return json({ users: [{ localId: 'real-user' }] });
    if (url.includes('/data?')) return json({ documents: [] });
    return json({});
  });
  const payload = Buffer.from(JSON.stringify({ auth_time: Math.floor(Date.now() / 1000) })).toString('base64url');
  const res = await c.handleDeleteAccount({ idToken: 'h.' + payload + '.s', targetUid: 'someone-else' }, {}, {});
  assert.equal(res.status, 200);
  const deletion = calls.find(call => call.url.includes('accounts:delete'));
  assert.equal(JSON.parse(deletion.opts.body).localId, 'real-user');
  assert.ok(calls.at(-1).url.endsWith('/access/real-user'));
  assert.ok(calls.every(call => !call.url.includes('someone-else')));
});

test('cleanup failure never deletes the Firebase sign-in account', async () => {
  const calls = [];
  const c = worker(async url => {
    calls.push(url);
    if (url.includes('accounts:lookup')) return json({ users: [{ localId: 'u' }] });
    if (url.includes('/data?')) return json({}, 500);
    throw new Error('Unexpected mutation');
  });
  const payload = Buffer.from(JSON.stringify({ auth_time: Math.floor(Date.now() / 1000) })).toString('base64url');
  assert.equal((await c.handleDeleteAccount({ idToken: 'h.' + payload + '.s' }, {}, {})).status, 500);
  assert.ok(!calls.some(url => url.includes('accounts:delete')));
});

test('old weight/history reads cannot overwrite a newly signed-in account', async () => {
  for (const [name, variable] of [['loadExerciseWeights', 'exerciseWeights'], ['loadExerciseWeightHistory', 'exerciseWeightHistory'], ['loadPersonalRecords', 'personalRecords'], ['loadExerciseProgress', 'exerciseProgress']]) {
    for (const fail of [false, true]) {
      const d = deferred();
      const state = { newUser: 99 };
      const c = front([name], { authEpoch: 1, [variable]: state, storage: { get: () => d.promise } });
      const request = c[name]();
      c.authEpoch = 2;
      d.resolve(fail ? { get value() { throw new Error('stale'); } } : { value: '{"oldUser":1}' });
      await request;
      assert.equal(c[variable], state);
    }
  }
});

test('food index writes stop when the session changes during a log save', async () => {
  const d = deferred(); let reads = 0;
  const c = front(['saveFoodLog'], { authEpoch: 1, todayKey: () => '2026-10-06', storage: { set: () => d.promise, get: () => { reads++; } } });
  const request = c.saveFoodLog([]); c.authEpoch = 2; d.resolve(); await request;
  assert.equal(reads, 0);
});

test('late workout loading does not update the new account screen', async () => {
  const d = deferred(); let renders = 0;
  const c = front(['loadTodayWorkout'], { authEpoch: 1, currentDay: 'new-day', checkedState: { newExercise: true }, DAYS: {}, todayKey: () => 'today', storage: { get: () => d.promise }, renderDayButtons: () => renders++, renderExercises: () => renders++, renderDashboard: () => renders++ });
  const request = c.loadTodayWorkout(); c.authEpoch = 2; d.resolve({ value: '{"day":"old-day","checked":["old"]}' }); await request;
  assert.equal(c.currentDay, 'new-day'); assert.equal(renders, 0); assert.equal(c.checkedState.newExercise, true);
});

test('export cannot label old account data with the new account identity', async () => {
  const d = deferred();
  const c = front(['exportUserData'], { authEpoch: 1, currentUser: { uid: 'a', email: 'a@example.com' }, db: { collection: () => ({ doc: () => ({ collection: () => ({ get: () => d.promise }) }) }) } });
  const request = c.exportUserData(); c.authEpoch = 2; c.currentUser = { uid: 'b' }; d.resolve({ forEach() {} });
  await assert.rejects(request, /session changed/);
});

test('dashboard uses the profile weekly target and escapes AI exercise text', async () => {
  const nodes = new Map();
  const document = { getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, { style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, textContent: '', innerHTML: '' });
    return nodes.get(id);
  } };
  const c = front(['renderDashboard', 'escapeHtml'], { authEpoch: 1, document, DAYS: { day: { label: 'Day', exercises: [{ id: 'x', name: '<img src=x onerror=bad>', sets: 3, reps: '<svg onload=bad>' }] } }, currentDay: 'day', checkedState: {}, currentProfile: { daysPerWeek: 6 }, L2: x => x, t: x => x, loadFoodLog: async () => [], storage: { get: async () => { throw new Error('not found'); } }, dateOffset: () => 'today', buildSparkline: () => ({ d: '', lastX: 0, lastY: 0 }) });
  await c.renderDashboard();
  assert.match(nodes.get('statsGrid').innerHTML, /\/ 6/);
  assert.ok(!nodes.get('heroChecklist').innerHTML.includes('<img'));
  assert.ok(!nodes.get('heroChecklist').innerHTML.includes('<svg'));
  assert.match(nodes.get('heroChecklist').innerHTML, /&lt;img/);
});

test('iOS paywall still offers monthly, annual and restore without Stripe checkout', async () => {
  let html = '';
  const c = front(['renderAiProSection'], { authEpoch: 1, document: { getElementById: id => id === 'aiProSection' ? { set innerHTML(value) { html = value; } } : null, querySelectorAll: () => [] }, loadAiSubscription: async () => null, loadAiCredits: async () => 0, isRunningInNativeApp: () => true, iapAvailable: () => true, isAndroidTwa: () => false, iapPackages: async () => [{ identifier: '$rc_monthly', packageType: 'MONTHLY', product: { priceString: '€4.99', price: 4.99 } }, { identifier: '$rc_annual', packageType: 'ANNUAL', product: { priceString: '€39.99', price: 39.99 } }], escapeHtml: x => x, t: (key, values = {}) => key + JSON.stringify(values) });
  await c.renderAiProSection();
  assert.match(html, /\$rc_monthly/); assert.match(html, /\$rc_annual/); assert.match(html, /aiIapRestoreBtn/);
  assert.ok(!html.includes('id="aiProActionBtn"')); assert.ok(!html.includes('id="aiCreditsActionBtn"'));
});

test('a delayed purchase cannot sync to a different Firebase account', async () => {
  const d = deferred(); let syncs = 0; let renders = 0;
  const c = front(['iapPurchase'], { authEpoch: 1, iapPackages: async () => [{ identifier: 'monthly' }], iapPlugin: async () => ({ purchasePackage: () => d.promise }), iapSyncWithServer: () => syncs++, renderAiProSection: () => renders++, customAlert() {}, t: x => x });
  const request = c.iapPurchase({ disabled: false }, 'monthly');
  // Let package/plugin loading reach the purchase promise.
  await new Promise(resolve => setImmediate(resolve));
  c.authEpoch = 2; d.resolve(); await request;
  assert.equal(syncs, 0); assert.equal(renders, 0);
});

test('admin deletion rejects a non-admin before any service-account cleanup', async () => {
  const c = worker(async url => {
    assert.ok(url.includes('accounts:lookup'));
    return json({ users: [{ localId: 'ordinary-user', email: 'ordinary@example.com', emailVerified: true }] });
  });
  assert.equal((await c.handleAdminDeleteUser({ idToken: 'token', targetUid: 'victim' }, {}, {})).status, 403);
});

test('quota rule covers every quota namespace currently written by the Worker', () => {
  // Structural coverage check. Firebase emulator evaluation is separate.
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  const body = rules.match(/function isServerOnlyDoc\(docId\) \{([\s\S]*?)\n    \}/)[1];
  const exact = [...body.matchAll(/docId == '([^']+)'/g)].map(m => m[1]);
  const patterns = [...body.matchAll(/docId.matches\('([^']+)'\)/g)].map(m => new RegExp('^(?:' + m[1] + ')$'));
  for (const id of ['subscription', 'credits', 'onboarding-usage', 'ai-usage:2026-10-06', 'ai-usage-month:2026-10', 'ai-photo-usage:2026-10']) assert.ok(exact.includes(id) || patterns.some(p => p.test(id)), id);
  assert.match(rules, /allow delete: if request.auth != null && !isServerOnlyDoc\(docId\)/);
});

function healthFrontend() {
  const start = app.indexOf('const HEALTH_SOURCES = ');
  const end = app.indexOf('\n// Links are built only', start);
  const c = front(['escapeHtml', 'stripMarkdown', 'citedHealthSourceIds', 'healthSourceLinkHtml', 'renderHealthReplyHtml', 'aiSourcesFooterHtml'], { t: key => key });
  vm.runInContext(app.slice(start, end), c);
  return c;
}

test('health citations link only catalog references and escape model markup', () => {
  const c = healthFrontend();
  const text = '<img src=x onerror=alert(1)> Protein [4] [4] [99]';
  const html = c.renderHealthReplyHtml(text);
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/'));
  assert.ok(html.includes('[99]'));
  assert.equal(Array.from(c.citedHealthSourceIds(text)).join(','), '4');
  const footer = c.aiSourcesFooterHtml(text);
  assert.equal((footer.match(/href=/g) || []).length, 1);
  assert.ok(!footer.includes('2305711'));
  assert.ok(c.aiSourcesFooterHtml('Historical uncited advice').includes('src_uncited'));
});

test('Worker citation policy preserves photo JSON and user-specific update protocol', () => {
  const c = worker(async () => { throw new Error('No network expected'); });
  const photo = 'Return ONLY JSON {"name":"food","kcal":1}';
  assert.equal(c.healthCitationSystemPrompt(photo, 'food-photo'), photo);
  for(const phase of ['coach','onboarding']) {
    const prompt = c.healthCitationSystemPrompt('Keep exercise-update JSON unchanged.', phase);
    assert.ok(prompt.startsWith('Keep exercise-update JSON unchanged.'));
    assert.ok(prompt.includes('BEFORE those blocks'));
    assert.ok(prompt.includes('Do not diagnose'));
    assert.ok(prompt.includes('not individually validated'));
    const links = vm.runInContext('Object.values(HEALTH_SOURCES).map(s=>s.url)', healthFrontend());
    for(const url of links) assert.ok(prompt.includes(url), url);
  }
});

test('onboarding request actually sends the server citation policy to Anthropic', async () => {
  let sent;
  const c = worker(async (url, options={}) => {
    if(url.includes('accounts:lookup')) return json({users:[{localId:'user-a'}]});
    if(url.includes('/documents/access/')) return json({fields:{status:{stringValue:'approved'}}});
    if(url.includes('/data/subscription')) return json({},404);
    if(url.includes('/data/onboarding-usage')) return options.method === 'PATCH' ? json({}) : json({},404);
    if(url === 'https://api.anthropic.com/v1/messages') {
      sent=JSON.parse(options.body);
      return json({content:[{type:'text',text:'General activity [7]'}]});
    }
    throw new Error('Unexpected request: '+url);
  });
  const res=await c.handleAiProxy({idToken:'token',phase:'onboarding',system:'Collect profile then JSON.',messages:[{role:'user',content:'Hi'}]}, {}, {});
  assert.equal(res.status,200);
  assert.ok(sent.system.includes('HEALTH INFORMATION AND CITATIONS'));
  assert.equal(sent.messages[0].content,'Hi');
});
