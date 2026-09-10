/**
 * 区画の答え合わせを見る。
 *
 *   1. 区画を離れるとき（抜けた／深く行って落ちた）に出る
 *   2. 区画の頭で落ちたときは出ない
 *      （記録が「正1 嘘0」しかない紙が8人ぶん並ぶだけで、読み合いの答えにならない）
 *   3. 命が尽きたときは出ない（終わりの画面が区画ぶん全部開くので二重になる）
 *   4. 並ぶのはその区画の発言枠。嘘つきの印が配役と合っている
 *   5. **遊んでいるあいだ、線に嘘つきが載っていない**
 *      判定に liars を積んでいたので、一部屋抜けるたびに区画ぶんの配役が
 *      挑戦者の線へ流れていた（画面に出していないだけで、開けば読めた）。
 *      顔ぶれは区画のあいだ変わらないので、一部屋目を覗けば読み合いは終わり。
 *   6. 答え合わせは助言者にも配る（自分の役しか知らないので、他人の役が返らない）
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `ans-${process.pid}-${Date.now()}.mjs`);
await build({
  stdin: { contents: `export * from './src/core/engine';
    export * from './src/core/ai-advisors'; export * from './src/core/limits';
    export * from './src/core/schema';
    export * from './src/core/room-session';
    export * from './src/core/party-engine';
    export { setLocale, localized } from './src/i18n';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
});
const C = await import(pathToFileURL(out).href);
C.setLocale('ja');
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * 検査は正解を部屋データから引く。
 *
 * 「一番名の挙がった扉を選ぶ」で区画を抜けさせていたが、これは運任せで、
 * 助言の言い回しを足しただけで（20回目）区画の境目まで届かなくなった。
 * 見たいのは境目の振る舞いなので、そこへ確実に着く手を使う。
 */
const correctOf = (roomId) => pack.rooms.find((r) => r.id === roomId)?.correct ?? null;
function bestNamed(round) {
  return correctOf(round.room.id) ?? round.room.choices[0].id;
}

/* ── 区画の頭で落ちたときは出ない ── */
{
  const mode = C.MODES.standard;
  let shallow = 0, sheets = 0, onFatal = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const gateway = new C.AiAdvisorGateway({ count: 12, mode, seed: 40 + seed, minDelayMs: 4, maxDelayMs: 16 });
    const engine = new C.GameEngine({ pack, gateway, mode, seed });
    engine.start();
    for (let r = 0; r < 40; r++) {
      const s0 = engine.snapshot();
      if (s0.phase === 'gameover' || s0.phase === 'cleared' || !s0.round) break;
      await wait(150);
      const round = engine.snapshot().round;
      if (!round) break;
      const before = engine.snapshot();
      // わざと外す（誰も名を挙げていない扉）
      // わざと外す。正解が分かっているので確実に外せる
      const wrong = round.room.choices.find((c) => c.id !== correctOf(round.room.id))
        ?? round.room.choices[0];
      engine.choose(wrong.id);
      for (let i = 0; i < 3; i++) { engine.advancePresentation(); await wait(6); }
      const s = engine.snapshot();
      if (s.phase === 'answer') {
        sheets++;
        // 出たなら、2部屋以上抜けていたはず
        if (before.clearedInSection < 2) shallow++;
        engine.advancePresentation();
        await wait(6);
      } else if (s.phase === 'gameover' || s.phase === 'cleared') {
        if (s.sectionAnswer) onFatal++;
        break;
      }
      await wait(15);
    }
  }
  console.log(`\n【外し続ける】 答え合わせ ${sheets}回`);
  check('区画の頭で落ちたときは出ない', shallow === 0, `${shallow}回`);
  check('命が尽きたときは出ない', onFatal === 0, `${onFatal}回`);
}

/* ── 抜けた側・深く行って落ちた側 ── */
for (const modeId of ['standard', 'brink']) {
  const mode = C.MODES[modeId];
  let cleared = 0, deepLost = 0, mid = 0, badRows = 0, emptyRows = 0, thin = 0;
  for (let seed = 1; seed <= 8 && (cleared === 0 || deepLost === 0); seed++) {
    const gateway = new C.AiAdvisorGateway({ count: 12, mode, seed: 300 + seed, minDelayMs: 4, maxDelayMs: 16 });
    const engine = new C.GameEngine({ pack, gateway, mode, seed });
    engine.start();
    for (let r = 0; r < 60; r++) {
      const s0 = engine.snapshot();
      if (s0.phase === 'gameover' || s0.phase === 'cleared' || !s0.round) break;
      await wait(150);
      const round = engine.snapshot().round;
      if (!round) break;
      const before = engine.snapshot();
      /*
       * 抜けた側と、深く行って落ちた側の両方を見たい。
       * 二部屋抜けたところで一度だけわざと外す（区画の頭で落ちると
       * 紙は出ない決まりなので、二部屋進んでから落ちる必要がある）。
       */
      const dieHere = deepLost === 0 && before.clearedInSection >= 2;
      const pick = dieHere
        ? (round.room.choices.find((c) => c.id !== correctOf(round.room.id)) ?? round.room.choices[0]).id
        : bestNamed(round);
      engine.choose(pick);
      for (let i = 0; i < 3; i++) { engine.advancePresentation(); await wait(6); }
      const s = engine.snapshot();
      if (s.phase === 'answer') {
        const a = s.sectionAnswer;
        if (!a) { badRows++; continue; }
        if (a.cleared) {
          cleared++;
          if (before.clearedInSection + 1 < before.roomsPerSection) mid++;
        } else {
          deepLost++;
        }
        if (a.rows.length === 0) emptyRows++;
        // 記録が薄い紙は出さない決まり（頭で落ちたぶんは弾いてある）
        if (Math.max(0, ...a.rows.map((x) => x.hit + x.miss)) < 2) thin++;
        const speakers = new Set((s.round?.speakers ?? []).map((x) => x.id));
        if (speakers.size && a.rows.some((row) => !speakers.has(row.id))) badRows++;
        engine.advancePresentation();
        await wait(6);
      }
      await wait(15);
    }
  }
  console.log(`\n【${modeId}】 抜けた ${cleared}回 / 深く行って落ちた ${deepLost}回`);
  check(`${modeId}: 区画を抜けたときに出る`, cleared > 0, `${cleared}回`);
  check(`${modeId}: 深く行って落ちたときにも出る`, deepLost > 0, `${deepLost}回`);
  check(`${modeId}: 抜けた印が区画の埋まりと合っている`, mid === 0, `${mid}件`);
  check(`${modeId}: 名前が空にならない`, emptyRows === 0, `${emptyRows}回`);
  check(`${modeId}: 記録が二部屋ぶん以上ある`, thin === 0, `${thin}回`);
  check(`${modeId}: 並ぶのはその区画の発言枠`, badRows === 0, `${badRows}件`);
}

/* ── 全員挑戦者。区画の境目で出て、時間で送るか ── */
{
  const members = [
    { id: 'me', name: 'わたし', kind: 'human' },
    ...Array.from({ length: 6 }, (_, i) => ({ id: `ai${i}`, name: `AI${i}`, kind: 'ai' })),
  ];
  const party = new C.PartyEngine({ pack, members, mode: C.PARTY, seed: 12 });
  party.start();
  let sheets = 0, mid = 0, atEnd = 0, tooShort = 0, allSeats = 0;
  const per = C.PARTY.roomsPerSection;
  for (let r = 0; r < 40; r++) {
    const s0 = party.snapshot();
    if (s0.phase === 'gameover' || s0.phase === 'cleared') break;
    if (s0.phase === 'answer') {
      sheets++;
      const a = s0.sectionAnswer;
      // 境目でしか出ない。抜けた部屋の数は roomNumber-1（進むのは紙を送ったあと）
      const done = s0.roomNumber - 1;
      if (Math.floor((done + 1) / per) === Math.floor(done / per)) mid++;
      if (a?.rows.length !== members.length) allSeats++;
      // 猶予が乗っているか（乗っていないと画面が紙を消せない）
      if (!a || a.untilMs - Date.now() < 1000) tooShort++;
      party.advancePresentation();
      continue;
    }
    if (s0.phase !== 'choosing' || !s0.round) { party.advancePresentation(); continue; }
    await wait(30);
    for (const [id, choice] of party.aiPicks()) party.pick(id, choice);
    party.pick('me', s0.round.room.choices[0].id);
    await wait(20);
    for (let i = 0; i < 3; i++) { party.advancePresentation(); await wait(6); }
  }
  console.log(`\n【全員挑戦者】 答え合わせ ${sheets}回`);
  check('全員挑戦者でも区画の境目で出る', sheets > 0, `${sheets}回`);
  check('全員挑戦者: 境目以外では出ない', mid === 0, `${mid}回`);
  check('全員挑戦者: 席にいる全員が並ぶ', allSeats === 0, `${allSeats}回ずれた`);
  check('全員挑戦者: 猶予が乗っている', tooShort === 0, `${tooShort}回`);
  void atEnd;
  party.dispose();
}

/* ── 線の側。遊んでいるあいだ、配役が載っていないこと ── */
{
  const sent = [];
  const sink = {
    send: (id, msg) => sent.push({ id, msg }),
    broadcast: (msg) => sent.push({ id: '*', msg }),
    close: () => {},
  };
  const session = new C.RoomSession({ pack, sink, seed: 909 });
  session.connect('ch1');
  const say = (m) => session.receive('ch1', JSON.stringify(m));
  say({ t: 'challenger/start', mode: 'standard', locale: 'ja' });
  await wait(300);

  const views = () => sent.filter((s) => s.msg.t === 'room/view').map((s) => s.msg.view);
  const toAll = () => sent.filter((x) => x.id === '*').map((x) => x.msg);
  check('画面ぶんが届く', views().length > 0, JSON.stringify(sent.map((s) => s.msg.t)));

  for (let r = 0; r < 60; r++) {
    const v = views().at(-1);
    if (!v || v.phase === 'gameover' || v.phase === 'cleared') break;
    if (toAll().some((m) => m.t === 'section/answer')) break;
    if (!v.round) { await wait(50); continue; }
    // 助言が出そろうのを待つ。待たずに選ぶと当てずっぽうになり、
    // 区画を抜ける前に命が尽きる（＝境目まで届かない）
    await wait(450);
    const round = views().at(-1)?.round;
    if (!round) continue;
    say({ t: 'challenger/choose', choiceId: bestNamed(round), roundId: round.roundId });
    for (let i = 0; i < 4; i++) { say({ t: 'challenger/advance' }); await wait(25); }
    await wait(60);
  }

  const withVerdict = views().filter((v) => v.verdict);
  check('判定が届く', withVerdict.length > 0, `${withVerdict.length}件`);
  const leaked = withVerdict.filter((v) => 'liars' in v.verdict && v.verdict.liars);
  check('判定に嘘つきの一覧が載っていない', leaked.length === 0, `${leaked.length}件に載っている`);
  const midView = views().filter((v) => v.sectionAnswer && v.phase !== 'answer');
  check('区画の途中では答え合わせが載らない', midView.length === 0, `${midView.length}件`);
  const parsed = C.ChallengerViewSchema.safeParse(views().at(-1));
  check('画面ぶんが検証を通る', parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3)));

  const roleLeaks = toAll().filter((m) => m.t !== 'section/answer' && JSON.stringify(m).includes('"liar"'));
  check('区画を離れるまで助言者に役が配られない', roleLeaks.length === 0,
    roleLeaks.map((m) => m.t).join('/'));
  const broadcasts = toAll().filter((m) => m.t === 'section/answer');
  check('区画の答え合わせが助言者にも配られる', broadcasts.length > 0, `${broadcasts.length}件`);
  const shaped = broadcasts.every((m) => Array.isArray(m.rows) && m.rows.length > 0
    && m.rows.every((r) => typeof r.name === 'string' && typeof r.liar === 'boolean'));
  check('配る形が揃っている', broadcasts.length === 0 || shaped, JSON.stringify(broadcasts[0] ?? {}).slice(0, 160));
  session.disconnect('ch1');
}

console.log(`\n${pass} 通過 / ${fail} 失敗`);
process.exit(fail > 0 ? 1 : 0);
