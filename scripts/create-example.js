// Synthetic demonstration data: no real team decisions or user records.
import { writeFile } from 'node:fs/promises';
import { reviewAnswer } from '../src/core.js';
let ledger={version:1,title:'Ship a private team notebook',description:'Synthetic demonstration · Explore how a changed fact affects a chain of answers.',facts:[
  {id:'F1',label:'Draft storage',status:'confirmed',value:'Drafts stay in browser memory. There is no hosted sync.'},
  {id:'F2',label:'Retention plan',status:'confirmed',value:'People retain notes by explicitly saving a JSON file.'},
  {id:'F3',label:'Analytics decision',status:'pending',value:'The team has not decided whether to include anonymous metrics.'}
],questions:[
  {id:'Q1',parentId:null,prompt:'Where should draft notes live?',dependsOn:['F1'],answer:null},
  {id:'Q2',parentId:'Q1',prompt:'How will people retain their notes?',dependsOn:['F2'],answer:null},
  {id:'Q3',parentId:'Q2',prompt:'What should an exported notebook include?',dependsOn:[],answer:null},
  {id:'Q4',parentId:null,prompt:'Should analytics ship in the first release?',dependsOn:['F3'],answer:{text:'Proposal: leave analytics out until the team decides.',reviewedAgainst:null}},
  {id:'Q5',parentId:null,prompt:'What belongs in the release checklist?',dependsOn:[],answer:null}
],confirmation:null};
ledger=await reviewAnswer(ledger,'Q1','Keep drafts in this browser tab, with no account or hosted storage.');
ledger=await reviewAnswer(ledger,'Q2','Offer a visible Save JSON button and remind people to save before closing.');
ledger=await reviewAnswer(ledger,'Q3','Include stable question IDs, parent links, recorded facts and review fingerprints.');
await writeFile(new URL('../examples/notebook.json',import.meta.url),JSON.stringify(ledger,null,2)+'\n');
