import '@/ui/tokens.css';
import '@/ui/font.css';
import './challenger.css';

import { corePackage } from '@/core/pack';
import type { Choice } from '@/core/schema';
import { GameEngine, type EngineState, type SectionAnswer, type Verdict } from '@/core/engine';
import { RemoteGame, type GameHandle } from './remote-game';
import { PartyBoard } from './party-board';
import { aiHintDelays } from '@/ui/test-speed';
import { LocalPartySource } from './local-party';
import { RemotePartySource } from './remote-party';
import { openRoomSocket } from './room-socket';
import { companionNames } from '@/core/companion-names';
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
/** この部屋で通報した相手。描き直しで表示が消えないよう覚えておく */
const reportedThisRoom = new Set<string>();
/**
 * 置いた疑いの札。**送らない。自分の覚え書き。**
 *
 * 読み合いは頭の中でやるものだったので、区画の答え合わせが来ても
 * 「自分は当てていたのか」を数えられなかった（覚えていた人だけが数えられた）。
 * 札を置けるようにすると、読みが手になり、答え合わせに点が付く。
 * 顔ぶれが入れ替わったら捨てる（別人の札になる）。
 */
const doubted = new Set<string>();
/**
 * 一周ぶんの読み。区画の答え合わせのたびに積んで、終わりの画面で出す。
 *
 * 区画ごとの点だけだと、抜けたときに持ち帰るものが「何部屋抜けたか」しか無い。
 * 読み合いの遊びなのに、一周を通してどれだけ読めていたかが残らなかった。
 */
let runRead = { caught: 0, liars: 0, wrong: 0, marked: 0 };
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
    menuItem(
      T.menu.join,
      PARTY_HOST ? T.menu.joinNote : `${T.menu.joinNote}（${T.menu.comingSoon}）`,
      !PARTY_HOST,
      PARTY_HOST ? () => renderJoin() : undefined,
    ),
    menuItem(
      T.menu.random,
      PARTY_HOST ? T.menu.randomNote : `${T.menu.randomNote}（${T.menu.comingSoon}）`,
      !PARTY_HOST,
      PARTY_HOST ? () => renderMatchmaking() : undefined,
    ),
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

/**
 * 全員挑戦者の手引き。時間は止まらない（仲間が待っている）。
 * 通常モードのものと同じ紙面を、覆いだけ変えて出す。
 */
function openPartyBriefing(): void {
  const T = strings().briefing;
  const veil = el('div', 'brief-veil');
  veil.setAttribute('role', 'dialog');
  veil.setAttribute('aria-modal', 'true');

  const sheet = el('div', 'brief-sheet');
  const heading = el('h2', 'brief-heading');
  heading.textContent = T.heading;
  const note = el('p', 'brief-note');
  note.textContent = T.runningNote;
  sheet.append(heading, note, briefBlock(T.rulesHeading, T.rules), briefBlock(strings().menu.party, T.modes.party));

  const close = document.createElement('button');
  close.className = 'brief-go';
  close.textContent = T.close;
  const dismiss = (): void => {
    veil.remove();
    document.removeEventListener('keydown', onKey);
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

let partyBoard: PartyBoard | null = null;

function startGame(modeId: ModeId): void {
  currentMode = modeId;
  // 周ごとに読みの記録を白紙に戻す。持ち越すと前の周の点が混ざる
  runRead = { caught: 0, liars: 0, wrong: 0, marked: 0 };
  doubted.clear();
  engine?.dispose();
  engine = null;
  partyBoard?.dispose();
  partyBoard = null;

  // 全員挑戦者は命が人ごとにあり、盤面の作りが違う（PartyEngine）
  if (modeId === 'party') {
    partyBoard = new PartyBoard({
      root: app!,
      source: new LocalPartySource(),
      onGuide: () => openPartyBriefing(),
      onExit: () => {
        partyBoard?.dispose();
        partyBoard = null;
        renderTitle();
      },
    });
    partyBoard.start();
    return;
  }

  audio.load();
  shell = buildShell();

  // ソロは全員 AI。野良になっても本体はこの境界の先を知らない
  //（CompositeAdvisorGateway が人間と AI を混ぜて同じ顔で渡す）
  const mode = MODES[modeId];
  const local = new GameEngine({
    pack, mode,
    gateway: new AiAdvisorGateway({ count: 12, mode, ...aiHintDelays() }),
  });
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
  engine?.dispose();
  engine = null;
  partyBoard?.dispose();
  partyBoard = null;
  void openRoomSocket(PARTY_HOST, code)
    .then((socket) => {
      const remote = new RemoteGame(socket, currentLocale);
      engine = remote;
      renderLobby(code, remote, socket);
    })
    .catch(() => renderLobbyError(code));
}

function renderLobby(code: string, remote: RemoteGame, socket: WebSocket): void {
  const T = strings();
  app!.innerHTML = '';
  const screen = el('div', 'title-screen grain vignette');

  const heading = el('h2', 'lobby-heading');
  heading.textContent = T.lobby.heading;

  const codeBox = el('p', 'lobby-code');
  codeBox.textContent = code;

  const where = el('p', 'lobby-where');
  // 助言者として入る（配信）のと、仲間として入る（全員挑戦者）のでは入口が違う
  const setWhere = (mode: ModeId): void => {
    where.textContent =
      mode === 'party'
        ? T.lobby.whereParty(location.origin, T.menu.join)
        : T.lobby.where(`${location.origin}/advisor.html`);
  };

  const count = el('p', 'lobby-count');

  // 全員挑戦者では主も一人の参加者。仲間に見える名前を決めてもらう
  const nameRow = el('div', 'join-form');
  const nameInput = document.createElement('input');
  nameInput.className = 'field';
  nameInput.maxLength = 12;
  nameInput.placeholder = T.advisor.namePlaceholder;
  nameInput.setAttribute('aria-label', T.advisor.namePlaceholder);
  nameInput.value = companionNames()[Math.floor(Math.random() * companionNames().length)] ?? '';
  const sendName = (): void => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ t: 'advisor/join', roomCode: code, name: nameInput.value.trim() || undefined }));
  };
  nameInput.addEventListener('change', sendName);
  nameRow.append(nameInput);
  sendName();

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
      setWhere(id);
      for (const other of modeButtons) other.classList.toggle('is-on', other === btn);
    });
    modeButtons.push(btn);
    modes.append(btn);
  }

  setWhere(chosenMode);

  const begin = document.createElement('button');
  begin.className = 'menu-item lobby-begin';
  begin.textContent = T.lobby.begin;
  begin.addEventListener('click', () => {
    currentMode = chosenMode;
    sendName();
    remote.start(chosenMode);

    // 全員挑戦者は盤面の作りが違う。線はそのまま渡して差し替える
    if (chosenMode === 'party') {
      const socket = remote.takeSocket();
      if (!socket) return;
      partyBoard = new PartyBoard({
        root: app!,
        source: new RemotePartySource(socket),
        onGuide: () => openPartyBriefing(),
        // 同じ部屋のまま次の周へ。合言葉を入れ直させない
        onAgainHere: () => socket.send(JSON.stringify({ t: 'challenger/start', mode: 'party', locale: currentLocale })),
        onExit: () => {
          partyBoard?.dispose();
          partyBoard = null;
          engine = null;
          renderTitle();
        },
      });
      partyBoard.start();
      return;
    }

    audio.load();
    shell = buildShell();
    unsubscribe = remote.subscribe((state) => render(state));
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

  screen.append(heading, codeBox, where, count, nameRow, modes, begin, back);
  app!.append(screen);
}

/**
 * 野良。待合室に並んで、知らない人と突き合わせてもらう。
 * 揃わなくても30秒で始まる（足りないぶんは AI が埋める）。
 */
function renderMatchmaking(): void {
  const T = strings();
  app!.innerHTML = '';
  const screen = el('div', 'title-screen grain vignette');

  const heading = el('h2', 'lobby-heading');
  heading.textContent = T.lobby.matchHeading;
  const count = el('p', 'lobby-count');
  count.textContent = T.lobby.joining;
  const note = el('p', 'lobby-where');
  note.textContent = T.lobby.matchNote;

  const back = document.createElement('button');
  back.className = 'brief-link';
  back.textContent = T.briefing.close;

  const scheme = PARTY_HOST.startsWith('localhost') || PARTY_HOST.startsWith('127.') ? 'ws' : 'wss';
  const socket = new WebSocket(`${scheme}://${PARTY_HOST}/parties/lobby/main`);
  let cancelled = false;

  back.addEventListener('click', () => {
    cancelled = true;
    socket.close();
    renderTitle();
  });

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ t: 'lobby/wait', mode: 'party' }));
  });
  socket.addEventListener('error', () => {
    if (!cancelled) count.textContent = T.errors.roomNotFound;
  });
  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string' || cancelled) return;
    let msg: { t?: string; waiting?: number; need?: number; roomCode?: string; host?: boolean };
    try {
      msg = JSON.parse(event.data) as typeof msg;
    } catch {
      return;
    }
    if (msg.t === 'lobby/waiting') {
      count.textContent = T.lobby.matchWaiting(msg.waiting ?? 0, msg.need ?? 1);
      return;
    }
    if (msg.t !== 'lobby/found' || !msg.roomCode) return;
    socket.close();
    enterMatchedRoom(msg.roomCode, count);
  });

  screen.append(heading, count, note, back);
  app!.append(screen);
}

/** 突き合わされた部屋へ入る。誰が主かは部屋が決めるので、全員が始めようとする */
function enterMatchedRoom(roomCode: string, status: HTMLElement): void {
  const T = strings();
  status.textContent = T.lobby.joining;
  void openRoomSocket(PARTY_HOST, roomCode)
    .then((socket) => {
      const name = companionNames()[Math.floor(Math.random() * companionNames().length)];
      socket.send(JSON.stringify({ t: 'advisor/join', roomCode, ...(name ? { name } : {}) }));
      // 全員が言い出して、実際に開けるのは最初に繋いだ一人だけ
      window.setTimeout(() => {
        socket.send(JSON.stringify({ t: 'challenger/start', mode: 'party', locale: currentLocale }));
      }, 1200);
      waitForParty(socket, status);
    })
    .catch(() => {
      status.textContent = T.errors.roomNotFound;
    });
}

/** 合言葉で他人の部屋に入る。全員挑戦者はここから */
function renderJoin(): void {
  const T = strings();
  app!.innerHTML = '';
  const screen = el('div', 'title-screen grain vignette');

  const heading = el('h2', 'lobby-heading');
  heading.textContent = T.lobby.joinHeading;

  const form = document.createElement('form');
  form.className = 'join-form';
  const code = document.createElement('input');
  code.className = 'field join-code';
  code.placeholder = T.advisor.roomCodePlaceholder;
  code.maxLength = 6;
  code.autocapitalize = 'characters';
  code.setAttribute('aria-label', T.advisor.roomCodePlaceholder);
  const name = document.createElement('input');
  name.className = 'field';
  name.placeholder = T.advisor.namePlaceholder;
  name.maxLength = 12;
  name.setAttribute('aria-label', T.advisor.namePlaceholder);

  const submit = document.createElement('button');
  submit.className = 'menu-item lobby-begin';
  submit.type = 'submit';
  submit.textContent = T.menu.join;

  const status = el('p', 'lobby-count');

  form.append(code, name, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const roomCode = code.value.trim().toUpperCase();
    if (roomCode.length !== 6) return;
    submit.disabled = true;
    status.textContent = T.lobby.joining;
    void openRoomSocket(PARTY_HOST, roomCode)
      .then((socket) => {
        socket.send(JSON.stringify({ t: 'advisor/join', roomCode, name: name.value.trim() || undefined }));
        waitForParty(socket, status);
      })
      .catch(() => {
        submit.disabled = false;
        status.textContent = T.errors.roomNotFound;
      });
  });

  const back = document.createElement('button');
  back.className = 'brief-link';
  back.textContent = T.briefing.close;
  back.addEventListener('click', renderTitle);

  screen.append(heading, form, status, back);
  app!.append(screen);
  code.focus();
}

/** 主が始めるまで待つ。始まったら盤面に切り替える */
function waitForParty(socket: WebSocket, status: HTMLElement): void {
  status.textContent = strings().lobby.waitingHost;
  const onMessage = (event: MessageEvent): void => {
    if (typeof event.data !== 'string') return;
    let msg: { t?: string };
    try {
      msg = JSON.parse(event.data) as { t?: string };
    } catch {
      return;
    }
    if (msg.t !== 'party/view') return;
    socket.removeEventListener('message', onMessage);
    currentMode = 'party';
    partyBoard = new PartyBoard({
      root: app!,
      source: new RemotePartySource(socket),
      onGuide: () => openPartyBriefing(),
      // 客は次の周を始められない（開き直せるのは最初に繋いだ一人だけ）。
      // 口を出しても断られるので、待っていると書いて、届いたら勝手に入る
      waitsForHost: true,
      onExit: () => {
        partyBoard?.dispose();
        partyBoard = null;
        renderTitle();
      },
    });
    partyBoard.start();
  };
  socket.addEventListener('message', onMessage);
  socket.addEventListener('close', () => {
    status.textContent = strings().lobby.lost;
  });
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
  reportedThisRoom.clear();
  heardCalls.clear();
  // 顔ぶれごと引き直されたら、札は別人のものになる
  if (round.freshCast) doubted.clear();

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
    img.src = choiceArt(theme, roomId, choice.id, choice.image, i);
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

/**
 * 場に届いた名指しの覚え。部屋が変わると捨てる。
 *
 * 助言そのものは無音のままにする（毎部屋7件鳴ると音が意味を失う）。
 * 鳴らすのは人を指した一言だけ——**投げられた石は音がする。**
 */
const heardCalls = new Set<string>();

function renderHints(state: EngineState, s: Shell): void {
  const T = strings();
  s.hints.innerHTML = '';
  const round = state.round;
  if (!round) return;

  for (const a of round.advice) {
    if ((a.kind ?? 'door') !== 'call') continue;
    const key = `${round.roundId}:${a.advisorId}`;
    if (heardCalls.has(key)) continue;
    heardCalls.add(key);
    audio.play('accuse');
  }

  if (round.speakers.length === 0) {
    const empty = el('p', 'hints-empty');
    empty.textContent = T.challenger.hintsNone;
    s.hints.append(empty);
    return;
  }

  const head = el('div', 'hints-head');
  const count = el('span', 'hints-count');
  // 何人が発言済みかを出す。出そろったかどうかが分からないと待てない。
  // **数えるのは扉について言った人だけ。** 一人が二つ喋る（扉について一つ、
  // 人を指して一つ）ので、行の数を数えると「4人中5人が発言」になる
  const spoke = new Set(
    round.advice.filter((a) => (a.kind ?? 'door') === 'door').map((a) => a.advisorId),
  ).size;
  count.textContent =
    spoke === 0 ? T.challenger.hintsEmpty : T.challenger.speakers(spoke, round.speakers.length);
  const note = el('span', 'hints-note');
  // 顔ぶれが入れ替わった部屋では、それを先に言う。
  // 記録が黙って白紙に戻ると不具合に見えるし、
  // 「前の区画の信用は持ち越せない」という規則そのものが伝わらない
  note.textContent = round.freshCast ? T.challenger.freshCast : T.challenger.liarUnknown;
  note.classList.toggle('is-fresh', round.freshCast);
  head.append(count, note);
  s.hints.append(head);

  /*
   * 枠外の票は挑戦者に見せない。
   *
   * 一度は「枠外○票、Xに42%」と出していたが、測ったら情報が無かった。
   *   票だけ見る            生存 23.3%（当てずっぽうと大差ない）
   *   票を無視する          生存 77.6%
   *   票も足して読む        生存 73.5%
   *   一番票が多い扉だけ疑う 生存 75.2%
   * どう使っても、見ないほうが強い。
   *
   * 助言には「必要な情報の中に罠が混ざっている」が、
   * 票は罠だけで情報が無い。純粋な罠を足すのは深みではなく雑音。
   * 票は入れた本人の賭けとして、助言者ページの側で意味を持たせる。
   */
  const list = el('div', 'hints-list');

  // 黙らせて当たった相手を残す。声は止まっているが、
  // 「嘘つきだった」という情報は自分で得たもの。
  // 画面から消すと、その情報を人間の記憶に押しつけることになる
  for (const id of state.confirmedLiars) {
    const who = round.speakers.find((sp) => sp.id === id);
    if (!who) continue;
    const row = el('div', 'hint-row is-confirmed');
    const name = el('span', 'hint-name');
    name.textContent = who.name;
    const text = el('span', 'hint-text');
    text.textContent = T.challenger.confirmedLiar;
    row.append(name, text);
    list.append(row);
  }

  // 届いた順に並べる。早い遅いも読みの材料になる
  for (const advice of [...round.advice].sort((a, b) => a.sentAt - b.sentAt)) {
    list.append(renderAdviceRow(advice, round.silenceUsed, state.canSilence));
  }
  s.hints.append(list);
}

function renderAdviceRow(advice: Advice, silenceUsed: boolean, canSilence: boolean): HTMLElement {
  const T = strings();
  // 人を指した一言は、扉についての助言と見た目を分ける。
  // 同じ形で並べると、扉の名前を探して読み飛ばされる
  const isCall = (advice.kind ?? 'door') === 'call';
  const row = el('div', `hint-row${isCall ? ' is-call' : ''}`);

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
    if (result) {
      announce(result.hit ? T.challenger.silenceHit : T.challenger.silenceMiss, result.hit ? 'good' : 'bad');
    }
  });

  const report = document.createElement('button');
  report.className = 'hint-report';
  // 助言はあとからも届く。届くたびに描き直すので、
  // 通報したことを覚えておかないと「通報済み」の表示が消える
  const alreadyReported = reportedThisRoom.has(advice.advisorId);
  report.textContent = alreadyReported ? T.challenger.reported : T.challenger.report;
  report.disabled = alreadyReported;
  report.title = T.challenger.reportNote;
  report.addEventListener('click', () => {
    reportedThisRoom.add(advice.advisorId);
    engine?.report('challenger', advice.advisorId, advice.text);
    announce(T.challenger.reportedNotice);
    report.textContent = T.challenger.reported;
    report.disabled = true;
    announce(T.challenger.reported);
  });

  // 人を指した一言には手を出さない。
  // 同じ人の扉についての行に同じ手が並ぶので、二つ出すと押し間違える
  if (isCall) {
    row.append(name, text);
    row.dataset.advisorId = advice.advisorId;
    if (doubted.has(advice.advisorId)) row.classList.add('is-doubted');
    return row;
  }

  // 疑いの札。盤面は何も変わらない（送らない）。答え合わせで突き合わせる
  const doubt = document.createElement('button');
  doubt.type = 'button';
  const paint = (): void => {
    const on = doubted.has(advice.advisorId);
    doubt.className = `hint-doubt${on ? ' is-on' : ''}`;
    doubt.textContent = on ? T.challenger.doubtOn : T.challenger.doubt;
    doubt.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  doubt.title = T.challenger.doubtHint;
  doubt.addEventListener('click', () => {
    if (doubted.has(advice.advisorId)) doubted.delete(advice.advisorId);
    else doubted.add(advice.advisorId);
    // 札を置いた手応え。専用の音は作らない（扉に触れる音を借りる）
    audio.play('hover');
    paint();
    // 同じ人の行が複数あることがある（扉の一言と名指し）。まとめて塗り直す
    for (const other of document.querySelectorAll<HTMLElement>('.hint-row')) {
      other.classList.toggle(
        'is-doubted',
        doubted.has(other.dataset.advisorId ?? ''),
      );
    }
  });
  paint();
  row.dataset.advisorId = advice.advisorId;
  if (doubted.has(advice.advisorId)) row.classList.add('is-doubted');

  // 黙らせるは崖っぷちだけの道具。通常モードでは効かないうえに
  // 外すと時間が減るので、押すほど損をする罠になっていた
  if (canSilence) actions.append(silence);
  actions.append(doubt, report);
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

/**
 * 区画の答え合わせ。抜けても落ちても、離れる瞬間に一枚出す。
 *
 * ここまで「誰が嘘つきだったか」は終わりの画面でしか返らなかった。
 * 一周12分・区画四つの遊びで、読み合いの答えが最後に一度だけ返る形になっていた。
 * 顔ぶれと配役は区画をまたいで残らないので、ここで開いても先へは漏れない。
 */
function showSectionAnswer(answer: SectionAnswer): Promise<void> {
  return new Promise((resolve) => {
    const T = strings().answer;
    audio.play('answer');
    const veil = el('div', 'answer-veil');
    veil.setAttribute('role', 'dialog');
    veil.setAttribute('aria-modal', 'true');

    const sheet = el('div', 'answer-sheet');
    const heading = el('h2', `answer-heading${answer.cleared ? '' : ' is-death'}`);
    heading.textContent = answer.cleared
      ? T.cleared(answer.sectionIndex + 1)
      : T.lost(answer.sectionIndex + 1);
    const sub = el('p', 'answer-sub');
    sub.textContent = T.heading;
    sheet.append(heading, sub);

    const rows = el('div', 'answer-rows');
    // 置いた札と突き合わせる。読み合いに点が付くのはここだけ
    const marked = answer.rows.filter((r) => doubted.has(r.id));
    const liars = answer.rows.filter((r) => r.liar);
    const caught = marked.filter((r) => r.liar).length;
    const wrong = marked.length - caught;
    // 一周ぶんに積む。区画は捨てられても、読んだ記録は周の終わりまで残る
    runRead = {
      caught: runRead.caught + caught,
      liars: runRead.liars + liars.length,
      wrong: runRead.wrong + wrong,
      marked: runRead.marked + marked.length,
    };
    for (const r of answer.rows) {
      const mine = doubted.has(r.id);
      const row = el('div', `answer-row${r.liar ? ' is-liar' : ''}${mine ? ' is-doubted' : ''}`);
      const name = el('span', 'answer-name');
      name.textContent = r.name;
      if (mine) {
        // 名前の横に足すと名前の桁を押し出すので、下に置く
        const mark = el('span', 'answer-mark');
        mark.textContent = T.doubted;
        name.append(mark);
      }
      const role = el('span', 'answer-role');
      role.textContent = r.liar ? T.liar : T.honest;
      const rec = el('span', 'answer-record');
      rec.textContent = r.hit + r.miss === 0 ? T.noRecord : T.record(r.hit, r.miss);
      /*
       * 「よく当てていたのに嘘つきだった」を数字のほうから指す。
       * 信用を作ってから裏切る形にしたので、ここが一番効く一行になる。
       *
       * 「正2 嘘1」でも出していたが、それは積んだとは言えない
       * （区画は4〜5部屋あるので、二回当てて一回外した程度では信用にならない）。
       * 三回以上当てて、外しの倍以上当てている場合だけにした。
       */
      if (r.liar && r.hit >= 3 && r.hit >= r.miss * 2) {
        const built = el('span', 'answer-built');
        built.textContent = T.builtCredit;
        rec.append(built);
      }
      row.append(name, role, rec);
      rows.append(row);
    }
    sheet.append(rows);

    const score = el('p', 'answer-score');
    score.textContent = marked.length === 0
      ? T.readNone
      : wrong === 0
        ? T.readScore(caught, liars.length)
        : `${T.readScore(caught, liars.length)}　${T.readWrong(wrong)}`;
    score.classList.toggle('is-good', marked.length > 0 && caught === liars.length && wrong === 0);
    sheet.append(score);

    const note = el('p', 'answer-note');
    note.textContent = T.note;
    const go = document.createElement('button');
    go.className = 'answer-go';
    go.textContent = T.go;
    const done = (): void => {
      veil.remove();
      document.removeEventListener('keydown', onKey);
      resolve();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        done();
      }
    };
    go.addEventListener('click', done);
    document.addEventListener('keydown', onKey);
    sheet.append(note, go);
    veil.append(sheet);
    app!.append(veil);
    go.focus();
  });
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

  const next = engine.snapshot();
  engine.advancePresentation(); // verdict → 答え合わせ / 次の部屋 / 終了

  let after = (await waitFor((s) => s.phase !== 'verdict')) ?? engine.snapshot();
  // 区画を離れるときだけ一枚挟まる。読んでいるあいだは resolving を下ろさない
  // （時間切れと手引きがこの上から割り込む）
  if (after.phase === 'answer' && after.sectionAnswer) {
    await showSectionAnswer(after.sectionAnswer);
    engine.advancePresentation(); // 答え合わせ → 次の部屋
    after = (await waitFor((s) => s.phase !== 'answer')) ?? engine.snapshot();
  }
  resolving = false;
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

/** 直前の終わりの画面で最高記録を更新したか。描き直しのあいだ持つ */
let endRenewed = false;

function renderEnd(state: EngineState): void {
  stopTimerLoop();
  const dead = state.phase === 'gameover';

  /**
   * 賭場では終わりの画面が二度描かれる。
   *
   * 先に「終わった」という画面ぶんが届き、そのあと別の便で
   * 嘘つきの開示（game/over）が届くので、二度目で開示が入る。
   * **前の画面を下ろさないと二枚重なる**（「尽きた」が縦に並ぶ）。
   */
  const already = app!.querySelector('.end-screen');
  const redraw = already !== null;
  if (already) already.remove();
  else audio.play(dead ? 'gameover' : 'survive');

  const screen = el('div', 'end-screen grain vignette');
  const mark = el('h1', `end-mark${dead ? ' is-death' : ''}`);
  mark.textContent = dead ? strings().verdict.gameover : strings().verdict.cleared;

  const stat = el('p', 'end-stat');
  stat.textContent = strings().verdict.reached(state.totalCleared);

  /*
   * 記録は「更新したか」を先に見てから書き換える。
   *
   * 二度目の描き直し（開示が届いたとき）では書き換えてはいけない。
   * 一度目でもう最高記録になっているので、二度目は「更新した」が消えて
   * **せっかくの更新が無かったことになる。**
   */
  const wasBest = bestFor(currentMode);
  const renewed = redraw ? endRenewed : recordBest(currentMode, state.totalCleared);
  endRenewed = renewed;
  const best = el('p', renewed ? 'end-stat is-best' : 'end-stat');
  best.textContent = renewed
    ? strings().verdict.newBest
    : wasBest > 0
      ? strings().verdict.best(wasBest)
      : strings().verdict.bestNone;

  // 嘘つきが誰だったかを区画ごとに開示する。
  //
  // 全部まとめて並べていたら、卓を組み替えるたびに名前が増えて
  // 「嘘つきだったのは こより、ウシオ、みかん、イチ、せつ、はなこ、たろう、ノブ」
  // という、ほぼ全員が並ぶ無意味な一覧になっていた。
  // 区画ごとなら「あの卓の嘘つきはこの三人だった」と読める。
  /*
   * 一周ぶんの読み。札を一枚も置かなかった周には出さない
   * （0/12 と出しても「使わなかった」以上の意味が無い）。
   */
  const readLine = el('p', 'end-stat is-read');
  const TA = strings().answer;
  readLine.textContent = runRead.wrong === 0
    ? TA.readScore(runRead.caught, runRead.liars)
    : `${TA.readScore(runRead.caught, runRead.liars)}　${TA.readWrong(runRead.wrong)}`;
  readLine.hidden = runRead.marked === 0;

  const reveal = el('div', 'end-reveal');
  // 区画ごとに、**最後に座っていた卓**の嘘つきだけを出す。
  // 死ぬたびに卓を組み替えるので、区画内の全部を足すと
  // 「表口の嘘つき ゲンさん、みかん、ぜんじ、かがり、ヤス、シノ、ぬい、はなこ」
  // のようにほぼ全員が並んで読めなくなる。
  // 知りたいのは「最後に自分が読んでいた卓は誰が嘘をついていたのか」。
  const bySection = new Map<number, readonly string[]>();
  for (const entry of state.liarLog) bySection.set(entry.sectionIndex, entry.liarIds);
  const nameOf = (id: string): string => state.advisors.find((a) => a.id === id)?.name ?? id;
  if (bySection.size === 0) {
    const line = el('p', 'end-stat');
    line.textContent = strings().verdict.revealNone;
    reveal.append(line);
  } else {
    for (const [section, ids] of [...bySection.entries()].sort((a, b) => a[0] - b[0])) {
      const line = el('p', 'end-stat');
      const names = ids.map(nameOf).join(strings().verdict.nameSeparator);
      line.textContent = strings().verdict.revealSection(section + 1, names);
      reveal.append(line);
    }
  }

  /**
   * 賭場では**同じ部屋のまま次の周へ**入れるようにする。
   *
   * ここまでは題名へ戻すだけだったので、賭場を開き直すと
   * 合言葉が新しく振られ、**見ていた全員が6文字を入れ直す**ことになっていた。
   * 1周12分の遊びで毎周それをやらせると、周が進むほど場が減る。
   */
  const here = engine?.restartHere?.bind(engine);
  const buttons: HTMLElement[] = [];

  if (here) {
    const stay = document.createElement('button');
    stay.className = 'end-action';
    stay.textContent = strings().verdict.retryHere;
    stay.addEventListener('click', () => {
      /*
       * 盤面は残したまま、終わりの画面を**上に重ねて**いる。
       * 下ろさないと次の周の盤面が裏に隠れる。
       * 「扉が DOM にあるか」だけを見る検査では気づけない場所。
       */
      screen.remove();
      resolving = false;
      // 次の周は読みの記録も白紙から（同じ部屋のまま続くので消えない）
      runRead = { caught: 0, liars: 0, wrong: 0, marked: 0 };
      doubted.clear();
      endRenewed = false;
      here(currentMode);
    });
    buttons.push(stay);
  }

  const again = document.createElement('button');
  again.className = `end-action${here ? ' is-quiet' : ''}`;
  again.textContent = here ? strings().verdict.leaveRoom : strings().verdict.retry;
  again.addEventListener('click', () => {
    resolving = false;
    unsubscribe?.();
    engine?.dispose();
    engine = null;
    renderTitle();
  });
  buttons.push(again);

  screen.append(mark, stat, best, readLine, reveal, ...buttons);
  app!.append(screen);
  buttons[0]?.focus();
}

/* ───────────────────────────── 補助 ───────────────────────────── */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * 知らせを出す。**目にも見せる。**
 *
 * 以前は読み上げ用にしか出していなかったので、
 * 「嘘つきを黙らせた」「外した。次の部屋が短くなる」が
 * 目で見ている人には何も出ていなかった。
 * 黙らせるは崖っぷちの中心の道具なのに、当たったかどうかが分からなかった。
 */
let noticeTimer = 0;

function announce(message: string, tone: 'plain' | 'good' | 'bad' = 'plain'): void {
  const live = document.createElement('p');
  live.className = 'sr-only';
  live.setAttribute('role', 'status');
  live.textContent = message;
  document.body.append(live);
  setTimeout(() => live.remove(), 2000);

  const host = shell?.hud;
  if (!host) return;
  let line = host.querySelector<HTMLElement>('.hud-notice');
  if (!line) {
    line = el('div', 'hud-notice');
    host.append(line);
  }
  line.textContent = message;
  line.className = `hud-notice is-visible${tone === 'good' ? ' is-good' : tone === 'bad' ? ' is-bad' : ''}`;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    line?.classList.remove('is-visible');
  }, 2600);
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
