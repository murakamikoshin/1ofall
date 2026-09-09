/**
 * 部屋データを多言語の形に移す。
 * 既存の日本語をそのまま ja に入れ、en の対訳を当てる。
 * 訳はここに表として持ち、機械的に適用する（手で JSON を書き換えない）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = resolve(root, 'data/rooms.core.json');
const pack = JSON.parse(readFileSync(path, 'utf8'));

const EN = JSON.parse(readFileSync(resolve(root, 'data/translations/rooms.core.en.json'), 'utf8'));

const already = pack.rooms.every((r) => r.prompt && typeof r.prompt === 'object');
if (already) {
  console.log('すでに多言語の形になっている');
  process.exit(0);
}

let missing = 0;
for (const room of pack.rooms) {
  const en = EN[room.id];
  if (!en) { console.error(`訳が無い: ${room.id}`); missing++; continue; }
  room.prompt = { ja: room.prompt, en: en.prompt };
  room.deathMessage = { ja: room.deathMessage, en: en.deathMessage };
  room.choices.forEach((c, i) => {
    const label = en.choices[i];
    if (!label) { console.error(`訳が無い: ${room.id}.${c.id}`); missing++; }
    c.label = { ja: c.label, en: label ?? c.label };
  });
}

if (missing) { console.error(`\n${missing} 件の訳が欠けている`); process.exit(1); }
writeFileSync(path, JSON.stringify(pack, null, 2) + '\n');
console.log(`${pack.rooms.length} 部屋を多言語の形にした`);
