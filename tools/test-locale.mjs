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
}

console.log(`\n${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
