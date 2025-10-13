import { ConflictException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './dto/login.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private jwtService: JwtService,
    private prismaService: PrismaService,
  ) {}

  signToken(userId: string, role: 'ADMIN' | 'USER') {
    return this.jwtService.sign({ sub: userId, role});
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const user = await this.userService.findByEmail(email);
    if (!user || !user.password) {
      throw new ConflictException(user ? 'Please sign in with Google for this account' :'Invalid credentials');
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new ConflictException('Invalid credentials');
    }

    const accessToken = this.signToken(user.id, user.role as 'ADMIN' | 'USER' );

    return {
      access_token: accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }
  async logout(id: string, token: string) {
    // Add token to blacklist table in database
    await this.prismaService.tokenBlacklist.create({
      data: {
        token: token,
        userId: id,
        createdAt: new Date(),
      },
    });

    return {
      message: 'Logout successful',
      success: true,
    };
  }

  async buildGoogleRedirectUrl(payload: { userId: string; role: 'ADMIN' | 'USER'}) {
    const token = this.signToken(payload.userId, payload.role);
    return `${process.env.FRONTEND_URL}/auth/callback?token=${token}`;
  }
}
