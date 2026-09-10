import { build } from 'esbuild';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
const root='/home/user/1ofall';
const out = join(tmpdir(), `rd-${process.pid}.mjs`);
await build({ stdin: { contents: `
  export { GameEngine } from './src/core/engine';
  export { AiAdvisorGateway } from './src/core/ai-advisors';
  export { corePackage } from './src/core/pack';
  export { MODES } from './src/core/limits';
  export { scoreChoices, bestChoice, trustOf } from './src/core/read-hints';
  export { setLocale, localized } from './src/i18n';
  export { createRng } from './src/core/rng';
`, resolveDir: root, loader: 'ts' }, bundle:true, format:'esm', platform:'node', outfile:out, logLevel:'silent' });
const C = await import(pathToFileURL(out).href);
C.setLocale('ja');
const tick=()=>new Promise(r=>setTimeout(r,0));
const mode=C.MODES.brink;
const inner=new C.AiAdvisorGateway({count:12,mode,minDelayMs:0,maxDelayMs:0});
let brief=null;
const gw=Object.create(inner); gw.openRound=(b)=>{brief=b;inner.openRound(b);};
const engine=new C.GameEngine({pack:C.corePackage(),mode,gateway:gw,seed:1234});
const rng=C.createRng(1);
engine.start();
let probes=0,hits=0;
for(let g=0;g<40;g++){
  const s=engine.snapshot();
  if(s.phase==='gameover'||s.phase==='cleared')break;
  if(s.phase!=='choosing'||!s.round){engine.advancePresentation();continue;}
  await tick();
  const r=engine.snapshot().round;
  const liars=new Set(brief.casting.liarIds);
  console.log(`\n${r.roomNumber}部屋目 (${s.sectionIndex+1}区画)`);
  for(const a of r.advice){
    const t=C.trustOf(a.record);
    console.log(`  ${liars.has(a.advisorId)?'嘘':'正'} ${a.advisorName.padEnd(6,'　')} 正${a.record.hit} 嘘${a.record.miss} 信用${t.toFixed(2)} 「${a.text}」`);
  }
  if(!r.silenceUsed && r.advice.length){
    let worst=r.advice[0];
    for(const a of r.advice) if(C.trustOf(a.record)<C.trustOf(worst.record)) worst=a;
    const res=engine.silence(worst.advisorId);
    if(res){probes++; if(res.hit)hits++; console.log(`  → ${worst.advisorName} を黙らせた: ${res.hit?'当たり':'外し'}`);}
  }
  const after=engine.snapshot().round;
  const rows=(after?.advice??[]).map(a=>({advisorId:a.advisorId,text:a.text,record:a.record}));
  engine.choose(C.bestChoice(C.scoreChoices({choices:after.room.choices,rows,own:null}),after.room.choices,rng));
  for(let i=0;i<4;i++)engine.advancePresentation();
}
console.log(`\n黙らせ ${probes}回 当たり ${hits} (${(hits/probes*100).toFixed(0)}%)`);
