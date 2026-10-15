if (process.env.DUELPLAY_SERVER_EVENTS_INTEGRATION !== '1') {
  console.error('Refusing to run. Set DUELPLAY_SERVER_EVENTS_INTEGRATION=1 explicitly for this isolated PostgreSQL integration test.');
  process.exitCode = 1;
} else {
  await import('./test-demo-wallet-postgres.mjs');
}
