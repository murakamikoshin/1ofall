/**
 * 言語ごとの助言が壊れていないかを見張る。
 *
 * 実際に起きた事故：助言の言い回しが日本語で直書きされていたので、
 * 英語で遊ぶと「New straw sandalだ」「たぶんMuddy clog」になっていた。
 * 判定（真偽・番号禁止）も日本語専用で、英語では素通りしていた。
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `loc-${process.pid}.mjs`);
await build({ stdin: { contents: `export * from './src/core/casting';
  export * from './src/core/hint-writer'; export * from './src/core/limits';
  export * from './src/core/rng'; export * from './src/core/moderation';
  export * from './src/i18n'; export { HINT_LIMIT_BY_LOCALE, LOCALES } from './src/i18n/locales';`,
  resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const C = await import(pathToFileURL(out).href);
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`);
};

/** 他言語の言い回しが混ざっていないか */
const FOREIGN = {
  ja: /[A-Za-z]{4,}/,                        // 日本語の助言に英単語が生で出る
  en: /[ぁ-んァ-ヶ一-龯]/,                   // 英語の助言に日本語が出る
};

const shapes = new Map();

for (const loc of C.LOCALES) {
  C.setLocale(loc);
  const rng = C.createRng(20260909);
  const ADV = Array.from({ length: 12 }, (_, i) => ({ id: `ai_${i}`, name: `a${i}`, kind: 'ai' }));
  let mixed = 0, tooLong = 0, empty = 0, n = 0;
  const forms = { narrow: 0, other: 0 };
  let sample = '';

  for (let t = 0; t < 1500; t++) {
    const room = pack.rooms[Math.floor(rng() * pack.rooms.length)];
    const speakerIds = C.castSpeakers({ advisors: ADV, slots: 8, mode: 'lottery', rng });
    const liarIds = C.castLiars(speakerIds, rng);
    const kn = C.dealKnowledge(room.choices, room.correct, { speakerIds, liarIds }, rng,
      C.RUN.knowledgeBySection[0]);
    const labels = room.choices.map((c) => C.localized(c.label));
    for (const id of speakerIds) {
      const text = C.writeHint({ choices: room.choices, knowledge: kn.get(id), rng,
        liarHonestyRate: 0.2, liarMimicRate: 0.25, voice: C.voiceOf(id) });
      n++;
      if (!text.trim()) empty++;
      if ([...text].length > C.HINT_LIMIT_BY_LOCALE[loc]) tooLong++;
      // ラベルを除いた残りに他言語が混ざっていないか
      let rest = text;
      for (const l of [...labels].sort((a, b) => b.length - a.length)) rest = rest.split(l).join('');
      if (FOREIGN[loc].test(rest)) { mixed++; if (!sample) sample = text; }
      if (labels.filter((l) => text.includes(l)).length >= 2) forms.narrow++; else forms.other++;
    }
  }

  console.log(`\n[${loc}]`);
  check(`${loc}: 他言語が混ざらない`, mixed === 0, `${mixed}/${n} 件混入 例「${sample}」`);
  check(`${loc}: 文字数上限を超えない`, tooLong === 0, `${tooLong}/${n} 件`);
  check(`${loc}: 空の助言が出ない`, empty === 0, `${empty}/${n} 件`);
  check(`${loc}: 言い回しが偏らない`,
    forms.narrow / n > 0.2 && forms.narrow / n < 0.8,
    `二つ挙げる型 ${(forms.narrow / n * 100).toFixed(0)}%`);
  check(`${loc}: 真偽の判定が効く`,
    C.wasTruthful(C.strings().hints.avoid[0]('X'), 'Y', ['X', 'Y']) === true &&
    C.wasTruthful(C.strings().hints.avoid[0]('Y'), 'Y', ['X', 'Y']) === false,
    '「Xはやめろ」型の判定');
  check(`${loc}: 番号と位置を塞げている`,
    C.isPointing(loc === 'ja' ? '2番目だ' : 'the second one') &&
    C.isPointing(loc === 'ja' ? '左のやつ' : 'the left one'));

  // 言い回しを足したのに見分けの正規表現を直し忘れる事故が実際に起きた。
  // 迷いの型が「迷い」と読まれないと、読み手が断言と取り違えて均衡が動く
  const T = C.strings();
  // 言い回しの中に出てこない字を使う（「あ」だと「あたりか」まで削れる）
  const label = '◇◇';
  const strip = (text) => text.split(label).join('　');
  const hedgeMiss = T.hints.hedge.map((f) => f(label)).filter((t) => !T.hints.hedgePattern.test(strip(t)));
  const avoidMiss = T.hints.avoid.map((f) => f(label)).filter((t) => !T.hints.avoidPattern.test(strip(t)));
  const pushWrong = T.hints.push
    .map((f) => f(label))
    .filter((t) => T.hints.hedgePattern.test(strip(t)) || T.hints.avoidPattern.test(strip(t)));
  check(`${loc}: 迷いの型がすべて迷いと読まれる`, hedgeMiss.length === 0, `漏れ: ${hedgeMiss.join(' / ')}`);
  check(`${loc}: 警告の型がすべて警告と読まれる`, avoidMiss.length === 0, `漏れ: ${avoidMiss.join(' / ')}`);
  check(`${loc}: 断言の型が迷い・警告と読まれない`, pushWrong.length === 0, `誤り: ${pushWrong.join(' / ')}`);

  /*
   * 言い回しの**数**も言語で揃える。
   *
   * 20回目に日本語の「二つに絞れている」型を4→14種に増やしたとき、
   * 英語を4種のまま置いていた。文言の鍵は揃っているので検査は通り、
   * **英語だけ同じ言い方が一部屋に三〜四回並ぶ**ままだった。
   * 読み物の厚みは鍵の有無ではなく数で決まる。
   */
  const clean = (t) => t.split(label).join('　').split('◆◆').join('　');
  shapes.set(loc, {
    push: T.hints.push.length,
    hedge: T.hints.hedge.length,
    avoid: T.hints.avoid.length,
    narrow: T.hints.narrow.length,
    doubt: T.hints.doubt.length,
    back: T.hints.back.length,
    // 「二つに絞れている」型のうち迷いと読まれるもの。比が言語でずれると
    // 読みの重み付けが変わり、腕の差が言語ごとに違うものになる
    narrowHedged: T.hints.narrow
      .map((f) => f(label, '◆◆'))
      .filter((t) => T.hints.hedgePattern.test(clean(t)))
      .length,
  });
}

{
  const rows = [...shapes.entries()];
  const [firstLoc, firstTable] = rows[0];
  for (const [loc, table] of rows.slice(1)) {
    const diffs = Object.keys(table).filter((k) => table[k] !== firstTable[k]);
    check(`言い回しの数が ${firstLoc} と ${loc} で揃っている`, diffs.length === 0,
      diffs.map((k) => `${k}: ${firstLoc} ${firstTable[k]} / ${loc} ${table[k]}`).join(' / '));
  }
  for (const [loc, t] of rows) {
    console.log(`   ${loc}: 押す${t.push} 迷い${t.hedge} 警告${t.avoid} 二択${t.narrow}（うち迷い${t.narrowHedged}） 疑い${t.doubt} 庇い${t.back}`);
  }
}

console.log(`\n${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
