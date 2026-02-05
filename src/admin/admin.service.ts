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
import { PaymentQueryDto, UpdatePaymentDto } from './dto/payment-query.dto';
import * as bcrypt from 'bcryptjs';
import * as ExcelJS from 'exceljs';


@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) { }

  // ==================== DASHBOARD ====================

  // Helper untuk hitung pertumbuhan
  private hitungPertumbuhan(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  }

  // GET /admin/dashboard/statistik
  async getStatistik() {
    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Total Akun
    const totalAkun = await this.prisma.user.count();
    const totalAkunBulanLalu = await this.prisma.user.count({
      where: { createdAt: { lt: startOfThisMonth } },
    });

    // Akun Aktif (punya subscription aktif)
    const akunAktif = await this.prisma.user.count({
      where: {
        subscriptions: {
          some: {
            status: 'ACTIVE',
            endDate: { gte: now },
          },
        },
      },
    });
    const akunAktifBulanLalu = await this.prisma.user.count({
      where: {
        subscriptions: {
          some: {
            status: 'ACTIVE',
            endDate: { gte: startOfThisMonth },
            startDate: { lt: startOfThisMonth },
          },
        },
      },
    });

    // Akun Nonaktif
    const akunNonaktif = totalAkun - akunAktif;
    const akunNonaktifBulanLalu = totalAkunBulanLalu - akunAktifBulanLalu;

    // Total Transaksi Sukses
    const totalTransaksi = await this.prisma.payment.count({
      where: { status: 'SUCCESS' },
    });
    const totalTransaksiBulanLalu = await this.prisma.payment.count({
      where: {
        status: 'SUCCESS',
        createdAt: { lt: startOfThisMonth },
      },
    });

    return {
      totalAkun,
      akunAktif,
      akunNonaktif,
      totalTransaksi,
      pertumbuhanAkun: this.hitungPertumbuhan(totalAkun, totalAkunBulanLalu),
      pertumbuhanAktif: this.hitungPertumbuhan(akunAktif, akunAktifBulanLalu),
      pertumbuhanNonaktif: this.hitungPertumbuhan(akunNonaktif, akunNonaktifBulanLalu),
      pertumbuhanTransaksi: this.hitungPertumbuhan(totalTransaksi, totalTransaksiBulanLalu),
    };
  }

  // GET /admin/dashboard/user-terbaru
  async getUserTerbaru() {
    const now = new Date();
    const recentUsers = await this.prisma.user.findMany({
      take: 4,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        createdAt: true,
        subscriptions: {
          where: { status: 'ACTIVE', endDate: { gte: now } },
          take: 1,
        },
      },
    });

    return recentUsers.map((user, index) => ({
      no: index + 1,
      idKlien: `#${user.id.slice(-8).toUpperCase()}`,
      email: user.email,
      tanggalDaftar: user.createdAt.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
      status: user.subscriptions.length > 0 ? 'Active' : 'Inactive',
    }));
  }

  // GET /admin/dashboard/user-bulanan
  async getUserBulanan() {
    const now = new Date();
    const namaBulan = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const userBaruBulanan: { bulan: string; jumlah: number }[] = [];

    for (let i = 0; i < 12; i++) {
      const bulanIndex = (now.getMonth() - 11 + i + 12) % 12;
      const tahun = now.getFullYear() - (now.getMonth() - 11 + i < 0 ? 1 : 0);
      const startDate = new Date(tahun, bulanIndex, 1);
      const endDate = new Date(tahun, bulanIndex + 1, 1);

      const jumlah = await this.prisma.user.count({
        where: {
          createdAt: { gte: startDate, lt: endDate },
        },
      });

      userBaruBulanan.push({
        bulan: namaBulan[bulanIndex],
        jumlah,
      });
    }

    return userBaruBulanan;
  }

  // GET /admin/dashboard/pembayaran-terbaru
  async getPembayaranTerbaru() {
    const recentPayments = await this.prisma.payment.findMany({
      take: 4,
      where: { status: 'SUCCESS' },
      orderBy: { createdAt: 'desc' },
      select: {
        orderId: true,
        createdAt: true,
        paymentType: true,
        amount: true,
      },
    });

    return recentPayments.map((payment, index) => ({
      no: index + 1,
      idOrder: `#${payment.orderId.slice(-8).toUpperCase()}`,
      tanggalOrder: payment.createdAt.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
      metodePembayaran: payment.paymentType || 'Unknown',
      totalPembayaran: payment.amount,
    }));
  }

  // GET /admin/dashboard/status-sistem
  async getStatusSistem() {
    return {
      whatsapp: 'Connected',
      email: 'Active',
      paymentGateway: 'Operational',
      aiEngine: 'Running normally',
      terakhirDicek: new Date().toISOString(),
    };
  }

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
    const { search, role, status, startDate, endDate, sortBy, sortOrder } = query;
    const skip = (page - 1) * limit;
    const now = new Date();

    const where: any = {};

    // Search by name, email, or ID
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { id: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Filter by role
    if (role) {
      where.role = role;
    }

    // Filter by date range (sign-up date)
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    // Filter by subscription status
    if (status === 'active') {
      where.subscriptions = {
        some: {
          status: 'ACTIVE',
          endDate: { gte: now },
        },
      };
    } else if (status === 'inactive') {
      where.NOT = {
        subscriptions: {
          some: {
            status: 'ACTIVE',
            endDate: { gte: now },
          },
        },
      };
    }

    // Build orderBy
    let orderBy: any = { createdAt: sortOrder || 'desc' };
    if (sortBy === 'id') {
      orderBy = { id: sortOrder || 'desc' };
    } else if (sortBy === 'email') {
      orderBy = { email: sortOrder || 'asc' };
    } else if (sortBy === 'createdAt') {
      orderBy = { createdAt: sortOrder || 'desc' };
    }
    // planType sorting handled after fetch

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy,
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
          subscriptions: {
            where: { status: 'ACTIVE', endDate: { gte: now } },
            take: 1,
            orderBy: { endDate: 'desc' },
            select: {
              status: true,
              package: {
                select: { name: true },
              },
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    // Format response sesuai UI
    let formattedData = users.map((user, index) => ({
      no: skip + index + 1,
      idKlien: `#${user.id.slice(-8).toUpperCase()}`,
      email: user.email,
      tanggalDaftar: user.createdAt.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
      planType: user.subscriptions[0]?.package?.name || null,
      status: user.subscriptions.length > 0 ? 'Active' : 'Inactive',
    }));

    // Sort by planType if needed (after fetch)
    if (sortBy === 'planType') {
      formattedData = formattedData.sort((a, b) => {
        const aVal = a.planType || '';
        const bVal = b.planType || '';
        return sortOrder === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      });
    }

    return {
      data: formattedData,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findUserById(id: string) {
    const now = new Date();
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
        subscriptions: {
          where: { status: 'ACTIVE', endDate: { gte: now } },
          take: 1,
          orderBy: { endDate: 'desc' },
          select: {
            status: true,
            startDate: true,
            endDate: true,
            package: {
              select: { name: true },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Format subscription info
    const activeSubscription = user.subscriptions[0];
    const subscription = activeSubscription
      ? {
        packageName: activeSubscription.package.name,
        status: activeSubscription.status,
        startDate: activeSubscription.startDate.toLocaleDateString('id-ID', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }),
        endDate: activeSubscription.endDate.toLocaleDateString('id-ID', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }),
      }
      : null;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      telephone: user.telephone,
      picture: user.picture,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      subscription,
    };
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
      orderBy: { createdAt: 'desc' },
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
    description: string;
    price: number;
    currency?: string;
    billingCycle: string;
    features?: string[];
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
        currency: data.currency || 'IDR',
        billingCycle: data.billingCycle,
        features: data.features ? JSON.stringify(data.features) : null,
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
      currency?: string;
      billingCycle?: string;
      features?: string[];
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

  // ==================== PAYMENT MANAGEMENT ====================

  async findAllPayments(query: PaymentQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const { search, status, startDate, endDate, sortBy, sortOrder } = query;
    const skip = (page - 1) * limit;

    const where: any = {};

    // Search by orderId or user email
    if (search) {
      where.OR = [
        { orderId: { contains: search, mode: 'insensitive' } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    // Filter by status
    if (status && status !== 'all') {
      const statusMap: Record<string, string> = {
        paid: 'SUCCESS',
        pending: 'PENDING',
        failed: 'FAILED',
      };
      where.status = statusMap[status];
    }

    // Filter by date range
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    // Build orderBy
    let orderBy: any = { createdAt: sortOrder || 'desc' };
    if (sortBy === 'orderId') {
      orderBy = { orderId: sortOrder || 'desc' };
    } else if (sortBy === 'paymentMethod') {
      orderBy = { paymentType: sortOrder || 'asc' };
    } else if (sortBy === 'status') {
      orderBy = { status: sortOrder || 'asc' };
    }

    const [payments, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          user: { select: { email: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    // Format response sesuai UI
    const formattedData = payments.map((payment, index) => ({
      no: skip + index + 1,
      orderId: payment.orderId,
      tanggalPesan: payment.createdAt.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
      paymentMethod: payment.paymentType || '-',
      totalPembayaran: payment.amount,
      status: payment.status === 'SUCCESS' ? 'Paid' : payment.status === 'PENDING' ? 'Pending' : 'Failed',
    }));

    return {
      data: formattedData,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async exportPaymentsToExcel(query: PaymentQueryDto): Promise<Buffer> {
    const { status, startDate, endDate } = query;

    const where: any = {};

    if (status && status !== 'all') {
      const statusMap: Record<string, string> = {
        paid: 'SUCCESS',
        pending: 'PENDING',
        failed: 'FAILED',
      };
      where.status = statusMap[status];
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const payments = await this.prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { email: true, name: true } },
      },
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Payments');

    worksheet.columns = [
      { header: 'No', key: 'no', width: 5 },
      { header: 'Order ID', key: 'orderId', width: 30 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Package', key: 'package', width: 20 },
      { header: 'Payment Date', key: 'paymentDate', width: 15 },
      { header: 'Payment Method', key: 'paymentMethod', width: 15 },
      { header: 'Amount', key: 'amount', width: 15 },
      { header: 'Status', key: 'status', width: 12 },
    ];

    payments.forEach((payment, index) => {
      worksheet.addRow({
        no: index + 1,
        orderId: payment.orderId,
        email: payment.user?.email || '-',
        package: '-',
        paymentDate: payment.createdAt.toLocaleDateString('id-ID'),
        paymentMethod: payment.paymentType || '-',
        amount: payment.amount,
        status: payment.status,
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer as ArrayBuffer);
  }

  async findPaymentById(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    return payment;
  }

  async updatePayment(id: string, dto: UpdatePaymentDto) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    const updated = await this.prisma.payment.update({
      where: { id },
      data: {
        status: dto.status,
        paidAt: dto.status === 'SUCCESS' ? new Date() : null,
      },
    });

    return {
      success: true,
      message: 'Payment updated successfully',
      payment: updated,
    };
  }

  async deletePayment(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    await this.prisma.payment.delete({
      where: { id },
    });

    return {
      success: true,
      message: 'Payment deleted successfully',
    };
  }
}
