import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { demoConfig, localDemoConfig } from './config.ts';
import { renderBoardRequest } from './server.tsx';

type MiddlewareServer = {
  middlewares: { use(handler: (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => void): unknown };
};

export function boardPagesPlugin({ templatePath = 'index.html', homeHref = '/' } = {}) {
  let root = '';
  let output = '';
  let config: typeof demoConfig | typeof localDemoConfig = demoConfig;
  return {
    name: 'message-board-ssr',
    configResolved(resolved: { root: string; mode: string; build: { outDir: string } }) {
      root = resolved.root;
      output = resolve(root, resolved.build.outDir);
      config = resolved.mode === 'local-api' ? localDemoConfig : demoConfig;
    },
    configureServer(server: MiddlewareServer & { transformIndexHtml(url: string, html: string): Promise<string> }) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(`${homeHref}boards/`)) return next();
        try {
          const source = await readFile(resolve(root, templatePath), 'utf8');
          const template = await server.transformIndexHtml(`/${templatePath}`, source);
          const response = await renderBoardRequest(new Request(new URL(req.url, 'http://localhost'), { method: req.method }), { template, config, homeHref });
          if (!response) return next();
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(await response.text());
        } catch (error) { next(error); }
      });
    },
    configurePreviewServer(server: MiddlewareServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(`${homeHref}boards/`)) return next();
        try {
          const template = await readFile(resolve(output, templatePath), 'utf8');
          const response = await renderBoardRequest(new Request(new URL(req.url, 'http://localhost'), { method: req.method }), { template, config, homeHref });
          if (!response) return next();
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(await response.text());
        } catch (error) { next(error); }
      });
    },
  };
}
