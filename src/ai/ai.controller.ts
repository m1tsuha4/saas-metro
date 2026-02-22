import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { AiService } from './ai.service';
import { AiAgentService } from './ai-agent.service';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { CloudinaryService } from 'src/common/services/cloudinary.service';
import { AiKnowledgeService } from './ai-knowledge.service';

@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly aiAgentService: AiAgentService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly aiKnowledgeService: AiKnowledgeService,
  ) {}

  @Get(':sessionId')
  async getAgent(@Param('sessionId') sessionId: string) {
    return this.aiAgentService.getAgent(sessionId);
  }

  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        sessionId: { example: 'cmlha0mid0000mezwjmb13x6j' },
        ownerId: { example: 'cmlha0mid0000mezwjmb13x6j' },
        name: { example: 'mitsuha' },
        isEnabled: { example: true },
      },
    },
  })
  @Post()
  async createAgent(
    @Body('sessionId') sessionId: string,
    @Body('ownerId') ownerId: string,
    @Body('name') name: string,
    @Body('isEnabled') isEnabled: boolean,
  ) {
    return this.aiAgentService.createAgent(sessionId, ownerId, name, isEnabled);
  }

  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        id: { example: 'cmlha0mid0000mezwjmb13x6j' },
        mode: { example: 'HUMAN' },
      },
    },
  })
  @Patch(':id/mode')
  async switchMode(
    @Param('id') id: string,
    @Body('mode') mode: 'BOT' | 'HUMAN',
  ) {
    return this.aiAgentService.switchMode(id, mode);
  }

  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @Post(':agentId/upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadKnowledge(
    @Param('agentId') agentId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const fileName = file.originalname;
    const fileRecord = await this.aiService.uploadKnowledge(
      agentId,
      fileName,
      'TEMP_URL',
      'PROCESSING',
    );
    await this.aiKnowledgeService.processPdfBuffer(
      agentId,
      fileRecord.id,
      file.buffer,
    );

    const uploaded = await this.cloudinaryService.uploadPdf(
      file.buffer,
      `${Date.now()}-${file.originalname}`,
    );

    await this.aiKnowledgeService.updateFileUrl(
      fileRecord.id,
      uploaded.secure_url,
    );

    return { success: true };
  }
}
