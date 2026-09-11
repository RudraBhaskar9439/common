/**
 * Asks the facilitator what it actually supports.
 *
 * Run this BEFORE assuming a scheme identifier, network identifier or feePayer. The
 * Hedera `exact` scheme requires transactionId.accountId to equal the facilitator's
 * feePayer, so a wrong value here fails every payment for a reason that is hard to
 * read from the error alone.
 *
 * Read-only: one GET. No payment, no key, no chain write.
 */
const baseUrl = (process.env['BLOCKY402_FACILITATOR_URL'] ?? 'https://api.testnet.blocky402.com').replace(/\/$/, '');

async function main(): Promise<void> {
  console.log(`GET ${baseUrl}/supported\n`);

  const response = await fetch(`${baseUrl}/supported`);
  const text = await response.text();

  if (!response.ok) {
    console.error(`Failed: ${response.status} ${response.statusText}`);
    console.error(text.slice(0, 1000));
    process.exitCode = 1;
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    console.error('Response was not JSON:');
    console.error(text.slice(0, 1000));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(parsed, null, 2));

  const hedera = JSON.stringify(parsed).match(/hedera[^"]*/gi);
  console.log('\n--- what to look for ---');
  console.log(`hedera mentions: ${hedera ? [...new Set(hedera)].join(', ') : 'NONE — hedera may not be supported here'}`);
  console.log('Copy the exact network identifier and the feePayer account into apps/paid-service/.env');
}

main().catch((err: unknown) => {
  console.error('Could not reach the facilitator:', err);
  process.exitCode = 1;
});
