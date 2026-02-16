import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type GroupMetadata,
} from '@whiskeysockets/baileys';
import * as fs from 'fs';
import * as path from 'path';
import * as qrcode from 'qrcode';
import pino from 'pino';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import axios from 'axios';
import { run } from 'googleapis/build/src/apis/run';

type SessionRuntime = {
  qr?: string;
  sock?: ReturnType<typeof makeWASocket>;
  ready: boolean;
  ownerId?: string;
  connecting: boolean;
};

type BroadcastTextInput = {
  sessionId: string;
  recipients?: string[];
  contactIds?: string[];
  useAllContacts?: boolean;
  text: string;
  delayMs: number;
  jitterMs: number;
  checkNumber: boolean;
};

type BroadcastImageInput = {
  sessionId: string;
  recipients?: string[];
  contactIds?: string[];
  useAllContacts?: boolean;
  caption?: string;
  imageUrl: string;
  delayMs: number;
  jitterMs: number;
  checkNumber: boolean;
};

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function withJitter(base: number, jitter: number) {
  if (jitter <= 0) return base;
  const delta = Math.floor((Math.random() * 2 - 1) * jitter);
  return Math.max(0, base + delta);
}

function countStatuses(items: { status: string }[]) {
  return items.reduce(
    (acc, it) => {
      acc[it.status] = ((acc[it.status] || 0) as number) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
}

@Injectable()
export class WaService {
  private readonly logger = new Logger('WaService');
  private sessions = new Map<string, SessionRuntime>();

  constructor(private prisma: PrismaService) {}

  /** absolute dir where Baileys stores auth for this session */
  private sessionPath(sessionId: string): string {
    const base = process.env.WA_AUTH_DIR || path.join(process.cwd(), 'wa-auth');
    return path.join(base, sessionId);
  }

  /** Create/(re)connect a session; returns QR (if needed) */
  async connect(sessionId: string, ownerId: string, label?: string) {
    // Singleton guard
    const existing = this.sessions.get(sessionId);
    if (existing?.connecting || existing?.sock) {
      return {
        sessionId,
        connected: existing.ready,
        qr: existing.qr ?? null,
      };
    }

    // Prepare runtime
    const runtime: SessionRuntime = {
      ready: false,
      ownerId,
      connecting: true,
    };
    this.sessions.set(sessionId, runtime);

    // Prepare auth
    const authDir = this.sessionPath(sessionId);
    fs.mkdirSync(authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    // Create socket
    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(
          state.keys,
          pino({ level: 'silent' }),
        ),
      },
      logger: pino({ level: 'info' }),
      browser: [
        'Mitbiz',
        process.env.NODE_ENV ?? 'local',
        sessionId.slice(0, 6),
      ],
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    runtime.sock = sock;
    this.registerMessageListener(sock, sessionId);

    // Persist credentials
    sock.ev.on('creds.update', saveCreds);

    // Handle connection lifecycle
    sock.ev.on('connection.update', async (u) => {
      const { connection, qr, lastDisconnect } = u;

      if (qr) {
        runtime.qr = await qrcode.toDataURL(qr);
        runtime.ready = false;
        this.logger.log(`QR generated for ${sessionId}`);
      }

      if (connection === 'open') {
        runtime.ready = true;
        runtime.qr = undefined;

        const me = sock.user?.id ?? null;

        // create once, update later
        const exists = await this.prisma.whatsAppSession.findUnique({
          where: { id: sessionId },
          select: { id: true },
        });

        if (!exists) {
          await this.prisma.whatsAppSession.create({
            data: {
              id: sessionId,
              label,
              ownerId,
              statePath: authDir,
              meJid: me,
              connected: true,
            },
          });
        } else {
          await this.prisma.whatsAppSession.update({
            where: { id: sessionId },
            data: {
              connected: true,
              meJid: me,
            },
          });
        }

        this.logger.log(`Session ${sessionId} connected as ${me}`);
      }

      if (connection === 'close') {
        const code = (lastDisconnect as any)?.error?.output?.statusCode;
        this.logger.warn(`Session ${sessionId} closed (${code})`);

        runtime.ready = false;
        runtime.qr = undefined;

        await this.prisma.whatsAppSession.updateMany({
          where: { id: sessionId },
          data: { connected: false },
        });

        // Destroy socket BEFORE reconnect
        try {
          sock.end(new Error('Socket restart'));
        } catch (error: any) {
          this.logger.warn(
            `Error ending socket for session ${sessionId}: ${error.message}`,
          );
        }

        this.sessions.delete(sessionId);

        // reconnect only if not logged out
        if (code !== DisconnectReason.loggedOut) {
          setTimeout(() => {
            this.connect(sessionId, ownerId, label).catch(() => {});
          }, 3000);
        }
      }
    });

    // Wait for QR or open (optional API response)
    const result = await new Promise<{
      connected: boolean;
      qr?: string | null;
    }>((resolve) => {
      let done = false;

      const timeout = setTimeout(() => {
        if (!done) {
          done = true;
          resolve({ connected: runtime.ready, qr: runtime.qr ?? null });
        }
      }, 20000);

      sock.ev.on('connection.update', (u) => {
        if (done) return;
        if (u.qr || u.connection === 'open') {
          clearTimeout(timeout);
          done = true;
          resolve({ connected: runtime.ready, qr: runtime.qr ?? null });
        }
      });
    });

    return { sessionId, ...result };
  }

  /** List all sessions from database */
  async listSessions(ownerId: string) {
    const sessions = await this.prisma.whatsAppSession.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
    });
    return { sessions };
  }

  /** Return current QR (if any) */
  getQr(sessionId: string) {
    const rt = this.sessions.get(sessionId);
    if (!rt)
      throw new NotFoundException(
        'Session not initialized. Call /wa/session/:id/connect first.',
      );
    return { sessionId, qr: rt.qr ?? null, connected: rt.ready };
  }

  /** Send text message */
  async sendText(sessionId: string, toPhoneE164: string, text: string) {
    const rt = await this.ensureConnected(sessionId);

    const jid = this.phoneToJid(toPhoneE164);
    const res = await rt.sock.sendMessage(jid, { text });

    // Narrowing & fallback for strict TS
    const messageId = res && res.key ? (res.key.id ?? null) : null;
    if (!messageId) {
      this.logger.warn(`sendMessage returned no messageId for ${jid}`);
    }

    if (messageId) {
      await this.upsertConversation({
        sessionId,
        jid,
        text,
        messageType: 'conversation',
        messageId,
        fromMe: true,
      });
    }

    return { messageId, to: jid };
  }

  /** Check if number has WhatsApp account */
  async checkNumber(sessionId: string, toPhoneE164: string) {
    const rt = await this.ensureConnected(sessionId);

    const jid = this.phoneToJid(toPhoneE164);
    const info = await rt.sock.onWhatsApp(jid);

    // Ensure array & pick first
    const first = Array.isArray(info) ? info[0] : undefined;
    const exists = !!first?.exists;
    const resolvedJid = first?.jid ?? null;

    return { exists, jid: resolvedJid };
  }

  /** Ensure session is connected (reconnect if needed) */
  private async ensureConnected(
    sessionId: string,
  ): Promise<SessionRuntime & { sock: ReturnType<typeof makeWASocket> }> {
    let rt = this.sessions.get(sessionId);

    // If session exists in memory and socket is ready, return it
    if (rt?.sock && rt.ready) {
      return rt as SessionRuntime & { sock: ReturnType<typeof makeWASocket> };
    }

    // Check if session exists in database and is marked as connected
    const dbSession = await this.prisma.whatsAppSession.findUnique({
      where: { id: sessionId },
    });

    // If session exists in DB and marked as connected, try to reconnect
    if (dbSession?.connected) {
      this.logger.log(
        `Reconnecting session ${sessionId} that was lost from memory`,
      );
      try {
        const ownerForReconnect = dbSession.ownerId ?? rt?.ownerId;
        if (!ownerForReconnect) {
          throw new BadRequestException('Owner not found for this session');
        }
        await this.connect(
          sessionId,
          ownerForReconnect,
          dbSession.label ?? undefined,
        );
        // Wait a bit for connection to establish
        await new Promise((resolve) => setTimeout(resolve, 2000));
        rt = this.sessions.get(sessionId);
        if (rt?.sock && rt.ready) {
          return rt as SessionRuntime & {
            sock: ReturnType<typeof makeWASocket>;
          };
        }
      } catch (error: any) {
        this.logger.error(
          `Failed to reconnect session ${sessionId}:`,
          error.message,
        );
      }
    }

    throw new NotFoundException(
      'Session not connected. Please connect the session first.',
    );
  }

  /** Fetch groups & members (POC; mind ToS) */
  async fetchGroups(sessionId: string) {
    const rt = await this.ensureConnected(sessionId);

    const participating = await rt.sock.groupFetchAllParticipating();
    const metaMap = participating as unknown as Record<string, GroupMetadata>;
    const groups = Object.values(metaMap).map((g) => ({
      id: g.id,
      subject: g.subject,
      size: g.size,
      participants: g.participants?.length ?? 0,
    }));

    return { count: groups.length, groups };
  }

  /** Logout & keep auth files (or delete to force re-scan) */
  async logout(sessionId: string) {
    const rt = this.sessions.get(sessionId);

    try {
      if (rt?.sock) {
        await rt.sock.logout();
        // Clean up the runtime
        rt.sock = undefined;
        rt.ready = false;
        rt.qr = undefined;
      }
    } catch (error: any) {
      this.logger.warn(
        `Error during socket logout for session ${sessionId}:`,
        error.message,
      );
      // Continue even if logout fails - still update DB
    }

    try {
      await this.prisma.whatsAppSession.updateMany({
        where: { id: sessionId },
        data: { connected: false },
      });
    } catch (error: any) {
      this.logger.error(
        `Error updating session ${sessionId} in database:`,
        error.message,
      );
      throw new NotFoundException(
        `Failed to update session status: ${error.message}`,
      );
    }

    // Remove from runtime map
    this.sessions.delete(sessionId);

    this.logger.log(`Session ${sessionId} logged out successfully`);
    return { success: true };
  }

  async broadcastText(ownerId: string, dto: BroadcastTextInput) {
    const { sessionId, text, delayMs, jitterMs, checkNumber } = dto;
    const recipients = await this.resolveWhatsAppRecipients(ownerId, dto);
    if (!recipients.length) {
      throw new BadRequestException(
        'No recipients resolved from request or stored contacts.',
      );
    }

    await this.ensureConnected(sessionId);

    // optional: create a campaign row
    let campaignId: string | undefined;
    try {
      const camp = await this.prisma.waCampaign.create({
        data: { sessionId, type: 'TEXT', text, delayMs, jitterMs },
        select: { id: true },
      });
      campaignId = camp.id;
    } catch {
      /* schema optional */
    }

    const results: Array<{
      phone: string;
      status: 'SENT' | 'SKIPPED' | 'FAILED';
      error?: string;
    }> = [];

    for (const entry of recipients) {
      const phone = entry.phone;
      try {
        if (checkNumber) {
          const check = await this.checkNumber(sessionId, phone);
          if (!check.exists) {
            results.push({
              phone,
              status: 'SKIPPED',
              error: 'Not on WhatsApp',
            });
            // optional: mark contact inactive in DB
            await this.prisma.whatsAppMessage
              ?.create?.({
                data: {
                  phone,
                  contactId: entry.contactId ?? null,
                  sessionId,
                  campaignId,
                  direction: 'OUTGOING',
                  text,
                  status: 'FAILED',
                  errorMessage: 'Not on WhatsApp',
                },
              })
              .catch(() => {});
            continue;
          }
        }

        const sendRes = await this.sendText(sessionId, phone, text);
        results.push({ phone, status: 'SENT' });

        await this.prisma.whatsAppMessage
          ?.create?.({
            data: {
              phone,
              contactId: entry.contactId ?? null,
              sessionId,
              campaignId,
              direction: 'OUTGOING',
              text,
              status: 'SENT',
            },
          })
          .catch(() => {});

        await sleep(withJitter(delayMs, jitterMs)); // atur jarak kirim
      } catch (e: any) {
        const msg = e?.message || 'Send failed';
        results.push({ phone, status: 'FAILED', error: msg });
        await this.prisma.whatsAppMessage
          ?.create?.({
            data: {
              phone,
              contactId: entry.contactId ?? null,
              sessionId,
              campaignId,
              direction: 'OUTGOING',
              text,
              status: 'FAILED',
              errorMessage: msg,
            },
          })
          .catch(() => {});
        // backoff a bit before next number
        await sleep(withJitter(Math.max(delayMs, 1200), jitterMs));
      }
    }

    return {
      campaignId,
      total: recipients.length,
      summary: countStatuses(results),
      results,
    };
  }

  async broadcastImage(ownerId: string, dto: BroadcastImageInput) {
    const { sessionId, caption, imageUrl, delayMs, jitterMs, checkNumber } =
      dto;
    const recipients = await this.resolveWhatsAppRecipients(ownerId, dto);
    if (!recipients.length) {
      throw new BadRequestException(
        'No recipients resolved from request or stored contacts.',
      );
    }

    const rt = await this.ensureConnected(sessionId);

    // prefetch the image once (to avoid downloading for every recipient)
    const imgBuf = await this.fetchImageBuffer(imageUrl);

    // optional: campaign row
    let campaignId: string | undefined;
    try {
      const camp = await this.prisma.waCampaign.create({
        data: {
          sessionId,
          type: 'IMAGE',
          imageUrl,
          text: caption ?? null,
          delayMs,
          jitterMs,
        },
        select: { id: true },
      });
      campaignId = camp.id;
    } catch {}

    const results: Array<{
      phone: string;
      status: 'SENT' | 'SKIPPED' | 'FAILED';
      error?: string;
    }> = [];

    for (const entry of recipients) {
      const phone = entry.phone;
      try {
        if (checkNumber) {
          const check = await this.checkNumber(sessionId, phone);
          if (!check.exists) {
            results.push({
              phone,
              status: 'SKIPPED',
              error: 'Not on WhatsApp',
            });
            await this.prisma.whatsAppMessage
              ?.create?.({
                data: {
                  phone,
                  contactId: entry.contactId ?? null,
                  sessionId,
                  campaignId,
                  direction: 'OUTGOING',
                  text: caption ?? null,
                  mediaUrl: imageUrl,
                  status: 'FAILED',
                  errorMessage: 'Not on WhatsApp',
                },
              })
              .catch(() => {});
            continue;
          }
        }

        const jid = this.phoneToJid(phone);
        const res = await rt.sock!.sendMessage(jid, {
          image: imgBuf, // Buffer
          caption: caption || undefined,
        });

        // update log
        results.push({ phone, status: 'SENT' });
        await this.prisma.whatsAppMessage
          ?.create?.({
            data: {
              phone,
              contactId: entry.contactId ?? null,
              sessionId,
              campaignId,
              direction: 'OUTGOING',
              text: caption ?? null,
              mediaUrl: imageUrl,
              status: 'SENT',
            },
          })
          .catch(() => {});

        await sleep(withJitter(delayMs, jitterMs));
      } catch (e: any) {
        const msg = e?.message || 'Send failed';
        results.push({ phone, status: 'FAILED', error: msg });
        await this.prisma.whatsAppMessage
          ?.create?.({
            data: {
              phone,
              contactId: entry.contactId ?? null,
              sessionId,
              campaignId,
              direction: 'OUTGOING',
              text: caption ?? null,
              mediaUrl: imageUrl,
              status: 'FAILED',
              errorMessage: msg,
            },
          })
          .catch(() => {});
        await sleep(withJitter(Math.max(delayMs, 1500), jitterMs));
      }
    }

    return {
      campaignId,
      total: recipients.length,
      summary: countStatuses(results),
      results,
    };
  }

  // 1) Send into a group chat (text)
  public async groupSendText(dto: {
    sessionId: string;
    groupJid: string;
    text: string;
  }) {
    const rt = await this.ensureConnected(dto.sessionId);

    const res = await rt.sock.sendMessage(dto.groupJid, { text: dto.text });
    return { groupJid: dto.groupJid, messageId: res?.key?.id ?? null };
  }

  // 2) Send into a group chat (image+caption)
  public async groupSendImage(dto: {
    sessionId: string;
    groupJid: string;
    imageUrl: string;
    caption?: string;
  }) {
    const rt = await this.ensureConnected(dto.sessionId);

    const img = await this.fetchImageBuffer(dto.imageUrl);
    const res = await rt.sock.sendMessage(dto.groupJid, {
      image: img,
      caption: dto.caption || undefined,
    });
    return { groupJid: dto.groupJid, messageId: res?.key?.id ?? null };
  }

  // helper to get group metadata & participants
  private async getGroupParticipants(sessionId: string, groupJid: string) {
    const rt = await this.ensureConnected(sessionId);

    const meta = await rt.sock.groupMetadata(groupJid); // returns id, subject, participants[]
    // participants[].id is a JID like '62812...@s.whatsapp.net', .isAdmin/.isSuperAdmin flags exist
    return meta;
  }

  // Get group members (public method for preview)
  public async getGroupMembers(sessionId: string, groupJid: string) {
    const rt = await this.ensureConnected(sessionId);
    const meta = await this.getGroupParticipants(sessionId, groupJid);
    const participants = meta.participants ?? [];

    // Note: LID (Lightweight ID) users don't share their phone numbers
    // We can only identify them by their LID, not by phone number

    return {
      groupJid: meta.id,
      groupSubject: meta.subject,
      total: participants.length,
      members: participants.map((p) => {
        const jid = p.id; // '62xxxxx@s.whatsapp.net' or '226697148420194@lid'
        const isLid = jid.includes('@lid');
        const phone = isLid ? null : jid.split('@')[0];
        const lid = isLid ? jid.split('@')[0] : null;

        return {
          phone,
          lid,
          jid,
          isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
          adminType: p.admin || null,
          hasPhoneNumber: !isLid,
        };
      }),
    };
  }

  // 3) DM every member (text)
  public async groupDmMembersText(dto: {
    sessionId: string;
    groupJid: string;
    text: string;
    delayMs?: number;
    jitterMs?: number;
    includeAdmins?: boolean;
  }) {
    const {
      sessionId,
      groupJid,
      text,
      delayMs = 1500,
      jitterMs = 600,
      includeAdmins = true,
    } = dto;

    const rt = await this.ensureConnected(sessionId);

    if (!rt.sock) {
      throw new BadRequestException('WhatsApp session not found');
    }

    // Get group metadata
    const meta = await rt.sock.groupMetadata(groupJid);
    const participants = meta.participants ?? [];

    // Filter participants
    const targets = participants.filter((p) =>
      includeAdmins ? true : !(p.admin === 'admin' || p.admin === 'superadmin'),
    );

    const results: Array<{
      jid: string;
      status: 'SENT' | 'FAILED';
      error?: string;
    }> = [];

    // Loop safely
    for (const participant of targets) {
      const jid = participant.id; // FULL JID (MD safe)

      try {
        // Skip yourself
        if (jid === rt.sock.user?.id) {
          continue;
        }

        await rt.sock.sendMessage(jid, { text });

        results.push({
          jid,
          status: 'SENT',
        });

        await this.sleepJitter(delayMs, jitterMs);
      } catch (error: any) {
        results.push({
          jid,
          status: 'FAILED',
          error: error?.message || 'Send failed',
        });

        // Longer delay on failure (anti-ban safety)
        await this.sleepJitter(Math.max(delayMs, 2000), jitterMs);
      }
    }

    return {
      success: true,
      groupJid,
      groupSubject: meta.subject,
      totalTargeted: targets.length,
      totalProcessed: results.length,
      summary: this.countStatuses(results),
      results,
    };
  }

  // 4) DM every member (image)
  public async groupDmMembersImage(dto: {
    sessionId: string;
    groupJid: string;
    imageUrl: string;
    caption?: string;
    delayMs?: number;
    jitterMs?: number;
    includeAdmins?: boolean;
  }) {
    const {
      sessionId,
      groupJid,
      imageUrl,
      caption,
      delayMs = 1800,
      jitterMs = 700,
      includeAdmins = true,
    } = dto;

    const rt = await this.ensureConnected(sessionId);

    if (!rt.sock) {
      throw new BadRequestException('WhatsApp session not found');
    }

    const meta = await this.getGroupParticipants(sessionId, groupJid);
    const img = await this.fetchImageBuffer(imageUrl);

    const people = meta.participants ?? [];
    const targets = people.filter((p) =>
      includeAdmins ? true : !(p.admin === 'admin' || p.admin === 'superadmin'),
    );

    const results: Array<{
      jid: string;
      status: 'SENT' | 'FAILED';
      error?: string;
    }> = [];

    for (const participant of targets) {
      const jid = participant.id;

      try {
        if (jid === rt.sock.user?.id) {
          continue;
        }
        await rt.sock.sendMessage(jid, {
          image: img,
          caption: caption || undefined,
        });
        results.push({ jid, status: 'SENT' });
        await this.sleepJitter(delayMs, jitterMs);
      } catch (e: any) {
        results.push({
          jid,
          status: 'FAILED',
          error: e?.message || 'Send failed',
        });
        await this.sleepJitter(Math.max(delayMs, 2000), jitterMs);
      }
    }

    return {
      success: true,
      groupJid,
      groupSubject: meta.subject,
      total: results.length,
      summary: this.countStatuses(results),
      results,
    };
  }

  public async listConversations(params: { sessionId: string }) {
    const { sessionId } = params;
    return this.prisma.whatsAppConversation.findMany({
      where: {
        sessionId,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  public async getConversations(params: {
    sessionId: string;
    jid: string;
    cursor?: string; // messageId cursor
    limit?: number;
  }) {
    const { sessionId, jid, cursor, limit = 30 } = params;

    return this.prisma.whatsAppMessage.findMany({
      where: {
        sessionId,
        phone: jid,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      ...(cursor && {
        skip: 1,
        cursor: { id: cursor },
      }),
    });
  }

  public async markConversationAsRead(sessionId: string, jid: string) {
    await this.prisma.whatsAppConversation.update({
      where: {
        sessionId_jid: { sessionId, jid },
      },
      data: {
        unreadCount: 0,
      },
    });

    return { success: true };
  }

  // small helpers you can place near top/bottom:
  private sleep(ms: number) {
    return new Promise((res) => setTimeout(res, ms));
  }
  private withJitter(base: number, jitter: number) {
    if (jitter <= 0) return base;
    const delta = Math.floor((Math.random() * 2 - 1) * jitter);
    return Math.max(0, base + delta);
  }
  private async sleepJitter(base: number, jitter: number) {
    await this.sleep(this.withJitter(base, jitter));
  }
  private countStatuses(items: { status: string }[]) {
    return items.reduce(
      (acc, it) => {
        acc[it.status] = (acc[it.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
  }

  private async resolveWhatsAppRecipients(
    ownerId: string,
    dto: {
      recipients?: string[];
      contactIds?: string[];
      useAllContacts?: boolean;
    },
  ): Promise<Array<{ phone: string; contactId?: string }>> {
    const recipients = new Map<string, { phone: string; contactId?: string }>();

    if (dto.useAllContacts || (dto.contactIds?.length ?? 0) > 0) {
      const where: any = { ownerId };
      if (!dto.useAllContacts && dto.contactIds?.length) {
        where.id = { in: dto.contactIds };
      }

      const contacts = await this.prisma.whatsAppContact.findMany({
        where,
        select: { id: true, phone: true },
      });

      for (const contact of contacts) {
        const normalized = this.normalizePhoneInput(contact.phone);
        if (!normalized) continue;
        recipients.set(normalized, {
          phone: normalized,
          contactId: contact.id,
        });
      }
    }

    for (const raw of dto.recipients ?? []) {
      const normalized = this.normalizePhoneInput(raw);
      if (!normalized) continue;
      const existing = recipients.get(normalized);
      recipients.set(normalized, {
        phone: normalized,
        contactId: existing?.contactId,
      });
    }

    return Array.from(recipients.values());
  }

  private normalizePhoneInput(input?: string | null): string | null {
    if (!input) return null;
    const digits = `${input}`.replace(/\D/g, '');
    if (digits.length < 6) return null;
    if (digits.startsWith('0')) {
      return `62${digits.slice(1)}`;
    }
    return digits;
  }

  private phoneToJid(e164NoPlus: string) {
    const num = e164NoPlus.replace(/[^\d]/g, '');
    return `${num}@s.whatsapp.net`;
  }

  private async fetchImageBuffer(url: string): Promise<Buffer> {
    const r = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
    });
    return Buffer.from(r.data as any);
  }

  private registerMessageListener(
    sock: ReturnType<typeof makeWASocket>,
    sessionId: string,
  ) {
    sock.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify') return;

      for (const msg of m.messages ?? []) {
        try {
          await this.handleIncomingMessage(sock, sessionId, msg);
        } catch (err: any) {
          this.logger.error(
            `Failed processing message ${msg?.key?.id}: ${err.message}`,
          );
        }
      }
    });
  }

  private async handleIncomingMessage(
    sock: ReturnType<typeof makeWASocket>,
    sessionId: string,
    msg: any,
  ) {
    if (!msg?.message) return;

    const remoteJid = msg.key?.remoteJid;
    const messageId = msg.key?.id;
    const fromMe = msg.key?.fromMe;
    const pushName = msg.pushName;

    if (!remoteJid || !messageId) return;

    // ignore status broadcast
    if (remoteJid === 'status@broadcast') return;

    const isGroup = remoteJid.endsWith('@g.us');

    const conversationJid = remoteJid;

    // Extract message text safely
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      null;

    const messageType = Object.keys(msg.message)[0] || 'unknown';

    await this.prisma.whatsAppMessage.upsert({
      where: { messageId },
      update: {},
      create: {
        sessionId,
        phone: conversationJid,
        direction: fromMe ? 'OUTGOING' : 'INCOMING',
        messageId,
        text,
        type: messageType,
        rawJson: msg,
        status: fromMe ? 'SENT' : 'RECEIVED',
      },
    });

    await this.upsertConversation({
      sessionId,
      jid: remoteJid,
      text,
      name: pushName,
      messageType,
      messageId,
      fromMe,
    });

    this.logger.log(
      `Saved ${messageType} (${fromMe ? 'OUT' : 'IN'}) in ${conversationJid}`,
    );
  }

  private async upsertConversation(params: {
    sessionId: string;
    jid: string;
    text: string | null;
    name?: string | null;
    messageType: string;
    messageId: string;
    fromMe: boolean;
  }) {
    const { sessionId, jid, text, name, messageType, messageId, fromMe } =
      params;

    await this.prisma.whatsAppConversation.upsert({
      where: {
        sessionId_jid: {
          sessionId,
          jid,
        },
      },
      update: {
        lastMessageId: messageId,
        lastMessageText: text,
        lastMessageType: messageType,
        lastMessageAt: new Date(),
        unreadCount: fromMe
          ? { set: 0 } // reset if we sent it
          : { increment: 1 },
        ...(name && { name }),
      },
      create: {
        sessionId,
        jid,
        name: name ?? null,
        isGroup: jid.endsWith('@g.us'),
        lastMessageId: messageId,
        lastMessageText: text,
        lastMessageType: messageType,
        lastMessageAt: new Date(),
        unreadCount: fromMe ? 0 : 1,
      },
    });
  }
}
