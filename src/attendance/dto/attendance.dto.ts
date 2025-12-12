import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsDateString, IsArray, ValidateNested } from 'class-validator';
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