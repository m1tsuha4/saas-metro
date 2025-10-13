import {
  Body,
  Controller,
  Get,
  Param,
  Res,
  Patch,
  Post,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { LoginDto, LoginSchema } from './dto/login.dto';
import { User } from '../common/decorators/user.decorator';
import { JwtAuthGuard } from './guard/jwt-guard.auth';
import { UserService } from 'src/user/user.service';
import { CreateUserDto, CreateUserSchema } from 'src/user/dto/create-user.dto';
import { UpdateUserDto, UpdateUserSchema } from 'src/user/dto/update-user.dto';
import { AuthGuard } from '@nestjs/passport';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  @Post('register')
  register(@Body(new ZodValidationPipe(CreateUserSchema)) dto: CreateUserDto) {
    return this.userService.createUser(dto);
  }

  @Post('login')
  async login(@Body(new ZodValidationPipe(LoginSchema)) loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth() {
    // initiates the Google OAuth2 login flow
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(
    @Req() req: Request & { user: { userId: string; role: 'ADMIN' | 'USER' } },
    @Res() res: Response,
  ) {
    const redirectUrl = await this.authService.buildGoogleRedirectUrl(req.user);
    return res.redirect(redirectUrl);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@User() user) {
    return user;
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateUser(
    @User() user,
    @Body(new ZodValidationPipe(UpdateUserSchema)) dto: UpdateUserDto,
  ) {
    return this.userService.updateUser(user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@User() user, @Req() request: Request) {
    // Extract token from Authorization header
    const authHeader = request.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
      throw new BadRequestException('Token not found in request headers');
    }
    return this.authService.logout(user.id, token);
  }
}
