import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runBankBrowserFunds, BankBrowserFundsError } from './v1-browser-funds.mjs';
import { parseStrictJson } from '../../metarch-truthsrc/lib/strict-json.mjs';

export async function runRuntimeBrowser(config, moduleFile, executable) {
  assert.equal(realpathSync(moduleFile), moduleFile);
  assert.equal(realpathSync(executable), executable);
  const installed = await import(pathToFileURL(moduleFile).href);
  const chromium = installed.chromium ?? installed.default?.chromium;
  assert.equal(typeof chromium?.launch, 'function');
  let browser;
  try {
    browser = await chromium.launch({ executablePath: executable, headless: true, timeout: 30_000,
      args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run',
        '--disable-domain-reliability', '--disable-features=MediaRouter,OptimizationHints', '--no-default-browser-check'] });
    return await runBankBrowserFunds({ ...config, browser });
  } finally { if (browser) await browser.close(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  try {
    assert.equal(process.argv.length, 5);
    const [file, module, executable] = process.argv.slice(2);
    const config = parseStrictJson(readFileSync(file));
    assert.deepEqual(Object.keys(config).sort(), ['baseURL', 'credentials', 'mode', 'synthetic']);
    const report = await runRuntimeBrowser(config, module, executable);
    process.stdout.write(JSON.stringify(report) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify(error instanceof BankBrowserFundsError ? error.report : {
      schemaVersion: 'bank.truthsrc-runtime-browser/v1', completed: false, failureAt: 'browser-launch-or-configuration',
    }) + '\n');
    process.exitCode = 1;
  }
}
