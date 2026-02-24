import { Command } from 'commander';
import chalk from 'chalk';
import { platform } from 'node:os';

export const startupCommand = new Command('startup')
  .argument('[platform]', 'Target platform (systemd, launchd, windows)')
  .description('Generate startup script for NovaPM')
  .action(async (targetPlatform) => {
    const os = targetPlatform || detectPlatform();

    console.log(chalk.bold('\n  NovaPM Startup Script Generator\n'));

    switch (os) {
      case 'launchd':
        generateLaunchd();
        break;
      case 'systemd':
        generateSystemd();
        break;
      default:
        console.log(chalk.yellow(`  Platform "${os}" is not yet supported.`));
        console.log(`  Supported: systemd (Linux), launchd (macOS)\n`);
    }
  });

function detectPlatform(): string {
  const os = platform();
  if (os === 'darwin') return 'launchd';
  if (os === 'linux') return 'systemd';
  return os;
}

function generateLaunchd(): void {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.novapm.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${process.argv[1]}</string>
    <string>resurrect</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
</dict>
</plist>`;

  console.log(`  To set up NovaPM to start on boot:\n`);
  console.log(`  1. Create the plist file:`);
  console.log(chalk.cyan(`     nano ~/Library/LaunchAgents/com.novapm.daemon.plist\n`));
  console.log(`  2. Paste this content:\n`);
  console.log(chalk.gray(plist));
  console.log(`\n  3. Load it:`);
  console.log(chalk.cyan(`     launchctl load ~/Library/LaunchAgents/com.novapm.daemon.plist\n`));
}

function generateSystemd(): void {
  const unit = `[Unit]
Description=NovaPM Process Manager
After=network.target

[Service]
Type=forking
User=${process.env.USER || 'root'}
ExecStart=${process.execPath} ${process.argv[1]} resurrect
ExecReload=${process.execPath} ${process.argv[1]} restart all
ExecStop=${process.execPath} ${process.argv[1]} stop all
Restart=on-failure
PIDFile=%h/.novapm/nova.pid

[Install]
WantedBy=multi-user.target`;

  console.log(`  To set up NovaPM to start on boot:\n`);
  console.log(`  1. Create the service file:`);
  console.log(chalk.cyan(`     sudo nano /etc/systemd/system/novapm.service\n`));
  console.log(`  2. Paste this content:\n`);
  console.log(chalk.gray(unit));
  console.log(`\n  3. Enable and start it:`);
  console.log(chalk.cyan(`     sudo systemctl enable novapm`));
  console.log(chalk.cyan(`     sudo systemctl start novapm\n`));
}
