import { PartyEngine, type PartyMember, type PartyState } from '@/core/party-engine';
import { PARTY, PARTY_MIN_SEATS } from '@/core/limits';
import { corePackage } from '@/core/pack';
import { strings, localized } from '@/i18n';
import { choiceArt } from '@/ui/placeholder';
import { playResolution, resetStage, type ResolutionRefs } from '@/ui/death-sequence';
import { audio } from '@/ui/audio';
import { companionNames } from '@/core/companion-names';

/**
 * 全員挑戦者モードの盤面。
 *
 * 通常モードと画面が違う。**命が人ごとにある**ので、
 * 誰が何回死んだかと、誰がもう決めたかを常に出しておく必要がある。
 * 同じ描画に押し込むと、どちらの規則で動いているのか読めなくなる。
 */

const KEYCAPS = ['1', '2', '3', '4', '5', '6', '7', '8'];

export interface PartyBoardOptions {
  root: HTMLElement;
  /** 人間の仲間。ソロなら空。足りないぶんは AI が埋める */
  humans?: readonly PartyMember[];
  onExit(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export class PartyBoard {
  private readonly engine: PartyEngine;
  private readonly root: HTMLElement;
  private readonly onExit: () => void;

  private roster = el('div', 'party-roster');
  private stage = el('main', 'stage grain vignette');
  private choicesHost = el('div', 'choices');
  private prompt = el('h2', 'prompt');
  private hintsHost = el('section', 'hints');
  private hud = el('header', 'hud');
  private timer = el('div', 'timer');
  private roomCount = el('div', 'room-count');
  private refs: ResolutionRefs;

  private roundId: string | null = null;
  private myPick: string | null = null;
  private resolving = false;
  private timerHandle = 0;
  private aiTimers: ReturnType<typeof setTimeout>[] = [];
  private unsubscribe: (() => void) | null = null;

  constructor(options: PartyBoardOptions) {
    this.root = options.root;
    this.onExit = options.onExit;

    const humans = options.humans ?? [];
    const members: PartyMember[] = [
      { id: 'me', name: strings().party.you, kind: 'human' },
      ...humans,
    ];
    // 4人だと正直な声が2つしか無く運任せになる。足りないぶんは AI で埋める
    const names = companionNames();
    let i = 0;
    while (members.length < PARTY_MIN_SEATS) {
      members.push({ id: `ai_${i}`, name: names[i % names.length] ?? `AI${i}`, kind: 'ai' });
      i += 1;
    }

    this.engine = new PartyEngine({ pack: corePackage(), members, mode: PARTY });

    const lamp = el('div', 'lamp');
    const blackout = el('div', 'blackout');
    const banner = el('div', 'banner');
    banner.setAttribute('role', 'status');
    this.refs = { stage: this.stage, lamp, blackout, banner, chosen: null, others: [], answer: null };

    this.timer.setAttribute('role', 'timer');
    // 命は人ごとなので HUD には出さない。名簿のほうに全員ぶん並ぶ
    this.hud.classList.add('party-hud');
    this.hud.append(this.roomCount, this.timer);
    this.stage.append(this.choicesHost, this.prompt);
    this.hintsHost.setAttribute('aria-live', 'polite');
    this.root.innerHTML = '';
    this.root.append(this.hud, this.roster, this.stage, this.hintsHost, lamp, blackout, banner);
  }

  start(): void {
    audio.load();
    this.unsubscribe = this.engine.subscribe((state) => this.render(state));
    this.engine.start();
    audio.play('room-open');
  }

  dispose(): void {
    this.unsubscribe?.();
    this.stopTimer();
    this.clearAiTimers();
    this.engine.dispose();
  }

  /* ───────────────────────────── 描画 ───────────────────────────── */

  private render(state: PartyState): void {
    if (state.phase === 'gameover' || state.phase === 'cleared') {
      this.renderEnd(state);
      return;
    }
    this.renderRoster(state);
    if (state.phase !== 'choosing' || !state.round) return;

    const round = state.round;
    if (round.roundId !== this.roundId) {
      this.roundId = round.roundId;
      this.myPick = null;
      this.resolving = false;
      const T = strings();
      this.roomCount.textContent = `${T.hud.room(round.roomNumber)}　${T.hud.section(round.sectionIndex + 1, state.sectionCount)}`;
      this.prompt.textContent = localized(round.room.prompt);
      resetStage(this.refs);
      this.renderChoices(state);
      this.scheduleAi();
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
      name.textContent = member.id === 'me' ? T.party.you : member.name;
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
    const own = this.engine.knowledgeFor('me');
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

  private renderHints(state: PartyState): void {
    const T = strings();
    const round = state.round;
    if (!round) return;
    this.hintsHost.innerHTML = '';

    const head = el('div', 'hints-head');
    const count = el('span', 'hints-count');
    count.textContent = T.party.spoken(round.advice.length, state.members.length);
    head.append(count);
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
      const row = el('div', `hint-row${member?.out ? ' is-dead' : ''}`);
      const name = el('span', 'hint-name');
      name.textContent = advice.memberName;
      const rec = el('span', 'hint-record');
      rec.textContent = T.challenger.record(advice.record.hit, advice.record.miss);
      rec.title = T.challenger.recordHint;
      name.append(rec);
      const text = el('span', 'hint-text');
      text.textContent = advice.text;
      row.append(name, text);
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
    this.engine.pick('me', choiceId);
    void this.settleWhenReady();
  }

  /** 仲間が決めるのを待ってから開く */
  private async settleWhenReady(): Promise<void> {
    if (this.resolving) return;
    this.resolving = true;
    this.stopTimer();
    // AI の仲間はここで一斉に決める（人間が待たされないよう短く）
    await new Promise((r) => setTimeout(r, 700));
    for (const [id, choice] of this.engine.aiPicks()) this.engine.pick(id, choice);
    this.engine.timeUp();
    await this.playOut();
  }

  private async playOut(): Promise<void> {
    const state = this.engine.snapshot();
    const verdict = state.verdict;
    if (!verdict) {
      this.resolving = false;
      return;
    }
    const mine = verdict.results.find((r) => r.id === 'me');
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
        party: verdict.results.map((r) => ({
          id: r.id,
          name: r.name,
          chosenId: r.chosenId ?? '',
          survived: r.survived,
        })),
      },
      {
        advance: () => this.engine.advancePresentation(),
        showParty: () => this.showResults(verdict.results, verdict.correctId),
      },
    );

    this.resolving = false;
    this.engine.advancePresentation();
    const after = this.engine.snapshot();
    if (after.phase === 'choosing') audio.play('room-open');
  }

  /** 誰が何を選んで、誰が死んだか */
  private showResults(
    results: readonly { id: string; name: string; chosenId: string | null; survived: boolean }[],
    correctId: string,
  ): void {
    const T = strings();
    const round = this.engine.snapshot().round;
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
      name.textContent = r.id === 'me' ? T.party.you : r.name;
      const text = el('span', 'hint-text');
      text.textContent = T.challenger.partyPicked(r.id === 'me' ? T.party.you : r.name, labelOf(r.chosenId));
      row.append(name, text);
      list.append(row);
    }
    this.hintsHost.append(list);
  }

  private renderEnd(state: PartyState): void {
    this.stopTimer();
    this.clearAiTimers();
    const T = strings();
    const me = state.members.find((m) => m.id === 'me');
    const won = me ? !me.out : false;
    audio.play(won ? 'survive' : 'gameover');

    const screen = el('div', 'end-screen grain vignette');
    const mark = el('h1', `end-mark${won ? '' : ' is-death'}`);
    mark.textContent = won ? T.verdict.cleared : T.verdict.gameover;

    const stat = el('p', 'end-stat');
    stat.textContent = T.party.reached(state.roomNumber - 1, state.totalRooms);

    const survivors = el('p', 'end-stat');
    const alive = state.members.filter((m) => !m.out).map((m) => (m.id === 'me' ? T.party.you : m.name));
    survivors.textContent = alive.length ? T.party.survivors(alive.join(T.verdict.nameSeparator)) : T.party.noSurvivors;

    const traitors = el('p', 'end-stat');
    traitors.textContent = state.traitors.length
      ? T.party.traitorsWere(state.traitors.map((t) => (t.id === 'me' ? T.party.you : t.name)).join(T.verdict.nameSeparator))
      : T.verdict.revealNone;

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

  private scheduleAi(): void {
    this.clearAiTimers();
    const hints = this.engine.aiHints();
    hints.forEach((hint, i) => {
      // 一斉に出ると読めない。順に置く
      const delay = 900 + i * (700 + Math.random() * 900);
      this.aiTimers.push(
        setTimeout(() => {
          this.engine.hint(hint.memberId, hint.text);
        }, delay),
      );
    });
  }

  private clearAiTimers(): void {
    for (const t of this.aiTimers) clearTimeout(t);
    this.aiTimers = [];
  }

  private startTimer(): void {
    this.stopTimer();
    const step = (): void => {
      const state = this.engine.snapshot();
      if (state.phase !== 'choosing' || !state.round) return;
      const left = Math.max(0, state.round.deadlineAt - Date.now());
      const seconds = Math.ceil(left / 1000);
      this.timer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      this.timer.classList.toggle('is-low', seconds <= 10);
      if (left <= 0) {
        this.stopTimer();
        if (!this.myPick) void this.settleWhenReady();
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
