import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useSession as useAuthSession } from '../sync/auth';
import { supabase } from '../services';

type SessionState = { session: Session | null; loading: boolean };
function normalizeSession(value: SessionState | Session | null, loading: boolean): SessionState {
  return value && 'session' in value ? value : { session: value, loading };
}
// Task 5 currently returns Session|null. Keep this boundary compatible with
// the agreed {session, loading} API while its implementation is in progress.
export function useSession(): SessionState {
  const value: SessionState | Session | null = useAuthSession();
  const structured = value !== null && 'session' in value;
  const [legacyLoading, setLegacyLoading] = useState(true);
  useEffect(() => {
    if (structured) return;
    let active = true;
    void supabase.auth.getSession().then(() => { if (active) setLegacyLoading(false); }, () => { if (active) setLegacyLoading(false); });
    return () => { active = false; };
  }, [structured]);
  return normalizeSession(value, legacyLoading);
}
