import type { Plugin } from 'vite';

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
    ['Product', [['Containers', '/docs/containers/'], ['Images', '/docs/images/'], ['Pricing', '/pricing/'], ['Benchmarks', '/benchmarks/'], ['Platform', '/platform/'], ['Compare platforms', '/compare/']]],
    ['Developers', [['Docs', '/docs/'], ['API reference', '/docs/api-reference/'], ['OpenAPI', 'https://api.mainbrella.com/docs'], ['Agent setup', '/docs/agent-setup/'], ['Integrations', '/integrations/'], ['Open source', '/opensource/'], ['GitHub', 'https://github.com/mainbrella'], ['Changelog', '/changelog/']]],
    ['Company', [['About', '/about/'], ['Contact', '/contact/'], ['Engineering blog', '/blog/'], ['Brand assets', '/brand/'], ['Careers', '/careers/'], ['Security', '/security/'], ['Trust center', '/trust/'], ['Status', '/status/']]],
    ['Legal', [['Privacy', '/privacy/'], ['Terms', '/terms/'], ['Acceptable use', '/terms/#acceptable-use'], ['Subprocessors', '/subprocessors/'], ['DPA availability', '/trust/#dpa'], ['Vulnerability disclosure', '/security/disclosure/']]],
  ];
  const footer = `<footer class="site-footer platform-footer wrap">
    <div class="footer-intro"><a class="footer-brand" href="/">mainbrella</a><p>Cloud computers for AI agents.</p><p>Mainbrella Co. · Sole proprietorship<br />Andrew Arrow · Culver City, California</p></div>
    <nav class="footer-columns" aria-label="Footer navigation">${groups.map(([title, links]) => `<div><h2>${title}</h2>${links.map(item => link(item, path)).join('')}</div>`).join('')}</nav>
  </footer>`;
  return { header, footer };
}

// Render shared chrome into HTML so navigation works without JavaScript.
export function siteChromePlugin(): Plugin {
  return {
    name: 'site-chrome',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        const { header, footer } = siteChrome(context.path);
        return html.replace('<!-- site-header -->', header).replace('<!-- site-footer -->', footer);
      },
    },
  };
}
