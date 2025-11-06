import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import * as ExcelJS from 'exceljs';
import { z } from 'zod';

type ImportSummary = {
  rows: number;
  emails: { created: number; updated: number; skipped: number };
  phones: { created: number; updated: number; skipped: number };
  errors: Array<{ row: number; reason: string }>;
};

const emailSchema = z.string().email();

@Injectable()
export class ContactsService {
  private readonly logger = new Logger('ContactsService');

  constructor(private readonly prisma: PrismaService) {}

  async importFromExcel(ownerId: string, file: Express.Multer.File) {
    if (!file?.buffer) throw new BadRequestException('File buffer missing');

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file.buffer);
    } catch (err) {
      this.logger.warn(`Failed to parse Excel: ${(err as Error).message}`);
      throw new BadRequestException('Unable to read Excel file. Ensure it is a valid .xlsx document.');
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new BadRequestException('Excel file does not contain any worksheet.');

    const headerRow = worksheet.getRow(1);
    if (!headerRow || headerRow.actualCellCount === 0) {
      throw new BadRequestException('Missing header row (first row) in Excel file.');
    }

    const columnMap = new Map<number, 'email' | 'phone' | 'name'>();
    headerRow.eachCell((cell, col) => {
      const header = `${cell.text ?? ''}`.trim().toLowerCase();
      const normalized = this.normalizeHeader(header);
      if (normalized) columnMap.set(col, normalized);
    });

    if (!columnMap.size) {
      throw new BadRequestException('No recognized headers found. Allowed headers: email, name, phone/no_hp/wa.');
    }

    const summary: ImportSummary = {
      rows: 0,
      emails: { created: 0, updated: 0, skipped: 0 },
      phones: { created: 0, updated: 0, skipped: 0 },
      errors: [],
    };

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      if (this.isRowEmpty(row)) continue;

      summary.rows++;
      const collected: { email?: string; phone?: string; name?: string } = {};

      columnMap.forEach((key, col) => {
        const cell = row.getCell(col);
        const value = `${cell.text ?? ''}`.trim();
        if (!value) return;
        if (key === 'email') collected.email = value;
        if (key === 'phone') collected.phone = value;
        if (key === 'name') collected.name = value;
      });

      if (!collected.email && !collected.phone) {
        summary.errors.push({ row: rowNumber, reason: 'Row missing both email and phone values' });
        summary.emails.skipped++;
        summary.phones.skipped++;
        continue;
      }

      const processErrors: string[] = [];

      if (collected.email) {
        const emailResult = emailSchema.safeParse(collected.email.trim().toLowerCase());
        if (!emailResult.success) {
          summary.emails.skipped++;
          processErrors.push('Invalid email format');
        } else {
          const email = emailResult.data;
          const name = collected.name;
          const existing = await this.prisma.emailContact.findUnique({
            where: { ownerId_email: { ownerId, email } },
          });
          if (existing) {
            await this.prisma.emailContact.update({
              where: { ownerId_email: { ownerId, email } },
              data: {
                ...(name ? { name } : {}),
                status: existing.status === 'BOUNCED' ? existing.status : existing.status ?? 'ACTIVE',
              },
            });
            summary.emails.updated++;
          } else {
            await this.prisma.emailContact.create({
              data: {
                ownerId,
                email,
                name,
                status: 'ACTIVE',
              },
            });
            summary.emails.created++;
          }
        }
      }

      if (collected.phone) {
        const phone = this.normalizePhone(collected.phone);
        if (!phone) {
          summary.phones.skipped++;
          processErrors.push('Invalid phone/WhatsApp number');
        } else {
          const existing = await this.prisma.whatsAppContact.findUnique({
            where: { ownerId_phone: { ownerId, phone } },
          });
          if (existing) {
            await this.prisma.whatsAppContact.update({
              where: { ownerId_phone: { ownerId, phone } },
              data: {
                ...(collected.name ? { name: collected.name } : {}),
                status: existing.status ?? 'ACTIVE',
                source: 'IMPORT',
              },
            });
            summary.phones.updated++;
          } else {
            await this.prisma.whatsAppContact.create({
              data: {
                ownerId,
                phone,
                name: collected.name,
                status: 'ACTIVE',
                source: 'IMPORT',
              },
            });
            summary.phones.created++;
          }
        }
      }

      if (processErrors.length) {
        summary.errors.push({ row: rowNumber, reason: processErrors.join('; ') });
      }
    }

    return {
      success: true,
      message: 'Contacts imported successfully',
      summary,
    };
  }

  async listContacts(ownerId: string) {
    const [emails, whatsapp] = await Promise.all([
      this.prisma.emailContact.findMany({
        where: { ownerId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, email: true, name: true, status: true, createdAt: true, updatedAt: true },
      }),
      this.prisma.whatsAppContact.findMany({
        where: { ownerId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, phone: true, name: true, status: true, source: true, createdAt: true, updatedAt: true },
      }),
    ]);

    return { emails, whatsapp };
  }

  private normalizeHeader(header: string): 'email' | 'phone' | 'name' | null {
    if (!header) return null;
    const emailHeaders = ['email', 'e-mail', 'mail', 'alamat email'];
    const phoneHeaders = ['phone', 'no_hp', 'no. hp', 'no hp', 'nohp', 'hp', 'no handphone', 'no. handphone', 'whatsapp', 'wa', 'no wa', 'whatsapp number'];
    const nameHeaders = ['name', 'nama', 'full name'];

    if (emailHeaders.includes(header)) return 'email';
    if (phoneHeaders.includes(header)) return 'phone';
    if (nameHeaders.includes(header)) return 'name';
    return null;
  }

  private normalizePhone(input: string): string | null {
    const digits = input.replace(/\D/g, '');
    if (digits.length < 6) return null;
    if (digits.startsWith('0')) {
      return `62${digits.slice(1)}`;
    }
    return digits;
  }

  private isRowEmpty(row: ExcelJS.Row) {
    for (let i = 1; i <= row.cellCount; i++) {
      const cell = row.getCell(i);
      if (cell?.text && cell.text.trim().length > 0) {
        return false;
      }
    }
    return true;
  }
}
