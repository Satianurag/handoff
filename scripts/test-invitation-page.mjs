import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Run the actual page controller and deadline watcher with a deterministic
// device clock. The server preview can deliberately have a different clock.
const workspace = await readFile(new URL('../web/workspace.js', import.meta.url), 'utf8');
const start = workspace.indexOf('async function joinScreen(token) {');
const end = workspace.indexOf('\nfunction taskMarkup(', start);
assert.ok(start >= 0 && end > start);
const time = (await readFile(new URL('../web/time.js', import.meta.url), 'utf8')).replaceAll('export ', '');
function harness({ expiresAt, status = 'pending' }) {
  let now = 1000, html = '', previews = 0, timerId = 0;
  const timers = new Map(), listeners = new Map();
  const document = { visibilityState: 'visible', addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({
    Date: Clock, document, routeVersion: 1, subscriptions: [], homeIcon: '',
    viewer: { displayName: 'Synthetic recipient', email: 'recipient@example.test' },
    shell: value => { html = value; }, escape: value => String(value),
    readable: (error, fallback) => error?.data?.message ?? fallback,
    $: () => ({ addEventListener() {} }),
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    auth: { client: { action: async () => {
      // Bound a regression's recursive loop so a failing test cannot hang.
      if (++previews > 5) throw Error('Repeated preview loop');
      return { status, expiresAt, nickname: 'Synthetic household', inviterName: 'Synthetic owner' };
    } } },
  });
  vm.runInContext(time + '\n' + workspace.slice(start, end), context);
  return {
    context, get html() { return html; }, get previews() { return previews; },
    get timers() { return timers.size; },
    open: () => context.joinScreen('synthetic-token'),
    advance(to) { now = to; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } },
  };
}

test('an ahead-of-server device clock expires joining controls without a preview loop', async () => {
  const h = harness({ expiresAt: 999 });
  await h.open();
  // Let an accidental recursive async preview have the opportunity to run.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.previews, 1);
  assert.match(h.html, /invitation has expired/);
  assert.doesNotMatch(h.html, /id="join-form"|id="decline"|Synthetic household/);
  assert.equal(h.timers, 0);
});

test('an open invitation removes private preview and joining controls at its deadline', async () => {
  const h = harness({ expiresAt: 1500 });
  await h.open();
  assert.match(h.html, /id="join-form"/);
  h.advance(1499); assert.match(h.html, /id="join-form"/);
  h.advance(1500);
  assert.match(h.html, /invitation has expired/);
  assert.doesNotMatch(h.html, /id="join-form"|id="decline"|Synthetic household/);
  assert.equal(h.previews, 1);
});

test('accepted links keep their return action and an old deadline cannot replace another route', async () => {
  const accepted = harness({ expiresAt: 999, status: 'accepted' });
  await accepted.open(); assert.match(accepted.html, /Open household/); assert.equal(accepted.timers, 0);
  const pending = harness({ expiresAt: 1500 });
  await pending.open(); const oldHtml = pending.html;
  pending.context.routeVersion++;
  pending.advance(1500);
  assert.equal(pending.html, oldHtml);
});
