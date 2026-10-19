import { renderBoardRequest } from '../examples/message-board/src/server.tsx';

type Env = { ASSETS: { fetch(request: Request): Promise<Response> } };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!new URL(request.url).pathname.startsWith('/bff/demo/boards/')) return env.ASSETS.fetch(request);
    const templateResponse = await env.ASSETS.fetch(new Request(new URL('/bff/demo/', request.url)));
    if (!templateResponse.ok) return new Response('Board unavailable. Please try again.', { status: 503 });
    return await renderBoardRequest(request, { template: await templateResponse.text(), homeHref: '/bff/demo/' })
      ?? env.ASSETS.fetch(request);
  },
};
