/**
 * Exports the canonical ABI for Aditya's subgraph.
 * Run after `npm run build`. Writes contracts/abi/CommonBudget.json.
 */
const fs = require('node:fs');
const path = require('node:path');

const artifact = path.join(__dirname, '..', 'artifacts', 'src', 'CommonBudget.sol', 'CommonBudget.json');
if (!fs.existsSync(artifact)) {
  console.error('Artifact missing. Run `npm run build` in contracts/ first.');
  process.exit(1);
}

const { abi } = JSON.parse(fs.readFileSync(artifact, 'utf8'));
const outDir = path.join(__dirname, '..', 'abi');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'CommonBudget.json');
fs.writeFileSync(out, `${JSON.stringify(abi, null, 2)}\n`);

const events = abi.filter((e) => e.type === 'event').map((e) => e.name);
console.log(`Wrote ${out}`);
console.log(`Events for the subgraph: ${events.join(', ')}`);
