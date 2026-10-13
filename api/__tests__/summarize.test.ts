/// <reference types="jest" />
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from '../summarize';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const mockGetUser = jest.fn();
const mockRpc = jest.fn();
const mockFinalMessage = jest.fn();
const mockOn = jest.fn();
const mockStream = jest.fn((..._args: unknown[]) => ({ finalMessage: mockFinalMessage, on: mockOn }));
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => ({ auth: { getUser: (...args: unknown[]) => mockGetUser(...args) }, rpc: (...args: unknown[]) => mockRpc(...args) })) }));
jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => ({ messages: { stream: (...args: unknown[]) => mockStream(...args) } })) }));
jest.mock('@anthropic-ai/sdk/helpers/zod', () => ({ zodOutputFormat: () => ({ type: 'json_schema' }) }));

const body = { noteId: 'n', title: '회의', segments: [{ startMs: 1234, endMs: 2000, text: '안녕', speakerLabel: null }], memos: [] };
const output = { summary: [{ text: '인사', atMs: 1234 }], keywords: [], todos: [] };
async function call(overrides: Partial<VercelRequest> = {}) {
  const req = { method: 'POST', headers: { authorization: 'Bearer token' }, body, ...overrides } as VercelRequest;
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), setHeader: jest.fn() };
  await handler(req, res as unknown as VercelResponse);
  return res;
}
beforeEach(() => {
  jest.clearAllMocks();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.ANTHROPIC_API_KEY = 'test';
  delete process.env.SUMMARY_DAILY_LIMIT;
  mockRpc.mockResolvedValue({ data: true, error: null });
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u' } }, error: null });
  mockFinalMessage.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: output });
});
test('POST only', async () => {
  const res = await call({ method: 'GET' });
  expect(res.status).toHaveBeenCalledWith(405);
  expect(res.setHeader).toHaveBeenCalledWith('Allow', 'POST');
  expect(mockGetUser).not.toHaveBeenCalled();
});
test('requires and verifies the bearer token', async () => {
  expect((await call({ headers: {} })).status).toHaveBeenCalledWith(401);
  mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
  expect((await call()).status).toHaveBeenCalledWith(401);
  expect(mockGetUser).toHaveBeenCalledWith('token');
  expect(mockStream).not.toHaveBeenCalled();
});
test('rejects oversized UTF-8 bodies with or without a declared length', async () => {
  expect((await call({ body: { ...body, title: '가'.repeat(1500000) } })).status).toHaveBeenCalledWith(413);
  expect((await call({ headers: { authorization: 'Bearer token', 'content-length': '4194305' } })).status).toHaveBeenCalledWith(413);
  expect(mockStream).not.toHaveBeenCalled();
});
test('rejects invalid JSON and invalid request shape', async () => {
  expect((await call({ body: '{' })).status).toHaveBeenCalledWith(400);
  expect((await call({ body: {} })).status).toHaveBeenCalledWith(400);
});
test('uses the requested SDK settings and maps valid output', async () => {
  const res = await call({ body: JSON.stringify(body) });
  expect(mockStream).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-opus-5-5', max_tokens: 6000, output_config: { effort: 'medium', format: { type: 'json_schema' } } }));
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(output);
  expect(Anthropic).toHaveBeenCalledWith({ timeout: 240_000, maxRetries: 1 });
});
test.each([['refusal', 422], ['max_tokens', 502], ['pause_turn', 502]])('handles %s before parsing', async (stop_reason, status) => {
  mockFinalMessage.mockResolvedValue({ stop_reason });
  expect((await call()).status).toHaveBeenCalledWith(status);
});
test('normalizes invented evidence and masks provider errors', async () => {
  mockFinalMessage.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: { ...output, todos: [{ text: 'x', atMs: 999 }] } });
  const normalized = await call();
  expect(normalized.status).toHaveBeenCalledWith(200);
  expect(normalized.json).toHaveBeenCalledWith({ ...output, todos: [{ text: 'x', atMs: null }] });
  mockFinalMessage.mockRejectedValue(new Error('private transcript'));
  const res = await call();
  expect(res.status).toHaveBeenCalledWith(502);
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('private transcript');
});

test.each([['refusal', 422], ['max_tokens', 502]])('preserves raw %s when SDK structured parsing throws', async (reason, status) => {
  mockFinalMessage.mockImplementationOnce(async () => {
    const listener = mockOn.mock.calls.find(([event]) => event === 'streamEvent')?.[1];
    listener({ type: 'message_delta', delta: { stop_reason: reason } });
    throw new Error('Failed to parse structured output');
  });
  expect((await call()).status).toHaveBeenCalledWith(status);
});

test('consumes the default quota using the user JWT-scoped client', async () => {
  await call();
  expect(createClient).toHaveBeenCalledWith('https://example.supabase.co', 'anon', expect.objectContaining({
    global: { headers: { Authorization: 'Bearer token' } },
  }));
  expect(mockRpc).toHaveBeenCalledWith('consume_summary_quota', { p_limit: 20 });
});

test('returns 429 on exhausted quota without calling the model', async () => {
  process.env.SUMMARY_DAILY_LIMIT = '7';
  mockRpc.mockResolvedValue({ data: false, error: null });
  expect((await call()).status).toHaveBeenCalledWith(429);
  expect(mockRpc).toHaveBeenCalledWith('consume_summary_quota', { p_limit: 7 });
  expect(mockStream).not.toHaveBeenCalled();
  expect(Anthropic).not.toHaveBeenCalled();
});

test.each(['', 'bad', '0', '-1', '1.5', '2147483648'])('uses the default for invalid daily limit %p', async limit => {
  process.env.SUMMARY_DAILY_LIMIT = limit;
  await call();
  expect(mockRpc).toHaveBeenCalledWith('consume_summary_quota', { p_limit: 20 });
});

test.each([{ data: null, error: { message: 'private details' } }, { data: null, error: null }])('fails closed when quota is unavailable: %p', async result => {
  mockRpc.mockResolvedValue(result);
  const res = await call();
  expect(res.status).toHaveBeenCalledWith(503);
  expect(mockStream).not.toHaveBeenCalled();
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('private details');
});

test('masks quota transport failures', async () => {
  mockRpc.mockRejectedValueOnce(new Error('private quota details'));
  const res = await call();
  expect(res.status).toHaveBeenCalledWith(503);
  expect(mockStream).not.toHaveBeenCalled();
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('private quota details');
});

test('does not consume quota for unauthorized or invalid requests', async () => {
  await call({ headers: {} });
  await call({ body: {} });
  expect(mockRpc).not.toHaveBeenCalled();
});
