// Run from workspaces/mainbrella in the linked fork after building the package.
// Requires MAINBRELLA_API_KEY and an active allowance. Starts and stops one container.
import { Workspace } from '@mastra/core/workspace';
import { MainbrellaFilesystem, MainbrellaSandbox } from '@mastra/mainbrella';

const sandbox = new MainbrellaSandbox({ catalogId: 'node' });
const filesystem = new MainbrellaFilesystem({ sandbox });
const workspace = new Workspace({ sandbox, filesystem });

try {
  await workspace.init();
  await filesystem.writeFile('input.json', '[12, 17, 13]');
  await filesystem.writeFile('report.cjs', `
    const fs = require('node:fs');
    const values = JSON.parse(fs.readFileSync('input.json', 'utf8'));
    const total = values.reduce((sum, value) => sum + value, 0);
    fs.writeFileSync('report.txt', 'total=' + total + '\\n');
  `);

  const result = await sandbox.executeCommand('node', ['report.cjs']);
  if (!result.success) throw new Error(result.stderr || 'Report failed');
  console.log(await filesystem.readFile('report.txt', { encoding: 'utf8' }));
} finally {
  await workspace.destroy();
}
