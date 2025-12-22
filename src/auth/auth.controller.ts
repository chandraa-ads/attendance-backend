import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFile,
  Delete,
  Param,
  Patch,
  Put,
  Get,
} from '@nestjs/common';
import { ApiTags, ApiConsumes, ApiBody, ApiOperation } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthService } from './auth.service';
import { CreateUserDto, LoginDto } from './dto/auth.dto';
import { UpdateUserDto} from './dto/update-auth.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /* ================= GET ALL USERS ================= */
  @Get('users')
  @ApiOperation({ summary: 'Get all users' })
  getUsers() {
    return this.authService.getUsers();
  }

  /* ================= GET USER BY ID ================= */
  @Get('user/:employee_id')
  @ApiOperation({ summary: 'Get user by employee ID' })
  getUserById(@Param('employee_id') employeeId: string) {
    return this.authService.getUserById(employeeId);
  }

  /* ================= CREATE ================= */
  @Post('create-user')
  @UseInterceptors(FileInterceptor('profile'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreateUserDto })
  @ApiOperation({ summary: 'Create a new user' })
  createUser(
    @Body() payload: CreateUserDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.authService.createUser(payload, file);
  }

  /* ================= LOGIN ================= */
  @Post('login/admin')
  @ApiOperation({ summary: 'Login as admin' })
  loginAdmin(@Body() body: LoginDto) {
    return this.authService.login(body.email, body.password, 'admin');
  }

  @Post('login/user')
  @ApiOperation({ summary: 'Login as user' })
  loginUser(@Body() body: LoginDto) {
    return this.authService.login(body.email, body.password, 'user');
  }

  /* ================= FULL UPDATE (PUT) ================= */
  @Put('update-user/:employee_id')
  @UseInterceptors(FileInterceptor('profile'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreateUserDto })
  @ApiOperation({ summary: 'Full update user (replace all data)' })
  updateUserFull(
    @Param('employee_id') employeeId: string,
    @Body() payload: CreateUserDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.authService.updateUserFull(employeeId, payload, file);
  }

  /* ================= PARTIAL UPDATE (PATCH) ================= */
  @Patch('update-user/:employee_id')
  @UseInterceptors(FileInterceptor('profile'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UpdateUserDto })
  @ApiOperation({ summary: 'Partial update user (update specific fields)' })
  updateUserPartial(
    @Param('employee_id') employeeId: string,
    @Body() payload: UpdateUserDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.authService.updateUserPartial(employeeId, payload, file);
  }

  /* ================= DELETE ================= */
  @Delete('delete-user/:employee_id')
  @ApiOperation({ summary: 'Delete user by employee ID' })
  deleteUser(@Param('employee_id') employeeId: string) {
    return this.authService.deleteUser(employeeId);
  }
}