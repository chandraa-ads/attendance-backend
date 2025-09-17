import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UserDashboardQueryDto {
  @ApiProperty({ example: 'uuid-of-user', description: 'User ID of the employee' })
  @IsString()
  @IsNotEmpty()
  userId: string;
}

export class AdminDashboardQueryDto {
  @ApiPropertyOptional({ example: '2025-09-15', description: 'Filter by date (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ example: 'admin', description: 'Filter by role (e.g. admin, user)' })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({ example: 'active', description: 'Filter by status (custom logic if used)' })
  @IsOptional()
  @IsString()
  status?: string;
}
