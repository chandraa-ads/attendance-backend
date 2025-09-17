import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { UserDashboardQueryDto, AdminDashboardQueryDto } from './dto/dashboard.dto';

@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('user')
  @ApiOperation({ summary: 'Get user dashboard summary' })
  @ApiResponse({ status: 200, description: 'User dashboard retrieved' })
  user(@Query() query: UserDashboardQueryDto) {
    return this.dashboardService.getUserDashboard(query.userId);
  }

  @Get('admin')
  @ApiOperation({ summary: 'Get admin dashboard summary (with filters)' })
  @ApiResponse({ status: 200, description: 'Admin dashboard retrieved' })
  admin(@Query() query: AdminDashboardQueryDto) {
    return this.dashboardService.getAdminDashboard(query);
  }
}
