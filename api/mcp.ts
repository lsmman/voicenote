import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AuthFailure, dispatch, errorReply, object, rpc } from './_lib/mcpProtocol';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version, MCP-Session-Id');
  res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json(errorReply(null, -32600, 'Use POST.'));
  }
  const auth = req.headers.authorization;
  const token = typeof auth === 'string' ? /^Bearer\s+(vn_[A-Za-z0-9_-]+)$/i.exec(auth)?.[1] : undefined;
  const unauthorized = () => {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return res.status(401).json(errorReply(null, -32001, 'Missing or invalid API token.'));
  };
  if (!token) return unauthorized();
  // Authenticate even initialize, ping, unknown methods, and notifications.
  try { await rpc(token, 'mcp_list_notes', { p_query: null, p_limit: 0 }); }
  catch (error) {
    if (error instanceof AuthFailure) return unauthorized();
    return res.status(503).json(errorReply(null, -32603, 'Authentication service unavailable.'));
  }
  let body: unknown;
  try {
    body = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8')) : typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch { return res.status(400).json(errorReply(null, -32700, 'Parse error')); }
  const version = req.headers['mcp-protocol-version'];
  if (version !== undefined && version !== '2025-06-18' && version !== '2025-03-26') {
    return res.status(400).json(errorReply(object(body) ? body.id ?? null : null, -32600, 'Unsupported protocol version.'));
  }
  if (Array.isArray(body) && body.length === 0) return res.status(400).json(errorReply(null, -32600, 'Invalid Request'));
  try {
    const replies = [];
    // Sequential processing bounds database concurrency for batches.
    for (const message of Array.isArray(body) ? body : [body]) {
      const reply = await dispatch(token, message);
      if (reply) replies.push(reply);
    }
    if (!replies.length) return res.status(202).end();
    return res.status(200).json(Array.isArray(body) ? replies : replies[0]);
  } catch (error) {
    if (error instanceof AuthFailure) return unauthorized();
    return res.status(500).json(errorReply(null, -32603, 'Internal error'));
  }
}
