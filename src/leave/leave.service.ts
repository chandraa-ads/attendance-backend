import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class LeaveService {
  constructor(private readonly supabase: SupabaseService) {}

  async applyLeave(userId: string, leaveDate: string, reason: string) {
    if (!userId || !leaveDate) throw new BadRequestException('userId and leaveDate required');
    const supa = this.supabase.getClient();
    const { data, error } = await supa.from('leaves').insert([{ user_id: userId, leave_date: leaveDate, reason, status: 'pending' }]).select().single();
    if (error) throw error;
    return data;
  }

  async approveLeave(leaveId: string, status: 'approved' | 'rejected') {
    const supa = this.supabase.getClient();
    const { data, error } = await supa.from('leaves').update({ status }).eq('id', leaveId).select().single();
    if (error) throw error;
    return data;
  }

  async myLeaves(userId: string) {
    const supa = this.supabase.getClient();
    const { data, error } = await supa.from('leaves').select('*').eq('user_id', userId).order('leave_date', { ascending: false });
    if (error) throw error;
    return data;
  }

  async allLeaves(from?: string, to?: string, status?: string) {
    const supa = this.supabase.getClient();
    let q = supa.from('leaves').select('*, users(*)');
    if (from) q = q.gte('leave_date', from);
    if (to) q = q.lte('leave_date', to);
    if (status) q = q.eq('status', status);
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }
}
