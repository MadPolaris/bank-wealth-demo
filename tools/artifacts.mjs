import { declarationIndex, sha256, STAGE_CODE, slug, NOTE_TYPES, ATOM_KINDS } from './truth-source.mjs';

export const CATEGORIES = ['event-flow', 'actor-command-map', 'timer', 'aggregate-boundary', 'subdomain', 'context',
  'context-map', 'traceability', 'mock-ta', 'decision', 'ux-strategy', 'ux-scope', 'ux-structure', 'ux-skeleton', 'ux-surface'];

export function extractArtifacts(snapshot) {
  return snapshot.atoms.filter(({ doc }) => doc.kind === 'note' && doc.payload?.info?.artifact)
    .map(({ doc, file }) => ({ ...doc.payload.info.artifact,
      source: { file: `tree/${file}`, pointer: '/payload/info/artifact', stage: doc.origin.stage,
        board: doc.origin.board, seq: doc.origin.seq, note: `${doc.type}:${doc.name}` },
    })).sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

const fields = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
const eventName = (value) => typeof value === 'string' ? value : value?.name;
function walk(value, visitor, path = '') {
  if (!value || typeof value !== 'object') return;
  visitor(value, path);
  for (const [key, child] of Object.entries(value)) if (child && typeof child === 'object') walk(child, visitor, `${path}/${key}`);
}

export function validateDeclarations(snapshot) {
  const errors = [], notices = [];
  const fail = (message) => errors.push(message);
  const index = declarationIndex(snapshot.canonical);
  const allEvents = (name) => [...index.entries()].filter(([key]) => key.startsWith('event:') && key.slice(6).endsWith(`.${name}`));
  const checkEvent = (name, where) => {
    const matches = allEvents(name);
    if (!matches.length) fail(`${where}: unknown event ${name}`);
    if (matches.length > 1) notices.push(`${where}: unqualified event ${name} has ${matches.length} owners; namespace evolution remains pending.`);
    return matches;
  };
  const captureAddresses = new Set();
  for (const { doc, file } of snapshot.atoms) {
    if (file === 'workshop.yaml') continue;
    if (!ATOM_KINDS.includes(doc.kind)) fail(`${file}: unsupported atom kind ${doc.kind}`);
    if (doc.kind === 'note') {
      if (!NOTE_TYPES.includes(doc.type)) fail(`${file}: unsupported note type ${doc.type}`);
      const address = `${doc.origin.stage}/${doc.origin.board}/${doc.origin.seq}`;
      if (captureAddresses.has(address)) fail(`${file}: duplicate capture address ${address}`);
      captureAddresses.add(address);
      const expected = `${doc.type}-${STAGE_CODE[doc.origin.stage]}-${slug(doc.name)}-${doc.origin.seq}.yaml`;
      if (file.split('/').at(-1) !== expected) fail(`${file}: filename must derive from identity: ${expected}`);
      const original = doc.payload?.sourceCapture?.atom;
      if (original?.origin && doc.origin.seq !== original.origin.seq) fail(`${file}: imported numerical capture position changed`);
    }
  }
  for (const aggregate of snapshot.canonical.aggregates || []) {
    const ruleMap = new Map((aggregate.aggregateRuleRefs || []).map((rule) => [rule.ruleId, rule]));
    for (const command of aggregate.commands || []) {
      for (const produced of command.produces || []) {
        const name = eventName(produced);
        if (!index.has(`event:${aggregate.name}.${name}`)) fail(`${aggregate.name}.${command.name}: produced event ${name} has no local definition`);
      }
      for (const guard of command.guards || []) {
        const ruleId = guard.ruleId || guard.ref;
        const rule = ruleMap.get(ruleId);
        if (!rule) fail(`${aggregate.name}.${command.name}: unregistered rule ${ruleId}`);
        else if (String(rule.errCode) !== String(guard.errCode)) fail(`${aggregate.name}.${command.name}: rule/error mismatch ${ruleId}`);
        const transition = guard.statusTransition || (guard.kind === 'statusTransition' ? { from: guard.from, to: guard.toStatus } : null);
        if (transition) {
          if (!Array.isArray(transition.from) || !transition.from.length) fail(`${aggregate.name}.${command.name}: lifecycle gate needs explicit from states`);
          for (const state of [...(transition.from || []), ...(transition.to ? [transition.to] : [])]) {
            if (!(aggregate.statusEnum || []).includes(state)) fail(`${aggregate.name}.${command.name}: unknown lifecycle state ${state}`);
          }
        }
      }
    }
    for (const field of aggregate.stateFields || []) for (const writer of fields(field.writtenBy)) {
      const dot = writer.lastIndexOf('.');
      const name = dot < 0 ? writer : writer.slice(0, dot);
      const event = index.get(`event:${aggregate.name}.${name}`);
      if (!event) fail(`${aggregate.name}.${field.name}: unknown writtenBy event ${name}`);
      else if (dot >= 0 && !event.payloads?.some((slot) => slot.name === writer.slice(dot + 1))) fail(`${aggregate.name}.${field.name}: unknown writtenBy slot ${writer}`);
    }
    for (const event of aggregate.events || []) for (const fold of event.foldAssignments || []) {
      if (!index.has(`state-field:${aggregate.name}.${fold.slot}`)) fail(`${aggregate.name}.${event.name}: fold targets nonexistent state ${fold.slot}`);
      for (const value of [fold.expr, fold.key, fold.value, fold.delta]) {
        if (typeof value !== 'string') continue;
        if (/\bparam\./.test(value)) fail(`${aggregate.name}.${event.name}: event fold depends on vanished command input ${value}`);
        for (const match of value.matchAll(/\bevent\.([A-Za-z_][A-Za-z_0-9]*)/g)) {
          if (!index.has(`event-field:${aggregate.name}.${event.name}.${match[1]}`)) fail(`${aggregate.name}.${event.name}: fold references missing event slot ${match[1]}`);
        }
      }
    }
  }
  for (const view of snapshot.canonical.readModels || []) {
    for (const field of view.fields || []) {
      if (field.source === 'aggregateIdentity') continue;
      const match = /^eventField:(.+)\.([^.]+)$/.exec(field.source || '');
      if (!match) { fail(`${view.name}.${field.name}: unrecognized source ${field.source}`); continue; }
      const events = checkEvent(match[1], `${view.name}.${field.name}`);
      const slots = events.flatMap(([, event]) => (event.payloads || []).filter((slot) => slot.name === match[2]));
      if (!slots.length) fail(`${view.name}.${field.name}: missing actual event slot ${field.source}`);
      else if (!slots.some((slot) => slot.dataType === field.dataType)) fail(`${view.name}.${field.name}: source type differs from ${field.dataType}`);
      if (!(view.consumesEvents || []).includes(match[1])) fail(`${view.name}.${field.name}: source event ${match[1]} is not consumed`);
    }
    for (const event of view.consumesEvents || []) checkEvent(event, view.name);
  }
  for (const story of snapshot.canonical.stories || []) {
    if (!index.has(`aggregate:${story.aggregate}`)) fail(`${story.name}: unknown aggregate ${story.aggregate}`);
    if (!index.has(`role:${story.role}`)) fail(`${story.name}: unknown role ${story.role}`);
    const slices = fields(story.slices);
    for (const slice of slices) {
      if (slice.command && !index.has(`command:${story.aggregate}.${slice.command}`)) fail(`${story.name}: unknown command ${slice.command}`);
      for (const event of slice.events || []) checkEvent(event, story.name);
      for (const view of slice.readModels || []) if (!index.has(`read-model:${view}`)) fail(`${story.name}: unknown read model ${view}`);
    }
  }
  for (const useCase of snapshot.canonical.useCases?.useCases || []) {
    for (const step of useCase.steps || []) {
      if (!index.has(`command:${step.aggregate}.${step.command}`)) fail(`${useCase.useCase}: unknown step command ${step.aggregate}.${step.command}`);
      if (step.story && !index.has(`story:${step.story}`)) fail(`${useCase.useCase}: unknown story ${step.story}`);
      for (const event of step.emissions || []) {
        const command = index.get(`command:${step.aggregate}.${step.command}`);
        if (!(command?.produces || []).map(eventName).includes(event)) fail(`${useCase.useCase}: ${step.command} does not emit ${event}`);
      }
    }
    for (const condition of useCase.preconditions || []) {
      const aggregate = index.get(`aggregate:${condition.aggregate}`);
      const rule = aggregate?.aggregateRuleRefs?.find((entry) => entry.ruleId === condition.invariantRef);
      if (!rule || String(rule.errCode) !== String(condition.errCode)) fail(`${useCase.useCase}: incorrect precondition rule ${condition.invariantRef}/${condition.errCode}`);
    }
  }
  return { errors, notices };
}

export function validateArtifacts(snapshot, artifacts = extractArtifacts(snapshot)) {
  const errors = [], notices = [];
  const fail = (message) => errors.push(message);
  const index = declarationIndex(snapshot.canonical);
  const artifactIds = new Set(), entityIds = new Set(), entityRecords = new Map();
  for (const artifact of artifacts) {
    if (typeof artifact.id !== 'string' || !artifact.id) fail('Artifact needs stable nonempty id');
    if (artifactIds.has(artifact.id)) fail(`Duplicate artifact id ${artifact.id}`);
    artifactIds.add(artifact.id);
    if (!CATEGORIES.includes(artifact.category)) fail(`${artifact.id}: unsupported category ${artifact.category}`);
    if (artifact.status !== 'demo-proposal') fail(`${artifact.id}: design proposal cannot be certified executable/runtime`);
    if (!artifact.provenance || artifact.provenance.workshopHeld !== false) fail(`${artifact.id}: truthful proposal provenance must not claim a held workshop`);
    for (const entity of artifact.body?.entities || []) {
      if (typeof entity.id !== 'string' || !entity.id || entityIds.has(entity.id) || artifactIds.has(entity.id)) fail(`${artifact.id}: missing/duplicate entity identity ${entity.id}`);
      entityIds.add(entity.id);
      entityRecords.set(entity.id, entity);
    }
  }
  for (const id of entityIds) if (artifactIds.has(id)) fail(`Identity collision between entity and artifact ${id}`);
  const hasEntity = (id) => entityIds.has(id) || artifactIds.has(id);
  const resolves = (kind, id) => kind === 'artifact' ? artifactIds.has(id) : kind === 'entity' ? hasEntity(id) : index.has(`${kind}:${id}`);
  const typed = (id, kind) => entityRecords.get(id)?.kind === kind;
  const actionTargets = new Map();
  for (const artifact of artifacts) for (const screen of artifact.body?.screens || []) for (const action of screen.actions || []) {
    if (action.targetScreenId) actionTargets.set(action.id, action.targetScreenId);
  }
  for (const artifact of artifacts) {
    for (const node of artifact.body?.nodes || []) {
      if (typeof node.id !== 'string' || !node.id || !hasEntity(node.id)) fail(`${artifact.id}: unregistered projection node ${node.id}`);
    }
    for (const screen of artifact.body?.screens || []) {
      if (!typed(screen.id, 'screen')) fail(`${artifact.id}: screen record has wrong identity type ${screen.id}`);
      for (const action of screen.actions || []) if (!typed(action.id, 'action')) fail(`${artifact.id}: action record has wrong identity type ${action.id}`);
    }
    for (const journey of artifact.body?.journeys || []) {
      if (!typed(journey.id, 'journey')) fail(`${artifact.id}: journey record has wrong identity type ${journey.id}`);
      for (const step of journey.steps || []) {
        if (!typed(step.id, 'stage')) fail(`${artifact.id}: journey step has wrong identity type ${step.id}`);
        const kind = entityRecords.get(step.action)?.kind;
        if (!['action', 'timer'].includes(kind)) fail(`${artifact.id}: journey action does not resolve to action/timer ${step.action}`);
        if (actionTargets.has(step.action) && step.screenId !== actionTargets.get(step.action)) fail(`${artifact.id}: journey action ${step.action} targets ${actionTargets.get(step.action)}, not ${step.screenId}`);
      }
    }
    for (const reference of artifact.references || []) if (!resolves(reference.kind, reference.id)) fail(`${artifact.id}: unresolved ${reference.kind}:${reference.id}`);
    walk(artifact.body, (object, path) => {
      if (typeof object.from === 'string' && typeof object.to === 'string') {
        if (!hasEntity(object.from)) fail(`${artifact.id}${path}: edge source missing ${object.from}`);
        if (!hasEntity(object.to)) fail(`${artifact.id}${path}: edge target missing ${object.to}`);
      }
      if (object.edges !== undefined) {
        if (!Array.isArray(object.edges)) fail(`${artifact.id}${path}: edges must be an array`);
        else for (const edge of object.edges) if (typeof edge.from !== 'string' || !edge.from || typeof edge.to !== 'string' || !edge.to) fail(`${artifact.id}${path}: malformed explicit edge endpoints`);
      }
      const refKinds = { commandRef: 'command', existingCommandRef: 'command', eventRef: 'event', eventFieldRef: 'event-field', storyRef: 'story',
        roleRef: 'role', externalSystemRef: 'external-system',
        screenId: 'entity', targetScreenId: 'entity', activityId: 'entity', releaseId: 'entity', taskId: 'entity', stageId: 'entity', stateId: 'entity', messageId: 'entity' };
      for (const [key, kind] of Object.entries(refKinds)) if (object[key] && !resolves(kind, object[key])) fail(`${artifact.id}${path}: unresolved ${key} ${object[key]}`);
      for (const [key, kind] of [['screenId', 'screen'], ['targetScreenId', 'screen'], ['activityId', 'activity'], ['releaseId', 'release'], ['stateId', 'state'], ['messageId', 'message']]) {
        if (object[key] && !typed(object[key], kind)) fail(`${artifact.id}${path}: ${key} must resolve to ${kind}`);
      }
      for (const [key, kind] of [['readModelRefs', 'read-model'], ['messageIds', 'entity'], ['feedbackStateIds', 'entity'], ['stateFieldRefs', 'state-field'], ['backbone', 'entity']]) {
        for (const id of object[key] || []) if (!resolves(kind, id)) fail(`${artifact.id}${path}: unresolved ${key} ${id}`);
      }
      for (const id of object.messageIds || []) if (!typed(id, 'message')) fail(`${artifact.id}${path}: messageIds needs message ${id}`);
      for (const id of [...(object.feedbackStateIds || []), ...(Array.isArray(object.states) ? object.states.filter((id) => typeof id === 'string') : [])]) if (!typed(id, 'state')) fail(`${artifact.id}${path}: state list needs state ${id}`);
      if (object.commandRef && object.parameters !== undefined) {
        const command = index.get(`command:${object.commandRef}`);
        const array = Array.isArray(object.parameters);
        const parameters = array ? object.parameters : object.parameters && typeof object.parameters === 'object'
          ? Object.keys(object.parameters).map((name) => ({ name })) : null;
        if (!parameters) fail(`${artifact.id}${path}: parameters must be an array or descriptive object`);
        const names = new Set();
        for (const parameter of parameters || []) {
          if (names.has(parameter.name)) fail(`${artifact.id}${path}: duplicate parameter ${parameter.name}`);
          names.add(parameter.name);
          if (!command?.parameters?.some((slot) => slot.name === parameter.name)) fail(`${artifact.id}${path}: form binding uses unknown parameter ${parameter.name}`);
          if (array && !['user', 'trusted-context', 'host-generated', 'propagated'].includes(parameter.source)) fail(`${artifact.id}${path}: missing explicit input authority for ${parameter.name}`);
        }
        for (const slot of command?.parameters || []) if (!slot.optional && !names.has(slot.name)) fail(`${artifact.id}${path}: mapping omits required parameter ${slot.name}`);
      }
      if (object.commandParameter !== undefined) {
        const command = index.get(`command:${object.commandRef}`);
        const event = index.get(`event:${object.eventRef}`);
        const parameter = command?.parameters?.find((slot) => slot.name === object.commandParameter);
        const slot = index.get(`event-field:${object.eventFieldRef}`);
        if (!parameter) fail(`${artifact.id}${path}: trace command parameter does not exist ${object.commandParameter}`);
        if (!object.eventFieldRef?.startsWith(`${object.eventRef}.`)) fail(`${artifact.id}${path}: trace event field has wrong owner`);
        if (command && event && !(command.produces || []).map(eventName).includes(event.name)) fail(`${artifact.id}${path}: trace command does not produce referenced event`);
        if (object.binding && !event?.bindings?.some((binding) => JSON.stringify(binding) === JSON.stringify(object.binding))) fail(`${artifact.id}${path}: copied binding differs from declared event binding`);
        if (object.sourceIndicators?.commandParameterOrigin !== parameter?.origin || object.sourceIndicators?.eventFieldOrigin !== slot?.origin) fail(`${artifact.id}${path}: copied origin evidence differs from declaration`);
        for (const fold of object.foldAssignments || []) if (!event?.foldAssignments?.some((entry) => JSON.stringify(entry) === JSON.stringify(fold))) fail(`${artifact.id}${path}: copied fold differs from declaration`);
      }
      if (object.implementation && ['implemented', 'executable', 'runtime-certified', 'completed'].includes(object.implementation)) fail(`${artifact.id}${path}: unsupported runtime-certification claim`);
    });
  }
  for (const category of CATEGORIES) if (!artifacts.some((artifact) => artifact.category === category)) fail(`Missing workshop/product perspective ${category}`);
  const contexts = artifacts.filter((artifact) => artifact.category === 'context');
  const ownership = new Map();
  for (const context of contexts) for (const name of context.body?.aggregates || []) {
    if (!index.has(`aggregate:${name}`)) fail(`${context.id}: unknown aggregate ownership ${name}`);
    if (ownership.has(name)) fail(`Aggregate ${name} has multiple proposed context owners`);
    ownership.set(name, context.id);
  }
  for (const aggregate of snapshot.canonical.aggregates || []) if (!ownership.has(aggregate.name)) fail(`${aggregate.name}: missing proposed context ownership`);
  const mock = artifacts.find((artifact) => artifact.category === 'mock-ta');
  if (mock) {
    const outcomes = new Set((mock.body.scenarios || []).map((scenario) => scenario.outcome));
    for (const scenario of ['accepted', 'confirmed', 'rejected', 'delayed', 'unknown', 'duplicate-identical', 'duplicate-conflicting']) {
      if (!outcomes.has(scenario)) fail(`${mock.id}: missing simulated outcome ${scenario}`);
    }
    notices.push('MockTA scenarios are design contracts; no simulated service or settlement/refund execution was run.');
  }
  notices.push('Context/UX references are validated locally; the portable context target index and UI generation are not extended.');
  return { errors, notices, artifacts: artifacts.length, entities: entityIds.size };
}

export function projectionModel(snapshot) {
  const artifacts = extractArtifacts(snapshot);
  return { schemaVersion: 'bank-wealth.design-projection/v1', readiness: 'design-proposal-only',
    sourceDigest: snapshot.canonicalSha256, toolDigest: snapshot.tool.sha256, artifacts };
}

function collectEdges(body) {
  const result = [];
  walk(body, (object) => { if (typeof object.from === 'string' && typeof object.to === 'string') result.push(object); });
  const unique = new Map(result.map((edge) => [JSON.stringify([edge.from, edge.to, edge.label || '']), edge]));
  return [...unique.values()];
}
const md = (value) => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', '<br>');
const label = (value) => String(value ?? '').replace(/["\r\n]/g, ' ').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function diagram(artifacts, title) {
  const nodes = new Map();
  for (const artifact of artifacts) {
    for (const entity of artifact.body?.entities || []) nodes.set(entity.id, entity.label || entity.name || entity.id);
    for (const entity of artifact.body?.nodes || []) nodes.set(entity.id, entity.label || entity.id);
    for (const journey of artifact.body?.journeys || []) {
      nodes.set(journey.id, journey.label || journey.id);
      for (const step of journey.steps || []) nodes.set(step.id, step.label || step.id);
    }
    nodes.set(artifact.id, artifact.body?.label || artifact.id);
  }
  const edges = artifacts.flatMap((artifact) => collectEdges(artifact.body));
  for (const artifact of artifacts) for (const journey of artifact.body?.journeys || []) {
    if (journey.steps?.length) edges.push({ from: journey.id, to: journey.steps[0].id, label: `故事 ${journey.storyRef}` });
    for (const step of journey.steps || []) {
      if (step.screenId) edges.push({ from: step.id, to: step.screenId, label: '交互触点' });
      if (step.action) edges.push({ from: step.id, to: step.action, label: `参与者 ${step.actor}` });
    }
  }
  for (const edge of edges) for (const endpoint of [edge.from, edge.to]) if (!nodes.has(endpoint)) nodes.set(endpoint, endpoint);
  const graphId = (id) => `n_${sha256(id).slice(0, 16)}`;
  const lines = ['flowchart LR', ...[...nodes].map(([id, text]) => `  ${graphId(id)}["${label(text)}"]`),
    ...edges.map((edge) => `  ${graphId(edge.from)} -->|"${label(edge.label || '关联') }"| ${graphId(edge.to)}`)];
  return `# ${title}\n\n> 派生设计提议，不是运行结果。修改来源便签，不手改此文件。\n\n\`\`\`mermaid\n${lines.join('\n')}\n\`\`\`\n\n## 来源\n\n${artifacts.map((artifact) => `- \`${artifact.id}\`：\`${artifact.source.file}${artifact.source.pointer}\``).join('\n')}\n`;
}

export function renderProjections(snapshot) {
  const model = projectionModel(snapshot);
  const byCategory = (...categories) => model.artifacts.filter((artifact) => categories.includes(artifact.category));
  const output = new Map([['index.json', `${JSON.stringify(model, null, 2)}\n`]]);
  output.set('context-map.md', diagram(byCategory('context-map', 'context'), '候选上下文地图'));
  output.set('event-flow.md', diagram(byCategory('event-flow'), '事件风暴业务叙事与缺口'));
  let journeys = diagram(byCategory('ux-structure'), '用户旅程与信息架构');
  for (const artifact of byCategory('ux-structure')) for (const journey of artifact.body?.journeys || []) {
    journeys += `\n## ${md(journey.label)} — ${md(journey.storyRef)}\n\n| 阶段 | 参与者 | 动作 | 触点 | 信息需求 | 实现状态 |\n|---|---|---|---|---|---|\n`;
    for (const step of journey.steps || []) journeys += `| ${md(step.label)} | ${md(step.actor)} | ${md(step.action)} | ${md(step.screenId || '系统触点')} | ${md((step.informationNeeds || []).join('；'))} | ${md(step.implementation)} |\n`;
  }
  output.set('journeys.md', journeys);
  output.set('screen-flow.md', diagram(byCategory('ux-structure', 'ux-skeleton'), '界面与导航设计提议'));
  const scope = byCategory('ux-scope');
  let storyMap = diagram(scope, '用户故事地图：活动、任务与发布切片');
  for (const artifact of scope) {
    storyMap += '\n## 显式故事映射\n\n| 活动 | 任务 | 故事 | 发布切片 |\n|---|---|---|---|\n';
    for (const task of artifact.body?.tasks || []) storyMap += `| ${md(task.activityId)} | ${md(task.label || task.id)} | ${md(task.storyRef)} | ${md(task.releaseId)} |\n`;
    storyMap += '\n## 活动主干顺序\n\n';
    storyMap += (artifact.body?.backbone || []).map((id, i) => `${i + 1}. \`${id}\``).join('\n') + '\n';
  }
  output.set('story-map.md', storyMap);
  let overview = '# 设计提议索引\n\n> 真源标准便签是权威来源；本索引与图是确定性派生产物。\n\n| ID | 视角 | 状态 | 来源 |\n|---|---|---|---|\n';
  for (const artifact of model.artifacts) overview += `| ${md(artifact.id)} | ${md(artifact.category)} | ${md(artifact.status)} | ${md(artifact.source.file)} |\n`;
  output.set('README.md', overview);
  return output;
}
