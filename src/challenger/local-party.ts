import { PartyEngine, type PartyMember, type PartyState } from '@/core/party-engine';
import type { Knowledge } from '@/core/schema';
import { PARTY, PARTY_MIN_SEATS } from '@/core/limits';
import { corePackage } from '@/core/pack';
import { companionNames } from '@/core/companion-names';
import { strings } from '@/i18n';
import type { PartySource } from './party-board';

/**
 * ブラウザの中だけで動く全員挑戦者モード。
 * 仲間は AI。助言は時間差で置き、選ぶのは締切の少し前。
 * 一斉に出ると読めないし、全員が即答すると考える間が無くなる。
 */
export class LocalPartySource implements PartySource {
  readonly meId = 'me';
  readonly drivesPresentation = true;

  private readonly engine: PartyEngine;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private plannedRound: string | null = null;

  constructor(humans: readonly PartyMember[] = []) {
    const members: PartyMember[] = [
      { id: this.meId, name: strings().party.you, kind: 'human' },
      ...humans,
    ];
    // 4人だと正直な声が2つしか無く運任せになる。足りないぶんは AI で埋める
    const names = companionNames();
    let i = 0;
    while (members.length < PARTY_MIN_SEATS) {
      members.push({ id: `ai_${i}`, name: names[i % names.length] ?? `AI${i}`, kind: 'ai' });
      i += 1;
    }
    this.engine = new PartyEngine({ pack: corePackage(), members, mode: PARTY });
  }

  subscribe(listener: (state: PartyState) => void): () => void {
    const off = this.engine.subscribe((state) => {
      this.planAi(state);
      listener(state);
    });
    this.engine.start();
    return off;
  }

  snapshot(): PartyState {
    return this.engine.snapshot();
  }

  knowledgeForMe(): Knowledge | null {
    return this.engine.knowledgeFor(this.meId);
  }

  hint(text: string): void {
    this.engine.hint(this.meId, text);
  }

  pick(choiceId: string): void {
    this.engine.pick(this.meId, choiceId);
    // 自分が決めたら仲間もすぐ決める。待たせても何も起きない
    this.clearTimers();
    this.timers.push(setTimeout(() => this.aiPick(), 700));
  }

  timeUp(): void {
    this.aiPick();
    this.engine.timeUp();
  }

  advance(): void {
    this.engine.advancePresentation();
  }

  dispose(): void {
    this.clearTimers();
    this.engine.dispose();
  }

  private planAi(state: PartyState): void {
    const round = state.round;
    if (!round || state.phase !== 'choosing') return;
    if (round.roundId === this.plannedRound) return;
    this.plannedRound = round.roundId;
    this.clearTimers();

    const hints = this.engine.aiHints();
    let at = 900;
    for (const hint of hints) {
      at += 700 + Math.random() * 900;
      this.timers.push(setTimeout(() => this.engine.hint(hint.memberId, hint.text), at));
    }
    // 助言が出そろってから決める。先に決められると読む意味が無くなる
    this.timers.push(setTimeout(() => this.aiPick(), at + 1200));
  }

  private aiPick(): void {
    for (const [id, choice] of this.engine.aiPicks()) this.engine.pick(id, choice);
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
