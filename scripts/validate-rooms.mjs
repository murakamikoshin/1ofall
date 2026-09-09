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
