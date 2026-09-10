/**
 * 人を指す助言（「あいつは嘘だ」）が、情報なのか雑音なのかを測る。
 *
 * 7回目に枠外の集計を捨てたときと同じ物差しを当てる。
 * 「指された相手が本当に嘘つきである割合」が当てずっぽうと変わらないなら、
 * それは深みではなく雑音なので入れない。
 *
 *   node tools/name-call.mjs [rate] [seeds]
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `nc-${process.pid}-${Date.now()}.mjs`);
await build({ stdin: { contents: `export * from './src/core/casting';
  export * from './src/core/hint-writer'; export * from './src/core/limits';
  export * from './src/core/name-calling';
  export * from './src/core/rng'; export { setLocale, strings, localized } from './src/i18n';`,
  resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const C = await import(pathToFileURL(out).href);
C.setLocale('ja');
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));

const RATE = Number(process.argv[2] ?? 0.3);
const SEEDS = Number(process.argv[3] ?? 6);
const ADV = Array.from({ length: 12 }, (_, i) => ({ id: `ai_${i}`, name: `名${i}`, kind: 'ai' }));
const nameOf = (id) => ADV.find((a) => a.id === id).name;
const AVOID = C.strings().hints.avoidPattern;

const MODES = {
  通常: { slots: 8, brink: false, honesty: C.MODES.standard.liarHonesty, mimic: C.MODES.standard.liarMimic },
  崖っぷち: { slots: 4, brink: true, honesty: C.MODES.brink.liarHonesty, mimic: C.MODES.brink.liarMimic },
};

for (const [label, mode] of Object.entries(MODES)) {
  const acc = {
    doubts: 0, doubtLiar: 0, backs: 0, backLiar: 0,
    byRole: {}, hiTrust: 0, hiTrustLiar: 0, loTrust: 0, loTrustLiar: 0,
    doubtOnCorrect: 0, doubtRooms: 0, rooms: 0, hints: 0, calls: 0,
    // 何人から撃たれたかごとに、その人が嘘つきだった／正解を口にしていた割合。
    // 嘘つきは全員が同じ正解を知っているので、真実を口にした者に群がるはず
    byHits: new Map(),
    // 記録（正n 嘘n）が嘘つきと協力者をどれだけ分けるか。
    // このゲームは「記録を積んで読む」を中心に置いているので、
    // ここが分かれていないと看板だけになる
    trustByRole: { liar: [], honest: [] },
  };

  for (let seed = 0; seed < SEEDS; seed++) {
    const rng = C.createRng(4000 + seed * 977);
    for (let section = 0; section < 4; section++) {
      const speakerIds = C.castSpeakers({ advisors: ADV, slots: mode.slots, mode: 'lottery', rng });
      const liarIds = mode.brink
        ? speakerIds.filter((_, i) => i !== Math.floor(rng() * speakerIds.length))
        : C.castLiars(speakerIds, rng);
      const mix = C.RUN.knowledgeBySection[section];
      const rec = new Map();

      for (let r = 0; r < 6; r++) {
        const room = pack.rooms[Math.floor(rng() * pack.rooms.length)];
        const kn = C.dealKnowledge(room.choices, room.correct, { speakerIds, liarIds }, rng, mix, mode.brink, false);
        const labels = room.choices.map((c) => ({ id: c.id, label: C.localized(c.label) }));
        // 扉について言う口。ここでは人を指さない
        const said = [];
        for (const id of speakerIds) {
          const text = C.writeHint({
            choices: room.choices, knowledge: kn.get(id), rng,
            liarHonestyRate: Math.max(0.05, Math.min(0.5, mode.honesty * C.liarBias(id))),
            liarMimicRate: mode.mimic, voice: C.voiceOf(id),
          });
          said.push({ id, name: nameOf(id), text });
        }
        // 人を指す口。別なので扉の情報は減らない（本体と同じ形）
        const shapes = C.strings().hints;
        for (const id of speakerIds) {
          if (rng() >= RATE) continue;
          const call = C.chooseCall(kn.get(id), room.choices, said.filter((x) => x.id !== id), rng);
          if (!call) continue;
          const forms = call.doubt ? shapes.doubt : shapes.back;
          const form = forms[Math.floor(rng() * forms.length)];
          said.push({ id, name: nameOf(id), text: form(call.name), kind: 'call' });
        }
        acc.rooms++;
        acc.hints += said.filter((x) => x.kind !== 'call').length;

        const people = said.filter((s) => s.kind !== 'call').map((s) => ({ id: s.id, name: s.name }));
        const hitsOn = new Map();
        let doubtedCorrectHere = false;
        for (const s of said) {
          if (labels.some((c) => s.text.includes(c.label))) continue;
          const call = C.readCall(s.text, people);
          if (!call) continue;
          acc.calls++;
          const targetIsLiar = liarIds.includes(call.targetId);
          const role = kn.get(s.id)?.kind ?? '?';
          acc.byRole[role] ??= { doubt: 0, doubtLiar: 0 };
          const x = rec.get(s.id) ?? { hit: 0, miss: 0 };
          const t = (x.hit + 1) / (x.hit + x.miss + 2);
          if (call.doubt) {
            hitsOn.set(call.targetId, (hitsOn.get(call.targetId) ?? 0) + 1);
            acc.doubts++;
            if (targetIsLiar) acc.doubtLiar++;
            acc.byRole[role].doubt++;
            if (targetIsLiar) acc.byRole[role].doubtLiar++;
            if (t >= 0.5) { acc.hiTrust++; if (targetIsLiar) acc.hiTrustLiar++; }
            else { acc.loTrust++; if (targetIsLiar) acc.loTrustLiar++; }
            // 指された相手が正解を押していたか（＝真実を撃たれたか）
            const tgt = said.find((s2) => s2.id === call.targetId);
            const cl = labels.find((c) => c.id === room.correct).label;
            if (tgt && tgt.text.includes(cl) && !AVOID.test(tgt.text)) doubtedCorrectHere = true;
          } else {
            acc.backs++;
            if (targetIsLiar) acc.backLiar++;
          }
        }
        if (doubtedCorrectHere) acc.doubtRooms++;

        // 撃たれた回数ごとの中身
        const cl0 = labels.find((c) => c.id === room.correct).label;
        for (const s2 of said.filter((x) => x.kind !== 'call')) {
          const k = hitsOn.get(s2.id) ?? 0;
          const b = acc.byHits.get(k) ?? { n: 0, liar: 0, correct: 0 };
          b.n++;
          if (liarIds.includes(s2.id)) b.liar++;
          if (s2.text.includes(cl0) && !AVOID.test(s2.text)) b.correct++;
          acc.byHits.set(k, b);
        }

        // 部屋を重ねたあとの記録を、立場ごとに集める
        if (r >= 3) {
          for (const id of speakerIds) {
            const x = rec.get(id) ?? { hit: 0, miss: 0 };
            if (x.hit + x.miss === 0) continue;
            const t = (x.hit + 1) / (x.hit + x.miss + 2);
            (liarIds.includes(id) ? acc.trustByRole.liar : acc.trustByRole.honest).push(t);
          }
        }

        const cl = labels.find((c) => c.id === room.correct).label;
        const truth = C.resolveTruth(said, (text) => {
          const mc = text.includes(cl);
          const mw = labels.some((c) => c.label !== cl && text.includes(c.label));
          return AVOID.test(text) ? !mc && mw : mc;
        }, room.choices);
        for (const { id, truthful: ok } of truth) {
          const x = rec.get(id) ?? { hit: 0, miss: 0 };
          ok ? x.hit++ : x.miss++;
          rec.set(id, x);
        }
      }
    }
  }

  const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
  const liarShare = mode.brink ? (mode.slots - 1) / mode.slots : C.liarCountFor(mode.slots) / mode.slots;
  console.log(`\n【${label}】  指す率 ${RATE}　${acc.rooms}部屋　扉について${acc.hints}件　名指し${acc.calls}件`);
  console.log(`  疑いが嘘つきに当たった率        ${pct(acc.doubtLiar, acc.doubts)}   （でたらめに指すと ${(liarShare * 100).toFixed(1)}%）`);
  console.log(`  庇った相手が嘘つきだった率       ${pct(acc.backLiar, acc.backs)}`);
  console.log(`  信用のある者の疑いの当たり率      ${pct(acc.hiTrustLiar, acc.hiTrust)}   （${acc.hiTrust}件）`);
  console.log(`  信用の無い者の疑いの当たり率      ${pct(acc.loTrustLiar, acc.loTrust)}   （${acc.loTrust}件）`);
  console.log(`  正解を口にした者が撃たれた部屋     ${pct(acc.doubtRooms, acc.rooms)}`);
  console.log('  撃たれた回数ごとの中身');
  for (const k of [...acc.byHits.keys()].sort((a, b) => a - b)) {
    const b = acc.byHits.get(k);
    console.log(`    ${k}回撃たれた者  ${String(b.n).padStart(5)}人　嘘つき ${pct(b.liar, b.n)}　正解を口にしていた ${pct(b.correct, b.n)}`);
  }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const sd = (a) => {
    const m = mean(a);
    return a.length ? Math.sqrt(mean(a.map((x) => (x - m) ** 2))) : 0;
  };
  const lm = mean(acc.trustByRole.liar), hm = mean(acc.trustByRole.honest);
  const pooled = Math.sqrt((sd(acc.trustByRole.liar) ** 2 + sd(acc.trustByRole.honest) ** 2) / 2);
  console.log(`  記録から見た信用（4部屋目以降）`);
  console.log(`    嘘つき  ${lm.toFixed(3)}　協力者 ${hm.toFixed(3)}　差 ${(hm - lm).toFixed(3)}`);
  console.log(`    分かれ具合（差 ÷ ばらつき）  ${pooled ? ((hm - lm) / pooled).toFixed(2) : '—'}`);
  for (const [role, v] of Object.entries(acc.byRole)) {
    console.log(`    ${role.padEnd(8)} 疑い${String(v.doubt).padStart(4)}件　当たり ${pct(v.doubtLiar, v.doubt)}`);
  }
}
