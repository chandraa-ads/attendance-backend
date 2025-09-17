import { Module } from '@nestjs/common';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';
import { SupabaseService } from '../supabase/supabase.service';

@Module({
  controllers: [LeaveController],
  providers: [LeaveService, SupabaseService],
})
export class LeaveModule {}
