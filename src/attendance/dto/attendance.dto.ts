import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { 
  IsString, 
  IsOptional, 
  IsBoolean, 
  IsDateString, 
  IsArray, 
  ValidateNested, 
  IsNumber, 
  Matches, 
  Max, 
  Min, 
  IsEnum,
  IsIn
} from 'class-validator';
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
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be in YYYY-MM-DD format' })
  date: string;

  @ApiProperty({ description: 'Check-in time (HH:mm format, 24hr)', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, { message: 'Check-in time must be in HH:mm format (24-hour)' })
  checkIn?: string;

  @ApiProperty({ description: 'Check-out time (HH:mm format, 24hr)', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, { message: 'Check-out time must be in HH:mm format (24-hour)' })
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
  @IsIn(['absent', 'present'], { message: 'Action must be either "absent" or "present"' })
  action: string;

  @ApiProperty({ description: 'Date in YYYY-MM-DD format' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be in YYYY-MM-DD format' })
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
  @Matches(/^(0[1-9]|1[0-2])$/, { message: 'Month must be between 01 and 12' })
  month?: string;

  @ApiProperty({ description: 'Year (e.g., 2024)', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'Year must be 4 digits' })
  year?: string;
}

// DTO for attendance filters
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
  @IsIn(['present', 'absent', 'checked-in', 'checked-out', 'half-day', 'pending'], 
    { message: 'Status must be one of: present, absent, checked-in, checked-out, half-day, pending' })
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
  @IsIn(['true', 'false'], { message: 'manualEntry must be either "true" or "false"' })
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
  @IsIn(['date', 'name', 'check_in', 'check_out', 'total_time_minutes'], 
    { message: 'sortBy must be one of: date, name, check_in, check_out, total_time_minutes' })
  sortBy?: string = 'date';

  @ApiPropertyOptional({ 
    description: 'Sort direction', 
    enum: ['asc', 'desc'],
    default: 'desc',
    example: 'desc'
  })
  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'], { message: 'sortOrder must be either "asc" or "desc"' })
  sortOrder?: 'asc' | 'desc' = 'desc';
}

// ========== NEW DTOs ==========

// ✅ NEW: Update Attendance DTO
export class UpdateAttendanceDto {
  @ApiPropertyOptional({ description: 'Date in YYYY-MM-DD format' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be in YYYY-MM-DD format' })
  date?: string;

  @ApiPropertyOptional({ description: 'Check-in time (HH:mm format, 24hr)' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, { 
    message: 'Check-in time must be in HH:mm format (24-hour)' 
  })
  checkIn?: string;

  @ApiPropertyOptional({ description: 'Check-out time (HH:mm format, 24hr)' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, { 
    message: 'Check-out time must be in HH:mm format (24-hour)' 
  })
  checkOut?: string;

  @ApiPropertyOptional({ description: 'Mark as absent' })
  @IsOptional()
  @IsBoolean()
  isAbsent?: boolean;

  @ApiPropertyOptional({ description: 'Reason for absence' })
  @IsOptional()
  @IsString()
  absenceReason?: string;

  @ApiPropertyOptional({ 
    description: 'Half day type',
    enum: ['morning', 'afternoon']
  })
  @IsOptional()
  @IsString()
  @IsIn(['morning', 'afternoon'], { 
    message: 'Half day type must be either "morning" or "afternoon"' 
  })
  halfDayType?: string;

  @ApiPropertyOptional({ description: 'Permission time (e.g., "14:00-15:00")' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]-([01]?[0-9]|2[0-3]):[0-5][0-9]$/, { 
    message: 'Permission time must be in format "HH:mm-HH:mm"' 
  })
  permissionTime?: string;

  @ApiPropertyOptional({ description: 'Permission reason' })
  @IsOptional()
  @IsString()
  permissionReason?: string;

  @ApiPropertyOptional({ description: 'Additional notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ✅ NEW: Half Day DTO
export class HalfDayDto {
  @ApiProperty({ description: 'User ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'Date in YYYY-MM-DD format' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be in YYYY-MM-DD format' })
  date: string;

  @ApiProperty({ 
    description: 'Half day type',
    enum: ['morning', 'afternoon']
  })
  @IsString()
  @IsIn(['morning', 'afternoon'], { 
    message: 'Half day type must be either "morning" or "afternoon"' 
  })
  halfDayType: string;

  @ApiPropertyOptional({ 
    description: 'Check-in time (HH:mm format, optional)',
    example: '09:00'
  })
  @IsOptional()
  @IsString()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, { 
    message: 'Check-in time must be in HH:mm format (24-hour)' 
  })
  checkIn?: string;

  @ApiPropertyOptional({ 
    description: 'Check-out time (HH:mm format, optional)',
    example: '13:00'
  })
  @IsOptional()
  @IsString()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, { 
    message: 'Check-out time must be in HH:mm format (24-hour)' 
  })
  checkOut?: string;

  @ApiPropertyOptional({ description: 'Reason for half day' })
  @IsOptional()
  @IsString()
  reason?: string;
}

// ✅ NEW: Permission Time DTO
export class PermissionTimeDto {
  @ApiProperty({ description: 'User ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'Date in YYYY-MM-DD format' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be in YYYY-MM-DD format' })
  date: string;

  @ApiProperty({ 
    description: 'Permission start time (HH:mm format)',
    example: '14:00'
  })
  @IsString()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, { 
    message: 'Permission time must be in HH:mm format (24-hour)' 
  })
  permissionFrom: string;

  @ApiProperty({ 
    description: 'Permission end time (HH:mm format)',
    example: '15:00'
  })
  @IsString()
  @Matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, { 
    message: 'Permission time must be in HH:mm format (24-hour)' 
  })
  permissionTo: string;

  @ApiProperty({ description: 'Reason for permission' })
  @IsString()
  reason: string;
}

// ✅ NEW: Generate Report DTO
export class GenerateReportDto {
  // Date filters
  @IsOptional()
  @IsDateString()
  startDate?: string; // YYYY-MM-DD

  @IsOptional()
  @IsDateString()
  endDate?: string; // YYYY-MM-DD

  @IsOptional()
  @IsDateString()
  day?: string; // YYYY-MM-DD (single day)

  @IsOptional()
  @IsString()
  month?: string; // YYYY-MM (ex: 2025-12)

  // Other filters
  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsEnum(['summary', 'detailed'])
  reportType?: 'summary' | 'detailed';
}

// ✅ NEW: Bulk Calculate DTO
export class BulkCalculateDto {
  @ApiProperty({ description: 'Array of user IDs', type: [String] })
  @IsArray()
  @IsString({ each: true })
  userIds: string[];

  @ApiProperty({ description: 'Start date in YYYY-MM-DD format' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Start date must be in YYYY-MM-DD format' })
  startDate: string;

  @ApiProperty({ description: 'End date in YYYY-MM-DD format' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'End date must be in YYYY-MM-DD format' })
  endDate: string;

  @ApiPropertyOptional({ 
    description: 'Working hours per day',
    default: 8,
    example: 8
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(24)
  workingHoursPerDay?: number = 8;
}

// ✅ NEW: Attendance Stats Query DTO
export class AttendanceStatsQueryDto {
  @ApiPropertyOptional({ description: 'Date for stats (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be in YYYY-MM-DD format' })
  date?: string;
}

// ✅ NEW: Export Attendance DTO
export class ExportAttendanceDto {
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
    enum: ['present', 'absent', 'checked-in', 'checked-out', 'half-day', 'pending']
  })
  @IsOptional()
  @IsString()
  @IsIn(['present', 'absent', 'checked-in', 'checked-out', 'half-day', 'pending'])
  status?: string;

  @ApiPropertyOptional({ description: 'Department' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ 
    description: 'Export format',
    enum: ['csv', 'excel', 'pdf'],
    default: 'csv'
  })
  @IsOptional()
  @IsString()
  @IsIn(['csv', 'excel', 'pdf'])
  format?: string = 'csv';
}