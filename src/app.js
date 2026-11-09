const $ = id => document.getElementById(id);
const labels = {'needs-review':'Needs review',reviewed:'Reviewed',blocked:'Blocked',unanswered:'Unanswered'};
let ledger, analysis, selected, busy = false;
const drafts=new Map();
function captureDrafts() {
  if(!ledger)return;
  const q=ledger.questions.find(q=>q.id===selected),prompt=$('question-prompt'),answer=$('answer-text');
  if(q&&prompt&&answer){
    const draft={prompt:prompt.value,text:answer.value,dependsOn:[...document.querySelectorAll('[name="fact-dependency"]:checked')].map(el=>el.value)};
    const differs=draft.prompt!==q.prompt||draft.text!==(q.answer?.text??'')||JSON.stringify(draft.dependsOn)!==JSON.stringify(q.dependsOn);
    if(differs)drafts.set('q:'+q.id,draft);else drafts.delete('q:'+q.id);
  }
  for(const form of document.querySelectorAll('[data-fact-id]')){
    const fact=ledger.facts.find(f=>f.id===form.dataset.factId);
    const draft={label:form.elements.label.value,value:form.elements.value.value,status:form.elements.status.value};
    if(Object.keys(draft).some(key=>draft[key]!==fact[key]))drafts.set('f:'+fact.id,draft);else drafts.delete('f:'+fact.id);
  }
}
function restoreDrafts() {
  const q=drafts.get('q:'+selected);
  if(q&&$('question-prompt')){$('question-prompt').value=q.prompt;$('answer-text').value=q.text;document.querySelectorAll('[name="fact-dependency"]').forEach(el=>el.checked=q.dependsOn.includes(el.value));}
  for(const form of document.querySelectorAll('[data-fact-id]')){const draft=drafts.get('f:'+form.dataset.factId);if(draft)for(const key of Object.keys(draft))form.elements[key].value=draft[key];}
  $('storage-note').textContent=drafts.size?`${drafts.size} unsaved form draft(s). Save draft, review the answer, or save the fact before exporting. Drafts stay only in this tab.`:'Edits stay in this tab. Save JSON before closing. Reopening the HTML starts its original notebook.';
}
function dom(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function tag(status) { return dom('span',labels[status] ?? status,'tag '+status); }
function field(labelText, input) {
  const label = dom('label',labelText); label.append(input); return label;
}
function area(value, rows, maximum) {
  const input = dom('textarea'); input.value=value; input.rows=rows; input.maxLength=maximum; return input;
}
function announce(message) { $('announcement').textContent=message; }
async function act(action, message, requireSaved=false) {
  if (busy) return;
  captureDrafts();
  busy=true; $('error').hidden=true;
  document.querySelectorAll('button,input,textarea,select').forEach(node=>node.disabled=true);
  try {
    if(requireSaved&&drafts.size)throw Error('Save your form drafts before exporting, confirming or opening another notebook. Unsaved items: '+[...drafts.keys()].map(key=>key.slice(2)).join(', '));
    await action(); analysis=await analyzeLedger(ledger);
    render();restoreDrafts(); if(message) announce(message);
  } catch(error) {
    $('error').textContent=String(error.message ?? 'Operation failed.'); $('error').hidden=false;
  } finally {
    busy=false;
    document.querySelectorAll('button,input,textarea,select').forEach(node=>node.disabled=false);
    $('confirm-button').disabled=!analysis?.ready || analysis?.confirmed;
  }
}
function replaceLedger(next) { ledger=validateLedger({...next,confirmation:null}); }
function nextId(prefix) { const used=new Set([...ledger.questions,...ledger.facts].map(row=>row.id)); let i=1; while(used.has(prefix+i))i++;return prefix+i; }
function download(name, content, type) {
  const url=URL.createObjectURL(new Blob([content],{type})); const link=dom('a'); link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function render() {
  $('ledger-title').textContent=ledger.title; $('ledger-description').textContent=ledger.description;
  for(const status of Object.keys(labels)) $('count-'+status).textContent=analysis.counts[status];
  $('confirmation-status').textContent=analysis.confirmed?'Confirmed for current content':analysis.ready?'All recorded items are ready for confirmation':'Resolve open items before confirming';
  $('question-total').textContent=ledger.questions.length+' ITEMS'; $('fact-total').textContent=ledger.facts.length+' FACTS';
  if(!ledger.questions.some(q=>q.id===selected))selected=ledger.questions[0]?.id;
  const tree=$('question-tree');tree.replaceChildren();
  function branch(parentId,depth) {
    for(const q of ledger.questions.filter(q=>q.parentId===parentId)) {
      const state=analysis.questions.find(s=>s.id===q.id);
      const button=dom('button',undefined,'question-row'+(q.id===selected?' active':'')+(depth?' child':'')+(depth>1?' depth-2':''));
      button.type='button';button.dataset.questionId=q.id;button.setAttribute('aria-current',q.id===selected?'true':'false');
      button.append(dom('span',q.id,'q-id'),tag(state.status),dom('span',q.prompt,'q-prompt'));
      button.addEventListener('click',()=>act(()=>{selected=q.id;},'Selected '+q.id));tree.append(button);branch(q.id,depth+1);
    }
  }
  branch(null,0); renderQuestion();renderFacts();
}
function renderQuestion() {
  const target=$('question-detail'); target.replaceChildren();
  const question=ledger.questions.find(q=>q.id===selected);
  if(!question) {target.append(dom('h2','Start with a question'),dom('p','Add a question and record the facts its answer depends on.','panel-hint'));return;}
  const state=analysis.questions.find(s=>s.id===question.id);
  const head=dom('div',undefined,'detail-top');head.append(dom('span',question.id,'detail-id'),tag(state.status));target.append(head);
  if(state.ancestorIds.length) {
    const context=dom('div',undefined,'context');context.append(dom('strong','PARENT CONTEXT'));
    for(const id of state.ancestorIds) {const ancestor=ledger.questions.find(q=>q.id===id);context.append(dom('p',id+' · '+ancestor.prompt),dom('p',ancestor.answer?.text || 'No recorded answer.'));}
    target.append(context);
  }
  const prompt=area(question.prompt,3,4000);prompt.id='question-prompt';target.append(field('Question',prompt));
  const answer=area(question.answer?.text ?? '',5,8000);answer.id='answer-text';answer.placeholder='Record an answer, or keep a proposal as a draft.';target.append(field('Recorded answer',answer));
  const deps=dom('fieldset',undefined,'deps');deps.append(dom('legend','This answer depends on'));
  for(const fact of ledger.facts) {
    const check=dom('input');check.type='checkbox';check.value=fact.id;check.name='fact-dependency';check.checked=question.dependsOn.includes(fact.id);
    const label=dom('label');label.append(check,dom('span',fact.id+' · '+fact.label));deps.append(label);
  }
  if(!ledger.facts.length)deps.append(dom('p','No facts recorded yet.','small-note'));target.append(deps);
  const contextNote=dom('p','Parent questions and their declared facts also affect this answer.','small-note');target.append(contextNote);
  if(state.reasons.length){const reasons=dom('ul',undefined,'reasons');for(const reason of state.reasons)reasons.append(dom('li',reason));target.append(reasons);}
  const edited=()=>{const next=structuredClone(ledger);const q=next.questions.find(item=>item.id===question.id);q.prompt=prompt.value;q.dependsOn=[...deps.querySelectorAll('input:checked')].map(input=>input.value);next.confirmation=null;return validateLedger(next);};
  const buttons=dom('div',undefined,'detail-actions');
  const draft=dom('button','Save draft','secondary');draft.id='save-answer';draft.type='button';draft.addEventListener('click',()=>act(()=>{ledger=setAnswer(edited(),question.id,answer.value);drafts.delete('q:'+question.id);},'Draft saved for '+question.id));
  const review=dom('button','Review this answer','primary');review.id='review-answer';review.type='button';review.addEventListener('click',()=>act(async()=>{ledger=await reviewAnswer(edited(),question.id,answer.value);drafts.delete('q:'+question.id);},'Answer reviewed for '+question.id));
  buttons.append(draft,review);target.append(buttons,dom('p','Review records your acknowledgement of the current declared context. It does not judge whether the answer is correct.','small-note'));
}
function renderFacts() {
  const list=$('fact-list');list.replaceChildren();
  for(const fact of ledger.facts) {
    const form=dom('form',undefined,'fact-card');form.dataset.factId=fact.id;
    const head=dom('div',undefined,'fact-head');head.append(dom('span',fact.id),dom('span',fact.status==='pending'?'Pending':'Confirmed','tag '+(fact.status==='pending'?'blocked':'reviewed')));form.append(head);
    const name=dom('input');name.value=fact.label;name.maxLength=200;name.required=true;name.name='label';form.append(field('Label',name));
    const value=area(fact.value,3,8000);value.name='value';form.append(field('Recorded value',value));
    const status=dom('select');status.name='status';for(const [id,label] of [['pending','Pending investigation'],['confirmed','Confirmed by you']]){const option=dom('option',label);option.value=id;status.append(option);}status.value=fact.status;form.append(field('Status',status));
    const affected=analysis.questions.filter(q=>q.effectiveFactIds.includes(fact.id)).map(q=>q.id);
    form.append(dom('p',affected.length?'Used by '+affected.join(', '):'No question currently declares this fact.','fact-impact'));
    const save=dom('button','Save fact','secondary');save.type='submit';form.append(save);
    form.addEventListener('submit',event=>{event.preventDefault();act(()=>{ledger=updateFact(ledger,fact.id,{label:name.value,status:status.value,value:value.value});drafts.delete('f:'+fact.id);},'Fact '+fact.id+' saved; answer status recalculated.');});list.append(form);
  }
}
$('export-json').addEventListener('click',()=>act(()=>download('questionledger.json',JSON.stringify(ledger,null,2)+'\n','application/json'),'Notebook JSON saved.',true));
$('export-md').addEventListener('click',()=>act(async()=>download('questionledger.md',await toMarkdown(ledger),'text/markdown'),'Markdown exported.',true));
$('confirm-button').addEventListener('click',()=>act(async()=>{ledger=await confirmLedger(ledger);},'Notebook confirmed for its current content.',true));
$('import-button').addEventListener('click',()=>$('import-file').click());
$('import-file').addEventListener('change',()=>{
  const file=$('import-file').files[0];$('import-file').value='';
  act(async()=>{
  if(!file)return;
  if(file.size>1024*1024)throw Error('JSON import exceeds 1 MiB.');
  const next=validateLedger(parseJson(new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer())));
  await analyzeLedger(next); ledger=next;selected=ledger.questions[0]?.id;$('import-file').value='';
},'Notebook opened.',true);});
$('new-question').addEventListener('click',()=>{
  const select=$('new-parent');select.replaceChildren();const none=dom('option','Top-level question');none.value='';select.append(none);
  for(const q of ledger.questions){const option=dom('option',q.id+' · '+q.prompt);option.value=q.id;select.append(option);}
  select.value=selected ?? '';$('new-prompt').value='';$('question-dialog').showModal();$('new-prompt').focus();
});
$('new-fact').addEventListener('click',()=>{$('fact-form').reset();$('fact-dialog').showModal();$('new-label').focus();});
document.querySelectorAll('.close-dialog').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
document.addEventListener('input',event=>{if(event.target.closest('#question-detail,#fact-list')){captureDrafts();restoreDrafts();}});
$('question-form').addEventListener('submit',event=>{event.preventDefault();act(()=>{
  const id=nextId('Q');replaceLedger({...ledger,questions:[...ledger.questions,{id,parentId:$('new-parent').value||null,prompt:$('new-prompt').value,dependsOn:[],answer:null}]});selected=id;$('question-dialog').close();
},'Question added.');});
$('fact-form').addEventListener('submit',event=>{event.preventDefault();act(()=>{
  const id=nextId('F');replaceLedger({...ledger,facts:[...ledger.facts,{id,label:$('new-label').value,status:$('new-status').value,value:$('new-value').value}]});$('fact-dialog').close();
},'Fact added.');});
act(async()=>{
  if(!globalThis.crypto?.subtle)throw Error('This browser needs Web Crypto for context fingerprints. Open this file in a current Chromium or Firefox browser.');
  ledger=validateLedger(parseJson($('initial-ledger').textContent));selected=ledger.questions[0]?.id;
},'Notebook ready.');
