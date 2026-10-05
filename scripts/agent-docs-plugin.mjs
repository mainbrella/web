import { readFile } from 'node:fs/promises';

// Publish the source documents directly, so public copies cannot drift.
const assets = {
  'SKILL.md': new URL('../SKILL.md', import.meta.url),
  'API.md': new URL('../API.md', import.meta.url),
  'mainbrella-doctor.mjs': new URL('./mainbrella-doctor.mjs', import.meta.url),
  'mainbrella-verify.mjs': new URL('./mainbrella-verify.mjs', import.meta.url),
};

export function agentDocsPlugin() {
  return {
    name: 'agent-docs',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const path = request.url?.split('?')[0].slice(1);
        if (!Object.hasOwn(assets, path) || !['GET', 'HEAD'].includes(request.method)) return next();
        try {
          const source = await readFile(assets[path], 'utf8');
          response.setHeader('Content-Type', path.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'text/javascript; charset=utf-8');
          response.end(request.method === 'HEAD' ? undefined : source);
        } catch (error) { next(error); }
      });
    },
    async generateBundle() {
      for (const [fileName, path] of Object.entries(assets)) {
        this.emitFile({ type: 'asset', fileName, source: await readFile(path, 'utf8') });
      }
    },
  };
}
