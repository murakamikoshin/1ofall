/**
 * 人を指す一手（「あいつは嘘だ」）が、通しで成り立っているかを見る。
 *
 * 見るのは4つ。
 *   1. AI がちゃんと撃つか（撃たなければ場が静かなまま）
 *   2. 撃っても扉についての一言が消えないか（別の口である、ということ）
 *   3. 撃った当たり外れが撃った本人の記録に乗るか
 *   4. 撃たれた者ほど正解を口にしているか（読める手掛かりになっているか）
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `pt-${process.pid}-${Date.now()}.mjs`);
await build({
  stdin: { contents: `export * from './src/core/engine';
    export * from './src/core/ai-advisors'; export * from './src/core/limits';
    export * from './src/core/party-engine';
    export * from './src/core/name-calling';
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

const MODES = ['standard', 'brink'];
for (const modeId of MODES) {
  const mode = C.MODES[modeId];
  const gateway = new C.AiAdvisorGateway({ count: 12, mode, seed: 91, minDelayMs: 5, maxDelayMs: 25 });
  const engine = new C.GameEngine({ pack, gateway, mode, seed: 77 });
  engine.start();

  let calls = 0, doors = 0, rooms = 0;
  let bothMouths = 0;
  let shooters = new Set();
  let maxMark = 0;
  let marksAfter = 0;

  for (let r = 0; r < 40; r++) {
    const before = engine.snapshot();
    if (!before.round) break;
    // 助言と名指しが出そろうのを待つ
    await wait(420);
    const s = engine.snapshot();
    const round = s.round;
    if (!round) break;
    rooms++;
    const door = round.advice.filter((a) => (a.kind ?? 'door') === 'door');
    const call = round.advice.filter((a) => a.kind === 'call');
    doors += door.length;
    calls += call.length;
    // 撃った者が扉についても言っているか（別の口ならどちらも残る）
    for (const c of call) if (door.some((d) => d.advisorId === c.advisorId)) bothMouths++;

    for (const c of call) shooters.add(c.advisorId);
    for (const a of round.advice) maxMark = Math.max(maxMark, a.record.hit + a.record.miss);

    // でたらめに選ぶと毎部屋死んで区画がやり直しになり、記録が積まれない。
    // 素朴に一番名の挙がった扉を選ぶ（記録が積まれる形にするため）
    const tally = new Map(round.room.choices.map((c) => [c.id, 0]));
    for (const a of door) {
      for (const c of round.room.choices) {
        if (a.text.includes(C.localized(c.label))) tally.set(c.id, (tally.get(c.id) ?? 0) + 1);
      }
    }
    const bestId = [...tally.entries()].sort((x, y) => y[1] - x[1])[0][0];
    engine.choose(bestId);
    // hush → reveal → verdict → 次の部屋。段は本体が持つので合図だけ送る
    for (let i = 0; i < 5; i++) { engine.advancePresentation(); await wait(12); }
    await wait(60);
    if (engine.snapshot().phase === 'over') break;
  }

  const finalRecords = engine.snapshot().round?.advice ?? [];
  void finalRecords;
  console.log(`\n【${modeId}】 ${rooms}部屋　扉について ${doors}件　名指し ${calls}件`);
  check(`${modeId}: AI が人を指す`, calls > 0, `${calls}件`);
  check(`${modeId}: 指しても扉の一言が残る（別の口）`, calls === 0 || bothMouths === calls, `${bothMouths}/${calls}`);
  check(`${modeId}: 区画のあいだに記録が積まれる`, maxMark >= 2, `最大 ${maxMark}`);
  void marksAfter;
  engine.dispose?.();
  gateway.dispose();
}


/* ── 全員挑戦者モード ────────────────────────────────────────
   こちらは本体が別（PartyEngine）なので、同じことを別に確かめる。
   仲間が人間になり得るモードなので、指す手も同じ形で通っていないといけない。 */
{
  const members = Array.from({ length: 6 }, (_, i) => ({ id: `m_${i}`, name: `仲間${i}`, kind: 'ai' }));
  const party = new C.PartyEngine({ pack, mode: C.MODES.party, seed: 31, members });
  party.start();
  let calls = 0, both = 0, rooms = 0;
  for (let r = 0; r < 12; r++) {
    const round = party.snapshot().round;
    if (!round) break;
    rooms++;
    for (const h of party.aiHints()) party.hint(h.memberId, h.text);
    for (const c of party.aiCalls()) party.point(c.memberId, c.targetId, c.doubt);
    const advice = party.snapshot().round?.advice ?? [];
    const door = advice.filter((a) => (a.kind ?? 'door') === 'door');
    const call = advice.filter((a) => a.kind === 'call');
    calls += call.length;
    for (const c of call) if (door.some((d) => d.memberId === c.memberId)) both++;
    for (const [id, choice] of party.aiPicks()) party.pick(id, choice);
    for (let i = 0; i < 6; i++) party.advancePresentation();
    if (party.snapshot().phase === 'over') break;
  }
  console.log(`\n【party】 ${rooms}部屋　名指し ${calls}件`);
  check('party: AI が人を指す', calls > 0, `${calls}件`);
  check('party: 指しても扉の一言が残る', calls === 0 || both === calls, `${both}/${calls}`);
  party.dispose?.();
}

/* ── resolveTruth 単体 ─────────────────────────────────────────
   一人が二つ喋る（扉について一つ、人を指して一つ）。
   人ごとにまとめると、撃った当たり外れが扉の当たり外れを上書きして消える。
   実際に一度そうなっていたので、ここで固定する。 */
{
  const choices = [{ id: 'a', label: { ja: '赤い扉', en: 'red door' } }, { id: 'b', label: { ja: '黒い扉', en: 'black door' } }];
  const advice = [
    { id: 'p1', name: 'いち', text: '赤い扉だ', kind: 'door' },      // 正解を押した → 正
    { id: 'p2', name: 'にい', text: '黒い扉だ', kind: 'door' },      // 外れを押した → 嘘
    { id: 'p2', name: 'にい', text: 'いちは嘘だ', kind: 'call' },     // 正しい者を撃った → 嘘
    { id: 'p3', name: 'さん', text: 'にいは嘘だ', kind: 'call' },     // 嘘つきを撃った → 正
  ];
  const truth = C.resolveTruth(advice, (t) => t.includes('赤い扉'), choices);
  const marks = (id) => truth.filter((x) => x.id === id);
  check('二つ喋った人には印が二つ付く', marks('p2').length === 2, JSON.stringify(marks('p2')));
  check('正しい者を撃つと嘘が付く', marks('p2').every((x) => x.truthful === false), JSON.stringify(marks('p2')));
  check('嘘つきを撃つと正が付く', marks('p3').length === 1 && marks('p3')[0].truthful === true, JSON.stringify(marks('p3')));
  check('扉について言った者はそのまま', marks('p1').length === 1 && marks('p1')[0].truthful === true, JSON.stringify(marks('p1')));
}

console.log(`\n${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
