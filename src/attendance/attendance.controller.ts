import { Controller, Post, Body, Get, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import { CheckInDto, CheckOutDto, MyAttendanceQueryDto, AllAttendanceQueryDto } from './dto/attendance.dto';

@ApiTags('Attendance')
@Controller('attendance')
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
  getAllAttendance() {
    return this.attendanceService.getAll({});
  }

}
