/**
 * 文言はここに集約する。コードに直書きしない（多言語化は今回やらないが、
 * 後から差し替えられる形は崩さない）。
 */
export const ja = {
  title: '一寸先は嘘',
  titleRuby: 'いっすんさきはうそ',
  tagline: '答えを知っているのは、君以外の全員だ。',

  menu: {
    solo: '一人で試す',
    soloNote: '助言者なし。部屋と死だけを確かめる',
    host: '賭場を開く',
    hostNote: '観客を助言者として招く',
    advisor: '助言者として入る',
  },

  hud: {
    lives: '命',
    room: (n: number) => `${n}部屋目`,
    section: (n: number, total: number) => `${n}区画 / ${total}`,
    slots: '発言枠',
    mode: { lottery: '抽選', nominate: '指名' },
  },

  challenger: {
    hintsEmpty: '助言を待っている',
    hintsNone: '助言者はいない。自分で決めろ',
    inbox: (n: number) => `${n}人が助言を送ってきた`,
    openLeft: (n: number) => `あと ${n} 通ひらける`,
    openNone: 'もうひらけない',
    open: 'ひらく',
    unopened: '伏せられている',
    record: (hit: number, miss: number) => `当${hit} 嘘${miss}`,
    recordHint: '数字は、その相手をひらいたときの当たり外れ',
    liarCount: (lo: number, hi: number) =>
      lo === hi ? `この中に嘘つきが ${lo} 人` : `この中に嘘つきが ${lo}〜${hi} 人`,
    silence: '黙らせる',
    silenceDone: '黙らせた',
    silenceHit: '嘘つきを黙らせた',
    silenceMiss: '外した。次の部屋が短くなる',
    choosePrompt: '一つ選べ',
    timeUp: '時間切れ',
  },

  verdict: {
    survived: '通った',
    died: '死んだ',
    livesLeft: (n: number) => `命 ${n}`,
    backToSection: '区画の最初から',
    reached: (n: number) => `${n}部屋まで`,
    gameover: '尽きた',
    cleared: '抜けた',
    retry: 'もう一度',
    reveal: (names: string) => `嘘つきだったのは ${names}`,
    roundLiars: (names: string) => `嘘つきは ${names} だった`,
    revealNone: '嘘つきはいなかった',
    nameSeparator: '、',
  },

  advisor: {
    join: '入室',
    namePlaceholder: '名前（任意）',
    roomCodePlaceholder: '合言葉',
    waiting: 'まだ部屋は開いていない',
    youAreLiar: 'あなたは嘘つきだ',
    youAreLiarNote: '挑戦者を殺せば勝ち',
    youAreHonest: 'あなたは助言者だ',
    youAreHonestNote: '挑戦者を生かせば勝ち',
    correctIs: '生きる方',
    speaking: '発言できる',
    notSpeaking: '今回は発言できない',
    notSpeakingNote: '見えていても言えない',
    hintPlaceholder: '助言（20文字まで）',
    send: '送る',
    sent: '送った',
    // 助言は伏せて届く。挑戦者は数通しかひらけない
    veiled: '助言は伏せて届く',
    veiledNote: 'ひらいてもらえるとは限らない',
    opened: 'ひらかれた',
    volunteer: '立候補する',
    volunteered: '立候補中',
    silenced: '黙らされた。もう声は届かない',
  },

  errors: {
    roomNotFound: 'その部屋はない',
    roomFull: '満員',
    rateLimited: '少し待て',
    blocked: 'その言葉は通らない',
  },
} as const;

export type Strings = typeof ja;
export const t = ja;
