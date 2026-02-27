import {
  Body,
  Controller,
  Delete,
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
import { language } from 'googleapis/build/src/apis/language';

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
        sessionId: { example: 'session-177675658669' },
        ownerId: { example: 'cmlha0mid0000mezwjmb13x6j' },
        name: { example: 'mitsuha' },
        isEnabled: { example: true },
        systemPrompt: {
          example:
            'You are a friendly sales assistant for Umroh packages. Be persuasive but polite',
        },
        fallbackReply: {
          example: 'Maaf kak, untuk informasi tersebut silakan hubungi admin',
        },
        language: { example: 'id' },
      },
    },
  })
  @Post()
  async createAgent(
    @Body('sessionId') sessionId: string,
    @Body('ownerId') ownerId: string,
    @Body('name') name: string,
    @Body('isEnabled') isEnabled: boolean,
    @Body('systemPrompt') systemPrompt: string,
    @Body('fallbackReply') fallbackReply: string,
    @Body('language') language: string,
  ) {
    return this.aiAgentService.createAgent(
      sessionId,
      ownerId,
      name,
      isEnabled,
      systemPrompt,
      fallbackReply,
      language,
    );
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

  @Get(':agentId/knowledge')
  async getKnowledge(@Param('agentId') agentId: string) {
    return this.aiKnowledgeService.getAIKnowledge(agentId);
  }

  @Delete(':agentId/knowledge/:fileId')
  async deleteKnowledge(
    @Param('agentId') agentId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.aiKnowledgeService.deleteKnowledge(agentId, fileId);
  }

  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { example: 'CS Bot' },
        isEnabled: { example: true },
        model: { example: 'gpt-4o-mini' },
        temperature: { example: 0.7 },
        maxTokens: { example: 500 },
        systemPrompt: { example: 'You are a helpful assistant.' },
        fallbackReply: {
          example: 'Maaf, saya tidak bisa menjawab pertanyaan itu.',
        },
        language: { example: 'id' },
      },
    },
  })
  @Patch(':id')
  async updateAgent(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      isEnabled?: boolean;
      model?: string;
      temperature?: number;
      maxTokens?: number;
      systemPrompt?: string | null;
      fallbackReply?: string | null;
      language?: string;
    },
  ) {
    return this.aiAgentService.updateAgent(id, body);
  }

  @Delete(':id')
  async deleteAgent(
    @Param('id') id: string,
  ) {
    return this.aiAgentService.deleteAgent(id);
  }
  
  @Patch(':id/toggle')
  async toggleEnabled(@Param('id') id: string) {
    return this.aiAgentService.toggleEnabled(id);
  }

}
