import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { plans } from "./src/plans.js";
import { agentDocsPlugin } from "./scripts/agent-docs-plugin.mjs";
import { siteChromePlugin } from "./scripts/site-chrome-plugin.mjs";

const publicPages = ['docs', 'docs/containers', 'docs/execute', 'docs/files', 'docs/images',
  'docs/ssh', 'docs/authentication', 'docs/limits', 'docs/errors', 'docs/api-reference',
  'docs/agent-setup', 'security', 'security/disclosure', 'contact', 'status', 'changelog'];

export default defineConfig({
  base: "/",
  publicDir: "public",
  plugins: [
    siteChromePlugin(),
    agentDocsPlugin(),
    {
      name: "pricing-routes",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const match = request.url?.match(/^\/pricing\/([^/?]+)\/?(\?.*)?$/);
          if (match && Object.hasOwn(plans, match[1])) request.url = `/pricing/index.html${match[2] || ""}`;
          next();
        });
      },
    },
    {
      name: "pricing-pages",
      apply: "build",
      async writeBundle() {
        const output = fileURLToPath(new URL("./dist/pricing/", import.meta.url));
        const html = await readFile(`${output}index.html`, "utf8");
        for (const [slug, plan] of Object.entries(plans)) {
          await mkdir(`${output}${slug}`, { recursive: true });
          await writeFile(`${output}${slug}/index.html`, html.replaceAll("Subscribe · Mainbrella", `${plan.name} subscription · Mainbrella`));
        }
        await rm(`${output}index.html`);
      },
    },
    {
      name: "page-redirects",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const match = request.url?.match(/^\/([^?]*[^/?])(\?.*)?$/);
          const routes = ['about', 'privacy', 'terms', 'download', 'login', 'profile', 'dashboard', 'api-keys', ...publicPages];
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
        pricing: fileURLToPath(new URL("./pricing/index.html", import.meta.url)),
        login: fileURLToPath(new URL("./login/index.html", import.meta.url)),
        profile: fileURLToPath(new URL("./profile/index.html", import.meta.url)),
        apiKeys: fileURLToPath(new URL("./api-keys/index.html", import.meta.url)),
        dashboard: fileURLToPath(new URL("./dashboard/index.html", import.meta.url)),
        download: fileURLToPath(new URL("./download/index.html", import.meta.url)),
        privacy: fileURLToPath(new URL("./privacy/index.html", import.meta.url)),
        terms: fileURLToPath(new URL("./terms/index.html", import.meta.url)),
        ...Object.fromEntries(publicPages.map(page => [page, fileURLToPath(new URL(`./${page}/index.html`, import.meta.url))])),
      },
    },
  },
});
