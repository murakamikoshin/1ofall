import { BRINK, STANDARD } from '../core/limits';

/**
 * 文言はここに集約する。コードに直書きしない（多言語化は今回やらないが、
 * 後から差し替えられる形は崩さない）。
 */
/**
 * 区画の名前。奥へ行くほど、正解を一つに絞れている者が減る。
 * 数字だけだと「進んだ」実感が出ない
 */
const SECTION_NAMES = ['表口', '中庭', '奥座敷', '底'] as const;

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
      // 区画の後半でまとめて裏切るようにしたので、記録の読み方そのものが技になった。
      // 隠すのは盤面（誰が嘘つきか）だけで、規則は先に言う
      '嘘つきは信用を作ってから裏切る。区画の序盤はよく当て、奥へ行くほど崩れる。',
      '正直か嘘かの記録は区画ごとに消える。前の区画で積んだ信用は持ち越せない。',
      // 読み合いの答えが返る場所を先に言う。返ることを知らないと、記録を見なくなる
      '区画を二部屋以上進んで離れると、誰が嘘つきだったかが開く。読みの答えはそこで返る。',
      // 名指しは8回目に足した。赤い一行が何なのか分からないままだと読めない
      '助言者は互いを指せる。「あいつは嘘だ」も助言と同じ列に並ぶ。',
      '嘘つきは正解を口にした者を潰したがる。撃たれている者ほど、本当のことを言っている。',
    ],
    modes: {
      standard: [
        // 命と区画は限界の表から出す。書き写していたので、
        // 命を5に増やしたときに手引きだけ4のまま残っていた
        `命は${STANDARD.lives}つ、区画は${STANDARD.sections}つ。`,
        '助言者の顔ぶれも、誰が嘘つきかも、区画が変わるたび入れ替わる。',
        '奥の区画ほど、正解を一つに絞れている者が減る。',
      ],
      brink: [
        '信じられるのは一人だけ。ほかは全員が嘘つき。',
        'その一人は正解を知っている。見つけ出せば、区画を抜けるまで頼れる。',
        `命は${BRINK.lives}つある。探る余裕はあるが、無限ではない。`,
        '一部屋に一人だけ黙らせられる。当たれば嘘つきが消え、外すと次の部屋が短くなる。これが探す道具だ。',
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
    section: (n: number, total: number) => `${SECTION_NAMES[n - 1] ?? n}　${n}/${total}`,
    slots: '発言枠',
    mode: { lottery: '抽選', nominate: '指名' },
  },

  challenger: {
    hintsEmpty: '助言を待っている',
    hintsNone: '助言者はいない。自分で決めろ',
    inbox: (n: number) => `${n}人が助言を送ってきた`,
    record: (hit: number, miss: number) => `正${hit} 嘘${miss}`,
    recordHint: 'この区画での、その人の正直さ',
    /*
     * 疑いの札。押しても盤面は何も変わらない（自分の覚え書き）。
     * 読み合いは頭の中でやるものだったので、区画の答え合わせで
     * 「当たっていたか」を数えられなかった。札を置けば数えられる。
     */
    doubt: '疑う',
    doubtOn: '疑っている',
    /*
     * 札は公開の一手。置くと相手に伝わり、置かれた者は言い切るしかなくなる
     * （＝次の部屋で正誤が付く）。代わりにその人の迷いは読めなくなり、
     * 嘘つきは札の付いた者へ寄る。
     */
    doubtHint: '相手に伝わる。置かれた者は言い切るしかない',
    // 置いた／外した手応え。効くのは次の部屋から（いまの助言はもう出ている）
    doubtPlaced: (name: string) => `${name}に札を置いた。次の部屋では言い切らせる`,
    doubtLifted: (name: string) => `${name}の札を外した`,
    /*
     * 全員挑戦者だけの言い回し。
     *
     * あちらは挑戦者が何人もいるので、誰の札を配るのかが決まらない。
     * 札は画面の中だけに置いたままなので、伝わると書いてはいけない。
     */
    doubtHintPrivate: '自分の覚え書き。相手には見えない',
    reportedNotice: '通報した。その者の声はもう届かない',
    confirmedLiar: '黙らせた。嘘つきで確定',
    freshCast: '顔ぶれが入れ替わった。記録は白紙だ',
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
    reached: (n: number) => (n === 0 ? '一部屋目で終わった' : `${n}部屋まで抜けた`),
    gameover: '尽きた',
    cleared: '抜けた',
    retry: 'もう一度',
    retryHere: '同じ賭場でもう一度',
    leaveRoom: '賭場を閉じる',
    // 部屋を開き直せるのは最初に繋いだ一人だけ。ほかの人は待つしかないので、
    // 押しても効かない口を出さずに、待っていることを書く
    waitingHost: '主が次の周を始めるのを待っている',
    leaveHere: '賭場を出る',
    reveal: (names: string) => `嘘つきだったのは ${names}`,
    roundLiars: (names: string) => `嘘つきは ${names} だった`,
    followedCrowd: '一番多く名の挙がった道だった',
    revealSection: (n: number, names: string) => `${SECTION_NAMES[n - 1] ?? n}の嘘つき　${names}`,
    revealNone: '嘘つきはいなかった',
    best: (n: number) => `最高到達 ${n}部屋`,
    bestNone: 'まだ記録はない',
    newBest: '最高記録を更新した',
    nameSeparator: '、',
  },

  /**
   * 区画の答え合わせ。
   *
   * 顔ぶれと配役は区画をまたいで残らないので、離れる瞬間に開いても
   * 先の部屋には何も漏れない。開かないと、読み合いの答えが
   * 終わりの画面まで一度も返らない（1周12分ぶん貯まる）。
   */
  answer: {
    cleared: (n: number) => `${SECTION_NAMES[n - 1] ?? n}を抜けた`,
    lost: (n: number) => `${SECTION_NAMES[n - 1] ?? n}で落ちた`,
    heading: '答え合わせ',
    note: 'ここで席は組み替わる。次は別の顔ぶれ、別の配役',
    liar: '嘘つき',
    honest: '正直',
    record: (hit: number, miss: number) => `正${hit}　嘘${miss}`,
    noRecord: '何も言わなかった',
    // 信用を作ってから裏切る者を、数字のほうから指す
    builtCredit: '積んで、崩した',
    go: '次へ',
    // 置いた疑いの札と突き合わせる。読み合いに点が付く
    doubted: '疑っていた',
    readScore: (hit: number, all: number) => `嘘つき ${all}人のうち ${hit}人を疑っていた`,
    readWrong: (n: number) => `正直な ${n}人を疑った`,
    readNone: '誰も疑わなかった',
    // 助言者側。自分の役はもう知っているので、見るのは他人の役
    yours: 'あなた',
    advisorHeading: (n: number) => `${SECTION_NAMES[n - 1] ?? n}の答え合わせ`,
  },

  advisor: {
    join: '入室',
    namePlaceholder: '名前（任意）',
    roomCodePlaceholder: '合言葉',
    waiting: 'まだ部屋は開いていない',
    waitingNextRun: '次の周を待っている',
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
    youNarrowedTo: (n: number) =>
      // 崖っぷちの唯一の正直者は候補が1つ＝正解を正確に知っている。
      // 「1つのどれか」と書くと、知っていることを本人が過小に見る
      n === 1
        ? '光った扉が正解だ。あなただけが知っている'
        : `生きる方は光った${n}つのどれか。それ以上は分からない`,
    youOnlyKnowTrap: '知っているのは罠だけ。生きる方は分からない',
    youKnowDoomed: '分かるのは死ぬ方だけ。生きる方は知らない',
    nothingDealt: '今回は何も配られていない',
    betHit: '当てた',
    betMiss: '外した',
    betRecord: (hit: number, miss: number) => `通算 当${hit} 外${miss}`,
    // 賭けた人だけを分母にする。当てているほど発言枠へ上がりやすい
    betRank: (place: number, of: number) => `賭けた${of}人中 ${place}位`,
    // 周の終わりに出す通算。嘘つきの手柄は「殺した」、正直者の手柄は「通した」
    runHead: 'この周のあなた',
    runFollowed: (n: number, all: number) => `${all}部屋のうち ${n}部屋であなたの言葉が採られた`,
    runKilled: (n: number) => `${n}部屋で挑戦者を死なせた`,
    runSaved: (n: number) => `${n}部屋で挑戦者を通した`,
    /*
     * 挑戦者の疑いの札。
     *
     * 撃たれている当人には頭に出す（弁解するか、開き直るかを選べる）。
     * ほかの人のぶんは場の行に出る——挑戦者の読みが見えるので、
     * 乗って埋めることも、庇って信用を賭けることもできる。
     */
    doubtedYou: 'あなたは疑われている',
    doubtedMark: '疑われている',
    // 押された者の規則。迷いに隠れられないので、嘘つきは罠を押すしかなくなる
    doubtedRule: '次の一言は、扉ひとつを言い切る',
    /*
     * 発言枠にいた人へ返すもの。
     *
     * 枠外の賭けには当たり外れが返るのに、言葉を書いた5〜8人には
     * 何も返っていなかった。嘘つきは罠が刺さったかを知らないまま、
     * 正直者は信じられなかった理由も分からないまま次の部屋へ行っていた。
     * 「あなたの言葉で」を主語にする（挑戦者の生死は結果でしかない）。
     */
    followedLived: 'あなたの言葉で通った',
    followedDied: 'あなたの言葉で死んだ',
    ignoredLived: '信じられなかった。挑戦者は通った',
    ignoredDied: '信じられなかった。挑戦者は死んだ',
    votePrompt: '喋れないが、一票は入れられる',
    /**
     * 場に出ている言葉。**これまで自分の一言しか見えていなかった。**
     * 互いの言葉が見えないと、誰も誰かを指せない
     */
    floorTitle: '場に出ている言葉',
    floorEmpty: 'まだ誰も言っていない',
    pointNote: '一人だけ撃てる。撃っても自分の一言は消えない',
    pointNeedsHint: 'まず自分の一言を出す',
    doubtButton: '嘘だ',
    backButton: '本当だ',
    pointed: (name: string) => `${name}を撃った`,
    backed: (name: string) => `${name}に乗った`,
    voted: (label: string) => `${label}に入れた`,
    notSpeakingButVote: '言葉は届かない。だが票は届く',
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
    volunteerNote: '手を挙げた人は次の区画で選ばれやすい。賭けを当てているとさらに',
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
    // 答え合わせは時間で送る（6〜8人の合図は待てない）
    answerIn: (sec: number) => `あと${sec}秒`,
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
    speakFirst: 'まず自分の一言を出す',
    // 疑われている者は言い切る。迷いに隠れて紛れることができない
    mustCommit: '疑われている。扉ひとつを言い切れ',
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
      (l: string) => `${l}で通れる`,
      (l: string) => `${l}しかない`,
      (l: string) => `${l}。それだけだ`,
    ],
    /** 迷いを込める */
    hedge: [
      (l: string) => `たぶん${l}`,
      (l: string) => `${l}に見える`,
      (l: string) => `${l}じゃないか`,
      (l: string) => `${l}な気がする`,
      (l: string) => `${l}、かな`,
      (l: string) => `${l}あたりか`,
      (l: string) => `${l}だと思うが`,
    ],
    /** これは死ぬ、と伝える */
    avoid: [
      (l: string) => `${l}はやめろ`,
      (l: string) => `${l}は死ぬ`,
      (l: string) => `${l}に手を出すな`,
      (l: string) => `${l}は罠だ`,
      (l: string) => `${l}だけは違う`,
      (l: string) => `${l}は外せ`,
      (l: string) => `${l}に触るな`,
    ],
    /**
     * 二つに絞れている、と伝える。
     *
     * **一番使われる型**（実測で扉についての一言の49%がこれ）。
     * 4種しか無かったので、8人が喋る部屋では同じ言い方が3〜4回並び、
     * 読むのが名前だけになっていた（`tools/voice-check.mjs`）。
     * 迷いを含む言い方と、含まない言い方の比は3:1のまま増やす
     * ——ここを崩すと「断言を疑い迷いを信じる」の読みが変わって腕の差が動く。
     */
    narrow: [
      (a: string, b: string) => `${a}か${b}のどっちか`,
      (a: string, b: string) => `${a}と${b}まで絞れた`,
      (a: string, b: string) => `${a}か${b}。決めきれん`,
      (a: string, b: string) => `${a}と${b}のどちらか`,
      (a: string, b: string) => `${a}か${b}に絞った`,
      (a: string, b: string) => `${a}、いや${b}か`,
      (a: string, b: string) => `${a}と${b}まで見えた`,
      (a: string, b: string) => `${a}か${b}だろう`,
      (a: string, b: string) => `${a}か${b}あたりか`,
      // 札が長い部屋では短い型しか収まらない（20字）。
      // 短い型が足りないと、長い札の部屋で同じ言い方が3回並ぶ
      (a: string, b: string) => `${a}か${b}、かな`,
      // 迷いを含まない言い方（比を保つために四つだけ）
      (a: string, b: string) => `${a}か${b}だ`,
      (a: string, b: string) => `${a}か${b}`,
      (a: string, b: string) => `${a}と${b}か`,
      (a: string, b: string) => `${a}と${b}が残る`,
    ],
    /**
     * 人を指して疑う。**扉の名前を一つも含まないのが要点。**
     * 言えるのは一つだけなので、人を指した回は扉について何も言えない。
     */
    doubt: [
      (n: string) => `${n}は嘘だ`,
      (n: string) => `${n}を信じるな`,
      (n: string) => `${n}が嘘つきだ`,
      (n: string) => `${n}に乗るな`,
      (n: string) => `${n}は嘘をついている`,
      // 一部屋に何人も撃つ部屋がある（通常は枠が8）。5種では使い切って重なる
      (n: string) => `${n}の言葉は嘘だ`,
      (n: string) => `${n}を疑え`,
      (n: string) => `${n}は当てにならない`,
    ],
    /** 人を指して庇う */
    back: [
      (n: string) => `${n}は本当だ`,
      (n: string) => `${n}を信じろ`,
      (n: string) => `${n}は正しい`,
      (n: string) => `${n}に乗れ`,
      (n: string) => `${n}の言葉は本当だ`,
      (n: string) => `${n}に賭けろ`,
    ],
    /** 疑ったかどうか。doubt と必ず揃えること */
    doubtPattern: /嘘だ|信じるな|嘘つきだ|乗るな|嘘をついている|疑え|当てにならない/,
    /** 庇ったかどうか。back と必ず揃えること */
    backPattern: /本当だ|信じろ|正しい|乗れ|賭けろ/,
    /** 「これは死ぬ」型かどうかの判定。記録の正誤に使う */
    avoidPattern: /やめろ|死ぬ|手を出すな|罠だ|だけは違う|だめだ|はずれ|外せ|触るな/,
    /** 迷いを含む言い方かどうか */
    hedgePattern: /たぶん|気がする|に見える|じゃないか|絞れた|決めきれん|どっちか|、かな|あたりか|と思うが|どちらか|絞った|いや|まで見えた|だろう/,
  },
};

/** 文言表の形。他の言語はこの形に揃える */
export type Strings = typeof ja;
