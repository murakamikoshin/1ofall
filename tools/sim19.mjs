/** 「決断」になっている部屋がどれだけあるかを数える */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `c19-${process.pid}.mjs`);
await build({ stdin: { contents: `export * from './src/core/casting';
  export * from './src/core/hint-writer'; export * from './src/core/limits';
  export * from './src/core/rng'; export { setLocale } from './src/i18n';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const { castSpeakers, castLiars, dealKnowledge, writeHint, voiceOf, liarBias, createRng, RUN, setLocale } =
  await import(pathToFileURL(out).href);
setLocale('ja');
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));
const rng = createRng(55);
const ADV = Array.from({ length: 12 }, (_, i) => ({ id: `ai_${i}`, name: `a${i}`, kind: 'ai' }));

console.log('助言の中で、一番名前が挙がった選択肢がどれだけ突出しているか\n');
console.log('区画   独走(2票差以上)  僅差(1票差)  同点   独走時の的中率');
RUN.slotsBySection.forEach((slots, i) => {
  const mix = RUN.knowledgeBySection[i];
  let runaway = 0, close = 0, tie = 0, runawayHit = 0;
  const N = 30000;
  for (let k = 0; k < N; k++) {
    const room = pack.rooms[Math.floor(rng() * pack.rooms.length)];
    const speakerIds = castSpeakers({ advisors: ADV, slots, mode: 'lottery', rng });
    const liarIds = castLiars(speakerIds, rng);
    const kn = dealKnowledge(room.choices, room.correct, { speakerIds, liarIds }, rng, mix);
    const counts = new Map(room.choices.map((c) => [c.id, 0]));
    for (const id of speakerIds) {
      const text = writeHint({ choices: room.choices, knowledge: kn.get(id), rng,
        liarHonestyRate: 0.55 - Math.min(0.4, liarBias(id) * 0.16), voice: voiceOf(id) });
      for (const c of room.choices) if (text.includes(c.label.ja)) counts.set(c.id, counts.get(c.id) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const gap = sorted[0][1] - (sorted[1]?.[1] ?? 0);
    if (gap >= 2) { runaway++; if (sorted[0][0] === room.correct) runawayHit++; }
    else if (gap === 1) close++;
    else tie++;
  }
  console.log(
    `区画${i + 1}   ${(runaway / N * 100).toFixed(0).padStart(3)}%          ` +
    `${(close / N * 100).toFixed(0).padStart(3)}%       ${(tie / N * 100).toFixed(0).padStart(3)}%    ` +
    `${(runawayHit / runaway * 100).toFixed(0)}%`
  );
});
