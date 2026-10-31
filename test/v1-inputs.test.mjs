import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compileTree} from '../../metarch-truthsrc/lib/compile.mjs';
import {compileProductSet} from '../../metarch-truthsrc/lib/products/compile.mjs';
import {readProductRequest} from '../../metarch-truthsrc/lib/products/cli.mjs';
import {generate} from '../../metarch-truthsrc/generators/scala-cqrs-effect-application-v2/generate.mjs';
import {bankApplicationRequest,V1_TREE} from '../tools/v1-inputs.mjs';
const file=flow=>new URL('../v1/formal-inputs/'+flow+'-376/files.json',import.meta.url).pathname;
test('four historical bank flow requests keep their complete frozen source and distinct entry obligations',()=>{
 const tree=readProductRequest(file('payment')).documents.find(d=>d.id==='bank-v1').value,expected={payment:'bank-cash-payment-v1',refund:'bank-independent-refund-v1',ta:'bank-ta-submission-v1',sip:'bank-sip-dispatch-v1'};
 for(const [flow,pipeline] of Object.entries(expected)){
  const request=readProductRequest(file(flow));
  assert.deepEqual(request.documents.find(d=>d.id==='bank-v1').value,tree);
  const scope=JSON.parse(fs.readFileSync(new URL('../v1/formal-inputs/'+flow+'-376/scope.json',import.meta.url)));
  assert.equal(scope.flow,flow);assert.equal(scope.pipeline,pipeline);assert.ok(scope.requiredOracles.length);
  assert.equal(scope.runtimeVerified,false);
 }
 assert.deepEqual(readProductRequest(file('sip')),bankApplicationRequest());
});
test('complete bank contracts reject amount, owner, source guard and authority signature mutations before plans',()=>{
 const input=readProductRequest(file('sip'));
 for(const change of [
  r=>{r.documents.find(d=>d.id==='types').value.types.find(t=>t.domain.id==='Money').precision=37;},
  r=>{r.documents.find(d=>d.id==='bank-v1').value.aggregates.find(a=>a.name==='FundOrder').commands.find(c=>c.name==='RecordFundRefundSucceeded').guards.reverse();},
  r=>{r.documents.find(d=>d.id==='artifacts').value.artifacts.artifacts[0].status='historical';},
  r=>{r.documents.find(d=>d.id==='hosts').value.hosts.hosts[0].association.originalInputs.pop();},
 ]){
  const request=structuredClone(input);change(request);const result=compileProductSet(request);assert.equal(result.result,null);assert.ok(result.diagnostics.length);
 }
 const result=compileProductSet(input);assert.deepEqual(result.diagnostics,[]);assert.equal(result.result.products.length,14);
 const manifest=JSON.parse(fs.readFileSync(new URL('../../metarch-truthsrc/generators/scala-cqrs-effect-application-v2/generator.json',import.meta.url)));
 const options=JSON.parse(fs.readFileSync(new URL('../v1/formal-inputs/sip-376/options.json',import.meta.url)));
 const plan=generate({compilation:result,manifest,options});assert.deepEqual(plan.diagnostics,[]);
 assert.ok(plan.plan.entries.some(e=>e.path.endsWith('bank_sip_dispatchEffectHost.scala')));
 assert.ok(plan.plan.entries.some(e=>e.path.endsWith('bank_refund_hostHost.scala')));
});
