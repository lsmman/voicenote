/** Late completion is ignored; engines/services do not expose cancellation. */
export async function withTimeout<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
