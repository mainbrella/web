import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { plans } from "./src/plans.js";

export default defineConfig({
  base: "/",
  publicDir: "public",
  plugins: [
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
      async closeBundle() {
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
          const match = request.url?.match(/^\/(privacy|terms|download|login)(\?.*)?$/);
          if (!match) {
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
        pricing: fileURLToPath(new URL("./pricing/index.html", import.meta.url)),
        login: fileURLToPath(new URL("./login/index.html", import.meta.url)),
        download: fileURLToPath(new URL("./download/index.html", import.meta.url)),
        privacy: fileURLToPath(new URL("./privacy/index.html", import.meta.url)),
        terms: fileURLToPath(new URL("./terms/index.html", import.meta.url)),
      },
    },
  },
});
