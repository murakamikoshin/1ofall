import type { AdvisorInfo, Hint } from './schema';
import type { AdvisorCall, AdvisorGateway, RoundBriefing, Unsubscribe } from './advisor-gateway';
import { AiAdvisorGateway } from './ai-advisors';
import { ADVISOR_NAME_MAX, type ModeConfig } from './limits';

/**
 * 名前の重なりをほどく。
 *
 * 人を指す一手（「あいつは嘘だ」）は**名前で照合する**ので、
 * 同じ名前が二人いると撃った相手と記録が付く相手がずれる。
 * 人間が仲間の名前をそのまま名乗ると起こる（実際に起きた）。
 *
 * 直すのは後から出てきた側。人間が先に並んでいるので、
 * 名乗り直しを強いられるのは AI のほうになる。
 */
function dedupeNames(roster: readonly AdvisorInfo[]): AdvisorInfo[] {
  const used = new Set<string>();
  return roster.map((a) => {
    if (!used.has(a.name)) {
      used.add(a.name);
      return a;
    }
    for (let n = 2; n <= 99; n++) {
      // 上限を超えると通信の検証（AdvisorNameSchema）で弾かれるので詰める
      const room = Math.max(1, ADVISOR_NAME_MAX - String(n).length);
      const mark = `${a.name.slice(0, room)}${n}`;
      if (!used.has(mark)) {
        used.add(mark);
        return { ...a, name: mark };
      }
    }
    return a;
  });
}

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
  /** AI の嘘のつき方はモードで変わる。渡さないと通常モードの癖になる */
  mode?: ModeConfig;
}

export class CompositeAdvisorGateway implements AdvisorGateway {
  readonly kind = 'human' as const;

  private readonly human: AdvisorGateway | null;
  private readonly ai: AiAdvisorGateway;
  private readonly minAdvisors: number;
  private readonly maxFill: number;
  private rosterListeners = new Set<(roster: readonly AdvisorInfo[]) => void>();
  private unsubs: Unsubscribe[] = [];
  /** 一度でも見た人間の席。抜けても覚えておく */
  private seats = new Map<string, AdvisorInfo>();

  constructor(options: CompositeOptions) {
    this.human = options.human ?? null;
    this.minAdvisors = options.minAdvisors;
    this.maxFill = options.maxFill ?? options.minAdvisors;
    this.ai = new AiAdvisorGateway({
      count: this.maxFill,
      ...(options.aiSeed !== undefined ? { seed: options.aiSeed } : {}),
      ...(options.mode ? { mode: options.mode } : {}),
    });

    if (this.human) {
      this.unsubs.push(
        this.human.onRosterChange(() => {
          this.reconcileSeats();
          for (const l of this.rosterListeners) l(this.roster());
        }),
      );
      this.reconcileSeats();
    }
  }

  /**
   * 抜けた席と、人が足りないぶんの席を突き合わせる。
   *
   * ランダムマッチでは、裏切って負けた者が抜ける。
   * 席ごと消すと積んだ記録が消えて読みが台無しになるので、
   * **名前と席をそのままに、中身だけ AI に替える。**
   */
  private reconcileSeats(): void {
    const present = new Set((this.human?.roster() ?? []).map((a) => a.id));
    for (const a of this.human?.roster() ?? []) this.seats.set(a.id, a);

    for (const [id, seat] of this.seats) {
      if (present.has(id)) this.ai.release(id);
      else this.ai.adopt(seat);
    }
  }

  /** 人が足りないぶんだけ AI を混ぜた名簿。抜けた席は AI が座ったまま残る */
  roster(): readonly AdvisorInfo[] {
    const humans = this.human?.roster() ?? [];
    const taken = this.ai.adoptedSeats();
    const filled = humans.length + taken.length;
    const need = Math.max(0, Math.min(this.maxFill, this.minAdvisors - filled));
    const fill = this.ai.roster().filter((a) => !taken.some((t) => t.id === a.id)).slice(0, need);
    return dedupeNames([...humans, ...taken, ...fill]);
  }

  /** 抽選の重み。人間側だけが持つ（AI は普通の重み） */
  slotWeight(id: string): number {
    return this.human?.slotWeight?.(id) ?? 1;
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

  onCall(listener: (call: AdvisorCall) => void): Unsubscribe {
    const a = this.human?.onCall?.(listener);
    const b = this.ai.onCall?.(listener);
    return () => { a?.(); b?.(); };
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

  /** 枠外の票。人間ぶんと AI ぶんを足す */
  crowdVotes(roundId: string): ReadonlyMap<string, number> {
    const tally = new Map<string, number>();
    for (const source of [this.human, this.ai]) {
      const votes = source?.crowdVotes?.(roundId);
      if (!votes) continue;
      for (const [choiceId, n] of votes) tally.set(choiceId, (tally.get(choiceId) ?? 0) + n);
    }
    return tally;
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.rosterListeners.clear();
    this.human?.dispose();
    this.ai.dispose();
  }
}
