import { Controller, Post, Body, Patch, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { LeaveService } from './leave.service';
import { ApplyLeaveDto, ApproveLeaveDto, MyLeavesQueryDto, AllLeavesQueryDto } from './dto/leave.dto';

@ApiTags('Leave')
@Controller('leave')
export class LeaveController {
  constructor(private readonly leaveService: LeaveService) {}

  @Post('apply')
  @ApiOperation({ summary: 'Apply for leave' })
  @ApiResponse({ status: 201, description: 'Leave applied successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  apply(@Body() body: ApplyLeaveDto) {
    return this.leaveService.applyLeave(body.userId, body.leaveDate, body.reason);
  }

  @Patch('approve')
  @ApiOperation({ summary: 'Approve or reject a leave (Admin only)' })
  @ApiResponse({ status: 200, description: 'Leave updated successfully' })
  approve(@Body() body: ApproveLeaveDto) {
    return this.leaveService.approveLeave(body.leaveId, body.status);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get my leaves' })
  @ApiResponse({ status: 200, description: 'User leave history retrieved' })
  my(@Query() query: MyLeavesQueryDto) {
    return this.leaveService.myLeaves(query.userId);
  }

  @Get('all')
  @ApiOperation({ summary: 'Get all leaves (Admin only)' })
  @ApiResponse({ status: 200, description: 'All leave records retrieved' })
  all(@Query() query: AllLeavesQueryDto) {
    return this.leaveService.allLeaves(query.from, query.to, query.status);
  }
}
