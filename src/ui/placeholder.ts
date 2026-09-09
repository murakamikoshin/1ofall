/**
 * 選択肢の仮絵。
 *
 * 本番は生成AIで用意する（docs/IMAGE_STYLE.md）。絵が揃うまで手触りの検証を
 * 止めたくないので、ここでは本番と同じ制約で組み立てる：
 *   均一な太い黒線 / 影は1段のみ / 背景は単色 / 正方形 / 中央配置
 *
 * 二つの決まりごと：
 *  - 背景色は全選択肢で同一。1枚だけ明るいと、それ自体が答えの手掛かりになる
 *  - 形は部屋のテーマから引く。扉の部屋なら5枚とも扉に見える。
 *    形がばらばらだと「10秒で理解できる」が崩れる
 */

const PAPER = '#c2b192';
const INK = '#14100b';

type Family =
  | 'portal'   // 扉・門・窓・出口・鏡
  | 'vessel'   // 器・箱・薬・井戸・棚
  | 'held'     // 鍵・銭・手袋・面・提灯
  | 'figure'   // 人・獣
  | 'span'     // 道・橋・階段・床
  | 'liquid'   // 水・匂い・音
  | 'seat'     // 椅子・乗り物
  | 'line';    // 縄・鎖・把手

const FAMILY_BY_THEME: Record<string, Family> = {
  door: 'portal', gate: 'portal', window: 'portal', exit: 'portal', mirror: 'portal',
  box: 'vessel', cup: 'vessel', food: 'vessel', medicine: 'vessel', well: 'vessel', shelf: 'vessel',
  key: 'held', coin: 'held', glove: 'held', mask: 'held', lamp: 'held',
  person: 'figure', animal: 'figure',
  path: 'span', bridge: 'span', stair: 'span', floor: 'span',
  water: 'liquid', smell: 'liquid', sound: 'liquid',
  seat: 'seat', vehicle: 'seat',
  rope: 'line', lever: 'line', cloth: 'line',
};

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const S = `fill="none" stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"`;

/** 同じ族の中で少しずつ違える。輪郭は共通、内側の印だけ変える */
function draw(family: Family, v: number): string {
  switch (family) {
    case 'portal': {
      const arch = v % 2 === 0;
      const frame = arch
        ? `<path d="M34 104 V60 A30 30 0 0 1 94 60 V104" ${S}/>`
        : `<rect x="34" y="26" width="60" height="78" rx="3" ${S}/>`;
      const mark = [
        `<circle cx="82" cy="70" r="4" fill="${INK}"/>`,
        `<path d="M48 46 H80 M48 64 H80 M48 82 H80" ${S}/>`,
        `<path d="M64 26 V104" ${S}/>`,
        `<path d="M46 62 H82" ${S}/><circle cx="64" cy="86" r="4" fill="${INK}"/>`,
      ][v % 4];
      return `${frame}${mark}<path d="M22 104 H106" ${S}/>`;
    }
    case 'vessel': {
      const body = v % 2 === 0
        ? `<path d="M38 46 L46 100 H82 L90 46 Z" ${S}/>`
        : `<path d="M38 52 C38 96 90 96 90 52" ${S}/><path d="M38 52 H90" ${S}/>`;
      const lid = [`<path d="M32 46 H96" ${S}/>`, `<path d="M32 46 H96 M64 46 V30" ${S}/>`, `<path d="M36 40 Q64 24 92 40" ${S}/>`, ''][v % 4];
      return `${body}${lid}`;
    }
    case 'held': {
      const shapes = [
        `<circle cx="52" cy="52" r="16" ${S}/><path d="M62 64 L96 98 M84 86 L94 76" ${S}/>`,
        `<circle cx="64" cy="66" r="30" ${S}/><circle cx="64" cy="66" r="8" ${S}/>`,
        `<path d="M44 32 H84 L92 96 H36 Z" ${S}/><path d="M52 58 H76" ${S}/>`,
        `<path d="M40 40 H88 L80 100 H48 Z" ${S}/><circle cx="56" cy="62" r="4" fill="${INK}"/><circle cx="72" cy="62" r="4" fill="${INK}"/>`,
      ];
      return shapes[v % shapes.length] ?? shapes[0]!;
    }
    case 'figure': {
      const head = `<circle cx="64" cy="42" r="16" ${S}/>`;
      const body = v % 2 === 0
        ? `<path d="M36 104 C36 74 92 74 92 104" ${S}/>`
        : `<path d="M40 104 V78 H88 V104" ${S}/><path d="M40 78 L64 60 L88 78" ${S}/>`;
      return `${head}${body}`;
    }
    case 'span': {
      const deck = `<path d="M20 82 H108" ${S}/>`;
      const under = [
        `<path d="M34 82 V102 M64 82 V102 M94 82 V102" ${S}/>`,
        `<path d="M28 82 Q64 118 100 82" ${S}/>`,
        `<path d="M28 100 H50 V82 M78 82 V64 H100" ${S}/>`,
        `<path d="M30 82 L64 50 L98 82" ${S}/>`,
      ][v % 4];
      return `${deck}${under}`;
    }
    case 'liquid': {
      const rows = [30, 52, 74].map((y, i) =>
        `<path d="M24 ${y + (v % 3) * 4} Q44 ${y - 12} 64 ${y} T104 ${y}" ${S} opacity="${1 - i * 0.18}"/>`,
      ).join('');
      return `${rows}<path d="M24 100 H104" ${S}/>`;
    }
    case 'seat': {
      const base = `<path d="M38 100 V70 H90 V100" ${S}/>`;
      const back = v % 2 === 0 ? `<path d="M38 70 V34 H52 V70" ${S}/>` : `<path d="M38 70 L64 44 L90 70" ${S}/>`;
      return `${base}${back}`;
    }
    case 'line':
    default: {
      const curves = [
        `<path d="M30 26 C90 52 38 76 96 102" ${S}/>`,
        `<path d="M34 30 V84 A14 14 0 0 0 62 84 V44" ${S}/>`,
        `<path d="M28 40 H100 M28 66 H100 M28 92 H100" ${S}/>`,
        `<path d="M40 24 V70 A24 24 0 0 0 88 70 V24" ${S}/>`,
      ];
      return curves[v % curves.length] ?? curves[0]!;
    }
  }
}

const cache = new Map<string, string>();

/** data: URI を返す。ネットワーク要求を出さない（助言者ページの初速を守る） */
export function placeholderImage(theme: string, key: string): string {
  const cacheKey = `${theme}|${key}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const seed = hash(key);
  const family = FAMILY_BY_THEME[theme] ?? 'held';
  const body = draw(family, seed % 4);
  const rotate = ((seed >> 5) % 5) - 2;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">` +
    `<rect width="128" height="128" fill="${PAPER}"/>` +
    // 影は1段だけ。ぼかさない
    `<g transform="translate(4 5)" opacity="0.26">${body}</g>` +
    `<g transform="rotate(${rotate} 64 64)">${body}</g>` +
    `</svg>`;

  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  cache.set(cacheKey, uri);
  return uri;
}

export function choiceArt(theme: string, roomId: string, choiceId: string, image?: string): string {
  return image && image.length > 0 ? image : placeholderImage(theme, `${roomId}:${choiceId}`);
}
