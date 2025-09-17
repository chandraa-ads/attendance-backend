import { Controller, Post, UseInterceptors, UploadedFile, Body, Get, Query } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiQuery } from '@nestjs/swagger';
import { UserService } from './user.service';
import { UploadProfileDto, UserQueryDto, AllUsersQueryDto } from './dto/user.dto';

@ApiTags('Users')
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  // Upload profile picture
  @Post('upload-profile')
  @ApiOperation({ summary: 'Upload user profile picture' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({
    status: 201,
    description: 'Profile uploaded successfully',
    schema: { example: { profileUrl: 'https://your-bucket-url/userid/profile.png' } },
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadProfile(@UploadedFile() file: Express.Multer.File, @Body() body: UploadProfileDto) {
    return this.userService.uploadProfile(body.userId, file);
  }

  // Get single user by ID
  @Get('me')
  @ApiOperation({ summary: 'Get single user details by ID' })
  @ApiResponse({
    status: 200,
    description: 'User retrieved successfully',
    schema: {
      example: {
        id: 'uuid',
        name: 'Pradeep G',
        email: 'pradeep@example.com',
        role: 'user',
        profile_url: 'https://bucket-url/image.png',
        employee_id: 'EMP010',
        designation: 'Software Engineer',
        ien: '9876543210',
      },
    },
  })
  async me(@Query() query: UserQueryDto) {
    return this.userService.getUser(query.userId);
  }

  // List all users with optional filters
  @Get('all')
  @ApiOperation({ summary: 'List all users with optional filters (role, name, employeeId)' })
  @ApiQuery({ name: 'role', required: false, description: 'Filter users by role (admin/user)' })
  @ApiQuery({ name: 'name', required: false, description: 'Filter users by name (partial match)' })
  @ApiQuery({ name: 'employeeId', required: false, description: 'Filter users by employeeId (partial match)' })
  @ApiResponse({
    status: 200,
    description: 'Users retrieved successfully',
    schema: {
      example: [
        {
          id: 'uuid',
          name: 'Alice',
          role: 'admin',
          email: 'alice@example.com',
          employee_id: 'EMP001',
        },
      ],
    },
  })
  async all(@Query() query: AllUsersQueryDto) {
    return this.userService.listUsers(query.role, query.name, query.employeeId);
  }
}
