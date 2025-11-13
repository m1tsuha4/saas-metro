import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ContactsService } from './contacts.service';
import { JwtAuthGuard } from 'src/auth/guard/jwt-guard.auth';
import { User } from 'src/common/decorators/user.decorator';
import {
  CreateEmailContactDto,
  CreateEmailContactSchema,
  CreateWhatsAppContactDto,
  CreateWhatsAppContactSchema,
  UpdateEmailContactDto,
  UpdateEmailContactSchema,
  UpdateWhatsAppContactDto,
  UpdateWhatsAppContactSchema,
} from './dto';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';

@UseGuards(JwtAuthGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_, file, callback) => {
        const allowed = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
        if (allowed.includes(file.mimetype) || file.originalname.endsWith('.xlsx') || file.originalname.endsWith('.xls')) {
          callback(null, true);
        } else {
          callback(new BadRequestException('Only Excel files (.xlsx or .xls) are supported'), false);
        }
      },
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    }),
  )
  async importContacts(@User('id') ownerId: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File is required');
    return this.contactsService.importFromExcel(ownerId, file);
  }

  @Get()
  async listContacts(@User('id') ownerId: string) {
    return this.contactsService.listContacts(ownerId);
  }

  @Post('email')
  async createEmailContact(
    @User('id') ownerId: string,
    @Body(new ZodValidationPipe(CreateEmailContactSchema)) payload: CreateEmailContactDto,
  ) {
    return this.contactsService.createEmailContact(ownerId, payload);
  }

  @Patch('email/:id')
  async updateEmailContact(
    @User('id') ownerId: string,
    @Param('id') contactId: string,
    @Body(new ZodValidationPipe(UpdateEmailContactSchema)) payload: UpdateEmailContactDto,
  ) {
    return this.contactsService.updateEmailContact(ownerId, contactId, payload);
  }

  @Delete('email/:id')
  async deleteEmailContact(@User('id') ownerId: string, @Param('id') contactId: string) {
    return this.contactsService.deleteEmailContact(ownerId, contactId);
  }

  @Post('whatsapp')
  async createWhatsAppContact(
    @User('id') ownerId: string,
    @Body(new ZodValidationPipe(CreateWhatsAppContactSchema)) payload: CreateWhatsAppContactDto,
  ) {
    return this.contactsService.createWhatsAppContact(ownerId, payload);
  }

  @Patch('whatsapp/:id')
  async updateWhatsAppContact(
    @User('id') ownerId: string,
    @Param('id') contactId: string,
    @Body(new ZodValidationPipe(UpdateWhatsAppContactSchema)) payload: UpdateWhatsAppContactDto,
  ) {
    return this.contactsService.updateWhatsAppContact(ownerId, contactId, payload);
  }

  @Delete('whatsapp/:id')
  async deleteWhatsAppContact(@User('id') ownerId: string, @Param('id') contactId: string) {
    return this.contactsService.deleteWhatsAppContact(ownerId, contactId);
  }
}
