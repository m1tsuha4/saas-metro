import { Injectable } from '@nestjs/common';
import { GoogleEmailService } from './google.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { buildMime } from './dto/email.dto';

function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }
function withJitter(base: number, jitter: number) {
  const delta = Math.floor((Math.random()*2 - 1) * jitter);
  return Math.max(0, base + delta);
}

@Injectable()
export class EmailService {
  constructor(private prisma: PrismaService, private gsvc: GoogleEmailService) {}

  /** Single test email */
  async sendTest(fromEmail: string, toEmail: string, subject: string, html: string) {
    const gmail = await this.gsvc.getAuthorizedClient(fromEmail);
    const raw = Buffer.from(buildMime(fromEmail, toEmail, subject, html))
      .toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw }});
    return { success: true };
  }

  /** Broadcast to many recipients with throttle */
  async broadcast(
    ownerId: string,
    dto: {
      fromEmail: string; subject: string; html: string;
      recipients: { email: string; name?: string }[];
      delayMs: number; jitterMs: number;
  }) {
    const gmail = await this.gsvc.getAuthorizedClient(dto.fromEmail);

    const camp = await this.prisma.emailCampaign.create({
      data: {
        ownerId,
        fromEmail: dto.fromEmail,
        subject: dto.subject,
        html: dto.html,
        delayMs: dto.delayMs,
        jitterMs: dto.jitterMs,
      },
      select: { id: true },
    });

    const results: Array<{ email: string; status: 'SENT'|'FAILED'; error?: string }> = [];

    for (const r of dto.recipients) {
      const to = r.email.toLowerCase().trim();
      try {
        // simple personalization: {{name}}
        const subject = dto.subject.replace(/\{\{name\}\}/g, r.name ?? '');
        const html = dto.html.replace(/\{\{name\}\}/g, r.name ?? '');

        const raw = Buffer.from(buildMime(dto.fromEmail, to, subject, html))
          .toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

        await gmail.users.messages.send({ userId: 'me', requestBody: { raw }});

        results.push({ email: to, status: 'SENT' });
        await this.prisma.emailMessage.create({
          data: { campaignId: camp.id, toEmail: to, subject, status: 'SENT' },
        });

        await sleep(withJitter(dto.delayMs, dto.jitterMs));
      } catch (e: any) {
        const msg = e?.message || 'Send failed';
        results.push({ email: to, status: 'FAILED', error: msg });
        await this.prisma.emailMessage.create({
          data: { campaignId: camp.id, toEmail: to, subject: dto.subject, status: 'FAILED', error: msg },
        });
        await sleep(withJitter(Math.max(dto.delayMs, 1200), dto.jitterMs));
      }
    }

    const summary = results.reduce((a, r) => {
      a[r.status] = (a[r.status] || 0) + 1;
      return a;
    }, {} as Record<string, number>);

    return { campaignId: camp.id, total: results.length, summary, results };
  }
}
