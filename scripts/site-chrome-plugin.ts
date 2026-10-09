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
    <div class="footer-intro"><a class="footer-brand" href="/">mainbrella</a><p>Cloud computers for AI agents.</p><p>Mainbrella Co. · Sole proprietorship<br />Andrew Arrow · Culver City, California</p><nav class="footer-socials" aria-label="Social media">
      <a href="https://www.tiktok.com/@mainbrella" aria-label="Mainbrella on TikTok"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.02 1.71 4.1 1.08 1.08 2.57 1.63 4.1 1.71v3.91c-1.53-.08-3.02-.63-4.1-1.71-.58-.58-1.03-1.28-1.34-2.05v9.03c0 1.72-.68 3.37-1.9 4.59a6.5 6.5 0 0 1-4.59 1.9c-1.72 0-3.37-.68-4.59-1.9a6.5 6.5 0 0 1-1.9-4.59c0-1.72.68-3.37 1.9-4.59a6.5 6.5 0 0 1 4.59-1.9c.32 0 .65.02.97.07v4.02a2.6 2.6 0 1 0 1.25 2.22V.02z" /></svg></a>
      <a href="https://github.com/mainbrella" aria-label="Mainbrella on GitHub"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.05c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.33-1.76-1.33-1.76-1.09-.75.08-.74.08-.74 1.2.08 1.83 1.23 1.83 1.23 1.07 1.82 2.8 1.3 3.49.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.17 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.29-1.23 3.29-1.23.66 1.65.25 2.87.13 3.17.77.84 1.23 1.91 1.23 3.22 0 4.62-2.8 5.64-5.48 5.94.43.37.81 1.1.81 2.22v3.14c0 .32.22.69.83.57A12 12 0 0 0 12 .5Z" /></svg></a>
      <a href="https://www.youtube.com/@mainbrella" aria-label="Mainbrella on YouTube"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill-rule="evenodd" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8ZM9.6 15.5v-7l6.3 3.5-6.3 3.5Z" /></svg></a>
    </nav></div>
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
    ['Dashboard', '/dashboard/'], ['Projects', '/projects/'],
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
