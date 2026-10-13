import { useCallback, useRef, useState } from 'react';
export function useTask() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = useCallback(async (action: () => Promise<unknown>, message = '작업을 완료하지 못했어요. 다시 시도해 주세요.') => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await action(); } catch { setError(message); }
    finally { lock.current = false; setBusy(false); }
  }, []);
  return { busy, error, setError, run };
}
