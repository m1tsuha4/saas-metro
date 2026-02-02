import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { AdminService } from './admin.service';
import { CreateAdminDto, CreateAdminSchema } from './dto/create-admin.dto';
import { CreateUserDto, CreateUserSchema } from './dto/create-user.dto';
import { UpdateUserDto, UpdateUserSchema } from './dto/update-user.dto';
import { UserQueryDto, UserQuerySchema } from './dto/user-query.dto';
import {
  CreatePackageDto,
  CreatePackageSchema,
  UpdatePackageDto,
  UpdatePackageSchema,
} from './dto/package.dto';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from 'src/auth/guard/jwt-guard.auth';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

// Ensure uploads directory exists
const logoFolder = './uploads/client-logos';
if (!existsSync(logoFolder)) {
  mkdirSync(logoFolder, { recursive: true });
}

const imageFileFilter = (_req, file, cb) => {
  const ok = /^image\/(png|jpe?g|webp|gif|svg\+xml)$/i.test(file.mimetype);
  cb(ok ? null : new BadRequestException('Only image files allowed'), ok);
};

const logoStorage = diskStorage({
  destination: logoFolder,
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + extname(file.originalname).toLowerCase());
  },
});

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ==================== ADMIN REGISTER ====================
  @Post('register')
  async registerAdmin(
    @Body(new ZodValidationPipe(CreateAdminSchema)) dto: CreateAdminDto,
  ) {
    return this.adminService.registerAdmin(dto);
  }

  // ==================== USER MANAGEMENT ====================
  @Get('users')
  async findAllUsers(
    @Query(new ZodValidationPipe(UserQuerySchema)) query: UserQueryDto,
  ) {
    return this.adminService.findAllUsers(query);
  }

  @Get('users/:id')
  async findUserById(@Param('id') id: string) {
    return this.adminService.findUserById(id);
  }

  @Post('users')
  async createUser(
    @Body(new ZodValidationPipe(CreateUserSchema)) dto: CreateUserDto,
  ) {
    return this.adminService.createUser(dto);
  }

  @Patch('users/:id')
  async updateUser(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema)) dto: UpdateUserDto,
  ) {
    return this.adminService.updateUser(id, dto);
  }

  @Delete('users/:id')
  async deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }

  // ==================== CLIENT LOGO ====================
  @Get('client-logos')
  async findAllClientLogos() {
    return this.adminService.findAllClientLogos();
  }

  @Get('client-logos/:id')
  async findClientLogoById(@Param('id') id: string) {
    return this.adminService.findClientLogoById(id);
  }

  @Post('client-logos')
  @UseInterceptors(
    FileInterceptor('logo', {
      storage: logoStorage,
      fileFilter: imageFileFilter,
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    }),
  )
  async createClientLogo(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    const imageUrl = `/uploads/client-logos/${file.filename}`;
    return this.adminService.createClientLogo(imageUrl);
  }

  @Patch('client-logos/:id')
  @UseInterceptors(
    FileInterceptor('logo', {
      storage: logoStorage,
      fileFilter: imageFileFilter,
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async updateClientLogo(
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    const imageUrl = `/uploads/client-logos/${file.filename}`;
    return this.adminService.updateClientLogo(id, imageUrl);
  }

  @Delete('client-logos/:id')
  async deleteClientLogo(@Param('id') id: string) {
    return this.adminService.deleteClientLogo(id);
  }

  // ==================== PACKAGE ====================
  @Get('packages')
  async findAllPackages() {
    return this.adminService.findAllPackages();
  }

  @Get('packages/:id')
  async findPackageById(@Param('id') id: string) {
    return this.adminService.findPackageById(id);
  }

  @Post('packages')
  async createPackage(
    @Body(new ZodValidationPipe(CreatePackageSchema)) dto: CreatePackageDto,
  ) {
    return this.adminService.createPackage(dto);
  }

  @Patch('packages/:id')
  async updatePackage(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdatePackageSchema)) dto: UpdatePackageDto,
  ) {
    return this.adminService.updatePackage(id, dto);
  }

  @Delete('packages/:id')
  async deletePackage(@Param('id') id: string) {
    return this.adminService.deletePackage(id);
  }
}
