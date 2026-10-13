// Web E2E probe for voicenote. Usage:
//   PW=<path to playwright module> node e2e/run.mjs <phase> [...]
// phases: boot | record | model | import | dump
// Env: BASE (default http://localhost:8099), OUT (screenshot dir), WAV, M4A, PROFILE (persistent user data dir)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW);
const BASE = process.env.BASE ?? 'http://localhost:8099';
const OUT = process.env.OUT;
const WAV = process.env.WAV;
const PROFILE = process.env.PROFILE ?? path.join(OUT, 'profile');
fs.mkdirSync(OUT, { recursive: true });
const phases = process.argv.slice(2);
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  viewport: { width: 1000, height: 900 },
  permissions: ['microphone'],
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${WAV}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});
await context.addInitScript(() => {
  const Native = window.Worker;
  window.Worker = class extends Native {
    constructor(...a) {
      super(...a);
      this.addEventListener('message', ({ data }) => {
        if (data?.kind === 'progress') return;
        console.info(`[worker->page] id=${data?.id} kind=${data?.kind} ${data?.kind === 'error' ? data.message : `segments=${data?.segments?.length}`}`);
      });
      this.addEventListener('error', e => console.error(`[worker error] ${e.message}`));
    }
    postMessage(msg, t) {
      console.info(`[page->worker] id=${msg?.id} kind=${msg?.kind} ${msg?.audio ? `samples=${msg.audio.length}` : ''}`);
      return super.postMessage(msg, t);
    }
  };
});
const page = context.pages()[0] ?? await context.newPage();
const consoleLines = [];
page.on('console', m => { if (m.text().startsWith('[worker') || m.text().startsWith('[page->')) log(m.text()); if (['error', 'warning'].includes(m.type()) || m.text().startsWith('[worker') || m.text().startsWith('[page->')) consoleLines.push(`[${m.type()}] ${m.text()}`); });
page.on('worker', w => { log('worker started', w.url()); w.on('close', () => log('worker closed', w.url())); });
page.on('requestfailed', r => consoleLines.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
page.on('pageerror', e => consoleLines.push(`[pageerror] ${e.message}`));
page.on('dialog', d => { log('dialog:', d.message()); void d.accept(); });
const shot = async name => { const p = path.join(OUT, `${name}.png`); await page.screenshot({ path: p, fullPage: true }); log('screenshot', p); };

async function idb() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('voicenote');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const names = [...db.objectStoreNames];
      if (!names.length) { resolve({ empty: true }); return; }
      const tx = db.transaction(names);
      const out = {};
      let left = names.length;
      for (const n of names) {
        const r = tx.objectStore(n).getAll();
        r.onsuccess = () => {
          out[n] = n === 'audio' ? r.result.map(b => ({ size: b.size, type: b.type })) : r.result;
          if (--left === 0) { db.close(); resolve(out); }
        };
      }
    };
  }));
}
const summarize = d => d.empty ? 'IDB empty' : ({
  notes: d.notes.map(n => `${n.id.slice(0, 8)} "${n.title}" ${n.status} ${n.durationMs}ms model=${n.modelName}`),
  chunks: d.chunks.map(c => `${c.noteId.slice(0, 8)}#${c.seq} start=${c.startMs} dur=${c.durationMs} ${c.mimeType} tx=${!!c.transcribedAt}`),
  audio: d.audio, memos: d.memos.map(m => `${m.noteId.slice(0, 8)} @${m.atMs} ${m.kind} "${m.text}"`),
  segments: d.segments.length, gaps: d.notes.map(n => JSON.stringify(n.gaps)),
});

async function boot() {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 180_000 }).catch(e => log('goto', e.message));
  await sleep(5000);
  await shot('01-boot');
  const body = await page.locator('body').innerText();
  log('BODY:', body.slice(0, 800));
  return body;
}

async function record() {
  await boot();
  await page.getByText('●  녹음').click();
  await sleep(4000);
  await shot('02-recording-start');
  const t0 = Date.now();
  const timeline = [];
  const probe = async label => {
    const d = await idb();
    const vis = await page.evaluate(() => `${document.visibilityState}/${document.hidden}`);
    const elapsed = await page.getByLabel('녹음 시간').innerText().catch(() => '?');
    const row = { t: Math.round((Date.now() - t0) / 1000), label, vis, elapsed, chunks: d.chunks?.length, audio: d.audio?.length };
    timeline.push(row); log(JSON.stringify(row));
  };
  await page.getByLabel('녹음 중 메모').fill('E2E 테스트 메모');
  await page.getByText('메모 추가').click();
  await sleep(1500);
  await probe('after-memo');
  await sleep(8000);
  // Background the tab for 40s: real tab switch (other page in front) + forced visibility override.
  const other = await context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('blur'));
  });
  await probe('hidden-start');
  for (let i = 0; i < 4; i++) { await sleep(10_000); await probe('hidden'); }
  await page.evaluate(() => {
    delete document.visibilityState; delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.bringToFront();
  await other.close();
  await probe('visible-again');
  while (Date.now() - t0 < 80_000) await sleep(2000);
  await probe('before-stop');
  await shot('03-recording-before-stop');
  await page.getByText('녹음 종료', { exact: true }).click();
  await page.waitForURL(/\/note\//, { timeout: 30_000 }).catch(e => log('no note nav', e.message));
  await sleep(5000);
  await shot('04-note-detail');
  log('NOTE BODY:', (await page.locator('body').innerText()).slice(0, 1500));
  log('IDB:', JSON.stringify(summarize(await idb()), null, 1));
  fs.writeFileSync(path.join(OUT, 'record-timeline.json'), JSON.stringify(timeline, null, 1));
}

async function model() {
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle', timeout: 180_000 });
  await sleep(3000);
  const card = page.locator('div').filter({ hasText: /^Whisper Base/ }).last();
  await shot('05-settings');
  const baseCard = page.getByText('Whisper Base', { exact: true }).locator('xpath=..');
  await baseCard.getByText('선택', { exact: true }).click().catch(e => log('select', e.message));
  await sleep(1000);
  const dl = baseCard.getByText('다운로드', { exact: true });
  if (await dl.count()) {
    await dl.click();
    const t0 = Date.now();
    while (Date.now() - t0 < 15 * 60_000) {
      await sleep(10_000);
      const txt = await baseCard.innerText();
      log('settings card:', txt.replace(/\n/g, ' | '));
      if (txt.includes('준비 완료')) break;
      const err = await page.locator('body').innerText();
      if (err.includes('실패')) { log('download error visible'); break; }
    }
  }
  await shot('06-settings-after-download');
  log('webgpu:', await page.evaluate(async () => !!(navigator.gpu && await navigator.gpu.requestAdapter().catch(() => null))));
  void card;
}

async function waitSegments(noteFilter, label, maxMs = Number(process.env.WAIT_MS ?? 15 * 60_000)) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const d = await idb();
    const notes = d.notes.filter(noteFilter);
    const info = notes.map(n => ({ id: n.id.slice(0, 8), status: n.status, segs: d.segments.filter(s => s.noteId === n.id).length, chunks: d.chunks.filter(c => c.noteId === n.id).map(c => !!c.transcribedAt) }));
    log(label, JSON.stringify(info));
    if (notes.length && notes.every(n => !['recording', 'transcribing'].includes(n.status))) return d;
    await sleep(15_000);
  }
  return idb();
}

async function transcribeRecorded() {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 180_000 });
  const d = await waitSegments(() => true, 'all');
  dumpTranscripts(d, 'recorded');
}

async function importFile() {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 180_000 });
  await sleep(3000);
  const chooser = page.waitForEvent('filechooser', { timeout: 15_000 });
  await page.getByText('파일 가져오기').click();
  await (await chooser).setFiles(process.env.IMPORT_FILE);
  await page.waitForURL(/\/note\//, { timeout: 30_000 }).catch(e => log('no nav after import', e.message));
  await sleep(3000);
  await shot('07-import-note');
  const base = path.basename(process.env.IMPORT_FILE);
  const d = await waitSegments(n => n.title === base, 'import');
  await sleep(5000);
  await shot('08-import-note-done');
  dumpTranscripts(d, 'import');
}

function dumpTranscripts(d, label) {
  for (const n of d.notes) {
    const segs = d.segments.filter(s => s.noteId === n.id).sort((a, b) => a.startMs - b.startMs);
    const text = segs.map(s => s.text).join(' ');
    log(`TRANSCRIPT[${label}] ${n.title} status=${n.status} segs=${segs.length}:`, text);
    fs.writeFileSync(path.join(OUT, `transcript-${n.id.slice(0, 8)}.txt`), text);
  }
}

try {
  for (const p of phases) {
    log('=== phase', p);
    if (p === 'boot') await boot();
    else if (p === 'record') await record();
    else if (p === 'model') await model();
    else if (p === 'transcribe') await transcribeRecorded();
    else if (p === 'import') await importFile();
    else if (p === 'dump') { await page.goto(BASE, { waitUntil: 'networkidle' }); log(JSON.stringify(summarize(await idb()), null, 1)); dumpTranscripts(await idb(), 'dump'); }
    else if (p === 'decode') {
      await page.goto(BASE, { waitUntil: 'networkidle' });
      const r = await page.evaluate(async () => {
        const db = await new Promise((res, rej) => { const q = indexedDB.open('voicenote'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
        const get = (store, key) => new Promise((res, rej) => { const q = db.transaction(store).objectStore(store).get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
        const all = store => new Promise((res, rej) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
        const out = [];
        for (const c of await all('chunks')) {
          const blob = await get('audio', c.localPath);
          const ctx = new AudioContext({ sampleRate: 16000 });
          try { const b = await ctx.decodeAudioData(await blob.arrayBuffer()); out.push(`${c.localPath} ${c.mimeType} blob=${blob.type}/${blob.size} OK ${b.duration.toFixed(1)}s ${b.sampleRate}Hz`); }
          catch (e) { out.push(`${c.localPath} ${c.mimeType} blob=${blob?.type}/${blob?.size} DECODE FAIL ${e.name}: ${e.message}`); }
          finally { await ctx.close(); }
        }
        out.push('canPlay mp4/aac=' + document.createElement('audio').canPlayType('audio/mp4; codecs="mp4a.40.2"'));
        return out;
      });
      log('DECODE', r.join('\n'));
    }
    else if (p === 'detail') {
      await page.goto(BASE, { waitUntil: 'networkidle' });
      const d = await idb();
      for (const n of d.notes) { await page.goto(`${BASE}/note/${n.id}`, { waitUntil: 'networkidle' }); await sleep(4000); await page.getByText('전사문', { exact: true }).click().catch(() => {}); await sleep(1000); await shot(`09-detail-${n.id.slice(0, 8)}`); log('DETAIL', n.title, (await page.locator('body').innerText()).slice(0, 1200)); }
    }
  }
} catch (e) {
  log('FAILED:', e.stack);
  await shot('zz-failure').catch(() => {});
} finally {
  log('CONSOLE errors/warnings:\n' + [...new Set(consoleLines)].join('\n'));
  await context.close();
}
