import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { CloudinaryService } from 'src/common/services/cloudinary.service';

@Controller('media')
export class MediaController {
  constructor(private cloudinary: CloudinaryService) {}

  @ApiConsumes('multipart/form-data')
  @ApiBody({
    type: 'multipart/form-data',
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
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: Express.Multer.File) {
    const result: any = await this.cloudinary.uploadBuffer(
      file.buffer,
      'whatsapp-image',
    );

    return {
      uri: result.secure_url,
      publicId: result.public_id,
    };
  }
}
