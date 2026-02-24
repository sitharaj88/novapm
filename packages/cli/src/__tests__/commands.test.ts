import { describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';

// Mock chalk to return plain text
vi.mock('chalk', () => {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'default') return chainable;
      return chainable;
    },
    apply(_target, _thisArg, args) {
      return String(args[0]);
    },
  };

  const chainable: unknown = new Proxy(function () {} as object, handler);

  return { default: chainable };
});

// Mock ora to prevent spinner side effects
vi.mock('ora', () => {
  const spinner = {
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    text: '',
  };
  return { default: vi.fn(() => spinner) };
});

// Mock open for dashboard command
vi.mock('open', () => ({
  default: vi.fn(),
}));

// Mock the client utility to prevent actual IPC connections
vi.mock('../utils/client.js', () => ({
  daemonRequest: vi.fn().mockResolvedValue([]),
  getClient: vi.fn().mockResolvedValue({
    isConnected: () => true,
    request: vi.fn(),
    disconnect: vi.fn(),
  }),
  disconnect: vi.fn(),
}));

// Mock the Table UI
vi.mock('../ui/Table.js', () => ({
  renderProcessTable: vi.fn().mockReturnValue('mock-table'),
  renderProcessInfo: vi.fn().mockReturnValue('mock-info'),
}));

// Mock @novapm/shared
vi.mock('@novapm/shared', () => ({
  NOVA_VERSION: '0.1.0',
  NOVA_HOME: '/tmp/.novapm',
  NOVA_SOCK_FILE: '/tmp/.novapm/nova.sock',
  NOVA_DB_FILE: '/tmp/.novapm/nova.db',
  NOVA_PID_FILE: '/tmp/.novapm/nova.pid',
  NOVA_LOG_DIR: '/tmp/.novapm/logs',
  DEFAULT_DASHBOARD_PORT: 9615,
  NOVA_CONFIG_FILES: [
    'nova.config.ts',
    'nova.config.js',
    'nova.config.json',
    'nova.config.yaml',
    'nova.config.yml',
    'ecosystem.config.ts',
    'ecosystem.config.js',
    'ecosystem.config.cjs',
  ],
  appConfigSchema: {
    parse: vi.fn((v: unknown) => v),
  },
  formatBytes: vi.fn((v: number) => `${v} B`),
  formatCpu: vi.fn((v: number) => `${v}%`),
  formatUptime: vi.fn((v: number) => `${v}s`),
}));

// Mock @novapm/core for doctor and client modules
vi.mock('@novapm/core', () => ({
  IPCClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    request: vi.fn(),
  })),
  isDaemonRunning: vi.fn().mockReturnValue(false),
  getDaemonPid: vi.fn().mockReturnValue(null),
  spawnDaemon: vi.fn(),
}));

// Mock node:fs to prevent file system operations in command actions
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Import commands after all mocks are set up
import { startCommand } from '../commands/start.js';
import { stopCommand } from '../commands/stop.js';
import { restartCommand } from '../commands/restart.js';
import { deleteCommand } from '../commands/delete.js';
import { listCommand } from '../commands/list.js';
import { infoCommand } from '../commands/info.js';
import { logsCommand } from '../commands/logs.js';
import { scaleCommand } from '../commands/scale.js';
import { saveCommand } from '../commands/save.js';
import { resurrectCommand } from '../commands/resurrect.js';
import { pingCommand } from '../commands/ping.js';
import { startupCommand } from '../commands/startup.js';
import { doctorCommand } from '../commands/doctor.js';
import { initCommand } from '../commands/init.js';
import { dashboardCommand } from '../commands/dashboard.js';
import { monitCommand } from '../commands/monit.js';

// Helper to extract option flags from a command
function getOptionFlags(command: Command): string[] {
  return command.options.map((opt) => opt.flags);
}

// Helper to extract option long names from a command
function _getOptionLongNames(command: Command): string[] {
  return command.options.map((opt) => opt.long ?? '').filter(Boolean);
}

// Helper to get registered argument names
function getArgumentNames(command: Command): string[] {
  return (command as unknown as { _args: Array<{ _name: string }> })._args.map((arg) => arg._name);
}

// Helper to check if a command has an alias
function getAliases(command: Command): string[] {
  return command.aliases();
}

describe('CLI Command Definitions', () => {
  describe('startCommand', () => {
    it('should be a Commander Command instance', () => {
      expect(startCommand).toBeInstanceOf(Command);
    });

    it('should have the name "start"', () => {
      expect(startCommand.name()).toBe('start');
    });

    it('should have a description', () => {
      const desc = startCommand.description();
      expect(desc).toBeTruthy();
      expect(desc.toLowerCase()).toContain('start');
    });

    it('should accept an optional [script] argument', () => {
      const args = getArgumentNames(startCommand);
      expect(args).toContain('script');
    });

    it('should have a --name option', () => {
      const flags = getOptionFlags(startCommand);
      expect(flags.some((f) => f.includes('--name'))).toBe(true);
    });

    it('should have a --instances option', () => {
      const flags = getOptionFlags(startCommand);
      expect(flags.some((f) => f.includes('--instances'))).toBe(true);
    });

    it('should default instances to "1"', () => {
      const instancesOpt = startCommand.options.find((o) => o.long === '--instances');
      expect(instancesOpt?.defaultValue).toBe('1');
    });

    it('should have an --exec-mode option', () => {
      const flags = getOptionFlags(startCommand);
      expect(flags.some((f) => f.includes('--exec-mode'))).toBe(true);
    });

    it('should default exec-mode to "fork"', () => {
      const opt = startCommand.options.find((o) => o.long === '--exec-mode');
      expect(opt?.defaultValue).toBe('fork');
    });

    it('should have a --watch option', () => {
      const flags = getOptionFlags(startCommand);
      expect(flags.some((f) => f.includes('--watch'))).toBe(true);
    });

    it('should have a --max-memory option', () => {
      const flags = getOptionFlags(startCommand);
      expect(flags.some((f) => f.includes('--max-memory'))).toBe(true);
    });

    it('should have an --env option', () => {
      const flags = getOptionFlags(startCommand);
      expect(flags.some((f) => f.includes('--env'))).toBe(true);
    });

    it('should have a --port option', () => {
      const flags = getOptionFlags(startCommand);
      expect(flags.some((f) => f.includes('--port'))).toBe(true);
    });

    it('should have a --cron option', () => {
      const flags = getOptionFlags(startCommand);
      expect(flags.some((f) => f.includes('--cron'))).toBe(true);
    });

    it('should have a --no-autorestart option', () => {
      const flags = getOptionFlags(startCommand);
      expect(flags.some((f) => f.includes('--no-autorestart'))).toBe(true);
    });

    it('should have an --interpreter option', () => {
      const flags = getOptionFlags(startCommand);
      expect(flags.some((f) => f.includes('--interpreter'))).toBe(true);
    });

    it('should have a --node-args option', () => {
      const flags = getOptionFlags(startCommand);
      expect(flags.some((f) => f.includes('--node-args'))).toBe(true);
    });

    it('should have a --cwd option', () => {
      const flags = getOptionFlags(startCommand);
      expect(flags.some((f) => f.includes('--cwd'))).toBe(true);
    });

    it('should have short aliases for common options', () => {
      const flags = getOptionFlags(startCommand);
      expect(flags.some((f) => f.includes('-n,'))).toBe(true); // --name
      expect(flags.some((f) => f.includes('-i,'))).toBe(true); // --instances
      expect(flags.some((f) => f.includes('-w,'))).toBe(true); // --watch
      expect(flags.some((f) => f.includes('-p,'))).toBe(true); // --port
    });
  });

  describe('stopCommand', () => {
    it('should be a Commander Command instance', () => {
      expect(stopCommand).toBeInstanceOf(Command);
    });

    it('should have the name "stop"', () => {
      expect(stopCommand.name()).toBe('stop');
    });

    it('should have a description', () => {
      const desc = stopCommand.description();
      expect(desc).toBeTruthy();
      expect(desc.toLowerCase()).toContain('stop');
    });

    it('should require a <target> argument', () => {
      const args = getArgumentNames(stopCommand);
      expect(args).toContain('target');
    });

    it('should have a --force option', () => {
      const flags = getOptionFlags(stopCommand);
      expect(flags.some((f) => f.includes('--force'))).toBe(true);
    });

    it('should have -f as short alias for --force', () => {
      const flags = getOptionFlags(stopCommand);
      expect(flags.some((f) => f.includes('-f,'))).toBe(true);
    });
  });

  describe('restartCommand', () => {
    it('should be a Commander Command instance', () => {
      expect(restartCommand).toBeInstanceOf(Command);
    });

    it('should have the name "restart"', () => {
      expect(restartCommand.name()).toBe('restart');
    });

    it('should have a description', () => {
      const desc = restartCommand.description();
      expect(desc).toBeTruthy();
      expect(desc.toLowerCase()).toContain('restart');
    });

    it('should require a <target> argument', () => {
      const args = getArgumentNames(restartCommand);
      expect(args).toContain('target');
    });

    it('should not have any additional options beyond built-in', () => {
      // restart only has the target argument, no extra options
      const customOptions = restartCommand.options.filter((o) => o.long !== '--help');
      expect(customOptions.length).toBe(0);
    });
  });

  describe('deleteCommand', () => {
    it('should be a Commander Command instance', () => {
      expect(deleteCommand).toBeInstanceOf(Command);
    });

    it('should have the name "delete"', () => {
      expect(deleteCommand.name()).toBe('delete');
    });

    it('should have a description', () => {
      const desc = deleteCommand.description();
      expect(desc).toBeTruthy();
      expect(desc.toLowerCase()).toContain('delete');
    });

    it('should require a <target> argument', () => {
      const args = getArgumentNames(deleteCommand);
      expect(args).toContain('target');
    });
  });

  describe('listCommand', () => {
    it('should be a Commander Command instance', () => {
      expect(listCommand).toBeInstanceOf(Command);
    });

    it('should have the name "list"', () => {
      expect(listCommand.name()).toBe('list');
    });

    it('should have a description', () => {
      const desc = listCommand.description();
      expect(desc).toBeTruthy();
      expect(desc.toLowerCase()).toContain('list');
    });

    it('should have "ls" as an alias', () => {
      const aliases = getAliases(listCommand);
      expect(aliases).toContain('ls');
    });

    it('should have "status" as an alias', () => {
      const aliases = getAliases(listCommand);
      expect(aliases).toContain('status');
    });

    it('should have a --json option', () => {
      const flags = getOptionFlags(listCommand);
      expect(flags.some((f) => f.includes('--json'))).toBe(true);
    });

    it('should not require any arguments', () => {
      const args = getArgumentNames(listCommand);
      expect(args.length).toBe(0);
    });
  });

  describe('infoCommand', () => {
    it('should be a Commander Command instance', () => {
      expect(infoCommand).toBeInstanceOf(Command);
    });

    it('should have the name "info"', () => {
      expect(infoCommand.name()).toBe('info');
    });

    it('should have a description', () => {
      const desc = infoCommand.description();
      expect(desc).toBeTruthy();
    });

    it('should have "show" as an alias', () => {
      const aliases = getAliases(infoCommand);
      expect(aliases).toContain('show');
    });

    it('should require a <target> argument', () => {
      const args = getArgumentNames(infoCommand);
      expect(args).toContain('target');
    });

    it('should have a --json option', () => {
      const flags = getOptionFlags(infoCommand);
      expect(flags.some((f) => f.includes('--json'))).toBe(true);
    });
  });

  describe('logsCommand', () => {
    it('should be a Commander Command instance', () => {
      expect(logsCommand).toBeInstanceOf(Command);
    });

    it('should have the name "logs"', () => {
      expect(logsCommand.name()).toBe('logs');
    });

    it('should have a description', () => {
      const desc = logsCommand.description();
      expect(desc).toBeTruthy();
      expect(desc.toLowerCase()).toContain('log');
    });

    it('should accept an optional [target] argument', () => {
      const args = getArgumentNames(logsCommand);
      expect(args).toContain('target');
    });

    it('should have a --lines option', () => {
      const flags = getOptionFlags(logsCommand);
      expect(flags.some((f) => f.includes('--lines'))).toBe(true);
    });

    it('should default --lines to "50"', () => {
      const linesOpt = logsCommand.options.find((o) => o.long === '--lines');
      expect(linesOpt?.defaultValue).toBe('50');
    });

    it('should have a --follow option', () => {
      const flags = getOptionFlags(logsCommand);
      expect(flags.some((f) => f.includes('--follow'))).toBe(true);
    });

    it('should have a --json option', () => {
      const flags = getOptionFlags(logsCommand);
      expect(flags.some((f) => f.includes('--json'))).toBe(true);
    });

    it('should have -l as short alias for --lines', () => {
      const flags = getOptionFlags(logsCommand);
      expect(flags.some((f) => f.includes('-l,'))).toBe(true);
    });

    it('should have -f as short alias for --follow', () => {
      const flags = getOptionFlags(logsCommand);
      expect(flags.some((f) => f.includes('-f,'))).toBe(true);
    });
  });

  describe('scaleCommand', () => {
    it('should be a Commander Command instance', () => {
      expect(scaleCommand).toBeInstanceOf(Command);
    });

    it('should have the name "scale"', () => {
      expect(scaleCommand.name()).toBe('scale');
    });

    it('should have a description', () => {
      const desc = scaleCommand.description();
      expect(desc).toBeTruthy();
      expect(desc.toLowerCase()).toContain('scale');
    });

    it('should require a <target> argument', () => {
      const args = getArgumentNames(scaleCommand);
      expect(args).toContain('target');
    });

    it('should require an <instances> argument', () => {
      const args = getArgumentNames(scaleCommand);
      expect(args).toContain('instances');
    });

    it('should require exactly 2 arguments', () => {
      const args = getArgumentNames(scaleCommand);
      expect(args.length).toBe(2);
    });
  });

  describe('saveCommand', () => {
    it('should be a Commander Command instance', () => {
      expect(saveCommand).toBeInstanceOf(Command);
    });

    it('should have the name "save"', () => {
      expect(saveCommand.name()).toBe('save');
    });

    it('should have a description', () => {
      const desc = saveCommand.description();
      expect(desc).toBeTruthy();
      expect(desc.toLowerCase()).toContain('save');
    });

    it('should not require any arguments', () => {
      const args = getArgumentNames(saveCommand);
      expect(args.length).toBe(0);
    });
  });

  describe('resurrectCommand', () => {
    it('should be a Commander Command instance', () => {
      expect(resurrectCommand).toBeInstanceOf(Command);
    });

    it('should have the name "resurrect"', () => {
      expect(resurrectCommand.name()).toBe('resurrect');
    });

    it('should have a description', () => {
      const desc = resurrectCommand.description();
      expect(desc).toBeTruthy();
      expect(desc.toLowerCase()).toContain('restore');
    });

    it('should not require any arguments', () => {
      const args = getArgumentNames(resurrectCommand);
      expect(args.length).toBe(0);
    });
  });

  describe('pingCommand', () => {
    it('should be a Commander Command instance', () => {
      expect(pingCommand).toBeInstanceOf(Command);
    });

    it('should have the name "ping"', () => {
      expect(pingCommand.name()).toBe('ping');
    });

    it('should have a description', () => {
      const desc = pingCommand.description();
      expect(desc).toBeTruthy();
    });

    it('should not require any arguments', () => {
      const args = getArgumentNames(pingCommand);
      expect(args.length).toBe(0);
    });
  });

  describe('startupCommand', () => {
    it('should be a Commander Command instance', () => {
      expect(startupCommand).toBeInstanceOf(Command);
    });

    it('should have the name "startup"', () => {
      expect(startupCommand.name()).toBe('startup');
    });

    it('should have a description', () => {
      const desc = startupCommand.description();
      expect(desc).toBeTruthy();
      expect(desc.toLowerCase()).toContain('startup');
    });

    it('should accept an optional [platform] argument', () => {
      const args = getArgumentNames(startupCommand);
      expect(args).toContain('platform');
    });
  });

  describe('doctorCommand', () => {
    it('should be a Commander Command instance', () => {
      expect(doctorCommand).toBeInstanceOf(Command);
    });

    it('should have the name "doctor"', () => {
      expect(doctorCommand.name()).toBe('doctor');
    });

    it('should have a description', () => {
      const desc = doctorCommand.description();
      expect(desc).toBeTruthy();
      expect(desc.toLowerCase()).toContain('diagnos');
    });

    it('should not require any arguments', () => {
      const args = getArgumentNames(doctorCommand);
      expect(args.length).toBe(0);
    });
  });

  describe('initCommand', () => {
    it('should be a Commander Command instance', () => {
      expect(initCommand).toBeInstanceOf(Command);
    });

    it('should have the name "init"', () => {
      expect(initCommand.name()).toBe('init');
    });

    it('should have a description', () => {
      const desc = initCommand.description();
      expect(desc).toBeTruthy();
    });

    it('should have a --template option', () => {
      const flags = getOptionFlags(initCommand);
      expect(flags.some((f) => f.includes('--template'))).toBe(true);
    });

    it('should default --template to "basic"', () => {
      const templateOpt = initCommand.options.find((o) => o.long === '--template');
      expect(templateOpt?.defaultValue).toBe('basic');
    });

    it('should not require any arguments', () => {
      const args = getArgumentNames(initCommand);
      expect(args.length).toBe(0);
    });
  });

  describe('dashboardCommand', () => {
    it('should be a Commander Command instance', () => {
      expect(dashboardCommand).toBeInstanceOf(Command);
    });

    it('should have the name "dashboard"', () => {
      expect(dashboardCommand.name()).toBe('dashboard');
    });

    it('should have a description', () => {
      const desc = dashboardCommand.description();
      expect(desc).toBeTruthy();
      expect(desc.toLowerCase()).toContain('dashboard');
    });

    it('should have a --port option', () => {
      const flags = getOptionFlags(dashboardCommand);
      expect(flags.some((f) => f.includes('--port'))).toBe(true);
    });

    it('should default --port to the DEFAULT_DASHBOARD_PORT', () => {
      const portOpt = dashboardCommand.options.find((o) => o.long === '--port');
      expect(portOpt?.defaultValue).toBe('9615');
    });

    it('should have a --host option', () => {
      const flags = getOptionFlags(dashboardCommand);
      expect(flags.some((f) => f.includes('--host'))).toBe(true);
    });

    it('should default --host to 127.0.0.1', () => {
      const hostOpt = dashboardCommand.options.find((o) => o.long === '--host');
      expect(hostOpt?.defaultValue).toBe('127.0.0.1');
    });

    it('should have an --open option', () => {
      const flags = getOptionFlags(dashboardCommand);
      expect(flags.some((f) => f.includes('--open'))).toBe(true);
    });

    it('should not require any arguments', () => {
      const args = getArgumentNames(dashboardCommand);
      expect(args.length).toBe(0);
    });
  });

  describe('monitCommand', () => {
    it('should be a Commander Command instance', () => {
      expect(monitCommand).toBeInstanceOf(Command);
    });

    it('should have the name "monit"', () => {
      expect(monitCommand.name()).toBe('monit');
    });

    it('should have a description', () => {
      const desc = monitCommand.description();
      expect(desc).toBeTruthy();
      expect(desc.toLowerCase()).toContain('monitor');
    });

    it('should not require any arguments', () => {
      const args = getArgumentNames(monitCommand);
      expect(args.length).toBe(0);
    });
  });

  describe('all commands collection', () => {
    const allCommands = [
      { command: startCommand, name: 'start' },
      { command: stopCommand, name: 'stop' },
      { command: restartCommand, name: 'restart' },
      { command: deleteCommand, name: 'delete' },
      { command: listCommand, name: 'list' },
      { command: infoCommand, name: 'info' },
      { command: logsCommand, name: 'logs' },
      { command: scaleCommand, name: 'scale' },
      { command: saveCommand, name: 'save' },
      { command: resurrectCommand, name: 'resurrect' },
      { command: pingCommand, name: 'ping' },
      { command: startupCommand, name: 'startup' },
      { command: doctorCommand, name: 'doctor' },
      { command: initCommand, name: 'init' },
      { command: dashboardCommand, name: 'dashboard' },
      { command: monitCommand, name: 'monit' },
    ];

    it('should have 16 commands total', () => {
      expect(allCommands.length).toBe(16);
    });

    it('all commands should be Command instances', () => {
      for (const { command, name } of allCommands) {
        expect(command).toBeInstanceOf(Command);
        expect(command.name()).toBe(name);
      }
    });

    it('all commands should have non-empty descriptions', () => {
      for (const { command } of allCommands) {
        const desc = command.description();
        expect(desc.length).toBeGreaterThan(0);
      }
    });

    it('all command names should be unique', () => {
      const names = allCommands.map((c) => c.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it('all commands should have an action handler', () => {
      for (const { command } of allCommands) {
        // Commander stores the action listener internally;
        // if a command has an action, _actionHandler is set
        const handler = (command as unknown as { _actionHandler: unknown })._actionHandler;
        expect(handler).toBeTruthy();
      }
    });
  });

  describe('command argument parsing structure', () => {
    it('start command script argument should be optional (brackets)', () => {
      const args = (startCommand as unknown as { _args: Array<{ required: boolean }> })._args;
      const scriptArg = args[0];
      expect(scriptArg).toBeDefined();
      expect(scriptArg.required).toBe(false);
    });

    it('stop command target argument should be required (angle brackets)', () => {
      const args = (stopCommand as unknown as { _args: Array<{ required: boolean }> })._args;
      const targetArg = args[0];
      expect(targetArg).toBeDefined();
      expect(targetArg.required).toBe(true);
    });

    it('restart command target argument should be required', () => {
      const args = (restartCommand as unknown as { _args: Array<{ required: boolean }> })._args;
      const targetArg = args[0];
      expect(targetArg).toBeDefined();
      expect(targetArg.required).toBe(true);
    });

    it('delete command target argument should be required', () => {
      const args = (deleteCommand as unknown as { _args: Array<{ required: boolean }> })._args;
      const targetArg = args[0];
      expect(targetArg).toBeDefined();
      expect(targetArg.required).toBe(true);
    });

    it('info command target argument should be required', () => {
      const args = (infoCommand as unknown as { _args: Array<{ required: boolean }> })._args;
      const targetArg = args[0];
      expect(targetArg).toBeDefined();
      expect(targetArg.required).toBe(true);
    });

    it('logs command target argument should be optional', () => {
      const args = (logsCommand as unknown as { _args: Array<{ required: boolean }> })._args;
      const targetArg = args[0];
      expect(targetArg).toBeDefined();
      expect(targetArg.required).toBe(false);
    });

    it('scale command should have both target and instances as required', () => {
      const args = (
        scaleCommand as unknown as { _args: Array<{ required: boolean; _name: string }> }
      )._args;
      expect(args.length).toBe(2);
      expect(args[0]._name).toBe('target');
      expect(args[0].required).toBe(true);
      expect(args[1]._name).toBe('instances');
      expect(args[1].required).toBe(true);
    });

    it('startup command platform argument should be optional', () => {
      const args = (startupCommand as unknown as { _args: Array<{ required: boolean }> })._args;
      const platformArg = args[0];
      expect(platformArg).toBeDefined();
      expect(platformArg.required).toBe(false);
    });
  });

  describe('command option details', () => {
    it('start command -n option should expect a value (name)', () => {
      const nameOpt = startCommand.options.find((o) => o.long === '--name');
      expect(nameOpt).toBeDefined();
      expect(nameOpt!.required).toBe(true); // required means it requires a value when specified
    });

    it('stop command --force is a boolean flag (no value expected)', () => {
      const forceOpt = stopCommand.options.find((o) => o.long === '--force');
      expect(forceOpt).toBeDefined();
      // Boolean options have no required value
      expect(forceOpt!.required).toBe(false);
    });

    it('list command --json is a boolean flag', () => {
      const jsonOpt = listCommand.options.find((o) => o.long === '--json');
      expect(jsonOpt).toBeDefined();
      expect(jsonOpt!.required).toBe(false);
    });

    it('logs command --lines option expects a numeric value', () => {
      const linesOpt = logsCommand.options.find((o) => o.long === '--lines');
      expect(linesOpt).toBeDefined();
      expect(linesOpt!.required).toBe(true); // requires a value like <n>
    });

    it('dashboard command --port option has short alias -p', () => {
      const portOpt = dashboardCommand.options.find((o) => o.long === '--port');
      expect(portOpt).toBeDefined();
      expect(portOpt!.short).toBe('-p');
    });

    it('init command --template option expects a value', () => {
      const templateOpt = initCommand.options.find((o) => o.long === '--template');
      expect(templateOpt).toBeDefined();
      expect(templateOpt!.required).toBe(true); // requires a value
    });
  });
});
