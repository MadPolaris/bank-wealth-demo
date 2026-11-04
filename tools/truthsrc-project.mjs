import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectCli } from '../../metarch-truthsrc/lib/project/cli.mjs';
import { projectQueryCli } from '../../metarch-truthsrc/lib/project/query.mjs';
import { validateTree } from '../../metarch-truthsrc/lib/validate.mjs';
import { roundtrip } from '../../metarch-truthsrc/lib/roundtrip.mjs';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = join(root, 'truthsrc.project.json');
const [command, ...args] = process.argv.slice(2);
const allowed = { compile: 'compile-project', generate: 'generate-project', status: 'status-project', query: 'query-project' };
try {
  if (command === 'validate') {
    if (args.length) throw new Error('validate accepts no extra flags');
    const config = JSON.parse(readFileSync(project)), tree = resolve(root, config.tree);
    const validation = validateTree(tree);
    if (validation.hard.length) throw new Error(JSON.stringify(validation));
    const identity = roundtrip(tree);
    if (!identity.ok) throw new Error(JSON.stringify(identity));
    console.log(JSON.stringify({ current: project, validation, roundtrip: identity, runtimeVerified: false }));
  } else {
    const verb = allowed[command];
    if (!verb || args.includes('--project')) throw new Error('usage: truthsrc-project.mjs validate|compile|generate|status|query [public CLI flags]; project is fixed to the current root entry');
    const flags = ['--project', project, ...args];
    const result = ['status', 'query'].includes(command) ? projectQueryCli(verb, flags) : await projectCli(verb, flags);
    console.log(JSON.stringify(result));
  }
} catch (error) { console.error(error.message); process.exitCode = 2; }
