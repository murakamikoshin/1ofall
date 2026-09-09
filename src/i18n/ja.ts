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
    host: 'ルームを作る',
    hostNote: '観客を助言者として招く',
    advisor: '助言者として入る',
  },

  hud: {
    lives: '残機',
    room: (n: number) => `${n}部屋目`,
    slots: '発言枠',
    mode: { lottery: '抽選', nominate: '指名' },
  },

  challenger: {
    hintsEmpty: '助言はまだ届いていない',
    hintsNone: '助言者はいない。自分で決めろ',
    silence: '排除',
    silenceDone: '排除済み',
    silenceHit: '嘘つきを黙らせた',
    silenceMiss: '外した。次の部屋が短くなる',
    choosePrompt: '一つ選べ',
    timeUp: '時間切れ',
  },

  verdict: {
    survived: '通った',
    died: '死んだ',
    livesLeft: (n: number) => `残機 ${n}`,
    backToSection: '区画の最初から',
    reached: (n: number) => `${n}部屋まで到達`,
    gameover: '全滅',
    cleared: '抜けた',
    retry: 'もう一度',
    reveal: '嘘つきだったのは',
    revealNone: '嘘つきはいなかった',
  },

  advisor: {
    join: '入室',
    namePlaceholder: '名前（任意）',
    roomCodePlaceholder: 'ルームコード',
    waiting: '部屋が開くのを待っている',
    youAreLiar: 'あなたは嘘つきです',
    youAreLiarNote: '挑戦者を殺せば勝ち',
    youAreHonest: 'あなたは助言者です',
    youAreHonestNote: '挑戦者を生かせば勝ち',
    correctIs: '正解',
    speaking: '発言できる',
    notSpeaking: '今回は発言できない',
    notSpeakingNote: '見えていても言えない',
    hintPlaceholder: 'ヒント（20文字まで）',
    send: '送る',
    sent: '送信した',
    volunteer: '立候補する',
    volunteered: '立候補中',
    silenced: '排除された。もう届かない',
  },

  errors: {
    roomNotFound: 'その部屋は無い',
    roomFull: '満員',
    rateLimited: '少し待て',
    blocked: '送れない言葉が含まれている',
  },
} as const;

export type Strings = typeof ja;
export const t = ja;
