import type { NovaPMPlugin, PluginContext } from '@novapm/plugin-sdk';
import type { ProcessEvent } from '@novapm/shared';

/**
 * Configuration for the Slack plugin.
 */
interface SlackConfig {
  webhookUrl: string;
  channel?: string;
  events: string[];
  templates?: Record<string, string>;
  username?: string;
  iconEmoji?: string;
}

/**
 * Slack Block Kit block types used for rich message formatting.
 */
interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  fields?: { type: string; text: string }[];
  elements?: { type: string; text: string }[];
}

/**
 * Slack message payload.
 */
interface SlackPayload {
  channel?: string;
  username?: string;
  icon_emoji?: string;
  attachments: SlackAttachment[];
}

interface SlackAttachment {
  color: string;
  blocks: SlackBlock[];
  fallback: string;
}

/**
 * Severity levels mapped to Slack sidebar colors.
 */
const SEVERITY_COLORS: Record<string, string> = {
  crash: '#FF0000',
  'health-check-fail': '#FF6600',
  stop: '#FFA500',
  start: '#36A64F',
  restart: '#2196F3',
  'health-check-restore': '#36A64F',
  default: '#808080',
};

/**
 * Slack notification plugin for NovaPM.
 *
 * Sends formatted notifications to a Slack channel via incoming webhooks.
 * Supports customizable event filtering and message templates.
 */
class SlackPlugin implements NovaPMPlugin {
  readonly name = 'plugin-slack';
  readonly version = '0.2.0';
  readonly description = 'Slack notification plugin for NovaPM';
  readonly author = 'NovaPM Team';

  private context: PluginContext | null = null;
  private config: SlackConfig | null = null;

  async onInit(context: PluginContext): Promise<void> {
    this.context = context;

    const rawConfig = context.config as Record<string, unknown>;
    if (!rawConfig.webhookUrl || typeof rawConfig.webhookUrl !== 'string') {
      throw new Error('Slack plugin requires a "webhookUrl" configuration');
    }

    this.config = {
      webhookUrl: rawConfig.webhookUrl,
      channel: rawConfig.channel as string | undefined,
      events: Array.isArray(rawConfig.events)
        ? (rawConfig.events as string[])
        : ['crash', 'health-check-fail'],
      templates: rawConfig.templates as Record<string, string> | undefined,
      username: (rawConfig.username as string | undefined) ?? 'NovaPM',
      iconEmoji: (rawConfig.iconEmoji as string | undefined) ?? ':rocket:',
    };

    context.logger.info(
      { events: this.config.events },
      'Slack plugin initialized',
    );
  }

  async onDestroy(): Promise<void> {
    this.context?.logger.info('Slack plugin destroyed');
  }

  async onProcessStart(event: ProcessEvent): Promise<void> {
    if (!this.shouldNotify('start')) return;

    await this.sendNotification(event, 'start', {
      title: `Process Started: ${event.processName}`,
      message: this.getTemplateOrDefault(
        'start',
        `Process \`${event.processName}\` (ID: ${event.processId}) has started.`,
      ),
    });
  }

  async onProcessStop(event: ProcessEvent): Promise<void> {
    if (!this.shouldNotify('stop')) return;

    await this.sendNotification(event, 'stop', {
      title: `Process Stopped: ${event.processName}`,
      message: this.getTemplateOrDefault(
        'stop',
        `Process \`${event.processName}\` (ID: ${event.processId}) has stopped.`,
      ),
    });
  }

  async onProcessRestart(event: ProcessEvent): Promise<void> {
    if (!this.shouldNotify('restart')) return;

    await this.sendNotification(event, 'restart', {
      title: `Process Restarted: ${event.processName}`,
      message: this.getTemplateOrDefault(
        'restart',
        `Process \`${event.processName}\` (ID: ${event.processId}) has been restarted.`,
      ),
    });
  }

  async onProcessCrash(event: ProcessEvent): Promise<void> {
    if (!this.shouldNotify('crash')) return;

    const exitCode = event.data.exitCode ?? 'unknown';
    const signal = event.data.signal ?? 'none';

    await this.sendNotification(event, 'crash', {
      title: `CRASH: ${event.processName}`,
      message: this.getTemplateOrDefault(
        'crash',
        `Process \`${event.processName}\` (ID: ${event.processId}) has crashed!`,
      ),
      fields: [
        { label: 'Exit Code', value: String(exitCode) },
        { label: 'Signal', value: String(signal) },
        { label: 'Time', value: event.timestamp.toISOString() },
      ],
    });
  }

  async onProcessExit(event: ProcessEvent): Promise<void> {
    if (!this.shouldNotify('exit')) return;

    const exitCode = event.data.exitCode ?? 'unknown';

    await this.sendNotification(event, 'exit', {
      title: `Process Exited: ${event.processName}`,
      message: this.getTemplateOrDefault(
        'exit',
        `Process \`${event.processName}\` (ID: ${event.processId}) exited with code ${String(exitCode)}.`,
      ),
    });
  }

  async onHealthCheckFail(event: ProcessEvent): Promise<void> {
    if (!this.shouldNotify('health-check-fail')) return;

    const reason = event.data.reason ?? 'Health check failed';

    await this.sendNotification(event, 'health-check-fail', {
      title: `Health Check Failed: ${event.processName}`,
      message: this.getTemplateOrDefault(
        'health-check-fail',
        `Health check failed for process \`${event.processName}\` (ID: ${event.processId}).`,
      ),
      fields: [
        { label: 'Reason', value: String(reason) },
        { label: 'Process ID', value: String(event.processId) },
        { label: 'Time', value: event.timestamp.toISOString() },
      ],
    });
  }

  async onHealthCheckRestore(event: ProcessEvent): Promise<void> {
    if (!this.shouldNotify('health-check-restore')) return;

    await this.sendNotification(event, 'health-check-restore', {
      title: `Health Check Restored: ${event.processName}`,
      message: this.getTemplateOrDefault(
        'health-check-restore',
        `Health check restored for process \`${event.processName}\` (ID: ${event.processId}).`,
      ),
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
   * Get a template message or fall back to the default.
   */
  private getTemplateOrDefault(eventType: string, defaultMessage: string): string {
    if (this.config?.templates?.[eventType]) {
      return this.config.templates[eventType];
    }
    return defaultMessage;
  }

  /**
   * Send a formatted notification to Slack via the configured webhook URL.
   */
  private async sendNotification(
    event: ProcessEvent,
    eventType: string,
    details: {
      title: string;
      message: string;
      fields?: { label: string; value: string }[];
    },
  ): Promise<void> {
    if (!this.config) return;

    const payload = this.formatMessage(event, eventType, details);

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text();
        this.context?.logger.error(
          { status: response.status, body },
          'Failed to send Slack notification',
        );
      } else {
        this.context?.logger.debug(
          { eventType, processName: event.processName },
          'Slack notification sent',
        );
      }
    } catch (error) {
      this.context?.logger.error({ error }, 'Error sending Slack notification');
    }
  }

  /**
   * Format a Slack message using Block Kit with a colored sidebar.
   */
  private formatMessage(
    _event: ProcessEvent,
    eventType: string,
    details: {
      title: string;
      message: string;
      fields?: { label: string; value: string }[];
    },
  ): SlackPayload {
    const color = SEVERITY_COLORS[eventType] ?? SEVERITY_COLORS.default;

    const blocks: SlackBlock[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: details.title,
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: details.message,
        },
      },
    ];

    if (details.fields && details.fields.length > 0) {
      blocks.push({
        type: 'section',
        fields: details.fields.map((field) => ({
          type: 'mrkdwn',
          text: `*${field.label}:*\n${field.value}`,
        })),
      });
    }

    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `NovaPM | ${new Date().toISOString()}`,
        },
      ],
    });

    const payload: SlackPayload = {
      username: this.config?.username,
      icon_emoji: this.config?.iconEmoji,
      attachments: [
        {
          color,
          blocks,
          fallback: `${details.title}: ${details.message}`,
        },
      ],
    };

    if (this.config?.channel) {
      payload.channel = this.config.channel;
    }

    return payload;
  }
}

export default new SlackPlugin();
