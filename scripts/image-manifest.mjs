/** 生成が必要な画像ファイル名を一覧する。生成作業の発注書になる */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(root, 'data');
const imgDir = resolve(root, 'public/img');

const rows = [];
for (const file of readdirSync(dataDir).filter((f) => f.endsWith('.json'))) {
  const pack = JSON.parse(readFileSync(join(dataDir, file), 'utf8'));
  for (const room of pack.rooms) {
    for (const choice of room.choices) {
      const name = `${room.id}_${choice.id}.webp`;
      rows.push({ name, theme: room.theme, label: choice.label, done: existsSync(join(imgDir, name)) });
    }
  }
}

const missing = rows.filter((r) => !r.done);
console.log(`必要 ${rows.length} 枚 / 未生成 ${missing.length} 枚\n`);
console.log('file\ttheme\tsubject');
for (const r of missing) console.log(`${r.name}\t${r.theme}\t${r.label}`);
