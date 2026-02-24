import type { NovaPMPlugin, PluginContext } from '@novapm/plugin-sdk';
import type { ProcessEvent } from '@novapm/shared';

/**
 * Configuration for the Discord plugin.
 */
interface DiscordConfig {
  webhookUrl: string;
  events: string[];
  username?: string;
  avatarUrl?: string;
}

/**
 * Discord embed object.
 */
interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields: DiscordEmbedField[];
  footer: { text: string };
  timestamp: string;
}

interface DiscordEmbedField {
  name: string;
  value: string;
  inline: boolean;
}

/**
 * Discord webhook payload.
 */
interface DiscordPayload {
  username?: string;
  avatar_url?: string;
  embeds: DiscordEmbed[];
}

/**
 * Discord embed color values by severity.
 * Discord colors are decimal representations of hex values.
 */
const SEVERITY_COLORS: Record<string, number> = {
  crash: 0xff0000, // Red
  'health-check-fail': 0xff6600, // Orange
  stop: 0xffa500, // Amber
  start: 0x36a64f, // Green
  restart: 0x2196f3, // Blue
  exit: 0x808080, // Gray
  'health-check-restore': 0x36a64f, // Green
  default: 0x808080, // Gray
};

/**
 * Discord notification plugin for NovaPM.
 *
 * Sends formatted embed notifications to a Discord channel via webhooks.
 * Features Discord-specific formatting with colored embed sidebars
 * based on event severity.
 */
class DiscordPlugin implements NovaPMPlugin {
  readonly name = 'plugin-discord';
  readonly version = '1.0.0';
  readonly description = 'Discord notification plugin for NovaPM';
  readonly author = 'NovaPM Team';

  private context: PluginContext | null = null;
  private config: DiscordConfig | null = null;

  async onInit(context: PluginContext): Promise<void> {
    this.context = context;

    const rawConfig = context.config as Record<string, unknown>;
    if (!rawConfig.webhookUrl || typeof rawConfig.webhookUrl !== 'string') {
      throw new Error('Discord plugin requires a "webhookUrl" configuration');
    }

    this.config = {
      webhookUrl: rawConfig.webhookUrl,
      events: Array.isArray(rawConfig.events)
        ? (rawConfig.events as string[])
        : ['crash', 'health-check-fail'],
      username: (rawConfig.username as string | undefined) ?? 'NovaPM',
      avatarUrl: rawConfig.avatarUrl as string | undefined,
    };

    context.logger.info(
      { events: this.config.events },
      'Discord plugin initialized',
    );
  }

  async onDestroy(): Promise<void> {
    this.context?.logger.info('Discord plugin destroyed');
  }

  async onProcessStart(event: ProcessEvent): Promise<void> {
    if (!this.shouldNotify('start')) return;

    await this.sendNotification(event, 'start', {
      title: 'Process Started',
      description: `Process **${event.processName}** (ID: ${event.processId}) has started.`,
    });
  }

  async onProcessStop(event: ProcessEvent): Promise<void> {
    if (!this.shouldNotify('stop')) return;

    await this.sendNotification(event, 'stop', {
      title: 'Process Stopped',
      description: `Process **${event.processName}** (ID: ${event.processId}) has stopped.`,
    });
  }

  async onProcessRestart(event: ProcessEvent): Promise<void> {
    if (!this.shouldNotify('restart')) return;

    await this.sendNotification(event, 'restart', {
      title: 'Process Restarted',
      description: `Process **${event.processName}** (ID: ${event.processId}) has been restarted.`,
    });
  }

  async onProcessCrash(event: ProcessEvent): Promise<void> {
    if (!this.shouldNotify('crash')) return;

    const exitCode = event.data.exitCode ?? 'unknown';
    const signal = event.data.signal ?? 'none';

    await this.sendNotification(event, 'crash', {
      title: 'PROCESS CRASHED',
      description: `Process **${event.processName}** (ID: ${event.processId}) has crashed!`,
      fields: [
        { name: 'Exit Code', value: String(exitCode), inline: true },
        { name: 'Signal', value: String(signal), inline: true },
        { name: 'Time', value: event.timestamp.toISOString(), inline: false },
      ],
    });
  }

  async onProcessExit(event: ProcessEvent): Promise<void> {
    if (!this.shouldNotify('exit')) return;

    const exitCode = event.data.exitCode ?? 'unknown';

    await this.sendNotification(event, 'exit', {
      title: 'Process Exited',
      description: `Process **${event.processName}** (ID: ${event.processId}) exited with code ${String(exitCode)}.`,
      fields: [
        { name: 'Exit Code', value: String(exitCode), inline: true },
      ],
    });
  }

  async onHealthCheckFail(event: ProcessEvent): Promise<void> {
    if (!this.shouldNotify('health-check-fail')) return;

    const reason = event.data.reason ?? 'Health check failed';

    await this.sendNotification(event, 'health-check-fail', {
      title: 'Health Check Failed',
      description: `Health check failed for process **${event.processName}** (ID: ${event.processId}).`,
      fields: [
        { name: 'Reason', value: String(reason), inline: false },
        { name: 'Process ID', value: String(event.processId), inline: true },
        { name: 'Time', value: event.timestamp.toISOString(), inline: true },
      ],
    });
  }

  async onHealthCheckRestore(event: ProcessEvent): Promise<void> {
    if (!this.shouldNotify('health-check-restore')) return;

    await this.sendNotification(event, 'health-check-restore', {
      title: 'Health Check Restored',
      description: `Health check restored for process **${event.processName}** (ID: ${event.processId}).`,
    });
  }

  /**
   * Check if a notification should be sent for the given event type.
   */
  private shouldNotify(eventType: string): boolean {
    if (!this.config) return false;
    return this.config.events.includes(eventType);
  }

  /**
   * Send a formatted Discord embed notification via webhook.
   */
  private async sendNotification(
    event: ProcessEvent,
    eventType: string,
    details: {
      title: string;
      description: string;
      fields?: DiscordEmbedField[];
    },
  ): Promise<void> {
    if (!this.config || !this.context) return;

    const payload = this.buildPayload(event, eventType, details);

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text();
        this.context.logger.error(
          { status: response.status, body },
          'Failed to send Discord notification',
        );
      } else {
        this.context.logger.debug(
          { eventType, processName: event.processName },
          'Discord notification sent',
        );
      }
    } catch (error) {
      this.context.logger.error({ error }, 'Error sending Discord notification');
    }
  }

  /**
   * Build a Discord webhook payload with embed.
   */
  private buildPayload(
    event: ProcessEvent,
    eventType: string,
    details: {
      title: string;
      description: string;
      fields?: DiscordEmbedField[];
    },
  ): DiscordPayload {
    const color = SEVERITY_COLORS[eventType] ?? SEVERITY_COLORS.default;

    const embed: DiscordEmbed = {
      title: details.title,
      description: details.description,
      color,
      fields: [
        { name: 'Process', value: event.processName, inline: true },
        { name: 'Process ID', value: String(event.processId), inline: true },
        ...(details.fields ?? []),
      ],
      footer: { text: 'NovaPM Process Manager' },
      timestamp: event.timestamp.toISOString(),
    };

    const payload: DiscordPayload = {
      embeds: [embed],
    };

    if (this.config?.username) {
      payload.username = this.config.username;
    }

    if (this.config?.avatarUrl) {
      payload.avatar_url = this.config.avatarUrl;
    }

    return payload;
  }
}

export default new DiscordPlugin();
