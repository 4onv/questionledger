import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateLedger } from './core.js';

const source = name => readFile(new URL(name, import.meta.url), 'utf8').then(text => text.replace(/\r\n/g, '\n'));
const hash = text => createHash('sha256').update(text).digest('base64');
export async function renderLedger(input) {
  const ledger = validateLedger(input);
  const [template, css, core, parser, app] = await Promise.all(['page.html','style.css','core.js','parse-json.js','app.js'].map(source));
  const data = JSON.stringify(ledger).replace(/[<>&\u2028\u2029]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4,'0'));
  const api = ['validateLedger','analyzeLedger','setAnswer','reviewAnswer','updateFact','confirmLedger','toMarkdown'];
  const script = `(()=>{\n'use strict';\nconst {${api.join(',')}}=(()=>{\n${core.replace(/^export /gm,'')}\nreturn {${api.join(',')}};})();\nconst parseJson=(()=>{\n${parser.replace(/^export /gm,'')}\nreturn parseJson;})();\n${app}\n})();`;
  if (/<\/script/i.test(script) || /<\/style/i.test(css)) throw Error('Unexpected template closing tag in source.');
  const csp = `default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(css)}'; connect-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const parts = {CSP:csp,CSS:css,DATA:data,JS:script};
  return template.replace(/%%(CSP|CSS|DATA|JS)%%/g, (_match, key) => parts[key]);
}
