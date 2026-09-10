import type { AdvisorGateway, RoundBriefing, Unsubscribe } from './advisor-gateway';
import type { AdvisorInfo, Hint } from './schema';
import { ADVISOR_NAME_MAX } from './limits';

/**
 * 実際に繋がっている人から助言を受け取るゲートウェイ。
 *
 * **WebSocket を知らない。** サーバーが受け取った内容をこのクラスへ渡し、
 * このクラスが配るべきものをサーバーへ返す、という一方向の関係にしてある。
 * そうしておくと通信を張らずに全部試せる（tools/test-party.mjs）。
 *
 * 助言の中身の検査（暴言・字数・連投・選択肢の数え上げ）はここではやらない。
 * GameEngine が受け口で必ず通すので、二重に持つと片方だけ直る事故が起きる。
 */
export class SocketAdvisorGateway implements AdvisorGateway {
  readonly kind = 'human' as const;

  private advisors = new Map<string, AdvisorInfo>();
  private hintListeners = new Set<(hint: Hint) => void>();
  private rosterListeners = new Set<(roster: readonly AdvisorInfo[]) => void>();
  private roundListeners = new Set<(briefing: RoundBriefing) => void>();
  private closeListeners = new Set<(roundId: string) => void>();

  private currentRoundId: string | null = null;
  private volunteerIds = new Set<string>();
  private partyPicks = new Map<string, string>();
  private votes = new Map<string, string>();
  /** 枠外の賭けの通算。1周のあいだ積む */
  private voteRecords = new Map<string, { hit: number; miss: number }>();
  private now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  /* ─────────────────────── ゲーム本体から呼ばれる側 ─────────────────────── */

  roster(): readonly AdvisorInfo[] {
    return [...this.advisors.values()];
  }

  openRound(briefing: RoundBriefing): void {
    this.currentRoundId = briefing.roundId;
    this.volunteerIds.clear();
    this.partyPicks.clear();
    this.votes.clear();
    for (const l of this.roundListeners) l(briefing);
  }

  closeRound(roundId: string): void {
    if (this.currentRoundId === roundId) this.currentRoundId = null;
    for (const l of this.closeListeners) l(roundId);
  }

  onHint(listener: (hint: Hint) => void): Unsubscribe {
    this.hintListeners.add(listener);
    return () => this.hintListeners.delete(listener);
  }

  onRosterChange(listener: (roster: readonly AdvisorInfo[]) => void): Unsubscribe {
    this.rosterListeners.add(listener);
    return () => this.rosterListeners.delete(listener);
  }

  volunteers(): readonly string[] {
    return [...this.volunteerIds];
  }

  /** 枠外の票。誰が何に入れたかは持つが、外へ出すのは集計だけ */
  crowdVotes(roundId: string): ReadonlyMap<string, number> {
    if (roundId !== this.currentRoundId) return new Map();
    const tally = new Map<string, number>();
    for (const choiceId of this.votes.values()) {
      tally.set(choiceId, (tally.get(choiceId) ?? 0) + 1);
    }
    return tally;
  }

  /** 発言枠の外の人が一票入れる。入れ直しは上書き */
  vote(id: string, roundId: string, choiceId: string): void {
    if (roundId !== this.currentRoundId) return;
    if (!this.advisors.has(id)) return;
    this.votes.set(id, choiceId);
  }

  /** 自分が何に入れたか（画面に残すため） */
  voteOf(id: string): string | null {
    return this.votes.get(id) ?? null;
  }

  /** この部屋の票を、入れた人ごとに返す。当たり外れを本人へ返すため */
  votesByPerson(): ReadonlyMap<string, string> {
    return new Map(this.votes);
  }

  /** 通算の当たり外れ。部屋をまたいで積む */
  voteRecord(id: string): { hit: number; miss: number } {
    return this.voteRecords.get(id) ?? { hit: 0, miss: 0 };
  }

  countVote(id: string, hit: boolean): { hit: number; miss: number } {
    const rec = this.voteRecord(id);
    const next = { hit: rec.hit + (hit ? 1 : 0), miss: rec.miss + (hit ? 0 : 1) };
    this.voteRecords.set(id, next);
    return next;
  }

  picks(roundId: string): ReadonlyMap<string, string> {
    if (roundId !== this.currentRoundId) return new Map();
    return new Map(this.partyPicks);
  }

  dispose(): void {
    this.hintListeners.clear();
    this.rosterListeners.clear();
    this.roundListeners.clear();
    this.closeListeners.clear();
    this.advisors.clear();
  }

  /* ───────────────────────── サーバーから呼ばれる側 ───────────────────────── */

  /** 部屋が開いたときに、その人あての知識をサーバーが配れるようにする */
  onRound(listener: (briefing: RoundBriefing) => void): Unsubscribe {
    this.roundListeners.add(listener);
    return () => this.roundListeners.delete(listener);
  }

  onRoundClose(listener: (roundId: string) => void): Unsubscribe {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  /**
   * 入室、または名乗り直し。
   * 繋いだ時点では名前が無いので仮の名前で席を取り、
   * あとから advisor/join が来たらそこで名乗る。
   * 名前を後から反映しないと、全員が「名無し」のまま並ぶ。
   */
  join(id: string, name: string | undefined, fallbackName: string): AdvisorInfo {
    const chosen = name?.trim();
    const existing = this.advisors.get(id);
    if (existing && !chosen) return existing;

    const advisor: AdvisorInfo = {
      id,
      name: (chosen || existing?.name || fallbackName).slice(0, ADVISOR_NAME_MAX),
      kind: 'human',
    };
    if (existing && existing.name === advisor.name) return existing;
    this.advisors.set(id, advisor);
    this.emitRoster();
    return advisor;
  }

  leave(id: string): void {
    if (!this.advisors.delete(id)) return;
    this.volunteerIds.delete(id);
    this.partyPicks.delete(id);
    this.votes.delete(id);
    this.emitRoster();
  }

  has(id: string): boolean {
    return this.advisors.has(id);
  }

  /** 助言が届いた。受け取ってよいかは本体（GameEngine）が決める */
  hint(id: string, roundId: string, text: string): void {
    const advisor = this.advisors.get(id);
    if (!advisor) return;
    const hint: Hint = {
      advisorId: advisor.id,
      advisorName: advisor.name,
      text,
      roundId,
      sentAt: this.now(),
    };
    for (const l of this.hintListeners) l(hint);
  }

  volunteer(id: string, roundId: string): void {
    if (roundId !== this.currentRoundId) return;
    if (!this.advisors.has(id)) return;
    this.volunteerIds.add(id);
  }

  /** 全員挑戦者モード。仲間が自分の扉を選んだ */
  pick(id: string, roundId: string, choiceId: string): void {
    if (roundId !== this.currentRoundId) return;
    if (!this.advisors.has(id)) return;
    this.partyPicks.set(id, choiceId);
  }

  private emitRoster(): void {
    const roster = this.roster();
    for (const l of this.rosterListeners) l(roster);
  }
}
