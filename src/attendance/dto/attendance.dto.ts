import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsDateString, IsArray, ValidateNested, IsNumber, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CheckInDto {
  @ApiProperty()
  @IsString()
  userId: string;
}

export class CheckOutDto {
  @ApiProperty()
  @IsString()
  userId: string;
}

export class MyAttendanceQueryDto {
  @ApiProperty()
  @IsString()
  userId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class AllAttendanceQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  checkInFrom?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  checkOutTo?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  status?: string;
}

// New DTO for admin manual attendance
export class ManualAttendanceDto {
  @ApiProperty({ description: 'User ID to mark attendance for' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'Date in YYYY-MM-DD format' })
  @IsString()
  date: string;

  @ApiProperty({ description: 'Check-in time (HH:mm format, 24hr)', required: false })
  @IsOptional()
  @IsString()
  checkIn?: string;

  @ApiProperty({ description: 'Check-out time (HH:mm format, 24hr)', required: false })
  @IsOptional()
  @IsString()
  checkOut?: string;

  @ApiProperty({ description: 'Mark as absent (no check-in/out)', required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isAbsent?: boolean;

  @ApiProperty({ description: 'Reason for absence', required: false })
  @IsOptional()
  @IsString()
  absenceReason?: string;
}

// DTO for bulk attendance update
export class BulkAttendanceDto {
  @ApiProperty({
    description: 'Array of attendance records to update',
    type: [ManualAttendanceDto]
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualAttendanceDto)
  records: ManualAttendanceDto[];
}

// DTO for bulk action
export class BulkActionDto {
  @ApiProperty({ description: 'Action to perform: absent or present' })
  @IsString()
  action: string;

  @ApiProperty({ description: 'Date in YYYY-MM-DD format' })
  @IsString()
  date: string;

  @ApiProperty({ description: 'Array of user IDs', type: [String] })
  @IsArray()
  @IsString({ each: true })
  userIds: string[];

  @ApiProperty({ description: 'Reason for absence (if action is absent)', required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}

// DTO for attendance summary
export class AttendanceSummaryQueryDto {
  @ApiProperty({ description: 'User ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'Month (1-12)', required: false })
  @IsOptional()
  @IsString()
  month?: string;

  @ApiProperty({ description: 'Year (e.g., 2024)', required: false })
  @IsOptional()
  @IsString()
  year?: string;
}



// Add this DTO class to your attendance.dto.ts file
export class AttendanceFilterDto {
  @ApiPropertyOptional({ description: 'Start date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString({}, { message: 'Start date must be a valid date string' })
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString({}, { message: 'End date must be a valid date string' })
  endDate?: string;

  @ApiPropertyOptional({ description: 'Employee name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Employee ID' })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({ 
    description: 'Status filter',
    enum: ['present', 'absent', 'checked-in', 'checked-out', 'half-day', 'pending'],
    example: 'present'
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Month (MM)' })
  @IsOptional()
  @IsString()
  @Matches(/^(0[1-9]|1[0-2])$/, { message: 'Month must be between 01 and 12' })
  month?: string;

  @ApiPropertyOptional({ description: 'Year (YYYY)' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'Year must be 4 digits' })
  year?: string;

  @ApiPropertyOptional({ description: 'Specific date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString({}, { message: 'Date must be a valid date string' })
  date?: string;

  @ApiPropertyOptional({ description: 'Department' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ description: 'Designation' })
  @IsOptional()
  @IsString()
  designation?: string;

  @ApiPropertyOptional({ description: 'Manual entry filter', enum: ['true', 'false'] })
  @IsOptional()
  @IsString()
  manualEntry?: string;

  @ApiPropertyOptional({ 
    description: 'Page number', 
    default: 1,
    example: 1
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ 
    description: 'Items per page', 
    default: 20,
    example: 20
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ 
    description: 'Sort field', 
    enum: ['date', 'name', 'check_in', 'check_out', 'total_time_minutes'],
    default: 'date',
    example: 'date'
  })
  @IsOptional()
  @IsString()
  sortBy?: string = 'date';

  @ApiPropertyOptional({ 
    description: 'Sort direction', 
    enum: ['asc', 'desc'],
    default: 'desc',
    example: 'desc'
  })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';
}