import { isAppRoute } from './routes.js';
async function script(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script'); el.src = src;
    el.onload = resolve; el.onerror = reject; document.head.append(el);
  });
}
try {
  if (location.pathname === '/') {
    const response = await fetch('/landing.html');
    if (!response.ok) throw Error('Page unavailable');
    const page = new DOMParser().parseFromString(await response.text(), 'text/html');
    page.querySelectorAll('script').forEach(el => el.remove());
    document.head.replaceChildren(...page.head.childNodes);
    document.body.replaceChildren(...page.body.childNodes);
    await script('/app.js');
  } else if (isAppRoute(location.pathname)) {
    await script('/lib/convex.js'); await script('/config.js');
    await import('./workspace.js');
  } else {
    document.title = 'Page not found — Handoff';
    document.querySelector('#app').innerHTML = '<main class="boot" id="main"><h1>Page not found.</h1><p>This link doesn’t lead to a Handoff page.</p><a href="/households">Open my households</a></main>';
  }
} catch {
  document.querySelector('#app')?.replaceChildren(Object.assign(document.createElement('p'), {className:'boot',textContent:'We couldn’t open Handoff. Check your connection and reload.'}));
}
