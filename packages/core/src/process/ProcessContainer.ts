import { fork, spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import type { AppConfig, NovaProcess, ProcessStatus } from '@novapm/shared';
import {
  DEFAULT_INTERPRETER,
  DEFAULT_KILL_TIMEOUT,
  DEFAULT_MAX_RESTARTS,
  DEFAULT_RESTART_DELAY,
} from '@novapm/shared';
import { gracefulShutdown } from './GracefulShutdown.js';

export class ProcessContainer {
  public readonly id: number;
  public readonly name: string;
  public readonly config: AppConfig;
  public child: ChildProcess | null = null;
  public status: ProcessStatus = 'stopped';
  public pid: number | null = null;
  public restarts: number = 0;
  public startedAt: Date | null = null;
  public createdAt: Date;

  private onStdout: ((data: Buffer) => void) | null = null;
  private onStderr: ((data: Buffer) => void) | null = null;
  private onExit: ((code: number | null, signal: string | null) => void) | null = null;

  constructor(id: number, name: string, config: AppConfig) {
    this.id = id;
    this.name = name;
    this.config = config;
    this.createdAt = new Date();
  }

  setOutputHandlers(stdout: (data: Buffer) => void, stderr: (data: Buffer) => void): void {
    this.onStdout = stdout;
    this.onStderr = stderr;
  }

  setExitHandler(handler: (code: number | null, signal: string | null) => void): void {
    this.onExit = handler;
  }

  start(): void {
    const interpreter = this.config.interpreter || DEFAULT_INTERPRETER;
    const scriptPath = resolve(this.config.cwd || process.cwd(), this.config.script);
    const args = this.normalizeArgs(this.config.args);
    const env = { ...process.env, ...this.config.env };
    const cwd = this.config.cwd || process.cwd();

    this.status = 'launching';

    if (interpreter === 'node' || interpreter === 'nodejs') {
      const nodeArgs = this.normalizeArgs(this.config.node_args);

      this.child = fork(scriptPath, args, {
        cwd,
        env,
        execArgv: nodeArgs,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        detached: false,
      });
    } else {
      const interpreterArgs = this.normalizeArgs(this.config.interpreterArgs);
      const allArgs = [...interpreterArgs, scriptPath, ...args];

      this.child = spawn(interpreter, allArgs, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false,
      });
    }

    this.pid = this.child.pid ?? null;
    this.startedAt = new Date();
    this.status = 'online';

    if (this.child.stdout && this.onStdout) {
      this.child.stdout.on('data', this.onStdout);
    }
    if (this.child.stderr && this.onStderr) {
      this.child.stderr.on('data', this.onStderr);
    }

    this.child.once('exit', (code: number | null, signal: string | null) => {
      this.pid = null;
      if (this.onExit) {
        this.onExit(code, signal);
      }
    });

    this.child.once('error', (_err: Error) => {
      this.status = 'errored';
      this.pid = null;
      if (this.onExit) {
        this.onExit(1, null);
      }
    });
  }

  async stop(force: boolean = false): Promise<void> {
    if (!this.child || this.status === 'stopped') return;

    this.status = 'stopping';

    if (force) {
      try {
        this.child.kill('SIGKILL');
      } catch {
        // Already dead
      }
    } else {
      const timeout = this.config.kill_timeout || DEFAULT_KILL_TIMEOUT;
      await gracefulShutdown(this.child, {
        timeout,
        useMessage: false,
      });
    }

    this.status = 'stopped';
    this.pid = null;
    this.child = null;
  }

  isRunning(): boolean {
    return this.status === 'online' || this.status === 'launching';
  }

  getUptime(): number {
    if (!this.startedAt) return 0;
    return Math.floor((Date.now() - this.startedAt.getTime()) / 1000);
  }

  toNovaProcess(): NovaProcess {
    return {
      id: this.id,
      name: this.name,
      script: this.config.script,
      cwd: this.config.cwd || process.cwd(),
      args: this.normalizeArgs(this.config.args),
      interpreter: this.config.interpreter || DEFAULT_INTERPRETER,
      interpreterArgs: this.normalizeArgs(this.config.interpreterArgs),
      execMode: this.config.exec_mode || 'fork',
      instances: typeof this.config.instances === 'number' ? this.config.instances : 1,
      status: this.status,
      pid: this.pid,
      port: this.config.port ?? null,
      env: this.config.env || {},
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      restarts: this.restarts,
      maxRestarts: this.config.max_restarts ?? DEFAULT_MAX_RESTARTS,
      restartDelay: this.config.restart_delay ?? DEFAULT_RESTART_DELAY,
      expBackoffRestartDelay: this.config.exp_backoff_restart_delay ?? 0,
      maxMemoryRestart: this.config.max_memory_restart ?? null,
      autorestart: this.config.autorestart ?? true,
      watch: this.config.watch ?? false,
      ignoreWatch: this.config.ignore_watch ?? [],
      killTimeout: this.config.kill_timeout ?? DEFAULT_KILL_TIMEOUT,
      listenTimeout: this.config.listen_timeout ?? 8000,
      shutdownWithMessage: false,
      windowsHide: false,
      mergeLogs: this.config.merge_logs ?? false,
      sourceMapSupport: this.config.source_map_support ?? false,
      vizion: false,
    };
  }

  private normalizeArgs(args: string | string[] | undefined): string[] {
    if (!args) return [];
    if (typeof args === 'string') return args.split(/\s+/).filter(Boolean);
    return args;
  }
}
