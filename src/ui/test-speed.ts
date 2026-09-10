/**
 * 検証用の速度つまみ。`?fast=1` で AI の助言が即座に届くようにする。
 *
 * **遊びの中身は何も変えない。** 変えるのは「AI が何秒後に喋るか」だけ。
 * 通しプレイを何十周も回して読むのに、1部屋16秒待っていられない。
 *
 * 死亡演出の「間」はここでは触らない（あれは仕様）。
 * 検証で縮めたいときは Playwright の reducedMotion を使う。
 */
const params = typeof location === 'undefined' ? null : new URLSearchParams(location.search);

export const FAST_MODE = params?.get('fast') === '1';

/** AI の助言が届くまでの幅。fast のときはほぼ即座 */
export const aiHintDelays = (): { minDelayMs: number; maxDelayMs: number } =>
  FAST_MODE ? { minDelayMs: 0, maxDelayMs: 150 } : { minDelayMs: 400, maxDelayMs: 3400 };

/** 通常の待ち時間を fast のときだけ縮める */
export const paced = (ms: number): number => (FAST_MODE ? Math.max(10, Math.round(ms / 12)) : ms);
