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

/**
 * 題材 → 形の族。
 *
 * **96ある題材のうち66が載っていなかった。** 載っていない題材は既定の
 * 「手に持つもの」に落ちるので、氷の上を歩く部屋でも鍵や仮面が並んでいた。
 * この表の上の注釈（扉の部屋なら5枚とも扉に見える）が、7割の部屋で嘘だった。
 * 新しい部屋を足したときに黙って落ちないよう、tools/art-check.mjs で
 * 「全部の題材が載っていること」を見ている。
 */
const FAMILY_BY_THEME: Record<string, Family> = {
  // 通り道・入り口
  door: 'portal', gate: 'portal', window: 'portal', exit: 'portal', mirror: 'portal',
  tunnel: 'portal', shrine: 'portal', hide: 'portal',
  // 器・入れ物
  box: 'vessel', cup: 'vessel', food: 'vessel', medicine: 'vessel', well: 'vessel', shelf: 'vessel',
  bowl: 'vessel', drum: 'vessel', fruit: 'vessel', bucket: 'vessel', sack: 'vessel',
  // 舟は椅子より器の形が近い（船体が丸い）
  boat: 'vessel', ferry: 'vessel',
  // 手に持つもの
  key: 'held', coin: 'held', glove: 'held', mask: 'held', lamp: 'held',
  tool: 'held', letter: 'held', shoe: 'held', name: 'held', market: 'held', clock: 'held',
  bone: 'held', last: 'held', bell: 'held', seal: 'held', tooth: 'held', ring: 'held',
  candle: 'held', mask_shop: 'held', ledger: 'held', weight: 'held', leave: 'held',
  hand: 'held', cut: 'held', first: 'held', trade: 'held', card: 'held', promise: 'held',
  count: 'held', answer: 'held', discard: 'held',
  // 人・獣
  person: 'figure', animal: 'figure', bird: 'figure', shadow: 'figure', guard: 'figure',
  statue: 'figure', doll: 'figure', insect: 'figure',
  // 足で渡るもの
  path: 'span', bridge: 'span', stair: 'span', floor: 'span',
  stone: 'span', ice: 'span', ladder: 'span', stairwell: 'span', garden: 'span',
  step: 'span', plank: 'span', trace: 'span',
  // 流れるもの・消えるもの
  water: 'liquid', smell: 'liquid', sound: 'liquid',
  fire: 'liquid', song: 'liquid', smoke: 'liquid', voice: 'liquid', ash: 'liquid',
  signal: 'liquid', burn: 'liquid', breath: 'liquid', listen: 'liquid',
  // 乗るもの
  seat: 'seat', vehicle: 'seat', cart: 'seat',
  // 線状のもの
  rope: 'line', lever: 'line', cloth: 'line',
  thread: 'line', net: 'line', chain: 'line', banner: 'line', knot: 'line', cloak: 'line',
};

/** 題材が族に載っているか（部屋を足したときの取りこぼしを見るため） */
export function hasFamily(theme: string): boolean {
  return theme in FAMILY_BY_THEME;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const S = `fill="none" stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"`;

/**
 * 同じ族の中で少しずつ違える。輪郭は共通、内側の印だけ変える。
 *
 * **1部屋の選択肢の数（最大8）だけ用意する。**
 * 4種しか無かったので、5択の部屋では必ず二枚が同じ絵になっていた。
 * 「どれを被る」で同じ仮面が二つ並ぶと、絵を見る意味が消えて
 * 名前だけを読む遊びになる。実際に鍵の絵が二枚並んでいた。
 */
export const VARIANTS = 8;

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
        `<path d="M46 44 L82 80 M82 44 L46 80" ${S}/>`,
        `<path d="M52 92 H76 M64 92 V66 A12 12 0 0 1 64 42" ${S}/>`,
        `<rect x="48" y="52" width="32" height="24" rx="2" ${S}/>`,
        `<path d="M40 104 L64 40 L88 104" ${S}/>`,
      ][v % VARIANTS];
      return `${frame}${mark}<path d="M22 104 H106" ${S}/>`;
    }
    case 'vessel': {
      const body = v % 2 === 0
        ? `<path d="M38 46 L46 100 H82 L90 46 Z" ${S}/>`
        : `<path d="M38 52 C38 96 90 96 90 52" ${S}/><path d="M38 52 H90" ${S}/>`;
      const lid = [
        `<path d="M32 46 H96" ${S}/>`,
        `<path d="M32 46 H96 M64 46 V30" ${S}/>`,
        `<path d="M36 40 Q64 24 92 40" ${S}/>`,
        '',
        `<path d="M32 46 H96 M44 46 V32 H84 V46" ${S}/>`,
        `<path d="M30 44 H98 M64 44 V26 M52 26 H76" ${S}/>`,
        `<path d="M34 46 H94" ${S}/><circle cx="64" cy="34" r="7" ${S}/>`,
        `<path d="M32 46 H96 M38 46 L30 30 M90 46 L98 30" ${S}/>`,
      ][v % VARIANTS];
      return `${body}${lid}`;
    }
    case 'held': {
      const shapes = [
        `<circle cx="52" cy="52" r="16" ${S}/><path d="M62 64 L96 98 M84 86 L94 76" ${S}/>`,
        `<circle cx="64" cy="66" r="30" ${S}/><circle cx="64" cy="66" r="8" ${S}/>`,
        `<path d="M44 32 H84 L92 96 H36 Z" ${S}/><path d="M52 58 H76" ${S}/>`,
        `<path d="M40 40 H88 L80 100 H48 Z" ${S}/><circle cx="56" cy="62" r="4" fill="${INK}"/><circle cx="72" cy="62" r="4" fill="${INK}"/>`,
        `<path d="M46 30 H82 V70 A18 18 0 0 1 46 70 Z" ${S}/><path d="M64 88 V104" ${S}/>`,
        `<path d="M36 60 H92 M50 44 L36 60 L50 76" ${S}/><circle cx="88" cy="60" r="10" ${S}/>`,
        `<path d="M40 96 V52 A24 24 0 0 1 88 52 V96 Z" ${S}/><path d="M56 96 V72 H72 V96" ${S}/>`,
        `<path d="M34 46 L64 30 L94 46 L64 62 Z" ${S}/><path d="M64 62 V102" ${S}/>`,
      ];
      return shapes[v % shapes.length] ?? shapes[0]!;
    }
    case 'figure': {
      const head = `<circle cx="64" cy="42" r="16" ${S}/>`;
      const body = [
        `<path d="M36 104 C36 74 92 74 92 104" ${S}/>`,
        `<path d="M40 104 V78 H88 V104" ${S}/><path d="M40 78 L64 60 L88 78" ${S}/>`,
        `<path d="M64 62 V96 M64 74 L44 88 M64 74 L84 88 M64 96 L48 104 M64 96 L80 104" ${S}/>`,
        `<path d="M44 104 Q64 62 84 104" ${S}/><path d="M44 84 H84" ${S}/>`,
        `<path d="M38 104 V70 Q64 56 90 70 V104" ${S}/>`,
        `<path d="M64 62 V104 M40 78 H88" ${S}/>`,
        `<path d="M42 104 C42 76 86 76 86 104" ${S}/><path d="M52 92 H76" ${S}/>`,
        `<path d="M46 104 V72 H82 V104 M46 88 H82" ${S}/>`,
      ][v % VARIANTS];
      return `${head}${body}`;
    }
    case 'span': {
      const deck = `<path d="M20 82 H108" ${S}/>`;
      const under = [
        `<path d="M34 82 V102 M64 82 V102 M94 82 V102" ${S}/>`,
        `<path d="M28 82 Q64 118 100 82" ${S}/>`,
        `<path d="M28 100 H50 V82 M78 82 V64 H100" ${S}/>`,
        `<path d="M30 82 L64 50 L98 82" ${S}/>`,
        `<path d="M28 82 L44 102 M60 82 L76 102 M92 82 L108 102" ${S}/>`,
        `<path d="M36 82 V96 H92 V82" ${S}/><path d="M64 96 V108" ${S}/>`,
        `<path d="M24 68 H108 M24 54 H108" ${S}/>`,
        `<path d="M30 82 Q46 60 64 82 T98 82" ${S}/>`,
      ][v % VARIANTS];
      return `${deck}${under}`;
    }
    case 'liquid': {
      /*
       * 波の高さを v % 3 で振っていたので、8種のうち 0/3/6 が同じ絵になっていた
       * （族の中で3種しか無かった）。振り方を分けて8種にする。
       */
      const lift = [0, 4, 8, 2, 6, 10, 12, 1][v % VARIANTS] as number;
      const amp = [12, 8, 16, 10, 14, 6, 18, 11][v % VARIANTS] as number;
      const rows = [30, 52, 74].map((y, i) =>
        `<path d="M24 ${y + lift} Q44 ${y - amp} 64 ${y} T104 ${y}" ${S} opacity="${1 - i * 0.18}"/>`,
      ).join('');
      return `${rows}<path d="M24 100 H104" ${S}/>`;
    }
    case 'seat': {
      const base = `<path d="M38 100 V70 H90 V100" ${S}/>`;
      const back = [
        `<path d="M38 70 V34 H52 V70" ${S}/>`,
        `<path d="M38 70 L64 44 L90 70" ${S}/>`,
        `<path d="M38 70 V38 H90 V70" ${S}/>`,
        `<path d="M38 70 Q64 34 90 70" ${S}/>`,
        `<path d="M38 70 V44 H64 V70" ${S}/><circle cx="80" cy="52" r="8" ${S}/>`,
        `<path d="M44 100 A20 20 0 0 0 84 100" ${S}/><path d="M38 70 V40 H90" ${S}/>`,
        `<path d="M38 70 V36 M90 70 V36 M38 44 H90" ${S}/>`,
        `<path d="M38 70 L52 40 H76 L90 70" ${S}/>`,
      ][v % VARIANTS];
      return `${base}${back}`;
    }
    case 'line':
    default: {
      const curves = [
        `<path d="M30 26 C90 52 38 76 96 102" ${S}/>`,
        `<path d="M34 30 V84 A14 14 0 0 0 62 84 V44" ${S}/>`,
        `<path d="M28 40 H100 M28 66 H100 M28 92 H100" ${S}/>`,
        `<path d="M40 24 V70 A24 24 0 0 0 88 70 V24" ${S}/>`,
        `<path d="M64 22 V70" ${S}/><circle cx="64" cy="88" r="18" ${S}/>`,
        `<path d="M32 34 Q64 62 96 34 M32 62 Q64 90 96 62" ${S}/>`,
        `<path d="M36 100 V44 A28 28 0 0 1 92 44 V100" ${S}/>`,
        `<path d="M30 40 L98 40 M46 40 V96 M82 40 V96" ${S}/>`,
      ];
      return curves[v % curves.length] ?? curves[0]!;
    }
  }
}

const cache = new Map<string, string>();

/**
 * data: URI を返す。ネットワーク要求を出さない（助言者ページの初速を守る）。
 *
 * `variant` を渡すと、その番号の絵になる。渡さないと鍵から引く。
 * 部屋の中で番号をずらして渡せば、**同じ絵が二枚並ばない。**
 */
export function placeholderImage(theme: string, key: string, variant?: number): string {
  const cacheKey = `${theme}|${key}|${variant ?? '-'}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const seed = hash(key);
  const family = FAMILY_BY_THEME[theme] ?? 'held';
  const body = draw(family, variant ?? seed % VARIANTS);
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

/**
 * 選択肢の絵。
 *
 * `index`（部屋の中で何枚目か）を渡すと、**部屋の中で必ず違う絵**になる。
 * 部屋ごとに始点をずらすので、いつも同じ順で並ぶわけでもない。
 * 渡さないと鍵から引く（絵が被り得る）。
 */
export function choiceArt(
  theme: string,
  roomId: string,
  choiceId: string,
  image?: string,
  index?: number,
): string {
  if (image && image.length > 0) return image;
  if (index === undefined) return placeholderImage(theme, `${roomId}:${choiceId}`);
  const variant = (hash(roomId) + index) % VARIANTS;
  return placeholderImage(theme, `${roomId}:${choiceId}`, variant);
}
