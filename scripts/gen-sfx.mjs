/**
 * 効果音を生成して public/snd に書き出す。
 * 音源を外部から買うまでの繋ぎだが、「間」の検証には実音が要る。
 * 再生は Howler に任せる（自前実装しない）。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/snd');
const RATE = 44100;

function wav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

const sec = (s) => Math.floor(RATE * s);
const env = (i, n, attack = 0.01, release = 0.4) => {
  const t = i / n;
  const a = Math.min(1, t / attack);
  const r = t > 1 - release ? Math.max(0, (1 - t) / release) : 1;
  return a * r;
};
const noise = () => Math.random() * 2 - 1;

function build(name, seconds, fn) {
  const n = sec(seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / RATE, i, n);
  writeFileSync(resolve(OUT, name), wav(out));
  console.log('  ' + name, seconds + 's');
}

mkdirSync(OUT, { recursive: true });
console.log('generating sfx →', OUT);

// 部屋が開く。低い擦れた一撃
build('room-open.wav', 1.2, (t, i, n) => {
  const body = Math.sin(2 * Math.PI * 58 * t) * 0.5 + Math.sin(2 * Math.PI * 87 * t) * 0.2;
  const air = noise() * 0.12 * Math.exp(-t * 6);
  return (body * Math.exp(-t * 2.2) + air) * env(i, n, 0.004, 0.5) * 0.7;
});

// 選択肢に触れる。乾いた木の音
build('hover.wav', 0.12, (t, i, n) => {
  return (noise() * 0.5 + Math.sin(2 * Math.PI * 320 * t) * 0.4) * Math.exp(-t * 45) * env(i, n, 0.002, 0.3) * 0.35;
});

// 選択の確定。錠が落ちる
build('commit.wav', 0.5, (t, i, n) => {
  const clack = noise() * Math.exp(-t * 60) * 0.6;
  const low = Math.sin(2 * Math.PI * 96 * t) * Math.exp(-t * 9) * 0.5;
  return (clack + low) * env(i, n, 0.001, 0.35) * 0.8;
});

// 無音の直後、灯が寄る。息を詰める持続音
build('spotlight.wav', 1.6, (t, i, n) => {
  const wob = 1 + Math.sin(2 * Math.PI * 3.1 * t) * 0.015;
  const tone = Math.sin(2 * Math.PI * 146 * t * wob) * 0.28 + Math.sin(2 * Math.PI * 219 * t) * 0.1;
  return tone * env(i, n, 0.25, 0.3) * 0.6;
});

// 生存。短く抑える。長く鳴らさない
build('survive.wav', 0.9, (t, i, n) => {
  const a = Math.sin(2 * Math.PI * 294 * t) * 0.3;
  const b = Math.sin(2 * Math.PI * 440 * t) * 0.22 * (t > 0.09 ? 1 : 0);
  return (a + b) * Math.exp(-t * 3.4) * env(i, n, 0.006, 0.5) * 0.62;
});

// 死。ここに尺を使う
build('death.wav', 2.6, (t, i, n) => {
  const hit = (noise() * 0.9 + Math.sin(2 * Math.PI * 44 * t)) * Math.exp(-t * 14) * 0.85;
  const drop = Math.sin(2 * Math.PI * (128 - 96 * Math.min(1, t / 1.6)) * t) * Math.exp(-t * 1.1) * 0.5;
  const tail = noise() * 0.05 * Math.exp(-t * 1.4);
  return (hit + drop + tail) * env(i, n, 0.001, 0.42) * 0.85;
});

// 残り時間が少ない
build('tick.wav', 0.09, (t, i, n) => {
  return Math.sin(2 * Math.PI * 1080 * t) * Math.exp(-t * 70) * env(i, n, 0.001, 0.4) * 0.25;
});

// 全滅
build('gameover.wav', 3.2, (t, i, n) => {
  const drone = Math.sin(2 * Math.PI * 55 * t) * 0.3 + Math.sin(2 * Math.PI * 82.5 * t) * 0.16;
  return (drone + noise() * 0.04) * env(i, n, 0.4, 0.5) * 0.6;
});

/*
 * 区画の答え合わせが開く。
 *
 * 一番大きい拍なのに無音だった。紙が卓に置かれる音——低い木の一撃と、
 * 長く引く余韻。死（death）より軽く、部屋が開く音（room-open）より重い。
 */
build('answer.wav', 1.5, (t, i, n) => {
  const knock = (noise() * 0.5 + Math.sin(2 * Math.PI * 132 * t)) * Math.exp(-t * 22) * 0.5;
  const bell = Math.sin(2 * Math.PI * 196 * t) * 0.18 * Math.exp(-t * 1.6)
    + Math.sin(2 * Math.PI * 294 * t) * 0.09 * Math.exp(-t * 2.4);
  return (knock + bell) * env(i, n, 0.003, 0.45) * 0.62;
});

/*
 * 人を指した一言が場に届く（「あいつは嘘だ」）。
 * 投げられた石。短く硬い。助言そのものは無音のままにする
 * ——毎部屋7件鳴ると音が意味を失う
 */
build('accuse.wav', 0.34, (t, i, n) => {
  const snap = noise() * Math.exp(-t * 90) * 0.55;
  const body = Math.sin(2 * Math.PI * 240 * t) * Math.exp(-t * 16) * 0.3;
  return (snap + body) * env(i, n, 0.001, 0.4) * 0.5;
});

console.log('done');
