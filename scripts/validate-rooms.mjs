/**
 * 部屋データを検証する。
 * ルールは src/core/schema.ts の Zod をそのまま使う（二重管理しない）。
 * esbuild で TS をその場に束ねてから読み込む。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = join(tmpdir(), `rooms-schema-${process.pid}.mjs`);

await build({
  entryPoints: [resolve(root, 'src/core/schema.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  logLevel: 'silent',
});

const { RoomPackSchema } = await import(pathToFileURL(bundlePath).href);

// data/ 直下は部屋パックだけを置く。翻訳表など別形式のものは data/translations/ に。
const dataDir = resolve(root, 'data');
const files = readdirSync(dataDir, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.json'))
  .map((e) => e.name);

let failed = 0;
let totalRooms = 0;

for (const file of files) {
  const raw = JSON.parse(readFileSync(join(dataDir, file), 'utf8'));
  const result = RoomPackSchema.safeParse(raw);

  if (!result.success) {
    failed++;
    console.error(`✗ ${file}`);
    for (const issue of result.error.issues) {
      console.error(`    ${issue.path.join('.')}: ${issue.message}`);
    }
    continue;
  }

  const pack = result.data;
  totalRooms += pack.rooms.length;

  const warnings = [];
  const ids = new Set();
  for (const room of pack.rooms) {
    if (ids.has(room.id)) warnings.push(`${room.id}: room.id が重複`);
    ids.add(room.id);
    // 3択は勘で当たる。原則5択以上
    if (room.choices.length < 5) warnings.push(`${room.id}: ${room.choices.length}択（5択以上が原則）`);

    // 「四つは戻らなかった」のように数を書いた問いは、選択肢の数と合っていないと嘘になる
    const COUNT = { 三: 3, 四: 4, 五: 5, 六: 6, 七: 7 };
    // 数えているのは「全部」か「死ぬぶん」のどちらか。それ以外は数がずれている
    const cm = /([三四五六七])つ/.exec(room.prompt['ja'] ?? '');
    if (cm) {
      const said = COUNT[cm[1]];
      const n = room.choices.length;
      if (said !== n && said !== n - 1) {
        warnings.push(`${room.id}: 問いが「${cm[0]}」と言っているが ${n}択（${n}つか${n - 1}つ）`);
      }
    }
    // 英語の数はそのまま比べられない（「二日食っていない」のように物の数でないこともある）。
    // 日本語が「〜つ」と数えているときだけ、訳が同じ数を言っているかを見る
    const jm = /([三四五六七])つ/.exec(room.prompt['ja'] ?? '');
    if (jm) {
      const EN_WORD = { 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven' };
      const want = EN_WORD[COUNT[jm[1]]];
      if (want && !new RegExp(`\\b${want}\\b`, 'i').test(room.prompt['en'] ?? '')) {
        warnings.push(`${room.id}: 日本語は「${jm[0]}」だが英語に ${want} が無い`);
      }
    }
  }

  // 同じ絵が続くと飽きる。テーマの偏りを見張る
  const themes = pack.rooms.map((r) => r.theme);
  for (let i = 1; i < themes.length; i++) {
    if (themes[i] === themes[i - 1]) warnings.push(`${themes[i]} が連続している`);
  }

  console.log(`✓ ${file} — ${pack.rooms.length}部屋 / ${new Set(themes).size}テーマ`);
  for (const w of warnings) console.log(`    ! ${w}`);
}

console.log(`\n合計 ${totalRooms} 部屋（初期収録の目標は 30〜50）`);
if (totalRooms < 30) console.log('! 30部屋に届いていない');
process.exit(failed > 0 ? 1 : 0);
