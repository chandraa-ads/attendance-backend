import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength, Matches } from 'class-validator';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Senior Software Engineer' })
  @IsOptional()
  @IsString()
  designation?: string;

  @ApiPropertyOptional({ example: 'john_doe_updated' })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({ example: 'John Doe Updated' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: '9876543210' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{10}$/, { message: 'Mobile number must be 10 digits' })
  mobile?: string;

  @ApiPropertyOptional({ example: '9876543210' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{10}$/, { message: 'Emergency contact must be 10 digits' })
  ien?: string;

  @ApiPropertyOptional({ 
    enum: ['admin', 'user'], 
    default: 'user',
    example: 'admin' 
  })
  @IsOptional()
  @IsString()
  @Matches(/^(admin|user)$/, { message: 'Role must be either admin or user' })
  role?: 'admin' | 'user';

  @ApiPropertyOptional({ 
    example: 'NewStrongPassword@123', 
    minLength: 6,
    description: 'Optional new password' 
  })
  @IsOptional()
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password?: string;

  @ApiPropertyOptional({
    type: 'string',
    format: 'binary',
    description: 'Optional profile image file',
  })
  profile?: any;
}