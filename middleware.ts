// Vercel Routing Middleware: restrict the whole site (pages + /api) to Korea.
// Country comes from Vercel's IP geolocation header; it is absent locally,
// so local development is not blocked. A VPN can still bypass this.

export const config = { matcher: '/:path*' };

const ALLOWED = new Set(['KR']);
const MESSAGE = '대한민국에서만 사용할 수 있어요.';

export function isAllowedCountry(country: string | null): boolean {
  if (!country) return true;
  return ALLOWED.has(country.toUpperCase());
}

const page = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>음성 노트</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F9F9F8;color:#21201C;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif}
main{max-width:360px;padding:24px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#63635E;line-height:1.6}
@media (prefers-color-scheme:dark){body{background:#111110;color:#EEEEEC}p{color:#B5B3AD}}</style></head>
<body><main><h1>${MESSAGE}</h1><p>This service is available in South Korea only.</p></main></body></html>`;

export default function middleware(request: Request): Response | undefined {
  if (isAllowedCountry(request.headers.get('x-vercel-ip-country'))) return undefined;
  if (new URL(request.url).pathname.startsWith('/api/')) {
    return Response.json({ error: MESSAGE }, { status: 403 });
  }
  return new Response(page, { status: 403, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
