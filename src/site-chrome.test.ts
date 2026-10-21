import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { siteChrome, siteChromePlugin } from '../scripts/site-chrome-plugin.ts';

const hook = siteChromePlugin().transformIndexHtml;
assert.ok(hook && typeof hook === 'object' && 'handler' in hook);
const handler = hook.handler;
const pluginContext = {} as ThisParameterType<typeof handler>;

async function transform(filename: string, path: string) {
  const source = await readFile(new URL(`../${filename}`, import.meta.url), 'utf8');
  const result: unknown = await handler.call(pluginContext, source, { path, filename });
  assert.equal(typeof result, 'string');
  if (typeof result !== 'string') throw new Error('Expected transformed HTML');
  return result;
}

test('blog chrome keeps reading navigation compact without cookie controls', () => {
  for (const path of ['/blog/index.html', '/blog/we-ran-the-same-broken-app-on-three-cloud-sandboxes/index.html']) {
    const { header, footer } = siteChrome(path);
    assert.match(header, /class="site-header blog-header wrap"/);
    assert.match(header, /href="\/blog\/"[^>]*>Engineering blog<\/a>/);
    assert.doesNotMatch(header, /Start building|Sign in|platform-navigation/);
    assert.doesNotMatch(footer, /data-cookie-settings|Cookie settings/);
  }
  const { header } = siteChrome('/docs/index.html');
  assert.match(header, /class="site-header platform-header wrap"/);
  assert.match(header, /Start building/);
  assert.match(header, /Sign in/);
});

test('BFF composes its product-owned homepage with shared chrome and preview navigation', async () => {
  const html = await transform('bff/index.html', '/bff/index.html');
  assert.match(html, /<title>BFF · Everything behind your app · Mainbrella<\/title>/);
  assert.match(html, /<main id="main">/);
  assert.match(html, /href="\/bff\/demo">Try Demo App/);
  assert.match(html, /href="#developer-experience">Developer experience<\/a>/);
  assert.match(html, /href="#early-access">Get early access<\/a>/);
  assert.match(html, /mailto:support@mainbrella.com\?subject=Mainbrella%20BFF%20early%20access/);
  assert.doesNotMatch(html, /cookie-consent|data-cookie-settings/);
  assert.doesNotMatch(html, /<!-- (?:bff-homepage|site-header|site-footer) -->/);
  assert.match(html, /src="\/src\/bff.ts"/);
  assert.match(html, /src="\/src\/account-menu.ts"/);
  assert.match(html, /src="\/src\/privacy.ts"/);
  for (const path of ['/bff/', '/bff/index.html']) {
    const { header, footer } = siteChrome(path);
    assert.match(header, /href="#early-access"/);
    assert.doesNotMatch(header, /Start building|Open Voice/);
    assert.match(footer, /href="\/bff\/"/);
    assert.match(footer, /Everything behind your app. Nothing to deploy./);
  }
});

test('BFF demo composes the standalone React example without authenticated workspace navigation', async () => {
  const html = await transform('bff/demo/index.html', '/bff/demo/index.html');
  assert.match(html, /Message board/);
  assert.match(html, /id="message-board-root"/);
  assert.doesNotMatch(html, /type="password"|id="demo-user"/);
  assert.match(html, /src="\/src\/bff-demo.ts"/);
  assert.match(html, /rel="stylesheet" href="\/src\/bff-demo.css"/);
  assert.doesNotMatch(html, /src="\/src\/main.tsx"/);
  assert.doesNotMatch(html, /cookie-consent|data-cookie-settings/);
  assert.doesNotMatch(html, /<!-- (?:bff-demo|message-board-cookie-settings) -->|app-navigation|Sign in/);
});

test('BFF workspace uses authenticated app chrome and its own route entry', async () => {
  const html = await transform('bff/app/index.html', '/bff/app/index.html');
  assert.match(html, /<title>BFF · Mainbrella<\/title>/);
  assert.match(html, /href="\/bff\/app\/" aria-current="page">BFF<\/a>/);
  assert.match(html, /href="\/voice\/app\/">Voice<\/a>/);
  assert.match(html, /src="\/src\/bff-app.ts"/);
  assert.match(html, /id="bff-content" hidden/);
  assert.match(html, /name="robots" content="noindex"/);
  assert.match(html, /v0\.0\.1/);
  assert.doesNotMatch(html, /Sample project|Trailhead|no services are connected/);
  assert.doesNotMatch(html, /<!-- (?:bff-app|app-header) -->|data-consent-prompt="optional"/);

  const dashboard = await transform('dashboard/index.html', '/dashboard/index.html');
  assert.match(dashboard, /href="\/bff\/app\/">BFF<\/a>/);
});

test('article CSS is inlined in source order after critical shared styles', async () => {
  const html = await transform('blog/we-ran-the-same-broken-app-on-three-cloud-sandboxes/index.html', '/blog/we-ran-the-same-broken-app-on-three-cloud-sandboxes/index.html');
  const critical = html.indexOf('<style data-critical-css>');
  const shared = html.indexOf('<link rel="stylesheet" href="/mainbrella.css"');
  const sharedArticle = html.indexOf('<style data-article-css="/blog/inside-our-brella/article.css">');
  const pageArticle = html.indexOf('<style data-article-css="/blog/one-bug-three-clouds/article.css">');

  assert.ok(critical >= 0 && critical < shared, 'critical CSS must precede the full shared stylesheet');
  assert.ok(shared < sharedArticle && sharedArticle < pageArticle, 'article CSS must retain linked stylesheet order');
  assert.doesNotMatch(html, /<link rel="stylesheet" href="\/blog\/(?:inside-our-brella|one-bug-three-clouds)\/article\.css"/);
  assert.match(html.slice(critical, shared), /\.wrap\s*\{/);
  assert.match(html.slice(critical, shared), /\.platform-header\s*\{/);
  assert.match(html.slice(critical, shared), /\.footer-socials svg\s*\{/);
  assert.match(html.slice(critical, shared), /\.account-panel\s*\{/);
  assert.match(html.slice(critical, shared), /\[hidden\]\s*\{/);
  assert.match(html.slice(sharedArticle, pageArticle), /\.inside-brella article\s*\{/);
  assert.match(html.slice(pageArticle), /\.rodeo-article \.rodeo-screenshots\s*\{/);
});

test('critical shared CSS supports the builder stylesheet URL', async () => {
  const html = await transform('build/index.html', '/build/index.html');
  const critical = html.indexOf('<style data-critical-css>');
  const shared = html.indexOf('<link rel="stylesheet" href="/public/mainbrella.css"');
  assert.ok(critical >= 0 && critical < shared);
});

test('dashboard critical CSS follows shared critical CSS and precedes the full app stylesheet', async () => {
  const html = await transform('dashboard/index.html', '/dashboard/index.html');
  const shared = html.indexOf('<link rel="stylesheet" href="/mainbrella.css"');
  const appCritical = html.indexOf('<style data-critical-app-css>');
  const app = html.indexOf('<link rel="stylesheet" href="/app.css"');
  assert.ok(shared >= 0 && shared < appCritical && appCritical < app);
  assert.match(html.slice(appCritical, app), /\.app-navigation\s*\{/);
  assert.match(html.slice(appCritical, app), /@media \(max-width: 700px\)/);
  assert.ok(html.indexOf('<script data-dashboard-view-bootstrap>') < shared);

  const builderHtml = await transform('build/index.html', '/build/index.html');
  const builderAppCritical = builderHtml.indexOf('<style data-critical-app-css>');
  const builderApp = builderHtml.indexOf('<link rel="stylesheet" href="/public/app.css"');
  assert.ok(builderAppCritical >= 0 && builderAppCritical < builderApp);
});

test('dashboard view bootstrap sets the matching title, main view, and active link before disconnecting', async () => {
  const html = await readFile(new URL('../dashboard/index.html', import.meta.url), 'utf8');
  const script = html.match(/<script data-dashboard-view-bootstrap>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);

  for (const [search, expectedView, expectedTitle] of [
    ['?view=production', 'production', 'Production'],
    ['?view=ad-hoc', 'ad-hoc', 'Ad Hoc'],
    ['', 'overview', 'Overview'],
    ['?view=unknown', 'overview', 'Overview'],
  ]) {
    const title = { textContent: 'Overview' };
    const status = {};
    const main = { attributes: new Map<string, string>(), setAttribute(name: string, value: string) { this.attributes.set(name, value); } };
    const links = ['/dashboard/', '/dashboard/?view=production', '/dashboard/?view=ad-hoc'].map(href => ({
      href: `https://mainbrella.com${href}`,
      attributes: new Map<string, string>(),
      setAttribute(name: string, value: string) { this.attributes.set(name, value); },
      removeAttribute(name: string) { this.attributes.delete(name); },
    }));
    let observer: { fire: () => void; disconnected: boolean } | undefined;
    class FakeMutationObserver {
      disconnected = false;
      constructor(private callback: () => void) { observer = this; }
      observe() {}
      disconnect() { this.disconnected = true; }
      fire() { this.callback(); }
    }
    const readyNodes = new Map<string, unknown>();
    runInNewContext(script!, {
      location: { search, href: 'https://mainbrella.com/dashboard/' },
      URL,
      URLSearchParams,
      document: {
        documentElement: {},
        querySelector(selector: string) { return readyNodes.get(selector) ?? null; },
        querySelectorAll() { return links; },
      },
      MutationObserver: FakeMutationObserver,
    });
    assert.ok(observer);
    observer!.fire();
    assert.equal(observer!.disconnected, false, 'bootstrap waits until the title and status have parsed');
    readyNodes.set('#dashboard-title', title);
    readyNodes.set('#dashboard-status', status);
    readyNodes.set('#main', main);
    observer!.fire();
    assert.equal(title.textContent, expectedTitle);
    assert.equal(main.attributes.get('data-view'), expectedView);
    assert.deepEqual(links.map(link => link.attributes.get('aria-current') ?? null), [
      expectedView === 'overview' ? 'page' : null,
      expectedView === 'production' ? 'page' : null,
      expectedView === 'ad-hoc' ? 'page' : null,
    ]);
    assert.equal(observer!.disconnected, true);
  }
});

test('isolated exception pages bypass CSS inlining unchanged', async () => {
  for (const path of ['/unsubscribe/index.html', '/repo-rodeo-bug/index.html']) {
    const filename = `${path.slice(1, path.indexOf('/index.html'))}/index.html`;
    const source = await readFile(new URL(`../${filename}`, import.meta.url), 'utf8');
    const result: unknown = await handler.call(pluginContext, source, { path, filename });
    assert.equal(result, source, path);
  }
});
