/** 人間と AI を混ぜる仕組みの確認 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `comp-${process.pid}.mjs`);
await build({
  stdin: { contents: `export * from './src/core/composite-gateway';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
});
const { CompositeAdvisorGateway } = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  期待 ${JSON.stringify(want)} / 実際 ${JSON.stringify(got)}`}`);
};

/** 人間の助言者を模した供給源 */
function fakeHuman(names) {
  const roster = names.map((n, i) => ({ id: `h_${i}`, name: n, kind: 'human' }));
  const rosterListeners = new Set();
  return {
    kind: 'human',
    roster: () => roster,
    openRound() {}, closeRound() {},
    onHint: () => () => {},
    onRosterChange: (l) => { rosterListeners.add(l); return () => rosterListeners.delete(l); },
    volunteers: () => [],
    dispose() {},
    _add(name) {
      const found = roster.find((a) => a.name === name);
      if (!found) roster.push({ id: `h_${roster.length}`, name, kind: 'human' });
      for (const l of rosterListeners) l(roster);
    },
    _leave(name) {
      const i = roster.findIndex((a) => a.name === name);
      if (i >= 0) roster.splice(i, 1);
      for (const l of rosterListeners) l(roster);
    },
  };
}

// 誰もいない：全部 AI で埋まる
const alone = new CompositeAdvisorGateway({ minAdvisors: 8, aiSeed: 1 });
check('誰もいなければ8人ぶん AI が入る', alone.roster().length, 8);
check('人間は0人', alone.humanCount(), 0);

// 3人いる：残り5人を AI が埋める
const human3 = fakeHuman(['あ', 'い', 'う']);
const mixed = new CompositeAdvisorGateway({ human: human3, minAdvisors: 8, aiSeed: 2 });
check('3人いれば合計8人になる', mixed.roster().length, 8);
check('人間は3人', mixed.humanCount(), 3);
check('先頭は人間', mixed.roster().slice(0, 3).map((a) => a.kind), ['human', 'human', 'human']);

// 人が増えたら AI は減る
human3._add('え'); human3._add('お');
check('5人に増えたら合計はやはり8人', mixed.roster().length, 8);
check('AI は3人に減る', mixed.roster().filter((a) => a.kind === 'ai').length, 3);

// 人が足りている：AI は入らない
const many = new CompositeAdvisorGateway({ human: fakeHuman([...'あいうえおかきくけこ']), minAdvisors: 8, aiSeed: 3 });
check('人が足りていれば AI は入らない', many.roster().filter((a) => a.kind === 'ai').length, 0);
check('人数はそのまま', many.roster().length, 10);

// 名簿の変化が伝わる
let notified = 0;
const watcher = fakeHuman(['あ']);
const g = new CompositeAdvisorGateway({ human: watcher, minAdvisors: 5, aiSeed: 4 });
g.onRosterChange(() => notified++);
watcher._add('い');
check('入室が伝わる', notified, 1);


// 抜けた席は AI が引き継ぐ。名前と記録が消えないこと
const leavers = fakeHuman(['あ', 'い', 'う', 'え']);
const g2 = new CompositeAdvisorGateway({ human: leavers, minAdvisors: 6, aiSeed: 9 });
check('4人＋AI2人で6人', g2.roster().length, 6);
const before = g2.roster().filter((a) => a.kind === 'human').map((a) => a.name);
check('人間は4人', before, ['あ', 'い', 'う', 'え']);

leavers._leave('い');
const after = g2.roster();
check('抜けても人数は変わらない', after.length, 6);
check('抜けた人の名前は残る', after.some((a) => a.name === 'い'), true);
check('抜けた席は AI が座る', after.find((a) => a.name === 'い')?.kind, 'ai');
check('人間は3人に減る', g2.humanCount(), 3);

leavers._add('い');
check('戻ってきたら席を返す', g2.roster().find((a) => a.name === 'い')?.kind, 'human');

console.log(`\n${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
