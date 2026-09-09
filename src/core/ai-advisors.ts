import type { AdvisorInfo, Hint } from './schema';
import type { AdvisorGateway, RoundBriefing, Unsubscribe } from './advisor-gateway';
import { createRng, shuffled, type Rng } from './rng';
import { writeHint } from './hint-writer';
import { liarBias } from './casting';

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
  private hintListeners = new Set<(hint: Hint) => void>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private openRoundId: string | null = null;

  constructor(options: AiAdvisorOptions = {}) {
    const count = Math.min(options.count ?? 12, NAMES.length);
    this.rng = createRng(options.seed ?? (Date.now() & 0xffffffff));
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

    for (const id of briefing.casting.speakerIds) {
      const advisor = this.advisors.find((a) => a.id === id);
      const knowledge = briefing.knowledge.get(id);
      if (!advisor || !knowledge) continue;

      // 嘘つきの癖が強い者ほど、信用を作らずすぐ裏切る
      const honesty = 0.55 - Math.min(0.4, liarBias(id) * 0.16);
      const text = writeHint({
        choices: briefing.room.choices,
        knowledge,
        rng: this.rng,
        liarHonestyRate: honesty,
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

  closeRound(): void {
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
