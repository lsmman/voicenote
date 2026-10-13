import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './index';

export async function signInWithEmail(email: string) {
  const emailRedirectTo = Platform.OS === 'web' ? window.location.origin : Linking.createURL('/');
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } });
  if (error) throw error;
}

export async function handleAuthRedirect(url: string) {
  const parsed = new URL(url);
  const params = new URLSearchParams(parsed.search);
  new URLSearchParams(parsed.hash.slice(1)).forEach((value, key) => params.set(key, value));
  if (params.has('error') || params.has('error_description')) throw new Error('로그인 링크가 만료되었거나 유효하지 않습니다.');
  const code = params.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return;
  }
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw error;
  } else if (access_token || refresh_token) {
    throw new Error('로그인 링크에 필요한 토큰이 없습니다.');
  }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function useSession(): Session | null {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    let active = true;
    let changed = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      changed = true;
      if (active) setSession(next);
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (active && !changed) setSession(error ? null : data.session);
    }).catch(() => { if (active && !changed) setSession(null); });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  return session;
}
