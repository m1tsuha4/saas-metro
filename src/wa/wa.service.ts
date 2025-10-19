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

type SessionRuntime = {
  qr?: string;                             
  sock?: ReturnType<typeof makeWASocket>;
  ready: boolean;
};

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



  /** Return current QR (if any) */
  getQr(sessionId: string) {
    const rt = this.sessions.get(sessionId);
    if (!rt) throw new NotFoundException('Session not initialized. Call /wa/session/:id/connect first.');
    return { sessionId, qr: rt.qr ?? null, connected: rt.ready };
  }

  /** Send text message */
  async sendText(sessionId: string, toPhoneE164: string, text: string) {
    const rt = this.sessions.get(sessionId);
    if (!rt?.sock) throw new NotFoundException('Session not connected');

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
    const rt = this.sessions.get(sessionId);
    if (!rt?.sock) throw new NotFoundException('Session not connected');

    const jid = this.phoneToJid(toPhoneE164);
    const info = await rt.sock.onWhatsApp(jid);

    // Ensure array & pick first
    const first = Array.isArray(info) ? info[0] : undefined;
    const exists = !!first?.exists;
    const resolvedJid = first?.jid ?? null;

    return { exists, jid: resolvedJid };
  }

  /** Fetch groups & members (POC; mind ToS) */
  async fetchGroups(sessionId: string) {
    const rt = this.sessions.get(sessionId);
    if (!rt?.sock) throw new NotFoundException('Session not connected');

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
    if (rt?.sock) await rt.sock.logout();

    await this.prisma.whatsAppSession.updateMany({
      where: { id: sessionId },
      data: { connected: false },
    });

    return { success: true };
  }

  private phoneToJid(e164NoPlus: string) {
    const num = e164NoPlus.replace(/[^\d]/g, '');
    return `${num}@s.whatsapp.net`;
  }
}
