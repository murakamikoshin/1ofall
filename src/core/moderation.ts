import { HINT_MAX_LENGTH } from './limits';

/**
 * 助言の検閲。
 *
 * 仕様 §9 の荒らし対策のうち、通信層なしで書ける部分をここに置く。
 * サーバー側（段階4）はこの関数をそのまま呼ぶ。クライアントの検査は
 * 体験のためのもので、防御はサーバーで同じ関数を通すことで成立する。
 */

export type Rejection =
  | { ok: true; text: string }
  | { ok: false; reason: 'empty' | 'tooLong' | 'blocked' | 'rateLimited' | 'repeat' };

/** 連投の間隔。1部屋につき1人1通だが、書き直しの余地は残す */
export const HINT_COOLDOWN_MS = 2_500;

/**
 * 伏せ字や記号での回避を潰すための正規化。
 * 全角英数を半角へ、記号と空白を落とし、長音・繰り返しを畳む。
 */
export function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[!-/:-@[-`{-~｡-ﾟ、。・…ー~〜*＊]/g, '')
    .replace(/(.)\1{2,}/g, '$1$1');
}

/**
 * 通さない語。
 * 目的は「配信に映せない言葉を止める」ことなので、
 * 罵倒・差別・個人情報の誘導・宣伝に絞る。ここは運用しながら足す前提。
 */
const BLOCKED = [
  'しね', 'ころす', 'きえろ', 'くたばれ', 'ごみくず',
  'きちがい', 'かたわ', 'めくら',
  'まんこ', 'ちんこ', 'せっくす',
  'http', 'www', 'discord', 'ライン交換', 'lineこうかん',
  '住所', '本名', '電話番号',
];

export function containsBlocked(text: string): boolean {
  const n = normalize(text);
  return BLOCKED.some((word) => n.includes(normalize(word)));
}

export interface HintGuardState {
  /** 助言者ごとの最終送信時刻 */
  lastSentAt: Map<string, number>;
  /** 助言者ごとの直前の本文。同じ文の連投を止める */
  lastText: Map<string, string>;
}

export function createHintGuard(): HintGuardState {
  return { lastSentAt: new Map(), lastText: new Map() };
}

/**
 * 1通ぶんの検査。通れば整形済みの本文を返す。
 */
export function checkHint(
  guard: HintGuardState,
  advisorId: string,
  raw: string,
  now: number,
): Rejection {
  const text = raw.trim();
  if (text.length === 0) return { ok: false, reason: 'empty' };
  if ([...text].length > HINT_MAX_LENGTH) return { ok: false, reason: 'tooLong' };
  if (containsBlocked(text)) return { ok: false, reason: 'blocked' };

  // 初回は連投になり得ない。?? 0 にすると now が小さいとき初回が弾かれる
  const last = guard.lastSentAt.get(advisorId);
  if (last !== undefined && now - last < HINT_COOLDOWN_MS) {
    return { ok: false, reason: 'rateLimited' };
  }
  if (guard.lastText.get(advisorId) === text) return { ok: false, reason: 'repeat' };

  guard.lastSentAt.set(advisorId, now);
  guard.lastText.set(advisorId, text);
  return { ok: true, text };
}

/** 部屋が変わったら連投判定を持ち越さない */
export function resetGuard(guard: HintGuardState): void {
  guard.lastSentAt.clear();
  guard.lastText.clear();
}

/**
 * 入室の上限。無制限にすると1部屋に人が溜まって落ちる。
 * 配信を想定して大きめに取るが、上限そのものは持つ。
 */
export const MAX_ADVISORS_PER_ROOM = 3_000;

export function canJoin(currentCount: number): boolean {
  return currentCount < MAX_ADVISORS_PER_ROOM;
}
