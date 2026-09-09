// mini ビルド（WAAPI のみ）。演出のために重い実装を持ち込まない
import { animate } from 'motion/mini';
import type { Verdict } from '@/core/engine';
import { audio } from './audio';
import { strings } from '@/i18n';

/**
 * 死亡演出。体験の核心。
 *
 *  1. 選択した瞬間、すべての音と動きを止める（0.8秒の無音）
 *  2. 選んだ選択肢だけにライトが寄る
 *  3. 結果を出す。正解と失敗で音・色・動きを大きく変える
 *  4. 失敗時は画面全体を --soot に落とす
 *
 * スキップは実装しない。飛ばされると山場が消える。
 * prefers-reduced-motion では動きを削るが「間」は必ず残す。
 */

export const HUSH_MS = 800;

const reduced = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface ResolutionRefs {
  stage: HTMLElement;
  /** 灯り。radial-gradient の中心と半径を動かす */
  lamp: HTMLElement;
  /** 画面全体を --soot に落とすための面 */
  blackout: HTMLElement;
  /** 結果の文字を出す面 */
  banner: HTMLElement;
  chosen: HTMLElement | null;
  others: HTMLElement[];
  /** 正解の選択肢。外したときにだけ示す */
  answer: HTMLElement | null;
}

export interface ResolutionHooks {
  /** hush → reveal → verdict と本体の phase を進める */
  advance: () => void;
  /** 全員挑戦者モードで、仲間が何を選んだかを見せる */
  showParty?: () => void;
}

export async function playResolution(
  refs: ResolutionRefs,
  verdict: Verdict,
  hooks: ResolutionHooks,
): Promise<void> {
  const soft = reduced();
  const { stage, lamp, blackout, banner, chosen, others, answer } = refs;

  /* ── 1. 無音 ───────────────────────────────────────────────
     音を止め、動いているものを止める。ここで観客の息が止まる。 */
  audio.silence();
  stage.classList.add('is-frozen');
  banner.textContent = '';
  banner.classList.remove('is-visible', 'is-death', 'is-survive');
  await wait(HUSH_MS);

  /* ── 2. 灯りが寄る ────────────────────────────────────────── */
  hooks.advance();
  audio.play('spotlight');

  const target = chosen ?? stage;
  const box = target.getBoundingClientRect();
  const cx = ((box.left + box.width / 2) / window.innerWidth) * 100;
  const cy = ((box.top + box.height / 2) / window.innerHeight) * 100;

  lamp.style.setProperty('--lx', `${cx}%`);
  lamp.style.setProperty('--ly', `${cy}%`);
  lamp.classList.add('is-closing');

  for (const el of others) {
    animate(el, { opacity: soft ? 0.12 : 0.06, filter: 'saturate(0.1) brightness(0.35)' }, { duration: soft ? 0.01 : 0.5 });
  }
  if (chosen) {
    chosen.classList.add('is-chosen');
    if (!soft) animate(chosen, { scale: [1, 1.06] }, { duration: 0.7, ease: 'easeOut' });
  }
  animate(lamp, { '--lr': ['140%', '34%'] } as never, { duration: soft ? 0.01 : 0.9, ease: 'easeInOut' });

  await wait(soft ? 700 : 1000);

  /* ── 3. 結果 ──────────────────────────────────────────────── */
  hooks.advance();

  // 仲間が何を選んだかを開く。言ったことと選んだことのずれがここで見える
  hooks.showParty?.();

  if (verdict.survived) {
    // 正解時は短く抑える
    audio.play('survive');
    banner.textContent = strings().verdict.survived;
    banner.classList.add('is-visible', 'is-survive');
    if (chosen && !soft) animate(chosen, { scale: [1.06, 1.0] }, { duration: 0.35 });
    await wait(soft ? 900 : 850);
    banner.classList.remove('is-visible', 'is-survive');
    lamp.classList.remove('is-closing');
    stage.classList.remove('is-frozen');
    return;
  }

  // 失敗時に尺を使う。画面全体を --soot に落とす
  audio.play('death');
  blackout.classList.add('is-down');
  if (chosen) chosen.classList.add('is-fatal');
  if (!soft && chosen) {
    animate(chosen, { x: [0, -6, 5, -3, 0] }, { duration: 0.28 });
  }
  await wait(soft ? 500 : 620);

  banner.textContent = verdict.timedOut ? strings().challenger.timeUp : verdict.deathMessage;
  banner.classList.add('is-visible', 'is-death');
  await wait(soft ? 1200 : 1500);

  // 外した先にあった正解を、遅れて見せる。悔しさはここで出る
  if (answer && answer !== chosen) {
    answer.classList.add('is-answer');
    animate(answer, { opacity: [0.06, 1] }, { duration: soft ? 0.01 : 0.6 });
    await wait(soft ? 900 : 1100);
  }

  banner.classList.remove('is-visible');
  await wait(300);
}

/** 演出のあと、次の部屋へ入るために画面を戻す */
export function resetStage(refs: ResolutionRefs): void {
  const { stage, lamp, blackout, banner } = refs;
  stage.classList.remove('is-frozen');
  lamp.classList.remove('is-closing');
  lamp.style.removeProperty('--lx');
  lamp.style.removeProperty('--ly');
  blackout.classList.remove('is-down');
  banner.classList.remove('is-visible', 'is-death', 'is-survive');
  banner.textContent = '';
}
