import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { WaService } from './wa.service';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { SendDto, SendSchema } from './dto/send.dto';
import { JwtAuthGuard } from 'src/auth/guard/jwt-guard.auth';
import {
  BroadcastImageDto,
  BroadcastImageSchema,
  BroadcastTextDto,
  BroadcastTextSchema,
} from './dto/broadcast.dto';
import {
  GroupSendTextDto,
  GroupSendTextSchema,
  GroupSendImageDto,
  GroupSendImageSchema,
  GroupDmMembersTextDto,
  GroupDmMembersTextSchema,
  GroupDmMembersImageDto,
  GroupDmMembersImageSchema,
} from './dto/group.dto';
import { User } from 'src/common/decorators/user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('wa')
export class WaController {
  constructor(private readonly wa: WaService) {}

  @Get('sessions')
  async listSessions(@User('id') ownerId: string) {
    return this.wa.listSessions(ownerId);
  }

  @Get('session/:id/qr')
  async qr(@Param('id') id: string) {
    return this.wa.getQr(id);
  }

  @Post('session/:id/connect')
  async connect(
    @Param('id') id: string,
    @User('id') ownerId: string,
    @Body() body?: { label?: string },
  ) {
    return this.wa.connect(id, ownerId, body?.label);
  }

  @Post('send')
  async send(@Body(new ZodValidationPipe(SendSchema)) dto: SendDto) {
    return this.wa.sendText(dto.sessionId, dto.to, dto.text);
  }

  @Post('check/:sessionId/:phone')
  async check(
    @Param('sessionId') sessionId: string,
    @Param('phone') phone: string,
  ) {
    return this.wa.checkNumber(sessionId, phone);
  }

  @Get('groups/:sessionId')
  async groups(@Param('sessionId') sessionId: string) {
    return this.wa.fetchGroups(sessionId);
  }

  @Get('group/:sessionId/:groupJid/members')
  async groupMembers(
    @Param('sessionId') sessionId: string,
    @Param('groupJid') groupJid: string,
  ) {
    return this.wa.getGroupMembers(sessionId, groupJid);
  }

  @Post('logout/:sessionId')
  async logout(@Param('sessionId') sessionId: string) {
    return this.wa.logout(sessionId);
  }

  @Post('broadcast/text')
  async broadcastText(
    @User('id') ownerId: string,
    @Body(new ZodValidationPipe(BroadcastTextSchema)) dto: BroadcastTextDto,
  ) {
    const result = await this.wa.broadcastText(ownerId, dto);
    return { success: true, ...result };
  }

  @Post('broadcast/image')
  async broadcastImage(
    @User('id') ownerId: string,
    @Body(new ZodValidationPipe(BroadcastImageSchema)) dto: BroadcastImageDto,
  ) {
    const result = await this.wa.broadcastImage(ownerId, dto);
    return { success: true, ...result };
  }

  @Post('group/send-text')
  async groupSendText(
    @Body(new ZodValidationPipe(GroupSendTextSchema)) dto: GroupSendTextDto,
  ) {
    const data = await this.wa.groupSendText(dto);
    return { success: true, ...data };
  }

  @Post('group/send-image')
  async groupSendImage(
    @Body(new ZodValidationPipe(GroupSendImageSchema)) dto: GroupSendImageDto,
  ) {
    const data = await this.wa.groupSendImage(dto);
    return { success: true, ...data };
  }

  @Post('group/dm-members-text')
  async groupDmMembersText(
    @Body(new ZodValidationPipe(GroupDmMembersTextSchema))
    dto: GroupDmMembersTextDto,
  ) {
    const data = await this.wa.groupDmMembersText(dto);
    return { success: true, ...data };
  }

  @Post('group/dm-members-image')
  async groupDmMembersImage(
    @Body(new ZodValidationPipe(GroupDmMembersImageSchema))
    dto: GroupDmMembersImageDto,
  ) {
    const data = await this.wa.groupDmMembersImage(dto);
    return { success: true, ...data };
  }
}
