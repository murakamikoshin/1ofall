import type { Choice } from './schema';
import type { Knowledge } from './casting';
import { strings, localized } from '../i18n';
import type { Rng } from './rng';

/**
 * 人を指す助言。
 *
 * ここまでの助言は全部「扉について」だった。8人が扉の名前しか言えないので、
 * 並ぶのは8つの独白で、**会話が起きない。** 実際に一周書き出して読んだら、
 * どの部屋でも挑戦者がやっていたのは「どの名前が何回出たか」の集計だった。
 * 嘘つきと協力者が同じ形の文を書くので、それ以上読めるものが無かった。
 *
 * そこで、助言者が**互いを指せる**ようにする。
 *
 *   嘘つき   正解を口にした者を撃つ。「あいつは嘘だ」
 *   協力者   自分の候補に無い扉を押した者を撃てる
 *   耳打ち   死ぬ扉を押した者を撃てる
 *
 * 言えるのは一つだけなので、人を指した回はその人は扉について何も言えない。
 * **口を一つ使う**のが釣り合いになっている。
 *
 * 枠外の集計（7回目で捨てた）と違い、これは雑音ではない。
 * 協力者の疑いは「自分の候補に無い」という本当の知識から出ているし、
 * 嘘つきの疑いは「正解を知っている」から出ている。どちらも中身がある。
 * だから記録（正n 嘘n）と併せて読めば、指した側の当たり外れまで積める。
 */

export interface Person {
  id: string;
  name: string;
}

export interface Said extends Person {
  text: string;
}

/** 扉についての主張。negative は「そこは死ぬ」型 */
export interface DoorClaim {
  ids: readonly string[];
  negative: boolean;
}

/**
 * 扉についての主張を読む。
 * 選択肢の名前を先に外してから言い回しを見る（名前の中の否定語で読み違えるため）。
 */
export function readDoorClaim(text: string, choices: readonly Choice[]): DoorClaim | null {
  const touched = choices.filter((c) => text.includes(localized(c.label)));
  if (touched.length === 0) return null;
  let rest = text;
  for (const c of touched) rest = rest.split(localized(c.label)).join('　');
  return { ids: touched.map((c) => c.id), negative: strings().hints.avoidPattern.test(rest) };
}

/** 人を指した主張。doubt=疑う / false=庇う */
export interface Call {
  targetId: string;
  doubt: boolean;
}

/**
 * 人を指した助言かどうかを読む。
 *
 * 名前は長い方から当てる。「まめ」が「まめきち」の一部として当たると
 * 別人を指したことになる。
 */
export function readCall(text: string, people: readonly Person[]): Call | null {
  const byLength = [...people].filter((p) => p.name.length > 0).sort((a, b) => b.name.length - a.name.length);
  const target = byLength.find((p) => text.includes(p.name));
  if (!target) return null;
  const rest = text.split(target.name).join('　');
  const T = strings();
  if (T.hints.doubtPattern.test(rest)) return { targetId: target.id, doubt: true };
  if (T.hints.backPattern.test(rest)) return { targetId: target.id, doubt: false };
  return null;
}

/**
 * 自分の知識から見て、誰をどう指せるか。
 * 指す理由が無ければ null（黙って扉の話をする）。
 */
export function chooseCall(
  knowledge: Knowledge,
  choices: readonly Choice[],
  said: readonly Said[],
  rng: Rng,
): { id: string; name: string; doubt: boolean } | null {
  const options: { id: string; name: string; doubt: boolean; weight: number }[] = [];

  for (const s of said) {
    const claim = readDoorClaim(s.text, choices);
    // 人を指した助言を指し返さない。連鎖すると扉の話が盤面から消える
    if (!claim) continue;
    const pushes = (id: string): boolean => !claim.negative && claim.ids.includes(id);
    const buries = (id: string): boolean => claim.negative && claim.ids.includes(id);
    const add = (doubt: boolean, weight: number): void => { options.push({ id: s.id, name: s.name, doubt, weight }); };

    if (knowledge.kind === 'liar') {
      // 一番効く一手。正解を口にした者を潰す
      if (pushes(knowledge.correct)) add(true, claim.ids.length === 1 ? 3 : 1.6);
      // 罠を「死ぬ」と言われた。潰し返す
      else if (buries(knowledge.trap)) add(true, 1.4);
      // 罠を押してくれた者に乗る。声を二つに見せる
      else if (pushes(knowledge.trap)) add(false, 1.2);
    } else if (knowledge.kind === 'trapper') {
      if (buries(knowledge.trap)) add(true, 1.8);
      else if (pushes(knowledge.trap)) add(false, 1.2);
    } else if (knowledge.kind === 'doomed') {
      // 死ぬ扉を押している者は、嘘つきか思い違いのどちらかしかない
      if (pushes(knowledge.doomed)) add(true, 2.4);
      else if (buries(knowledge.doomed)) add(false, 1.0);
    } else {
      // 協力者。正解は必ず自分の候補の中にあるので、
      // 候補の外を押している者は「少なくとも自分の見立てとは違う」
      const inMine = claim.ids.some((id) => knowledge.candidates.includes(id));
      const narrow = knowledge.candidates.length <= 2;
      if (!claim.negative && !inMine) add(true, narrow ? 2.2 : 1.2);
      else if (claim.negative && claim.ids.every((id) => knowledge.candidates.includes(id)) && narrow) add(true, 1.5);
      else if (!claim.negative && inMine && claim.ids.length === 1) add(false, 0.9);
    }
  }

  if (!options.length) return null;
  const best = Math.max(...options.map((o) => o.weight));
  const top = options.filter((o) => o.weight === best);
  return top[Math.floor(rng() * top.length)] ?? null;
}

/**
 * 一部屋ぶんの助言について「正しかったか」を決める。
 *
 * 扉について言った者は、正解に触れていたかで決まる（これまでどおり）。
 * **人を指した者は、指した相手の扉についての言が嘘だったかで決まる。**
 * 「あいつは嘘だ」が当たっていれば正、外していれば嘘。
 * 隠れた配役を見ずに、画面に出ているものだけで決まるので、
 * 挑戦者が自分で検算できる。
 *
 * 一人が二つ喋る（扉について一つ、人を指して一つ）ので、
 * **返すのは一言ごと**。同じ人のぶんをまとめてしまうと、
 * 撃った当たり外れが扉についての当たり外れを上書きして消える。
 * 一言ごとに数えれば、外した名指しはそのまま自分の記録に傷として残る。
 *
 * 相手が扉について何も言っていないときは、記録を付けない（付けると
 * 指した順で有利不利が出る）。
 */
export function resolveTruth(
  advice: readonly (Said & { kind?: 'door' | 'call' | undefined })[],
  doorTruth: (text: string) => boolean,
  choices: readonly Choice[],
): { id: string; truthful: boolean }[] {
  const doorVerdict = new Map<string, boolean>();
  const out: { id: string; truthful: boolean }[] = [];
  const pending: { id: string; call: Call }[] = [];

  for (const a of advice) {
    if ((a.kind ?? (readDoorClaim(a.text, choices) ? 'door' : 'call')) === 'door') {
      const truthful = doorTruth(a.text);
      doorVerdict.set(a.id, truthful);
      out.push({ id: a.id, truthful });
      continue;
    }
    const call = readCall(a.text, advice);
    if (call) pending.push({ id: a.id, call });
    else out.push({ id: a.id, truthful: doorTruth(a.text) });
  }

  for (const { id, call } of pending) {
    const t = doorVerdict.get(call.targetId);
    if (t === undefined) continue;
    out.push({ id, truthful: call.doubt ? !t : t });
  }
  return out;
}
