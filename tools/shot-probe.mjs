/**
 * 「撃たれている者ほど本当のことを言っている」は、どの遊び方で、区画のどこで本当か。
 *
 * この向きは手引きに一行で書いてあり、AI の仲間の読み方（read-hints）も
 * この向きで重み付けしている。裏付けは tools/name-call.mjs の数字だったが、
 * あちらは**裏切りの段取りを入れていなかった**（区画の前半は嘘つきも本当のことを言い、
 * 誰を指すかも仲間と同じ側に立つ）。入れて測り直す。
 *
 *   node tools/shot-probe.mjs [種の数]
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `shot-${process.pid}.mjs`);
await build({ stdin: { contents: `export * from './src/core/casting';
  export * from './src/core/hint-writer'; export * from './src/core/limits';
  export * from './src/core/name-calling';
  export * from './src/core/rng'; export { setLocale, strings, localized } from './src/i18n';`,
  resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const C = await import(pathToFileURL(out).href);
C.setLocale('ja');
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));
const ADV = C.ADVISORS ?? Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, name: `名${i}` }));
const nameOf = (id) => ADV.find((a) => a.id === id)?.name ?? id;
const SEEDS = Number(process.argv[2] ?? 300);
const SCHEDULE = process.env.SCHED !== '0';

const MODES = {
  通常: { m: C.MODES.standard, slots: 8, brink: false, trapper: false, per: C.RUN.roomsPerSection },
  崖っぷち: { m: C.MODES.brink, slots: 4, brink: true, trapper: false, per: C.MODES.brink.roomsPerSection },
  全員挑戦者: { m: C.MODES.standard, slots: 6, brink: false, trapper: true, per: C.RUN.roomsPerSection },
};

for (const [label, mode] of Object.entries(MODES)) {
  const PER = mode.per;
  // 部屋番号 × 撃たれた回数（0 / 1回以上）ごとに「正解を口にしていた」割合
  const cell = Array.from({ length: PER }, () => ({
    no: { n: 0, said: 0 }, shot: { n: 0, said: 0 },
  }));
  for (let seed = 0; seed < SEEDS; seed++) {
    const rng = C.createRng(31000 + seed * 977);
    for (let section = 0; section < 4; section++) {
      const speakerIds = C.castSpeakers({ advisors: ADV, slots: mode.slots, mode: 'lottery', rng });
      const liarIds = mode.brink
        ? speakerIds.filter((_, i) => i !== Math.floor(rng() * speakerIds.length))
        : C.castLiars(speakerIds, rng);
      const mix = C.RUN.knowledgeBySection[section];
      for (let r = 0; r < PER; r++) {
        const room = pack.rooms[Math.floor(rng() * pack.rooms.length)];
        const kn = C.dealKnowledge(room.choices, room.correct, { speakerIds, liarIds }, rng, mix, mode.brink, mode.trapper);
        const honestNow = new Map(speakerIds.map((id) => [
          id, SCHEDULE ? rng() < C.liarHonestyAt(id, r, PER) : false,
        ]));
        const said = speakerIds.map((id) => ({ id, name: nameOf(id),
          text: C.writeHint({ choices: room.choices, knowledge: kn.get(id), rng,
            liarHonestyRate: Math.max(0.05, Math.min(0.5, mode.m.liarHonesty * C.liarBias(id))),
            liarMimicRate: mode.m.liarMimic, voice: C.voiceOf(id),
            liarHonest: honestNow.get(id) }) }));
        const shotAt = new Map();
        for (const id of speakerIds) {
          if (rng() >= mode.m.nameCall) continue;
          const acting = C.actingKnowledge(kn.get(id), honestNow.get(id) === true);
          const call = C.chooseCall(acting, room.choices, said.filter((x) => x.id !== id), rng);
          if (call && call.doubt) shotAt.set(call.id, (shotAt.get(call.id) ?? 0) + 1);
        }
        const correctLabel = C.localized(room.choices.find((c) => c.id === room.correct).label);
        for (const s of said) {
          // 「正解を口にしていた」＝正解の名前を出して、しかも避けろと言っていない
          const touched = room.choices.filter((c) => s.text.includes(C.localized(c.label)));
          let rest = s.text;
          for (const c of touched) rest = rest.split(C.localized(c.label)).join('　');
          const avoid = C.strings().hints.avoidPattern.test(rest);
          const named = s.text.includes(correctLabel) && !avoid;
          const box = (shotAt.get(s.id) ?? 0) > 0 ? cell[r].shot : cell[r].no;
          box.n++;
          if (named) box.said++;
        }
      }
    }
  }
  console.log(`\n【${label}】  ${SEEDS}種 × 4区画　裏切りの段取り ${SCHEDULE ? 'あり' : 'なし'}`);
  console.log('  部屋   撃たれていない者が正解を口にしていた   撃たれた者   差');
  for (const [i, c] of cell.entries()) {
    const a = c.no.n ? (c.no.said / c.no.n) * 100 : NaN;
    const b = c.shot.n ? (c.shot.said / c.shot.n) * 100 : NaN;
    const d = b - a;
    console.log(`   ${i + 1}      ${a.toFixed(1)}%（${String(c.no.n).padStart(5)}人）        ${b.toFixed(1)}%（${String(c.shot.n).padStart(4)}人）  ${d >= 0 ? '+' : ''}${d.toFixed(1)}pt`);
  }
}
