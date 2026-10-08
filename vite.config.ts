import type { Plan } from './src/plans.ts';
import { defineConfig, transformWithEsbuild } from "vite";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { plans } from "./src/plans.ts";
import { agentDocsPlugin } from "./scripts/agent-docs-plugin.ts";
import { siteChromePlugin } from "./scripts/site-chrome-plugin.ts";

const publicPages = ['docs', 'docs/containers', 'docs/execute', 'docs/files', 'docs/images',
  'docs/ssh', 'docs/authentication', 'docs/limits', 'docs/errors', 'docs/api-reference',
  'docs/agent-setup', 'security', 'security/disclosure', 'contact', 'status', 'changelog',
  'benchmarks', 'integrations', 'trust', 'subprocessors', 'platform',
  'blog', 'blog/opencode-one-workspace', 'blog/open-swe-memory-and-machines', 'blog/open-your-mainbrella-with-two-hands', 'blog/when-it-rains-agents-bring-a-mainbrella', 'blog/new-batteries-for-the-batteries-included-agent-harness', 'blog/the-benefits-of-rain', 'blog/inside-our-brella', 'blog/virtual-companies-producing-reports', 'blog/account-owned-compute', 'blog/measuring-startup',
  'blog/safe-container-creation', 'blog/interactive-access', 'blog/custom-images',
  'compare', 'brand', 'press', 'careers', 'opensource',
  'e2b-alternative', 'daytona-alternative', 'cloudflare-sandbox'];

function checkoutPage(html: string, plan: Plan) {
  return html
    .replaceAll("Subscribe · Mainbrella", `${plan.name} subscription · Mainbrella`)
    .replace('<h1 id="checkout-title" tabindex="-1">Subscribe</h1>', `<h1 id="checkout-title" tabindex="-1">${plan.name} — $${plan.price}/month</h1>`)
    .replace('id="checkout-submit" type="submit" disabled>Subscribe</button>', `id="checkout-submit" type="submit" disabled>Subscribe for $${plan.price}/month</button>`);
}

// Preserve the public script URL while maintaining its source in TypeScript.
async function homepageScript() {
  const source = await readFile(new URL('./src/homepage.ts', import.meta.url), 'utf8');
  return (await transformWithEsbuild(source, 'homepage.ts', { loader: 'ts', target: 'es2022' })).code;
}

export default defineConfig({
  base: "/",
  publicDir: "public",
  plugins: [
    siteChromePlugin(),
    agentDocsPlugin(),
    {
      name: 'homepage-script',
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          if (request.url?.split('?')[0] !== '/homepage.js' || !['GET', 'HEAD'].includes(request.method ?? '')) return next();
          try {
            response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
            response.end(request.method === 'HEAD' ? undefined : await homepageScript());
          } catch (error) { next(error); }
        });
      },
      async generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'homepage.js', source: await homepageScript() });
      },
    },
    {
      name: "pricing-routes",
      transformIndexHtml: {
        order: "pre",
        handler(html, context) {
          const slug = context.originalUrl?.match(/^\/pricing\/([^/?]+)\/?(?:\?|$)/)?.[1];
          return slug && Object.hasOwn(plans, slug) ? checkoutPage(html, plans[slug]) : html;
        },
      },
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const match = request.url?.match(/^\/pricing\/([^/?]+)\/?(\?.*)?$/);
          if (match && Object.hasOwn(plans, match[1])) request.url = `/pricing/checkout.html${match[2] || ""}`;
          next();
        });
      },
    },
    {
      name: "pricing-pages",
      apply: "build",
      async writeBundle() {
        const output = fileURLToPath(new URL("./dist/pricing/", import.meta.url));
        const html = await readFile(`${output}checkout.html`, "utf8");
        for (const [slug, plan] of Object.entries(plans)) {
          await mkdir(`${output}${slug}`, { recursive: true });
          await writeFile(`${output}${slug}/index.html`, checkoutPage(html, plan));
        }
        await rm(`${output}checkout.html`);
      },
    },
    {
      name: "page-redirects",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (/^\/download(?:\/|\/index\.html)?(?:\?|$)/.test(request.url || '')) {
            const query = request.url?.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
            response.writeHead(301, { Location: `/platform/${query}` });
            response.end();
            return;
          }
          const match = request.url?.match(/^\/([^?]*[^/?])(\?.*)?$/);
          const routes = ['pricing', 'about', 'privacy', 'terms', 'login', 'profile', 'dashboard', 'api-keys', ...publicPages];
          if (!match || !routes.includes(match[1])) {
            next();
            return;
          }
          response.writeHead(308, {
            Location: `/${match[1]}/${match[2] ?? ""}`,
          });
          response.end();
        });
      },
    },
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        about: fileURLToPath(new URL("./about/index.html", import.meta.url)),
        pricingCheckout: fileURLToPath(new URL("./pricing/checkout.html", import.meta.url)),
        pricing: fileURLToPath(new URL("./pricing/index.html", import.meta.url)),
        login: fileURLToPath(new URL("./login/index.html", import.meta.url)),
        profile: fileURLToPath(new URL("./profile/index.html", import.meta.url)),
        apiKeys: fileURLToPath(new URL("./api-keys/index.html", import.meta.url)),
        dashboard: fileURLToPath(new URL("./dashboard/index.html", import.meta.url)),
        privacy: fileURLToPath(new URL("./privacy/index.html", import.meta.url)),
        terms: fileURLToPath(new URL("./terms/index.html", import.meta.url)),
        ...Object.fromEntries(publicPages.map(page => [page, fileURLToPath(new URL(`./${page}/index.html`, import.meta.url))])),
      },
    },
  },
});
