import type { PartyState } from '@/core/party-engine';
import type { Knowledge } from '@/core/schema';
import { PARTY } from '@/core/limits';
import { strings, localized } from '@/i18n';
import { choiceArt } from '@/ui/placeholder';
import { playResolution, resetStage, type ResolutionRefs } from '@/ui/death-sequence';
import { audio } from '@/ui/audio';
import {
  containsBlocked, isPointing, countChoicesMentioned, MAX_CHOICES_PER_HINT,
} from '@/core/moderation';
import { HINT_MAX_LENGTH } from '@/core/limits';

/**
 * 全員挑戦者モードの盤面。
 *
 * 通常モードと画面が違う。**命が人ごとにある**ので、
 * 誰が何回死んだかと、誰がもう決めたかを常に出しておく必要がある。
 * 同じ描画に押し込むと、どちらの規則で動いているのか読めなくなる。
 */

const KEYCAPS = ['1', '2', '3', '4', '5', '6', '7', '8'];

/**
 * 盤面に流し込む側。ローカルの PartyEngine でも、遠くの部屋でも同じ顔をする。
 * 描画側はどちらで動いているかを知らない。
 */
export interface PartySource {
  /** 自分の席の id */
  readonly meId: string;
  /** 演出の段を自分で進めるか（遠くの部屋ではサーバーが進める） */
  readonly drivesPresentation: boolean;
  subscribe(listener: (state: PartyState) => void): () => void;
  snapshot(): PartyState;
  knowledgeForMe(): Knowledge | null;
  hint(text: string): void;
  pick(choiceId: string): void;
  /** 暴言を見た者がその場で挙げる。野良で遊ぶなら必ず要る */
  report(memberId: string, text: string): void;
  /** 締切が来た。ローカルなら自分で閉じる */
  timeUp(): void;
  advance(): void;
  dispose(): void;
}

export interface PartyBoardOptions {
  root: HTMLElement;
  source: PartySource;
  onExit(): void;
  /** HUD の「?」から手引きを開く */
  onGuide?(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export class PartyBoard {
  private readonly source: PartySource;
  private readonly root: HTMLElement;
  private readonly onExit: () => void;

  private roster = el('div', 'party-roster');
  private stage = el('main', 'stage grain vignette');
  private choicesHost = el('div', 'choices');
  private prompt = el('h2', 'prompt');
  private hintsHost = el('section', 'hints');
  private composeHost = el('section', 'party-compose');
  private hud = el('header', 'hud');
  private timer = el('div', 'timer');
  private roomCount = el('div', 'room-count');
  private refs: ResolutionRefs;

  private roundId: string | null = null;
  private myPick: string | null = null;
  private resolving = false;
  private timerHandle = 0;
  private unsubscribe: (() => void) | null = null;
  private playedRound: string | null = null;
  /** この部屋で通報した相手。描き直しても消えないよう覚えておく */
  private reported = new Set<string>();
  private ended = false;

  constructor(options: PartyBoardOptions) {
    this.root = options.root;
    this.onExit = options.onExit;
    this.source = options.source;

    const lamp = el('div', 'lamp');
    const blackout = el('div', 'blackout');
    const banner = el('div', 'banner');
    banner.setAttribute('role', 'status');
    this.refs = { stage: this.stage, lamp, blackout, banner, chosen: null, others: [], answer: null };

    this.timer.setAttribute('role', 'timer');
    // 命は人ごとなので HUD には出さない。名簿のほうに全員ぶん並ぶ
    this.hud.classList.add('party-hud');
    const right = el('div', 'hud-right');
    right.append(this.timer);
    if (options.onGuide) {
      const guide = document.createElement('button');
      guide.className = 'hud-guide';
      guide.type = 'button';
      guide.textContent = '?';
      guide.title = strings().briefing.open;
      guide.setAttribute('aria-label', strings().briefing.open);
      guide.addEventListener('click', () => options.onGuide?.());
      right.append(guide);
    }
    this.hud.append(this.roomCount, right);
    this.stage.append(this.choicesHost, this.prompt);
    this.hintsHost.setAttribute('aria-live', 'polite');
    this.root.innerHTML = '';
    this.root.append(this.hud, this.roster, this.stage, this.composeHost, this.hintsHost, lamp, blackout, banner);
  }

  start(): void {
    audio.load();
    this.unsubscribe = this.source.subscribe((state) => this.render(state));
    audio.play('room-open');
  }

  dispose(): void {
    this.unsubscribe?.();
    this.stopTimer();
    this.source.dispose();
  }

  /* ───────────────────────────── 描画 ───────────────────────────── */

  private render(state: PartyState): void {
    if (state.phase === 'gameover' || state.phase === 'cleared') {
      // 状態が届くたびに呼ばれる。二度描くと終わりの画面が二枚重なる
      if (!this.ended) {
        this.ended = true;
        this.renderEnd(state);
      }
      return;
    }
    this.renderRoster(state);

    // 判定が立ったら演出を流す。誰が段を進めるかは供給源が決める
    if (state.verdict && state.verdict.roundId !== this.playedRound && state.phase !== 'choosing') {
      this.playedRound = state.verdict.roundId;
      void this.playOut(state);
      return;
    }
    if (state.phase !== 'choosing' || !state.round) return;
    // 演出の最中に次の部屋が届くことがある（段を刻むのはサーバー）。
    // そこで描き直すと、死んだ瞬間が飛ぶ
    if (this.resolving) return;

    const round = state.round;
    if (round.roundId !== this.roundId) {
      this.roundId = round.roundId;
      this.myPick = null;
      this.resolving = false;
      this.reported.clear();
      const T = strings();
      this.roomCount.textContent = `${T.hud.room(round.roomNumber)}　${T.hud.section(round.sectionIndex + 1, state.sectionCount)}`;
      this.prompt.textContent = localized(round.room.prompt);
      resetStage(this.refs);
      this.renderChoices(state);
      this.renderCompose(state);
      this.startTimer();
    }
    this.renderHints(state);
  }

  /** 誰が何回死んだか、誰がもう決めたか */
  private renderRoster(state: PartyState): void {
    const T = strings();
    this.roster.innerHTML = '';
    for (const member of state.members) {
      const row = el('div', `party-seat${member.out ? ' is-out' : ''}${member.hasPicked ? ' is-ready' : ''}`);
      const name = el('span', 'party-name');
      name.textContent = member.id === this.source.meId ? T.party.you : member.name;
      const pips = el('span', 'party-lives');
      for (let i = 0; i < PARTY.lives; i++) {
        const pip = el('span', `pip${i < member.lives ? '' : ' is-lost'}`);
        pips.append(pip);
      }
      const mark = el('span', 'party-ready');
      mark.textContent = member.out ? T.party.out : member.hasPicked ? T.party.ready : '';
      row.append(name, pips, mark);
      this.roster.append(row);
    }
  }

  private renderChoices(state: PartyState): void {
    const round = state.round;
    if (!round) return;
    const own = this.source.knowledgeForMe();
    const known =
      own?.kind === 'honest' ? own.candidates : own?.kind === 'trapper' ? [] : [];
    const doomed = own?.kind === 'doomed' ? [own.doomed] : own?.kind === 'trapper' ? [own.trap] : [];

    this.choicesHost.innerHTML = '';
    this.choicesHost.dataset['count'] = String(round.room.choices.length);
    const buttons: HTMLElement[] = [];
    round.room.choices.forEach((choice, i) => {
      const btn = document.createElement('button');
      const isKnown = known.includes(choice.id);
      const isDoomed = doomed.includes(choice.id);
      btn.className = `choice${isKnown ? ' is-known' : ''}${isDoomed ? ' is-fatal' : ''}`;
      btn.dataset['choiceId'] = choice.id;
      btn.setAttribute('aria-label', localized(choice.label));

      const key = el('span', 'choice-key');
      key.textContent = KEYCAPS[i] ?? '';
      const img = document.createElement('img');
      img.src = choiceArt(round.room.theme, round.room.id, choice.id, choice.image);
      img.alt = '';
      img.loading = 'lazy';
      const label = el('span', 'choice-label');
      label.textContent = localized(choice.label);
      btn.append(key, img, label);

      if (isKnown || isDoomed) {
        const mark = el('span', 'choice-known');
        mark.textContent = isDoomed ? strings().advisor.doomedIs : strings().challenger.ownMark;
        btn.append(mark);
      }
      btn.addEventListener('click', () => this.commit(choice.id));
      this.choicesHost.append(btn);
      buttons.push(btn);
    });
    this.refs.others = buttons;
  }

  /**
   * 自分も助言を書く。全員挑戦者は「お互いに情報をあげながら進む」遊びなので、
   * 書けないと何も渡せない。
   * 送れないものは送らせない（押してから断るのでは遅い）。
   */
  private renderCompose(state: PartyState): void {
    const T = strings();
    const round = state.round;
    this.composeHost.innerHTML = '';
    if (!round) return;

    const labels = round.room.choices.map((c) => localized(c.label));
    const row = el('div', 'compose-row');
    const input = document.createElement('input');
    input.className = 'field';
    input.placeholder = T.advisor.hintPlaceholder;
    input.maxLength = HINT_MAX_LENGTH;
    input.setAttribute('aria-label', T.advisor.hintPlaceholder);

    const send = document.createElement('button');
    send.className = 'primary';
    send.textContent = T.advisor.send;

    const status = el('p', 'status');

    const sync = (): void => {
      const text = input.value.trim();
      const len = [...input.value].length;
      let reason = '';
      if (len > HINT_MAX_LENGTH) reason = T.errors.tooLong;
      else if (text && containsBlocked(text)) reason = T.errors.blocked;
      else if (text && isPointing(text, labels)) reason = T.errors.pointing;
      else if (text && countChoicesMentioned(text, labels) > MAX_CHOICES_PER_HINT) reason = T.errors.tooManyChoices;
      status.textContent = reason;
      status.classList.toggle('is-error', !!reason);
      send.disabled = text.length === 0 || !!reason;
    };

    const submit = (): void => {
      const text = input.value.trim();
      if (!text || send.disabled) return;
      this.source.hint(text);
      input.value = '';
      sync();
      status.textContent = T.advisor.sent;
      status.classList.remove('is-error');
    };

    input.addEventListener('input', sync);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    send.addEventListener('click', submit);
    sync();

    row.append(input, send);
    this.composeHost.append(row, status);
  }

  private renderHints(state: PartyState): void {
    const T = strings();
    const round = state.round;
    if (!round) return;
    this.hintsHost.innerHTML = '';

    const head = el('div', 'hints-head');
    const count = el('span', 'hints-count');
    // 一人が二つ喋る（扉について一つ、人を指して一つ）ので、
    // 行の数ではなく扉について言った人の数を数える
    const spoke = new Set(
      round.advice.filter((a) => (a.kind ?? 'door') === 'door').map((a) => a.memberId),
    ).size;
    count.textContent = T.party.spoken(spoke, state.members.length);
    head.append(count);
    // 裏切り者が入れ替わった部屋では、記録が白紙に戻ることを先に言う
    if (round.freshCast) {
      const note = el('span', 'hints-note is-fresh');
      note.textContent = T.challenger.freshCast;
      head.append(note);
    }
    this.hintsHost.append(head);

    if (round.advice.length === 0) {
      const empty = el('p', 'hints-empty');
      empty.textContent = T.challenger.hintsEmpty;
      this.hintsHost.append(empty);
      return;
    }

    const list = el('div', 'hints-list');
    for (const advice of round.advice) {
      const member = state.members.find((m) => m.id === advice.memberId);
      // 人を指した一言は扉についての助言と見た目を分ける（数えるものではない）
      const isCall = (advice.kind ?? 'door') === 'call';
      const row = el('div', `hint-row${member?.out ? ' is-dead' : ''}${isCall ? ' is-call' : ''}`);
      const name = el('span', 'hint-name');
      name.textContent = advice.memberName;
      const rec = el('span', 'hint-record');
      rec.textContent = T.challenger.record(advice.record.hit, advice.record.miss);
      rec.title = T.challenger.recordHint;
      name.append(rec);
      const text = el('span', 'hint-text');
      text.textContent = advice.text;
      row.append(name, text);

      // 自分の発言は通報できない。人を指した一言にも手を出さない
      if (!isCall && advice.memberId !== this.source.meId) {
        const actions = el('span', 'hint-actions');
        const report = document.createElement('button');
        report.className = 'hint-report';
        report.type = 'button';
        const done = this.reported.has(advice.memberId);
        report.textContent = done ? T.challenger.reported : T.challenger.report;
        report.disabled = done;
        report.title = T.challenger.reportNote;
        report.addEventListener('click', () => {
          this.reported.add(advice.memberId);
          this.source.report(advice.memberId, advice.text);
          report.textContent = T.challenger.reported;
          report.disabled = true;
        });
        actions.append(report);
        row.append(actions);
      }
      list.append(row);
    }
    this.hintsHost.append(list);
  }

  /* ───────────────────────────── 進行 ───────────────────────────── */

  private commit(choiceId: string): void {
    if (this.resolving || this.myPick) return;
    this.myPick = choiceId;
    audio.play('commit');
    const chosen = this.choicesHost.querySelector<HTMLElement>(`[data-choice-id="${CSS.escape(choiceId)}"]`);
    chosen?.classList.add('is-chosen');
    for (const btn of this.choicesHost.querySelectorAll('button')) btn.disabled = true;
    this.stopTimer();
    this.source.pick(choiceId);
  }

  private async playOut(state: PartyState): Promise<void> {
    if (this.resolving) return;
    this.resolving = true;
    this.stopTimer();
    const verdict = state.verdict;
    if (!verdict) {
      this.resolving = false;
      return;
    }
    const mine = verdict.results.find((r) => r.id === this.source.meId);
    this.refs.chosen = this.choicesHost.querySelector<HTMLElement>(
      `[data-choice-id="${CSS.escape(mine?.chosenId ?? '')}"]`,
    );
    this.refs.answer = this.choicesHost.querySelector<HTMLElement>(
      `[data-choice-id="${CSS.escape(verdict.correctId)}"]`,
    );
    this.refs.others = [...this.choicesHost.querySelectorAll<HTMLElement>('.choice')].filter(
      (n) => n !== this.refs.chosen,
    );

    await playResolution(
      this.refs,
      {
        roundId: verdict.roundId,
        chosenId: mine?.chosenId ?? null,
        correctId: verdict.correctId,
        survived: mine?.survived ?? false,
        timedOut: mine?.chosenId == null,
        deathMessage: verdict.deathMessage,
        livesLeft: mine?.livesLeft ?? 0,
        fatal: (mine?.livesLeft ?? 0) <= 0,
        liars: [],
        followedCrowd: mine?.followedCrowd ?? false,
        party: verdict.results.map((r) => ({
          id: r.id,
          name: r.name,
          chosenId: r.chosenId ?? '',
          survived: r.survived,
        })),
      },
      {
        advance: () => this.source.advance(),
        showParty: () => this.showResults(verdict.results, verdict.correctId),
      },
    );

    this.resolving = false;
    this.source.advance();
    const after = this.source.snapshot();
    if (after.phase === 'choosing') audio.play('room-open');
    // 待たせているあいだに次の部屋が届いていたら、ここで描く
    this.render(after);
  }

  /** 誰が何を選んで、誰が死んだか */
  private showResults(
    results: readonly { id: string; name: string; chosenId: string | null; survived: boolean }[],
    correctId: string,
  ): void {
    const T = strings();
    const round = this.source.snapshot().round;
    const labelOf = (id: string | null): string => {
      const choice = round?.room.choices.find((c) => c.id === id);
      return choice ? localized(choice.label) : T.party.noPick;
    };
    void correctId;

    this.hintsHost.innerHTML = '';
    const head = el('div', 'hints-head');
    const dead = results.filter((r) => !r.survived && r.chosenId !== null).length;
    const count = el('span', 'hints-count');
    count.textContent = dead > 0 ? T.challenger.partyDied(dead) : T.challenger.partyLived;
    head.append(count);
    this.hintsHost.append(head);

    const list = el('div', 'hints-list');
    for (const r of results) {
      const row = el('div', `hint-row${r.survived ? '' : ' is-dead'}`);
      const name = el('span', 'hint-name');
      name.textContent = r.id === this.source.meId ? T.party.you : r.name;
      const text = el('span', 'hint-text');
      text.textContent = T.challenger.partyPicked(r.id === this.source.meId ? T.party.you : r.name, labelOf(r.chosenId));
      row.append(name, text);
      list.append(row);
    }
    this.hintsHost.append(list);
  }

  private renderEnd(state: PartyState): void {
    this.stopTimer();
    const T = strings();
    const me = state.members.find((m) => m.id === this.source.meId);
    const won = me ? !me.out : false;
    audio.play(won ? 'survive' : 'gameover');

    const screen = el('div', 'end-screen grain vignette');
    const mark = el('h1', `end-mark${won ? '' : ' is-death'}`);
    mark.textContent = won ? T.verdict.cleared : T.verdict.gameover;

    const stat = el('p', 'end-stat');
    stat.textContent = T.party.reached(state.roomNumber - 1, state.totalRooms);

    const survivors = el('p', 'end-stat');
    const alive = state.members.filter((m) => !m.out).map((m) => (m.id === this.source.meId ? T.party.you : m.name));
    survivors.textContent = alive.length ? T.party.survivors(alive.join(T.verdict.nameSeparator)) : T.party.noSurvivors;

    // 区画ごとに出す。まとめると「ほぼ全員が裏切り者」になって読めない
    const traitors = el('div', 'end-reveal');
    const nameOf = (id: string): string =>
      id === this.source.meId ? T.party.you : (state.members.find((m) => m.id === id)?.name ?? id);
    if (state.traitorsBySection.length === 0) {
      const line = el('p', 'end-stat');
      line.textContent = T.verdict.revealNone;
      traitors.append(line);
    } else {
      // 区画ごとに最後の卓だけ（同じ区画に複数あれば後のもので上書き）
      const last = new Map<number, readonly string[]>();
      for (const e of state.traitorsBySection) last.set(e.sectionIndex, e.ids);
      for (const entry of [...last.entries()].sort((a, b) => a[0] - b[0]).map(([sectionIndex, ids]) => ({ sectionIndex, ids }))) {
        const line = el('p', 'end-stat');
        line.textContent = T.verdict.revealSection(
          entry.sectionIndex + 1,
          entry.ids.map(nameOf).join(T.verdict.nameSeparator),
        );
        traitors.append(line);
      }
    }

    const again = document.createElement('button');
    again.className = 'end-action';
    again.textContent = T.verdict.retry;
    again.addEventListener('click', () => {
      this.dispose();
      this.onExit();
    });

    screen.append(mark, stat, survivors, traitors, again);
    this.root.append(screen);
    again.focus();
  }

  /* ───────────────────────────── 時計と AI ───────────────────────────── */

  private startTimer(): void {
    this.stopTimer();
    const step = (): void => {
      const state = this.source.snapshot();
      if (state.phase !== 'choosing' || !state.round) return;
      const left = Math.max(0, state.round.deadlineAt - Date.now());
      const seconds = Math.ceil(left / 1000);
      this.timer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      this.timer.classList.toggle('is-low', seconds <= 10);
      if (left <= 0) {
        this.stopTimer();
        this.source.timeUp();
        return;
      }
      this.timerHandle = requestAnimationFrame(step);
    };
    this.timerHandle = requestAnimationFrame(step);
  }

  private stopTimer(): void {
    if (this.timerHandle) cancelAnimationFrame(this.timerHandle);
    this.timerHandle = 0;
  }
}
