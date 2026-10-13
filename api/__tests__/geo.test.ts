import middleware, { isAllowedCountry } from '../../middleware';

const req = (country?: string) => new Request('https://example.com/', { headers: country ? { 'x-vercel-ip-country': country } : {} });

test('only Korea is allowed; a missing header (local dev) passes', () => {
  expect(isAllowedCountry('KR')).toBe(true);
  expect(isAllowedCountry('kr')).toBe(true);
  expect(isAllowedCountry(null)).toBe(true);
  expect(isAllowedCountry('US')).toBe(false);
  expect(isAllowedCountry('JP')).toBe(false);
});

test('requests from Korea pass through untouched', () => {
  expect(middleware(req('KR'))).toBeUndefined();
});

test('requests from elsewhere get a 403 with a Korean notice', async () => {
  const res = middleware(req('US'))!;
  expect(res.status).toBe(403);
  expect(res.headers.get('content-type')).toContain('text/html');
  expect(await res.text()).toContain('대한민국');
});

test('API requests from elsewhere get JSON 403', async () => {
  const res = middleware(new Request('https://example.com/api/summarize', { headers: { 'x-vercel-ip-country': 'DE' } }))!;
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: '대한민국에서만 사용할 수 있어요.' });
});
