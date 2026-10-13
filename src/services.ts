// Single wiring point. Each module's index resolves per platform
// (index.ts = web/tsc default, index.native.ts = iOS/Android).
export { store } from './store';
export { recorder } from './recorder';
export { engine } from './transcriber';
export { sync, supabase } from './sync';
export { pipeline } from './pipeline';
