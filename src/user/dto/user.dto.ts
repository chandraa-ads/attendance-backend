import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UploadProfileDto {
  @ApiProperty({
    example: 'uuid-of-user',
    description: 'User ID of the employee',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'Profile image file',
  })
  file: any;
}

export class UserQueryDto {
  @ApiProperty({
    example: 'uuid-of-user',
    description: 'User ID of the employee',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;
}

export class AllUsersQueryDto {
  @ApiPropertyOptional({
    example: 'admin',
    description: 'Filter users by role',
  })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({
    example: 'John',
    description: 'Search users by name (partial match)',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    example: 'EMP001',
    description: 'Search users by employee ID (partial match)',
  })
  @IsOptional()
  @IsString()
  employeeId?: string;
}
