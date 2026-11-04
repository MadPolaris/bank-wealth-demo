import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileTree} from '../../metarch-truthsrc/lib/compile.mjs';
import {compileProductSet} from '../../metarch-truthsrc/lib/products/compile.mjs';
import {readProductRequest} from '../../metarch-truthsrc/lib/products/cli.mjs';
import {bankServiceRequest} from '../tools/v1-service-inputs.mjs';
import {bankApplicationRequest,V1_TREE} from '../tools/v1-inputs.mjs';

test('service source and historical application inputs are explicit separate complete versions',()=>{
 const current=JSON.parse(compileTree(V1_TREE)),request=bankServiceRequest();
 assert.deepEqual(request.documents.find(d=>d.id==='bank-v1').value,current);
 const captured=readProductRequest(new URL('../v1/formal-inputs/release-pages-721/files.json',import.meta.url).pathname);
 assert.deepEqual(captured,request);
 const previous=readProductRequest(new URL('../v1/formal-inputs/release-service-631/files.json',import.meta.url).pathname);
 const priorService=previous.documents.find(d=>d.id==='bank-v1').value.artifactContracts.find(a=>a.id==='bank-service').deployment.service;
 assert.ok(!Object.hasOwn(priorService,'pages'));
 const pages=current.artifactContracts.find(a=>a.id==='bank-service').deployment.service.pages;
 assert.equal(pages.aliases.length,14);
 assert.equal(pages.shellPath,'/bank/v1');
 assert.equal(pages.renderer.id,'example.bankwealth.web.BankBrowserPages');
 assert.deepEqual(compileProductSet(previous).diagnostics,[]);
 const result=compileProductSet(request);assert.deepEqual(result.diagnostics,[]);assert.equal(result.result.products.length,14);
 for(const [id,version] of [['artifact-contract','3'],['saga-host-contract','2'],['effect-host-contract','2']]) assert.equal(result.result.products.find(p=>p.id===id).version,version);
 const old=bankApplicationRequest({historical:true});assert.ok(!old.documents.find(d=>d.id==='bank-v1').value.artifactContracts.some(a=>a.deployment.service));
 assert.deepEqual(compileProductSet(old).diagnostics,[]);
});

test('service nominal commands retain exact request sources and ordered original schedules without exposing machine actions',()=>{
 const request=bankServiceRequest(),source=request.documents.find(d=>d.id==='bank-v1').value;
 const order=source.aggregates.find(a=>a.name==='FundOrder'),plan=source.aggregates.find(a=>a.name==='SipPlan');
 assert.ok(order.commands.some(c=>c.name==='RecordCashRequestSource'));
 assert.ok(plan.commands.some(c=>c.name==='RecordSipCreateIntent'));
 const service=source.artifactContracts.find(a=>a.id==='bank-service').deployment.service;
 assert.equal(service.endpoints.length,14);
 assert.ok(!service.endpoints.some(e=>/seed|ta-receipt|refund/.test(e.path)));
 assert.ok(service.endpoints.filter(e=>e.method==='POST').every(e=>e.csrf));
 const intent=source.valueObjects.find(v=>v.name==='BankSipCreate');
 assert.deepEqual(intent.fields.find(f=>f.name==='dueSlots'),{name:'dueSlots',dataType:'Vector[Long]'});
 assert.equal(readFileSync(new URL('../v1/integration/CONTRACT.md',import.meta.url),'utf8').includes('BankTrustedAdmission'),true);
});
