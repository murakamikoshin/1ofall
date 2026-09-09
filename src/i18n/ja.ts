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
    join: '合言葉で入る',
    joinNote: '仲間の部屋へ。全員挑戦者はこちらから',
    random: '野良で遊ぶ',
    randomNote: '見知らぬ助言者と。足りないぶんは AI が埋める',
    host: '賭場を開く',
    hostNote: '観客を助言者として招く',
    advisor: '助言者として入る',
    bestShort: (n: number) => `最高 ${n}部屋`,
    comingSoon: '準備中',
  },

  /** 初回だけ出る手引き。ここを読まずに一部屋目へ入ると、まず死ぬ */
  briefing: {
    heading: '手引き',
    begin: '入る',
    close: '戻る',
    open: '手引き',
    onceNote: 'この画面は最初の一度だけ。あとは「手引き」からいつでも読める',
    pausedNote: '読んでいるあいだ、持ち時間は止まる',
    runningNote: '読んでいるあいだも部屋は進む。ほかの人が待っている',
    rulesHeading: 'どの遊び方にも共通すること',
    rules: [
      '生きて出られる道は、部屋ごとにひとつだけ。',
      '助言者には嘘つきが混じっている。誰が嘘つきかは、区画のあいだ変わらない。',
      '嘘つきは正解を知っていて、みなで同じ罠へ誘う。名の挙がった数が多い道が正しいとは限らない。',
      '正直者も正解を全部は知らない。「このどちらか」までしか見えていない者もいる。',
      '正直か嘘かの記録は区画ごとに消える。前の区画で積んだ信用は持ち越せない。',
    ],
    modes: {
      standard: [
        '命は四つ、区画は四つ。',
        '助言者の顔ぶれも、誰が嘘つきかも、区画が変わるたび入れ替わる。',
        '奥の区画ほど、正解を一つに絞れている者が減る。',
      ],
      brink: [
        '信じられるのは一人だけ。ほかは全員が嘘つき。',
        'その一人は正解を知っている。見つけ出せば、区画を抜けるまで頼れる。',
        '命は六つある。探る余裕はあるが、無限ではない。',
      ],
      party: [
        '仲間も同じ部屋を歩く。全員が自分の命を賭けている。',
        'あなたに見えている手がかりは、あなたにしか見えていない。伝えなければ誰も知らない。',
        '仲間の中に裏切り者がいる。裏切り者も死ぬが、あなたを道連れにしたがる。',
      ],
    },
  },

  lobby: {
    heading: '合言葉',
    where: (url: string) => `${url} を開いて、この合言葉を入れてもらう`,
    waiting: (n: number) => (n === 0 ? 'まだ誰も来ていない。AI だけでも始められる' : `${n}人が来ている`),
    whereParty: (url: string, label: string) => `${url} を開いて「${label}」から、この合言葉を入れてもらう`,
    matchHeading: '相手を探している',
    matchNote: '同じモードを待っている人と突き合わせる。揃わなくても30秒で始まる（足りないぶんは AI が入る）',
    matchWaiting: (n: number, need: number) => `${n}人が待っている（${need}人集まれば始まる）`,
    joinHeading: '合言葉',
    joining: '繋いでいる',
    waitingHost: '部屋の主が始めるのを待っている',
    lost: '線が切れた',
    begin: '始める',
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
    best: (n: number) => `最高到達 ${n}部屋`,
    bestNone: 'まだ記録はない',
    newBest: '最高記録を更新した',
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
    trapIs: 'ここへ誘え',
    noteSeparator: '。',
    /** 目利きは候補までは絞れている。「何も分からない」と読ませない */
    youNarrowedTo: (n: number) => `生きる方は光った${n}つのどれか。それ以上は分からない`,
    youOnlyKnowTrap: '知っているのは罠だけ。生きる方は分からない',
    youKnowDoomed: '分かるのは死ぬ方だけ。生きる方は知らない',
    nothingDealt: '今回は何も配られていない',
    pickPrompt: 'あなたも一つ通る。命は自分持ちだ',
    picked: (label: string) => `${label}を通る`,
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

  /** 全員挑戦者モードだけの文言 */
  party: {
    you: 'あなた',
    ready: '決めた',
    out: '尽きた',
    noPick: '決めなかった',
    spoken: (got: number, all: number) => `${all}人中 ${got}人が言った`,
    reached: (done: number, all: number) => `${all}部屋のうち ${done}部屋`,
    survivors: (names: string) => `残ったのは ${names}`,
    noSurvivors: '誰も残らなかった',
    traitorsWere: (names: string) => `裏切っていたのは ${names}`,
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

  /**
   * 助言の言い回し。AI助言者が使い、判定にも使う。
   * 言語ごとに用意する（英語のラベルに日本語のテンプレートを差すと壊れる）。
   */
  hints: {
    /** 一つに賭けて押す */
    push: [
      (l: string) => `${l}だ`,
      (l: string) => `${l}にしろ`,
      (l: string) => `${l}が生きる`,
      (l: string) => `${l}で間違いない`,
      (l: string) => `迷うな、${l}`,
    ],
    /** 迷いを込める */
    hedge: [
      (l: string) => `たぶん${l}`,
      (l: string) => `${l}に見える`,
      (l: string) => `${l}じゃないか`,
      (l: string) => `${l}な気がする`,
    ],
    /** これは死ぬ、と伝える */
    avoid: [
      (l: string) => `${l}はやめろ`,
      (l: string) => `${l}は死ぬ`,
      (l: string) => `${l}に手を出すな`,
      (l: string) => `${l}は罠だ`,
      (l: string) => `${l}だけは違う`,
    ],
    /** 二つに絞れている、と伝える */
    narrow: [
      (a: string, b: string) => `${a}か${b}のどっちか`,
      (a: string, b: string) => `${a}か${b}だ`,
      (a: string, b: string) => `${a}と${b}まで絞れた`,
      (a: string, b: string) => `${a}か${b}。決めきれん`,
    ],
    /** 「これは死ぬ」型かどうかの判定。記録の正誤に使う */
    avoidPattern: /やめろ|死ぬ|手を出すな|罠だ|だけは違う|だめだ|はずれ/,
    /** 迷いを含む言い方かどうか */
    hedgePattern: /たぶん|気がする|に見える|じゃないか|絞れた|決めきれん|どっちか/,
  },
};

/** 文言表の形。他の言語はこの形に揃える */
export type Strings = typeof ja;
