import { HINT_MAX_LENGTH } from './limits';
import { strings, getLocale } from '../i18n';
import { HINT_LIMIT_BY_LOCALE } from '../i18n/locales';

/**
 * 助言の検閲。
 *
 * 仕様 §9 の荒らし対策のうち、通信層なしで書ける部分をここに置く。
 * サーバー側（段階4）はこの関数をそのまま呼ぶ。クライアントの検査は
 * 体験のためのもので、防御はサーバーで同じ関数を通すことで成立する。
 */

export type RejectReason =
  | 'empty'
  | 'tooLong'
  | 'blocked'
  | 'rateLimited'
  | 'repeat'
  /** 番号や位置で指した */
  | 'pointing'
  /** 一度に選択肢を挙げすぎた */
  | 'tooManyChoices';

export type Rejection = { ok: true; text: string } | { ok: false; reason: RejectReason };

/** 連投の間隔。1部屋につき1人1通だが、書き直しの余地は残す */
export const HINT_COOLDOWN_MS = 2_500;

/**
 * 伏せ字や記号での回避を潰すための正規化。
 * 全角英数を半角へ、記号と空白を落とし、長音・繰り返しを畳み、
 * カタカナはひらがなに寄せる（「シネ」で抜けられないように）。
 */
export function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[!-/:-@[-`{-~｡-ﾟ、。・…ー~〜*＊]/g, '')
    .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/(.)\1{2,}/g, '$1$1');
}

/**
 * 通さない語。
 * 目的は「配信に映せない言葉を止める」ことなので、
 * 罵倒・差別・個人情報の誘導・宣伝に絞る。ここは運用しながら足す前提。
 */
const BLOCKED = [
  // 漢字とひらがなの両方を書く。正規化はカタカナしか寄せない
  'しね', '死ね', 'ころす', '殺す', '殺せ', 'きえろ', '消えろ',
  'くたばれ', 'ごみくず', 'ぞうきん',
  'くびつれ', '首吊', 'じさつしろ', '自殺しろ',
  'きちがい', '基地外', 'かたわ', 'めくら', 'つんぼ', 'ぶさいく',
  'まんこ', 'ちんこ', 'ちんぽ', 'せっくす',
  'http', 'www', '.com', '.net', 'discord', 'twitter',
  'ライン交換', 'lineこうかん', 'あいでぃー', 'dm',
  '住所', 'じゅうしょ', '本名', 'ほんみょう', '電話番号', 'でんわばんごう',
];

/**
 * 「死ぬ」は部屋の言葉そのものなので通す。止めるのは命令形の「死ね」だけ。
 * 「殺す」は落とすほうに倒した。助言としては「死ぬ」で足りる。
 */

export function containsBlocked(text: string): boolean {
  const n = normalize(text);
  return BLOCKED.some((word) => n.includes(normalize(word)));
}

/**
 * 番号と位置で選択肢を指す言い方は使えない。
 *
 * 理由は二つ。
 *  - 「1234は罠」のように、一度の助言で全選択肢に触れて潰せてしまう
 *  - 番号で指せると助言が機械的に数えられる。数えられると多数決に戻る
 *
 * 選択肢の名前そのものは使える。使えないと何も伝えられない。
 * 20文字あれば名前は2つまでしか入らないので、全部に触れることはできない。
 */
const POINTING = [
  /[0-9０-９]/,
  /[一二三四五六七八九]\s*(番|つ目|個目)/,
  /(番目|ばんめ)/,
  /(左|右|真ん中|まんなか|中央|端|はし|上から|下から|手前|奥から)/,
  /[①-⑧]/,
  // 英語でも同じ抜け道を塞ぐ
  /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|last)\b/i,
  /\b(left|right|middle|centre|center|top|bottom|edge|end|far|near)\b/i,
  /\b(one|two|three|four|five|six|seven|eight)\b/i,
];

/**
 * 選択肢の名前そのものに位置語が入っていることがある
 * （「右手」「端の薄い氷」「手前の椀」）。
 * 先に名前を取り除いてから調べないと、正当な助言を黙って落としてしまう。
 */
export function isPointing(text: string, labels: readonly string[] = []): boolean {
  let rest = text.normalize('NFKC');
  // 長い名前から消す。短い名前が長い名前の一部を食わないように
  for (const label of [...labels].sort((a, b) => b.length - a.length)) {
    if (!label) continue;
    const norm = label.normalize('NFKC');
    while (rest.includes(norm)) rest = rest.replace(norm, '　');
  }
  return POINTING.some((re) => re.test(rest));
}

/**
 * 一度に触れてよい選択肢は2つまで。
 * 協力者が知っているのも2択なので、それ以上を挙げる必要が無い。
 */
export const MAX_CHOICES_PER_HINT = 2;

export function countChoicesMentioned(text: string, labels: readonly string[]): number {
  const n = normalize(text);
  return labels.filter((l) => l.length > 0 && n.includes(normalize(l))).length;
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
  labels: readonly string[] = [],
): Rejection {
  const text = raw.trim();
  if (text.length === 0) return { ok: false, reason: 'empty' };
  if ([...text].length > (HINT_LIMIT_BY_LOCALE[getLocale()] ?? HINT_MAX_LENGTH)) {
    return { ok: false, reason: 'tooLong' };
  }
  if (containsBlocked(text)) return { ok: false, reason: 'blocked' };
  if (isPointing(text, labels)) return { ok: false, reason: 'pointing' };
  if (labels.length && countChoicesMentioned(text, labels) > MAX_CHOICES_PER_HINT) {
    return { ok: false, reason: 'tooManyChoices' };
  }

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


/* ───────────────────────────── 通報 ───────────────────────────── */

export interface Report {
  reporterId: string;
  targetId: string;
  roundId: string;
  text: string;
  at: number;
}

export interface ReportBook {
  reports: Report[];
  /** 通報された回数。閾値を超えたら自動で発言を止める */
  countByTarget: Map<string, number>;
  /** 同じ相手を何度も通報しても1回として数える */
  seen: Set<string>;
}

export function createReportBook(): ReportBook {
  return { reports: [], countByTarget: new Map(), seen: new Set() };
}

/** これだけ別の人から通報されたら、以降その人の助言は届かない */
export const AUTO_MUTE_REPORTS = 3;

export interface ReportResult {
  accepted: boolean;
  count: number;
  autoMuted: boolean;
}

export function fileReport(book: ReportBook, report: Report): ReportResult {
  // 自分を通報はできない。同じ相手への重複も数えない
  if (report.reporterId === report.targetId) {
    return { accepted: false, count: book.countByTarget.get(report.targetId) ?? 0, autoMuted: false };
  }
  const key = `${report.reporterId}→${report.targetId}`;
  if (book.seen.has(key)) {
    return { accepted: false, count: book.countByTarget.get(report.targetId) ?? 0, autoMuted: false };
  }

  book.seen.add(key);
  book.reports.push(report);
  const count = (book.countByTarget.get(report.targetId) ?? 0) + 1;
  book.countByTarget.set(report.targetId, count);
  return { accepted: true, count, autoMuted: count >= AUTO_MUTE_REPORTS };
}

export function reportCount(book: ReportBook, targetId: string): number {
  return book.countByTarget.get(targetId) ?? 0;
}


/* ───────────────────── 助言が正しかったかの判定 ───────────────────── */

/** 「これは死ぬ」型かどうかは言語ごとの言い回しで判定する */
const avoidForms = (): RegExp => strings().hints.avoidPattern;

/**
 * その助言が結果として正しかったかを判定する。
 *
 * 記録（正n 嘘n）はこれで付ける。役ではなく振る舞いで付けないと
 * 隠れた配役を漏らしてしまうし、「これは死ぬ」しか言えない耳打ち役が
 * 正直なのに毎回「嘘」と記録されてしまう。
 */
export function wasTruthful(text: string, correctLabel: string, allLabels: readonly string[]): boolean {
  const mentionsCorrect = correctLabel.length > 0 && text.includes(correctLabel);
  const mentionsAnyWrong = allLabels.some((l) => l !== correctLabel && l.length > 0 && text.includes(l));

  if (avoidForms().test(text)) {
    // 外れを避けろと言ったなら正しい。正解を避けろと言ったなら嘘
    return !mentionsCorrect && mentionsAnyWrong;
  }
  // 押した先に正解が入っていれば正しい
  return mentionsCorrect;
}
