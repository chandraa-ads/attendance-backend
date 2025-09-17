import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {

  @ApiProperty({ example: 'EMP12345', required: false, description: 'Employee ID' })
  @IsOptional()
  @IsString()
  employee_id?: string;

  @ApiProperty({ example: 'Software Engineer', required: false, description: 'Designation or job title' })
  @IsOptional()
  @IsString()
  designation?: string;
  
  @ApiProperty({ example: 'john_doe', required: false })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'John Doe', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: '9876543210', required: false })
  @IsOptional()
  @IsString()
  mobile?: string;

  @ApiProperty({ example: '9876543210', required: false, description: 'Emergency contact number' })
  @IsOptional()
  @IsString()
  ien?: string;  // ✅ Added

  @ApiProperty({ example: 'admin', required: false, default: 'user' })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiProperty({ example: 'StrongPassword@123', minLength: 6, required: false })
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  // For Swagger UI file upload
  @ApiProperty({
    type: 'string',
    format: 'binary',
    required: false,
    description: 'Profile image file',
  })
  profile?: any;
}

export class LoginDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'StrongPassword@123' })
  @IsString()
  @MinLength(6)
  password: string;
}
