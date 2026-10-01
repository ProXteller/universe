/**
 * Mailer interface (Constitution §6, SPEC §4.2.15): console transport by default; Resend over `fetch` when
 * `RESEND_API_KEY` is set. In PRODUCTION without a provider the console transport MUST NOT be used:
 * `getMailer()` throws 503 `mail_unavailable` (and boot logs the error of §4.2.1).
 */
import { config } from '../config';
import { ApiError } from './http';
import { log } from './logger';

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

export const MAIL_UNAVAILABLE_MESSAGE = "We can't send sign-in codes right now. Please try again soon.";

class ConsoleMailer implements Mailer {
  async send(to: string, subject: string, text: string): Promise<void> {
    log.info(`[mail → ${to}] ${subject}\n${text}`);
  }
}

class ResendMailer implements Mailer {
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async send(to: string, subject: string, text: string): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [to], subject, text }),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}`);
  }
}

let override: Mailer | null = null;

/** Tests / scripted boots ("stub mailer"): an injected mailer counts as a configured provider. `null` removes it. */
export function setMailer(mailer: Mailer | null): void {
  override = mailer;
}

export function mailProviderConfigured(): boolean {
  return override !== null || config.resendApiKey !== null;
}

export function getMailer(): Mailer {
  if (override) return override;
  if (config.resendApiKey) return new ResendMailer(config.resendApiKey, config.mailFrom);
  if (config.env === 'production') throw new ApiError(503, 'mail_unavailable', MAIL_UNAVAILABLE_MESSAGE);
  return new ConsoleMailer();
}
