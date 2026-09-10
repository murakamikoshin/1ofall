/**
 * 実際に遊んで、遊んだ中身をそのまま書き出す。
 *
 * 数字ではなく「その部屋で何が読めたか」を残すのが目的。
 * 面白いかどうかは、助言の文面と手掛かりを並べて見ないと分からない。
 *
 *   node tools/playtest-record.mjs <出力先> [mode] [runs]
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const OUT = process.argv[2] ?? '/tmp';
const MODE = process.argv[3] ?? 'party';
const RUNS = Number(process.argv[4] ?? 1);
const LABELS = { standard: '一人で遊ぶ', brink: '崖っぷち', party: '全員挑戦者' };
const LABEL = LABELS[MODE];
// 引数の順を間違えると黙って0周になって、遊んだつもりで何も見ていないことになる
if (!LABEL || !Number.isFinite(RUNS) || RUNS < 1) {
  console.error(`使い方: node tools/playtest-record.mjs <出力先> <${Object.keys(LABELS).join('|')}> <周回数>`);
  console.error(`受け取ったもの: 出力先=${OUT} モード=${MODE} 周回数=${process.argv[4]}`);
  process.exit(2);
}

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const lines = [];
// 長い通しなので、書きながら流す（終わるまで何も見えないと進みが分からない）
const say = (s = '') => { lines.push(s); console.log(s); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** その部屋で画面に出ているものを全部取る */
async function readBoard(p, isParty) {
  return p.evaluate((party) => {
    const txt = (el) => (el?.textContent ?? '').trim();
    const choices = [...document.querySelectorAll('.choice')].map((el) => ({
      id: el.dataset.choiceId,
      label: txt(el.querySelector('.choice-label')),
      mark: txt(el.querySelector('.choice-known')),
    }));
    const hints = [...document.querySelectorAll('.hint-row')].map((el) => ({
      name: txt(el.querySelector('.hint-name')).replace(/正\d+\s*嘘\d+$/, '').trim(),
      record: txt(el.querySelector('.hint-record')),
      text: txt(el.querySelector('.hint-text')),
    }));
    return {
      prompt: txt(document.querySelector('.prompt')),
      room: txt(document.querySelector('.room-count')),
      timer: txt(document.querySelector('.timer')),
      lives: party ? null : document.querySelectorAll('.pip:not(.is-lost)').length,
      seats: party
        ? [...document.querySelectorAll('.party-seat')].map((el) => ({
            name: txt(el.querySelector('.party-name')),
            lives: el.querySelectorAll('.pip:not(.is-lost)').length,
          }))
        : [],
      choices,
      hints,
    };
  }, isParty);
}

for (let run = 1; run <= RUNS; run++) {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.addInitScript(() => {
    for (const m of ['standard', 'brink', 'party']) localStorage.setItem(`briefed:${m}`, '1');
  });
  await p.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: new RegExp('^' + LABEL) }).click();
  await p.waitForSelector('.choice', { timeout: 10000 });

  const isParty = MODE === 'party';
  say(`\n${'='.repeat(70)}\n${LABEL}　${run}周目\n${'='.repeat(70)}`);

  let room = 0;
  let lastRoom = '';
  for (let guard = 0; guard < 60; guard++) {
    if (await p.locator('.end-screen').count()) break;
    if (!(await p.locator('.choice').count())) { await wait(500); continue; }

    // 助言が出そろうのを待つ（人間もそうする）
    await wait(6500);
    const board = await readBoard(p, isParty);
    if (board.room === lastRoom) { await wait(800); continue; }
    lastRoom = board.room;
    room++;

    say(`\n── ${board.room}　残り${board.timer} ──`);
    if (isParty) say(`  席: ${board.seats.map((s) => `${s.name}${'●'.repeat(s.lives)}`).join('  ')}`);
    else say(`  命: ${board.lives}`);
    say(`  「${board.prompt}」`);
    for (const c of board.choices) say(`    ${c.mark ? '◆' : '・'}${c.label}${c.mark ? `（${c.mark}）` : ''}`);
    say(`  助言 ${board.hints.length}件:`);
    for (const h of board.hints) say(`    ${h.name}（${h.record}） 「${h.text}」`);

    // 設計どおりの読み方をなぞる：迷いを重く見て、記録で重みを変える
    const pickIndex = await p.evaluate(() => {
      const txt = (el) => (el?.textContent ?? '').trim();
      const choices = [...document.querySelectorAll('.choice')].map((el) => ({
        id: el.dataset.choiceId,
        label: txt(el.querySelector('.choice-label')),
        mine: !!txt(el.querySelector('.choice-known')),
        fatal: el.classList.contains('is-fatal'),
      }));
      const rows = [...document.querySelectorAll('.hint-row')].map((el) => ({
        text: txt(el.querySelector('.hint-text')),
        rec: txt(el.querySelector('.hint-record')),
      }));
      const score = new Map(choices.map((c) => [c.id, 0]));
      const bump = (id, by) => score.set(id, (score.get(id) ?? 0) + by);
      for (const c of choices) {
        if (c.mine && !c.fatal) bump(c.id, 2.5);
        if (c.fatal) bump(c.id, -99);
      }
      for (const r of rows) {
        const m = /正(\d+)\s*嘘(\d+)/.exec(r.rec);
        const hit = m ? Number(m[1]) : 0;
        const miss = m ? Number(m[2]) : 0;
        const w = (hit + 1) / (hit + miss + 2);
        const touched = choices.filter((c) => r.text.includes(c.label));
        if (!touched.length) continue;
        if (/死ぬ|罠|やめ|よせ|外せ|ない/.test(r.text)) {
          for (const c of touched) bump(c.id, -w * 1.2);
          continue;
        }
        const hedging = touched.length >= 2 || /かも|気がする|たぶん|どっちか|決めきれ/.test(r.text);
        for (const c of touched) bump(c.id, w * (hedging ? 1.25 : 0.8));
      }
      let best = -Infinity, bestId = choices[0]?.id;
      for (const c of choices) {
        const v = score.get(c.id) ?? 0;
        if (v > best) { best = v; bestId = c.id; }
      }
      const tie = choices.filter((c) => (score.get(c.id) ?? 0) === best).length;
      return { id: bestId, label: choices.find((c) => c.id === bestId)?.label, tie, scores: choices.map((c) => `${c.label}:${(score.get(c.id) ?? 0).toFixed(2)}`) };
    });
    say(`  → 「${pickIndex.label}」を選ぶ${pickIndex.tie > 1 ? `（同点${pickIndex.tie}つ＝運任せ）` : ''}`);
    say(`     点: ${pickIndex.scores.join('  ')}`);

    await p.locator(`.choice[data-choice-id="${pickIndex.id}"]`).click();
    await wait(9000);

    const outcome = await p.evaluate(() => {
      const txt = (el) => (el?.textContent ?? '').trim();
      return {
        end: document.querySelectorAll('.end-screen').length > 0,
        endMark: txt(document.querySelector('.end-mark')),
        endStats: [...document.querySelectorAll('.end-stat')].map((e) => txt(e)),
        party: [...document.querySelectorAll('.hint-row')].map((e) => txt(e.querySelector('.hint-text'))),
      };
    });
    if (outcome.end) {
      say(`\n  ▼ ${outcome.endMark}`);
      for (const s of outcome.endStats) say(`     ${s}`);
      break;
    }
  }
  say(`\n  （${room}部屋ぶん記録）`);
  if (errors.length) say(`  ※ 例外: ${errors.join(' / ')}`);
  await p.close();
}

const path = `${OUT}/playtest-${MODE}-${Date.now()}.txt`;
writeFileSync(path, lines.join('\n'), 'utf8');
console.log(`\n書き出し: ${path}`);
await b.close();
