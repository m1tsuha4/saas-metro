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
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import axios from 'axios';

type SessionRuntime = {
  qr?: string;                             
  sock?: ReturnType<typeof makeWASocket>;
  ready: boolean;
};

type BroadcastTextInput = {
  sessionId: string;
  recipients: string[];
  text: string;
  delayMs: number;
  jitterMs: number;
  checkNumber: boolean;
};

type BroadcastImageInput = {
  sessionId: string;
  recipients: string[];
  caption?: string;
  imageUrl: string;
  delayMs: number;
  jitterMs: number;
  checkNumber: boolean;
};

function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms));
}

function withJitter(base: number, jitter: number) {
  if (jitter <= 0) return base;
  const delta = Math.floor((Math.random() * 2 - 1) * jitter);
  return Math.max(0, base + delta);
}

function countStatuses(items: {status:string}[]) {
  return items.reduce((acc, it) => {
    acc[it.status] = (acc[it.status] || 0) as number + 1;
    return acc;
  }, {} as Record<string, number>);
}

@Injectable()
export class WaService {
  private readonly logger = new Logger('WaService');
  private sessions = new Map<string, SessionRuntime>(); 

  constructor(
    private prisma: PrismaService,
  ) {}

  /** absolute dir where Baileys stores auth for this session */
  private sessionPath(sessionId: string): string {
    const base = process.env.WA_AUTH_DIR || path.join(process.cwd(), 'wa-auth');
    return path.join(base, sessionId);           // <-- MUST return
  }

  /** Create/(re)connect a session; returns QR (if needed) */
  async connect(sessionId: string, label?: string) {
    // ensure IPv4 first (important on some local networks)
    import('dns').then(dns => dns.setDefaultResultOrder('ipv4first'));

    const authDir = this.sessionPath(sessionId);
    fs.mkdirSync(authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    // prepare runtime holder
    const runtime: SessionRuntime = { ready: false };
    this.sessions.set(sessionId, runtime);

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
      },
      logger: pino({ level: 'info' }),               
      browser: ['Safari', 'Mac OS', '14.0.3'],    
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    runtime.sock = sock;

    // persist new creds
    sock.ev.on('creds.update', saveCreds);

    // connection update handler
    sock.ev.on('connection.update', async (u) => {
      const { connection, qr, lastDisconnect } = u;

      if (qr) {
        // convert to base64 QR for API use
        runtime.qr = await qrcode.toDataURL(qr);
        runtime.ready = false;
        this.logger.log(`QR generated for ${sessionId}`);
      }

      if (connection === 'open') {
        runtime.ready = true;
        runtime.qr = undefined;
        const me = sock.user?.id ?? null;

        await this.prisma.whatsAppSession.upsert({
          where: { id: sessionId },
          update: { label, statePath: authDir, meJid: me ?? undefined, connected: true },
          create: { id: sessionId, label, statePath: authDir, meJid: me ?? undefined, connected: true },
        });

        this.logger.log(`Session ${sessionId} connected as ${me}`);
      }

      if (connection === 'close') {
        const code = (lastDisconnect as any)?.error?.output?.statusCode;
        this.logger.warn(`Session ${sessionId} closed (${code})`);
        await this.prisma.whatsAppSession.updateMany({
          where: { id: sessionId },
          data: { connected: false },
        });

        // auto-reconnect unless logged out explicitly
        if (code !== DisconnectReason.loggedOut) {
          setTimeout(() => this.connect(sessionId, label).catch(() => void 0), 3_000);
        }
      }
    });

    // wait up to 20 s for QR or open event
    const result = await new Promise<{ connected: boolean; qr?: string | null }>(
      (resolve) => {
        let returned = false;
        const timer = setTimeout(() => {
          if (!returned) {
            returned = true;
            resolve({ connected: runtime.ready, qr: runtime.qr ?? null });
          }
        }, 20000);

        sock.ev.on('connection.update', (u) => {
          if (returned) return;
          if (u.qr || u.connection === 'open') {
            clearTimeout(timer);
            returned = true;
            resolve({ connected: runtime.ready, qr: runtime.qr ?? null });
          }
        });
      },
    );

    return { sessionId, ...result };
  }



  /** List all sessions from database */
  async listSessions() {
    const sessions = await this.prisma.whatsAppSession.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { sessions };
  }

  /** Return current QR (if any) */
  getQr(sessionId: string) {
    const rt = this.sessions.get(sessionId);
    if (!rt) throw new NotFoundException('Session not initialized. Call /wa/session/:id/connect first.');
    return { sessionId, qr: rt.qr ?? null, connected: rt.ready };
  }

  /** Send text message */
  async sendText(sessionId: string, toPhoneE164: string, text: string) {
    const rt = await this.ensureConnected(sessionId);

    const jid = this.phoneToJid(toPhoneE164);
    const res = await rt.sock.sendMessage(jid, { text });

    // Narrowing & fallback for strict TS
    const messageId = res && res.key ? res.key.id ?? null : null;
    if (!messageId) {
      this.logger.warn(`sendMessage returned no messageId for ${jid}`);
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
  private async ensureConnected(sessionId: string): Promise<SessionRuntime & { sock: ReturnType<typeof makeWASocket> }> {
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
      this.logger.log(`Reconnecting session ${sessionId} that was lost from memory`);
      try {
        await this.connect(sessionId, dbSession.label ?? undefined);
        // Wait a bit for connection to establish
        await new Promise(resolve => setTimeout(resolve, 2000));
        rt = this.sessions.get(sessionId);
        if (rt?.sock && rt.ready) {
          return rt as SessionRuntime & { sock: ReturnType<typeof makeWASocket> };
        }
      } catch (error: any) {
        this.logger.error(`Failed to reconnect session ${sessionId}:`, error.message);
      }
    }

    throw new NotFoundException('Session not connected. Please connect the session first.');
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
      this.logger.warn(`Error during socket logout for session ${sessionId}:`, error.message);
      // Continue even if logout fails - still update DB
    }

    try {
      await this.prisma.whatsAppSession.updateMany({
        where: { id: sessionId },
        data: { connected: false },
      });
    } catch (error: any) {
      this.logger.error(`Error updating session ${sessionId} in database:`, error.message);
      throw new NotFoundException(`Failed to update session status: ${error.message}`);
    }

    // Remove from runtime map
    this.sessions.delete(sessionId);

    this.logger.log(`Session ${sessionId} logged out successfully`);
    return { success: true };
  }

  async broadcastText(dto: BroadcastTextInput) {
    const { sessionId, recipients, text, delayMs, jitterMs, checkNumber } = dto;

    const rt = await this.ensureConnected(sessionId);

    // optional: create a campaign row
    let campaignId: string | undefined;
    try {
      const camp = await this.prisma.waCampaign.create({
        data: { sessionId, type: 'TEXT', text, delayMs, jitterMs },
        select: { id: true },
      });
      campaignId = camp.id;
    } catch { /* schema optional */ }

    const results: Array<{ phone: string; status: 'SENT'|'SKIPPED'|'FAILED'; error?: string }> = [];

    for (const raw of recipients) {
      const phone = raw.replace(/[^\d]/g, '');
      try {
        if (checkNumber) {
          const check = await this.checkNumber(sessionId, phone);
          if (!check.exists) {
            results.push({ phone, status: 'SKIPPED', error: 'Not on WhatsApp' });
            // optional: mark contact inactive in DB
            await this.prisma.whatsAppMessage?.create?.({
              data: { phone, sessionId, campaignId, direction: 'OUTGOING', text, status: 'FAILED', errorMessage: 'Not on WhatsApp' }
            }).catch(() => {});
            continue;
          }
        }

        const sendRes = await this.sendText(sessionId, phone, text);
        results.push({ phone, status: 'SENT' });

        await this.prisma.whatsAppMessage?.create?.({
          data: { phone, sessionId, campaignId, direction: 'OUTGOING', text, status: 'SENT' }
        }).catch(() => {});

        await sleep(withJitter(delayMs, jitterMs)); // atur jarak kirim
      } catch (e: any) {
        const msg = e?.message || 'Send failed';
        results.push({ phone, status: 'FAILED', error: msg });
        await this.prisma.whatsAppMessage?.create?.({
          data: { phone, sessionId, campaignId, direction: 'OUTGOING', text, status: 'FAILED', errorMessage: msg }
        }).catch(() => {});
        // backoff a bit before next number
        await sleep(withJitter(Math.max(delayMs, 1200), jitterMs));
      }
    }

    return { campaignId, total: recipients.length, summary: countStatuses(results), results };
  }

  async broadcastImage(dto: BroadcastImageInput) {
    const { sessionId, recipients, caption, imageUrl, delayMs, jitterMs, checkNumber } = dto;

    const rt = await this.ensureConnected(sessionId);

    // prefetch the image once (to avoid downloading for every recipient)
    const imgBuf = await this.fetchImageBuffer(imageUrl);

    // optional: campaign row
    let campaignId: string | undefined;
    try {
      const camp = await this.prisma.waCampaign.create({
        data: { sessionId, type: 'IMAGE', imageUrl, text: caption ?? null, delayMs, jitterMs },
        select: { id: true },
      });
      campaignId = camp.id;
    } catch {}

    const results: Array<{ phone: string; status: 'SENT'|'SKIPPED'|'FAILED'; error?: string }> = [];

    for (const raw of recipients) {
      const phone = raw.replace(/[^\d]/g, '');
      try {
        if (checkNumber) {
          const check = await this.checkNumber(sessionId, phone);
          if (!check.exists) {
            results.push({ phone, status: 'SKIPPED', error: 'Not on WhatsApp' });
            await this.prisma.whatsAppMessage?.create?.({
              data: { phone, sessionId, campaignId, direction: 'OUTGOING', text: caption ?? null, mediaUrl: imageUrl, status: 'FAILED', errorMessage: 'Not on WhatsApp' }
            }).catch(() => {});
            continue;
          }
        }

        const jid = this.phoneToJid(phone);
        const res = await rt.sock!.sendMessage(jid, {
          image: imgBuf,     // Buffer
          caption: caption || undefined,
        });

        // update log
        results.push({ phone, status: 'SENT' });
        await this.prisma.whatsAppMessage?.create?.({
          data: { phone, sessionId, campaignId, direction: 'OUTGOING', text: caption ?? null, mediaUrl: imageUrl, status: 'SENT' }
        }).catch(() => {});

        await sleep(withJitter(delayMs, jitterMs));
      } catch (e: any) {
        const msg = e?.message || 'Send failed';
        results.push({ phone, status: 'FAILED', error: msg });
        await this.prisma.whatsAppMessage?.create?.({
          data: { phone, sessionId, campaignId, direction: 'OUTGOING', text: caption ?? null, mediaUrl: imageUrl, status: 'FAILED', errorMessage: msg }
        }).catch(() => {});
        await sleep(withJitter(Math.max(delayMs, 1500), jitterMs));
      }
    }

    return { campaignId, total: recipients.length, summary: countStatuses(results), results };
  }

  // 1) Send into a group chat (text)
  public async groupSendText(dto: { sessionId: string; groupJid: string; text: string; }) {
    const rt = await this.ensureConnected(dto.sessionId);

    const res = await rt.sock.sendMessage(dto.groupJid, { text: dto.text });
    return { groupJid: dto.groupJid, messageId: res?.key?.id ?? null };
  }

  // 2) Send into a group chat (image+caption)
  public async groupSendImage(dto: { sessionId: string; groupJid: string; imageUrl: string; caption?: string; }) {
    const rt = await this.ensureConnected(dto.sessionId);

    const img = await this.fetchImageBuffer(dto.imageUrl);
    const res = await rt.sock.sendMessage(dto.groupJid, { image: img, caption: dto.caption || undefined });
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
    sessionId: string; groupJid: string; text: string;
    delayMs?: number; jitterMs?: number; checkNumber?: boolean; includeAdmins?: boolean;
  }) {
    const {
      sessionId, groupJid, text,
      delayMs = 1500, jitterMs = 600, checkNumber = true, includeAdmins = true
    } = dto;

    const meta = await this.getGroupParticipants(sessionId, groupJid);
    const people = meta.participants ?? [];
    const targets = people.filter(p => includeAdmins ? true : !(p.admin === 'admin' || p.admin === 'superadmin'));

    const results: Array<{ phone: string; status: 'SENT'|'SKIPPED'|'FAILED'; error?: string }> = [];

    for (const p of targets) {
      const jid = p.id;                                   // '62xxxxx@s.whatsapp.net'
      const phone = jid.split('@')[0];

      try {
        if (checkNumber) {
          const chk = await this.checkNumber(sessionId, phone);
          if (!chk.exists) {
            results.push({ phone, status: 'SKIPPED', error: 'Not on WhatsApp' });
            continue;
          }
        }
        await this.sendText(sessionId, phone, text);
        results.push({ phone, status: 'SENT' });
        await this.sleepJitter(delayMs, jitterMs);
      } catch (e: any) {
        results.push({ phone, status: 'FAILED', error: e?.message || 'Send failed' });
        await this.sleepJitter(Math.max(delayMs, 1600), jitterMs);
      }
    }

    return { groupJid, groupSubject: meta.subject, total: results.length, summary: this.countStatuses(results), results };
  }

  // 4) DM every member (image)
  public async groupDmMembersImage(dto: {
    sessionId: string; groupJid: string; imageUrl: string; caption?: string;
    delayMs?: number; jitterMs?: number; checkNumber?: boolean; includeAdmins?: boolean;
  }) {
    const {
      sessionId, groupJid, imageUrl, caption,
      delayMs = 1800, jitterMs = 700, checkNumber = true, includeAdmins = true
    } = dto;

    const rt = await this.ensureConnected(sessionId);

    const meta = await this.getGroupParticipants(sessionId, groupJid);
    const img = await this.fetchImageBuffer(imageUrl);

    const people = meta.participants ?? [];
    const targets = people.filter(p => includeAdmins ? true : !(p.admin === 'admin' || p.admin === 'superadmin'));

    const results: Array<{ phone: string; status: 'SENT'|'SKIPPED'|'FAILED'; error?: string }> = [];

    for (const p of targets) {
      const jid = p.id;
      const phone = jid.split('@')[0];

      try {
        if (checkNumber) {
          const chk = await this.checkNumber(sessionId, phone);
          if (!chk.exists) {
            results.push({ phone, status: 'SKIPPED', error: 'Not on WhatsApp' });
            continue;
          }
        }
        await rt.sock.sendMessage(jid, { image: img, caption: caption || undefined });
        results.push({ phone, status: 'SENT' });
        await this.sleepJitter(delayMs, jitterMs);
      } catch (e: any) {
        results.push({ phone, status: 'FAILED', error: e?.message || 'Send failed' });
        await this.sleepJitter(Math.max(delayMs, 1800), jitterMs);
      }
    }

    return { groupJid, groupSubject: meta.subject, total: results.length, summary: this.countStatuses(results), results };
  }

  // small helpers you can place near top/bottom:
  private sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }
  private withJitter(base: number, jitter: number) {
    if (jitter <= 0) return base;
    const delta = Math.floor((Math.random() * 2 - 1) * jitter);
    return Math.max(0, base + delta);
  }
  private async sleepJitter(base: number, jitter: number) {
    await this.sleep(this.withJitter(base, jitter));
  }
  private countStatuses(items: {status:string}[]) {
    return items.reduce((acc, it) => {
      acc[it.status] = (acc[it.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }


  private phoneToJid(e164NoPlus: string) {
    const num = e164NoPlus.replace(/[^\d]/g, '');
    return `${num}@s.whatsapp.net`;
  }

  private async fetchImageBuffer(url: string): Promise<Buffer> {
    const r = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer' });
    return Buffer.from(r.data as any);
  }
}
