import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const fail = (message) => {
  console.error('FAIL:', message);
  process.exitCode = 1;
};
const pass = (message) => console.log('PASS:', message);

const html = readFileSync('index.html', 'utf8');
const archiveApi = readFileSync('archive-api.js', 'utf8');
const worker = readFileSync('worker.js', 'utf8');

const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
if (!scripts.length) fail('index.html contains no script blocks');
for (let i = 0; i < scripts.length; i++) {
  const attrs = scripts[i][1] || '';
  const body = scripts[i][2] || '';
  if (/\bsrc\s*=/.test(attrs) || !body.trim()) continue;
  try {
    new vm.Script(body, { filename: `index.html:inline-script-${i + 1}` });
  } catch (error) {
    fail(`index.html inline script ${i + 1}: ${error.message}`);
  }
}
if (process.exitCode !== 1) pass('index.html inline JavaScript parses');

for (const [name, source] of [['archive-api.js', archiveApi]]) {
  try {
    new vm.Script(source, { filename: name });
    pass(`${name} parses`);
  } catch (error) {
    fail(`${name}: ${error.message}`);
  }
}
const workerCheck = spawnSync(process.execPath, ['--input-type=module', '--check'], {
  input: worker,
  encoding: 'utf8'
});
if (workerCheck.status === 0) pass('worker.js parses as an ES module');
else fail(`worker.js syntax check failed: ${workerCheck.stderr || workerCheck.stdout}`);

const requiredMarkers = [
  ['closure-safe pagination handler', 'function changePeoplePage(delta)'],
  ['global search shortcut', 'id="globalSearchBtn"'],
  ['safe archive import mode', 'preservesExisting:true'],
  ['duplicate merge endpoint', '/api/person/merge'],
  ['Gmail diagnostic endpoint', 'testGmailNotification']
];
for (const [label, marker] of requiredMarkers) {
  if (html.includes(marker) || archiveApi.includes(marker) || worker.includes(marker)) pass(label);
  else fail(`missing ${label} marker: ${marker}`);
}

if (/DELETE FROM (people|relationships|meta)\s*;/.test(worker)) {
  fail('unconditional archive-wide DELETE detected in Worker source');
} else {
  pass('no simple unconditional archive-wide DELETE statement detected');
}
if (/archive-seed\.json/.test(html)) {
  fail('private archive seed filename referenced in public application HTML');
} else {
  pass('no private archive seed filename referenced in index.html');
}

if (process.exitCode) process.exit(1);
