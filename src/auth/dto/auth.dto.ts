import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength, IsNotEmpty, Matches } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'EMP12345', required: true, description: 'Employee ID' })
  @IsNotEmpty()
  @IsString()
  employee_id: string;

  @ApiProperty({ example: 'Software Engineer', required: false, description: 'Designation or job title' })
  @IsOptional()
  @IsString()
  designation?: string;
  
  @ApiProperty({ example: 'john_doe', required: true })
  @IsNotEmpty()
  @IsString()
  username: string;

  @ApiProperty({ example: 'john@example.com', required: true })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'John Doe', required: true })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: '9876543210', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{10}$/, { message: 'Mobile number must be 10 digits' })
  mobile?: string;

  @ApiProperty({ example: '9876543210', required: false, description: 'Emergency contact number' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{10}$/, { message: 'Emergency contact must be 10 digits' })
  ien?: string;

  @ApiProperty({ 
    example: 'admin', 
    required: false, 
    default: 'user',
    enum: ['admin', 'user'] 
  })
  @IsOptional()
  @IsString()
  @Matches(/^(admin|user)$/, { message: 'Role must be either admin or user' })
  role?: string;

  @ApiProperty({ example: 'StrongPassword@123', minLength: 6, required: true })
  @IsNotEmpty()
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password: string;

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
  @ApiProperty({ example: 'john@example.com', required: true })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'StrongPassword@123', required: true })
  @IsNotEmpty()
  @IsString()
  password: string;
}