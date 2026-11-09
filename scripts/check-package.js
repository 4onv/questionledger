import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const artifact=path.resolve(process.argv[2] ?? '4onv-questionledger-0.1.0.tgz');
const npm=process.env.npm_execpath;if(!npm)throw Error('Run with npm run check:package.');
const directory=await mkdtemp(path.join(tmpdir(),'questionledger-package-'));
const env={...process.env,npm_config_audit:'false',npm_config_fund:'false'};delete env.NODE_OPTIONS;delete env.NODE_TEST_CONTEXT;
function run(file,args,codes=[0]){const r=spawnSync(process.execPath,[file,...args],{cwd:directory,env,encoding:'utf8',windowsHide:true,timeout:60000});assert.ifError(r.error);assert.ok(codes.includes(r.status),r.stdout+'\n'+r.stderr);return r.stdout;}
try{
  run(npm,['install','--prefix',directory,'--offline','--ignore-scripts','--no-audit','--no-fund','--no-package-lock',artifact]);
  const bin=path.join(directory,'node_modules/@4onv/questionledger/bin/questionledger.js');
  assert.equal(run(bin,['--version']).trim(),'0.1.0');
  run(bin,['demo','--out','demo.html']);assert.match(await readFile(path.join(directory,'demo.html'),'utf8'),/QuestionLedger/);
  run(bin,['init','--out','notebook.json']);
  const status=JSON.parse(run(bin,['check','notebook.json','--json'],[1]));assert.equal(status.ready,false);
  run(bin,['build','notebook.json','--out','notebook.html']);run(bin,['markdown','notebook.json','--out','notebook.md']);
  console.log('Exact archive installed offline; installed init/check/build/demo/markdown passed.');
}finally{
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert.ok(path.basename(directory).startsWith('questionledger-package-'));
  await rm(directory,{recursive:true,force:true,maxRetries:4,retryDelay:100});
}
