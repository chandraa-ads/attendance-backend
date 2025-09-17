import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CheckInDto {
  @ApiProperty({ example: 'uuid-of-user', description: 'User ID of the employee' })
  @IsString()
  @IsNotEmpty()
  userId: string;
}

export class CheckOutDto {
  @ApiProperty({ example: 'uuid-of-user', description: 'User ID of the employee' })
  @IsString()
  @IsNotEmpty()
  userId: string;
}

export class MyAttendanceQueryDto {
  @ApiProperty({ example: 'uuid-of-user', description: 'User ID of the employee' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiPropertyOptional({ example: '2025-09-01', description: 'From date (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ example: '2025-09-15', description: 'To date (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  to?: string;
}

export class AllAttendanceQueryDto {
   @ApiPropertyOptional({ example: '2025-09-15', description: 'Filter attendance by date (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ example: 'John', description: 'Filter by user name (partial match)' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'EMP123', description: 'Filter by employee ID (partial match)' })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({ example: '08:00', description: 'Filter check-in start time (HH:mm)' })
  @IsOptional()
  @IsString()
  checkInFrom?: string;

  @ApiPropertyOptional({ example: '17:00', description: 'Filter check-out end time (HH:mm)' })
  @IsOptional()
  @IsString()
  checkOutTo?: string;
}