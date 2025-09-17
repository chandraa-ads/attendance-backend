import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class DashboardService {
  constructor(private readonly supabase: SupabaseService) {}

  // User dashboard
  async getUserDashboard(userId: string) {
    const supa = this.supabase.getClient();
    const [{ data: user }, { data: att }, { data: leaves }] = await Promise.all([
      supa.from('users').select('*').eq('id', userId).single(),
      supa.from('attendance').select('*').eq('user_id', userId),
      supa.from('leaves').select('*').eq('user_id', userId)
    ]);

    const present = (att || []).filter(r => r.check_in && r.check_out).length;
    const totalMinutes = (att || []).reduce((s, r) => s + (Number(r.total_time_minutes) || 0), 0);
    const avgHours = present ? (totalMinutes / present / 60).toFixed(2) : '0';
    const absent = (att || []).filter(r => !r.check_in && !r.check_out).length;

    return {
      profile: user || null,
      summary: {
        present,
        absent,
        avgHours,
        totalMinutes,
        leaves: leaves || []
      }
    };
  }

  // Admin dashboard: filterable
  async getAdminDashboard(filters: { date?: string; role?: string; status?: string }) {
    const supa = this.supabase.getClient();
    let usersQ = supa.from('users').select('*');
    if (filters.role) usersQ = usersQ.eq('role', filters.role);
    const { data: users } = await usersQ;

    let attQ = supa.from('attendance').select('*');
    if (filters.date) attQ = attQ.eq('date', filters.date);
    const { data: attendance } = await attQ;

    const summary = (users || []).map(u => {
      const userAtt = (attendance || []).filter(a => a.user_id === u.id);
      const present = userAtt.filter(x => x.check_in && x.check_out).length;
      const absent = userAtt.filter(x => !x.check_in && !x.check_out).length;
      const totalMinutes = userAtt.reduce((s, r) => s + (Number(r.total_time_minutes) || 0), 0);
      const avgHours = present ? (totalMinutes / present / 60).toFixed(2) : '0';
      return {
        user: u,
        present,
        absent,
        avgHours,
        totalMinutes
      };
    });

    return { filters, summary };
  }
}
