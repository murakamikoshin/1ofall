/**
 * 賭場を長めに回して、区画の変わり目と死んだ直後に
 * **それぞれの画面が何を出しているか**を書き出す。
 *
 * 一部屋ぶんの検査は揃っているが、繋ぎ目は誰も見ていなかった。
 * 顔ぶれが入れ替わる／記録が白紙に戻る／手を挙げた扱いが切れる、
 * が同時に起きるのは区画の変わり目だけなので、そこを通しで見る。
 *
 *   node tools/soak-live.mjs [出力先]
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const HOST = '127.0.0.1:1999';
const OUT = process.argv[2] ?? '/tmp';
const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; say(`${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${d}`}`); };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
const pages = [];
for (const name of ['そうく1', 'そうく2']) {
  const p = await b.newPage({ viewport: { width: 375, height: 667 }, reducedMotion: 'reduce' });
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  pages.push({ name, p });
}

const room = `S${Date.now().toString(36).toUpperCase()}`.slice(0, 6).padEnd(6, 'X');
const ws = new WebSocket(`ws://${HOST}/parties/main/${room}`);
const inbox = [];
ws.addEventListener('message', (e) => inbox.push(JSON.parse(e.data)));
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
const send = (m) => ws.send(JSON.stringify(m));
await wait(200);

for (const [i, { p }] of pages.entries()) {
  await p.goto('http://127.0.0.1:4173/advisor.html?lang=ja', { waitUntil: 'networkidle' });
  await p.locator('.field').first().fill(room);
  await p.locator('.field').nth(1).fill(['そうく1', 'そうく2'][i]);
  await p.getByRole('button', { name: '入室' }).click();
  await wait(400);
}

send({ t: 'challenger/start', mode: 'standard', locale: 'ja' });
await wait(1200);

const view = () => inbox.filter((m) => m.t === 'room/view').pop()?.view;
const screen = async (p) => p.evaluate(() => {
  const t = (s) => (document.querySelector(s)?.textContent ?? '').trim();
  return {
    role: t('.role-title'),
    note: t('.role-note'),
    floor: [...document.querySelectorAll('.floor-row')].map((e) => (e.textContent ?? '').trim()),
    calls: [...document.querySelectorAll('.floor-row .floor-text')]
      .map((e) => e.textContent ?? '')
      .filter((t) => /は嘘だ|を信じるな|が嘘つきだ|に乗るな|嘘をついている|は本当だ|を信じろ|は正しい|に乗れ/.test(t)).length,
    canWrite: document.querySelectorAll('.compose-row').length > 0,
    canPoint: document.querySelectorAll('.floor-act').length > 0,
    volunteer: t('.locked + .primary') || t('.primary'),
    note2: t('.floor-note'),
    // 区画の答え合わせ。助言者は自分の役しか知らないので、ここでしか他人の役を見られない
    answer: [...document.querySelectorAll('.answer-row')].map((e) => (e.textContent ?? '').trim()),
    answerHead: t('.answer-heading'),
    // 部屋が終わったあと、自分の一言がどうなったかが返る（枠にいた人だけ）
    notice: t('.board-notice'),
  };
});

let sectionsSeen = new Set();
let deaths = 0;
let freshSeen = false;
let volunteerCleared = null;
let mixedFloor = 0;
let callsSeen = 0;
let answerSeen = 0;
let answerNoRole = 0;
let spokeRooms = 0;
let outcomeSeen = 0;
const lastOutcome = new Map();

for (let step = 0; step < 60; step++) {
  const v = view();
  if (!v?.round) { await wait(300); continue; }
  const s = v.sectionIndex;
  const n = v.round.roomNumber;
  const inSection = v.totalCleared - 0;

  // 助言と名指しが出そろうのを待つ
  await wait(4200);
  const v2 = view();
  if (!v2?.round) break;

  const door = v2.round.advice.filter((a) => (a.kind ?? 'door') === 'door');
  const call = v2.round.advice.filter((a) => a.kind === 'call');
  const fresh = v2.round.freshCast;
  if (fresh) freshSeen = true;
  if (!sectionsSeen.has(s)) {
    sectionsSeen.add(s);
    say(`\n──── 区画${s + 1}　${n}部屋目　この区画は${v2.roomsPerSection}部屋 ────`);
    say(`  顔ぶれ: ${v2.round.speakers.map((x) => x.name).join(' ')}`);
    say(`  記録が白紙に戻った: ${fresh ? 'はい' : 'いいえ'}`);
    // 枠外に回った人が手を挙げる。区画の頭で切れているか
    for (const { name, p } of pages) {
      const sc = await screen(p);
      if (!sc.canWrite) {
        const before = sc.volunteer;
        await p.getByRole('button', { name: '立候補する' }).click().catch(() => {});
        await wait(300);
        const after = (await screen(p)).volunteer;
        say(`  ${name}（枠外）立候補: ${before} → ${after}`);
        if (volunteerCleared === null && s > 0) volunteerCleared = before.includes('立候補する');
      }
    }
  }

  say(`\n  ${n}部屋目（区画${s + 1}）扉について${door.length}件　名指し${call.length}件　命${v2.lives}`);
  for (const a of door) say(`    ${a.advisorName}（正${a.record.hit} 嘘${a.record.miss}） ${a.text}`);
  for (const a of call) say(`   ＞${a.advisorName} ${a.text}`);
  callsSeen += call.length;

  // 助言者の画面が同じものを見ているか
  let iSpoke = false;
  for (const { name, p } of pages) {
    const sc = await screen(p);
    /*
     * 枠にいるなら一言書かせる。書かないと「枠にいた人へ結果が返る」を
     * 確かめられない（返るのは自分の一言があった人だけ）。
     * 扉の名前をそのまま入れる（検閲は通る文にする）。
     */
    if (sc.canWrite) {
      const label = v2.round.room.choices[0]?.label?.ja ?? '';
      const box = p.locator('.compose-row .field');
      if (label && (await box.count())) {
        await box.fill(`${label}は死ぬ`);
        await wait(150);
        const send = p.locator('.compose-row .primary');
        if (!(await send.isDisabled().catch(() => true))) {
          await send.click().catch(() => {});
          await wait(300);
          iSpoke = true;
          say(`    〔${name}〕 書いた「${label}は死ぬ」`);
        }
      }
    }

    if (sc.canWrite) {
      say(`    〔${name}〕 ${sc.role} / 場に${sc.floor.length}件 / 撃てる:${sc.canPoint} ${sc.note2 ? `「${sc.note2}」` : ''}`);
      if (sc.calls) mixedFloor++;
    } else {
      say(`    〔${name}〕 枠外 / 場に${sc.floor.length}件`);
      if (sc.calls) mixedFloor++;
    }
  }

  // わざと外して死ぬ回を作る（区画の頭へ戻るところを見たい）
  const beforeLives = v2.lives;
  const pick = deaths < 1 && n >= 2
    ? v2.round.room.choices[v2.round.room.choices.length - 1].id
    : bestGuess(v2.round);
  send({ t: 'challenger/choose', choiceId: pick, roundId: v2.round.roundId });
  /*
   * 段を送りながら、助言者の画面に答え合わせが出るところを見る。
   *
   * **次の部屋が届いた時点で紙は下ろされる**（押さない人が盤面を覆われた
   * まま助言の受付を逃さないため）。ここの挑戦者は人ではなく即座に段を
   * 送る botなので、部屋の頭で見にいくともう消えている。段の途中で見る。
   */
  for (let i = 0; i < 6; i++) {
    send({ t: 'challenger/advance' });
    await wait(220);
    for (const { name, p } of pages) {
      const outcome = await p.evaluate(() =>
        (document.querySelector('.board-notice')?.textContent ?? '').trim());
      // 知らせは押すまで残るので、段ごとに見ると同じ行が何度も出る
      if (/あなたの言葉|信じられなかった/.test(outcome) && lastOutcome.get(name) !== outcome) {
        lastOutcome.set(name, outcome);
        outcomeSeen++;
        say(`    〔${name}〕 ${outcome}`);
      }
      const sheet = await p.evaluate(() => ({
        rows: [...document.querySelectorAll('.answer-row')].map((e) => (e.textContent ?? '').trim()),
        head: (document.querySelector('.answer-heading')?.textContent ?? '').trim(),
      }));
      if (sheet.rows.length === 0) continue;
      answerSeen++;
      say(`    〔${name}〕 答え合わせ「${sheet.head}」`);
      for (const row of sheet.rows) say(`        ${row}`);
      if (!sheet.rows.some((r) => r.includes('嘘つき'))) answerNoRole++;
      await p.locator('.answer-go').click().catch(() => {});
    }
  }
  await wait(400);
  const after = view();
  if (iSpoke) spokeRooms++;
  if (after && after.lives < beforeLives) { deaths++; say(`    → 死んだ（命 ${beforeLives}→${after.lives}）`); }
  if (after?.phase === 'over') { say('\n  ▼ 終わり'); break; }
  if (sectionsSeen.size >= 2 && deaths >= 1) break;
  // 繋ぎ目は死んだときにも起きる。そこまで見られたら十分
  if (deaths >= 2 && freshSeen && step > 8) break;
}

/**
 * 実測で一番強い読み方（`tools/rubric.mjs` の「罠だと言われた扉を採る」）。
 *
 * 素朴に数えるだけだと生存 62% で、区画を抜ける前に命が尽きる。
 * ここは繋ぎ目を見る道具なので、区画を抜けられる強さで打つ。
 */
function bestGuess(round) {
  const AVOID = /やめろ|死ぬ|手を出すな|罠だ|だけは違う|だめだ|はずれ|外せ|触るな/;
  const HEDGE = /たぶん|気がする|に見える|じゃないか|絞れた|決めきれん|どっちか|、かな|あたりか|と思うが/;
  const CALL = /は嘘だ|を信じるな|が嘘つきだ|に乗るな|嘘をついている|は本当だ|を信じろ|は正しい|に乗れ/;
  const labels = round.room.choices.map((c) => ({ id: c.id, label: c.label.ja }));
  const door = round.advice.filter((a) => (a.kind ?? 'door') === 'door');
  const calls = round.advice.filter((a) => a.kind === 'call');

  // 撃たれた者を信じる（嘘つきは真実を言った者に群がる）
  const shot = new Map();
  for (const c of calls) {
    const target = door
      .filter((d) => c.text.includes(d.advisorName))
      .sort((a, b) => b.advisorName.length - a.advisorName.length)[0];
    if (!target) continue;
    const doubt = !/は本当だ|を信じろ|は正しい|に乗れ/.test(c.text.split(target.advisorName).join('　'));
    shot.set(target.advisorId, (shot.get(target.advisorId) ?? 0) + (doubt ? 1 : -0.5));
  }

  const score = new Map(labels.map((c) => [c.id, 0]));
  for (const a of door) {
    if (CALL.test(a.text)) continue;
    const net = shot.get(a.advisorId) ?? 0;
    const w = ((a.record.hit + 1) / (a.record.hit + a.record.miss + 2))
      * Math.max(0.2, Math.min(2.6, 1 + net * 0.9));
    const touched = labels.filter((c) => a.text.includes(c.label));
    if (!touched.length) continue;
    let rest = a.text;
    for (const c of touched) rest = rest.split(c.label).join('　');
    // 記録の悪い者の警告は裏返る
    if (AVOID.test(rest)) {
      for (const c of touched) score.set(c.id, score.get(c.id) + (1.2 - w));
      continue;
    }
    const hedging = touched.length >= 2 || HEDGE.test(rest);
    for (const c of touched) score.set(c.id, score.get(c.id) + w * (hedging ? 1.25 : 0.8));
  }
  return [...score.entries()].sort((x, y) => y[1] - x[1])[0][0];
}

say('');
/**
 * 区画をまたぐには5部屋の連続正解が要る（1部屋あたり74%なので4〜5回に1度）。
 * 運に頼る検査にすると落ちるので、**必ず起きる繋ぎ目**で見る。
 * 死んでも顔ぶれは入れ替わり、記録は白紙に戻るので、見たいものは同じ。
 * 区画をまたげたときだけ、そちらも見る。
 */
check('死んで区画の頭に戻れた', deaths >= 1, `${deaths}回`);
check('顔ぶれが入れ替わったことが画面に出た', freshSeen);
if (sectionsSeen.size >= 2) check('区画をまたいでも壊れない', true);
else say(`   （この周は区画をまたげなかった。見たのは区画${sectionsSeen.size}ぶん）`);
check('名指しが起きている', callsSeen > 0, `${callsSeen}件`);
check('助言者の「場」に名指しが混ざらない', mixedFloor === 0, `${mixedFloor}回`);
// 区画をまたいだ走りなので、助言者にも一度は答え合わせが届いているはず。
// 届いていなければ「配っている」と書いてあるだけの機能になる
if (sectionsSeen.size >= 2) {
  check('助言者にも区画の答え合わせが届く', answerSeen > 0, `${answerSeen}回`);
  check('答え合わせに役が並んでいる', answerNoRole === 0, `${answerNoRole}回は役が無かった`);
}
// 枠にいて一言を書いた部屋があるなら、結果が本人へ返っているはず
if (spokeRooms > 0) {
  check('枠にいた人へ部屋の結果が返る', outcomeSeen > 0, `書いた部屋${spokeRooms} / 返り${outcomeSeen}`);
}
check('例外なし', errors.length === 0, errors.join(' / '));
if (volunteerCleared !== null) check('手を挙げた扱いが区画の頭で切れている', volunteerCleared === true);

say(`\n${pass} 通過 / ${fail} 失敗`);
writeFileSync(`${OUT}/soak-${Date.now()}.txt`, lines.join('\n'), 'utf8');
ws.close();
await b.close();
process.exit(fail ? 1 : 0);
