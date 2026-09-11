/** 検閲の素の動作確認 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `mod-${process.pid}.mjs`);
await build({ entryPoints: [resolve(root, 'src/core/moderation.ts')], bundle: true,
              format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const { checkHint, createHintGuard, containsBlocked, isPointing, countChoicesMentioned,
        isCommitted, createReportBook, fileReport, AUTO_MUTE_REPORTS } = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  期待 ${want} / 実際 ${got}`}`);
};

check('普通の助言は通る', checkHint(createHintGuard(), 'a', '焼いた魚が生きる', 0).ok, true);
check('空は通らない', checkHint(createHintGuard(), 'a', '   ', 0).ok, false);
check('21文字は通らない', checkHint(createHintGuard(), 'a', 'あ'.repeat(21), 0).ok, false);
check('20文字は通る', checkHint(createHintGuard(), 'a', 'あ'.repeat(20), 0).ok, true);
check('罵倒は止まる', containsBlocked('しね'), true);
check('伏せ字でも止まる', containsBlocked('し ね'), true);
check('全角でも止まる', containsBlocked('ｈｔｔｐ://x'), true);
check('引き伸ばしでも止まる', containsBlocked('しねええええ'), true);
check('無関係な語は通る', containsBlocked('魚は絶対ない'), false);
// ここは実際に抜けていた。ひらがなだけ書いてあり、漢字とカタカナが素通りしていた
check('漢字の罵倒も止まる', containsBlocked('死ね'), true);
check('カタカナの罵倒も止まる', containsBlocked('シネ'), true);
check('漢字の「殺す」も止まる', containsBlocked('殺す'), true);
check('カタカナの「ゴミクズ」も止まる', containsBlocked('ゴミクズ'), true);
check('自殺の誘導は止まる', containsBlocked('首吊れ'), true);
check('連絡先の誘導は止まる', containsBlocked('DMして'), true);
check('宣伝は止まる', containsBlocked('example.comを見て'), true);
// 「死ぬ」は部屋の言葉そのもの。止めてはいけない
check('「死ぬ」は通る', containsBlocked('鉄の扉は死ぬ'), false);
check('「死ぬ方」は通る', containsBlocked('こっちが死ぬ方だ'), false);

const g = createHintGuard();
checkHint(g, 'a', '魚だ', 1000);
check('連投は止まる', checkHint(g, 'a', 'パンだ', 1500).ok, false);
check('間を空ければ通る', checkHint(g, 'a', 'パンだ', 5000).ok, true);
check('別人は影響を受けない', checkHint(g, 'b', '果実だ', 1500).ok, true);
const g2 = createHintGuard();
checkHint(g2, 'a', '同じ文', 0);
check('同じ文の再送は止まる', checkHint(g2, 'a', '同じ文', 99999).ok, false);


// 番号・位置で指す言い方は使えない（「1234は罠」で全部潰す攻撃を封じる）
check('半角数字で指せない', isPointing('1が正解'), true);
check('全角数字で指せない', isPointing('１が正解'), true);
check('漢数字で指せない', isPointing('三番目'), true);
check('丸数字で指せない', isPointing('②だ'), true);
check('位置で指せない（左）', isPointing('左のやつ'), true);
check('位置で指せない（真ん中）', isPointing('真ん中はやめろ'), true);
check('位置で指せない（端）', isPointing('端が安全'), true);
check('名前で言うのは通る', isPointing('焼いた魚だ'), false);
// 名前に位置語が入っていることがある。名前を先に除いてから調べる
check('「右手」は名前として通る', isPointing('右手だ', ['右手', '明日', '自分の名']), false);
check('「端の薄い氷」は通る', isPointing('端の薄い氷はやめろ', ['端の薄い氷', '透けた氷']), false);
check('「手前の椀」は通る', isPointing('手前の椀にしろ', ['手前の椀', '奥の巻物']), false);
check('名前を除いても位置語が残れば止まる', isPointing('右手の左だ', ['右手']), true);

const LABELS = ['赤いスープ', '焼いた魚', '白いパン', '干した果実', '湯気の立つ粥'];
check('触れた選択肢を数えられる', countChoicesMentioned('焼いた魚か白いパン', LABELS), 2);
check('全部に触れる助言は数で分かる', countChoicesMentioned('赤いスープ焼いた魚白いパン干した果実', LABELS), 4);
check('三つ以上に触れたら通らない',
  checkHint(createHintGuard(), 'z', '魚かパンか果実', 0, ['魚', 'パン', '果実']).ok, false);
check('二つまでなら通る', checkHint(createHintGuard(), 'y', '魚かパン', 0, ['魚', 'パン', '果実']).ok, true);
check('番号入りは通らない', checkHint(createHintGuard(), 'x', '2番だ', 0, LABELS).ok, false);

/*
 * 押されている者（疑いの札を置かれた者）は言い切る。
 *
 * 扉ひとつを名指しして、迷いの言い方を使わない。**人間にも同じ規則**を
 * かけるので（AI だけの作法にしない）、ここで判る必要がある。
 * 迷いに隠れて紛れられなくなるのが、札を置く側の得。
 */
const L = ['焼いた魚', '白いパン', '青い実'];
check('言い切りは押されていても通る', checkHint(createHintGuard(), 'p', '焼いた魚だ', 0, L, { pressed: true }).ok, true);
check('二つ挙げると通らない', checkHint(createHintGuard(), 'p', '焼いた魚か白いパン', 0, L, { pressed: true }).ok, false);
check('迷いの言い方は通らない', checkHint(createHintGuard(), 'p', 'たぶん焼いた魚', 0, L, { pressed: true }).ok, false);
check('通らない理由は mustCommit',
  checkHint(createHintGuard(), 'p', 'たぶん焼いた魚', 0, L, { pressed: true }).reason, 'mustCommit');
check('扉に触れていない一言も通らない', checkHint(createHintGuard(), 'p', 'よく分からん', 0, L, { pressed: true }).ok, false);
check('押されていなければ迷いも通る', checkHint(createHintGuard(), 'q', 'たぶん焼いた魚', 0, L).ok, true);
// 「これは死ぬ」は言い切りの一つ（扉ひとつを名指ししている）
check('死ぬと言い切るのは通る', checkHint(createHintGuard(), 'p', '白いパンは死ぬ', 0, L, { pressed: true }).ok, true);
check('言い切りの判定（単独）', isCommitted('焼いた魚だ', L), true);
check('言い切りの判定（二つ）', isCommitted('焼いた魚か青い実', L), false);
check('言い切りの判定（迷い）', isCommitted('焼いた魚な気がする', L), false);
// 扉の名前の中に迷いの語が入っていても、名前を外してから見る
check('名前の中の語で読み違えない', isCommitted('白いパンだ', L), true);

// 通報
const book = createReportBook();
check('通報は受理される', fileReport(book, { reporterId: 'a', targetId: 'z', roundId: 'r', text: '', at: 0 }).accepted, true);
check('同じ人の二度目は数えない', fileReport(book, { reporterId: 'a', targetId: 'z', roundId: 'r', text: '', at: 1 }).accepted, false);
check('自分は通報できない', fileReport(book, { reporterId: 'z', targetId: 'z', roundId: 'r', text: '', at: 2 }).accepted, false);
fileReport(book, { reporterId: 'b', targetId: 'z', roundId: 'r', text: '', at: 3 });
const third = fileReport(book, { reporterId: 'c', targetId: 'z', roundId: 'r', text: '', at: 4 });
check(`${AUTO_MUTE_REPORTS}人集まると自動で黙る`, third.autoMuted, true);


// 英語でも同じ抜け道を塞げているか
check('英語の序数で指せない', isPointing('the second one'), true);
check('英語の位置語で指せない（left）', isPointing('take the left one'), true);
check('英語の位置語で指せない（middle）', isPointing('avoid the middle'), true);
check('英語の数詞で指せない', isPointing('two and three are traps'), true);
check('英語の名前指定は通る', isPointing('Grilled fish lives', ['Grilled fish', 'White bread']), false);

console.log(`\n${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
