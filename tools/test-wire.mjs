/**
 * 通信メッセージの型が、いまのゲームをそのまま運べるかの確認。
 *
 * 一番見たいのは「正解が挑戦者側へ流れないこと」。
 * 実物のエンジンを1周回し、サーバーが送るはずのメッセージを組み立てて、
 * 型を通してから中身を覗く。
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `wire-${process.pid}.mjs`);
await build({
  stdin: {
    contents: `
      export * from './src/core/schema';
      export * from './src/core/engine';
      export * from './src/core/limits';
      export * from './src/core/pack';
      export { AiAdvisorGateway } from './src/core/ai-advisors';
      export { setLocale } from './src/i18n';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
});
const C = await import(pathToFileURL(out).href);
C.setLocale('ja');

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`);
};

/* ── 1. 挑戦者へ送る round/open に正解が乗らない ───────────────── */

const seenKinds = new Set();
const problems = [];
let openCount = 0;

for (const modeId of C.MODE_IDS) {
 for (const seed of [20260909, 7, 12345]) {
  const mode = C.MODES[modeId];
  // 配られた知識と正解は gateway の先にしか無い。覗くために包む
  const inner = new C.AiAdvisorGateway({ count: 12, mode });
  let brief = null;
  const gateway = Object.create(inner);
  gateway.openRound = (b) => { brief = b; inner.openRound(b); };
  const engine = new C.GameEngine({ pack: C.corePackage(), mode, gateway, seed });

  const inspect = (state) => {
    const round = state.round;
    if (!round || state.phase !== 'choosing') return;

    // サーバーが挑戦者へ送るもの
    const toChallenger = {
      t: 'round/open',
      roundId: round.roundId,
      room: round.room,
      deadlineAt: round.deadlineAt,
      ...(round.ownCandidates?.length ? { ownCandidates: [...round.ownCandidates] } : {}),
      ...(round.restingIds?.length ? { restingIds: [...round.restingIds] } : {}),
    };
    const parsed = C.ServerMessageSchema.safeParse(toChallenger);
    if (!parsed.success) {
      problems.push(`${modeId} 挑戦者向け round/open が型を通らない: ${parsed.error.issues[0]?.message}`);
      return;
    }
    openCount++;
    const room = parsed.data.room;
    if ('correct' in room) problems.push(`${modeId} 挑戦者向けの部屋に correct が乗っている`);
    if ('deathMessage' in room) problems.push(`${modeId} 挑戦者向けの部屋に deathMessage が乗っている`);
    if ('knowledge' in parsed.data) problems.push(`${modeId} 挑戦者向けに knowledge が乗っている`);

    // サーバーが助言者ひとりひとりへ送るもの
    for (const advisor of state.advisors) {
      const k = brief?.knowledge?.get(advisor.id);
      if (!k) continue;
      seenKinds.add(k.kind);
      const toAdvisor = {
        t: 'round/open',
        roundId: round.roundId,
        room: round.room,
        deadlineAt: round.deadlineAt,
        knowledge: k,
        isSpeaker: round.speakers.some((s) => s.id === advisor.id),
      };
      const r = C.ServerMessageSchema.safeParse(toAdvisor);
      if (!r.success) problems.push(`${modeId} 助言者向け round/open が型を通らない (${k.kind}): ${r.error.issues[0]?.message}`);
    }
  };

  const unsub = engine.subscribe(inspect);
  engine.start();
  for (let i = 0; i < 200; i++) {
    const s = engine.snapshot();
    if (s.phase === 'gameover' || s.phase === 'cleared') break;
    if (s.phase === 'choosing' && s.round) {
      // 正解を選んで深くまで進める。浅い部屋だけ見ても検査にならない
      engine.choose(brief?.room?.correct ?? s.round.room.choices[0]?.id ?? '');
      for (let g = 0; g < 4; g++) engine.advancePresentation();
    } else {
      engine.advancePresentation();
    }
  }
  unsub();
  engine.dispose();
 }
}

check(`round/open を ${openCount} 通ぶん検査した`, openCount >= 90, `${openCount}通`);
check(
  `4種類の知識がすべて実物に出た（${[...seenKinds].sort().join(' ')}）`,
  seenKinds.size === 4,
  `出たのは ${[...seenKinds].join(' ') || 'なし'}`,
);
for (const p of problems) check(p, false);
if (problems.length === 0) check('正解も死亡文も挑戦者側へ流れない', true);

/* ── 2. 4種類の知識がすべて型を通る ─────────────────────────── */

for (const sample of [
  { kind: 'liar', correct: 'a', trap: 'b' },
  { kind: 'honest', candidates: ['a', 'b'] },
  { kind: 'honest', candidates: ['a', 'b', 'c'] },
  { kind: 'doomed', doomed: 'b' },
  { kind: 'trapper', trap: 'b' },
]) {
  const r = C.KnowledgeSchema.safeParse(sample);
  check(`知識 ${sample.kind}${sample.candidates ? sample.candidates.length : ''} が通る`, r.success, r.error?.issues[0]?.message ?? '');
}

/* ── 3. 信用できない側（クライアント→サーバー）を弾く ──────────── */

const bad = [
  ['未知の種別', { t: 'advisor/nuke' }],
  ['助言が長すぎる', { t: 'advisor/hint', text: 'あ'.repeat(500), roundId: 'r1' }],
  ['合言葉の桁が違う', { t: 'advisor/join', roomCode: 'AB' }],
  ['名前が空', { t: 'advisor/join', roomCode: 'ABC123', name: '' }],
  ['発言枠が範囲外', { t: 'challenger/setSpeakerSlots', slots: 9999 }],
  ['発言枠が小数', { t: 'challenger/setSpeakerSlots', slots: 3.5 }],
  ['モードが未知', { t: 'challenger/start', mode: 'godmode' }],
  ['選んだ扉が空', { t: 'party/pick', roundId: 'r1', choiceId: '' }],
  ['通報の相手がいない', { t: 'challenger/report', roundId: 'r1', text: 'x' }],
];
for (const [name, msg] of bad) {
  check(`弾く: ${name}`, C.ClientMessageSchema.safeParse(msg).success === false);
}

const good = [
  ['入室', { t: 'advisor/join', roomCode: 'ABC123', name: 'たろう' }],
  ['助言', { t: 'advisor/hint', text: '左の椀は死ぬ', roundId: 'r1' }],
  ['助言者からの通報', { t: 'advisor/report', targetId: 'a1', roundId: 'r1', text: 'ひどい' }],
  ['仲間の手', { t: 'party/pick', roundId: 'r1', choiceId: 'c2' }],
  ['開始', { t: 'challenger/start', mode: 'party' }],
];
for (const [name, msg] of good) {
  const r = C.ClientMessageSchema.safeParse(msg);
  check(`通す: ${name}`, r.success, r.error?.issues[0]?.message ?? '');
}

console.log(`\n${pass} 通過 / ${fail} 失敗`);
process.exit(fail > 0 ? 1 : 0);
