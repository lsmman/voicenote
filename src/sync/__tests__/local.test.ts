jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const originalUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const originalKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  else process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  jest.resetModules();
});

test.each(['both', 'url', 'key'])('imports safely with missing %s configuration', async missing => {
  jest.resetModules();
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  if (missing !== 'key') delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (missing !== 'url') delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  const { supabase, sync, isSyncConfigured } = require('../index') as typeof import('../index');
  expect(isSyncConfigured).toBe(false);
  await expect(supabase.auth.getSession()).resolves.toEqual({ data: { session: null } });
  const callback = jest.fn();
  const { data: { subscription } } = supabase.auth.onAuthStateChange(callback);
  expect(() => subscription.unsubscribe()).not.toThrow();
  expect(callback).not.toHaveBeenCalled();

  const message = '동기화가 설정되지 않았습니다';
  await expect(supabase.auth.signInWithOtp({ email: 'test@example.com' })).rejects.toThrow(message);
  await expect(supabase.auth.signOut()).rejects.toThrow(message);
  await expect(supabase.from('notes').select('*').limit(1)).rejects.toThrow(message);
  await expect(supabase.rpc('sync_pull_note_detail', { p_note_id: 'note' })).rejects.toThrow(message);
  await expect(supabase.storage.from('audio').createSignedUrl('note/0.m4a', 60)).rejects.toThrow(message);
  for (const method of Object.values(sync)) {
    await expect((method as () => Promise<unknown>)()).rejects.toThrow(message);
  }
});
