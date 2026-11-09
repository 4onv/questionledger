#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { open, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { validateLedger, analyzeLedger, toMarkdown } from '../src/core.js';
import { renderLedger } from '../src/compiler.js';
import { parseJson } from '../src/parse-json.js';

const help = `QuestionLedger — keep the question behind the answer

questionledger init --out notebook.json
questionledger demo --out demo.html
questionledger build notebook.json --out notebook.html
questionledger check notebook.json [--json]
questionledger markdown notebook.json --out notebook.md

Node.js 22+. Every output filename must be new. No network or model calls.
check exits 0 when all recorded items are reviewed, 1 when work remains,
and 2 for invalid input or an operational error. Readiness is not proof of truth.
`;
async function readLedger(file) {
  const handle=await open(file,constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NONBLOCK));
  try {
    const info=await handle.stat();if(!info.isFile()||info.size>1024*1024)throw Error('Input must be a regular JSON file no larger than 1 MiB.');
    const data=Buffer.alloc(Math.min(info.size+1,1024*1024+1));let size=0;
    while(size<data.length){const part=await handle.read(data,size,data.length-size,null);if(!part.bytesRead)break;size+=part.bytesRead;}
    if(size>info.size)throw Error('Input changed while being read.');
    return validateLedger(parseJson(new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(0,size))));
  } finally {await handle.close();}
}
async function writeNew(file, content, input) {
  if(!file)throw Error('Provide --out with a new filename.');
  if(input&&path.resolve(file)===path.resolve(input))throw Error('Input and output must differ.');
  const handle=await open(file,'wx',0o600);
  try{await handle.writeFile(content);}finally{await handle.close();}
  console.log(`Wrote ${file}`);
}
async function main() {
  const {values,positionals}=parseArgs({allowPositionals:true,options:{out:{type:'string'},json:{type:'boolean'},help:{type:'boolean'},version:{type:'boolean'}}});
  if(values.help||!positionals.length&&!values.version){console.log(help);return;}
  if(values.version){console.log('0.1.0');return;}
  const [command,input]=positionals;
  if(!['init','demo','build','check','markdown'].includes(command))throw Error('Unknown command. See --help.');
  if(positionals.length>(['init','demo'].includes(command)?1:2))throw Error('Unexpected positional argument.');
  if(values.json&&command!=='check')throw Error('--json is only supported by check.');
  if(command==='check'&&values.out)throw Error('check does not write files.');
  if(command==='init') {
    const ledger={version:1,title:'New decision notebook',description:'Record the questions, answers and facts behind a decision.',facts:[],questions:[{id:'Q1',parentId:null,prompt:'What decision needs to be made?',dependsOn:[],answer:null}],confirmation:null};
    await writeNew(values.out,JSON.stringify(ledger,null,2)+'\n');return;
  }
  if(command==='demo'){
    const ledger=JSON.parse(await readFile(new URL('../examples/notebook.json',import.meta.url),'utf8'));
    await writeNew(values.out,await renderLedger(ledger));return;
  }
  if(!input)throw Error('Provide a notebook JSON file.');
  const ledger=await readLedger(input);
  if(command==='build'){await writeNew(values.out,await renderLedger(ledger),input);return;}
  if(command==='markdown'){await writeNew(values.out,await toMarkdown(ledger),input);return;}
  const result=await analyzeLedger(ledger);
  console.log(values.json?JSON.stringify(result,null,2):`${result.ready?'Ready for confirmation':'Review needed'} · ${result.counts.reviewed} reviewed · ${result.counts['needs-review']} need review · ${result.counts.blocked} blocked · ${result.counts.unanswered} unanswered\n${result.confirmed?'Confirmed for current content.':'Not confirmed for current content.'}`);
  if(!result.ready)process.exitCode=1;
}
main().catch(error=>{console.error('QuestionLedger: '+(error.code==='EEXIST'?'Output already exists; choose a new filename.':error.message));process.exitCode=2;});
