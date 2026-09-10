import type { AdvisorInfo, Hint } from './schema';
import type { AdvisorCall, AdvisorGateway, RoundBriefing, Unsubscribe } from './advisor-gateway';
import { createRng, shuffled, type Rng } from './rng';
import { writeHint, voiceOf, unique } from './hint-writer';
import { chooseCall, type Said } from './name-calling';
import type { Choice } from './schema';
import { liarBias, liarHonestyAt } from './casting';
import type { Knowledge } from './schema';
import { STANDARD, type ModeConfig } from './limits';
import { companionNames } from './companion-names';

/**
 * AI の助言者。ソロモードで人間の助言者の代わりに入る。
 * 本体から見れば人間と区別がつかない（同じ AdvisorGateway）。
 */


export interface AiAdvisorOptions {
  count?: number;
  mode?: ModeConfig;
  seed?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
}

export class AiAdvisorGateway implements AdvisorGateway {
  readonly kind = 'ai' as const;

  private readonly advisors: AdvisorInfo[];
  /** 抜けた人の席を引き継いだぶん */
  private adopted: AdvisorInfo[] = [];
  private readonly rng: Rng;
  private readonly minDelay: number;
  private readonly maxDelay: number;
  private readonly mode: ModeConfig;
  private hintListeners = new Set<(hint: Hint) => void>();
  private callListeners = new Set<(call: AdvisorCall) => void>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private openRoundId: string | null = null;
  /** 全員挑戦者モードで、この部屋の仲間の手 */
  private roundPicks = new Map<string, string>();
  private roundCrowd = new Map<string, number>();
  private lastRoundId = '';

  constructor(options: AiAdvisorOptions = {}) {
    const count = Math.min(options.count ?? 12, companionNames().length);
    this.rng = createRng(options.seed ?? (Date.now() & 0xffffffff));
    this.mode = options.mode ?? STANDARD;
    this.minDelay = options.minDelayMs ?? 400;
    this.maxDelay = options.maxDelayMs ?? 3400;
    this.advisors = shuffled(companionNames(), this.rng)
      .slice(0, count)
      .map((name, i) => ({ id: `ai_${i}`, name, kind: 'ai' as const }));
  }

  roster(): readonly AdvisorInfo[] {
    return [...this.advisors, ...this.adopted];
  }

  /**
   * 抜けた人の席を引き継ぐ。
   *
   * ランダムマッチでは、裏切って負けた者が抜ける。
   * 席ごと消すと、その人について積んだ記録も消えて読みが台無しになる。
   * **名前と席をそのままに、中身だけ AI に替える。**
   * 残った側から見れば、その人はまだそこにいる。
   */
  adopt(seat: AdvisorInfo): void {
    if (this.adopted.some((a) => a.id === seat.id)) return;
    this.adopted.push({ ...seat, kind: 'ai' });
  }

  /** 本人が戻ってきたら席を返す */
  release(id: string): void {
    this.adopted = this.adopted.filter((a) => a.id !== id);
  }

  /** いま AI が代わりに座っている席 */
  adoptedSeats(): readonly AdvisorInfo[] {
    return this.adopted;
  }

  private nameOf(id: string): string {
    return this.advisors.find((a) => a.id === id)?.name ?? '';
  }

  openRound(briefing: RoundBriefing): void {
    this.clearTimers();
    this.openRoundId = briefing.roundId;
    this.decidePicks(briefing);
    this.tallyCrowd(briefing);

    // 嘘つきの癖が強い者ほど、信用を作らずすぐ裏切る。
    // 平均すると LIE_RATE の割合で嘘をつく。
    // 話し方の癖は人ごとに固定（区画のあいだ同じ顔ぶれなので読みが積める）
    // 先に喋った者しか指せない。書いた順にここへ積む
    const said: Said[] = [];
    const seen = new Map<string, Said[]>();
    /**
     * その部屋で本当のことを言うか。**一人につき一度だけ引く。**
     * 文面と名指しで別々に引くと、罠へ誘いながら真実を撃つ、という
     * 噛み合わない振る舞いになる
     */
    const honest = new Map<string, boolean>();
    const honestNow = (id: string): boolean => {
      let v = honest.get(id);
      if (v === undefined) {
        v = this.rng() < liarHonestyAt(id, briefing.roomInSection, briefing.roomsPerSection);
        honest.set(id, v);
      }
      return v;
    };

    const write = (id: string, nudge = 0): string => {
      const knowledge = briefing.knowledge.get(id);
      if (!knowledge) return '';
      const voice = voiceOf(id);
      return writeHint({
        choices: briefing.room.choices,
        knowledge,
        rng: this.rng,
        liarHonestyRate: Math.max(0.05, Math.min(0.5, this.mode.liarHonesty * liarBias(id))),
        liarMimicRate: this.mode.liarMimic,
        voice: { ...voice, seat: voice.seat + nudge },
        liarHonest: honestNow(id),
      });
    };
    const order = briefing.casting.speakerIds.filter((id) => briefing.knowledge.has(id));
    const drafted = order.map((id) => {
      seen.set(id, [...said]);
      const text = write(id);
      said.push({ id, name: this.nameOf(id), text });
      return { id, text };
    });
    // 8人が同じ扉を押すと型の数を超えてぶつかる。同じ文面は並べない
    const texts = new Map(unique(drafted, write).map((h) => [h.id, h.text]));

    // 出る順を書いた順に揃える。
    // 遅れをばらばらに振ると「ノブは嘘だ」がノブより先に出てしまい、
    // 会話に読めない。間はばらつかせたまま、順だけ固定する
    const delays = order
      .map(() => this.minDelay + this.rng() * (this.maxDelay - this.minDelay))
      .sort((a, b) => a - b);

    // 誰を指すか。**扉について言った文面を読んでから**決める。
    // 自分の持ち情報と、届いた文面だけで決める（他人の配役は覗かない）
    const finalSaid: Said[] = order.map((id) => ({ id, name: this.nameOf(id), text: texts.get(id) ?? '' }));
    const calls = new Map<string, { targetId: string; doubt: boolean }>();
    for (const id of order) {
      if (this.rng() >= this.mode.nameCall) continue;
      const knowledge = briefing.knowledge.get(id);
      if (!knowledge) continue;
      // 信用を作っている最中の嘘つきは、協力者と同じ振る舞いをする。
      // 正解を知っているので、正解を押していない者を撃つ側に回る。
      // ここを揃えないと、口では味方のふりをしながら真実を撃つ、という
      // 見分けやすすぎる形になる
      const acting =
        knowledge.kind === 'liar' && honestNow(id)
          ? ({ kind: 'honest' as const, candidates: [knowledge.correct] })
          : knowledge;
      const call = chooseCall(acting, briefing.room.choices, finalSaid.filter((s) => s.id !== id && s.text), this.rng);
      if (call) calls.set(id, { targetId: call.id, doubt: call.doubt });
    }

    for (const [i, id] of order.entries()) {
      const advisor = this.advisors.find((a) => a.id === id);
      const text = texts.get(id);
      if (!advisor || !text) continue;
      const delay = delays[i] ?? this.minDelay;
      const call = calls.get(id);
      if (call) {
        // 指すのは、相手が喋ったあと。全員の文面が出そろってから撃つ。
        // 間は助言の間に比例させる（?fast=1 で助言だけ速くなると噛み合わない）
        const gap = Math.max(150, this.maxDelay * 0.25);
        const after = (delays[delays.length - 1] ?? this.minDelay) + gap * (0.6 + this.rng() * 0.8);
        this.timers.push(
          setTimeout(() => {
            if (this.openRoundId !== briefing.roundId) return;
            for (const l of this.callListeners) {
              l({ advisorId: id, targetId: call.targetId, doubt: call.doubt, roundId: briefing.roundId });
            }
          }, after),
        );
      }

      this.timers.push(
        setTimeout(() => {
          if (this.openRoundId !== briefing.roundId) return;
          const hint: Hint = {
            advisorId: advisor.id,
            advisorName: advisor.name,
            text,
            roundId: briefing.roundId,
            sentAt: Date.now(),
          };
          for (const l of this.hintListeners) l(hint);
        }, delay),
      );
    }
  }

  closeRound(_roundId?: string): void {
    this.openRoundId = null;
    this.clearTimers();
  }

  onHint(listener: (hint: Hint) => void): Unsubscribe {
    this.hintListeners.add(listener);
    return () => this.hintListeners.delete(listener);
  }

  onCall(listener: (call: AdvisorCall) => void): Unsubscribe {
    this.callListeners.add(listener);
    return () => this.callListeners.delete(listener);
  }

  onRosterChange(): Unsubscribe {
    return () => {};
  }

  /**
   * 全員挑戦者モードで、仲間がそれぞれ何を選ぶか。
   *
   * 本体はこの結果を受け取るだけで、中身を知らない。
   * だから人間の仲間（ブラウザから参加した人）に差し替えても本体は変わらない。
   */
  picks(roundId: string): ReadonlyMap<string, string> {
    return roundId === this.lastRoundId ? this.roundPicks : new Map();
  }

  /**
   * 仲間は自分の持ち情報を重く見て、他人の助言も少し聞く。
   * 罠だけを知っている嘘つきは、罠を避けたうえで他人の話に乗る
   * （正解は知らないので、嘘つきも時々死ぬ）。
   */
  private decidePicks(briefing: RoundBriefing): void {
    this.roundPicks = new Map();
    this.lastRoundId = briefing.roundId;
    const choices: readonly Choice[] = briefing.room.choices;

    for (const id of briefing.casting.speakerIds) {
      const own = briefing.knowledge.get(id);
      const score = new Map(choices.map((c) => [c.id, 0]));
      const bump = (key: string, by: number): void => {
        score.set(key, (score.get(key) ?? 0) + by);
      };

      if (own?.kind === 'honest') for (const c of own.candidates) bump(c, 2.5);
      if (own?.kind === 'doomed') bump(own.doomed, -3);
      if (own?.kind === 'trapper') bump(own.trap, -99);
      if (own?.kind === 'liar') bump(own.correct, 99);

      // 他人の助言も少しは聞く。ここでは自分が書いた文面を共有の材料として使う
      for (const other of briefing.casting.speakerIds) {
        if (other === id) continue;
        const k = briefing.knowledge.get(other);
        if (k?.kind === 'honest') for (const c of k.candidates) bump(c, 0.6 / k.candidates.length);
        if (k?.kind === 'trapper') bump(k.trap, 0.4);
        if (k?.kind === 'liar') bump(k.trap, 0.4);
      }

      const max = Math.max(...score.values());
      const best = choices.filter((c) => score.get(c.id) === max);
      const chosen = best[Math.floor(this.rng() * best.length)] ?? choices[0];
      if (chosen) this.roundPicks.set(id, chosen.id);
    }
  }

  volunteers(): readonly string[] {
    return [];
  }

  /**
   * 発言枠の外にいる者の投票。
   *
   * 枠外にも知識は配られている（見えていて言えない、が手触りの芯）。
   * 嘘つきは全員が同じ罠に投じ、協力者は候補のどれかに散る。
   * だから票は罠に集まりやすい——それがこのゲームの言いたいことでもある。
   */
  crowdVotes(roundId: string): ReadonlyMap<string, number> {
    return roundId === this.lastRoundId ? this.roundCrowd : new Map();
  }

  private tallyCrowd(briefing: RoundBriefing): void {
    this.roundCrowd = new Map();
    const speakers = new Set(briefing.casting.speakerIds);
    for (const advisor of [...this.advisors, ...this.adopted]) {
      if (speakers.has(advisor.id)) continue;
      const own = briefing.knowledge.get(advisor.id);
      if (!own) continue;
      const pick = this.voteFor(own, briefing.room.choices);
      if (pick) this.roundCrowd.set(pick, (this.roundCrowd.get(pick) ?? 0) + 1);
    }
  }

  private voteFor(own: Knowledge, choices: readonly Choice[]): string | null {
    if (own.kind === 'liar' || own.kind === 'trapper') return own.trap;
    if (own.kind === 'honest' && own.candidates.length > 0) {
      return own.candidates[Math.floor(this.rng() * own.candidates.length)] ?? null;
    }
    if (own.kind === 'doomed') {
      const rest = choices.filter((c) => c.id !== own.doomed);
      return rest[Math.floor(this.rng() * rest.length)]?.id ?? null;
    }
    return null;
  }

  dispose(): void {
    this.clearTimers();
    this.hintListeners.clear();
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
