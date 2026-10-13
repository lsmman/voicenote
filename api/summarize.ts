import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { buildPrompt, mapResponse, requestSchema, summarySchema } from './_lib/summarizePrompt';

const MAX_BYTES = 4 * 1024 * 1024;
const HOUR_MS = 60 * 60 * 1000;
// Per-instance best effort only: serverless restarts/other instances reset or
// have separate windows. This is not a shared, durable quota.
const anonymousRequests = new Map<string, number[]>();

function allowedSource(req: VercelRequest): boolean {
  const allowed = (process.env.ALLOWED_ORIGINS ?? `https://${req.headers.host}`)
    .split(',').map(origin => origin.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (origin !== undefined && (typeof origin !== 'string' || !allowed.includes(origin))) return false;
  if (req.headers.referer !== undefined) {
    try {
      if (typeof req.headers.referer !== 'string' || !allowed.includes(new URL(req.headers.referer).origin)) return false;
    } catch { return false; }
  }
  return origin !== undefined || req.headers['x-voicenote-client'] === 'app';
}

function consumeAnonymousQuota(req: VercelRequest): boolean {
  const now = Date.now();
  for (const [ip, times] of anonymousRequests) {
    const recent = times.filter(time => time > now - HOUR_MS);
    if (recent.length) anonymousRequests.set(ip, recent);
    else anonymousRequests.delete(ip);
  }
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim()
    || req.socket?.remoteAddress || 'unknown';
  const configured = Number(process.env.ANON_SUMMARY_PER_HOUR ?? 10);
  const limit = Number.isSafeInteger(configured) && configured > 0 ? configured : 10;
  const times = anonymousRequests.get(ip) ?? [];
  if (times.length >= limit) return false;
  times.push(now);
  anonymousRequests.set(ip, times);
  return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers.origin && allowedSource(req)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'POST');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-voicenote-client');
      return res.status(204).end();
    }
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST 요청만 지원합니다.' });
  }
  // Vercel may provide a parsed JSON object or a raw string/Buffer.
  let body: unknown;
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8')
      : typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null);
    if (Number(req.headers['content-length'] ?? 0) > MAX_BYTES || Buffer.byteLength(raw, 'utf8') > MAX_BYTES) {
      return res.status(413).json({ error: '요청 본문은 4MB 이하여야 합니다.' });
    }
    body = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: '올바른 JSON 본문이 필요합니다.' });
  }
  const authorization = req.headers.authorization;
  const match = typeof authorization === 'string' ? /^Bearer\s+(\S+)$/i.exec(authorization) : null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  let supabase: SupabaseClient | undefined;
  if (authorization !== undefined && url && key) {
    if (!match) return res.status(401).json({ error: '유효하지 않은 로그인입니다.' });
    try {
      supabase = createClient(url, key, {
        global: { headers: { Authorization: `Bearer ${match[1]}` } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data, error } = await supabase.auth.getUser(match[1]);
      if (error || !data.user) return res.status(401).json({ error: '유효하지 않은 로그인입니다.' });
    } catch {
      return res.status(401).json({ error: '로그인을 확인하지 못했습니다.' });
    }
  }
  if (!supabase && !allowedSource(req)) {
    return res.status(403).json({ error: '허용되지 않은 요약 요청 출처입니다.' });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return res.status(400).json({ error: '요약 요청 형식이 올바르지 않습니다.' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: '요약 서버 설정이 누락되었습니다.' });
  if (supabase) {
    const configuredLimit = Number(process.env.SUMMARY_DAILY_LIMIT ?? 20);
    const dailyLimit = Number.isInteger(configuredLimit) && configuredLimit > 0 && configuredLimit <= 2147483647
      ? configuredLimit : 20;
    try {
      const { data: allowed, error } = await supabase.rpc('consume_summary_quota', { p_limit: dailyLimit });
      if (error || typeof allowed !== 'boolean') throw new Error('Quota unavailable');
      if (!allowed) return res.status(429).json({ error: '오늘의 요약 사용 한도를 초과했습니다.' });
    } catch {
      return res.status(503).json({ error: '요약 사용 한도를 확인하지 못했습니다. 다시 시도해 주세요.' });
    }
  } else if (!consumeAnonymousQuota(req)) {
    return res.status(429).json({ error: '요약 요청이 많아요. 잠시 후 다시 시도해 주세요' });
  }
  try {
    const { system, content } = buildPrompt(parsed.data);
    const client = new Anthropic({ timeout: 240_000, maxRetries: 1 });
    const stream = client.messages.stream({
      model: 'claude-opus-5-5', max_tokens: 6000,
      output_config: { effort: 'medium', format: zodOutputFormat(summarySchema) },
      system, messages: [{ role: 'user', content }],
    });
    // The SDK parses structured text before finalMessage resolves. A refusal or
    // truncated JSON can throw there, so preserve the raw terminal reason too.
    let terminalReason = null as string | null;
    stream.on('streamEvent', event => {
      if (event.type === 'message_delta' && event.delta.stop_reason) terminalReason = event.delta.stop_reason;
    });
    const msg = await stream.finalMessage().catch(error => {
      if (terminalReason === 'refusal' || terminalReason === 'max_tokens') return null;
      throw error;
    });
    if (!msg) {
      return res.status(terminalReason === 'refusal' ? 422 : 502).json({
        error: terminalReason === 'refusal' ? '모델이 요약 요청을 거절했습니다.' : '요약 응답이 길이 제한으로 중단되었습니다.',
      });
    }
    if (msg.stop_reason === 'refusal') return res.status(422).json({ error: '모델이 요약 요청을 거절했습니다.' });
    if (msg.stop_reason === 'max_tokens') return res.status(502).json({ error: '요약 응답이 길이 제한으로 중단되었습니다.' });
    if (msg.stop_reason !== 'end_turn') return res.status(502).json({ error: '요약 응답이 완료되지 않았습니다.' });
    const value = msg.parsed_output ?? JSON.parse(msg.content.filter(b => b.type === 'text').map(b => b.text).join(''));
    return res.status(200).json(mapResponse(value, parsed.data));
  } catch {
    // Never return SDK errors: they may contain private transcript/request data.
    return res.status(502).json({ error: '요약 응답을 생성하거나 검증하지 못했습니다. 다시 시도해 주세요.' });
  }
}
