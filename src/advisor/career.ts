/**
 * 助言者の通算——**見ている側に、周をまたいで残るもの。**
 *
 * 挑戦者の側には最高記録があり、常連の裏切り歴もある。助言者の側には
 * 部屋ごとの結果（24回目）と周ぶんの通算（25回目）を返したが、
 * **周が終われば全部消えていた。** 配信で毎日来る人にとって、
 * 自分が何をした人なのかがどこにも残らない。
 *
 * 残すのは本人の端末だけ（サーバーは持たない）。名乗りが自由なので、
 * 名前で集計しても意味がないし、残せば自慢にはなるが照合はできない。
 * ここは「自分のための記録」と割り切る。
 */

const KEY = 'career:advisor';

export interface Career {
  /** 発言枠で一言を出した部屋の数 */
  spoke: number;
  /** そのうち、挑戦者が自分の言葉を採った回数 */
  followed: number;
  /** 採られて挑戦者が死んだ回数（嘘つきの手柄） */
  killed: number;
  /** 採られて挑戦者が通った回数（正直者の手柄） */
  saved: number;
  /** 枠外からの賭け */
  betHit: number;
  betMiss: number;
  /** 区画の答え合わせで開いた自分の役 */
  asLiar: number;
  asHonest: number;
  /** 挑戦者に疑いの札を置かれた部屋の数 */
  doubted: number;
  /** 一緒に遊んだ周の数 */
  runs: number;
}

const EMPTY: Career = {
  spoke: 0, followed: 0, killed: 0, saved: 0,
  betHit: 0, betMiss: 0, asLiar: 0, asHonest: 0, doubted: 0, runs: 0,
};

export function career(): Career {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return { ...EMPTY };
    const saved = JSON.parse(raw) as Partial<Career>;
    return { ...EMPTY, ...saved };
  } catch {
    // 読めないなら忘れる。画面を壊すほどのものではない
    return { ...EMPTY };
  }
}

/** 足し込む。渡さなかった項目は動かさない */
export function addCareer(delta: Partial<Career>): Career {
  const next = career();
  for (const [key, value] of Object.entries(delta) as [keyof Career, number][]) {
    if (typeof value === 'number') next[key] += value;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 書けないだけ。遊びは続く */
  }
  return next;
}

/** 何か残っているか（空の通算は出さない） */
export function hasCareer(c: Career = career()): boolean {
  return c.spoke + c.betHit + c.betMiss + c.asLiar + c.asHonest > 0;
}

export function forgetCareer(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 消せないだけ */
  }
}
