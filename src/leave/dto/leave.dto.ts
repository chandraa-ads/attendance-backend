import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ApplyLeaveDto {
  @ApiProperty({ example: 'uuid-of-user', description: 'User ID of the employee' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ example: '2025-09-20', description: 'Date of leave (YYYY-MM-DD)' })
  @IsDateString()
  leaveDate: string;

  @ApiProperty({ example: 'Medical leave', description: 'Reason for applying leave' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class ApproveLeaveDto {
  @ApiProperty({ example: 'leave-uuid', description: 'Leave ID' })
  @IsString()
  @IsNotEmpty()
  leaveId: string;

  @ApiProperty({ example: 'approved', enum: ['approved', 'rejected'] })
  @IsEnum(['approved', 'rejected'])
  status: 'approved' | 'rejected';
}

export class MyLeavesQueryDto {
  @ApiProperty({ example: 'uuid-of-user', description: 'User ID of the employee' })
  @IsString()
  @IsNotEmpty()
  userId: string;
}

export class AllLeavesQueryDto {
  @ApiPropertyOptional({ example: '2025-09-01', description: 'Start date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2025-09-30', description: 'End date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ example: 'approved', enum: ['pending', 'approved', 'rejected'], description: 'Leave status' })
  @IsOptional()
  @IsEnum(['pending', 'approved', 'rejected'])
  status?: string;
}
