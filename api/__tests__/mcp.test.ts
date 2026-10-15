import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from '../mcp';
import { tools } from '../_lib/mcpProtocol';

const originalFetch = global.fetch;
const mockFetch = jest.fn();
const token = `vn_${'a'.repeat(64)}`;
const reply = (value: unknown, ok = true) => ({ ok, json: async () => value });
async function request(body: unknown, authorization: string | undefined = `Bearer ${token}`, method = 'POST') {
  const headers: Record<string, unknown> = {};
  const res = { setHeader: jest.fn((key: string, value: unknown) => { headers[key] = value; }), status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), end: jest.fn().mockReturnThis() };
  await handler({ method, body, headers: { authorization } } as VercelRequest, res as unknown as VercelResponse);
  return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0]?.[0], headers, end: res.end };
}
const msg = (method: string, params?: unknown) => ({ jsonrpc: '2.0', id: 1, method, ...(params === undefined ? {} : { params }) });
beforeEach(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  global.fetch = mockFetch;
  mockFetch.mockReset().mockResolvedValue(reply([]));
});
afterAll(() => { global.fetch = originalFetch; });

test.each(['2025-06-18', '2025-03-26'])('initialize echoes supported version %s', async protocolVersion => {
  const res = await request(msg('initialize', { protocolVersion }));
  expect(res.status).toBe(200);
  expect(res.body.result).toMatchObject({ protocolVersion, serverInfo: { name: 'voicenote', version: '1.0.0' }, capabilities: { tools: {} }, instructions: expect.any(String) });
  expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ p_token: token, p_query: null, p_limit: 0 });
});
test('unknown version negotiates supported version; ping works', async () => {
  expect((await request(msg('initialize', { protocolVersion: 'future' }))).body.result.protocolVersion).toBe('2025-06-18');
  expect((await request(msg('ping'))).body.result).toEqual({});
});
test('tools/list exposes all read-only schemas', async () => {
  const res = await request(msg('tools/list'));
  expect(res.body.result.tools).toEqual(tools);
  expect(tools.map(t => t.name)).toEqual(['list_notes', 'get_note', 'search_transcripts', 'get_summary']);
  expect(tools.every(t => t.annotations.readOnlyHint)).toBe(true);
});
test('list_notes uses anon PostgREST and returns markdown and structured notes', async () => {
  const notes = [{ id: 'n', title: 'Test', createdAt: '2026-01-01', durationMs: 65000, status: 'done', hasSummary: true }];
  mockFetch.mockResolvedValueOnce(reply([])).mockResolvedValueOnce(reply(notes));
  const res = await request(msg('tools/call', { name: 'list_notes', arguments: { query: 'test' } }));
  expect(res.body.result.structuredContent).toEqual({ notes });
  expect(res.body.result.content[0].text).toContain('01:05');
  expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer anon-key');
  expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ p_token: token, p_query: 'test', p_limit: 20 });
});
test('get_note formats timestamps and get_summary returns only summary', async () => {
  const note = { id: 'n', title: 'Note', durationMs: 100000, createdAt: 'today', summary: { bullets: [{ atMs: 61000, text: 'Bullet' }], keywords: ['key'], todos: [{ atMs: null, text: 'Task' }] }, memos: [{ atMs: 2000, text: 'Memo' }], transcript: [{ startMs: 65000, text: 'Words' }] };
  mockFetch.mockResolvedValueOnce(reply([])).mockResolvedValueOnce(reply(note));
  const res = await request(msg('tools/call', { name: 'get_note', arguments: { id: 'n' } }));
  expect(res.body.result.structuredContent.transcript).toBe('[01:05] Words');
  expect(res.body.result.content[0].text).toContain('[01:01] Bullet');
  mockFetch.mockResolvedValueOnce(reply([])).mockResolvedValueOnce(reply(note));
  const summary = await request(msg('tools/call', { name: 'get_summary', arguments: { id: 'n' } }));
  expect(summary.body.result.structuredContent).toEqual({ summary: note.summary });
  expect(JSON.parse(mockFetch.mock.calls[3][1].body).p_include_transcript).toBe(false);
});
test('get_note can omit transcript', async () => {
  mockFetch.mockResolvedValueOnce(reply([])).mockResolvedValueOnce(reply({ title: 'N', memos: [], summary: null }));
  const res = await request(msg('tools/call', { name: 'get_note', arguments: { id: 'n', include_transcript: false } }));
  expect(JSON.parse(mockFetch.mock.calls[1][1].body).p_include_transcript).toBe(false);
  expect(res.body.result.structuredContent).not.toHaveProperty('transcript');
});
test('search forwards literal query and limit', async () => {
  mockFetch.mockResolvedValueOnce(reply([])).mockResolvedValueOnce(reply([{ noteId: 'n', noteTitle: 'N', startMs: 3000, text: '100%' }]));
  const res = await request(msg('tools/call', { name: 'search_transcripts', arguments: { query: '100%', limit: 100 } }));
  expect(mockFetch.mock.calls[1][0]).toContain('mcp_search_transcripts');
  expect(JSON.parse(mockFetch.mock.calls[1][1].body).p_query).toBe('100%');
  expect(res.body.result.content[0].text).toContain('[00:03] 100%');
});
test('missing and malformed auth produce 401 without fetching', async () => {
  for (const auth of ['', 'Bearer wrong', 'Basic x']) {
    const res = await request(msg('ping'), auth);
    expect(res.status).toBe(401);
    expect(res.headers['WWW-Authenticate']).toBe('Bearer');
    expect(res.body.error.code).toBe(-32001);
  }
  expect(mockFetch).not.toHaveBeenCalled();
});
test('invalid token produces 401 even for initialize', async () => {
  mockFetch.mockResolvedValue(reply({ code: '28000' }, false));
  expect((await request(msg('initialize', { protocolVersion: '2025-06-18' }))).status).toBe(401);
});
test('revoked token during tool call produces 401', async () => {
  mockFetch.mockResolvedValueOnce(reply([])).mockResolvedValueOnce(reply({ code: '28000' }, false));
  expect((await request(msg('tools/call', { name: 'list_notes' }))).status).toBe(401);
});
test.each(['notifications/initialized', 'notifications/cancelled', 'unknown'])('notification %s returns empty 202', async method => {
  const res = await request({ jsonrpc: '2.0', method });
  expect(res.status).toBe(202); expect(res.body).toBeUndefined(); expect(res.end).toHaveBeenCalled();
});
test('batch preserves response IDs and omits notifications', async () => {
  const res = await request([msg('ping'), { jsonrpc: '2.0', method: 'notifications/initialized' }, { ...msg('tools/list'), id: 'two' }, null]);
  expect(res.body.map((item: { id: unknown }) => item.id)).toEqual([1, 'two', null]);
  expect(res.body[2].error.code).toBe(-32600);
  expect((await request([{ jsonrpc: '2.0', method: 'notification' }])).status).toBe(202);
  expect((await request([])).body.error.code).toBe(-32600);
});
test.each([{ name: 'list_notes', arguments: { limit: 101 } }, { name: 'list_notes', arguments: { limit: 0 } }, { name: 'get_note', arguments: {} }, { name: 'search_transcripts', arguments: { query: ' ' } }, { name: 'get_note', arguments: { id: 'n', include_transcript: 'yes' } }, { name: 'other' }])('invalid tool arguments are JSON-RPC errors: %j', async params => {
  expect((await request(msg('tools/call', params))).body.error.code).toBe(-32602);
});
test('tool failures are isError results without leaking upstream errors', async () => {
  mockFetch.mockResolvedValueOnce(reply([])).mockResolvedValueOnce(reply({ message: 'private secret' }, false));
  const res = await request(msg('tools/call', { name: 'list_notes' }));
  expect(res.body.result.isError).toBe(true);
  expect(JSON.stringify(res.body)).not.toContain('private secret');
});
test('parse, invalid request, unknown method, GET, preflight, CORS', async () => {
  expect((await request('{')).body.error.code).toBe(-32700);
  expect((await request({})).body.error.code).toBe(-32600);
  expect((await request(msg('unknown'))).body.error.code).toBe(-32601);
  expect((await request(null, '', 'GET')).status).toBe(405);
  const options = await request(null, '', 'OPTIONS');
  expect(options.status).toBe(204);
  expect(options.headers['Access-Control-Allow-Origin']).toBe('*');
});
