import '@/ui/tokens.css';
import '@/ui/font.css';
import './challenger.css';

import { corePackage } from '@/core/pack';
import type { Choice } from '@/core/schema';
import { GameEngine, type EngineState, type Verdict } from '@/core/engine';
import { RemoteGame, type GameHandle } from './remote-game';
import type { Advice } from '@/core/engine';
import { AiAdvisorGateway } from '@/core/ai-advisors';
import { MODES, type ModeId } from '@/core/limits';

import { audio } from '@/ui/audio';
import { choiceArt } from '@/ui/placeholder';
import { playResolution, resetStage, type ResolutionRefs } from '@/ui/death-sequence';
import { strings, localized, detectLocale, setLocale, rememberLocale, LOCALES, LOCALE_NAMES, type Locale } from '@/i18n';

/**
 * 挑戦者クライアント。
 * 実装順序 2「ローカル1人プレイ」。助言者なし・嘘つきなしで、
 * 部屋表示・選択・死亡演出までを作り込んで手触りを確かめる段。
 * 助言者が入ったときの表示（下部のヒント列と排除）は同じ経路で動く。
 */

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app が無い');

const pack = corePackage();
let currentLocale: Locale = detectLocale();
setLocale(currentLocale);
let engine: GameHandle | null = null;
let unsubscribe: (() => void) | null = null;
let timerHandle = 0;
let resolving = false;
let currentMode: ModeId = 'standard';
let lastTickSecond = -1;

/* ────────────────────────────── 表題 ────────────────────────────── */

function renderTitle(): void {
  app!.innerHTML = '';
  const screen = el('div', 'title-screen grain vignette');

  const mark = el('h1', 'title-mark');
  mark.textContent = strings().title;
  const ruby = el('p', 'title-ruby');
  ruby.textContent = strings().titleRuby;
  const tagline = el('p', 'title-tagline');
  tagline.textContent = strings().tagline;

  const menu = el('div', 'menu');
  const T = strings();
  const withBest = (modeId: ModeId, note: string): string => {
    const best = bestFor(modeId);
    return best > 0 ? `${note}　—　${T.menu.bestShort(best)}` : note;
  };
  menu.append(
    menuItem(T.menu.solo, withBest('standard', T.menu.soloNote), false, () => enterMode('standard')),
    menuItem(T.menu.brink, withBest('brink', T.menu.brinkNote), false, () => enterMode('brink')),
    menuItem(T.menu.party, withBest('party', T.menu.partyNote), false, () => enterMode('party')),
    // 野良と賭場は通信層（段階4）が入ってから開く
    menuItem(T.menu.random, `${T.menu.randomNote}（${T.menu.comingSoon}）`, true),
    // 賭場は通信先が設定されているときだけ開く
    menuItem(
      T.menu.host,
      PARTY_HOST ? T.menu.hostNote : `${T.menu.hostNote}（${T.menu.comingSoon}）`,
      !PARTY_HOST,
      PARTY_HOST ? () => hostGame() : undefined,
    ),
  );

  const head = el('div');
  head.append(mark, ruby);
  screen.append(head, tagline, menu, renderBriefingLink(), renderLanguagePicker());
  app!.append(screen);
}

/* ───────────────────────────── 手引き ───────────────────────────── */

/**
 * 一部屋目に入る前に、そのモードで何が起きるかを一度だけ渡す。
 * 「嘘つきは区画のあいだ変わらない」「多数決は罠」の二つを知らずに入ると、
 * 初回はほぼ確実に死ぬ。読んだかどうかはモードごとに覚える。
 */
function briefingSeenKey(modeId: ModeId): string {
  return `briefed:${modeId}`;
}

function hasBeenBriefed(modeId: ModeId): boolean {
  try {
    return window.localStorage.getItem(briefingSeenKey(modeId)) === '1';
  } catch {
    return false; // 保存できない環境では毎回出す。出しすぎる方がまだ親切
  }
}

function markBriefed(modeId: ModeId): void {
  try {
    window.localStorage.setItem(briefingSeenKey(modeId), '1');
  } catch {
    // 保存できなくても進行には関わらない
  }
}

/* ─────────────────────────── 最高到達 ─────────────────────────── */

/**
 * 1周が10分を超えるのに、死んでも何も残らないと二度目を始めにくい。
 * 到達部屋数だけを覚えておいて、次に越える目標にする。
 * モードごとに部屋数が違うので記録も分ける。
 */
function bestKey(modeId: ModeId): string {
  return `best:${modeId}`;
}

function bestFor(modeId: ModeId): number {
  try {
    const raw = Number(window.localStorage.getItem(bestKey(modeId)));
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  } catch {
    return 0;
  }
}

/** 更新したときだけ true。演出の出し分けに使う */
function recordBest(modeId: ModeId, reached: number): boolean {
  if (reached <= bestFor(modeId)) return false;
  try {
    window.localStorage.setItem(bestKey(modeId), String(reached));
  } catch {
    return false; // 保存できない環境では「更新した」と言わない
  }
  return true;
}

function enterMode(modeId: ModeId): void {
  if (hasBeenBriefed(modeId)) {
    startGame(modeId);
    return;
  }
  renderBriefing(modeId, () => {
    markBriefed(modeId);
    startGame(modeId);
  });
}

function renderBriefingLink(): HTMLElement {
  const wrap = el('div', 'brief-link-row');
  const btn = document.createElement('button');
  btn.className = 'brief-link';
  btn.textContent = strings().briefing.open;
  btn.addEventListener('click', () => renderBriefing(null, renderTitle));
  wrap.append(btn);
  return wrap;
}

/**
 * modeId が null なら全モードぶんを並べる（表題から読むとき）。
 * onDone は「入る」「戻る」どちらでも呼ばれる。
 */
function renderBriefing(modeId: ModeId | null, onDone: () => void): void {
  const T = strings().briefing;
  app!.innerHTML = '';
  const screen = el('div', 'brief-screen grain vignette');
  screen.setAttribute('role', 'dialog');
  screen.setAttribute('aria-modal', 'true');

  const sheet = el('div', 'brief-sheet');
  const heading = el('h2', 'brief-heading');
  heading.textContent = T.heading;
  sheet.append(heading);

  sheet.append(briefBlock(T.rulesHeading, T.rules));

  const modeNames = strings().menu;
  const blocks: ReadonlyArray<readonly [ModeId, string]> = [
    ['standard', modeNames.solo],
    ['brink', modeNames.brink],
    ['party', modeNames.party],
  ];
  for (const [id, name] of blocks) {
    if (modeId !== null && id !== modeId) continue;
    sheet.append(briefBlock(name, T.modes[id]));
  }

  const note = el('p', 'brief-note');
  note.textContent = modeId === null ? '' : T.onceNote;
  if (note.textContent) sheet.append(note);

  const go = document.createElement('button');
  go.className = 'brief-go';
  go.textContent = modeId === null ? T.close : T.begin;
  go.addEventListener('click', onDone);
  sheet.append(go);

  screen.append(sheet);
  app!.append(screen);
  go.focus();
}

function briefBlock(heading: string, lines: readonly string[]): HTMLElement {
  const block = el('section', 'brief-block');
  const h = el('h3', 'brief-block-head');
  h.textContent = heading;
  const list = document.createElement('ul');
  list.className = 'brief-list';
  for (const line of lines) {
    const li = document.createElement('li');
    li.textContent = line;
    list.append(li);
  }
  block.append(h, list);
  return block;
}

/** 対局中に読み返す。持ち時間は止める */
function openBriefingDuringRun(modeId: ModeId): void {
  if (!engine || resolving) return;
  const T = strings().briefing;
  engine.pause();
  stopTimerLoop();

  const veil = el('div', 'brief-veil');
  veil.setAttribute('role', 'dialog');
  veil.setAttribute('aria-modal', 'true');

  const sheet = el('div', 'brief-sheet');
  const heading = el('h2', 'brief-heading');
  heading.textContent = T.heading;
  const paused = el('p', 'brief-note');
  paused.textContent = engine?.canPause ? T.pausedNote : T.runningNote;
  sheet.append(heading, paused, briefBlock(T.rulesHeading, T.rules), briefBlock(labelForMode(modeId), T.modes[modeId]));

  const close = document.createElement('button');
  close.className = 'brief-go';
  close.textContent = T.close;
  const dismiss = (): void => {
    veil.remove();
    document.removeEventListener('keydown', onKey);
    engine?.resume();
    if (engine?.snapshot().phase === 'choosing') startTimerLoop();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
    }
  };
  close.addEventListener('click', dismiss);
  document.addEventListener('keydown', onKey);
  sheet.append(close);
  veil.append(sheet);
  app!.append(veil);
  close.focus();
}

function labelForMode(modeId: ModeId): string {
  const m = strings().menu;
  return modeId === 'brink' ? m.brink : modeId === 'party' ? m.party : m.solo;
}

function renderLanguagePicker(): HTMLElement {
  const wrap = el('div', 'lang');
  const label = el('span', 'lang-label');
  label.textContent = strings().language.label;
  wrap.append(label);
  for (const locale of LOCALES) {
    const btn = document.createElement('button');
    btn.className = `lang-option${locale === currentLocale ? ' is-on' : ''}`;
    btn.textContent = LOCALE_NAMES[locale];
    btn.addEventListener('click', () => switchLocale(locale));
    wrap.append(btn);
  }
  return wrap;
}

function switchLocale(locale: Locale): void {
  currentLocale = locale;
  setLocale(locale);
  rememberLocale(locale);
  renderTitle();
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
  const right = el('div', 'hud-right');
  const guide = document.createElement('button');
  guide.className = 'hud-guide';
  guide.type = 'button';
  guide.textContent = '?';
  guide.title = strings().briefing.open;
  guide.setAttribute('aria-label', strings().briefing.open);
  guide.addEventListener('click', () => openBriefingDuringRun(currentMode));
  right.append(timer, guide);
  hud.append(lives, roomCount, right);

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

function startGame(modeId: ModeId): void {
  currentMode = modeId;
  audio.load();
  engine?.dispose();
  shell = buildShell();

  // ソロは全員 AI。野良になっても本体はこの境界の先を知らない
  //（CompositeAdvisorGateway が人間と AI を混ぜて同じ顔で渡す）
  const mode = MODES[modeId];
  const local = new GameEngine({ pack, mode, gateway: new AiAdvisorGateway({ count: 12, mode }) });
  engine = local;
  unsubscribe = local.subscribe((state) => render(state));
  local.start();
  audio.play('room-open');
  startTimerLoop();
}

/* ─────────────────────────── 賭場を開く ─────────────────────────── */

const PARTY_HOST = import.meta.env['VITE_PARTY_HOST'] ?? '';
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 見間違えやすい字（I・O・0・1）を外した6文字 */
function newRoomCode(): string {
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return out;
}

function hostGame(): void {
  const code = newRoomCode();
  const remote = new RemoteGame(PARTY_HOST, code, currentLocale);
  engine?.dispose();
  engine = remote;
  renderLobby(code, remote);
  void remote.connect().catch(() => renderLobbyError(code));
}

function renderLobby(code: string, remote: RemoteGame): void {
  const T = strings();
  app!.innerHTML = '';
  const screen = el('div', 'title-screen grain vignette');

  const heading = el('h2', 'lobby-heading');
  heading.textContent = T.lobby.heading;

  const codeBox = el('p', 'lobby-code');
  codeBox.textContent = code;

  const where = el('p', 'lobby-where');
  where.textContent = T.lobby.where(`${location.origin}/advisor.html`);

  const count = el('p', 'lobby-count');

  // 賭場でもモードは選べる。全員挑戦者なら、来た人も自分の扉を選ぶ
  let chosenMode: ModeId = 'standard';
  const modes = el('div', 'lobby-modes');
  const modeButtons: HTMLButtonElement[] = [];
  for (const [id, label] of [
    ['standard', T.menu.solo],
    ['brink', T.menu.brink],
    ['party', T.menu.party],
  ] as ReadonlyArray<readonly [ModeId, string]>) {
    const btn = document.createElement('button');
    btn.className = `lobby-mode${id === chosenMode ? ' is-on' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      chosenMode = id;
      currentMode = id;
      for (const other of modeButtons) other.classList.toggle('is-on', other === btn);
    });
    modeButtons.push(btn);
    modes.append(btn);
  }

  const begin = document.createElement('button');
  begin.className = 'menu-item lobby-begin';
  begin.textContent = T.lobby.begin;
  begin.addEventListener('click', () => {
    currentMode = chosenMode;
    audio.load();
    shell = buildShell();
    unsubscribe = remote.subscribe((state) => render(state));
    remote.start(chosenMode);
    audio.play('room-open');
    startTimerLoop();
  });

  const back = document.createElement('button');
  back.className = 'brief-link';
  back.textContent = T.briefing.close;
  back.addEventListener('click', () => {
    remote.dispose();
    engine = null;
    renderTitle();
  });

  remote.onStatus((status, roster) => {
    const humans = roster.filter((a) => a.kind === 'human').length;
    count.textContent = status === 'closed' ? T.lobby.lost : T.lobby.waiting(humans);
    begin.disabled = status === 'connecting' || status === 'closed';
  });

  screen.append(heading, codeBox, where, count, modes, begin, back);
  app!.append(screen);
}

function renderLobbyError(code: string): void {
  const T = strings();
  app!.innerHTML = '';
  const screen = el('div', 'title-screen grain vignette');
  const line = el('p', 'lobby-where');
  line.textContent = `${T.errors.roomNotFound}（${code}）`;
  const back = document.createElement('button');
  back.className = 'menu-item';
  back.textContent = T.briefing.close;
  back.addEventListener('click', renderTitle);
  screen.append(line, back);
  app!.append(screen);
}

/**
 * 状態が条件を満たすまで待つ。
 * ローカルの本体は同期なので即座に返り、遠くの部屋では返事を待つ。
 * 描画側がどちらで動いているかを気にしなくて済むようにするための一枚。
 */
function waitFor(test: (state: EngineState) => boolean, timeoutMs = 10_000): Promise<EngineState | null> {
  const current = engine?.snapshot();
  if (current && test(current)) return Promise.resolve(current);
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: EngineState | null): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      off?.();
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    const off = engine?.subscribe((state) => {
      if (test(state)) finish(state);
    });
    if (!off) finish(null);
  });
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
  shell.roomCount.textContent = `${strings().hud.room(round.roomNumber)}　${strings().hud.section(round.sectionIndex + 1, state.sectionCount)}`;
  shell.prompt.textContent = localized(round.room.prompt);

  resetStage(shell.refs);
  renderChoices(round.room.theme, round.room.id, round.room.choices, shell, round.ownCandidates);
  renderHints(state, shell);
  // 遠くの部屋では、始めた時点ではまだ部屋が来ていない。
  // 部屋が出たここで時計を回す（同じものを二度回さない作りになっている）
  if (!resolving) startTimerLoop();
}

function renderLives(host: HTMLElement, state: EngineState): void {
  host.innerHTML = '';
  const label = document.createElement('span');
  label.textContent = strings().hud.lives;
  host.append(label);
  for (let i = 0; i < state.maxLives; i++) {
    const pip = el('span', `pip${i < state.lives ? '' : ' is-lost'}`);
    host.append(pip);
  }
  host.setAttribute('aria-label', `${strings().hud.lives} ${state.lives} / ${state.maxLives}`);
}

const KEYCAPS = ['1', '2', '3', '4', '5', '6', '7', '8'];

function renderChoices(
  theme: string,
  roomId: string,
  choices: readonly Choice[],
  s: Shell,
  ownCandidates: readonly string[] = [],
): void {
  s.choices.innerHTML = '';
  s.choices.dataset['count'] = String(choices.length);

  const buttons: HTMLElement[] = [];
  choices.forEach((choice, i) => {
    const btn = document.createElement('button');
    // 全員挑戦者モードでは、自分が知っている範囲に印が付く
    const known = ownCandidates.includes(choice.id);
    btn.className = `choice${known ? ' is-known' : ''}`;
    btn.dataset['choiceId'] = choice.id;
    btn.setAttribute('aria-label', localized(choice.label));

    const key = el('span', 'choice-key');
    key.textContent = KEYCAPS[i] ?? '';
    const img = document.createElement('img');
    img.src = choiceArt(theme, roomId, choice.id, choice.image);
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    const label = el('span', 'choice-label');
    label.textContent = localized(choice.label);

    btn.append(key, img, label);
    if (known) {
      const mark = el('span', 'choice-known');
      mark.textContent = strings().challenger.ownMark;
      btn.append(mark);
    }
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
  const T = strings();
  s.hints.innerHTML = '';
  const round = state.round;
  if (!round) return;

  if (round.speakers.length === 0) {
    const empty = el('p', 'hints-empty');
    empty.textContent = T.challenger.hintsNone;
    s.hints.append(empty);
    return;
  }

  const head = el('div', 'hints-head');
  const count = el('span', 'hints-count');
  // 何人が発言済みかを出す。出そろったかどうかが分からないと待てない
  count.textContent =
    round.advice.length === 0
      ? T.challenger.hintsEmpty
      : T.challenger.speakers(round.advice.length, round.speakers.length);
  const note = el('span', 'hints-note');
  // 嘘つきの人数は知らせない。0人かもしれないし全員かもしれない
  note.textContent = T.challenger.liarUnknown;
  head.append(count, note);
  s.hints.append(head);

  const list = el('div', 'hints-list');
  // 届いた順に並べる。早い遅いも読みの材料になる
  for (const advice of [...round.advice].sort((a, b) => a.sentAt - b.sentAt)) {
    list.append(renderAdviceRow(advice, round.silenceUsed));
  }
  s.hints.append(list);
}

function renderAdviceRow(advice: Advice, silenceUsed: boolean): HTMLElement {
  const T = strings();
  const row = el('div', 'hint-row');

  const name = el('span', 'hint-name');
  name.textContent = advice.advisorName;
  if (advice.record.hit + advice.record.miss > 0) {
    const rec = el('span', `hint-record${advice.record.miss > 0 ? ' is-suspect' : ''}`);
    rec.textContent = T.challenger.record(advice.record.hit, advice.record.miss);
    rec.title = T.challenger.recordHint;
    name.append(rec);
  }

  const text = el('span', 'hint-text');
  text.textContent = advice.text;

  const actions = el('span', 'hint-actions');

  const silence = document.createElement('button');
  silence.className = 'hint-silence';
  silence.textContent = silenceUsed ? T.challenger.silenceDone : T.challenger.silence;
  silence.disabled = silenceUsed;
  silence.addEventListener('click', () => {
    const result = engine?.silence(advice.advisorId);
    if (result) announce(result.hit ? T.challenger.silenceHit : T.challenger.silenceMiss);
  });

  const report = document.createElement('button');
  report.className = 'hint-report';
  report.textContent = T.challenger.report;
  report.title = T.challenger.reportNote;
  report.addEventListener('click', () => {
    engine?.report('challenger', advice.advisorId, advice.text);
    report.textContent = T.challenger.reported;
    report.disabled = true;
    announce(T.challenger.reported);
  });

  actions.append(silence, report);
  row.append(name, text, actions);
  return row;
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
  // 遠くの部屋では、選んだ返事が戻ってくるまで判定が立たない
  const settled = await waitFor((s) => s.verdict !== null);
  const verdict = settled?.verdict ?? null;
  if (!verdict || !shell) {
    resolving = false;
    return;
  }

  shell.refs.answer =
    shell.choices.querySelector<HTMLElement>(`[data-choice-id="${CSS.escape(verdict.correctId)}"]`) ?? null;

  markLosingLife(verdict);
  await playResolution(shell.refs, verdict, {
    advance: () => engine?.advancePresentation(),
    showParty: () => renderPartyResult(verdict),
  });

  resolving = false;
  const next = engine.snapshot();
  engine.advancePresentation(); // verdict → 次の部屋 / 終了

  const after = (await waitFor((s) => s.phase !== 'verdict')) ?? engine.snapshot();
  if (after.phase === 'choosing' && next.phase !== 'gameover') {
    resetStage(shell.refs);
    audio.play('room-open');
    startTimerLoop();
  }
}

/** 仲間がそれぞれ何を選んだかを助言欄に開く */
function renderPartyResult(verdict: Verdict): void {
  if (!shell || verdict.party.length === 0) return;
  const T = strings();
  const round = engine?.snapshot().round;
  const labelOf = (id: string): string => {
    const choice = round?.room.choices.find((c) => c.id === id);
    return choice ? localized(choice.label) : '';
  };

  shell.hints.innerHTML = '';
  const head = el('div', 'hints-head');
  const dead = verdict.party.filter((p) => !p.survived).length;
  const count = el('span', 'hints-count');
  count.textContent = dead > 0 ? T.challenger.partyDied(dead) : T.challenger.partyLived;
  head.append(count);
  shell.hints.append(head);

  const list = el('div', 'hints-list');
  for (const member of verdict.party) {
    const row = el('div', `hint-row${member.survived ? '' : ' is-dead'}`);
    const name = el('span', 'hint-name');
    name.textContent = member.name;
    const text = el('span', 'hint-text');
    text.textContent = T.challenger.partyPicked(member.name, labelOf(member.chosenId));
    row.append(name, text);
    list.append(row);
  }
  shell.hints.append(list);
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
  mark.textContent = dead ? strings().verdict.gameover : strings().verdict.cleared;

  const stat = el('p', 'end-stat');
  stat.textContent = strings().verdict.reached(state.totalCleared);

  // 記録は「更新したか」を先に見てから書き換える
  const wasBest = bestFor(currentMode);
  const renewed = recordBest(currentMode, state.totalCleared);
  const best = el('p', renewed ? 'end-stat is-best' : 'end-stat');
  best.textContent = renewed
    ? strings().verdict.newBest
    : wasBest > 0
      ? strings().verdict.best(wasBest)
      : strings().verdict.bestNone;

  // 嘘つきが誰だったかを全員に開示する
  const reveal = el('p', 'end-stat');
  const liars = new Set(state.liarLog.flatMap((r) => [...r.liarIds]));
  const names = state.advisors.filter((a) => liars.has(a.id)).map((a) => a.name);
  reveal.textContent =
    names.length > 0 ? strings().verdict.reveal(names.join(strings().verdict.nameSeparator)) : strings().verdict.revealNone;

  const again = document.createElement('button');
  again.className = 'end-action';
  again.textContent = strings().verdict.retry;
  again.addEventListener('click', () => {
    resolving = false;
    unsubscribe?.();
    engine?.dispose();
    engine = null;
    renderTitle();
  });

  screen.append(mark, stat, best, reveal, again);
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
