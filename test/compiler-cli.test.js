import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { renderLedger } from '../src/compiler.js';
import { analyzeLedger } from '../src/core.js';
import { parseJson } from '../src/parse-json.js';
const example=JSON.parse(await readFile(new URL('../examples/notebook.json',import.meta.url),'utf8'));
const cli=fileURLToPath(new URL('../bin/questionledger.js',import.meta.url));
const run=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});
test('synthetic example preserves three reviews and two open items',async()=>{
  const result=await analyzeLedger(example);
  assert.deepEqual(result.counts,{unanswered:1,blocked:1,'needs-review':0,reviewed:3});
  assert.equal(result.ready,false);
});
test('compiler binds CSP to exact deterministic scripts and styles',async()=>{
  const html=await renderLedger(example);
  assert.equal(html,await renderLedger(example));
  for(const tag of ['script','style']) {
    const body=html.match(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>'))[1];
    assert.ok(html.includes("'sha256-"+createHash('sha256').update(body).digest('base64')+"'"));
  }
  assert.ok(html.includes("connect-src 'none'"));
});
test('hostile text and template tokens cannot become HTML or compiler slots',async()=>{
  const input=structuredClone(example);input.title='</script><img src=x onerror=alert(1)> %%JS%% %%CSS%% &';
  const html=await renderLedger(input);
  assert.ok(!html.includes('<img src=x'));
  const embedded=JSON.parse(html.match(/<script[^>]*id="initial-ledger"[^>]*>([\s\S]*?)<\/script>/)[1]);
  assert.equal(embedded.title,input.title);
  assert.equal((html.match(/<script>/g)||[]).length,1);
});
test('strict JSON reader rejects duplicate and escaped duplicate keys',()=>{
  assert.throws(()=>parseJson('{"version":1,"version":1}'),/Duplicate/);
  assert.throws(()=>parseJson('{"a":1,"\\u0061":2}'),/Duplicate/);
  assert.throws(()=>parseJson('{"a":1e999}'),/finite/);
});
test('installed CLI paths work with spaces, preserve outputs and distinguish review from invalid input',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'questionledger-cli-'));
  try {
    const input=path.join(dir,'my notebook.json'),html=path.join(dir,'my notebook.html'),md=path.join(dir,'notes.md');
    assert.equal(run('init','--out',input).status,0);
    const check=run('check',input,'--json');assert.equal(check.status,1);assert.equal(JSON.parse(check.stdout).counts.unanswered,1);
    assert.equal(run('build',input,'--out',html).status,0);
    assert.equal(run('markdown',input,'--out',md).status,0);
    const before=await readFile(html);assert.equal(run('build',input,'--out',html).status,2);assert.deepEqual(await readFile(html),before);
    assert.equal(run('build',input,'--out',input).status,2);
    await writeFile(input,'{"version":1,"version":1}');assert.equal(run('check',input).status,2);
    await writeFile(input,Buffer.from([0xff]));assert.equal(run('check',input).status,2);
    assert.equal(run('check',dir).status,2);
    assert.equal(run('bogus').status,2);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('rejects a FIFO without waiting for a writer',{skip:process.platform==='win32'},async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'questionledger-fifo-'));
  try{
    const fifo=path.join(dir,'input.json');assert.equal(spawnSync('mkfifo',[fifo]).status,0);
    const result=spawnSync(process.execPath,[cli,'check',fifo],{encoding:'utf8',timeout:5000});
    assert.ifError(result.error);assert.equal(result.status,2);assert.match(result.stderr,/regular JSON/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
