import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { viewProject } from '../../metarch-truthsrc/lib/project/view.mjs';
import { renderWorkshop } from '../../metarch-truthsrc/lib/workshop/render.mjs';
import { captureProductJson } from '../../metarch-truthsrc/lib/products/cli.mjs';
import { reportWorkshop } from './bank-workshop-verification.mjs';
import { ROOT, captureCurrent, checkedPath, fileReference, newRunPath, readJson, sha256, within } from './bank-workshop-supply.mjs';

export function attachWorkshopEvidence(view, report) {
  assert.equal(report.schemaVersion, 'bank.workshop-report/v1');
  assert.equal(view.snapshot.source, report.snapshot, 'report uses another author snapshot');
  assert.equal(view.snapshot.codeDigest, report.codeDigest, 'report uses another generated source set');
  const stage = id => report.stages.find(row => row.id === id);
  const status = id => {
    const row = stage(id);
    return row?.status === 'passed' && row.rechecked ? 'passed' : row?.status === 'failed' ? 'failed'
      : row?.status === 'blocked' || row?.status === 'passed' ? 'blocked' : 'not-run';
  };
  return { ...view, evidence: [
    { id: 'anchors', label: '真源 · 知识图 · 回锚', status: status('anchors'), scope: '当前候选完整映射与最终字节',
      summary: `${view.verification.counts.files}份源码/配置；${view.verification.counts.spans}个精确区间。来源绑定报告已复核。` },
    { id: 'code', label: '代码构建与固定业务测试', status: status('code'), scope: '独占候选、固定actor/readside suite；不相加重叠测试',
      summary: status('code') === 'passed' ? '本次真实构建、固定业务和读侧测试通过，实际staging已核对。' : '本次尚无可复核的全部代码测试通过证据。' },
    { id: 'service', label: '银行业务服务', status: status('service'), scope: '当前代码的HTTP/权限/数据库/浏览器/固定恢复窗和退出',
      summary: status('service') === 'passed' ? '本次来源绑定的完整服务窗口及资源退出已通过。' : '未完成本次服务验收；没有借用历史发行或旧回执。' },
  ], receipt: { checkedAt: report.checkedAt, executionKind: report.executionKind, through: report.through,
    fullPipelinePassed: report.fullPipelinePassed, diagnostics: report.diagnostics },
  limitations: [...view.limitations, '验收卡是本次只读复核的快照，不是在线监控。材料交付与真人可用性另行验收。'] };
}

export async function exportWorkshopView({ run, html }) {
  newRunPath(run, ROOT, true); checkedPath(html, 'planned');
  assert.ok(html.endsWith('.html') && within(join(ROOT, 'target'), html) && !within(run, html), 'new HTML must be in bank target/ outside the evidence run');
  const current = await captureCurrent(), indexRef = await fileReference(join(run, 'results.json'));
  const index = readJson(indexRef.file), report = await reportWorkshop({ run });
  assert.ok(report.stages.find(row => row.id === 'anchors')?.rechecked, 'source/anchor evidence must still be verified');
  const candidate = index.candidates.find(row => row.mode === 'actor') ?? index.candidates.find(row => row.mode === 'anchors');
  assert.ok(candidate, 'an anchor-verified generated candidate is required');
  const config = captureProductJson(join(ROOT, 'docs/bank-workshop-tour.json')).value;
  const view = attachWorkshopEvidence(viewProject({ project: index.project, out: candidate.output, config }), report);
  assert.deepEqual(await fileReference(indexRef.file), indexRef, 'run changed during view export');
  assert.deepEqual(await captureCurrent(), current, 'project changed during view export');
  const content = renderWorkshop(view); writeFileSync(html, content, { flag: 'wx', mode: 0o600 });
  return { schemaVersion: 'bank.workshop-view/v1', passed: true, file: html, url: pathToFileURL(html).href,
    bytes: Buffer.byteLength(content), sha256: sha256(content), codeDigest: report.codeDigest,
    fullPipelinePassed: report.fullPipelinePassed, runtimeVerified: report.fullPipelinePassed };
}
