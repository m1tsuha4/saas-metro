import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto } from './dto/user-query.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  // Helper to parse features JSON
  private parsePackageFeatures(pkg: any) {
    return {
      ...pkg,
      features: pkg.features ? JSON.parse(pkg.features) : [],
    };
  }

  // ==================== ADMIN REGISTER ====================
  async registerAdmin(dto: CreateAdminDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const admin = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        password: hashedPassword,
        role: UserRole.ADMIN,
        emailVerifiedAt: new Date(),
      },
    });

    return {
      success: true,
      message: 'Admin registered successfully',
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
      },
    };
  }

  // ==================== USER MANAGEMENT ====================

  async findAllUsers(query: UserQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const { search, role } = query;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
      ];
    }

    if (role) {
      where.role = role;
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          telephone: true,
          picture: true,
          emailVerifiedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        telephone: true,
        picture: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async createUser(dto: CreateUserDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        password: hashedPassword,
        role: (dto.role as UserRole) || UserRole.USER,
        telephone: dto.telephone,
        emailVerifiedAt: new Date(),
      },
    });

    return {
      success: true,
      message: 'User created successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        telephone: user.telephone,
        createdAt: user.createdAt,
      },
    };
  }

  async updateUser(id: string, dto: UpdateUserDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    if (dto.email && dto.email !== existingUser.email) {
      const emailExists = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      if (emailExists) {
        throw new ConflictException('Email already in use');
      }
    }

    const updateData: any = {
      name: dto.name,
      email: dto.email,
      telephone: dto.telephone,
      role: dto.role as UserRole,
    };

    if (dto.password) {
      updateData.password = await bcrypt.hash(dto.password, 10);
    }

    // Remove undefined values
    Object.keys(updateData).forEach((key) => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    const user = await this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        telephone: true,
        updatedAt: true,
      },
    });

    return {
      success: true,
      message: 'User updated successfully',
      user,
    };
  }

  async deleteUser(id: string) {
    const existingUser = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.delete({
      where: { id },
    });

    return {
      success: true,
      message: 'User deleted successfully',
    };
  }

  // ==================== CLIENT LOGO ====================

  async findAllClientLogos() {
    const logos = await this.prisma.clientLogo.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return { data: logos };
  }

  async findClientLogoById(id: string) {
    const logo = await this.prisma.clientLogo.findUnique({
      where: { id },
    });

    if (!logo) {
      throw new NotFoundException('Client logo not found');
    }

    return logo;
  }

  async createClientLogo(imageUrl: string) {
    const logo = await this.prisma.clientLogo.create({
      data: { imageUrl },
    });

    return {
      success: true,
      message: 'Client logo created successfully',
      logo,
    };
  }

  async updateClientLogo(id: string, imageUrl: string) {
    const existing = await this.prisma.clientLogo.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Client logo not found');
    }

    const logo = await this.prisma.clientLogo.update({
      where: { id },
      data: { imageUrl },
    });

    return {
      success: true,
      message: 'Client logo updated successfully',
      logo,
    };
  }

  async deleteClientLogo(id: string) {
    const existing = await this.prisma.clientLogo.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Client logo not found');
    }

    await this.prisma.clientLogo.delete({
      where: { id },
    });

    return {
      success: true,
      message: 'Client logo deleted successfully',
    };
  }

  // ==================== PACKAGE ====================

  async findAllPackages() {
    const packages = await this.prisma.package.findMany({
      orderBy: [{ urutan_ke: 'asc' }, { createdAt: 'desc' }],
    });

    return { data: packages.map((pkg) => this.parsePackageFeatures(pkg)) };
  }

  async findPackageById(id: string) {
    const pkg = await this.prisma.package.findUnique({
      where: { id },
    });

    if (!pkg) {
      throw new NotFoundException('Package not found');
    }

    return this.parsePackageFeatures(pkg);
  }

  async createPackage(data: {
    name: string;
    description?: string;
    price: number;
    duration?: number;
    maxContacts?: number;
    maxWaBroadcast?: number;
    maxEmailBroadcast?: number;
    maxWaSessions?: number;
    maxGmailAccounts?: number;
    features?: string[];
    isPopular?: boolean;
    urutan_ke?: number;
  }) {
    const existing = await this.prisma.package.findUnique({
      where: { name: data.name },
    });

    if (existing) {
      throw new ConflictException('Package name already exists');
    }

    const pkg = await this.prisma.package.create({
      data: {
        name: data.name,
        description: data.description,
        price: data.price,
        duration: data.duration || 30,
        maxContacts: data.maxContacts || 100,
        maxWaBroadcast: data.maxWaBroadcast || 500,
        maxEmailBroadcast: data.maxEmailBroadcast || 1000,
        maxWaSessions: data.maxWaSessions || 1,
        maxGmailAccounts: data.maxGmailAccounts || 1,
        features: data.features ? JSON.stringify(data.features) : null,
        isPopular: data.isPopular || false,
        urutan_ke: data.urutan_ke || 0,
      },
    });

    return {
      success: true,
      message: 'Package created successfully',
      package: this.parsePackageFeatures(pkg),
    };
  }

  async updatePackage(
    id: string,
    data: {
      name?: string;
      description?: string;
      price?: number;
      duration?: number;
      maxContacts?: number;
      maxWaBroadcast?: number;
      maxEmailBroadcast?: number;
      maxWaSessions?: number;
      maxGmailAccounts?: number;
      features?: string[];
      isPopular?: boolean;
      urutan_ke?: number;
      isActive?: boolean;
    },
  ) {
    const existing = await this.prisma.package.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Package not found');
    }

    if (data.name && data.name !== existing.name) {
      const nameExists = await this.prisma.package.findUnique({
        where: { name: data.name },
      });
      if (nameExists) {
        throw new ConflictException('Package name already exists');
      }
    }

    // Convert features array to JSON string
    const updateData: any = { ...data };
    if (data.features) {
      updateData.features = JSON.stringify(data.features);
    }

    const pkg = await this.prisma.package.update({
      where: { id },
      data: updateData,
    });

    return {
      success: true,
      message: 'Package updated successfully',
      package: this.parsePackageFeatures(pkg),
    };
  }

  async deletePackage(id: string) {
    const existing = await this.prisma.package.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Package not found');
    }

    await this.prisma.package.delete({
      where: { id },
    });

    return {
      success: true,
      message: 'Package deleted successfully',
    };
  }
}
