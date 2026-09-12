/** SDK errors sometimes echo invalid configuration values. Never persist or serve keys. */
export function safeErrorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : 'Request failed';
  for (const name of ['HEDERA_PRIVATE_KEY', 'HEDERA_EVM_PRIVATE_KEY']) {
    const key = process.env[name];
    if (key) for (const value of [key, key.replace(/^0x/, '')]) if (value) message = message.split(value).join('[redacted]');
  }
  return message.slice(0, 500);
}
