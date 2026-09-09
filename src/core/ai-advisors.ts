import type { AdvisorInfo, Hint } from './schema';
import type { AdvisorGateway, RoundBriefing, Unsubscribe } from './advisor-gateway';
import { createRng, shuffled, type Rng } from './rng';
import { writeHint } from './hint-writer';

/**
 * AI の助言者。ソロモードで人間の助言者の代わりに入る。
 *
 * 本体から見れば人間の助言者と区別がつかない（同じ AdvisorGateway）。
 * 人間かAIかでゲームロジックを分岐させないという原則の実装側。
 *
 * 賢さは持たせていない。正直者は正解を、嘘つきは外れを押すだけ。
 * 読み合いの成立に必要なのは「誰が嘘つきか分からないこと」であって、
 * 助言者が賢いことではない。
 */

const NAMES = [
  'たろう', 'はなこ', 'ゲンさん', 'みかん', 'クロ', 'ヤス', 'せつ', 'とんび',
  'まめ', 'ウシオ', 'かがり', 'ノブ', 'すず', 'イチ', 'ハルさん', 'ぬい',
  'テツ', 'こより', 'ゴロー', 'あかね', 'シノ', 'まさ', 'ちどり', 'ぜんじ',
];

export interface AiAdvisorOptions {
  count?: number;
  seed?: number;
  /** 助言が届くまでの間。全員同時に出ると機械に見える */
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
    this.maxDelay = options.maxDelayMs ?? 3200;
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

    const wrong = briefing.room.choices.filter((c) => c.id !== briefing.correct);

    for (const id of briefing.casting.speakerIds) {
      const advisor = this.advisors.find((a) => a.id === id);
      if (!advisor) continue;

      const isLiar = briefing.casting.liarIds.includes(id);
      // 嘘つきは互いを知らないので、狙う外れがばらける
      const decoy = wrong[Math.floor(this.rng() * wrong.length)];
      const target = isLiar ? decoy?.id ?? briefing.correct : briefing.correct;
      const text = writeHint({ choices: briefing.room.choices, target, rng: this.rng });
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
