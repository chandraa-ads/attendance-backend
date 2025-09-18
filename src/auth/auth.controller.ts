import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFile,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthService } from './auth.service';
import { CreateUserDto, LoginDto } from './dto/auth.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Create user with optional profile upload
  @Post('create-user')
  @UseInterceptors(FileInterceptor('profile'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreateUserDto })
  async createUser(
    @Body() payload: CreateUserDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.authService.createUser(payload, file);
  }

 @Post('login/admin')
async loginAdmin(@Body() body: LoginDto) {
  return this.authService.login(body.email, body.password, 'admin');
}

@Post('login/user')
async loginUser(@Body() body: LoginDto) {
  return this.authService.login(body.email, body.password, 'user');
}


}
