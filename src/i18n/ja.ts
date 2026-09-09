/**
 * 文言はここに集約する。コードに直書きしない（多言語化は今回やらないが、
 * 後から差し替えられる形は崩さない）。
 */
export const ja = {
  title: '一寸先は嘘',
  titleRuby: 'いっすんさきはうそ',
  tagline: '答えを知っているのは、君以外の全員だ。',

  menu: {
    solo: '一人で遊ぶ',
    soloNote: '助言者はすべて AI。いつでも始められる',
    brink: '崖っぷち',
    brinkNote: '一人以外みな嘘つき。信じられる一人を探す',
    party: '全員挑戦者',
    partyNote: '仲間も同じ部屋を歩く。裏切る者にも命が懸かる',
    random: '野良で遊ぶ',
    randomNote: '見知らぬ助言者と。足りないぶんは AI が埋める',
    host: '賭場を開く',
    hostNote: '観客を助言者として招く',
    advisor: '助言者として入る',
    comingSoon: '準備中',
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
    record: (hit: number, miss: number) => `正${hit} 嘘${miss}`,
    recordHint: 'この区画での、その人の正直さ',
    liarUnknown: '嘘つきは0人かもしれないし、全員かもしれない',
    speakers: (got: number, all: number) => `${all}人中 ${got}人が発言`,
    knowsNothing: '協力者は正解を知らない。二択まで絞れているだけ',
    ownKnows: 'あなたが知っているのはこの範囲だけ',
    ownMark: 'この中',
    partyPicked: (name: string, label: string) => `${name}は${label}を選んだ`,
    partyDied: (n: number) => `仲間 ${n}人も死んだ`,
    partyLived: '仲間は全員通った',
    resting: '死んだので次の部屋は喋れない',
    report: '通報',
    reported: '通報した',
    reportNote: '暴言・妨害を運営に知らせる',
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
    maybeIs: 'このどちらか',
    maybeIsWide: 'この三つのどれか',
    doomedIs: 'これは死ぬ',
    trapIs: '罠。ここへ誘え',
    youDontKnow: 'どれかは分からない。知っているのは嘘つきだけ',
    youKnowDoomed: '分かるのは死ぬ方だけ。生きる方は知らない',
    speaking: '発言できる',
    notSpeaking: '今回は発言できない',
    notSpeakingNote: '見えていても言えない',
    hintPlaceholder: '助言（20文字まで）',
    send: '送る',
    sent: '送った',
    // 助言は伏せて届く。挑戦者は数通しかひらけない
    veiled: '助言は全員に見える',
    veiledNote: '名前が一緒に出る',
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
    pointing: '番号と位置は使えない',
    tooManyChoices: '触れていいのは二つまで',
    tooLong: '長すぎる',
  },

  language: {
    label: '言語',
  },
};

/** 文言表の形。他の言語はこの形に揃える */
export type Strings = typeof ja;
