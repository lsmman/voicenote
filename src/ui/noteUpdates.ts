import type { NoteStatus, Segment } from '../core/types';
export function segmentsChanged(before: Segment[], after: Segment[]): boolean {
  const a = before[before.length - 1]; const b = after[after.length - 1];
  return before.length !== after.length || a?.id !== b?.id || a?.text !== b?.text;
}
export function shouldPollNote(status?: NoteStatus): boolean {
  return !!status && status !== 'done' && status !== 'error';
}
