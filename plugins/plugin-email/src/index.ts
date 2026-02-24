import type { NovaPMPlugin, PluginContext } from '@novapm/plugin-sdk';
import type { ProcessEvent } from '@novapm/shared';

/**
 * SMTP configuration.
 */
interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

/**
 * Configuration for the Email plugin.
 */
interface EmailConfig {
  smtp: SmtpConfig;
  from: string;
  to: string[];
  events: string[];
  endpoint?: string;
}

/**
 * Prepared email notification payload.
 */
interface EmailPayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  smtp: SmtpConfig;
}

/**
 * Email notification plugin for NovaPM.
 *
 * Sends email notifications for process events. Uses a configurable
 * approach: if an endpoint URL is provided, it POSTs the email payload
 * to that endpoint (e.g., a REST-based email-sending service). Otherwise,
 * logs the notification payload for integration with external systems.
 *
 * This approach keeps the plugin dependency-free (no nodemailer required).
 */
class EmailPlugin implements NovaPMPlugin {
  readonly name = 'plugin-email';
  readonly version = '1.0.0';
  readonly description = 'Email notification plugin for NovaPM';
  readonly author = 'NovaPM Team';

  private context: PluginContext | null = null;
  private config: EmailConfig | null = null;

  async onInit(context: PluginContext): Promise<void> {
    this.context = context;

    const rawConfig = context.config as Record<string, unknown>;
    const smtp = rawConfig.smtp as Record<string, unknown> | undefined;

    if (!smtp || typeof smtp.host !== 'string') {
      throw new Error('Email plugin requires "smtp.host" configuration');
    }

    const auth = smtp.auth as Record<string, unknown> | undefined;
    if (!auth || typeof auth.user !== 'string' || typeof auth.pass !== 'string') {
      throw new Error('Email plugin requires "smtp.auth.user" and "smtp.auth.pass" configuration');
    }

    if (!rawConfig.from || typeof rawConfig.from !== 'string') {
      throw new Error('Email plugin requires a "from" configuration');
    }

    if (!Array.isArray(rawConfig.to) || rawConfig.to.length === 0) {
      throw new Error('Email plugin requires a non-empty "to" array configuration');
    }

    this.config = {
      smtp: {
        host: smtp.host as string,
        port: (smtp.port as number | undefined) ?? 587,
        secure: (smtp.secure as boolean | undefined) ?? false,
        auth: {
          user: auth.user as string,
          pass: auth.pass as string,
        },
      },
      from: rawConfig.from,
      to: rawConfig.to as string[],
      events: Array.isArray(rawConfig.events)
        ? (rawConfig.events as string[])
        : ['crash', 'health-check-fail'],
      endpoint: rawConfig.endpoint as string | undefined,
    };

    context.logger.info(
      { events: this.config.events, to: this.config.to },
      'Email plugin initialized',
    );
  }

  async onDestroy(): Promise<void> {
    this.context?.logger.info('Email plugin destroyed');
  }

  async onProcessCrash(event: ProcessEvent): Promise<void> {
    if (!this.shouldNotify('crash')) return;

    const exitCode = event.data.exitCode ?? 'unknown';
    const signal = event.data.signal ?? 'none';

    await this.sendEmail({
      subject: `[NovaPM CRASH] Process "${event.processName}" crashed`,
      event,
      templateType: 'crash',
      details: {
        exitCode: String(exitCode),
        signal: String(signal),
        time: event.timestamp.toISOString(),
      },
    });
  }

  async onProcessStart(event: ProcessEvent): Promise<void> {
    if (!this.shouldNotify('start')) return;

    await this.sendEmail({
      subject: `[NovaPM] Process "${event.processName}" started`,
      event,
      templateType: 'start',
      details: {
        time: event.timestamp.toISOString(),
      },
    });
  }

  async onProcessStop(event: ProcessEvent): Promise<void> {
    if (!this.shouldNotify('stop')) return;

    await this.sendEmail({
      subject: `[NovaPM] Process "${event.processName}" stopped`,
      event,
      templateType: 'stop',
      details: {
        time: event.timestamp.toISOString(),
      },
    });
  }

  async onProcessRestart(event: ProcessEvent): Promise<void> {
    if (!this.shouldNotify('restart')) return;

    await this.sendEmail({
      subject: `[NovaPM] Process "${event.processName}" restarted`,
      event,
      templateType: 'restart',
      details: {
        time: event.timestamp.toISOString(),
      },
    });
  }

  async onProcessExit(event: ProcessEvent): Promise<void> {
    if (!this.shouldNotify('exit')) return;

    const exitCode = event.data.exitCode ?? 'unknown';

    await this.sendEmail({
      subject: `[NovaPM] Process "${event.processName}" exited (code: ${String(exitCode)})`,
      event,
      templateType: 'exit',
      details: {
        exitCode: String(exitCode),
        time: event.timestamp.toISOString(),
      },
    });
  }

  async onHealthCheckFail(event: ProcessEvent): Promise<void> {
    if (!this.shouldNotify('health-check-fail')) return;

    const reason = event.data.reason ?? 'Health check failed';

    await this.sendEmail({
      subject: `[NovaPM ALERT] Health check failed for "${event.processName}"`,
      event,
      templateType: 'health-check-fail',
      details: {
        reason: String(reason),
        time: event.timestamp.toISOString(),
      },
    });
  }

  async onHealthCheckRestore(event: ProcessEvent): Promise<void> {
    if (!this.shouldNotify('health-check-restore')) return;

    await this.sendEmail({
      subject: `[NovaPM] Health check restored for "${event.processName}"`,
      event,
      templateType: 'health-check-restore',
      details: {
        time: event.timestamp.toISOString(),
      },
    });
  }

  /**
   * Check if notification should be sent for the given event type.
   */
  private shouldNotify(eventType: string): boolean {
    if (!this.config) return false;
    return this.config.events.includes(eventType);
  }

  /**
   * Prepare and send an email notification.
   */
  private async sendEmail(params: {
    subject: string;
    event: ProcessEvent;
    templateType: string;
    details: Record<string, string>;
  }): Promise<void> {
    if (!this.config || !this.context) return;

    const html = this.buildHtmlTemplate(params.event, params.templateType, params.details);
    const text = this.buildTextTemplate(params.event, params.templateType, params.details);

    const payload: EmailPayload = {
      from: this.config.from,
      to: this.config.to,
      subject: params.subject,
      html,
      text,
      smtp: this.config.smtp,
    };

    if (this.config.endpoint) {
      // Send via configured REST endpoint
      try {
        const response = await fetch(this.config.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const body = await response.text();
          this.context.logger.error(
            { status: response.status, body },
            'Failed to send email notification via endpoint',
          );
        } else {
          this.context.logger.debug(
            { subject: params.subject },
            'Email notification sent via endpoint',
          );
        }
      } catch (error) {
        this.context.logger.error({ error }, 'Error sending email notification');
      }
    } else {
      // Log the notification payload when no endpoint is configured
      this.context.logger.info(
        {
          subject: params.subject,
          to: this.config.to,
          templateType: params.templateType,
          processName: params.event.processName,
          processId: params.event.processId,
        },
        'Email notification prepared (no endpoint configured, logging payload)',
      );

      // Store in plugin storage for external integrations to pick up
      const notificationId = `notification:${Date.now()}`;
      await this.context.storage.set(notificationId, {
        ...payload,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Build an HTML email template based on the event type.
   */
  private buildHtmlTemplate(
    event: ProcessEvent,
    templateType: string,
    details: Record<string, string>,
  ): string {
    const severityColor = this.getSeverityColor(templateType);
    const detailRows = Object.entries(details)
      .map(
        ([key, value]) =>
          `<tr><td style="padding:8px;font-weight:bold;color:#555;">${this.escapeHtml(this.formatLabel(key))}</td><td style="padding:8px;">${this.escapeHtml(value)}</td></tr>`,
      )
      .join('');

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:20px;background-color:#f5f5f5;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
    <div style="background:${severityColor};padding:20px;color:#fff;">
      <h1 style="margin:0;font-size:20px;">NovaPM Alert</h1>
      <p style="margin:5px 0 0;opacity:0.9;">${this.escapeHtml(this.getEventTitle(templateType))}</p>
    </div>
    <div style="padding:20px;">
      <h2 style="margin:0 0 15px;color:#333;">${this.escapeHtml(event.processName)}</h2>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px;font-weight:bold;color:#555;">Process ID</td><td style="padding:8px;">${event.processId}</td></tr>
        <tr><td style="padding:8px;font-weight:bold;color:#555;">Event Type</td><td style="padding:8px;">${this.escapeHtml(templateType)}</td></tr>
        ${detailRows}
      </table>
    </div>
    <div style="padding:15px 20px;background:#f9f9f9;color:#999;font-size:12px;border-top:1px solid #eee;">
      Sent by NovaPM Email Plugin | ${new Date().toISOString()}
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Build a plain text email template.
   */
  private buildTextTemplate(
    event: ProcessEvent,
    templateType: string,
    details: Record<string, string>,
  ): string {
    const detailLines = Object.entries(details)
      .map(([key, value]) => `  ${this.formatLabel(key)}: ${value}`)
      .join('\n');

    return `NovaPM Alert: ${this.getEventTitle(templateType)}

Process: ${event.processName}
Process ID: ${event.processId}
Event: ${templateType}

Details:
${detailLines}

---
Sent by NovaPM Email Plugin | ${new Date().toISOString()}`;
  }

  /**
   * Get a human-readable title for the event type.
   */
  private getEventTitle(templateType: string): string {
    const titles: Record<string, string> = {
      crash: 'Process Crashed',
      start: 'Process Started',
      stop: 'Process Stopped',
      restart: 'Process Restarted',
      exit: 'Process Exited',
      'health-check-fail': 'Health Check Failed',
      'health-check-restore': 'Health Check Restored',
    };
    return titles[templateType] ?? 'Process Event';
  }

  /**
   * Get color based on severity of the event.
   */
  private getSeverityColor(templateType: string): string {
    const colors: Record<string, string> = {
      crash: '#dc3545',
      'health-check-fail': '#fd7e14',
      stop: '#ffc107',
      start: '#28a745',
      restart: '#17a2b8',
      exit: '#6c757d',
      'health-check-restore': '#28a745',
    };
    return colors[templateType] ?? '#6c757d';
  }

  /**
   * Format a camelCase or kebab-case key into a human-readable label.
   */
  private formatLabel(key: string): string {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/-/g, ' ')
      .replace(/^\w/, (c) => c.toUpperCase())
      .trim();
  }

  /**
   * Escape HTML special characters.
   */
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

export default new EmailPlugin();
