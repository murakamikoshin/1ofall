import type { AdvisorInfo, Hint, Room } from './schema';
import type { Casting, Knowledge } from './casting';

/**
 * 助言者の供給源を抽象化する。
 * - HumanGateway（PartyKit 経由の視聴者・友達）… フェーズ1
 * - AiGateway（ソロモードの AI 嘘つき）………… フェーズ2で差し替え
 * - NullGateway（助言者なしのローカル1人プレイ）… 手触り検証用
 * ゲーム本体はこの境界の先を知らない。人間かAIかでロジックを分岐させない。
 */

export type Unsubscribe = () => void;

/** 人を指した一手 */
export interface AdvisorCall {
  advisorId: string;
  targetId: string;
  /** true なら疑う、false なら庇う */
  doubt: boolean;
  roundId: string;
}

/**
 * 部屋ごとに助言者側へ配る情報。正解はここにしか乗らない。
 *
 * 助言者ごとに知っていることが違う。嘘つきは正解そのもの、
 * 協力者は「このどれかが生きる」までしか受け取らない。
 */
export interface RoundBriefing {
  roundId: string;
  room: Room;
  casting: Casting;
  /** 助言者ID → その人が知っていること */
  knowledge: ReadonlyMap<string, Knowledge>;
  deadlineAt: number;
  /**
   * 区画の何部屋目か（0始まり）と、区画の長さ。
   * 嘘つきが「どこで裏切るか」を段取りとして持つために要る
   * （casting.ts の liarIsHonest）。
   */
  roomInSection: number;
  roomsPerSection: number;
}

export interface AdvisorGateway {
  readonly kind: 'human' | 'ai' | 'none';
  /** 現在入室している助言者 */
  roster(): readonly AdvisorInfo[];
  /** 部屋開始。配役と正解を配る */
  openRound(briefing: RoundBriefing): void;
  /** 部屋終了。以降のヒントは受け付けない */
  closeRound(roundId: string): void;
  /** ヒント受信 */
  onHint(listener: (hint: Hint) => void): Unsubscribe;
  /**
   * 人を指した（「あいつは嘘だ」）。扉について言う口とは別。
   *
   * 文面ではなく相手のIDと向きだけを運ぶ。文面は本体が組むので、
   * 暴言の検査を通す必要が無く、日本語を打てない人でも押せる。
   */
  onCall?(listener: (call: AdvisorCall) => void): Unsubscribe;
  /** 名簿の変化（入退室） */
  onRosterChange(listener: (roster: readonly AdvisorInfo[]) => void): Unsubscribe;
  /** 指名方式の立候補者 */
  volunteers(): readonly string[];
  /**
   * 発言枠の抽選の重み。1 が普通。
   *
   * 手を挙げた人と、枠外の賭けを当てている人を厚く引くために使う。
   * 配信で発言できない99%から枠へ上がる道がこれ。
   * 実装しない供給源（AI だけの場（NullGateway）など）は返さなくてよい。
   */
  slotWeight?(id: string): number;
  /**
   * 発言枠の外にいる人たちの投票。選択肢ID → 票数。
   *
   * 配信で視聴者が1000人いると、発言できるのは8人。
   * 残りの99%は見ているだけになる。**一番面白い役に誰も当たらない。**
   * そこで枠外にも一票ずつ渡す。
   *
   * 集計は挑戦者に見えるが、**当てにならない。**
   * 枠外にも嘘つきが混ざっていて、嘘つきは全員が同じ罠に投じるので
   * 票は罠に集まりやすい。「群れに従うと死ぬ」がそのまま形になる。
   */
  crowdVotes?(roundId: string): ReadonlyMap<string, number>;
  /**
   * 全員挑戦者モードで、仲間がそれぞれ何を選んだか。
   *
   * ここを本体の外に置いているのは、**仲間が人間になり得る**から。
   * 本体が仲間の手を勝手に決めてしまうと、
   * ブラウザから参加した人が仲間として遊ぶ道が塞がる。
   * 返ってこなかった者は時間切れとして扱う（本体の規則）。
   */
  picks?(roundId: string): ReadonlyMap<string, string>;
  dispose(): void;
}

/** 助言者ゼロ。実装順序 2「ローカル1人プレイ」で使う */
export class NullAdvisorGateway implements AdvisorGateway {
  readonly kind = 'none' as const;
  roster(): readonly AdvisorInfo[] {
    return [];
  }
  openRound(): void {}
  closeRound(): void {}
  onHint(): Unsubscribe {
    return () => {};
  }
  onRosterChange(): Unsubscribe {
    return () => {};
  }
  volunteers(): readonly string[] {
    return [];
  }
  picks(): ReadonlyMap<string, string> {
    return new Map();
  }
  dispose(): void {}
}
