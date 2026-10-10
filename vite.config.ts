import { defineConfig, transformWithEsbuild } from "vite";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { agentDocsPlugin } from "./scripts/agent-docs-plugin.ts";
import { siteChromePlugin } from "./scripts/site-chrome-plugin.ts";

const publicPages = ['docs', 'docs/containers', 'docs/execute', 'docs/files', 'docs/images',
  'docs/ssh', 'docs/authentication', 'docs/limits', 'docs/errors', 'docs/api-reference',
  'docs/agent-setup', 'security', 'security/disclosure', 'contact', 'status', 'changelog',
  'benchmarks', 'integrations', 'trust', 'subprocessors', 'platform',
  'blog', 'blog/opencode-one-workspace', 'blog/open-swe-memory-and-machines', 'blog/open-your-mainbrella-with-two-hands', 'blog/when-it-rains-agents-bring-a-mainbrella', 'blog/new-batteries-for-the-batteries-included-agent-harness', 'blog/the-benefits-of-rain', 'blog/inside-our-brella', 'blog/virtual-companies-producing-reports', 'blog/account-owned-compute', 'blog/measuring-startup',
  'blog/safe-container-creation', 'blog/interactive-access', 'blog/custom-images',
  'compare', 'brand', 'press', 'careers', 'opensource', 'try', 'yaml',
  'e2b-alternative', 'daytona-alternative', 'cloudflare-sandbox'];

const legacyPricingRoutes = ['builder', 'pro', 'scale'];

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
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const match = request.url?.match(/^\/pricing\/([^/?]+)\/?(\?.*)?$/);
          if (match?.[1] === 'usage') request.url = `/pricing/checkout.html${match[2] || ""}`;
          if (match && legacyPricingRoutes.includes(match[1])) {
            response.writeHead(308, { Location: `/pricing/${match[2] || ''}` });
            response.end();
            return;
          }
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
        for (const slug of ['usage', ...legacyPricingRoutes]) {
          await mkdir(`${output}${slug}`, { recursive: true });
          await writeFile(`${output}${slug}/index.html`, slug === 'usage' ? html : '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="0;url=/pricing/"><link rel="canonical" href="https://mainbrella.com/pricing/"><title>Prepaid billing · Mainbrella</title></head><body><a href="/pricing/">Continue to prepaid billing</a></body></html>');
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
          const routes = ['pricing', 'balance', 'about', 'privacy', 'terms', 'login', 'profile', 'dashboard', 'projects', 'api-keys', 'run', ...publicPages];
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
        run: fileURLToPath(new URL("./run/index.html", import.meta.url)),
        dashboard: fileURLToPath(new URL("./dashboard/index.html", import.meta.url)),
        balance: fileURLToPath(new URL("./balance/index.html", import.meta.url)),
        projects: fileURLToPath(new URL("./projects/index.html", import.meta.url)),
        privacy: fileURLToPath(new URL("./privacy/index.html", import.meta.url)),
        terms: fileURLToPath(new URL("./terms/index.html", import.meta.url)),
        ...Object.fromEntries(publicPages.map(page => [page, fileURLToPath(new URL(`./${page}/index.html`, import.meta.url))])),
      },
    },
  },
});
