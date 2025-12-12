import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { ManualAttendanceDto, BulkActionDto } from './dto/attendance.dto';

@Injectable()
export class AttendanceService {
  constructor(private readonly supabase: SupabaseService) { }

  // Helper to get today's date in YYYY-MM-DD format
  private todayDate(): string {
    return new Date().toISOString().slice(0, 10);
  }

  // Convert Date or string to IST formatted string
  private toIST(date: Date | string): string | null {
    try {
      if (!date) return null;
      const d = new Date(date);
      if (isNaN(d.getTime())) return null;
      return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    } catch {
      return null;
    }
  }

  // Format duration between two dates as HH:mm:ss
  private formatDuration(start: Date | string, end: Date | string): string | null {
    try {
      if (!start || !end) return null;
      
      const startTime = new Date(start).getTime();
      const endTime = new Date(end).getTime();
      
      if (isNaN(startTime) || isNaN(endTime)) return null;
      
      const totalSeconds = Math.floor((endTime - startTime) / 1000);
      if (totalSeconds < 0) return null;

      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    } catch {
      return null;
    }
  }

  // Parse time string (HH:mm) to Date object for specific date
  private parseTimeToDate(dateStr: string, timeStr: string): Date | null {
    if (!timeStr || !dateStr) return null;
    
    try {
      const [hours, minutes] = timeStr.split(':').map(Number);
      if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || isNaN(hours) || isNaN(minutes)) {
        throw new BadRequestException('Invalid time format. Use HH:mm (24-hour format)');
      }
      
      return new Date(`${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00Z`);
    } catch {
      throw new BadRequestException('Invalid time format. Use HH:mm (24-hour format)');
    }
  }

  // Get status for a record
  private getStatus(record: any): string {
    if (record.is_absent) return 'Absent';
    if (record.check_in && !record.check_out) return 'Checked In';
    if (record.check_in && record.check_out) return 'Checked Out';
    return 'Not Checked In';
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
        console.error('Error checking existing attendance:', exErr);
        throw new InternalServerErrorException('Error checking attendance');
      }

      if (existing) {
        // If already marked as absent, update to present
        if (existing.is_absent) {
          const { data: updated, error: updateErr } = await supa
            .from('attendance')
            .update({
              check_in: new Date(),
              is_absent: false,
              absence_reason: null,
              check_out: null,
              total_time_minutes: null,
              manual_entry: false
            })
            .eq('id', existing.id)
            .select()
            .single();

          if (updateErr) throw updateErr;

          return {
            message: 'Check-in successful (changed from absent)',
            data: {
              ...updated,
              check_in_ist: this.toIST(updated.check_in),
              check_out_ist: null,
              total_time_formatted: null,
              status: 'Checked In'
            }
          };
        }

        // Already checked in today
        return {
          message: 'Already checked in today',
          data: {
            ...existing,
            check_in_ist: this.toIST(existing.check_in),
            check_out_ist: this.toIST(existing.check_out),
            total_time_formatted: existing.check_in && existing.check_out 
              ? this.formatDuration(existing.check_in, existing.check_out) 
              : null,
            status: this.getStatus(existing)
          }
        };
      }

      // Create new check-in record
      const { data, error } = await supa
        .from('attendance')
        .insert([{ 
          user_id: userId, 
          date: today, 
          check_in: new Date(),
          is_absent: false,
          manual_entry: false
        }])
        .select()
        .single();

      if (error) throw error;

      return {
        message: 'Check-in successful',
        data: {
          ...data,
          check_in_ist: this.toIST(data.check_in),
          check_out_ist: null,
          total_time_formatted: null,
          status: 'Checked In'
        }
      };
    } catch (err) {
      console.error('Check-in error:', err);
      if (err instanceof BadRequestException) throw err;
      throw new InternalServerErrorException('Failed to check in');
    }
  }

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

      if (rErr) {
        if (rErr.code === 'PGRST116') {
          throw new BadRequestException('No check-in found for today');
        }
        throw rErr;
      }

      if (!row) {
        throw new BadRequestException('No attendance record found for today');
      }

      if (row.is_absent) {
        throw new BadRequestException('Cannot check out - marked as absent today');
      }

      if (!row.check_in) {
        throw new BadRequestException('No check-in found for today');
      }

      if (row.check_out) {
        return {
          message: 'Already checked out today',
          data: {
            ...row,
            check_in_ist: this.toIST(row.check_in),
            check_out_ist: this.toIST(row.check_out),
            total_time_formatted: this.formatDuration(row.check_in, row.check_out),
            status: 'Checked Out'
          }
        };
      }

      const checkInTime = new Date(row.check_in).getTime();
      const checkOutTime = Date.now();
      
      if (checkOutTime < checkInTime) {
        throw new BadRequestException('Check-out time cannot be before check-in time');
      }

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
        message: 'Check-out successful',
        data: {
          ...data,
          check_in_ist: this.toIST(data.check_in),
          check_out_ist: this.toIST(data.check_out),
          total_time_formatted: totalTimeFormatted,
          status: 'Checked Out'
        }
      };
    } catch (err) {
      console.error('Check-out error:', err);
      if (err instanceof BadRequestException) throw err;
      throw new InternalServerErrorException('Failed to check out');
    }
  }

  async getMyAttendance(userId: string, from?: string, to?: string) {
    if (!userId) throw new BadRequestException('userId required');

    try {
      const supa = this.supabase.getAdminClient();

      let query = supa
        .from('attendance')
        .select('*')
        .eq('user_id', userId);

      if (from) {
        const fromDate = new Date(from);
        if (isNaN(fromDate.getTime())) {
          throw new BadRequestException('Invalid from date format');
        }
        query = query.gte('date', from);
      }
      
      if (to) {
        const toDate = new Date(to);
        if (isNaN(toDate.getTime())) {
          throw new BadRequestException('Invalid to date format');
        }
        query = query.lte('date', to);
      }

      const { data, error } = await query.order('date', { ascending: false });

      if (error) {
        console.error('Error fetching attendance:', error);
        throw new InternalServerErrorException('Failed to fetch attendance');
      }

      return data.map((record) => ({
        ...record,
        check_in_ist: this.toIST(record.check_in),
        check_out_ist: this.toIST(record.check_out),
        total_time_formatted: record.check_in && record.check_out 
          ? this.formatDuration(record.check_in, record.check_out) 
          : (record.is_absent ? '00:00:00' : null),
        status: this.getStatus(record),
        manual_entry: record.manual_entry || false
      }));

    } catch (err) {
      console.error('getMyAttendance error:', err);
      if (err instanceof BadRequestException) throw err;
      throw new InternalServerErrorException('Failed to fetch attendance');
    }
  }

  async getAll(filters: {
    date?: string;
    name?: string;
    employeeId?: string;
    checkInFrom?: string;
    checkOutTo?: string;
    status?: string;
  }) {
    try {
      const supa = this.supabase.getAdminClient();

      let query = supa
        .from('attendance')
        .select('*, users!inner(id, name, email, employee_id, designation, profile_url, role)');

      if (filters.date) {
        const date = new Date(filters.date);
        if (isNaN(date.getTime())) {
          throw new BadRequestException('Invalid date format');
        }
        query = query.eq('date', filters.date);
      }
      
      if (filters.name) {
        query = query.ilike('users.name', `%${filters.name}%`);
      }
      
      if (filters.employeeId) {
        query = query.ilike('users.employee_id', `%${filters.employeeId}%`);
      }
      
      if (filters.checkInFrom) {
        const checkInDate = filters.date || this.todayDate();
        query = query.gte('check_in', `${checkInDate}T${filters.checkInFrom}:00Z`);
      }
      
      if (filters.checkOutTo) {
        const checkOutDate = filters.date || this.todayDate();
        query = query.lte('check_out', `${checkOutDate}T${filters.checkOutTo}:00Z`);
      }

      const { data, error } = await query.order('date', { ascending: false });

      if (error) {
        console.error('Error fetching all attendance:', error);
        throw new InternalServerErrorException('Failed to fetch attendance records');
      }

      // Apply status filter if provided
      let filteredData = data;
      if (filters.status && filters.status.trim() !== '') {
        filteredData = data.filter(record => {
          const status = this.getStatus(record);
          return status.toLowerCase().replace(' ', '-') === filters.status!.toLowerCase();
        });
      }

      return filteredData.map((record) => ({
        ...record,
        check_in_ist: this.toIST(record.check_in),
        check_out_ist: this.toIST(record.check_out),
        total_time_formatted: record.check_in && record.check_out 
          ? this.formatDuration(record.check_in, record.check_out) 
          : (record.is_absent ? '00:00:00' : null),
        status: this.getStatus(record),
        manual_entry: record.manual_entry || false,
        user_info: {
          id: record.users?.id,
          name: record.users?.name,
          email: record.users?.email,
          employee_id: record.users?.employee_id,
          designation: record.users?.designation,
          profile_url: record.users?.profile_url,
          role: record.users?.role
        }
      }));
    } catch (err) {
      console.error('getAll attendance error:', err);
      if (err instanceof BadRequestException) throw err;
      throw new InternalServerErrorException('Failed to fetch attendance records');
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
        .select('*, users!inner(id, name, employee_id, designation)')
        .order('date', { ascending: false });

      if (error) {
        console.error('Error fetching attendance by employee ID:', error);
        throw new InternalServerErrorException('Failed to fetch data');
      }

      const filtered = data.filter(
        (record) => record.users?.employee_id?.toString() === employeeId.toString(),
      );

      return filtered.map((record) => ({
        ...record,
        check_in_ist: this.toIST(record.check_in),
        check_out_ist: this.toIST(record.check_out),
        total_time_formatted: record.check_in && record.check_out 
          ? this.formatDuration(record.check_in, record.check_out) 
          : (record.is_absent ? '00:00:00' : null),
        status: this.getStatus(record),
        user_info: {
          name: record.users?.name,
          employee_id: record.users?.employee_id,
          designation: record.users?.designation
        }
      }));
    } catch (err) {
      console.error('getAttendanceByEmployeeId error:', err);
      if (err instanceof BadRequestException) throw err;
      throw new InternalServerErrorException('Failed to fetch attendance by employee ID');
    }
  }

  async manualAttendance(dto: ManualAttendanceDto) {
    const { userId, date, checkIn, checkOut, isAbsent = false, absenceReason } = dto;

    if (!userId || !date) {
      throw new BadRequestException('userId and date are required');
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      throw new BadRequestException('Date must be in YYYY-MM-DD format');
    }

    // Check if date is not in the future
    const today = this.todayDate();
    if (date > today) {
      throw new BadRequestException('Cannot mark attendance for future dates');
    }

    try {
      const supa = this.supabase.getAdminClient();

      // Verify user exists
      const { data: userData, error: userErr } = await supa
        .from('users')
        .select('id, name, employee_id, designation')
        .eq('id', userId)
        .single();

      if (userErr || !userData) {
        throw new BadRequestException('User not found');
      }

      // Check if attendance already exists for this user on this date
      const { data: existing, error: exErr } = await supa
        .from('attendance')
        .select('*')
        .eq('user_id', userId)
        .eq('date', date)
        .single();

      if (exErr && exErr.code !== 'PGRST116') {
        console.error('Error checking existing record:', exErr);
        throw new InternalServerErrorException('Error checking existing attendance');
      }

      let checkInDateTime: Date | null = null;
      let checkOutDateTime: Date | null = null;
      let totalMinutes = 0;
      let totalTimeFormatted: string | null = null;

      if (isAbsent) {
        // Validate that check-in/out are not provided when marking as absent
        if (checkIn || checkOut) {
          throw new BadRequestException('Cannot provide check-in/out times when marking as absent');
        }

        if (!absenceReason || absenceReason.trim() === '') {
          throw new BadRequestException('Absence reason is required when marking as absent');
        }

        // Mark as absent - create/update record with null check-in/out
        const attendanceData = {
          user_id: userId,
          date,
          check_in: null,
          check_out: null,
          is_absent: true,
          absence_reason: absenceReason.trim(),
          total_time_minutes: 0,
          manual_entry: true,
          updated_at: new Date()
        };

        const { data, error } = await supa
          .from('attendance')
          .upsert([attendanceData], { 
            onConflict: 'user_id,date',
            ignoreDuplicates: false 
          })
          .select()
          .single();

        if (error) {
          console.error('Error marking as absent:', error);
          throw new InternalServerErrorException('Failed to mark as absent');
        }

        return {
          message: 'User marked as absent',
          data: {
            ...data,
            check_in_ist: null,
            check_out_ist: null,
            total_time_formatted: '00:00:00',
            status: 'Absent',
            user_info: {
              name: userData.name,
              employee_id: userData.employee_id,
              designation: userData.designation
            }
          }
        };
      } else {
        // Mark as present with optional check-in/out times
        if (checkIn) {
          checkInDateTime = this.parseTimeToDate(date, checkIn);
        }

        if (checkOut) {
          checkOutDateTime = this.parseTimeToDate(date, checkOut);
        }

        // If both check-in and check-out provided, validate and calculate duration
        if (checkInDateTime && checkOutDateTime) {
          if (checkOutDateTime <= checkInDateTime) {
            throw new BadRequestException('Check-out time must be after check-in time');
          }
          totalMinutes = Number(((checkOutDateTime.getTime() - checkInDateTime.getTime()) / (1000 * 60)).toFixed(2));
          totalTimeFormatted = this.formatDuration(checkInDateTime, checkOutDateTime);
        }

        const attendanceData: any = {
          user_id: userId,
          date,
          check_in: checkInDateTime || (existing?.check_in || null),
          check_out: checkOutDateTime || (existing?.check_out || null),
          is_absent: false,
          absence_reason: null,
          manual_entry: true,
          updated_at: new Date()
        };

        // Only update total time if both times are set or if we're updating an existing record
        if (checkInDateTime && checkOutDateTime) {
          attendanceData.total_time_minutes = totalMinutes;
        } else if (existing?.total_time_minutes) {
          attendanceData.total_time_minutes = existing.total_time_minutes;
        } else {
          attendanceData.total_time_minutes = null;
        }

        const { data, error } = await supa
          .from('attendance')
          .upsert([attendanceData], { 
            onConflict: 'user_id,date',
            ignoreDuplicates: false 
          })
          .select()
          .single();

        if (error) {
          console.error('Error updating attendance:', error);
          throw new InternalServerErrorException('Failed to update attendance');
        }

        const responseData = {
          ...data,
          check_in_ist: this.toIST(data.check_in),
          check_out_ist: this.toIST(data.check_out),
          total_time_formatted: totalTimeFormatted || 
            (data.check_in && data.check_out ? this.formatDuration(data.check_in, data.check_out) : null),
          status: data.check_in && !data.check_out ? 'Checked In' :
                  data.check_in && data.check_out ? 'Checked Out' : 'Not Checked In',
          user_info: {
            name: userData.name,
            employee_id: userData.employee_id,
            designation: userData.designation
          }
        };

        return {
          message: 'Manual attendance recorded successfully',
          data: responseData
        };
      }
    } catch (err) {
      console.error('Manual attendance error:', err);
      if (err instanceof BadRequestException) {
        throw err;
      }
      throw new InternalServerErrorException('Failed to record manual attendance');
    }
  }

  // ✅ Get attendance summary for a user
  async getAttendanceSummary(userId: string, month?: string, year?: string) {
    if (!userId) throw new BadRequestException('userId required');

    try {
      const supa = this.supabase.getAdminClient();
      
      // Use current month/year if not provided
      const currentDate = new Date();
      const targetMonth = month || String(currentDate.getMonth() + 1).padStart(2, '0');
      const targetYear = year || String(currentDate.getFullYear());
      
      // Calculate first and last day of month
      const startDate = `${targetYear}-${targetMonth}-01`;
      const endDate = new Date(parseInt(targetYear), parseInt(targetMonth), 0)
        .toISOString().slice(0, 10);

      const { data, error } = await supa
        .from('attendance')
        .select('*')
        .eq('user_id', userId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });

      if (error) {
        console.error('Error fetching attendance summary:', error);
        throw new InternalServerErrorException('Failed to fetch attendance summary');
      }

      // Calculate statistics
      const presentDays = data.filter(d => !d.is_absent && d.check_in).length;
      const absentDays = data.filter(d => d.is_absent).length;
      const halfDays = data.filter(d => !d.is_absent && d.check_in && !d.check_out).length;
      
      // Calculate average work hours from complete days
      const completeDays = data.filter(d => d.check_in && d.check_out && !d.is_absent);
      let averageWorkHours = 0;
      if (completeDays.length > 0) {
        const totalMinutes = completeDays.reduce((sum, day) => sum + (day.total_time_minutes || 0), 0);
        averageWorkHours = Number((totalMinutes / completeDays.length / 60).toFixed(2));
      }

      const summary = {
        user_id: userId,
        month: targetMonth,
        year: targetYear,
        total_days: data.length,
        present_days: presentDays,
        absent_days: absentDays,
        half_days: halfDays,
        average_work_hours: averageWorkHours,
        records: data.map(record => ({
          date: record.date,
          check_in: this.toIST(record.check_in),
          check_out: this.toIST(record.check_out),
          total_time: record.check_in && record.check_out 
            ? this.formatDuration(record.check_in, record.check_out) 
            : null,
          status: record.is_absent ? 'Absent' : 
                  (record.check_in && !record.check_out ? 'Half Day' :
                  (record.check_in && record.check_out ? 'Present' : 'Not Marked')),
          is_absent: record.is_absent,
          absence_reason: record.absence_reason,
          manual_entry: record.manual_entry || false
        }))
      };

      return summary;
    } catch (err) {
      console.error('getAttendanceSummary error:', err);
      if (err instanceof BadRequestException) throw err;
      throw new InternalServerErrorException('Failed to fetch attendance summary');
    }
  }

  // ✅ Bulk attendance update for multiple users
  async bulkAttendanceUpdate(records: Array<{
    userId: string;
    date: string;
    isAbsent?: boolean;
    checkIn?: string;
    checkOut?: string;
    absenceReason?: string;
  }>) {
    if (!records || !Array.isArray(records) || records.length === 0) {
      throw new BadRequestException('Records array is required');
    }

    if (records.length > 100) {
      throw new BadRequestException('Cannot process more than 100 records at once');
    }

    try {
      const supa = this.supabase.getAdminClient();
      const results: Array<any> = [];
      const errors: Array<any> = [];

      // Process records in parallel with limit
      const batchSize = 10;
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const batchPromises = batch.map(async (record) => {
          try {
            const dto: ManualAttendanceDto = {
              userId: record.userId,
              date: record.date,
              isAbsent: record.isAbsent || false,
              checkIn: record.checkIn,
              checkOut: record.checkOut,
              absenceReason: record.absenceReason
            };

            const result = await this.manualAttendance(dto);
            return {
              userId: record.userId,
              date: record.date,
              success: true,
              data: result
            };
          } catch (err: any) {
            return {
              userId: record.userId,
              date: record.date,
              success: false,
              error: err.message || 'Unknown error'
            };
          }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
      }

      // Separate successes and errors
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      return {
        total: records.length,
        successful: successful.length,
        failed: failed.length,
        results: successful,
        errors: failed.length > 0 ? failed : undefined
      };
    } catch (err: any) {
      console.error('Bulk attendance update error:', err);
      throw new InternalServerErrorException('Failed to process bulk attendance update');
    }
  }

  // ✅ Process bulk action (mark multiple users as absent/present)
  async processBulkAction(dto: BulkActionDto) {
    const { action, date, userIds, reason } = dto;

    if (!action || !date || !userIds || userIds.length === 0) {
      throw new BadRequestException('action, date, and userIds are required');
    }

    if (action !== 'absent' && action !== 'present') {
      throw new BadRequestException('Action must be either "absent" or "present"');
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      throw new BadRequestException('Date must be in YYYY-MM-DD format');
    }

    // Validate not future date
    const today = this.todayDate();
    if (date > today) {
      throw new BadRequestException('Cannot mark attendance for future dates');
    }

    if (action === 'absent' && (!reason || reason.trim() === '')) {
      throw new BadRequestException('Reason is required when marking as absent');
    }

    try {
      const supa = this.supabase.getAdminClient();
      const results: Array<any> = [];
      const errors: Array<any> = [];

      // Process each user
      for (const userId of userIds) {
        try {
          let attendanceData: any;
          
          if (action === 'absent') {
            attendanceData = {
              user_id: userId,
              date,
              check_in: null,
              check_out: null,
              is_absent: true,
              absence_reason: reason!.trim(),
              total_time_minutes: 0,
              manual_entry: true,
              updated_at: new Date()
            };
          } else {
            // For present, set default working hours
            const checkInTime = this.parseTimeToDate(date, '09:00');
            const checkOutTime = this.parseTimeToDate(date, '18:00');
            
            attendanceData = {
              user_id: userId,
              date,
              check_in: checkInTime,
              check_out: checkOutTime,
              is_absent: false,
              absence_reason: null,
              total_time_minutes: checkInTime && checkOutTime ? 540 : null, // 9 hours in minutes
              manual_entry: true,
              updated_at: new Date()
            };
          }

          const { data, error } = await supa
            .from('attendance')
            .upsert([attendanceData], { 
              onConflict: 'user_id,date',
              ignoreDuplicates: false 
            })
            .select()
            .single();

          if (error) {
            errors.push({
              userId,
              error: error.message
            });
          } else {
            results.push({
              userId,
              success: true,
              data: {
                ...data,
                check_in_ist: this.toIST(data.check_in),
                check_out_ist: this.toIST(data.check_out),
                status: action === 'absent' ? 'Absent' : 'Present'
              }
            });
          }
        } catch (err: any) {
          errors.push({
            userId,
            error: err.message || 'Unknown error'
          });
        }
      }

      return {
        action,
        date,
        total: userIds.length,
        successful: results.length,
        failed: errors.length,
        results,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (err: any) {
      console.error('Bulk action error:', err);
      if (err instanceof BadRequestException) throw err;
      throw new InternalServerErrorException('Failed to process bulk action');
    }
  }

  // ✅ Get dashboard statistics
  async getDashboardStats(date?: string) {
    try {
      const supa = this.supabase.getAdminClient();
      const targetDate = date || this.todayDate();

      // Get total users count
      const { count: totalUsers, error: usersError } = await supa
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'user');

      if (usersError) {
        console.error('Error fetching users count:', usersError);
        throw new InternalServerErrorException('Failed to fetch users count');
      }

      // Get today's attendance
      const { data: attendanceData, error: attendanceError } = await supa
        .from('attendance')
        .select('*, users!inner(role)')
        .eq('date', targetDate)
        .eq('users.role', 'user');

      if (attendanceError) {
        console.error('Error fetching attendance:', attendanceError);
        throw new InternalServerErrorException('Failed to fetch attendance data');
      }

      // Calculate statistics
      const presentToday = attendanceData.filter(a => !a.is_absent && a.check_in).length;
      const absentToday = attendanceData.filter(a => a.is_absent).length;
      const checkedInToday = attendanceData.filter(a => a.check_in && !a.check_out).length;
      const checkedOutToday = attendanceData.filter(a => a.check_in && a.check_out).length;

      return {
        date: targetDate,
        total_users: totalUsers || 0,
        today_attendance: attendanceData.length,
        present_today: presentToday,
        absent_today: absentToday,
        checked_in_today: checkedInToday,
        checked_out_today: checkedOutToday,
        pending_today: (totalUsers || 0) - attendanceData.length
      };
    } catch (err) {
      console.error('getDashboardStats error:', err);
      if (err instanceof BadRequestException) throw err;
      throw new InternalServerErrorException('Failed to fetch dashboard statistics');
    }
  }
}