/**
 * 総当たりの耐久試験。
 * 全モード × 全言語 × 多数の周を回し、壊れ方を探す。
 *
 * 見張るもの：例外・詰み（進めない状態）・あり得ない状態
 * （助言ゼロ・選択肢ゼロ・時間がNaN・命が負・区画が範囲外）。
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `stress-${process.pid}.mjs`);
await build({ stdin: { contents: `export * from './src/core/engine';
  export * from './src/core/pack'; export * from './src/core/limits';
  export * from './src/core/ai-advisors'; export * from './src/i18n';`,
  resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const C = await import(pathToFileURL(out).href);
const pack = C.corePackage();

const problems = new Map();
const note = (what, detail) => {
  const key = `${what}｜${detail}`;
  problems.set(key, (problems.get(key) ?? 0) + 1);
};

async function runOnce(modeId, locale, seed) {
  C.setLocale(locale);
  const mode = C.MODES[modeId];
  const gateway = new C.AiAdvisorGateway({ count: 12, mode, seed, minDelayMs: 0, maxDelayMs: 1 });
  const engine = new C.GameEngine({ pack, mode, gateway, seed });

  let guard = 0;
  engine.start();
  const seenRooms = [];

  while (guard++ < 400) {
    const st = engine.snapshot();
    if (st.phase === 'gameover' || st.phase === 'cleared') break;

    if (st.phase === 'choosing') {
      // 助言が届くのを待つ（AI は setTimeout で送る）
      await new Promise((r) => setTimeout(r, 4));
      const r = engine.snapshot().round;
      if (!r) { note('詰み', 'choosing なのに round が無い'); break; }
      if (r.room.choices.length === 0) note('あり得ない状態', '選択肢ゼロ');
      if (!Number.isFinite(r.deadlineAt)) note('あり得ない状態', '期限が数値でない');
      if (r.timeLimitMs <= 0) note('あり得ない状態', '制限時間が0以下');
      if (st.lives < 0) note('あり得ない状態', '命が負');
      if (st.sectionIndex >= mode.sections + 1) note('あり得ない状態', '区画が範囲外');
      if (mode.allChallengers && r.ownCandidates.length === 0) note('あり得ない状態', '持ち情報が空');
      if (r.speakers.length === 0) note('あり得ない状態', '発言者ゼロ');
      if (r.advice.length === 0) note('あり得ない状態', '助言ゼロ');
      for (const a of r.advice) {
        if (!a.text.trim()) note('あり得ない状態', '空の助言');
        if (!r.speakers.some((s) => s.id === a.advisorId)) note('あり得ない状態', '発言枠外からの助言');
      }
      seenRooms.push(r.room.id);
      const pickIdx = Math.floor(Math.random() * r.room.choices.length);
      engine.choose(r.room.choices[pickIdx].id);
      continue;
    }
    // 演出を進める
    engine.advancePresentation();
  }
  if (guard >= 400) note('詰み', '400手で終わらない');

  const st = engine.snapshot();
  if (st.phase !== 'gameover' && st.phase !== 'cleared') note('詰み', `終端でない phase=${st.phase}`);

  // 部屋の重複（同じ周で同じ部屋を二度見ていないか）
  const dup = seenRooms.length - new Set(seenRooms).size;
  engine.dispose();
  return { rooms: seenRooms.length, unique: new Set(seenRooms).size, dup };
}

console.log('全モード × 全言語 × 各150周\n');
let totalRooms = 0, totalDup = 0, runs = 0;
for (const modeId of ['standard', 'brink', 'party']) {
  for (const locale of ['ja', 'en']) {
    let rooms = 0, dup = 0;
    for (let i = 0; i < 150; i++) {
      try {
        const r = await runOnce(modeId, locale, 1000 + i);
        rooms += r.rooms; dup += r.dup; runs++;
      } catch (e) {
        note('例外', `${modeId}/${locale}: ${e.message}`);
      }
    }
    totalRooms += rooms; totalDup += dup;
    console.log(`${modeId.padEnd(9)} ${locale}  ${(rooms / 150).toFixed(1)}部屋/周  同じ部屋の重複 ${(dup / 150).toFixed(2)}回/周`);
  }
}

console.log(`\n${runs} 周 / ${totalRooms} 部屋`);
if (problems.size === 0) console.log('問題なし');
else {
  console.log('\n見つかった問題:');
  for (const [k, n] of [...problems].sort((a, b) => b[1] - a[1])) console.log(`  ${n}回  ${k}`);
}
