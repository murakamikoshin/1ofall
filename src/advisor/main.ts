import '@/ui/tokens.css';
import './font.css';
import './advisor.css';

import { choiceArt } from '@/ui/placeholder';
import { HINT_MAX_LENGTH } from '@/core/limits';
import {
  containsBlocked, isPointing, countChoicesMentioned, MAX_CHOICES_PER_HINT,
} from '@/core/moderation';
import type { Choice } from '@/core/schema';
import { strings, localized, detectLocale, setLocale } from '@/i18n';
import type { Knowledge } from '@/core/casting';
import { LiveConnection } from './live-connection';

/**
 * 助言者ページ。無料・ブラウザ・URLを開くだけ。
 *
 * 絶対条件：配信映像に依存しない。盤面はサーバーから直接受け取る。
 * ここでは接続層をインターフェースにしておき、実装順序 4 で PartyKit を挿す。
 * 表示側は接続の種類を知らない。
 */

/* ───────────────────── 接続層（差し替え可能） ───────────────────── */

export interface AdvisorView {
  roundId: string;
  prompt: string;
  roomId: string;
  theme: string;
  choices: readonly Choice[];
  /**
   * 自分に配られた知識。
   * 嘘つきは正解そのもの、協力者は「このどちらかが生きる」までしか受け取らない。
   * null は「今回は何も配られていない」。起こらない想定だが、
   * 線の向こうが黙ったときに嘘の文言を出さないための逃げ道。
   */
  knowledge: Knowledge | null;
  isSpeaker: boolean;
  /** 全員挑戦者モードでは、助言者も自分の扉を選ぶ */
  isParty?: boolean;
  /** 枠外の票を自分がどこへ入れたか */
  myVote?: string | null;
  /**
   * この部屋でほかの人が言ったこと。
   *
   * これまで助言者の画面には**自分の一言しか出ていなかった**。
   * 8人が扉の名前を言うだけで、互いの言葉が見えないので会話が起きない。
   * 見えれば「誰かが嘘を言っている」と気づけて、指せるようになる。
   */
  said?: readonly { advisorId: string; advisorName: string; text: string; kind?: string }[];
  /** 自分が誰を指したか */
  myCall?: { targetId: string; doubt: boolean } | null;
  /** この部屋で自分の一言をもう出したか。出す前は人を指せない */
  spoke?: boolean;
  /** 自分のID。場に並ぶ言葉のどれが自分のものかを見分けるため */
  myId?: string;
  /** 手を挙げているか。区画のあいだ続く */
  volunteered?: boolean;
}

export interface AdvisorConnection {
  join(roomCode: string, name: string): Promise<void>;
  onView(listener: (view: AdvisorView | null) => void): () => void;
  sendHint(roundId: string, text: string): void;
  volunteer(roundId: string): void;
  /** 全員挑戦者モード。自分の扉を決める */
  pick?(roundId: string, choiceId: string): void;
  /**
   * 発言枠の外から一票入れる。
   * 配信で1000人いると発言できるのは8人。残りに渡せる唯一の手。
   */
  vote?(roundId: string, choiceId: string): void;
  /** 枠外の賭けの通算。当てられているかが自分の手柄になる */
  betRecord?(): { hit: number; miss: number };
  /**
   * 人を指す。「あいつは嘘だ」。
   * 扉について言う口とは別なので、指しても自分の一言は消えない。
   */
  point?(roundId: string, targetId: string, doubt: boolean): void;
  /**
   * いま何を待っているか。
   *
   * 一周終わって次の周を待っているあいだ、盤面は無い。
   * そこで「まだ部屋は開いていない」と出すのは嘘で、
   * **部屋は開いていて、次の周を待っている。**
   * 賭場は同じ部屋のまま何周も回るので、ここを間違えると
   * 見ている側は「終わった、閉じられた」と思って離れる。
   */
  waitingFor?(): 'notOpen' | 'betweenRuns';
  /**
   * サーバーから返る知らせ（弾かれた・黙らされた・切れた）。
   * 送る前の検査は画面側でもやっているが、最後に決めるのはサーバーなので、
   * 断られた理由を本人へ出す口が要る。
   */
  onNotice?(listener: (code: string) => void): () => void;
}

/**
 * 通信が繋がるまでの素振り用。UI と演出の確認に使う。
 * 実装順序 4 で PartyKitConnection に差し替える（画面側は変更しない）。
 */
class RehearsalConnection implements AdvisorConnection {
  private listeners = new Set<(v: AdvisorView | null) => void>();
  private timer = 0;
  /** 最新の盤面を保持し、後から購読した画面にも即座に渡す。
   *  実接続でも同じ性質が要る（再読み込みした助言者が次の部屋まで待たされない） */
  private latest: AdvisorView | null = null;

  async join(): Promise<void> {
    const { corePackage } = await import('@/core/pack');
    const rooms = corePackage().rooms;
    let i = 0;
    const push = (): void => {
      const room = rooms[i % rooms.length];
      i += 1;
      if (!room) return;
      const wrong = room.choices.filter((c) => c.id !== room.correct);
      const pickWrong = () => wrong[Math.floor(Math.random() * wrong.length)];
      const decoy = pickWrong();
      // ?as=liar|trapper|honest2|honest3|doomed で立場を固定できる。
      // 素振りと、画面の確認に使う
      const forced = new URLSearchParams(location.search).get('as');
      const roll = Math.random();
      const role =
        forced ??
        (Math.random() < 0.2
          ? 'liar'
          : Math.random() < 0.1
            ? 'trapper'
            : roll < 0.2
              ? 'doomed'
              : roll < 0.45
                ? 'honest3'
                : 'honest2');
      const view: AdvisorView = {
        roundId: `${room.id}#${i}`,
        roomId: room.id,
        theme: room.theme,
        prompt: localized(room.prompt),
        choices: room.choices,
        // 素振り用。実際の配分は core/limits.ts の knowledgeBySection が決める
        knowledge:
          role === 'liar'
            ? { kind: 'liar' as const, correct: room.correct, trap: decoy?.id ?? room.correct }
            : role === 'trapper'
              ? { kind: 'trapper' as const, trap: decoy?.id ?? room.correct }
              : role === 'doomed'
                ? { kind: 'doomed' as const, doomed: decoy?.id ?? room.correct }
                : role === 'honest3'
                  ? {
                      kind: 'honest' as const,
                      candidates: [room.correct, decoy?.id ?? room.correct, pickWrong()?.id ?? room.correct],
                    }
                  : { kind: 'honest' as const, candidates: [room.correct, decoy?.id ?? room.correct] },
        isSpeaker: Math.random() < 0.8,
      };
      this.latest = view;
      for (const l of this.listeners) l(view);
    };
    push();
    this.timer = window.setInterval(push, 20_000);
  }

  onView(listener: (v: AdvisorView | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.latest);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) window.clearInterval(this.timer);
    };
  }

  sendHint(): void {}
  volunteer(): void {}

  /** 素振りでも枠外の一票を試せるようにする */
  vote(_roundId: string, choiceId: string): void {
    if (!this.latest) return;
    this.latest = { ...this.latest, myVote: choiceId };
    for (const l of this.listeners) l(this.latest);
  }
}

/* ───────────────────────────── 画面 ───────────────────────────── */

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app が無い');

setLocale(detectLocale());

/**
 * 繋ぎ先が設定されていれば本物の線、無ければ素振り。
 * 画面側はどちらか知らない（AdvisorConnection の先を見ない）。
 */
const PARTY_HOST = import.meta.env['VITE_PARTY_HOST'] ?? '';
const connection: AdvisorConnection = PARTY_HOST
  ? new LiveConnection(PARTY_HOST)
  : new RehearsalConnection();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function renderEnter(): void {
  app!.innerHTML = '';
  const frame = el('div', 'frame grain');
  const form = el('form', 'enter');

  const heading = el('h1');
  heading.textContent = strings().title;
  const note = el('p');
  note.textContent = strings().tagline;

  const code = el('input', 'field');
  code.placeholder = strings().advisor.roomCodePlaceholder;
  code.autocapitalize = 'characters';
  code.maxLength = 6;
  code.setAttribute('aria-label', strings().advisor.roomCodePlaceholder);

  const name = el('input', 'field');
  name.placeholder = strings().advisor.namePlaceholder;
  name.maxLength = 12;
  name.setAttribute('aria-label', strings().advisor.namePlaceholder);

  const submit = el('button', 'primary');
  submit.type = 'submit';
  submit.textContent = strings().advisor.join;

  form.append(heading, note, code, name, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void connection.join(code.value.trim(), name.value.trim()).then(renderBoard);
  });

  frame.append(form);
  app!.append(frame);
  code.focus();
}

function renderBoard(): void {
  app!.innerHTML = '';
  const frame = el('div', 'frame grain');

  const role = el('header', 'role');
  const roleTitle = el('p', 'role-title');
  const roleNote = el('p', 'role-note');
  role.append(roleTitle, roleNote);

  const board = el('main', 'board');
  const prompt = el('h2', 'board-prompt');
  const pickNote = el('p', 'pick-note');
  pickNote.hidden = true;
  const grid = el('div', 'grid');
  board.append(prompt, pickNote, grid);

  // 場に出ている言葉。ここが無いと、8人が扉の名前を言うだけで会話が起きない
  const floor = el('section', 'floor');
  const compose = el('section', 'compose');
  const notice = el('p', 'board-notice');
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  frame.append(role, board, notice, floor, compose);
  app!.append(frame);

  // サーバーからの知らせは一箇所に集める。
  // 助言の枠の中に出していたとき、部屋が変わると古い節点に書き込んでいた
  connection.onNotice?.((code) => {
    const T = strings();
    const known: Record<string, string> = {
      blocked: T.errors.blocked,
      pointing: T.errors.pointing,
      tooManyChoices: T.errors.tooManyChoices,
      tooLong: T.errors.tooLong,
      speakFirst: T.errors.speakFirst,
      rateLimited: T.errors.rateLimited,
      silenced: T.advisor.silenced,
      survived: T.verdict.survived,
      died: T.verdict.died,
    };
    // 枠外の賭けは当たり外れを通算で出す。手柄がここに積む
    if (code === 'voteHit' || code === 'voteMiss') {
      const rec = connection.betRecord?.() ?? { hit: 0, miss: 0 };
      notice.textContent = `${code === 'voteHit' ? T.advisor.betHit : T.advisor.betMiss}　${T.advisor.betRecord(rec.hit, rec.miss)}`;
      notice.hidden = false;
      notice.classList.toggle('is-good', code === 'voteHit');
      notice.classList.toggle('is-fatal', code === 'voteMiss');
      return;
    }
    const message = known[code];
    if (!message) return;
    notice.textContent = message;
    notice.hidden = false;
    notice.classList.toggle('is-fatal', code === 'died');
    notice.classList.toggle('is-good', code === 'survived');
  });

  let current: AdvisorView | null = null;
  /**
   * 扉と入力欄を描き直した部屋。
   *
   * 場に出ている言葉は助言が届くたびに増えるので、そのたびに全部描き直すと
   * **打ちかけの文字が消える。** 実際に、書いている途中で仲間の助言が届くと
   * 入力欄が空になって送信が空振りしていた。
   * 部屋が変わったときだけ扉と入力欄を作り直し、場だけ描き直す。
   */
  let drawnFor = '';

  connection.onView((view) => {
    current = view;
    if (!view) {
      prompt.textContent = connection.waitingFor?.() === 'betweenRuns'
        ? strings().advisor.waitingNextRun
        : strings().advisor.waiting;
      grid.innerHTML = '';
      floor.innerHTML = '';
      compose.innerHTML = '';
      drawnFor = '';
      return;
    }
    const roomKey = `${view.roundId}|${view.isSpeaker ? 's' : '-'}|${view.knowledge?.kind ?? '-'}`;
    if (roomKey === drawnFor) {
      // 増えたのは場の言葉だけ。扉と入力欄には触らない
      renderFloor(floor, view);
      return;
    }
    drawnFor = roomKey;

    const T = strings();
    const k = view.knowledge;
    if (!k) {
      // 何も配られていないのに「2つのどれか」などと書かない
      roleTitle.textContent = T.advisor.youAreHonest;
      roleTitle.classList.remove('is-liar');
      frame.classList.remove('is-liar');
      roleNote.textContent = T.advisor.nothingDealt;
      prompt.textContent = view.prompt;
      grid.innerHTML = '';
      for (const choice of view.choices) {
        const cell = el('div', 'cell');
        const img = el('img');
        img.src = choiceArt(view.theme, view.roomId, choice.id, choice.image);
        img.alt = '';
        const label = el('span');
        label.textContent = localized(choice.label);
        cell.append(img, label);
        grid.append(cell);
      }
      renderFloor(floor, view);
      renderCompose(compose, view, () => current);
      return;
    }
    // 全員挑戦者モードの裏切り者（trapper）は、正解は知らないが罠は知っている。
    // 立場は嘘つき側。ここで honest 扱いにすると本人に嘘つきだと伝わらない
    const isLiar = k.kind === 'liar' || k.kind === 'trapper';
    frame.classList.toggle('is-liar', isLiar);
    roleTitle.textContent = isLiar ? T.advisor.youAreLiar : T.advisor.youAreHonest;
    roleTitle.classList.toggle('is-liar', isLiar);
    roleNote.textContent =
      k.kind === 'liar'
        ? T.advisor.youAreLiarNote
        : k.kind === 'trapper'
          ? `${T.advisor.youAreLiarNote}${T.advisor.noteSeparator}${T.advisor.youOnlyKnowTrap}`
          : k.kind === 'doomed'
            ? `${T.advisor.youAreHonestNote}${T.advisor.noteSeparator}${T.advisor.youKnowDoomed}`
            : `${T.advisor.youAreHonestNote}${T.advisor.noteSeparator}${T.advisor.youNarrowedTo(k.candidates.length)}`;

    prompt.textContent = view.prompt;
    // 何が光るかは、その人が何を知っているかで変わる
    //   嘘つき   正解が1つ
    //   目利き   絞れている候補が2つか3つ
    //   耳打ち   死ぬ選択肢が1つ（赤く光る）
    const marked = k.kind === 'liar' ? [k.correct] : k.kind === 'honest' ? [...k.candidates] : [];
    const doomed = k.kind === 'doomed' ? [k.doomed] : [];
    // 嘘つきには罠も見えている。仲間全員が同じ罠を見ている
    const trap = k.kind === 'liar' || k.kind === 'trapper' ? [k.trap] : [];

    grid.innerHTML = '';
    // 全員挑戦者モードでは、助言者も自分の命を賭けて一つ選ぶ
    const canPick = view.isParty === true && view.isSpeaker && typeof connection.pick === 'function';
    // 枠外の人は一票入れられる。1000人の視聴者に渡せる唯一の手
    const canVote = !canPick && !view.isSpeaker && typeof connection.vote === 'function';
    let picked: string | null = null;
    for (const choice of view.choices) {
      const lit = marked.includes(choice.id);
      const dead = doomed.includes(choice.id);
      const isTrap = trap.includes(choice.id);
      const voted = view.myVote === choice.id;
      const cell = el(
        canPick || canVote ? 'button' : 'div',
        `cell${lit ? ' is-correct' : ''}${dead || isTrap ? ' is-doomed' : ''}` +
          `${canPick || canVote ? ' is-pickable' : ''}${voted ? ' is-voted' : ''}`,
      );
      if (canVote) {
        (cell as HTMLButtonElement).type = 'button';
        cell.addEventListener('click', () => {
          connection.vote?.(view.roundId, choice.id);
          for (const other of grid.querySelectorAll('.cell')) other.classList.remove('is-voted');
          cell.classList.add('is-voted');
          pickNote.textContent = strings().advisor.voted(localized(choice.label));
        });
      }
      if (canPick) {
        (cell as HTMLButtonElement).type = 'button';
        cell.addEventListener('click', () => {
          connection.pick?.(view.roundId, choice.id);
          picked = choice.id;
          for (const other of grid.querySelectorAll('.cell')) other.classList.remove('is-picked');
          cell.classList.add('is-picked');
          pickNote.textContent = strings().advisor.picked(localized(choice.label));
        });
      }
      const img = el('img');
      img.src = choiceArt(view.theme, view.roomId, choice.id, choice.image);
      img.alt = '';
      img.decoding = 'async';
      const label = el('span');
      label.textContent = localized(choice.label);
      cell.append(img, label);
      if (lit || dead || isTrap) {
        const flag = el('span', `cell-flag${dead || isTrap ? ' is-doomed' : ''}`);
        flag.textContent = isTrap
          ? T.advisor.trapIs
          : dead
          ? T.advisor.doomedIs
          : isLiar
            ? T.advisor.correctIs
            : marked.length > 2
              ? T.advisor.maybeIsWide
              : T.advisor.maybeIs;
        cell.append(flag);
      }
      grid.append(cell);
    }

    pickNote.textContent = canPick
      ? T.advisor.pickPrompt
      : canVote
        ? view.myVote
          ? T.advisor.voted(localized(view.choices.find((c) => c.id === view.myVote)?.label ?? { ja: '', en: '' }))
          : T.advisor.votePrompt
        : '';
    pickNote.hidden = !canPick && !canVote;
    notice.hidden = true;
    void picked;

    renderFloor(floor, view);
    renderCompose(compose, view, () => current);
  });
}

/**
 * 場に出ている言葉と、人を指す手。
 *
 * これまで助言者の画面には自分の一言しか出ていなかった。
 * 8人が扉の名前を言うだけで、互いの言葉が見えないので会話が起きない。
 * 見えれば「あいつは嘘を言っている」と気づけて、指せるようになる。
 *
 * 指すのは**扉について言う口とは別**なので、指しても自分の一言は消えない。
 * 文面は送らない（相手のIDと向きだけ送ってサーバーが書く）ので、
 * 暴言の検査を通す必要が無く、日本語を打てない人でも押せる。
 */
function renderFloor(host: HTMLElement, view: AdvisorView): void {
  const T = strings();
  host.innerHTML = '';
  const said = (view.said ?? []).filter((h) => (h.kind ?? 'door') === 'door');
  if (!view.isSpeaker && said.length === 0) return;

  const title = el('p', 'floor-title');
  title.textContent = T.advisor.floorTitle;
  host.append(title);

  if (said.length === 0) {
    const empty = el('p', 'floor-empty');
    empty.textContent = T.advisor.floorEmpty;
    host.append(empty);
    return;
  }

  // 指せるのは発言枠の人だけ。指した一言は挑戦者の画面に並ぶので、
  // 枠外から撃てると枠の意味が消える。
  // さらに、**自分の一言を出してからでないと撃てない**。
  // 撃つだけで済むなら、自分の言葉を晒さずに人を潰せてしまう
  const canPoint = view.isSpeaker && typeof connection.point === 'function' && view.spoke === true;
  const mine = view.myCall ?? null;

  for (const h of said) {
    const row = el('div', `floor-row${h.advisorId === view.myId ? ' is-mine' : ''}`);
    const name = el('span', 'floor-name');
    name.textContent = h.advisorName;
    const text = el('span', 'floor-text');
    text.textContent = h.text;
    row.append(name, text);

    // 自分の一言には撃つ手を出さない（自分は撃てない）
    if (canPoint && h.advisorId !== view.myId) {
      const acts = el('span', 'floor-acts');
      for (const doubt of [true, false]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `floor-act${doubt ? ' is-doubt' : ''}${mine?.targetId === h.advisorId && mine.doubt === doubt ? ' is-on' : ''}`;
        b.textContent = doubt ? T.advisor.doubtButton : T.advisor.backButton;
        b.addEventListener('click', () => {
          connection.point?.(view.roundId, h.advisorId, doubt);
          for (const other of host.querySelectorAll('.floor-act')) other.classList.remove('is-on');
          b.classList.add('is-on');
          const note = host.querySelector('.floor-note');
          if (note) note.textContent = doubt ? T.advisor.pointed(h.advisorName) : T.advisor.backed(h.advisorName);
        });
        acts.append(b);
      }
      row.append(acts);
    }
    host.append(row);
  }

  if (view.isSpeaker && !canPoint) {
    const note = el('p', 'floor-note');
    note.textContent = T.advisor.pointNeedsHint;
    host.append(note);
  }

  if (canPoint) {
    const note = el('p', 'floor-note');
    note.textContent = mine
      ? mine.doubt
        ? T.advisor.pointed(said.find((h) => h.advisorId === mine.targetId)?.advisorName ?? '')
        : T.advisor.backed(said.find((h) => h.advisorId === mine.targetId)?.advisorName ?? '')
      : T.advisor.pointNote;
    host.append(note);
  }
}

function renderCompose(host: HTMLElement, view: AdvisorView, get: () => AdvisorView | null): void {
  host.innerHTML = '';

  // 枠外の助言者にも正解は見えている。見えていて言えない状態を作る
  if (!view.isSpeaker) {
    const locked = el('p', 'locked');
    const lockedTitle = el('span', 'locked-title');
    lockedTitle.textContent = strings().advisor.notSpeaking;
    const lockedNote = el('span', 'locked-note');
    // 「見えていても言えない」だけだと手が無い。票は入れられると伝える
    lockedNote.textContent = typeof connection.vote === 'function'
      ? strings().advisor.notSpeakingButVote
      : strings().advisor.notSpeakingNote;
    locked.append(lockedTitle, lockedNote);
    const volunteer = el('button', 'primary');
    const up = view.volunteered === true;
    volunteer.textContent = up ? strings().advisor.volunteered : strings().advisor.volunteer;
    volunteer.disabled = up;
    volunteer.addEventListener('click', () => {
      connection.volunteer(view.roundId);
      volunteer.disabled = true;
      volunteer.textContent = strings().advisor.volunteered;
    });
    // 何が起きるのかを書く。押しても何も起きないボタンだったので、
    // 「効く」と分かる形で出す
    const note = el('p', 'compose-veil');
    note.textContent = strings().advisor.volunteerNote;
    host.append(locked, volunteer, note);
    return;
  }

  const veil = el('p', 'compose-veil');
  veil.textContent = `${strings().advisor.veiled} — ${strings().advisor.veiledNote}`;

  const row = el('div', 'compose-row');
  const input = el('input', 'field');
  input.placeholder = strings().advisor.hintPlaceholder;
  input.maxLength = HINT_MAX_LENGTH;
  input.setAttribute('aria-label', strings().advisor.hintPlaceholder);

  const send = el('button', 'primary');
  send.textContent = strings().advisor.send;

  const counter = el('p', 'counter');
  const status = el('p', 'status');
  const labels = view.choices.map((c) => localized(c.label));


  // 送れないものは、送らせない。押してから断るのでは遅い
  const sync = (): void => {
    const T = strings();
    const text = input.value.trim();
    const len = [...input.value].length;
    counter.textContent = `${len} / ${HINT_MAX_LENGTH}`;
    counter.classList.toggle('is-over', len > HINT_MAX_LENGTH);

    let reason = '';
    if (len > HINT_MAX_LENGTH) reason = T.errors.tooLong;
    else if (text && containsBlocked(text)) reason = T.errors.blocked;
    else if (text && isPointing(text, labels)) reason = T.errors.pointing;
    else if (text && countChoicesMentioned(text, labels) > MAX_CHOICES_PER_HINT) {
      reason = T.errors.tooManyChoices;
    }

    status.textContent = reason;
    status.classList.toggle('is-error', !!reason);
    input.classList.toggle('is-error', !!reason);
    send.disabled = text.length === 0 || !!reason;
  };
  input.addEventListener('input', sync);
  sync();

  const submit = (): void => {
    const text = input.value.trim();
    const round = get();
    if (!text || !round || send.disabled) return;
    connection.sendHint(round.roundId, text);
    input.value = '';
    sync();
    status.textContent = strings().advisor.sent;
  };

  send.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });

  row.append(input, send);
  host.append(veil, row, counter, status);
}

renderEnter();
