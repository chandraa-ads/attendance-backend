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
  Res 
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express'; // Import Response from express
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
  AttendanceFilterDto // Add this import
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

  // ✅ Get attendance summary
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

  // ✅ Admin-only manual attendance entry
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
      
      // Log user info for debugging
      const request = (this as any).req;
      if (request?.user) {
        this.logger.debug(`Request user: ${JSON.stringify(request.user)}`);
      }
      
      const result = await this.attendanceService.manualAttendance(body);
      this.logger.log(`Manual attendance successful: ${result.message}`);
      return result;
    } catch (error) {
      this.logger.error(`Manual attendance error: ${error.message}`, error.stack);
      this.logger.error(`Error details: ${JSON.stringify(error)}`);
      
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      throw new InternalServerErrorException(
        error.message || 'Failed to record manual attendance'
      );
    }
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
    try {
      this.logger.log(`Bulk attendance request for ${body.records?.length || 0} records`);
      return this.attendanceService.bulkAttendanceUpdate(body.records);
    } catch (error) {
      this.logger.error(`Bulk attendance error: ${error.message}`, error.stack);
      throw error;
    }
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
    try {
      this.logger.log(`Bulk action request: ${JSON.stringify(body)}`);
      return this.attendanceService.processBulkAction(body);
    } catch (error) {
      this.logger.error(`Bulk action error: ${error.message}`, error.stack);
      throw error;
    }
  }

  // ✅ Get dashboard statistics
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

  // ✅ Get all attendance with advanced filters
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

  // ✅ Get monthly attendance report
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

  // ✅ Export attendance data to CSV
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

  // ✅ Test endpoint for debugging
  @Get('test')
  @ApiOperation({ summary: 'Test endpoint for debugging' })
  @ApiResponse({ status: 200, description: 'Test successful' })
  async testEndpoint() {
    return {
      message: 'Attendance API is working',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
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
      item.manual_entry ? 'Yes' : 'No'
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    return csvContent;
  }
}