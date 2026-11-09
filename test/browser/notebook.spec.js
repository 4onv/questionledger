import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { renderLedger } from '../../src/compiler.js';
const example=JSON.parse(await readFile(new URL('../../examples/notebook.json',import.meta.url),'utf8'));
const demo=pathToFileURL(fileURLToPath(new URL('../../dist/questionledger.html',import.meta.url))).href;
async function ready(page){await expect(page.locator('#announcement')).toHaveText('Notebook ready.');}
async function select(page,id){await page.locator(`[data-question-id="${id}"]`).click();await expect(page.locator('.detail-id')).toHaveText(id);}
async function review(page,id,text){await select(page,id);if(text)await page.locator('#answer-text').fill(text);await page.locator('#review-answer').click();await expect(page.locator('#question-detail .tag')).toHaveText('Reviewed');}
test('a changed fact invalidates its branch and retains parent context',async({page})=>{
  await page.goto(demo);await ready(page);
  await expect(page.locator('#count-reviewed')).toHaveText('3');
  await select(page,'Q3');await expect(page.locator('.context')).toContainText('Q1 · Where should draft notes live?');
  const fact=page.locator('[data-fact-id="F1"]');await fact.locator('[name="value"]').fill('Drafts now sync to a team server.');await fact.getByRole('button',{name:'Save fact',exact:true}).click();
  await expect(page.locator('#count-needs-review')).toHaveText('1');await expect(page.locator('#count-blocked')).toHaveText('3');
  await page.locator('#review-answer').click();await expect(page.locator('#error')).toBeVisible();
  await review(page,'Q1','Use team storage with an explicit server setup.');await review(page,'Q2');await review(page,'Q3');
  await expect(page.locator('#count-reviewed')).toHaveText('3');await expect(page.locator('#count-blocked')).toHaveText('1');
});
test('confirmation is tied to saved content; JSON and Markdown export work offline',async({page})=>{
  await page.goto(demo);await ready(page);
  const fact=page.locator('[data-fact-id="F3"]');await fact.locator('[name="status"]').selectOption('confirmed');await fact.locator('[name="value"]').fill('No analytics in version one.');await fact.getByRole('button',{name:'Save fact',exact:true}).click();
  await review(page,'Q4','Do not ship analytics in version one.');await review(page,'Q5','Test the release archive and downloaded HTML.');
  await page.locator('#confirm-button').click();await expect(page.locator('#confirmation-status')).toHaveText('Confirmed for current content');
  const saved=page.waitForEvent('download');await page.locator('#export-json').click();const download=await saved;
  const exported=JSON.parse(await readFile(await download.path(),'utf8'));expect(exported.confirmation).toMatch(/^[a-f0-9]{64}$/);
  const md=page.waitForEvent('download');await page.locator('#export-md').click();expect(await readFile(await (await md).path(),'utf8')).toContain('Q5');
  await page.locator('#answer-text').fill('Changed checklist.');await page.locator('#save-answer').click();await expect(page.locator('#confirmation-status')).toHaveText('Resolve open items before confirming');
  await page.locator('#import-file').setInputFiles({name:'saved.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
  await expect(page.locator('#confirmation-status')).toHaveText('Confirmed for current content');
});
test('new question and fact IDs stay distinct and invalid imports preserve current state',async({page})=>{
  await page.goto(demo);await ready(page);
  await page.locator('#new-fact').click();await page.locator('#new-label').fill('Browser support');await page.locator('#new-value').fill('Chromium and Firefox');await page.locator('#fact-form button[type="submit"]').click();
  await expect(page.locator('[data-fact-id="F4"]')).toBeVisible();
  await page.locator('#new-question').click();await page.locator('#new-prompt').fill('Which browsers need testing?');await page.locator('#question-form button[type="submit"]').click();
  await expect(page.locator('.detail-id')).toHaveText('Q6');await expect(page.locator('.context')).toContainText('Q1');
  const file={name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"version":1,"version":1}')};
  await page.locator('#import-file').setInputFiles(file);await expect(page.locator('#error')).toBeVisible();await expect(page.locator('#question-total')).toHaveText('6 ITEMS');
});
test('uncommitted question and fact edits survive navigation; exports require saving all forms',async({page})=>{
  await page.goto(demo);await ready(page);
  await page.locator('#answer-text').fill('Unsaved storage choice.');
  const fact=page.locator('[data-fact-id="F2"]');await fact.locator('[name="value"]').fill('Unsaved retention choice.');
  await select(page,'Q2');await select(page,'Q1');await expect(page.locator('#answer-text')).toHaveValue('Unsaved storage choice.');
  await page.locator('#export-json').click();await expect(page.locator('#error')).toContainText('Q1');await expect(page.locator('#error')).toContainText('F2');
  await page.locator('#save-answer').click();await expect(fact.locator('[name="value"]')).toHaveValue('Unsaved retention choice.');
  await page.locator('#export-json').click();await expect(page.locator('#error')).toContainText('F2');
  await fact.getByRole('button',{name:'Save fact',exact:true}).click();
  const saved=page.waitForEvent('download');await page.locator('#export-json').click();const output=JSON.parse(await readFile(await(await saved).path(),'utf8'));
  expect(output.questions[0].answer.text).toBe('Unsaved storage choice.');expect(output.facts[1].value).toBe('Unsaved retention choice.');
});
test('hostile imported text remains text, no external requests and mobile fits',async({page},testInfo)=>{
  const input=structuredClone(example);input.title='</script><img src="https://invalid.test/x" onerror="globalThis.pwned=1"> %%JS%%';
  input.questions[0].prompt='<svg onload="globalThis.pwned=1">';
  const file=testInfo.outputPath('hostile.html');await writeFile(file,await renderLedger(input));
  const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',req=>{if(/^https?:/.test(req.url()))requests.push(req.url());});
  await page.setViewportSize({width:360,height:800});await page.goto(pathToFileURL(file).href);await ready(page);
  await expect(page.locator('#ledger-title')).toHaveText(input.title);expect(await page.evaluate(()=>globalThis.pwned)).toBeUndefined();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);expect(requests).toEqual([]);
  await page.locator('#new-question').focus();await page.keyboard.press('Enter');await expect(page.locator('#new-prompt')).toBeFocused();await page.keyboard.press('Escape');await expect(page.locator('#question-dialog')).not.toBeVisible();
});
