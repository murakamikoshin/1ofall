/**
 * 常連。**顔ぶれを周をまたいで固定して、誰が裏切るかを覚えられるようにする。**
 *
 * ここまでソロは周ごとに AI の顔ぶれを引き直していた（種を振り直していた）。
 * 「とんびは信用を積んでから崩す」と分かっても、次の周にはとんびが居ない。
 * 裏切り癖は id から決まる作りになっている（`casting.ts` の `liarBias` /
 * `liarHonestyAt`）のに、**その作りが遊ぶ側に一度も届いていなかった。**
 *
 * 種を覚えれば、同じ12人が毎周出る。区画の答え合わせで開いた配役を積めば、
 * 「この人は3区画のうち2回嘘つきだった」が言える。
 *
 * 何を教えるかは選んでいる。**いまの配役は教えない**——嘘つきは区画ごとに
 * その場で引く（`castLiars`）ので、過去の回数は今回の役を当てない。
 * 積んで分かるのは**癖**（嘘つきになったときにどう振る舞うか）だけで、
 * だから読みの足しにはなるが、答えにはならない。
 */

const SEED_KEY = 'regulars:seed';
const BOOK_KEY = 'regulars:book';
/** 常連として出すのに要る区画数。一度きりの人を「常連」と呼ばない */
export const REGULAR_MIN_SECTIONS = 2;

export interface Regular {
  /** 一緒に区画を越えた回数（配役が開いた回数） */
  sections: number;
  /** そのうち嘘つきだった回数 */
  liarSections: number;
  hit: number;
  miss: number;
}

type Book = Record<string, Regular>;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    // 画面を壊すより、常連を忘れるほうがまし
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 書けないだけ。遊びは続く */
  }
}

/** AI の顔ぶれを決める種。一度決めたら覚えておく */
export function rosterSeed(): number {
  const saved = read<number | null>(SEED_KEY, null);
  if (typeof saved === 'number' && Number.isFinite(saved)) return saved;
  const seed = Math.floor(Math.random() * 0xffffffff);
  write(SEED_KEY, seed);
  return seed;
}

export function regulars(): Book {
  const book = read<Book>(BOOK_KEY, {});
  return book && typeof book === 'object' ? book : {};
}

/** 名前で引く。id は種が同じなら同じ人だが、覚えるのは名前のほう */
export function regularOf(name: string): Regular | null {
  const r = regulars()[name];
  if (!r || r.sections < REGULAR_MIN_SECTIONS) return null;
  return r;
}

/**
 * 区画の答え合わせを積む。
 * 開いたものだけを積む（遊んでいるあいだの配役は覗かない）。
 */
export function recordSection(
  rows: readonly { name: string; liar: boolean; hit: number; miss: number }[],
): void {
  if (rows.length === 0) return;
  const book = regulars();
  for (const row of rows) {
    if (!row.name) continue;
    const cur = book[row.name] ?? { sections: 0, liarSections: 0, hit: 0, miss: 0 };
    book[row.name] = {
      sections: cur.sections + 1,
      liarSections: cur.liarSections + (row.liar ? 1 : 0),
      hit: cur.hit + row.hit,
      miss: cur.miss + row.miss,
    };
  }
  write(BOOK_KEY, book);
}

/** 覚えている常連を捨てる（遊び直しの検査で使う） */
export function forgetRegulars(): void {
  try {
    localStorage.removeItem(BOOK_KEY);
    localStorage.removeItem(SEED_KEY);
  } catch {
    /* 消せないだけ */
  }
}
