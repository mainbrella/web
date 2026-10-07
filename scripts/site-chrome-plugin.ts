import type { Plugin } from 'vite';
import { readFile } from 'node:fs/promises';

const agentCopyButton = `<button class="agent-copy-cta" type="button" data-copy-agent-setup aria-describedby="hero-agent-copy-status" hidden>
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="3" width="12" height="15" rx="1.5" /><path d="M4 7v14h12" /></svg>
  <span>Setup for agents</span>
</button>`;

const navigation: [string, string][] = [
  ['Docs', '/docs/'], ['Pricing', '/pricing/'],
  ['About', '/about/'],
];

function link([label, href]: [string, string], path: string) {
  const current = href.endsWith('/') && (path === `${href}index.html`
    || (href === '/blog/' && path.startsWith('/blog/')));
  return `<a href="${href}"${current ? ' aria-current="page"' : ''}>${label}</a>`;
}

export function siteChrome(path: string) {
  const header = `<header class="site-header platform-header wrap">
    <a class="brand" href="/" aria-label="Mainbrella home"><img src="/images/logo.png" alt="" width="44" height="44" /><span>mainbrella</span></a>
    <nav id="platform-navigation" aria-label="Main navigation">
      ${navigation.map(item => link(item, path)).join('\n      ')}
      <a class="login-link" href="/login/">Sign in</a>
      <a class="button button-small" href="/pricing/builder/">Start building</a>
    </nav>
  </header>`;
  const groups: [string, [string, string][]][] = [
    ['Product', [['Containers', '/docs/containers/'], ['Images', '/docs/images/'], ['Pricing', '/pricing/'], ['Benchmarks', '/benchmarks/'], ['Platform', '/platform/'], ['Compare platforms', '/compare/'], ['E2B alternative', '/e2b-alternative/'], ['Daytona alternative', '/daytona-alternative/'], ['Cloudflare sandbox', '/cloudflare-sandbox/']]],
    ['Developers', [['Docs', '/docs/'], ['API reference', '/docs/api-reference/'], ['OpenAPI', 'https://api.mainbrella.com/docs'], ['Agent setup', '/docs/agent-setup/'], ['Integrations', '/integrations/'], ['Open source', '/opensource/'], ['GitHub', 'https://github.com/mainbrella'], ['Changelog', '/changelog/']]],
    ['Company', [['About', '/about/'], ['Contact', '/contact/'], ['Engineering blog', '/blog/'], ['Press', '/press/'], ['Careers', '/careers/'], ['Security', '/security/'], ['Trust center', '/trust/'], ['Status', '/status/']]],
    ['Legal', [['Privacy', '/privacy/'], ['Terms', '/terms/'], ['Acceptable use', '/terms/#acceptable-use'], ['Subprocessors', '/subprocessors/'], ['DPA availability', '/trust/#dpa'], ['Vulnerability disclosure', '/security/disclosure/']]],
  ];
  const footer = `<footer class="site-footer platform-footer wrap">
    <div class="footer-intro"><a class="footer-brand" href="/">mainbrella</a><p>Cloud computers for AI agents.</p><p>Mainbrella Co. · Sole proprietorship<br />Andrew Arrow · Culver City, California</p></div>
    <nav class="footer-columns" aria-label="Footer navigation">${groups.map(([title, links]) => `<div><h2>${title}</h2>${links.map(item => link(item, path)).join('')}</div>`).join('')}</nav>
  </footer>`;
  return { header, footer };
}

const cookieDialog = `    <dialog class="cookie-consent" id="cookie-consent" aria-label="Cookie preferences" aria-describedby="cookie-consent-description">
      <p id="cookie-consent-description">This website uses cookies to measure and improve your experience. Read our <a href="/terms/" target="_blank" rel="noopener">Terms of Service<span class="visually-hidden"> (opens in a new tab)</span></a>.</p>
      <div class="cookie-consent-actions">
        <button class="button cookie-consent-reject" type="button" data-consent="rejected" autofocus>Reject All</button>
        <button class="button" type="button" data-consent="accepted">Accept All</button>
      </div>
    </dialog>
`;

function appChrome(path: string) {
  const pages: [string, string][] = [
    ['Dashboard', '/dashboard/'], ['API keys', '/api-keys/'], ['Profile', '/profile/'],
  ];
  return `<header class="site-header app-header wrap">
    <a class="brand" href="/" aria-label="Mainbrella home"><img src="/images/logo.png" alt="" width="44" height="44" /><span>mainbrella</span></a>
    <nav aria-label="Main navigation"><a href="/docs/">Docs</a></nav>
  </header>
  <nav class="app-navigation wrap" aria-label="Product navigation">
    ${pages.map(item => link(item, path)).join('\n    ')}
  </nav>`;
}

// Render shared chrome into HTML so navigation works without JavaScript.
export function siteChromePlugin(): Plugin {
  return {
    name: 'site-chrome',
    transformIndexHtml: {
      order: 'pre',
      async handler(html, context) {
        if (html.includes('<!-- agent-setup -->')) {
          const setup = await readFile(new URL('../partials/agent-setup.html', import.meta.url), 'utf8');
          html = html.replace('<!-- agent-setup -->', setup)
            .replace('<!-- agent-copy-cta -->', agentCopyButton)
            .replace('</body>', '<script type="module" src="/src/agent-setup.ts"></script>\n  </body>');
        }
        const { header, footer } = siteChrome(context.path);
        html = html.replace('<!-- site-header -->', header).replace('<!-- site-footer -->', footer)
          .replace('<!-- app-header -->', appChrome(context.path))
          .replace('<!-- cookie-consent -->', cookieDialog);
        // Every entry page needs a dialog, including pages without a placeholder.
        if (!html.includes('id="cookie-consent"')) {
          html = html.replace('</body>', `${cookieDialog}  </body>`);
        }
        return html.replace('</body>', '<script type="module" src="/src/acquisition.ts"></script>\n  </body>');
      },
    },
  };
}
