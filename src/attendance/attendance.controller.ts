import { Controller, Post, Body, Get, Query, BadRequestException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import { 
  CheckInDto, 
  CheckOutDto, 
  MyAttendanceQueryDto, 
  AllAttendanceQueryDto, 
  ManualAttendanceDto,
  BulkAttendanceDto,
  BulkActionDto,
  AttendanceSummaryQueryDto
} from './dto/attendance.dto';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@ApiTags('Attendance')
@Controller('attendance')
@ApiBearerAuth()
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) { }

  @Post('checkin')
  @ApiOperation({ summary: 'Check-in for the day' })
  @ApiResponse({ status: 201, description: 'Check-in successful' })
  @ApiResponse({ status: 400, description: 'Already checked in / Invalid request' })
  checkIn(@Body() body: CheckInDto) {
    return this.attendanceService.checkIn(body.userId);
  }

  @Post('checkout')
  @ApiOperation({ summary: 'Check-out for the day' })
  @ApiResponse({ status: 200, description: 'Check-out successful' })
  @ApiResponse({ status: 400, description: 'Already checked out / No check-in found' })
  checkOut(@Body() body: CheckOutDto) {
    return this.attendanceService.checkOut(body.userId);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get my attendance (with optional date range)' })
  @ApiResponse({ status: 200, description: 'Attendance records retrieved' })
  my(@Query() query: MyAttendanceQueryDto) {
    if (!query.userId) throw new BadRequestException('userId query parameter is required');
    return this.attendanceService.getMyAttendance(query.userId, query.from, query.to);
  }

  @Get('filter-by-employee-id')
  @ApiOperation({ summary: 'Filter attendance records by employee ID' })
  @ApiResponse({ status: 200, description: 'Filtered attendance retrieved' })
  async filterByEmployeeId(@Query('employee_id') employeeId: string) {
    return this.attendanceService.getAttendanceByEmployeeId(employeeId);
  }

  @Get('all')
  @ApiOperation({ summary: 'Get all attendance records' })
  @ApiResponse({ status: 200, description: 'All attendance records retrieved' })
  getAllAttendance(@Query() query: AllAttendanceQueryDto) {
    return this.attendanceService.getAll(query);
  }

  // ✅ Get attendance summary
  @Get('summary')
  @ApiOperation({ summary: 'Get attendance summary for a user' })
  @ApiResponse({ status: 200, description: 'Attendance summary retrieved' })
  async getAttendanceSummary(@Query() query: AttendanceSummaryQueryDto) {
    if (!query.userId) throw new BadRequestException('userId is required');
    return this.attendanceService.getAttendanceSummary(query.userId, query.month, query.year);
  }

  // ✅ Admin-only manual attendance entry
  @Post('manual')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin: Manual attendance entry for users' })
  @ApiResponse({ status: 201, description: 'Manual attendance recorded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  async manualAttendance(@Body() body: ManualAttendanceDto) {
    return this.attendanceService.manualAttendance(body);
  }

  // ✅ Bulk manual attendance (multiple records)
  @Post('bulk')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin: Bulk attendance update for multiple users' })
  @ApiResponse({ status: 201, description: 'Bulk attendance recorded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  async bulkAttendance(@Body() body: BulkAttendanceDto) {
    return this.attendanceService.bulkAttendanceUpdate(body.records);
  }

  // ✅ Bulk action (mark multiple users as absent/present)
  @Post('bulk-action')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin: Bulk action for multiple users' })
  @ApiResponse({ status: 201, description: 'Bulk action completed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  async bulkAction(@Body() body: BulkActionDto) {
    return this.attendanceService.processBulkAction(body);
  }

  // ✅ Get dashboard statistics
  @Get('stats')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin: Get dashboard statistics' })
  @ApiResponse({ status: 200, description: 'Statistics retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  async getStats(@Query('date') date?: string) {
    return this.attendanceService.getDashboardStats(date);
  }
}