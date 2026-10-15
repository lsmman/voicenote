import { getLanguage, useLanguage } from './language';
import { ko, messages, type MessageKey } from './messages';

export type { MessageKey } from './messages';
type Placeholders<S extends string> = S extends `${string}{${infer Key}}${infer Rest}` ? Key | Placeholders<Rest> : never;
type Params<Key extends MessageKey> = [Placeholders<(typeof ko)[Key]>] extends [never]
  ? [params?: Record<string, string | number>]
  : [params: Record<Placeholders<(typeof ko)[Key]>, string | number>];

/** Translate at call time, including in asynchronous callbacks outside React. */
export function t<Key extends MessageKey>(key: Key, ...[params]: Params<Key>): string {
  const template: string = messages[getLanguage()][key];
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = (params as Record<string, string | number> | undefined)?.[name];
    return value === undefined ? placeholder : String(value);
  });
}

/** Subscribe to language changes while keeping callbacks that use t stable. */
export function useT(): typeof t {
  useLanguage();
  return t;
}
