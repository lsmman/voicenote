import { supabase } from './index';

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}
export async function createApiToken(name: string): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed || Array.from(trimmed).length > 60) throw new Error('Invalid token name');
  const { data, error } = await supabase.rpc('create_api_token', { p_name: trimmed });
  if (error) throw error;
  if (typeof data !== 'string' || !data.startsWith('vn_')) throw new Error('Invalid token response');
  return data;
}
export async function listApiTokens(): Promise<ApiToken[]> {
  const { data, error } = await supabase.from('api_tokens')
    .select('id,name,prefix,created_at,last_used_at').order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
export async function revokeApiToken(id: string): Promise<void> {
  const { error } = await supabase.from('api_tokens').delete().eq('id', id);
  if (error) throw error;
}
