import type { AdvisorInfo, Hint, Room } from './schema';
import type { Casting } from './casting';

/**
 * 助言者の供給源を抽象化する。
 * - HumanGateway（PartyKit 経由の視聴者・友達）… フェーズ1
 * - AiGateway（ソロモードの AI 嘘つき）………… フェーズ2で差し替え
 * - NullGateway（助言者なしのローカル1人プレイ）… 手触り検証用
 * ゲーム本体はこの境界の先を知らない。人間かAIかでロジックを分岐させない。
 */

export type Unsubscribe = () => void;

/** 部屋ごとに助言者側へ配る情報。正解はここにしか乗らない */
export interface RoundBriefing {
  roundId: string;
  room: Room;
  /** 助言者だけが見ている答え */
  correct: string;
  casting: Casting;
  deadlineAt: number;
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
  /** 名簿の変化（入退室） */
  onRosterChange(listener: (roster: readonly AdvisorInfo[]) => void): Unsubscribe;
  /** 指名方式の立候補者 */
  volunteers(): readonly string[];
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
  dispose(): void {}
}
