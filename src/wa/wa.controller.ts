import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { WaService } from './wa.service';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { SendDto, SendSchema } from './dto/send.dto';
import { JwtAuthGuard } from 'src/auth/guard/jwt-guard.auth';

@UseGuards(JwtAuthGuard)
@Controller('wa')
// @UseGuards(JwtAuthGuard) 
export class WaController {
  constructor(private readonly wa: WaService) {}

  @Post('session/:id/connect')
  async connect(@Param('id') id: string, @Body('label') label?: string) {
    return this.wa.connect(id, label);
  }

  @Get('session/:id/qr')
  async qr(@Param('id') id: string) {
    return this.wa.getQr(id);
  }

  @Post('send')
  async send(@Body(new ZodValidationPipe(SendSchema)) dto: SendDto) {
    return this.wa.sendText(dto.sessionId, dto.to, dto.text);
  }

  @Post('check/:sessionId/:phone')
  async check(@Param('sessionId') sessionId: string, @Param('phone') phone: string) {
    return this.wa.checkNumber(sessionId, phone);
  }

  @Get('groups/:sessionId')
  async groups(@Param('sessionId') sessionId: string) {
    return this.wa.fetchGroups(sessionId);
  }

  @Post('logout/:sessionId')
  async logout(@Param('sessionId') sessionId: string) {
    return this.wa.logout(sessionId);
  }
}