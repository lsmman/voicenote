import { useEffect, useState } from 'react';
import { pipeline } from '../services';
import type { ModelState } from '../pipeline/types';

export function useModelState() {
  const [state, setState] = useState<ModelState | null>(null);
  useEffect(() => pipeline.onModelState(setState), []);
  return state;
}
