import '@/ui/tokens.css';
import './challenger.css';

import { corePackage } from '@/core/pack';
import type { Choice } from '@/core/schema';
import { GameEngine, type EngineState, type Verdict } from '@/core/engine';
import { AiAdvisorGateway } from '@/core/ai-advisors';
import { liarRangeFor } from '@/core/limits';
import { audio } from '@/ui/audio';
import { choiceArt } from '@/ui/placeholder';
import { playResolution, resetStage, type ResolutionRefs } from '@/ui/death-sequence';
import { t } from '@/i18n/ja';

/**
 * 挑戦者クライアント。
 * 実装順序 2「ローカル1人プレイ」。助言者なし・嘘つきなしで、
 * 部屋表示・選択・死亡演出までを作り込んで手触りを確かめる段。
 * 助言者が入ったときの表示（下部のヒント列と排除）は同じ経路で動く。
 */

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app が無い');

const pack = corePackage();
let engine: GameEngine | null = null;
let unsubscribe: (() => void) | null = null;
let timerHandle = 0;
let resolving = false;
let lastTickSecond = -1;

/* ────────────────────────────── 表題 ────────────────────────────── */

function renderTitle(): void {
  app!.innerHTML = '';
  const screen = el('div', 'title-screen grain vignette');

  const mark = el('h1', 'title-mark');
  mark.textContent = t.title;
  const ruby = el('p', 'title-ruby');
  ruby.textContent = t.titleRuby;
  const tagline = el('p', 'title-tagline');
  tagline.textContent = t.tagline;

  const menu = el('div', 'menu');
  menu.append(
    menuItem(t.menu.solo, t.menu.soloNote, false, () => startGame()),
    menuItem(t.menu.host, t.menu.hostNote, true),
    menuItem(t.menu.advisor, '', true),
  );

  const head = el('div');
  head.append(mark, ruby);
  screen.append(head, tagline, menu);
  app!.append(screen);
}

function menuItem(label: string, note: string, disabled: boolean, onClick?: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'menu-item';
  btn.disabled = disabled;
  const b = document.createElement('b');
  b.textContent = label;
  btn.append(b);
  if (note) {
    const span = document.createElement('span');
    span.textContent = note;
    btn.append(span);
  }
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

/* ────────────────────────────── 対局 ────────────────────────────── */

interface Shell {
  roundId: string | null;
  hud: HTMLElement;
  lives: HTMLElement;
  roomCount: HTMLElement;
  timer: HTMLElement;
  stage: HTMLElement;
  choices: HTMLElement;
  prompt: HTMLElement;
  hints: HTMLElement;
  refs: ResolutionRefs;
}

let shell: Shell | null = null;

function buildShell(): Shell {
  app!.innerHTML = '';

  const hud = el('header', 'hud');
  const lives = el('div', 'lives');
  const roomCount = el('div', 'room-count');
  const timer = el('div', 'timer');
  timer.setAttribute('role', 'timer');
  hud.append(lives, roomCount, timer);

  const stage = el('main', 'stage grain vignette');
  const choices = el('div', 'choices');
  choices.setAttribute('role', 'group');
  const prompt = el('h2', 'prompt');
  stage.append(choices, prompt);

  const hints = el('section', 'hints');
  hints.setAttribute('aria-live', 'polite');

  const lamp = el('div', 'lamp');
  const blackout = el('div', 'blackout');
  const banner = el('div', 'banner');
  banner.setAttribute('role', 'status');

  app!.append(hud, stage, hints, lamp, blackout, banner);

  return {
    roundId: null,
    hud,
    lives,
    roomCount,
    timer,
    stage,
    choices,
    prompt,
    hints,
    refs: { stage, lamp, blackout, banner, chosen: null, others: [], answer: null },
  };
}

function startGame(): void {
  audio.load();
  engine?.dispose();
  shell = buildShell();

  engine = new GameEngine({ pack, gateway: new AiAdvisorGateway({ count: 12 }) });
  unsubscribe = engine.subscribe((state) => render(state));
  engine.start();
  audio.play('room-open');
  startTimerLoop();
}

function render(state: EngineState): void {
  if (!shell) return;
  if (state.phase === 'gameover' || state.phase === 'cleared') {
    renderEnd(state);
    return;
  }
  if (state.phase !== 'choosing') return; // 演出中は再描画しない

  const round = state.round;
  if (!round) return;

  // 同じ部屋のあいだは盤面を作り直さず、助言欄だけ更新する
  if (shell.roundId === round.roundId) {
    renderHints(state, shell);
    return;
  }
  shell.roundId = round.roundId;

  renderLives(shell.lives, state);
  shell.roomCount.textContent = `${t.hud.room(round.roomNumber)}　${t.hud.section(round.sectionIndex + 1, state.sectionCount)}`;
  shell.prompt.textContent = round.room.prompt;

  resetStage(shell.refs);
  renderChoices(round.room.theme, round.room.id, round.room.choices, shell);
  renderHints(state, shell);
}

function renderLives(host: HTMLElement, state: EngineState): void {
  host.innerHTML = '';
  const label = document.createElement('span');
  label.textContent = t.hud.lives;
  host.append(label);
  for (let i = 0; i < state.maxLives; i++) {
    const pip = el('span', `pip${i < state.lives ? '' : ' is-lost'}`);
    host.append(pip);
  }
  host.setAttribute('aria-label', `${t.hud.lives} ${state.lives} / ${state.maxLives}`);
}

const KEYCAPS = ['1', '2', '3', '4', '5', '6', '7', '8'];

function renderChoices(
  theme: string,
  roomId: string,
  choices: readonly Choice[],
  s: Shell,
): void {
  s.choices.innerHTML = '';
  s.choices.dataset['count'] = String(choices.length);

  const buttons: HTMLElement[] = [];
  choices.forEach((choice, i) => {
    const btn = document.createElement('button');
    btn.className = 'choice';
    btn.dataset['choiceId'] = choice.id;
    btn.setAttribute('aria-label', choice.label);

    const key = el('span', 'choice-key');
    key.textContent = KEYCAPS[i] ?? '';
    const img = document.createElement('img');
    img.src = choiceArt(theme, roomId, choice.id, choice.image);
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    const label = el('span', 'choice-label');
    label.textContent = choice.label;

    btn.append(key, img, label);
    btn.addEventListener('pointerenter', () => audio.play('hover'));
    btn.addEventListener('click', () => commit(choice.id));
    s.choices.append(btn);
    buttons.push(btn);
  });

  s.refs.chosen = null;
  s.refs.others = buttons;
  s.refs.answer = null;
}

function renderHints(state: EngineState, s: Shell): void {
  s.hints.innerHTML = '';
  const round = state.round;
  if (!round) return;

  if (round.speakers.length === 0) {
    const empty = el('p', 'hints-empty');
    empty.textContent = t.challenger.hintsNone;
    s.hints.append(empty);
    return;
  }

  const left = round.openLimit - round.opened.length;
  const head = el('div', 'hints-head');
  const count = el('span', 'hints-count');
  count.textContent =
    round.arrivals.length === 0
      ? t.challenger.hintsEmpty
      : `${t.challenger.inbox(round.arrivals.length)}　${t.challenger.liarCount(...liarRangeFor(round.speakers.length))}`;
  const budget = el('span', `hints-budget${left === 0 ? ' is-spent' : ''}`);
  budget.textContent = left > 0 ? t.challenger.openLeft(left) : t.challenger.openNone;
  head.append(count, budget);
  s.hints.append(head);

  const list = el('div', 'hints-list');
  for (const arrival of round.arrivals) {
    const opened = round.opened.find((h) => h.advisorId === arrival.advisorId);
    const row = el('div', `hint-row${opened ? ' is-open' : ''}`);

    const name = el('span', 'hint-name');
    name.textContent = arrival.advisorName;
    if (arrival.record.hit + arrival.record.miss > 0) {
      const rec = el('span', 'hint-record');
      rec.textContent = t.challenger.record(arrival.record.hit, arrival.record.miss);
      name.append(rec);
    }

    let body: HTMLElement;
    if (opened) {
      body = el('span', 'hint-text');
      body.textContent = opened.text;
    } else {
      const btn = document.createElement('button');
      btn.className = 'hint-open';
      btn.textContent = left > 0 ? t.challenger.open : t.challenger.unopened;
      btn.disabled = left === 0;
      btn.addEventListener('click', () => {
        audio.play('hover');
        engine?.openHint(arrival.advisorId);
      });
      body = btn;
    }

    row.append(name, body);

    // 黙らせられるのは、助言を読んだ相手だけ。読んでいない相手を裁く材料は無い
    if (opened) {
      const silence = document.createElement('button');
      silence.className = 'hint-silence';
      silence.textContent = round.silenceUsed ? t.challenger.silenceDone : t.challenger.silence;
      silence.disabled = round.silenceUsed;
      silence.addEventListener('click', () => {
        const result = engine?.silence(arrival.advisorId);
        if (result) announce(result.hit ? t.challenger.silenceHit : t.challenger.silenceMiss);
      });
      row.append(silence);
    }
    list.append(row);
  }
  s.hints.append(list);
}

/* ─────────────────────────── 選択と演出 ─────────────────────────── */

function commit(choiceId: string): void {
  if (!engine || !shell || resolving) return;
  const state = engine.snapshot();
  if (state.phase !== 'choosing') return;

  resolving = true;
  stopTimerLoop();
  audio.play('commit');

  const chosen = shell.choices.querySelector<HTMLElement>(`[data-choice-id="${CSS.escape(choiceId)}"]`);
  shell.refs.chosen = chosen;
  shell.refs.others = [...shell.choices.querySelectorAll<HTMLElement>('.choice')].filter((n) => n !== chosen);
  for (const btn of shell.choices.querySelectorAll('button')) btn.disabled = true;
  for (const btn of shell.hints.querySelectorAll('button')) btn.disabled = true;

  engine.choose(choiceId);
  runResolution();
}

function timeOut(): void {
  if (!engine || !shell || resolving) return;
  resolving = true;
  stopTimerLoop();
  shell.refs.chosen = null;
  shell.refs.others = [...shell.choices.querySelectorAll<HTMLElement>('.choice')];
  for (const btn of shell.choices.querySelectorAll('button')) btn.disabled = true;
  engine.timeUp();
  runResolution();
}

async function runResolution(): Promise<void> {
  if (!engine || !shell) return;
  const verdict = engine.snapshot().verdict;
  if (!verdict) {
    resolving = false;
    return;
  }

  shell.refs.answer =
    shell.choices.querySelector<HTMLElement>(`[data-choice-id="${CSS.escape(verdict.correctId)}"]`) ?? null;

  markLosingLife(verdict);
  await playResolution(shell.refs, verdict, { advance: () => engine?.advancePresentation() });

  resolving = false;
  const next = engine.snapshot();
  engine.advancePresentation(); // verdict → 次の部屋 / 終了

  const after = engine.snapshot();
  if (after.phase === 'choosing' && next.phase !== 'gameover') {
    resetStage(shell.refs);
    audio.play('room-open');
    startTimerLoop();
  }
}

function markLosingLife(verdict: Verdict): void {
  if (verdict.survived || !shell) return;
  const pips = shell.lives.querySelectorAll('.pip:not(.is-lost)');
  const last = pips[pips.length - 1];
  last?.classList.add('is-losing');
}

/* ───────────────────────────── 時計 ───────────────────────────── */

function startTimerLoop(): void {
  stopTimerLoop();
  lastTickSecond = -1;
  const step = (): void => {
    const state = engine?.snapshot();
    if (!state || !shell || state.phase !== 'choosing' || !state.round) return;

    const left = Math.max(0, state.round.deadlineAt - Date.now());
    const seconds = Math.ceil(left / 1000);
    shell.timer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    shell.timer.classList.toggle('is-low', seconds <= 10);

    if (seconds <= 10 && seconds !== lastTickSecond && seconds > 0) {
      lastTickSecond = seconds;
      audio.play('tick');
    }
    if (left <= 0) {
      timeOut();
      return;
    }
    timerHandle = requestAnimationFrame(step);
  };
  timerHandle = requestAnimationFrame(step);
}

function stopTimerLoop(): void {
  if (timerHandle) cancelAnimationFrame(timerHandle);
  timerHandle = 0;
}

/* ───────────────────────────── 終了 ───────────────────────────── */

function renderEnd(state: EngineState): void {
  stopTimerLoop();
  const dead = state.phase === 'gameover';
  audio.play(dead ? 'gameover' : 'survive');

  const screen = el('div', 'end-screen grain vignette');
  const mark = el('h1', `end-mark${dead ? ' is-death' : ''}`);
  mark.textContent = dead ? t.verdict.gameover : t.verdict.cleared;

  const stat = el('p', 'end-stat');
  stat.textContent = t.verdict.reached(state.totalCleared);

  // 嘘つきが誰だったかを全員に開示する
  const reveal = el('p', 'end-stat');
  const liars = new Set(state.liarLog.flatMap((r) => [...r.liarIds]));
  const names = state.advisors.filter((a) => liars.has(a.id)).map((a) => a.name);
  reveal.textContent =
    names.length > 0 ? t.verdict.reveal(names.join(t.verdict.nameSeparator)) : t.verdict.revealNone;

  const again = document.createElement('button');
  again.className = 'end-action';
  again.textContent = t.verdict.retry;
  again.addEventListener('click', () => {
    resolving = false;
    unsubscribe?.();
    engine?.dispose();
    engine = null;
    renderTitle();
  });

  screen.append(mark, stat, reveal, again);
  app!.append(screen);
  again.focus();
}

/* ───────────────────────────── 補助 ───────────────────────────── */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function announce(message: string): void {
  const live = document.createElement('p');
  live.className = 'sr-only';
  live.setAttribute('role', 'status');
  live.textContent = message;
  document.body.append(live);
  setTimeout(() => live.remove(), 2000);
}

// 数字キーで選ぶ。配信中にマウスを探させない
window.addEventListener('keydown', (event) => {
  if (!shell || resolving) return;
  const index = KEYCAPS.indexOf(event.key);
  if (index < 0) return;
  const buttons = shell.choices.querySelectorAll<HTMLButtonElement>('.choice');
  buttons[index]?.click();
});

renderTitle();
