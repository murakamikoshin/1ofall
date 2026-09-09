import { Howl, Howler } from 'howler';

/**
 * 音は Howler に任せる。ここは「何を鳴らすか」と「いつ止めるか」だけを持つ。
 * 死亡演出の 0.8 秒の無音を作れることがこのモジュールの存在理由。
 */

export type Sfx =
  | 'room-open'
  | 'hover'
  | 'commit'
  | 'spotlight'
  | 'survive'
  | 'death'
  | 'tick'
  | 'gameover';

const VOLUMES: Record<Sfx, number> = {
  'room-open': 0.55,
  hover: 0.3,
  commit: 0.8,
  spotlight: 0.6,
  survive: 0.7,
  death: 1,
  tick: 0.35,
  gameover: 0.7,
};

class AudioBus {
  private sounds = new Map<Sfx, Howl>();
  private enabled = true;
  private loaded = false;

  /** 最初の操作まで読み込みを遅らせる。初期表示を音で遅くしない */
  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    for (const name of Object.keys(VOLUMES) as Sfx[]) {
      this.sounds.set(
        name,
        new Howl({
          src: [`${import.meta.env.BASE_URL}snd/${name}.wav`],
          volume: VOLUMES[name],
          preload: true,
          html5: false,
        }),
      );
    }
  }

  play(name: Sfx): void {
    if (!this.enabled) return;
    this.load();
    this.sounds.get(name)?.play();
  }

  /** すべての音を即座に止める。演出の「無音」はここから始まる */
  silence(): void {
    Howler.stop();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    Howler.mute(!on);
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

export const audio = new AudioBus();
