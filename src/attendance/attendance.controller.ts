import { 
  Controller, 
  Post, 
  Body, 
  Get, 
  Query, 
  BadRequestException, 
  UseGuards, 
  InternalServerErrorException, 
  Logger,
  Res,
  Req,
  UseInterceptors,
  Param,
  Put
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import type { Response, Request } from 'express';
import { AttendanceService } from './attendance.service';
import { 
  CheckInDto, 
  CheckOutDto, 
  MyAttendanceQueryDto, 
  AllAttendanceQueryDto, 
  ManualAttendanceDto,
  BulkAttendanceDto,
  BulkActionDto,
  AttendanceSummaryQueryDto,
  AttendanceFilterDto,
  UpdateAttendanceDto,
  HalfDayDto,
  PermissionTimeDto,
  GenerateReportDto
} from './dto/attendance.dto';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@ApiTags('Attendance')
@Controller('attendance')
@ApiBearerAuth()
export class AttendanceController {
  private readonly logger = new Logger(AttendanceController.name);

  constructor(private readonly attendanceService: AttendanceService) { }

  @Post('checkin')
  @ApiOperation({ summary: 'Check-in for the day' })
  @ApiResponse({ status: 201, description: 'Check-in successful' })
  @ApiResponse({ status: 400, description: 'Already checked in / Invalid request' })
  checkIn(@Body() body: CheckInDto) {
    try {
      this.logger.log(`Check-in request for user: ${body.userId}`);
      return this.attendanceService.checkIn(body.userId);
    } catch (error) {
      this.logger.error(`Check-in error: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Post('checkout')
  @ApiOperation({ summary: 'Check-out for the day' })
  @ApiResponse({ status: 200, description: 'Check-out successful' })
  @ApiResponse({ status: 400, description: 'Already checked out / No check-in found' })
  checkOut(@Body() body: CheckOutDto) {
    try {
      this.logger.log(`Check-out request for user: ${body.userId}`);
      return this.attendanceService.checkOut(body.userId);
    } catch (error) {
      this.logger.error(`Check-out error: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('me')
  @ApiOperation({ summary: 'Get my attendance (with optional date range)' })
  @ApiResponse({ status: 200, description: 'Attendance records retrieved' })
  my(@Query() query: MyAttendanceQueryDto) {
    try {
      if (!query.userId) throw new BadRequestException('userId query parameter is required');
      this.logger.log(`Get attendance for user: ${query.userId}, from: ${query.from}, to: ${query.to}`);
      return this.attendanceService.getMyAttendance(query.userId, query.from, query.to);
    } catch (error) {
      this.logger.error(`Get my attendance error: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('filter-by-employee-id')
  @ApiOperation({ summary: 'Filter attendance records by employee ID' })
  @ApiResponse({ status: 200, description: 'Filtered attendance retrieved' })
  async filterByEmployeeId(@Query('employee_id') employeeId: string) {
    try {
      if (!employeeId) throw new BadRequestException('employee_id query parameter is required');
      this.logger.log(`Filter attendance by employee ID: ${employeeId}`);
      return this.attendanceService.getAttendanceByEmployeeId(employeeId);
    } catch (error) {
      this.logger.error(`Filter by employee ID error: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('all')
  @ApiOperation({ summary: 'Get all attendance records' })
  @ApiResponse({ status: 200, description: 'All attendance records retrieved' })
  getAllAttendance(@Query() query: AllAttendanceQueryDto) {
    try {
      this.logger.log(`Get all attendance with filters: ${JSON.stringify(query)}`);
      return this.attendanceService.getAll(query);
    } catch (error) {
      this.logger.error(`Get all attendance error: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get attendance summary for a user' })
  @ApiResponse({ status: 200, description: 'Attendance summary retrieved' })
  async getAttendanceSummary(@Query() query: AttendanceSummaryQueryDto) {
    try {
      if (!query.userId) throw new BadRequestException('userId is required');
      this.logger.log(`Get attendance summary for user: ${query.userId}, month: ${query.month}, year: ${query.year}`);
      return this.attendanceService.getAttendanceSummary(query.userId, query.month, query.year);
    } catch (error) {
      this.logger.error(`Get attendance summary error: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Post('manual')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin: Manual attendance entry for users' })
  @ApiResponse({ status: 201, description: 'Manual attendance recorded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async manualAttendance(@Body() body: ManualAttendanceDto) {
    try {
      this.logger.log(`Manual attendance request: ${JSON.stringify(body)}`);
      const result = await this.attendanceService.manualAttendance(body);
      this.logger.log(`Manual attendance successful: ${result.message}`);
      return result;
    } catch (error) {
      this.logger.error(`Manual attendance error: ${error.message}`, error.stack);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        error.message || 'Failed to record manual attendance'
      );
    }
  }

  // In your AttendanceController.ts
@Post('bulk')
@Roles('admin')
async bulkAttendanceUpdate(
  @Body() records: Array<{
    userId: string;
    date: string;
    isAbsent?: boolean;
    checkIn?: string;
    checkOut?: string;
    absenceReason?: string;
  }>
) {
  return this.attendanceService.bulkAttendanceUpdate(records);
}

  @Post('bulk-action')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin: Bulk action for multiple users' })
  @ApiResponse({ status: 201, description: 'Bulk action completed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  async bulkAction(@Body() body: BulkActionDto) {
    try {
      this.logger.log(`Bulk action request: ${JSON.stringify(body)}`);
      return this.attendanceService.processBulkAction(body);
    } catch (error) {
      this.logger.error(`Bulk action error: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('stats')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin: Get dashboard statistics' })
  @ApiResponse({ status: 200, description: 'Statistics retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  async getStats(@Query('date') date?: string) {
    try {
      this.logger.log(`Get dashboard stats for date: ${date || 'today'}`);
      return this.attendanceService.getDashboardStats(date);
    } catch (error) {
      this.logger.error(`Get dashboard stats error: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('filter')
  @ApiOperation({ summary: 'Get all attendance with advanced filters' })
  @ApiResponse({ status: 200, description: 'Filtered attendance retrieved' })
  async getAllWithFilters(@Query() filters: AttendanceFilterDto) {
    try {
      this.logger.log(`Get attendance with filters: ${JSON.stringify(filters)}`);
      return this.attendanceService.getAllAttendanceWithFilters(filters);
    } catch (error) {
      this.logger.error(`Get all with filters error: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('monthly-report')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin: Get monthly attendance report' })
  @ApiResponse({ status: 200, description: 'Monthly report generated' })
  async getMonthlyReport(
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('department') department?: string
  ) {
    try {
      this.logger.log(`Get monthly report: year=${year}, month=${month}, department=${department}`);
      return this.attendanceService.getMonthlyReport(year, month, department);
    } catch (error) {
      this.logger.error(`Monthly report error: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('export')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin: Export attendance data to CSV' })
  @ApiResponse({ status: 200, description: 'Attendance data exported successfully' })
  async exportAttendance(
    @Query() filters: AttendanceFilterDto,
    @Res() response: Response
  ) {
    try {
      this.logger.log(`Export attendance with filters: ${JSON.stringify(filters)}`);
      
      // Get data without pagination for export
      const exportFilters = { ...filters, limit: 1000, page: 1 };
      const result = await this.attendanceService.getAllAttendanceWithFilters(exportFilters);
      
      // Convert to CSV format
      const csvData = this.convertToCSV(result.data);
      
      // Set response headers for CSV download
      const filename = `attendance_export_${new Date().toISOString().slice(0, 10)}.csv`;
      response.setHeader('Content-Type', 'text/csv');
      response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      response.send(csvData);
    } catch (error) {
      this.logger.error(`Export error: ${error.message}`, error.stack);
      throw error;
    }
  }

  // ✅ NEW: Update previous attendance records
  @Put('update/:id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin: Update existing attendance record' })
  @ApiResponse({ status: 200, description: 'Attendance record updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  async updateAttendance(
    @Param('id') id: string,
    @Body() body: UpdateAttendanceDto
  ) {
    try {
      this.logger.log(`Update attendance request for record ${id}: ${JSON.stringify(body)}`);
      return this.attendanceService.updateAttendanceRecord(id, body);
    } catch (error) {
      this.logger.error(`Update attendance error: ${error.message}`, error.stack);
      throw error;
    }
  }

  // ✅ NEW: Mark half day (morning/afternoon)
  @Post('half-day')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin: Mark half day attendance' })
  @ApiResponse({ status: 201, description: 'Half day marked successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async markHalfDay(@Body() body: HalfDayDto) {
    try {
      this.logger.log(`Half day request: ${JSON.stringify(body)}`);
      return this.attendanceService.markHalfDay(body);
    } catch (error) {
      this.logger.error(`Half day error: ${error.message}`, error.stack);
      throw error;
    }
  }

  // ✅ NEW: Record permission time
  @Post('permission')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin: Record permission time for user' })
  @ApiResponse({ status: 201, description: 'Permission time recorded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async recordPermission(@Body() body: PermissionTimeDto) {
    try {
      this.logger.log(`Permission time request: ${JSON.stringify(body)}`);
      return this.attendanceService.recordPermissionTime(body);
    } catch (error) {
      this.logger.error(`Permission time error: ${error.message}`, error.stack);
      throw error;
    }
  }

  // ✅ NEW: Generate PDF report
@Post('generate-pdf')
@UseGuards(RolesGuard)
@Roles('admin')
@ApiOperation({ summary: 'Admin: Generate PDF attendance report' })
async generatePDFReport(
  @Body() body: GenerateReportDto,
  @Res() response: Response
) {
  const { pdfBuffer, meta } =
    await this.attendanceService.generatePDFReport(body);

  const filename = `attendance_report_${new Date()
    .toISOString()
    .slice(0, 10)}.pdf`;

  response.setHeader('Content-Type', 'application/pdf');
  response.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"`
  );

  // 👇 Optional meta (frontend can read it)
  response.setHeader(
    'X-Report-Filters',
    encodeURIComponent(JSON.stringify(meta))
  );

  response.send(pdfBuffer);
}


  // ✅ NEW: Bulk calculate attendance for specific time
  @Post('bulk-calculate')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin: Bulk calculate attendance for specific time period' })
  @ApiResponse({ status: 200, description: 'Attendance calculated successfully' })
  async bulkCalculateAttendance(
    @Body() body: {
      userIds: string[];
      startDate: string;
      endDate: string;
      workingHoursPerDay?: number;
    }
  ) {
    try {
      this.logger.log(`Bulk calculate request: ${JSON.stringify(body)}`);
      return this.attendanceService.bulkCalculateAttendance(
        body.userIds,
        body.startDate,
        body.endDate,
        body.workingHoursPerDay
      );
    } catch (error) {
      this.logger.error(`Bulk calculate error: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('test')
  @ApiOperation({ summary: 'Test endpoint for debugging' })
  @ApiResponse({ status: 200, description: 'Test successful' })
  async testEndpoint() {
    return {
      message: 'Attendance API is working',
      timestamp: new Date().toISOString(),
      version: '2.0.0',
      features: [
        'Check-in/Check-out',
        'Manual attendance',
        'Bulk operations',
        'Half day marking',
        'Permission time tracking',
        'PDF report generation',
        'Advanced filtering',
        'Previous data updates'
      ]
    };
  }

  // Helper method to convert data to CSV
  private convertToCSV(data: any[]): string {
    if (!data || data.length === 0) {
      return '';
    }

    const headers = [
      'Date',
      'Employee ID',
      'Name',
      'Department',
      'Designation',
      'Check In',
      'Check Out',
      'Total Time',
      'Status',
      'Absence Reason',
      'Half Day Type',
      'Permission Time',
      'Permission Reason',
      'Manual Entry'
    ];

    const rows = data.map(item => [
      item.date,
      item.user_info?.employee_id || '',
      item.user_info?.name || '',
      item.user_info?.department || '',
      item.user_info?.designation || '',
      item.check_in_ist || '',
      item.check_out_ist || '',
      item.total_time_formatted || '',
      item.status,
      item.absence_reason || '',
      item.half_day_type || '',
      item.permission_time || '',
      item.permission_reason || '',
      item.manual_entry ? 'Yes' : 'No'
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    return csvContent;
  }
}