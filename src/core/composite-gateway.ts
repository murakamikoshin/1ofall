import type { AdvisorInfo, Hint } from './schema';
import type { AdvisorGateway, RoundBriefing, Unsubscribe } from './advisor-gateway';
import { AiAdvisorGateway } from './ai-advisors';

/**
 * 人間の助言者と AI の助言者を混ぜる。
 *
 * ランダムマッチで一番効くのはここ。
 * このゲームは助言者が5人いないと読み合いが成立しないが、
 * 野良で毎回5人が揃うのを待たせると、待ち時間で人が離れる。
 * 足りないぶんを AI で埋めれば、1人で並んでもすぐ始められる。
 *
 * 本体はどちらが人間かを知らない。挑戦者からも区別がつかない
 * （名前が並ぶだけで、AI である印は出さない。出すと読みの材料が変わってしまう）。
 */

export interface CompositeOptions {
  /** 人間の助言者の供給源。まだ繋がっていなければ省略できる */
  human?: AdvisorGateway;
  /** これだけの人数になるまで AI で埋める */
  minAdvisors: number;
  /** AI を入れる上限。人が増えたら AI は減る */
  maxFill?: number;
  aiSeed?: number;
}

export class CompositeAdvisorGateway implements AdvisorGateway {
  readonly kind = 'human' as const;

  private readonly human: AdvisorGateway | null;
  private readonly ai: AiAdvisorGateway;
  private readonly minAdvisors: number;
  private readonly maxFill: number;
  private rosterListeners = new Set<(roster: readonly AdvisorInfo[]) => void>();
  private unsubs: Unsubscribe[] = [];

  constructor(options: CompositeOptions) {
    this.human = options.human ?? null;
    this.minAdvisors = options.minAdvisors;
    this.maxFill = options.maxFill ?? options.minAdvisors;
    this.ai = new AiAdvisorGateway({
      count: this.maxFill,
      ...(options.aiSeed !== undefined ? { seed: options.aiSeed } : {}),
    });

    if (this.human) {
      this.unsubs.push(
        this.human.onRosterChange(() => {
          // 人が増減したら埋める数が変わる
          for (const l of this.rosterListeners) l(this.roster());
        }),
      );
    }
  }

  /** 人が足りないぶんだけ AI を混ぜた名簿 */
  roster(): readonly AdvisorInfo[] {
    const humans = this.human?.roster() ?? [];
    const need = Math.max(0, Math.min(this.maxFill, this.minAdvisors - humans.length));
    return [...humans, ...this.ai.roster().slice(0, need)];
  }

  /** いま何人が人間か。表に出す用ではなく、運用の記録用 */
  humanCount(): number {
    return this.human?.roster().length ?? 0;
  }

  openRound(briefing: RoundBriefing): void {
    this.human?.openRound(briefing);
    // AI には、AI が発言枠に入っている場合だけ配る
    const aiIds = new Set(this.ai.roster().map((a) => a.id));
    const aiSpeakers = briefing.casting.speakerIds.filter((id) => aiIds.has(id));
    if (aiSpeakers.length === 0) return;

    this.ai.openRound({
      ...briefing,
      casting: {
        speakerIds: aiSpeakers,
        liarIds: briefing.casting.liarIds.filter((id) => aiIds.has(id)),
      },
    });
  }

  closeRound(roundId: string): void {
    this.human?.closeRound(roundId);
    this.ai.closeRound();
  }

  onHint(listener: (hint: Hint) => void): Unsubscribe {
    const a = this.human?.onHint(listener);
    const b = this.ai.onHint(listener);
    return () => {
      a?.();
      b();
    };
  }

  onRosterChange(listener: (roster: readonly AdvisorInfo[]) => void): Unsubscribe {
    this.rosterListeners.add(listener);
    return () => this.rosterListeners.delete(listener);
  }

  volunteers(): readonly string[] {
    return this.human?.volunteers() ?? [];
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.rosterListeners.clear();
    this.human?.dispose();
    this.ai.dispose();
  }
}
