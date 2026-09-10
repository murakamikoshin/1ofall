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
  /**
   * 同じ部屋のまま次の周へ。渡されたときだけ終わりの画面に口が出る。
   *
   * 賭場と同じ理屈で、ここが無いと一周ごとに全員が合言葉を入れ直す。
   * 6〜8人で遊ぶモードなので、入れ直しの手間は人数ぶんかかる。
   */
  onAgainHere?(): void;
  /**
   * 次の周を始められるのは部屋の主だけ。客はこれを立てる。
   *
   * 部屋を開き直せるのは最初に線を繋いだ一人（`challengerId`）で、
   * 客が `challenger/start` を投げても黙って断られる。それでも客の画面に
   * 「同じ賭場でもう一度」を出していたので、**押した客は終わりの画面を失い、
   * 何も起きないまま止まっていた**。押せない口は出さず、待っていると書く。
   */
  waitsForHost?: boolean;
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
  private readonly onAgainHere: (() => void) | null;
  private readonly waitsForHost: boolean;

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
  /**
   * 置いた疑いの札。**送らない。自分の覚え書き。**
   * 区画の答え合わせで、置いた札と本当の役を突き合わせる。
   */
  private doubted = new Set<string>();
  /** 場に届いた名指しの覚え。部屋が変わると捨てる */
  private heardCalls = new Set<string>();
  /** 一周ぶんの読み。区画の答え合わせのたびに積んで、終わりの画面で出す */
  private runRead = { caught: 0, liars: 0, wrong: 0, marked: 0 };
  private ended = false;
  /** 乗せた終わりの画面。主が次の周を始めたら、自分で押していなくても下ろす */
  private endScreen: HTMLElement | null = null;
  /** 区画の答え合わせ。時間で送るので、押す口は無い */
  private answerVeil: HTMLElement | null = null;
  private answerSection = -1;
  private answerTick = 0;
  /** 一人遊びの全員挑戦者では、段を刻むのがこちら側になる */
  private answerTimer = 0;

  constructor(options: PartyBoardOptions) {
    this.root = options.root;
    this.onExit = options.onExit;
    this.onAgainHere = options.onAgainHere ?? null;
    this.waitsForHost = options.waitsForHost ?? false;
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
    this.dropAnswer();
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
    /*
     * 終わりの画面が乗ったまま次の周が届くことがある（主が押した）。
     * 下ろさないと、扉は DOM にあるのに客は終わった画面を見続ける。
     * 押した本人は renderEnd の中で下ろしているので、ここは残りの全員ぶん。
     */
    if (this.ended) this.dropEnd();
    this.renderRoster(state);

    // 判定が立ったら演出を流す。誰が段を進めるかは供給源が決める
    if (state.verdict && state.verdict.roundId !== this.playedRound && state.phase !== 'choosing') {
      this.playedRound = state.verdict.roundId;
      void this.playOut(state);
      return;
    }
    // 演出の最中に次の部屋（や答え合わせ）が届くことがある。段を刻むのはサーバーで、
    // 死んだ者がいる部屋でも3.4秒で送ってくる。そこで描き直すと死んだ瞬間が飛ぶ。
    // **答え合わせもここより後で出す。** 先に出すと演出を紙で潰す
    if (this.resolving) return;

    /*
     * 区画の答え合わせ。誰が裏切っていたかがここで開く。
     * 全員挑戦者は合図を待てない（6〜8人の押すのを待つと場が止まる）ので、
     * サーバーが刻む時間だけ出して自分で消える。
     */
    if (state.phase === 'answer' && state.sectionAnswer) {
      this.showAnswer(state.sectionAnswer);
      return;
    }
    this.dropAnswer();

    if (state.phase !== 'choosing' || !state.round) return;

    const round = state.round;
    if (round.roundId !== this.roundId) {
      this.roundId = round.roundId;
      // 裏切り者ごと引き直されたら、札は別人のものになる
      if (round.freshCast) this.doubted.clear();
      this.heardCalls.clear();
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
      img.src = choiceArt(round.room.theme, round.room.id, choice.id, choice.image, i);
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

    /*
     * 人を指した一言が届いたら鳴らす。助言そのものは無音のまま
     * （全員挑戦者は6〜8人が毎部屋喋るので、全部鳴らすと意味が消える）。
     */
    for (const a of round.advice) {
      if ((a.kind ?? 'door') !== 'call') continue;
      const key = `${round.roundId}:${a.memberId}`;
      if (this.heardCalls.has(key)) continue;
      this.heardCalls.add(key);
      audio.play('accuse');
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
      if (this.doubted.has(advice.memberId)) row.classList.add('is-doubted');

      // 自分の発言は通報できない。人を指した一言にも手を出さない
      if (!isCall && advice.memberId !== this.source.meId) {
        const actions = el('span', 'hint-actions');
        // 疑いの札。押しても盤面は動かない（答え合わせで突き合わせる）
        const doubt = document.createElement('button');
        doubt.type = 'button';
        doubt.title = T.challenger.doubtHint;
        const paint = (): void => {
          const on = this.doubted.has(advice.memberId);
          doubt.className = `hint-doubt${on ? ' is-on' : ''}`;
          doubt.textContent = on ? T.challenger.doubtOn : T.challenger.doubt;
          doubt.setAttribute('aria-pressed', on ? 'true' : 'false');
          row.classList.toggle('is-doubted', on);
        };
        doubt.addEventListener('click', () => {
          if (this.doubted.has(advice.memberId)) this.doubted.delete(advice.memberId);
          else this.doubted.add(advice.memberId);
          paint();
        });
        paint();
        actions.append(doubt);
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
    // 一周ぶんの読み。札を置かなかった周には出さない
    const TA = strings().answer;
    const readLine = el('p', 'end-stat is-read');
    readLine.textContent = this.runRead.wrong === 0
      ? TA.readScore(this.runRead.caught, this.runRead.liars)
      : `${TA.readScore(this.runRead.caught, this.runRead.liars)}　${TA.readWrong(this.runRead.wrong)}`;
    readLine.hidden = this.runRead.marked === 0;

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

    const tail: HTMLElement[] = [];
    const buttons: HTMLElement[] = [];
    if (this.onAgainHere) {
      const stay = document.createElement('button');
      stay.className = 'end-action';
      stay.textContent = T.verdict.retryHere;
      stay.addEventListener('click', () => {
        /*
         * 盤面は作り直さず、終わりの画面を**上に重ねて**いる。
         * 下ろさないまま次の周が来ると、盤面が画面の裏に隠れたままになる。
         */
        this.dropEnd();
        // 次の周は読みの記録も白紙から
        this.runRead = { caught: 0, liars: 0, wrong: 0, marked: 0 };
        this.doubted.clear();
        this.onAgainHere?.();
      });
      buttons.push(stay);
      tail.push(stay);
    } else if (this.waitsForHost) {
      // 客は待つ。主が始めれば render 側で勝手に下ろすので、押す口はいらない
      const note = el('p', 'end-stat is-waiting');
      note.textContent = T.verdict.waitingHost;
      tail.push(note);
    }

    const again = document.createElement('button');
    // 主は賭場を閉じる。客は自分だけ出る。一人遊びは題名へ戻ってやり直す
    const quiet = this.onAgainHere || this.waitsForHost;
    again.className = `end-action${quiet ? ' is-quiet' : ''}`;
    again.textContent = this.onAgainHere
      ? T.verdict.leaveRoom
      : this.waitsForHost ? T.verdict.leaveHere : T.verdict.retry;
    again.addEventListener('click', () => {
      this.dispose();
      this.onExit();
    });
    buttons.push(again);
    tail.push(again);

    screen.append(mark, stat, survivors, readLine, traitors, ...tail);
    this.endScreen = screen;
    this.root.append(screen);
    buttons[0]?.focus();
  }

  /** 区画の答え合わせを出す。同じ区画ぶんを二度描かない */
  private showAnswer(answer: NonNullable<PartyState['sectionAnswer']>): void {
    if (this.answerVeil && this.answerSection === answer.sectionIndex) return;
    this.dropAnswer();
    this.answerSection = answer.sectionIndex;
    this.stopTimer();
    audio.play('answer');
    const T = strings().answer;

    const veil = el('div', 'answer-veil');
    veil.setAttribute('role', 'dialog');
    veil.setAttribute('aria-modal', 'true');
    const sheet = el('div', 'answer-sheet');
    const heading = el('h2', 'answer-heading');
    heading.textContent = T.advisorHeading(answer.sectionIndex + 1);
    const sub = el('p', 'answer-sub');
    sub.textContent = T.heading;
    sheet.append(heading, sub);

    const rows = el('div', 'answer-rows');
    for (const r of answer.rows) {
      const mine = r.id === this.source.meId;
      const row = el('div', `answer-row${r.liar ? ' is-liar' : ''}${mine ? ' is-me' : ''}`);
      const name = el('span', 'answer-name');
      name.textContent = mine ? `${r.name}（${T.yours}）` : r.name;
      if (this.doubted.has(r.id)) {
        row.classList.add('is-doubted');
        const mark = el('span', 'answer-mark');
        mark.textContent = T.doubted;
        name.append(mark);
      }
      const role = el('span', 'answer-role');
      role.textContent = r.liar ? T.liar : T.honest;
      const rec = el('span', 'answer-record');
      rec.textContent = r.hit + r.miss === 0 ? T.noRecord : T.record(r.hit, r.miss);
      // 信用を積んでから裏切った者を、数字のほうから指す（一人用と同じ線）
      if (r.liar && r.hit >= 3 && r.hit >= r.miss * 2) {
        const built = el('span', 'answer-built');
        built.textContent = T.builtCredit;
        rec.append(built);
      }
      row.append(name, role, rec);
      rows.append(row);
    }
    sheet.append(rows);

    // 置いた札との突き合わせ。自分は数に入れない（役は最初から知っている）
    const others = answer.rows.filter((r) => r.id !== this.source.meId);
    const marked = others.filter((r) => this.doubted.has(r.id));
    const liars = others.filter((r) => r.liar);
    const caught = marked.filter((r) => r.liar).length;
    const wrong = marked.length - caught;
    this.runRead = {
      caught: this.runRead.caught + caught,
      liars: this.runRead.liars + liars.length,
      wrong: this.runRead.wrong + wrong,
      marked: this.runRead.marked + marked.length,
    };
    const score = el('p', 'answer-score');
    score.textContent = marked.length === 0
      ? T.readNone
      : wrong === 0
        ? T.readScore(caught, liars.length)
        : `${T.readScore(caught, liars.length)}　${T.readWrong(wrong)}`;
    score.classList.toggle('is-good', marked.length > 0 && caught === liars.length && wrong === 0);
    sheet.append(score);

    const note = el('p', 'answer-note');
    note.setAttribute('role', 'status');
    const countdown = (): void => {
      const left = Math.max(0, Math.ceil((answer.untilMs - Date.now()) / 1000));
      note.textContent = `${T.note}　${strings().party.answerIn(left)}`;
    };
    countdown();
    this.answerTick = window.setInterval(countdown, 500);
    /*
     * 段を刻むのがこちら側（ブラウザの中だけで動く全員挑戦者）なら、
     * 猶予が切れたところで自分で進める。**忘れると紙が出たまま止まる。**
     * 遠くの部屋ではサーバーが刻むので、ここでは何もしない。
     */
    if (this.source.drivesPresentation) {
      this.answerTimer = window.setTimeout(
        () => this.source.advance(),
        Math.max(0, answer.untilMs - Date.now()),
      );
    }
    sheet.append(note);
    veil.append(sheet);
    // 押す口が無いので、焦点を紙そのものへ移す。
    // 移さないと読み上げに何も渡らない（時間で消えるだけの紙になる）
    sheet.tabIndex = -1;
    this.root.append(veil);
    sheet.focus();
    this.answerVeil = veil;
  }

  private dropAnswer(): void {
    if (this.answerTick) {
      clearInterval(this.answerTick);
      this.answerTick = 0;
    }
    if (this.answerTimer) {
      clearTimeout(this.answerTimer);
      this.answerTimer = 0;
    }
    this.answerVeil?.remove();
    this.answerVeil = null;
    this.answerSection = -1;
  }

  /** 終わりの画面を下ろす。押した本人からも、主が始めたときからも通る */
  private dropEnd(): void {
    this.endScreen?.remove();
    this.endScreen = null;
    this.ended = false;
    // 次の周は新しい roundId で来るが、断られて同じ周に戻ることもある。
    // 覚えたままだと描き直さないので忘れる。
    // playedRound は忘れない（忘れると、届き直した判定でもう一度死ぬ演出が流れる）
    this.roundId = null;
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
