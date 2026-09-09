/** 検閲の素の動作確認 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `mod-${process.pid}.mjs`);
await build({ entryPoints: [resolve(root, 'src/core/moderation.ts')], bundle: true,
              format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const { checkHint, createHintGuard, containsBlocked } = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  期待 ${want} / 実際 ${got}`}`);
};

check('普通の助言は通る', checkHint(createHintGuard(), 'a', '3番が安全', 0).ok, true);
check('空は通らない', checkHint(createHintGuard(), 'a', '   ', 0).ok, false);
check('21文字は通らない', checkHint(createHintGuard(), 'a', 'あ'.repeat(21), 0).ok, false);
check('20文字は通る', checkHint(createHintGuard(), 'a', 'あ'.repeat(20), 0).ok, true);
check('罵倒は止まる', containsBlocked('しね'), true);
check('伏せ字でも止まる', containsBlocked('し ね'), true);
check('全角でも止まる', containsBlocked('ｈｔｔｐ://x'), true);
check('引き伸ばしでも止まる', containsBlocked('しねええええ'), true);
check('無関係な語は通る', containsBlocked('魚は絶対ない'), false);

const g = createHintGuard();
checkHint(g, 'a', '1番だ', 1000);
check('連投は止まる', checkHint(g, 'a', '2番だ', 1500).ok, false);
check('間を空ければ通る', checkHint(g, 'a', '2番だ', 5000).ok, true);
check('別人は影響を受けない', checkHint(g, 'b', '3番だ', 1500).ok, true);
const g2 = createHintGuard();
checkHint(g2, 'a', '同じ文', 0);
check('同じ文の再送は止まる', checkHint(g2, 'a', '同じ文', 99999).ok, false);

console.log(`\n${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
