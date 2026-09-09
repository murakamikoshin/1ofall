/**
 * Koshin Pop を、このゲームで実際に使う文字だけに絞る。
 *
 * 元は1ウェイト 2.1MB（woff2）。助言者ページはスマホで一瞬しか見ないので、
 * そのまま載せると初期表示が壊れる。文言表と部屋データから使用文字を集めて削る。
 *
 * 出力は2つ。
 *   koshin-display.woff2  挑戦者画面（部屋の文言まで含む）
 *   koshin-ui.woff2       助言者ページ（固定の UI 文言だけ）
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.env.KOSHIN_FONT_DIR ?? '/home/user/murakamikoshin/koshin-font/build';
const OUT = resolve(root, 'public/font');

/** ソースから日本語・英字リテラルを集める */
function collectFromSources(files) {
  let text = '';
  for (const f of files) text += readFileSync(resolve(root, f), 'utf8');
  return text;
}

const uiText = collectFromSources(['src/i18n/ja.ts', 'src/i18n/en.ts']);

/**
 * 助言者ページで Koshin Pop を使うのは見出しだけ。
 * 本文はシステムフォントのまま（初期表示の速さを守る）。
 * 見出しに出る文字だけを拾うので、数十文字で足りる。
 */
function advisorHeadlineChars() {
  const pick = (src) => {
    const advisor = src.slice(src.indexOf('advisor: {'), src.indexOf('errors: {'));
    const title = src.slice(src.indexOf('title:'), src.indexOf('menu:'));
    return advisor + title;
  };
  return pick(readFileSync(resolve(root, 'src/i18n/ja.ts'), 'utf8')) +
         pick(readFileSync(resolve(root, 'src/i18n/en.ts'), 'utf8'));
}
const roomText = JSON.stringify(JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8')));

// 常に入れておく：英数字、よく使う記号、助言で使われうる仮名
const ALWAYS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
  '　 、。，．・：；？！゛゜´｀¨＾￣＿ヽヾゝゞ〃仝々〆〇ー―‐／＼〜‖｜…‥' +
  '‘’“”（）〔〕［］｛｝〈〉《》「」『』【】＋－±×÷＝≠＜＞≦≧∞∴♂♀°′″℃￥＄￠￡％＃＆＊＠§☆★○●◎◇◆□■△▲▽▼※〒→←↑↓〓' +
  'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん' +
  'がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽぁぃぅぇぉっゃゅょゎ' +
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン' +
  'ガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポァィゥェォッャュョヮヴ';

function charsetOf(...texts) {
  const set = new Set(ALWAYS);
  for (const t of texts) for (const ch of t) {
    // ソースコードの記号類は落とす。日本語と英数字だけ拾う
    if (/[　-ヿ㐀-鿿＀-￯ -~]/.test(ch)) set.add(ch);
  }
  return [...set].join('');
}

function subset(srcName, outName, chars) {
  const src = join(SRC, srcName);
  const out = join(OUT, outName);
  execFileSync('python3', [
    '-m', 'fontTools.subset', src,
    `--text=${chars}`,
    '--output-file=' + out,
    '--flavor=woff2',
    // 「跳ねる」表現は calt / ss01 / ss02 に入っている。落とすと書体の性格が消える
    '--layout-features+=calt,ss01,ss02,liga,kern,palt',
    '--no-hinting',
    '--desubroutinize',
    '--drop-tables+=DSIG',
    '--name-IDs=*',
    '--notdef-outline',
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  return statSync(out).size;
}

mkdirSync(OUT, { recursive: true });

// 助言者ページ用は「常に入れる仮名一式」も削る。見出しに出る字だけでよい
const roleChars = [...new Set(advisorHeadlineChars() + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')]
  .filter((ch) => /[　-ヿ㐀-鿿＀-￯ -~]/.test(ch))
  .join('');
const displayChars = charsetOf(uiText, roomText);

const before = statSync(join(SRC, 'KoshinPop-Bold.woff2')).size;
const role = subset('KoshinPop-Bold.woff2', 'koshin-role.woff2', roleChars);
const display = subset('KoshinPop-Bold.woff2', 'koshin-display.woff2', displayChars);

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`元:                  ${kb(before)}`);
console.log(`koshin-role.woff2     ${kb(role)}  (${[...roleChars].length} 字) 助言者ページの見出し用`);
console.log(`koshin-display.woff2  ${kb(display)}  (${[...displayChars].length} 字) 挑戦者画面用`);

writeFileSync(join(OUT, 'charset.txt'), displayChars);
