import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { renderLedger } from '../src/compiler.js';
const ledger=JSON.parse(await readFile(new URL('../examples/notebook.json',import.meta.url),'utf8'));
await mkdir(new URL('../dist/',import.meta.url),{recursive:true});
const html=await renderLedger(ledger);
await writeFile(new URL('../dist/questionledger.html',import.meta.url),html);
console.log(`Built standalone synthetic notebook (${Buffer.byteLength(html)} bytes).`);
