// Pages, public documentation, and MCP pass through without cookies.
// Only summary generation is geo-restricted. Missing geolocation is allowed
// for local development; this is a cost guard, not an authentication boundary.
export const config = { matcher: '/:path*' };

const DEFAULT_COUNTRIES = 'KR,US,GB,CA,AU,NZ,IE,SG,CN,TW,HK,MO';
const MESSAGE = 'AI summaries are not available in your region.';

export function isAllowedCountry(country: string | null): boolean {
  if (!country) return true;
  const allowed = new Set(
    (process.env.SUMMARY_ALLOWED_COUNTRIES ?? DEFAULT_COUNTRIES)
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
  );
  // Korea remains allowed even when the environment overrides the list.
  return country.trim().toUpperCase() === 'KR' || allowed.has('*') || allowed.has(country.trim().toUpperCase());
}

export default function middleware(request: Request): Response | undefined {
  const pathname = new URL(request.url).pathname;
  if (request.method !== 'POST' || !/^\/api\/summarize\/?$/.test(pathname)) return undefined;
  if (isAllowedCountry(request.headers.get('x-vercel-ip-country'))) return undefined;
  return Response.json({ error: MESSAGE }, { status: 403, headers: { 'cache-control': 'no-store' } });
}
