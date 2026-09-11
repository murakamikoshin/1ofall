/**
 * 実際に遊んで、遊んだ中身をそのまま書き出す。
 *
 * 数字ではなく「その部屋で何が読めたか」を残すのが目的。
 * 面白いかどうかは、助言の文面と手掛かりを並べて見ないと分からない。
 *
 *   node tools/playtest-record.mjs <出力先> [mode] [runs]
 */
import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 言い回しの判定は本体（src/i18n）から取る。
 *
 * ここに書き写していたら、「◯◯で間違いない」を
 * `/…|ない/` が拾って**一番強い断言を警告として読んでいた。**
 * そのせいで、この道具で遊んだ記録はずっと悪い側に寄っていた。
 * 書き写しは必ずずれるので、原本から読む。
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const i18n = readFileSync(resolve(root, 'src/i18n/ja.ts'), 'utf8');
const patternOf = (name) => {
  const m = new RegExp(`${name}: /(.+?)/,`).exec(i18n);
  if (!m) throw new Error(`${name} を src/i18n/ja.ts から読めない`);
  return m[1];
};
const AVOID_SRC = patternOf('avoidPattern');
const HEDGE_SRC = patternOf('hedgePattern');

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
/*
 * 周をまたいで**同じ入れ物**で遊ぶ。
 *
 * 周ごとに `browser.newPage()` していたので、周ごとに別の入れ物になり
 * localStorage が空から始まっていた。常連（顔ぶれと裏切り歴）は
 * そこに積むので、**記録の道具だけが常連を一度も見ていなかった。**
 */
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
const started = Date.now();
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
      /*
       * 名前の欄には記録（正n 嘘n）と常連の裏切り歴が入れ子で入っている。
       * textContent から後ろを正規表現で削っていたが、札が増えるたびに
       * 崩れる。**自分の字だけ**を読む。
       */
      name: (el.querySelector('.hint-name')?.childNodes[0]?.textContent ?? '').trim(),
      record: txt(el.querySelector('.hint-record')),
      past: txt(el.querySelector('.hint-past')),
      // 全員挑戦者で二人から札が付いた者に出る印。本文の中に入れ子で入っているので、
      // 本文は自分の字だけを読む（でないと「〜で間違いない 押されている」と繋がる）
      pressed: !!el.querySelector('.hint-pressed'),
      text: (el.querySelector('.hint-text')?.childNodes[0]?.textContent ?? '').trim(),
      // 人を指した一言は扉の話と分けて見たい
      call: el.classList.contains('is-call'),
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
  // 演出の「間」を短い側にする（仕様として残っている道。飛ばしてはいない）
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.addInitScript(() => {
    for (const m of ['standard', 'brink', 'party']) localStorage.setItem(`briefed:${m}`, '1');
  });
  // ?fast=1 は AI が何秒後に喋るかだけを縮める。遊びの中身は変わらない
  await p.goto('http://127.0.0.1:4173/?lang=ja&fast=1', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: new RegExp('^' + LABEL) }).click();
  await p.waitForSelector('.choice', { timeout: 10000 });

  const isParty = MODE === 'party';
  say(`\n${'='.repeat(70)}\n${LABEL}　${run}周目\n${'='.repeat(70)}`);

  let room = 0;
  let deaths = 0;
  let lastRoom = '';
  /** 送った答え合わせ。生死を書いたあとに続けて書き出す */
  let pendingSheet = null;

  for (let guard = 0; guard < 400; guard++) {
    if (await p.locator('.end-screen').count()) break;

    /*
     * 区画の答え合わせ（16回目に足した段）。
     *
     * **この道具はここで止まっていた。** 紙が盤面を覆うので助言の数が
     * 増えなくなり、「出そろった」と見なして空回りし、5部屋目——
     * ちょうど区画の切れ目——で記録が終わっていた。
     * 遊びの一部なので、送るだけでなく中身も書き出す。
     */
    if (await p.locator('.answer-veil').count()) {
      const sheet = await p.evaluate(() => ({
        head: (document.querySelector('.answer-heading')?.textContent ?? '').trim(),
        score: (document.querySelector('.answer-score')?.textContent ?? '').trim(),
        /*
         * 名前の欄には「疑っていた」の札が、記録の欄には「積んで、崩した」が
         * **入れ子で**入っている。textContent をそのまま読むと
         * 「たろう疑っていた」「正4 嘘2積んで、崩した」と繋がって出る。
         * 自分の字と入れ子を分けて読む。
         */
        rows: [...document.querySelectorAll('.answer-row')].map((r) => {
          const own = (sel) => {
            const el = r.querySelector(sel);
            if (!el) return '';
            return [...el.childNodes]
              .filter((n) => n.nodeType === 3)
              .map((n) => (n.textContent ?? '').trim())
              .join('')
              .trim();
          };
          const nested = (sel) => (r.querySelector(sel)?.textContent ?? '').trim();
          return {
            name: own('.answer-name'),
            role: own('.answer-role'),
            rec: own('.answer-record'),
            mark: nested('.answer-mark'),
            built: nested('.answer-built'),
          };
        }),
      }));
      pendingSheet = sheet;
      await p.locator('.answer-go').click().catch(() => {});
      await wait(300);
      continue;
    }
    if (!(await p.locator('.choice').count())) { await wait(120); continue; }

    // 助言が出そろうのを待つ（人間もそうする）。
    // 決め打ちの秒数ではなく、増えなくなるまで見る。
    // 名指しは扉の話が出そろったあとに来るので、止まってからも少し待つ
    let seen = -1;
    let still = 0;
    let veilHere = false;
    for (let t = 0; t < 60; t++) {
      /*
       * ここでも紙を見る。
       *
       * 全員挑戦者の紙は7秒で自分から消えるので、部屋が長引いた回は
       * **この待ちのあいだに出て消えていた**（同じ条件で撮り直したら
       * 三枚とも出たので、取りこぼしは時間の綾）。
       */
      if (await p.locator('.answer-veil').count()) { veilHere = true; break; }
      const n = await p.locator('.hint-row').count();
      if (n > 0 && n === seen) { if (++still >= 6) break; } else still = 0;
      seen = n;
      await wait(150);
    }
    if (veilHere) continue;
    const board = await readBoard(p, isParty);
    // 部屋の番号だけで見分けると、死んで区画の頭へ戻ったときに
    // 「1部屋目 1/4」が前と同じ文字列になり、以降ずっと同じ部屋と見なして
    // 一行も記録しないまま空回りする（実際にそうなっていた）。問いも鍵に入れる
    const key = `${board.room}|${board.prompt}`;
    if (key === lastRoom) { await wait(200); continue; }
    lastRoom = key;
    room++;

    /*
     * 道具を使う。使わないと、読んでいる記録が「素朴な打ち手」のものになる。
     *
     * 崖っぷちの黙らせるは、実測で腕の差を開かせている道具そのものなのに
     * この記録には一度も出てこなかった（9部屋読んで気づいた）。
     * 疑いの札も置いていなかったので、答え合わせの点がいつも
     * 「誰も疑わなかった」だった。
     */
    const suspects = board.hints
      .filter((h) => !h.call && /正(\d+)\s*嘘(\d+)/.test(h.record))
      .map((h) => {
        const m = /正(\d+)\s*嘘(\d+)/.exec(h.record);
        return { name: h.name, hit: Number(m[1]), miss: Number(m[2]) };
      })
      .filter((x) => x.miss > x.hit)
      .sort((a, b) => b.miss - a.miss - (b.hit - a.hit));

    // 疑いの札。記録が崩れている者に置く（答え合わせで突き合わせる）
    for (const s2 of suspects.slice(0, 2)) {
      const row = p.locator('.hint-row', { hasText: s2.name }).first();
      const btn = row.locator('.hint-doubt:not(.is-on)');
      if (await btn.count()) { await btn.first().click().catch(() => {}); }
    }

    // 崖っぷちの黙らせる。一番崩れている者を狙う
    let silenced = null;
    if (MODE === 'brink' && suspects.length > 0) {
      const row = p.locator('.hint-row', { hasText: suspects[0].name }).first();
      const btn = row.locator('.hint-silence:not([disabled])');
      if (await btn.count()) {
        await btn.first().click().catch(() => {});
        await wait(400);
        const notice = await p.evaluate(() => (document.querySelector('.hud-notice')?.textContent ?? '').trim());
        silenced = `${suspects[0].name}（正${suspects[0].hit} 嘘${suspects[0].miss}）→ ${notice}`;
      }
    }

    say(`\n── ${board.room}　残り${board.timer} ──`);
    if (isParty) say(`  席: ${board.seats.map((s) => `${s.name}${'●'.repeat(s.lives)}`).join('  ')}`);
    else say(`  命: ${board.lives}`);
    say(`  「${board.prompt}」`);
    for (const c of board.choices) say(`    ${c.mark ? '◆' : '・'}${c.label}${c.mark ? `（${c.mark}）` : ''}`);
    say(`  助言 ${board.hints.length}件:`);
    for (const h of board.hints) {
      const marks = [h.record, h.past].filter(Boolean).join(' ');
      say(`   ${h.call ? '＞' : ' '}${h.name}（${marks}） 「${h.text}」${h.pressed ? '　◀ 押されている' : ''}`);
    }

    // 設計どおりの読み方をなぞる：迷いを重く見て、記録で重みを変える。
    // 判定の言い回しは本体（src/i18n/ja.ts）から取る
    if (silenced) say(`  ◇ 黙らせた: ${silenced}`);
    if (suspects.length) say(`  ◇ 疑いの札: ${suspects.slice(0, 2).map((x) => x.name).join('、')}`);

    const pickIndex = await p.evaluate(({ avoidSrc, hedgeSrc }) => {
      const AVOID = new RegExp(avoidSrc);
      const HEDGE = new RegExp(hedgeSrc);
      const txt = (el) => (el?.textContent ?? '').trim();
      const choices = [...document.querySelectorAll('.choice')].map((el) => ({
        id: el.dataset.choiceId,
        label: txt(el.querySelector('.choice-label')),
        mine: !!txt(el.querySelector('.choice-known')),
        fatal: el.classList.contains('is-fatal'),
      }));
      const rows = [...document.querySelectorAll('.hint-row')].map((el) => ({
        text: txt(el.querySelector('.hint-text')),
        name: txt(el.querySelector('.hint-name')).replace(/正\d+\s*嘘\d+$/, '').trim(),
        rec: txt(el.querySelector('.hint-record')),
        call: el.classList.contains('is-call'),
      }));
      const score = new Map(choices.map((c) => [c.id, 0]));
      const bump = (id, by) => score.set(id, (score.get(id) ?? 0) + by);
      const trust = (r) => {
        const m = /正(\d+)\s*嘘(\d+)/.exec(r.rec);
        const hit = m ? Number(m[1]) : 0;
        const miss = m ? Number(m[2]) : 0;
        return (hit + 1) / (hit + miss + 2);
      };
      for (const c of choices) {
        if (c.mine && !c.fatal) bump(c.id, 2.5);
        if (c.fatal) bump(c.id, -99);
      }

      // 撃たれた者ほど正解を口にしている（本体 src/core/read-hints.ts と同じ向き）。
      // 嘘つきは全員が同じ正解を知っているので、真実を言った者に群がるしかない
      const shot = new Map();
      for (const r of rows) {
        if (!r.call) continue;
        const target = rows
          .filter((o) => !o.call && o.name && r.text.includes(o.name))
          .sort((a, b) => b.name.length - a.name.length)[0];
        if (!target) continue;
        const doubt = !/本当だ|信じろ|正しい|乗れ/.test(r.text.split(target.name).join('　'));
        shot.set(target.name, (shot.get(target.name) ?? 0) + (doubt ? 1 : -0.5));
      }

      for (const r of rows) {
        if (r.call) continue;
        const net = shot.get(r.name) ?? 0;
        const w = trust(r) * Math.max(0.2, Math.min(2.6, 1 + net * 0.9));
        const touched = choices.filter((c) => c.label && r.text.includes(c.label));
        if (!touched.length) continue;
        // 言い回しを見る前に選択肢の名前を外す（名前の中の否定語で読み違えるため）
        let rest = r.text;
        for (const c of touched) rest = rest.split(c.label).join('　');
        if (AVOID.test(rest)) { for (const c of touched) bump(c.id, -w * 1.2); continue; }
        const hedging = touched.length >= 2 || HEDGE.test(rest);
        for (const c of touched) bump(c.id, w * (hedging ? 1.25 : 0.8));
      }

      let best = -Infinity, bestId = choices[0]?.id;
      for (const c of choices) {
        const v = score.get(c.id) ?? 0;
        if (v > best) { best = v; bestId = c.id; }
      }
      const tie = choices.filter((c) => (score.get(c.id) ?? 0) === best).length;
      return { id: bestId, label: choices.find((c) => c.id === bestId)?.label, tie, scores: choices.map((c) => `${c.label}:${(score.get(c.id) ?? 0).toFixed(2)}`) };
    }, { avoidSrc: AVOID_SRC, hedgeSrc: HEDGE_SRC });
    say(`  → 「${pickIndex.label}」を選ぶ${pickIndex.tie > 1 ? `（同点${pickIndex.tie}つ＝運任せ）` : ''}`);
    say(`     点: ${pickIndex.scores.join('  ')}`);

    await p.locator(`.choice[data-choice-id="${pickIndex.id}"]`).click();
    // 演出が終わって次の部屋か終わりの画面が出るまで待つ
    for (let t = 0; t < 120; t++) {
      const done = await p.evaluate((prev) => {
        const t = (s) => (document.querySelector(s)?.textContent ?? '').trim();
        const now = `${t('.room-count')}|${t('.prompt')}`;
        return document.querySelectorAll('.end-screen').length > 0
          // 区画の切れ目では答え合わせが挟まる。部屋の名は変わらないので、
          // これを見ないと14秒待って空振りする
          || document.querySelectorAll('.answer-veil').length > 0
          || (t('.room-count') !== '' && now !== prev);
      }, key);
      if (done) break;
      await wait(120);
    }

    /*
     * 区画の答え合わせは**命を読む前に**送る。
     *
     * 紙が乗っているあいだ盤面は描き直されないので、失った命の印が
     * まだ付いていない。紙が出た部屋の生死をここで読むと、
     * 死んだ回を「通った」と書いてしまう（実際にそう記録していた）。
     */
    if (await p.locator('.answer-veil').count()) {
      const sheet = await p.evaluate(() => ({
        head: (document.querySelector('.answer-heading')?.textContent ?? '').trim(),
        score: (document.querySelector('.answer-score')?.textContent ?? '').trim(),
        /*
         * 名前の欄には「疑っていた」の札が、記録の欄には「積んで、崩した」が
         * **入れ子で**入っている。textContent をそのまま読むと
         * 「たろう疑っていた」「正4 嘘2積んで、崩した」と繋がって出る。
         * 自分の字と入れ子を分けて読む。
         */
        rows: [...document.querySelectorAll('.answer-row')].map((r) => {
          const own = (sel) => {
            const el = r.querySelector(sel);
            if (!el) return '';
            return [...el.childNodes]
              .filter((n) => n.nodeType === 3)
              .map((n) => (n.textContent ?? '').trim())
              .join('')
              .trim();
          };
          const nested = (sel) => (r.querySelector(sel)?.textContent ?? '').trim();
          return {
            name: own('.answer-name'),
            role: own('.answer-role'),
            rec: own('.answer-record'),
            mark: nested('.answer-mark'),
            built: nested('.answer-built'),
          };
        }),
      }));
      pendingSheet = sheet;
      await p.locator('.answer-go').click().catch(() => {});
      for (let t = 0; t < 60; t++) {
        const ready = await p.evaluate(() => document.querySelectorAll('.answer-veil').length === 0
          && (document.querySelectorAll('.choice').length > 0
            || document.querySelectorAll('.end-screen').length > 0));
        if (ready) break;
        await wait(150);
      }
    }

    const outcome = await p.evaluate(() => {
      const txt = (el) => (el?.textContent ?? '').trim();
      return {
        lives: document.querySelectorAll('.pip:not(.is-lost)').length,
        end: document.querySelectorAll('.end-screen').length > 0,
        endMark: txt(document.querySelector('.end-mark')),
        // 命が尽きた部屋では盤面が描き直されないので、失った命の印が付かない。
        // 最後の死をずっと「通った」と書いていた
        endDeath: document.querySelectorAll('.end-mark.is-death').length > 0,
        // 隠してある行（札を置かなかった周の「読み」など）は数えない。
        // textContent だけ見ていたので、出ていない行を記録に書いていた
        endStats: [...document.querySelectorAll('.end-stat')].filter((e) => !e.hidden).map((e) => txt(e)),
        party: [...document.querySelectorAll('.hint-row')].map((e) => txt(e.querySelector('.hint-text'))),
      };
    });
    if (!isParty) {
      const dropped = board.lives !== null && outcome.lives < board.lives;
      const lost = dropped || (outcome.end && outcome.endDeath);
      // 命が尽きた回は印が更新されないので、数の遷移を書くと「1→1」になる
      say(`     ${lost ? (dropped ? `✗ 死んだ（命 ${board.lives}→${outcome.lives}）` : '✗ 死んだ（命が尽きた）') : '○ 通った'}`);
      if (lost) deaths++;
    }
    if (pendingSheet) {
      say(`\n  ▽ ${pendingSheet.head}`);
      for (const r of pendingSheet.rows) {
        say(`     ${r.role === '嘘つき' ? '●' : '○'} ${r.name}${r.mark ? `（${r.mark}）` : ''}　${
          r.role}　${r.rec}${r.built ? `　← ${r.built}` : ''}`);
      }
      if (pendingSheet.score) say(`     ${pendingSheet.score}`);
      pendingSheet = null;
    }
    if (outcome.end) {
      say(`\n  ▼ ${outcome.endMark}`);
      for (const s of outcome.endStats) say(`     ${s}`);
      break;
    }
  }
  say(`\n  （${room}部屋ぶん記録${isParty ? '' : `　死 ${deaths}`}）`);
  if (errors.length) say(`  ※ 例外: ${errors.join(' / ')}`);
  await p.close();
}

const path = `${OUT}/playtest-${MODE}-${Date.now()}.txt`;
writeFileSync(path, lines.join('\n'), 'utf8');
console.log(`\n書き出し: ${path}　（${((Date.now() - started) / 1000).toFixed(0)}秒）`);
await b.close();
