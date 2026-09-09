import '@/ui/tokens.css';
import './advisor.css';

import { choiceArt } from '@/ui/placeholder';
import { HINT_MAX_LENGTH } from '@/core/limits';
import type { Choice } from '@/core/schema';
import { t } from '@/i18n/ja';

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
  /** 助言者だけに見えている答え */
  correct: string;
  isSpeaker: boolean;
  isLiar: boolean;
}

export interface AdvisorConnection {
  join(roomCode: string, name: string): Promise<void>;
  onView(listener: (view: AdvisorView | null) => void): () => void;
  sendHint(roundId: string, text: string): void;
  volunteer(roundId: string): void;
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
      const view: AdvisorView = {
        roundId: `${room.id}#${i}`,
        roomId: room.id,
        theme: room.theme,
        prompt: room.prompt,
        choices: room.choices,
        correct: room.correct,
        isSpeaker: i % 4 !== 0,
        isLiar: i % 3 === 0,
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
}

/* ───────────────────────────── 画面 ───────────────────────────── */

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app が無い');

const connection: AdvisorConnection = new RehearsalConnection();

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
  heading.textContent = t.title;
  const note = el('p');
  note.textContent = t.tagline;

  const code = el('input', 'field');
  code.placeholder = t.advisor.roomCodePlaceholder;
  code.autocapitalize = 'characters';
  code.maxLength = 6;
  code.setAttribute('aria-label', t.advisor.roomCodePlaceholder);

  const name = el('input', 'field');
  name.placeholder = t.advisor.namePlaceholder;
  name.maxLength = 12;
  name.setAttribute('aria-label', t.advisor.namePlaceholder);

  const submit = el('button', 'primary');
  submit.type = 'submit';
  submit.textContent = t.advisor.join;

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
  const grid = el('div', 'grid');
  board.append(prompt, grid);

  const compose = el('section', 'compose');
  frame.append(role, board, compose);
  app!.append(frame);

  let current: AdvisorView | null = null;

  connection.onView((view) => {
    current = view;
    if (!view) {
      prompt.textContent = t.advisor.waiting;
      grid.innerHTML = '';
      compose.innerHTML = '';
      return;
    }

    frame.classList.toggle('is-liar', view.isLiar);
    roleTitle.textContent = view.isLiar ? t.advisor.youAreLiar : t.advisor.youAreHonest;
    roleTitle.classList.toggle('is-liar', view.isLiar);
    roleNote.textContent = view.isLiar ? t.advisor.youAreLiarNote : t.advisor.youAreHonestNote;

    prompt.textContent = view.prompt;
    grid.innerHTML = '';
    for (const choice of view.choices) {
      const cell = el('div', `cell${choice.id === view.correct ? ' is-correct' : ''}`);
      const img = el('img');
      img.src = choiceArt(view.theme, view.roomId, choice.id, choice.image);
      img.alt = '';
      img.decoding = 'async';
      const label = el('span');
      label.textContent = choice.label;
      cell.append(img, label);
      if (choice.id === view.correct) {
        const flag = el('span', 'cell-flag');
        flag.textContent = t.advisor.correctIs;
        cell.append(flag);
      }
      grid.append(cell);
    }

    renderCompose(compose, view, () => current);
  });
}

function renderCompose(host: HTMLElement, view: AdvisorView, get: () => AdvisorView | null): void {
  host.innerHTML = '';

  // 枠外の助言者にも正解は見えている。見えていて言えない状態を作る
  if (!view.isSpeaker) {
    const locked = el('p', 'locked');
    locked.textContent = `${t.advisor.notSpeaking} — ${t.advisor.notSpeakingNote}`;
    const volunteer = el('button', 'primary');
    volunteer.textContent = t.advisor.volunteer;
    volunteer.addEventListener('click', () => {
      connection.volunteer(view.roundId);
      volunteer.disabled = true;
      volunteer.textContent = t.advisor.volunteered;
    });
    host.append(locked, volunteer);
    return;
  }

  const row = el('div', 'compose-row');
  const input = el('input', 'field');
  input.placeholder = t.advisor.hintPlaceholder;
  input.maxLength = HINT_MAX_LENGTH;
  input.setAttribute('aria-label', t.advisor.hintPlaceholder);

  const send = el('button', 'primary');
  send.textContent = t.advisor.send;

  const counter = el('p', 'counter');
  const status = el('p', 'status');
  const sync = (): void => {
    counter.textContent = `${[...input.value].length} / ${HINT_MAX_LENGTH}`;
    send.disabled = input.value.trim().length === 0;
  };
  input.addEventListener('input', sync);
  sync();

  const submit = (): void => {
    const text = input.value.trim();
    const round = get();
    if (!text || !round) return;
    connection.sendHint(round.roundId, text);
    input.value = '';
    sync();
    status.textContent = t.advisor.sent;
  };

  send.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });

  row.append(input, send);
  host.append(row, counter, status);
}

renderEnter();
