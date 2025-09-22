import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class AttendanceService {
  constructor(private readonly supabase: SupabaseService) {}

  // Helper to get today's date in YYYY-MM-DD format
  private todayDate(): string {
    return new Date().toISOString().slice(0, 10);
  }

  // Convert Date or string to IST formatted string
  private toIST(date: Date | string): string {
    const d = new Date(date);
    return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  }

  // Format duration between two dates as HH:mm:ss
  private formatDuration(start: Date | string, end: Date | string): string {
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();
    const totalSeconds = Math.floor((endTime - startTime) / 1000);

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
      seconds,
    ).padStart(2, '0')}`;
  }

  async checkIn(userId: string) {
    if (!userId) throw new BadRequestException('userId required');

    try {
      const supa = this.supabase.getAdminClient();
      const today = this.todayDate();

      // Check if user already checked in today
      const { data: existing, error: exErr } = await supa
        .from('attendance')
        .select('*')
        .eq('user_id', userId)
        .eq('date', today)
        .single();

      if (exErr && exErr.code !== 'PGRST116') {
        throw exErr;
      }

      if (existing) {
        return {
          ...existing,
          check_in_ist: this.toIST(existing.check_in),
          check_out_ist: existing.check_out ? this.toIST(existing.check_out) : null,
        };
      }

      const { data, error } = await supa
        .from('attendance')
        .insert([{ user_id: userId, date: today, check_in: new Date() }])
        .select()
        .single();

      if (error) throw error;

      return {
        ...data,
        check_in_ist: this.toIST(data.check_in),
        check_out_ist: null,
      };
    } catch (err) {
      console.error('Check-in error:', err);
      throw err;
    }
  }

  // ✅ UPDATED checkOut method with HH:mm:ss formatting
  async checkOut(userId: string) {
    if (!userId) throw new BadRequestException('userId required');

    try {
      const supa = this.supabase.getAdminClient();
      const today = this.todayDate();

      // Get today's attendance record
      const { data: row, error: rErr } = await supa
        .from('attendance')
        .select('*')
        .eq('user_id', userId)
        .eq('date', today)
        .single();

      if (rErr || !row) {
        throw new BadRequestException('No check-in found for today');
      }

      if (row.check_out) {
        return {
          ...row,
          check_in_ist: this.toIST(row.check_in),
          check_out_ist: this.toIST(row.check_out),
          total_time_formatted: this.formatDuration(row.check_in, row.check_out),
        };
      }

      const checkInTime = new Date(row.check_in).getTime();
      const checkOutTime = Date.now();
      const diffMs = checkOutTime - checkInTime;

      const totalMinutes = Number((diffMs / (1000 * 60)).toFixed(2));
      const totalTimeFormatted = this.formatDuration(row.check_in, new Date(checkOutTime));

      const { data, error } = await supa
        .from('attendance')
        .update({
          check_out: new Date(checkOutTime),
          total_time_minutes: totalMinutes,
        })
        .eq('id', row.id)
        .select()
        .single();

      if (error) throw error;

      return {
        ...data,
        check_in_ist: this.toIST(data.check_in),
        check_out_ist: this.toIST(data.check_out),
        total_time_formatted: totalTimeFormatted,
      };
    } catch (err) {
      console.error('Check-out error:', err);
      throw err;
    }
  }

  async getMyAttendance(userId: string, from?: string, to?: string) {
    if (!userId) throw new BadRequestException('userId required');

    try {
      const supa = this.supabase.getAdminClient();

      let query = supa
        .from('attendance')
        .select('date, check_in, check_out, total_time_minutes')
        .eq('user_id', userId);

      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);

      const { data, error } = await query.order('date', { ascending: false });

      if (error) {
        console.error('Error fetching attendance:', error);
        throw error;
      }

      return data;
    } catch (err) {
      console.error('getMyAttendance error:', err);
      throw err;
    }
  }

  async getAll(filters: {
    date?: string;
    name?: string;
    employeeId?: string;
    checkInFrom?: string;
    checkOutTo?: string;
  }) {
    try {
      const supa = this.supabase.getAdminClient();

      let query = supa.from('attendance').select('*, users(*)');

      if (filters.date) query = query.eq('date', filters.date);
      if (filters.name) query = query.ilike('users.name', `%${filters.name}%`);
      if (filters.employeeId) query = query.ilike('users.employee_id', `%${filters.employeeId}%`);
      if (filters.checkInFrom)
        query = query.gte('check_in', `${filters.date ?? ''}T${filters.checkInFrom}:00Z`);
      if (filters.checkOutTo)
        query = query.lte('check_out', `${filters.date ?? ''}T${filters.checkOutTo}:00Z`);

      const { data, error } = await query.order('date', { ascending: false });

      if (error) throw error;

      return data;
    } catch (err) {
      console.error('getAll attendance error:', err);
      throw err;
    }
  }

  async getAttendanceByEmployeeId(employeeId: string) {
    if (!employeeId) {
      throw new BadRequestException('Employee ID is required');
    }

    try {
      const supa = this.supabase.getAdminClient();

      const { data, error } = await supa
        .from('attendance')
        .select('*, users(*)')
        .order('date', { ascending: false });

      if (error) {
        throw new BadRequestException('Failed to fetch data: ' + error.message);
      }

      const filtered = data.filter(
        (record) => record.users?.employee_id?.toString() === employeeId.toString(),
      );

      return filtered;
    } catch (err) {
      console.error('getAttendanceByEmployeeId error:', err);
      throw err;
    }
  }
}
