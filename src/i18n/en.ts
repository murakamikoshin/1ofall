/**
 * English strings. Mirrors the shape of ja.ts exactly.
 * The voice is the house of a back-alley gambling den: terse, declarative, no politeness forms.
 */
import type { Strings } from './ja';

export const en: Strings = {
  title: 'A Lie Ahead',
  titleRuby: 'ISSUN',
  tagline: 'Everyone knows the answer. Everyone but you.',

  menu: {
    solo: 'Play alone',
    soloNote: 'Advisors are played by the machine',
    host: 'Open a den',
    hostNote: 'Invite your audience as advisors',
    advisor: 'Enter as an advisor',
  },

  hud: {
    lives: 'Lives',
    room: (n: number) => `Room ${n}`,
    section: (n: number, total: number) => `Block ${n} / ${total}`,
    slots: 'Speaking slots',
    mode: { lottery: 'Draw', nominate: 'Pick' },
  },

  challenger: {
    hintsEmpty: 'Waiting for advice',
    hintsNone: 'No advisors. Decide for yourself',
    inbox: (n: number) => `${n} advisors have spoken`,
    record: (hit: number, miss: number) => `true ${hit} / lies ${miss}`,
    recordHint: 'How honest they have been in this block',
    liarCount: (n: number) => `${n} of them are liars`,
    knowsNothing: 'Allies do not know the answer. They have it down to two',
    report: 'Report',
    reported: 'Reported',
    reportNote: 'Flag abuse or disruption',
    silence: 'Silence',
    silenceDone: 'Silenced',
    silenceHit: 'You silenced a liar',
    silenceMiss: 'Wrong. The next room will be shorter',
    choosePrompt: 'Choose one',
    timeUp: 'Out of time',
  },

  verdict: {
    survived: 'Through',
    died: 'Dead',
    livesLeft: (n: number) => `Lives ${n}`,
    backToSection: 'Back to the start of the block',
    reached: (n: number) => `${n} rooms deep`,
    gameover: 'Spent',
    cleared: 'Out',
    retry: 'Again',
    reveal: (names: string) => `The liars were ${names}`,
    roundLiars: (names: string) => `The liars were ${names}`,
    revealNone: 'There were no liars',
    nameSeparator: ', ',
  },

  advisor: {
    join: 'Enter',
    namePlaceholder: 'Name (optional)',
    roomCodePlaceholder: 'Passphrase',
    waiting: 'The room is not open yet',
    youAreLiar: 'You are a liar',
    youAreLiarNote: 'You win if the challenger dies',
    youAreHonest: 'You are an ally',
    youAreHonestNote: 'You win if the challenger lives',
    correctIs: 'Lives',
    maybeIs: 'One of these',
    youDontKnow: 'You do not know which. Only the liars do',
    speaking: 'You can speak',
    notSpeaking: 'You cannot speak this round',
    notSpeakingNote: 'You can see it and you cannot say it',
    hintPlaceholder: 'Advice (20 characters)',
    send: 'Send',
    sent: 'Sent',
    veiled: 'Everyone sees your advice',
    veiledNote: 'Your name is attached to it',
    opened: 'Read',
    volunteer: 'Volunteer',
    volunteered: 'Volunteering',
    silenced: 'You were silenced. Your voice no longer reaches',
  },

  errors: {
    roomNotFound: 'No such room',
    roomFull: 'Full',
    rateLimited: 'Wait a moment',
    blocked: 'That wording will not pass',
    pointing: 'Numbers and positions cannot be used',
    tooManyChoices: 'Name at most two',
    tooLong: 'Too long',
  },

  language: {
    label: 'Language',
  },
};
