import type { AdvisorInfo, Hint } from './schema';
import type { AdvisorGateway, RoundBriefing, Unsubscribe } from './advisor-gateway';
import { createRng, shuffled, type Rng } from './rng';
import { writeHint, voiceOf } from './hint-writer';
import type { Choice } from './schema';
import { liarBias } from './casting';
import { STANDARD, type ModeConfig } from './limits';

/**
 * AI の助言者。ソロモードで人間の助言者の代わりに入る。
 * 本体から見れば人間と区別がつかない（同じ AdvisorGateway）。
 */

const NAMES = [
  'たろう', 'はなこ', 'ゲンさん', 'みかん', 'クロ', 'ヤス', 'せつ', 'とんび',
  'まめ', 'ウシオ', 'かがり', 'ノブ', 'すず', 'イチ', 'ハルさん', 'ぬい',
  'テツ', 'こより', 'ゴロー', 'あかね', 'シノ', 'まさ', 'ちどり', 'ぜんじ',
];

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
  private readonly rng: Rng;
  private readonly minDelay: number;
  private readonly maxDelay: number;
  private readonly mode: ModeConfig;
  private hintListeners = new Set<(hint: Hint) => void>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private openRoundId: string | null = null;
  /** 全員挑戦者モードで、この部屋の仲間の手 */
  private roundPicks = new Map<string, string>();
  private lastRoundId = '';

  constructor(options: AiAdvisorOptions = {}) {
    const count = Math.min(options.count ?? 12, NAMES.length);
    this.rng = createRng(options.seed ?? (Date.now() & 0xffffffff));
    this.mode = options.mode ?? STANDARD;
    this.minDelay = options.minDelayMs ?? 400;
    this.maxDelay = options.maxDelayMs ?? 3400;
    this.advisors = shuffled(NAMES, this.rng)
      .slice(0, count)
      .map((name, i) => ({ id: `ai_${i}`, name, kind: 'ai' as const }));
  }

  roster(): readonly AdvisorInfo[] {
    return this.advisors;
  }

  openRound(briefing: RoundBriefing): void {
    this.clearTimers();
    this.openRoundId = briefing.roundId;
    this.decidePicks(briefing);

    for (const id of briefing.casting.speakerIds) {
      const advisor = this.advisors.find((a) => a.id === id);
      const knowledge = briefing.knowledge.get(id);
      if (!advisor || !knowledge) continue;

      // 嘘つきの癖が強い者ほど、信用を作らずすぐ裏切る。
      // 平均すると LIE_RATE の割合で嘘をつく
      const honesty = Math.max(0.05, Math.min(0.5, this.mode.liarHonesty * liarBias(id)));
      const text = writeHint({
        choices: briefing.room.choices,
        knowledge,
        rng: this.rng,
        liarHonestyRate: honesty,
        // 話し方の癖は人ごとに固定。区画のあいだ同じ顔ぶれなので読みが積める
        liarMimicRate: this.mode.liarMimic,
        voice: voiceOf(id),
      });
      const delay = this.minDelay + this.rng() * (this.maxDelay - this.minDelay);

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

  dispose(): void {
    this.clearTimers();
    this.hintListeners.clear();
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
