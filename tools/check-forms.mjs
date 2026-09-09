/** 助言の言い回しの内訳を言語ごとに数える */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `forms-${process.pid}.mjs`);
await build({ stdin: { contents: `export * from './src/core/casting';
  export * from './src/core/hint-writer'; export * from './src/core/limits';
  export * from './src/core/rng'; export * from './src/i18n';
  export { HINT_LIMIT_BY_LOCALE } from './src/i18n/locales';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const C = await import(pathToFileURL(out).href);
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));

for (const loc of ['ja', 'en']) {
  C.setLocale(loc);
  console.log(`\n[${loc}] 上限 ${C.HINT_LIMIT_BY_LOCALE[loc]} 文字`);
  const rng = C.createRng(4242);
  const ADV = Array.from({ length: 12 }, (_, i) => ({ id: `ai_${i}`, name: `a${i}`, kind: 'ai' }));
  const counts = { narrow: 0, push: 0, hedge: 0, avoid: 0, bare: 0 };
  let tooLong = 0, n = 0;
  const samples = [];
  for (let t = 0; t < 3000; t++) {
    const room = pack.rooms[Math.floor(rng() * pack.rooms.length)];
    const speakerIds = C.castSpeakers({ advisors: ADV, slots: 8, mode: 'lottery', rng });
    const liarIds = C.castLiars(speakerIds, rng);
    const kn = C.dealKnowledge(room.choices, room.correct, { speakerIds, liarIds }, rng, C.RUN.knowledgeBySection[0]);
    for (const id of speakerIds) {
      const text = C.writeHint({ choices: room.choices, knowledge: kn.get(id), rng,
        liarHonestyRate: 0.2, liarMimicRate: 0.25, voice: C.voiceOf(id) });
      n++;
      if ([...text].length > C.HINT_LIMIT_BY_LOCALE[loc]) tooLong++;
      const S = C.strings().hints;
      const labels = room.choices.map((c) => C.localized(c.label));
      const touched = labels.filter((l) => text.includes(l)).length;
      if (S.avoidPattern.test(text)) counts.avoid++;
      else if (touched >= 2) counts.narrow++;
      else if (S.hedgePattern.test(text)) counts.hedge++;
      else if (labels.some((l) => text !== l && text.includes(l))) counts.push++;
      else counts.bare++;
      if (samples.length < 6 && rng() < 0.02) samples.push(text);
    }
  }
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(7)} ${(v / n * 100).toFixed(1)}%`);
  console.log(`  上限超え ${(tooLong / n * 100).toFixed(2)}%`);
  console.log('  例: ' + samples.join(' / '));
}
