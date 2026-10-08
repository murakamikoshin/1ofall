/**
 * 区画の一部屋目だけを測る。
 *
 * 一部屋目は記録（正n 嘘n）が白紙で、しかも区画の頭では嘘つきもまだ
 * 本当のことを言っている（`liarHonestyAt`）。つまり**読むほど損をする部屋**で、
 * 崖っぷちでは数えるだけに勝つ読み方が一つも無かった
 * （`tools/arc-probe.mjs`：読める 39.0% / 数えるだけ 60.6%）。
 *
 * ここで何を読ませられるかを、打ち手を並べて測る。本体のエンジンで回すので、
 * 黙らせる（崖っぷちの道具）も実装どおりに効く。
 *
 *   node tools/first-room-probe.mjs [周回数]
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `first-${process.pid}.mjs`);
await build({ stdin: { contents: `
  export { GameEngine } from './src/core/engine';
  export { AiAdvisorGateway } from './src/core/ai-advisors';
  export { corePackage } from './src/core/pack';
  export { MODES } from './src/core/limits';
  export { trustOf } from './src/core/read-hints';
  export { readCall } from './src/core/name-calling';
  export { setLocale, strings, localized } from './src/i18n';
  export { createRng } from './src/core/rng';
`, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const C = await import(pathToFileURL(out).href);
C.setLocale('ja');
const RUNS = Number(process.argv[2] ?? 400);
const tick = () => new Promise((r) => setTimeout(r, 0));
const AVOID = C.strings().hints.avoidPattern;
const HEDGE = C.strings().hints.hedgePattern;

/** 扉について何を言ったか。選択肢の名前を外してから言い回しを見る */
function claimOf(text, choices) {
  const touched = choices.filter((c) => text.includes(C.localized(c.label)));
  if (touched.length === 0) return null;
  let rest = text;
  for (const c of touched) rest = rest.split(C.localized(c.label)).join('　');
  return { ids: touched.map((c) => c.id), avoid: AVOID.test(rest), hedge: touched.length >= 2 || HEDGE.test(rest) };
}

const pickTop = (score, choices, rng) => {
  const m = Math.max(...score.values());
  const top = choices.filter((c) => score.get(c.id) === m);
  return top[Math.floor(rng() * top.length)].id;
};

/**
 * 打ち手。どれも一部屋目の盤面だけを見る。
 * `silence(id)` を呼べるのは崖っぷちだけ（戻り値で嘘つきかどうかが分かる）。
 */
const PLAYERS = {
  当てずっぽう: ({ choices, rng }) => choices[Math.floor(rng() * choices.length)].id,
  数えるだけ: ({ choices, rows, rng }) => {
    const s = new Map(choices.map((c) => [c.id, 0]));
    for (const r of rows) {
      const cl = claimOf(r.text, choices);
      if (!cl) continue;
      for (const id of cl.ids) s.set(id, s.get(id) + (cl.avoid ? -1 : 1));
    }
    return pickTop(s, choices, rng);
  },
  迷いを信じる: ({ choices, rows, rng }) => {
    const s = new Map(choices.map((c) => [c.id, 0]));
    for (const r of rows) {
      const cl = claimOf(r.text, choices);
      if (!cl) continue;
      if (cl.avoid) { for (const id of cl.ids) s.set(id, s.get(id) - 1.2); continue; }
      for (const id of cl.ids) s.set(id, s.get(id) + (cl.hedge ? 1.25 : 0.8));
    }
    return pickTop(s, choices, rng);
  },
  撃たれた者を疑う: ({ choices, rows, calls, rng }) => {
    const shot = new Map();
    for (const c of calls) if (c.doubt) shot.set(c.to, (shot.get(c.to) ?? 0) + 1);
    const s = new Map(choices.map((c) => [c.id, 0]));
    for (const r of rows) {
      const cl = claimOf(r.text, choices);
      if (!cl) continue;
      const w = Math.max(0.2, 1 - (shot.get(r.id) ?? 0) * 0.9);
      for (const id of cl.ids) s.set(id, s.get(id) + (cl.avoid ? -w * 1.2 : w));
    }
    return pickTop(s, choices, rng);
  },
  /*
   * 黙らせて確かめる（崖っぷちだけ）。
   *
   * 一部屋目は記録が無いので的を選べない。4席のうち3人が嘘つきなので、
   * 当てずっぽうでも**75%は嘘つきに当たる**。そして区画の頭の嘘つきは
   * 7割は本当のことを言っている（liarHonestyAt の HONEST_BEFORE）ので、
   * **確定した嘘つきが押した扉は、むしろ良い賭け**になるはず——という読み。
   */
  黙らせて確定した者に乗る: ({ choices, rows, rng, silence }) => {
    const s = new Map(choices.map((c) => [c.id, 0]));
    const target = rows[Math.floor(rng() * rows.length)];
    const res = target && silence ? silence(target.id) : null;
    for (const r of rows) {
      const cl = claimOf(r.text, choices);
      if (!cl) continue;
      // 確定した嘘つきの一言を厚く見る（区画の頭では本当のことを言いがち）
      const w = res && res.hit && r.id === target.id ? 2.2 : 1;
      for (const id of cl.ids) s.set(id, s.get(id) + (cl.avoid ? -w * 1.2 : w));
    }
    return pickTop(s, choices, rng);
  },
  /*
   * 対照：**黙らせずに**誰か一人の一言を外す。
   * 「確定した」が効いているのか、「一言減らす」だけで効くのかを分ける。
   */
  誰か一人の一言を外す: ({ choices, rows, rng }) => {
    const drop = rows[Math.floor(rng() * rows.length)];
    const s = new Map(choices.map((c) => [c.id, 0]));
    for (const r of rows) {
      if (drop && r.id === drop.id) continue;
      const cl = claimOf(r.text, choices);
      if (!cl) continue;
      for (const id of cl.ids) s.set(id, s.get(id) + (cl.avoid ? -1.2 : 1));
    }
    return pickTop(s, choices, rng);
  },
  /*
   * 試した跡：**区画の一部屋目だけ挑戦者に三択の勘を配る**案（入れなかった）。
   *
   * `round.ownCandidates` に入っていれば読む。本体では全員挑戦者だけが配るので、
   * ほかのモードでは下の二つは上の二つと同じ結果になる（配列が空）。
   * 一度 `hunchFirstRoom` として実装して測った。
   *
   *   通常     迷いを信じる 73.5% → 勘を足して 74.4%（±2.5。差は揺れの中）
   *   崖っぷち 迷いを信じる 43.0% → 勘を足して 45.3%（±2.8。同じ）
   *   崖っぷち 踏破 20.5% → 52.0%（三択）/ 37.0%（四択）/ 30.5%（五択）
   *
   * **読みは増えず、踏破だけが跳ねた。** 床を上げるだけの仕掛けなので外した。
   */
  '自分の勘＋数える': ({ choices, rows, own, rng }) => {
    const s = new Map(choices.map((c) => [c.id, own.includes(c.id) ? 2.5 : 0]));
    for (const r of rows) {
      const cl = claimOf(r.text, choices);
      if (!cl) continue;
      for (const id of cl.ids) s.set(id, s.get(id) + (cl.avoid ? -1 : 1));
    }
    return pickTop(s, choices, rng);
  },
  '自分の勘＋迷いを信じる': ({ choices, rows, own, rng }) => {
    const s = new Map(choices.map((c) => [c.id, own.includes(c.id) ? 2.5 : 0]));
    for (const r of rows) {
      const cl = claimOf(r.text, choices);
      if (!cl) continue;
      if (cl.avoid) { for (const id of cl.ids) s.set(id, s.get(id) - 1.2); continue; }
      for (const id of cl.ids) s.set(id, s.get(id) + (cl.hedge ? 1.25 : 0.8));
    }
    return pickTop(s, choices, rng);
  },
  黙らせて確定した者を外す: ({ choices, rows, rng, silence }) => {
    const s = new Map(choices.map((c) => [c.id, 0]));
    const target = rows[Math.floor(rng() * rows.length)];
    const res = target && silence ? silence(target.id) : null;
    for (const r of rows) {
      if (res && res.hit && r.id === target.id) continue;
      const cl = claimOf(r.text, choices);
      if (!cl) continue;
      for (const id of cl.ids) s.set(id, s.get(id) + (cl.avoid ? -1.2 : 1));
    }
    return pickTop(s, choices, rng);
  },
};

/*
 * ONLY=... で打ち手を絞れる（`|` 区切り）。
 * 見張り（tools/test-balance.mjs）は三つだけを多い部屋数で回したいので、
 * 全部を薄く回すのではなく必要な列だけを厚く回す。
 */
const ONLY = (process.env.ONLY ?? '').split('|').filter((x) => x.length > 0);
const WANTED = Object.keys(PLAYERS).filter((k) => ONLY.length === 0 || ONLY.includes(k));
if (WANTED.length === 0) {
  console.error(`ONLY に知らない打ち手がある。使えるのは:\n  ${Object.keys(PLAYERS).join('\n  ')}`);
  process.exit(2);
}

for (const [label, modeName] of [['通常', 'standard'], ['崖っぷち', 'brink']]) {
  const mode = C.MODES[modeName];
  const hit = Object.fromEntries(Object.keys(PLAYERS).map((k) => [k, 0]));
  const n = Object.fromEntries(Object.keys(PLAYERS).map((k) => [k, 0]));
  for (const player of WANTED) {
    const rng = C.createRng(5150);
    let rooms = 0;
    for (let seed = 0; seed < RUNS && rooms < RUNS; seed++) {
      const engine = new C.GameEngine({
        pack: C.corePackage(), mode,
        gateway: new C.AiAdvisorGateway({ count: 12, mode, minDelayMs: 0, maxDelayMs: 0 }),
        seed: 20000 + seed,
      });
      engine.start();
      for (let guard = 0; guard < 300; guard++) {
        const st = engine.snapshot();
        if (st.phase === 'gameover' || st.phase === 'cleared') break;
        if (st.phase !== 'choosing' || !st.round) { engine.advancePresentation(); continue; }
        await tick();
        const round = engine.snapshot().round;
        if (!round) { engine.advancePresentation(); continue; }
        const first = (round.roomInSection ?? 0) === 0;
        const rows = round.advice
          .filter((a) => (a.kind ?? 'door') === 'door')
          .map((a) => ({ id: a.advisorId, text: a.text }));
        /*
         * 誰を指したかは**本体の `readCall` に読ませる。**
         * ここで言い回しを書き写すと、言い方を足した日に静かにずれる
         * （32回目に物差しが実装と違う遊びを測っていたのは、まさにこれ）。
         */
        const people = round.advice.map((a) => ({ id: a.advisorId, name: a.advisorName }));
        const calls = round.advice
          .filter((a) => a.kind === 'call')
          .map((a) => C.readCall(a.text, people))
          .filter((c) => c !== null)
          .map((c) => ({ to: c.targetId, doubt: c.doubt }));
        let choice;
        let counted = false;
        if (first && rows.length > 0) {
          const silence = mode.canSilence && !round.silenceUsed
            ? (id) => engine.silence(id)
            : null;
          choice = PLAYERS[player]({
            choices: round.room.choices, rows, calls, rng, silence,
            own: round.ownCandidates ?? [],
          });
          counted = true;
        } else {
          choice = PLAYERS['数えるだけ']({ choices: round.room.choices, rows, calls, rng, own: [] });
        }
        engine.choose(choice);
        // 正解は盤面に出ない（出したら読む意味が無い）ので、判定から数える
        const v = engine.snapshot().verdict;
        if (counted && v) { n[player]++; if (v.survived) hit[player]++; }
        rooms = n[player];
        for (let i = 0; i < 6; i++) engine.advancePresentation();
      }
    }
  }
  console.log(`\n【${label}】  区画の一部屋目だけを数えた（${n['数えるだけ']}部屋）`);
  for (const k of WANTED) {
    if (n[k] === 0) continue;
    const pct = (hit[k] / n[k]) * 100;
    const se = Math.sqrt((pct / 100) * (1 - pct / 100) / n[k]) * 100;
    console.log(`  ${k.padEnd(22, '　')} ${pct.toFixed(1)}%  ±${se.toFixed(1)}`);
  }
}
