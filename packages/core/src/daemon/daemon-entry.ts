import { NovaDaemon } from './Daemon.js';
import { writePidFile, removePidFile } from './daemonize.js';

async function main(): Promise<void> {
  writePidFile();

  const daemon = new NovaDaemon();

  process.on('exit', () => {
    removePidFile();
  });

  await daemon.start();
}

main().catch((err) => {
  process.stderr.write(`NovaPM daemon failed to start: ${err}\n`);
  removePidFile();
  process.exit(1);
});
