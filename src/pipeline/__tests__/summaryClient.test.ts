// Kept within the task's owned test directory; exercises the pipeline's summary transport.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-url-polyfill/auto', () => ({}));
jest.mock('../../recorder/paths', () => ({ resolveLocalPath: (path: string) => path }));
const mockGetSession = jest.fn();
const mockPlatform = { OS: 'web' };
jest.mock('react-native', () => ({ Platform: mockPlatform }));
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => ({ auth: { getSession: mockGetSession } })) }));

const originalEnv = { ...process.env };
const originalFetch = Object.getOwnPropertyDescriptor(global, 'fetch')!;
const request = { noteId: 'n', title: '회의', segments: [], memos: [] };
const output = { summary: [], keywords: [], todos: [] };
beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.EXPO_PUBLIC_API_BASE;
  mockPlatform.OS = 'web';
  mockGetSession.mockResolvedValue({ data: { session: null } });
  Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => output }) });
});
afterEach(() => {
  process.env = { ...originalEnv };
  Object.defineProperty(global, 'fetch', originalFetch);
});

test.each(['web', 'ios', 'android'])('summarizes without Supabase on %s', async platform => {
  mockPlatform.OS = platform;
  const { sync } = require('../../sync') as typeof import('../../sync');
  await expect(sync.summarize(request)).resolves.toEqual(output);
  expect(global.fetch).toHaveBeenCalledWith(`${platform === 'web' ? '' : 'https://voicenote-ten-alpha.vercel.app'}/api/summarize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-voicenote-client': 'app' }, body: JSON.stringify(request),
  });
  await expect(sync.pullNotes()).rejects.toThrow('동기화가 설정되지 않았습니다');
});

test.each([null, { access_token: 'token' }])('includes Authorization only with a session: %p', async session => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test';
  process.env.EXPO_PUBLIC_API_BASE = 'https://custom.example/';
  mockGetSession.mockResolvedValue({ data: { session } });
  const { sync } = require('../../sync') as typeof import('../../sync');
  await sync.summarize(request);
  expect(global.fetch).toHaveBeenCalledWith('https://custom.example/api/summarize', expect.objectContaining({ headers: {
    'Content-Type': 'application/json', 'x-voicenote-client': 'app', ...(session ? { Authorization: 'Bearer token' } : {}),
  } }));
});

test('429 produces a Korean error and preserves status for the note screen', async () => {
  jest.mocked(global.fetch).mockResolvedValue({ ok: false, status: 429 } as Response);
  const { sync } = require('../../sync') as typeof import('../../sync');
  await expect(sync.summarize(request)).rejects.toMatchObject({ status: 429, message: '요약 요청이 많아요. 잠시 후 다시 시도해 주세요' });
});
