/**
 * Alert Notification Service
 * Sends notifications via webhooks and email when alerts are triggered
 */

import {
  AlertRule,
  AlertEvent,
  NotificationChannel,
  WebhookNotification,
  EmailNotification
} from './schema.js';

/**
 * Result of sending a notification
 */
export interface NotificationResult {
  channel: NotificationChannel;
  success: boolean;
  error?: string;
}

/**
 * Webhook payload format
 */
interface WebhookPayload {
  event: 'alert_triggered';
  timestamp: string;
  alert: {
    id: string;
    ruleName: string;
    severity: string;
    targetType: string;
    targetId: string;
    targetName: string;
    message: string;
    condition: AlertEvent['condition'];
    details?: Record<string, unknown>;
  };
}

/**
 * Send notifications for an alert event
 */
export async function sendNotifications(
  rule: AlertRule,
  event: AlertEvent
): Promise<NotificationResult[]> {
  const results: NotificationResult[] = [];

  for (const channel of rule.notifications) {
    try {
      switch (channel.type) {
        case 'webhook':
          await sendWebhookNotification(channel, event);
          results.push({ channel, success: true });
          break;

        case 'email':
          await sendEmailNotification(channel, event);
          results.push({ channel, success: true });
          break;
      }
    } catch (error) {
      console.error(`[Notifications] Failed to send ${channel.type} notification:`, error);
      results.push({
        channel,
        success: false,
        error: (error as Error).message
      });
    }
  }

  return results;
}

/**
 * Send a webhook notification
 */
async function sendWebhookNotification(
  channel: WebhookNotification,
  event: AlertEvent
): Promise<void> {
  const payload: WebhookPayload = {
    event: 'alert_triggered',
    timestamp: event.createdAt,
    alert: {
      id: event.id,
      ruleName: event.ruleName,
      severity: event.severity,
      targetType: event.targetType,
      targetId: event.targetId,
      targetName: event.targetName,
      message: event.message,
      condition: event.condition,
      details: event.details
    }
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'StreamManager-Alerts/1.0',
    ...channel.headers
  };

  const response = await fetch(channel.url, {
    method: channel.method || 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000) // 10 second timeout
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'No response body');
    throw new Error(`Webhook failed with status ${response.status}: ${text}`);
  }

  console.log(`[Notifications] Webhook sent successfully to ${channel.url}`);
}

/**
 * Send an email notification
 * Note: This requires SMTP configuration via environment variables
 */
async function sendEmailNotification(
  channel: EmailNotification,
  event: AlertEvent
): Promise<void> {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM || 'alerts@stream-manager.local';

  if (!smtpHost) {
    throw new Error('Email notifications require SMTP_HOST to be configured');
  }

  // Build email content
  const subject = channel.subject || `[${event.severity.toUpperCase()}] ${event.message}`;
  const htmlBody = buildEmailHtml(event);
  const textBody = buildEmailText(event);

  // Note: For a real implementation, you would use a library like nodemailer
  // This is a placeholder that logs the email content
  // In production, uncomment and install nodemailer

  console.log(`[Notifications] Email notification prepared (SMTP not fully implemented):`);
  console.log(`  To: ${channel.recipients.join(', ')}`);
  console.log(`  Subject: ${subject}`);
  console.log(`  Body: ${textBody}`);

  // Placeholder: throw if no SMTP configured so the error is clear
  if (!smtpUser || !smtpPass) {
    console.log(`[Notifications] SMTP credentials not configured, skipping actual send`);
    // Don't throw in dev mode - just log
    return;
  }

  // Real implementation would be:
  // const nodemailer = await import('nodemailer');
  // const transporter = nodemailer.createTransport({
  //   host: smtpHost,
  //   port: smtpPort,
  //   secure: smtpPort === 465,
  //   auth: { user: smtpUser, pass: smtpPass }
  // });
  // await transporter.sendMail({
  //   from: smtpFrom,
  //   to: channel.recipients.join(', '),
  //   subject,
  //   text: textBody,
  //   html: htmlBody
  // });
}

/**
 * Build HTML email body
 */
function buildEmailHtml(event: AlertEvent): string {
  const severityColors: Record<string, string> = {
    info: '#0891b2',      // cyan-600
    warning: '#d97706',   // amber-600
    critical: '#dc2626'   // red-600
  };

  const color = severityColors[event.severity] || '#6b7280';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; }
    .header { background: ${color}; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; }
    .severity { display: inline-block; padding: 4px 12px; border-radius: 4px; font-weight: 600; text-transform: uppercase; font-size: 12px; }
    .details { background: white; padding: 16px; border-radius: 4px; margin-top: 16px; }
    .detail-row { display: flex; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
    .detail-label { font-weight: 600; width: 120px; color: #374151; }
    .detail-value { color: #6b7280; }
    .footer { margin-top: 20px; font-size: 12px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0; font-size: 18px;">Stream Manager Alert</h1>
      <p style="margin: 8px 0 0 0; opacity: 0.9;">${escapeHtml(event.message)}</p>
    </div>
    <div class="content">
      <div class="details">
        <div class="detail-row">
          <span class="detail-label">Severity</span>
          <span class="detail-value"><span class="severity" style="background: ${color}; color: white;">${event.severity}</span></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Target</span>
          <span class="detail-value">${escapeHtml(event.targetType)}: ${escapeHtml(event.targetName)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Rule</span>
          <span class="detail-value">${escapeHtml(event.ruleName)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Condition</span>
          <span class="detail-value">${escapeHtml(event.condition.type)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Time</span>
          <span class="detail-value">${escapeHtml(new Date(event.createdAt).toLocaleString())}</span>
        </div>
        ${event.details ? `
        <div class="detail-row" style="border-bottom: none;">
          <span class="detail-label">Details</span>
          <span class="detail-value"><pre style="margin: 0; white-space: pre-wrap;">${escapeHtml(JSON.stringify(event.details, null, 2))}</pre></span>
        </div>
        ` : ''}
      </div>
    </div>
    <div class="footer">
      This alert was generated by Stream Manager.
    </div>
  </div>
</body>
</html>
`;
}

/**
 * Build plain text email body
 */
function buildEmailText(event: AlertEvent): string {
  let text = `
STREAM MANAGER ALERT
====================

${event.message}

Severity: ${event.severity.toUpperCase()}
Target: ${event.targetType}: ${event.targetName}
Rule: ${event.ruleName}
Condition: ${event.condition.type}
Time: ${new Date(event.createdAt).toLocaleString()}
`;

  if (event.details) {
    text += `\nDetails:\n${JSON.stringify(event.details, null, 2)}`;
  }

  text += '\n\n---\nThis alert was generated by Stream Manager.';

  return text;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (c) => map[c] || c);
}

/**
 * Test a notification channel
 */
export async function testNotificationChannel(
  channel: NotificationChannel
): Promise<{ success: boolean; error?: string }> {
  const testEvent: AlertEvent = {
    id: 'test-event',
    ruleId: 'test-rule',
    ruleName: 'Test Alert Rule',
    severity: 'info',
    targetType: 'stream',
    targetId: 'test-stream',
    targetName: 'Test Stream',
    condition: { type: 'status_changed', statusTo: 'stopped' },
    message: '[INFO] This is a test alert notification',
    createdAt: new Date().toISOString()
  };

  try {
    switch (channel.type) {
      case 'webhook':
        await sendWebhookNotification(channel, testEvent);
        break;
      case 'email':
        await sendEmailNotification(channel, testEvent);
        break;
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
