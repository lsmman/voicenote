import middleware, { isAllowedCountry } from '../../middleware';

const originalOverride = process.env.SUMMARY_ALLOWED_COUNTRIES;
const req = (path = '/', method = 'GET', country?: string) => new Request(`https://example.com${path}`, {
  method, headers: country ? { 'x-vercel-ip-country': country } : {},
});
beforeEach(() => { delete process.env.SUMMARY_ALLOWED_COUNTRIES; });
afterAll(() => {
  if (originalOverride === undefined) delete process.env.SUMMARY_ALLOWED_COUNTRIES;
  else process.env.SUMMARY_ALLOWED_COUNTRIES = originalOverride;
});

test.each('KR,US,GB,CA,AU,NZ,IE,SG,CN,TW,HK,MO'.split(','))('default allows %s summaries', (country) => {
  expect(middleware(req('/api/summarize', 'POST', country))).toBeUndefined();
});
test('missing geolocation and lowercase country are allowed', () => {
  expect(isAllowedCountry(null)).toBe(true);
  expect(isAllowedCountry('us')).toBe(true);
  expect(middleware(req('/api/summarize', 'POST'))).toBeUndefined();
});
test.each(['/', '/notes/123', '/docs/index.html', '/docs/ko/', '/docs/zh/', '/llms.txt', '/llms-full.txt', '/.well-known/mcp.json', '/api/mcp', '/api/other', '/api/summarize/other'])('%s passes through without a response or cookies', (path) => {
  expect(middleware(req(path, 'GET', 'DE'))).toBeUndefined();
  expect(middleware(req(path, 'POST', 'DE'))).toBeUndefined();
});
test.each(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'])('%s summary requests pass through', (method) => {
  expect(middleware(req('/api/summarize', method, 'DE'))).toBeUndefined();
});
test.each(['/api/summarize', '/api/summarize/', '/api/summarize?mode=short'])('disallowed POST %s gets an uncached JSON 403', async (path) => {
  const res = middleware(req(path, 'POST', 'DE'))!;
  expect(res.status).toBe(403);
  expect(res.headers.get('content-type')).toContain('application/json');
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(res.headers.has('set-cookie')).toBe(false);
  expect(await res.json()).toEqual({ error: 'AI summaries are not available in your region.' });
});
test('override replaces defaults, normalizes entries, and always allows KR', () => {
  process.env.SUMMARY_ALLOWED_COUNTRIES = ' de, JP , ,';
  expect(isAllowedCountry('DE')).toBe(true);
  expect(isAllowedCountry('jp')).toBe(true);
  expect(isAllowedCountry('KR')).toBe(true);
  expect(isAllowedCountry('US')).toBe(false);
});
test('wildcard allows all countries', () => {
  process.env.SUMMARY_ALLOWED_COUNTRIES = ' * ';
  expect(middleware(req('/api/summarize', 'POST', 'DE'))).toBeUndefined();
});
test('empty override only allows KR or missing geolocation', () => {
  process.env.SUMMARY_ALLOWED_COUNTRIES = '';
  expect(isAllowedCountry('KR')).toBe(true);
  expect(isAllowedCountry('US')).toBe(false);
  expect(isAllowedCountry(null)).toBe(true);
});
