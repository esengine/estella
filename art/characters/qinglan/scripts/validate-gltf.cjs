const fs = require('node:fs');
const path = require('node:path');
const modulePath = process.env.GLTF_VALIDATOR_MODULE || 'gltf-validator';
const validator = require(modulePath);
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'export', 'qinglan-static.glb');
validator.validateBytes(new Uint8Array(fs.readFileSync(file)), {
  uri: 'qinglan-static.glb', maxIssues: 200,
}).then(report => {
  fs.writeFileSync(path.join(root, 'review', 'gltf-validation.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({version: validator.version(), errors: report.issues.numErrors,
    warnings: report.issues.numWarnings, infos: report.issues.numInfos,
    codes: [...new Set(report.issues.messages.map(message => message.code))]}, null, 2));
  process.exitCode = report.issues.numErrors ? 1 : 0;
}).catch(error => { console.error(error); process.exitCode = 1; });
