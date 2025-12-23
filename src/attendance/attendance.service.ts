import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  ManualAttendanceDto,
  BulkActionDto,
  UpdateAttendanceDto,
  HalfDayDto,
  PermissionTimeDto,
  GenerateReportDto
} from './dto/attendance.dto';
import PDFDocument from 'pdfkit';

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

      // Format in IST timezone directly
      return d.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
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

    // Create date string with explicit IST timezone (+05:30)
    const dateTimeStr = `${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+05:30`;
    
    // Parse as IST timezone
    return new Date(dateTimeStr);
  } catch {
    throw new BadRequestException('Invalid time format. Use HH:mm (24-hour format)');
  }
}

  // Get status for a record
  private getStatus(record: any): string {
    if (record.is_absent) return 'Absent';
    if (record.permission_time) return 'Permission';
    if (record.half_day_type) return `Half Day (${record.half_day_type})`;
    if (record.check_in && !record.check_out) return 'Checked In';
    if (record.check_in && record.check_out) return 'Present';
    return 'Not Checked In';
  }

  // ================= EXISTING METHODS =================

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
      const now = new Date();
      const utcTime = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
      // Create new check-in record
      const { data, error } = await supa
        .from('attendance')
        .insert([{
          user_id: userId,
          date: today,
          check_in: utcTime, // Store as UTC
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

      // Specify the exact relationship using users!attendance_user_id_fkey
      let query = supa
        .from('attendance')
        .select(`
          *,
          users!attendance_user_id_fkey (
            id, name, email, employee_id, designation, profile_url, role
          )
        `);

      if (filters.date) {
        const date = new Date(filters.date);
        if (isNaN(date.getTime())) {
          throw new BadRequestException('Invalid date format');
        }
        query = query.eq('date', filters.date);
      }

      if (filters.name) {
        query = query.ilike('users!attendance_user_id_fkey.name', `%${filters.name}%`);
      }

      if (filters.employeeId) {
        query = query.ilike('users!attendance_user_id_fkey.employee_id', `%${filters.employeeId}%`);
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
        .select(`
          *,
          users!attendance_user_id_fkey (
            id, name, employee_id, designation
          )
        `)
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

    console.log('=== MANUAL ATTENDANCE START ===');
    console.log('Input DTO:', JSON.stringify(dto, null, 2));

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
      console.log('Supabase client initialized');

      // Verify user exists
      console.log(`Looking up user: ${userId}`);
      const { data: userData, error: userErr } = await supa
        .from('users')
        .select('id, name, employee_id, designation')
        .eq('id', userId)
        .single();

      console.log('User lookup result:', { data: userData, error: userErr });

      if (userErr || !userData) {
        console.error('User not found error:', userErr);
        throw new BadRequestException('User not found');
      }

      console.log('User found:', userData);

      // Check if attendance already exists for this user on this date
      console.log(`Checking existing attendance for user ${userId} on date ${date}`);
      const { data: existing, error: exErr } = await supa
        .from('attendance')
        .select('*')
        .eq('user_id', userId)
        .eq('date', date)
        .single();

      console.log('Existing record check:', { existing, error: exErr });

      if (exErr && exErr.code !== 'PGRST116') {
        console.error('Error checking existing record:', exErr);
        throw new InternalServerErrorException('Error checking existing attendance');
      }

      let checkInDateTime: Date | null = null;
      let checkOutDateTime: Date | null = null;
      let totalMinutes = 0;
      let totalTimeFormatted: string | null = null;

      if (isAbsent) {
        console.log('Marking as ABSENT');

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
          updated_at: new Date().toISOString()
        };

        console.log('Absence attendance data:', attendanceData);

        // Use separate insert or update based on existing record
        let result;
        if (existing) {
          console.log('Updating existing absent record');
          // Update existing record
          const { data, error } = await supa
            .from('attendance')
            .update(attendanceData)
            .eq('id', existing.id)
            .select()
            .single();

          result = { data, error };
          console.log('Update result:', { data, error });
        } else {
          console.log('Inserting new absent record');
          // Insert new record
          const { data, error } = await supa
            .from('attendance')
            .insert([attendanceData])
            .select()
            .single();

          result = { data, error };
          console.log('Insert result:', { data, error });
        }

        if (result.error) {
          console.error('Error marking as absent:', result.error);
          console.error('Error details:', {
            code: result.error.code,
            message: result.error.message,
            details: result.error.details,
            hint: result.error.hint
          });
          throw new InternalServerErrorException('Failed to mark as absent: ' + result.error.message);
        }

        console.log('Absent marked successfully:', result.data);

        return {
          message: 'User marked as absent',
          data: {
            ...result.data,
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
        console.log('Marking as PRESENT');

        // Mark as present with optional check-in/out times
        if (checkIn) {
          console.log(`Parsing check-in time: ${checkIn} for date: ${date}`);
          checkInDateTime = this.parseTimeToDate(date, checkIn);
          console.log('Parsed check-in DateTime:', checkInDateTime);
        }

        if (checkOut) {
          console.log(`Parsing check-out time: ${checkOut} for date: ${date}`);
          checkOutDateTime = this.parseTimeToDate(date, checkOut);
          console.log('Parsed check-out DateTime:', checkOutDateTime);
        }

        // If both check-in and check-out provided, validate and calculate duration
        if (checkInDateTime && checkOutDateTime) {
          console.log('Validating check-in/check-out times');
          if (checkOutDateTime <= checkInDateTime) {
            throw new BadRequestException('Check-out time must be after check-in time');
          }
          totalMinutes = Number(((checkOutDateTime.getTime() - checkInDateTime.getTime()) / (1000 * 60)).toFixed(2));
          totalTimeFormatted = this.formatDuration(checkInDateTime, checkOutDateTime);
          console.log(`Calculated total minutes: ${totalMinutes}, formatted: ${totalTimeFormatted}`);
        }

        const attendanceData: any = {
          user_id: userId,
          date,
          check_in: checkInDateTime ? checkInDateTime.toISOString() : (existing?.check_in || null),
          check_out: checkOutDateTime ? checkOutDateTime.toISOString() : (existing?.check_out || null),
          is_absent: false,
          absence_reason: null,
          manual_entry: true,
          updated_at: new Date().toISOString()
        };

        // Only update total time if both times are set or if we're updating an existing record
        if (checkInDateTime && checkOutDateTime) {
          attendanceData.total_time_minutes = totalMinutes;
        } else if (existing?.total_time_minutes) {
          attendanceData.total_time_minutes = existing.total_time_minutes;
        } else {
          attendanceData.total_time_minutes = null;
        }

        console.log('Present attendance data:', JSON.stringify(attendanceData, null, 2));
        console.log('Existing record:', existing);
        console.log('Has existing record?', !!existing);

        // Use separate insert or update based on existing record
        let result;
        if (existing) {
          console.log('Updating existing present record with ID:', existing.id);
          // Update existing record
          const { data, error } = await supa
            .from('attendance')
            .update(attendanceData)
            .eq('id', existing.id)
            .select()
            .single();

          result = { data, error };
          console.log('Update result:', { data, error });
        } else {
          console.log('Inserting new present record');
          // Insert new record
          const { data, error } = await supa
            .from('attendance')
            .insert([attendanceData])
            .select()
            .single();

          result = { data, error };
          console.log('Insert result:', { data, error });
        }

        if (result.error) {
          console.error('Error updating attendance:', result.error);
          console.error('Error details:', {
            code: result.error.code,
            message: result.error.message,
            details: result.error.details,
            hint: result.error.hint
          });
          throw new InternalServerErrorException('Failed to update attendance: ' + result.error.message);
        }

        console.log('Attendance saved successfully:', result.data);

        const responseData = {
          ...result.data,
          check_in_ist: this.toIST(result.data.check_in),
          check_out_ist: this.toIST(result.data.check_out),
          total_time_formatted: totalTimeFormatted ||
            (result.data.check_in && result.data.check_out ? this.formatDuration(result.data.check_in, result.data.check_out) : null),
          status: result.data.check_in && !result.data.check_out ? 'Checked In' :
            result.data.check_in && result.data.check_out ? 'Checked Out' : 'Not Checked In',
          user_info: {
            name: userData.name,
            employee_id: userData.employee_id,
            designation: userData.designation
          }
        };

        console.log('=== MANUAL ATTENDANCE COMPLETE ===');
        console.log('Response data:', responseData);

        return {
          message: 'Manual attendance recorded successfully',
          data: responseData
        };
      }
    } catch (err) {
      console.error('=== MANUAL ATTENDANCE ERROR ===');
      console.error('Error:', err);
      console.error('Error stack:', err.stack);

      if (err instanceof BadRequestException) {
        throw err;
      }

      // Log additional error details
      if (err.code) {
        console.error('Error code:', err.code);
        console.error('Error message:', err.message);
        console.error('Error details:', err.details);
      }

      throw new InternalServerErrorException('Failed to record manual attendance: ' + (err.message || 'Unknown error'));
    }
  }

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

  async bulkAttendanceUpdate(records: Array<{
    userId: string;
    date: string;
    isAbsent?: boolean;
    checkIn?: string;
    checkOut?: string;
    absenceReason?: string;
  }>) {
    // THIS IS THROWING THE 400 ERROR:
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

  async processBulkAction(dto: BulkActionDto) {
    console.log('=== PROCESS BULK ACTION START ===');
    console.log('Bulk action DTO:', JSON.stringify(dto, null, 2));

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

      console.log(`Processing ${userIds.length} users for ${action} on ${date}`);

      // Process each user
      for (const userId of userIds) {
        try {
          console.log(`Processing user: ${userId}`);

          // First check if user exists
          const { data: userCheck, error: userCheckError } = await supa
            .from('users')
            .select('id, email, name')
            .eq('id', userId)
            .single();

          if (userCheckError || !userCheck) {
            console.error(`User ${userId} not found in database`);
            errors.push({
              userId,
              error: 'User not found in database'
            });
            continue;
          }

          console.log(`User ${userId} found: ${userCheck.name} (${userCheck.email})`);

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
              updated_at: new Date().toISOString()
            };
          } else {
            // For present, set default working hours
            const checkInTime = this.parseTimeToDate(date, '09:00');
            const checkOutTime = this.parseTimeToDate(date, '18:00');

            attendanceData = {
              user_id: userId,
              date,
              check_in: checkInTime ? checkInTime.toISOString() : null,
              check_out: checkOutTime ? checkOutTime.toISOString() : null,
              is_absent: false,
              absence_reason: null,
              total_time_minutes: checkInTime && checkOutTime ? 540 : null, // 9 hours in minutes
              manual_entry: true,
              updated_at: new Date().toISOString()
            };
          }

          console.log(`Attendance data for user ${userId}:`, attendanceData);

          // Check if record already exists
          const { data: existingRecord } = await supa
            .from('attendance')
            .select('id')
            .eq('user_id', userId)
            .eq('date', date)
            .single();

          let operationResult;
          if (existingRecord) {
            console.log(`Updating existing record for user ${userId}`);
            // Update existing
            operationResult = await supa
              .from('attendance')
              .update(attendanceData)
              .eq('id', existingRecord.id)
              .select()
              .single();
          } else {
            console.log(`Inserting new record for user ${userId}`);
            // Insert new
            operationResult = await supa
              .from('attendance')
              .insert([attendanceData])
              .select()
              .single();
          }

          console.log(`Operation result for user ${userId}:`, operationResult);

          if (operationResult.error) {
            console.error(`Error for user ${userId}:`, operationResult.error);
            errors.push({
              userId,
              error: operationResult.error.message,
              details: operationResult.error
            });
          } else {
            console.log(`Success for user ${userId}`);
            results.push({
              userId,
              success: true,
              data: {
                ...operationResult.data,
                check_in_ist: this.toIST(operationResult.data.check_in),
                check_out_ist: this.toIST(operationResult.data.check_out),
                status: action === 'absent' ? 'Absent' : 'Present'
              }
            });
          }
        } catch (err: any) {
          console.error(`Exception for user ${userId}:`, err);
          errors.push({
            userId,
            error: err.message || 'Unknown error',
            stack: err.stack
          });
        }
      }

      console.log('=== PROCESS BULK ACTION COMPLETE ===');
      console.log(`Results: ${results.length} successful, ${errors.length} failed`);

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
      console.error('=== PROCESS BULK ACTION ERROR ===');
      console.error('Error:', err);
      console.error('Stack:', err.stack);

      if (err instanceof BadRequestException) throw err;
      throw new InternalServerErrorException('Failed to process bulk action: ' + err.message);
    }
  }

  // ✅ NEW: Update existing attendance record
  async updateAttendanceRecord(id: string, dto: UpdateAttendanceDto) {
    console.log('=== UPDATE ATTENDANCE START ===');
    console.log('Update DTO:', JSON.stringify(dto, null, 2));

    try {
      const supa = this.supabase.getAdminClient();

      // First, get the existing record
      const { data: existingRecord, error: fetchError } = await supa
        .from('attendance')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError || !existingRecord) {
        throw new BadRequestException('Attendance record not found');
      }

      console.log('Existing record:', existingRecord);

      // Validate the update data
      if (dto.date && dto.date !== existingRecord.date) {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(dto.date)) {
          throw new BadRequestException('Date must be in YYYY-MM-DD format');
        }
      }

      // Prepare update data
      const updateData: any = {};

      if (dto.checkIn !== undefined) {
        if (dto.checkIn === null) {
          updateData.check_in = null;
        } else if (dto.checkIn) {
          const date = dto.date || existingRecord.date;
          updateData.check_in = this.parseTimeToDate(date, dto.checkIn)?.toISOString();
        }
      }

      if (dto.checkOut !== undefined) {
        if (dto.checkOut === null) {
          updateData.check_out = null;
        } else if (dto.checkOut) {
          const date = dto.date || existingRecord.date;
          updateData.check_out = this.parseTimeToDate(date, dto.checkOut)?.toISOString();
        }
      }

      if (dto.isAbsent !== undefined) {
        updateData.is_absent = dto.isAbsent;
        if (dto.isAbsent && dto.absenceReason) {
          updateData.absence_reason = dto.absenceReason;
        } else if (!dto.isAbsent) {
          updateData.absence_reason = null;
        }
      }

      if (dto.absenceReason !== undefined) {
        updateData.absence_reason = dto.absenceReason;
      }

      if (dto.halfDayType !== undefined) {
        if (dto.halfDayType === null) {
          updateData.half_day_type = null;
        } else if (['morning', 'afternoon'].includes(dto.halfDayType)) {
          updateData.half_day_type = dto.halfDayType;
        } else {
          throw new BadRequestException('Half day type must be either "morning" or "afternoon"');
        }
      }

      if (dto.permissionTime !== undefined) {
        updateData.permission_time = dto.permissionTime;
      }

      if (dto.permissionReason !== undefined) {
        updateData.permission_reason = dto.permissionReason;
      }

      if (dto.notes !== undefined) {
        updateData.notes = dto.notes;
      }

      // Calculate total time if both check-in and check-out are set
      if ((dto.checkIn !== undefined || dto.checkOut !== undefined) &&
        (updateData.check_in !== undefined || updateData.check_out !== undefined)) {

        const checkIn = updateData.check_in || existingRecord.check_in;
        const checkOut = updateData.check_out || existingRecord.check_out;

        if (checkIn && checkOut) {
          const checkInTime = new Date(checkIn).getTime();
          const checkOutTime = new Date(checkOut).getTime();

          if (checkOutTime <= checkInTime) {
            throw new BadRequestException('Check-out time must be after check-in time');
          }

          const diffMs = checkOutTime - checkInTime;
          updateData.total_time_minutes = Number((diffMs / (1000 * 60)).toFixed(2));
        } else {
          updateData.total_time_minutes = null;
        }
      }

      // Update the record
      const { data: updatedRecord, error: updateError } = await supa
        .from('attendance')
        .update({
          ...updateData,
          updated_at: new Date().toISOString(),
          manual_entry: true
        })
        .eq('id', id)
        .select(`
          *,
          users!attendance_user_id_fkey (
            id, name, email, employee_id, designation, department
          )
        `)
        .single();

      if (updateError) {
        console.error('Update error:', updateError);
        throw new InternalServerErrorException('Failed to update attendance record');
      }

      console.log('Updated record:', updatedRecord);

      const responseData = {
        ...updatedRecord,
        check_in_ist: this.toIST(updatedRecord.check_in),
        check_out_ist: this.toIST(updatedRecord.check_out),
        total_time_formatted: updatedRecord.check_in && updatedRecord.check_out
          ? this.formatDuration(updatedRecord.check_in, updatedRecord.check_out)
          : (updatedRecord.is_absent ? '00:00:00' : null),
        status: this.getStatus(updatedRecord),
        user_info: {
          name: updatedRecord.users?.name,
          employee_id: updatedRecord.users?.employee_id,
          designation: updatedRecord.users?.designation,
          department: updatedRecord.users?.department
        }
      };

      console.log('=== UPDATE ATTENDANCE COMPLETE ===');

      return {
        message: 'Attendance record updated successfully',
        data: responseData
      };
    } catch (err) {
      console.error('=== UPDATE ATTENDANCE ERROR ===');
      console.error('Error:', err);

      if (err instanceof BadRequestException) throw err;
      throw new InternalServerErrorException('Failed to update attendance record: ' + err.message);
    }
  }

  // ✅ NEW: Mark half day (morning/afternoon)
  async markHalfDay(dto: HalfDayDto) {
    console.log('=== MARK HALF DAY START ===');
    console.log('Half day DTO:', JSON.stringify(dto, null, 2));

    const { userId, date, halfDayType, checkIn, checkOut, reason } = dto;

    if (!userId || !date || !halfDayType) {
      throw new BadRequestException('userId, date, and halfDayType are required');
    }

    if (!['morning', 'afternoon'].includes(halfDayType)) {
      throw new BadRequestException('halfDayType must be either "morning" or "afternoon"');
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      throw new BadRequestException('Date must be in YYYY-MM-DD format');
    }

    try {
      const supa = this.supabase.getAdminClient();

      // Verify user exists
      const { data: userData, error: userErr } = await supa
        .from('users')
        .select('id, name, employee_id')
        .eq('id', userId)
        .single();

      if (userErr || !userData) {
        throw new BadRequestException('User not found');
      }

      // Define default times based on half day type
      let defaultCheckIn, defaultCheckOut;
      if (halfDayType === 'morning') {
        defaultCheckIn = '09:00';
        defaultCheckOut = '13:00'; // Half day ends at 1 PM
      } else {
        defaultCheckIn = '13:00'; // Afternoon starts at 1 PM
        defaultCheckOut = '18:00';
      }

      // Use provided times or defaults
      const checkInTime = checkIn || defaultCheckIn;
      const checkOutTime = checkOut || defaultCheckOut;

      // Parse times
      const checkInDateTime = this.parseTimeToDate(date, checkInTime);
      const checkOutDateTime = this.parseTimeToDate(date, checkOutTime);

      if (!checkInDateTime || !checkOutDateTime) {
        throw new BadRequestException('Invalid time format');
      }

      // Validate times
      if (checkOutDateTime <= checkInDateTime) {
        throw new BadRequestException('Check-out time must be after check-in time');
      }

      // Calculate total time (should be approximately 4 hours for half day)
      const totalMinutes = Number(((checkOutDateTime.getTime() - checkInDateTime.getTime()) / (1000 * 60)).toFixed(2));

      // Check if record exists
      const { data: existingRecord } = await supa
        .from('attendance')
        .select('id')
        .eq('user_id', userId)
        .eq('date', date)
        .single();

      const attendanceData = {
        user_id: userId,
        date,
        check_in: checkInDateTime.toISOString(),
        check_out: checkOutDateTime.toISOString(),
        total_time_minutes: totalMinutes,
        half_day_type: halfDayType,
        is_absent: false,
        absence_reason: null,
        manual_entry: true,
        notes: reason,
        updated_at: new Date().toISOString()
      };

      let result;
      if (existingRecord) {
        // Update existing record
        const { data, error } = await supa
          .from('attendance')
          .update(attendanceData)
          .eq('id', existingRecord.id)
          .select()
          .single();
        result = { data, error };
      } else {
        // Insert new record
        const { data, error } = await supa
          .from('attendance')
          .insert([attendanceData])
          .select()
          .single();
        result = { data, error };
      }

      if (result.error) {
        throw new InternalServerErrorException('Failed to mark half day: ' + result.error.message);
      }

      const responseData = {
        ...result.data,
        check_in_ist: this.toIST(result.data.check_in),
        check_out_ist: this.toIST(result.data.check_out),
        total_time_formatted: this.formatDuration(result.data.check_in, result.data.check_out),
        status: `Half Day (${halfDayType})`,
        user_info: {
          name: userData.name,
          employee_id: userData.employee_id
        }
      };

      console.log('=== MARK HALF DAY COMPLETE ===');

      return {
        message: `Half day (${halfDayType}) marked successfully`,
        data: responseData
      };
    } catch (err) {
      console.error('=== MARK HALF DAY ERROR ===');
      console.error('Error:', err);

      if (err instanceof BadRequestException) throw err;
      throw new InternalServerErrorException('Failed to mark half day: ' + err.message);
    }
  }

// ✅ NEW: Record permission time with IST timezone and time deduction
async recordPermissionTime(dto: PermissionTimeDto) {
  console.log('=== RECORD PERMISSION TIME START ===');
  console.log('Permission DTO:', JSON.stringify(dto, null, 2));

  const { userId, date, permissionFrom, permissionTo, reason } = dto;

  if (!userId || !date || !permissionFrom || !permissionTo || !reason) {
    throw new BadRequestException('All fields are required: userId, date, permissionFrom, permissionTo, reason');
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    throw new BadRequestException('Date must be in YYYY-MM-DD format');
  }

  try {
    const supa = this.supabase.getAdminClient();

    // Verify user exists
    const { data: userData, error: userErr } = await supa
      .from('users')
      .select('id, name, employee_id')
      .eq('id', userId)
      .single();

    if (userErr || !userData) {
      throw new BadRequestException('User not found');
    }

    // Parse permission times in IST timezone
    const fromTime = this.parseTimeToDateIST(date, permissionFrom);
    const toTime = this.parseTimeToDateIST(date, permissionTo);

    if (!fromTime || !toTime) {
      throw new BadRequestException('Invalid time format');
    }

    // Validate times
    if (toTime <= fromTime) {
      throw new BadRequestException('Permission end time must be after start time');
    }

    // Calculate permission duration in minutes
    const permissionMinutes = Number(((toTime.getTime() - fromTime.getTime()) / (1000 * 60)).toFixed(2));

    // Check if record exists
    const { data: existingRecord } = await supa
      .from('attendance')
      .select('*')
      .eq('user_id', userId)
      .eq('date', date)
      .single();

    // Format permission time for storage in IST format
    const permissionTimeIST = `${this.formatTimeIST(permissionFrom)}-${this.formatTimeIST(permissionTo)}`;

    const attendanceData: any = {
      user_id: userId,
      date,
      permission_time: permissionTimeIST,
      permission_reason: reason,
      permission_duration_minutes: permissionMinutes,
      manual_entry: true,
      updated_at: new Date().toISOString(),
      permission_from: fromTime.toISOString(), // Store actual datetime
      permission_to: toTime.toISOString(),     // Store actual datetime
    };

    // Initialize adjustedTotalMinutes as null
    let adjustedTotalMinutes: number | null = null;

    // If existing record has check-in/out, adjust total time by deducting permission time
    if (existingRecord?.check_in && existingRecord?.check_out) {
      // Keep original check-in/out
      attendanceData.check_in = existingRecord.check_in;
      attendanceData.check_out = existingRecord.check_out;
      attendanceData.is_absent = false;
      attendanceData.absence_reason = null;
      attendanceData.half_day_type = null;

      // Calculate original total time in minutes
      const originalCheckIn = new Date(existingRecord.check_in);
      const originalCheckOut = new Date(existingRecord.check_out);
      const originalTotalMinutes = Number(((originalCheckOut.getTime() - originalCheckIn.getTime()) / (1000 * 60)).toFixed(2));

      // Calculate overlap between permission time and work time
      const overlapStart = Math.max(originalCheckIn.getTime(), fromTime.getTime());
      const overlapEnd = Math.min(originalCheckOut.getTime(), toTime.getTime());

      let overlapMinutes = 0;
      if (overlapEnd > overlapStart) {
        overlapMinutes = Number(((overlapEnd - overlapStart) / (1000 * 60)).toFixed(2));
      }

      // Calculate adjusted total time (original - permission overlap)
      adjustedTotalMinutes = Math.max(0, originalTotalMinutes - overlapMinutes);
      attendanceData.total_time_minutes = adjustedTotalMinutes;
      
    } else if (existingRecord) {
      // Keep existing data if no check-in/check-out
      attendanceData.check_in = existingRecord.check_in;
      attendanceData.check_out = existingRecord.check_out;
      attendanceData.total_time_minutes = existingRecord.total_time_minutes;
      attendanceData.is_absent = existingRecord.is_absent;
      attendanceData.absence_reason = existingRecord.absence_reason;
      attendanceData.half_day_type = existingRecord.half_day_type;
    }

    let result;
    if (existingRecord) {
      // Update existing record
      const { data, error } = await supa
        .from('attendance')
        .update(attendanceData)
        .eq('id', existingRecord.id)
        .select()
        .single();
      result = { data, error };
    } else {
      // Insert new record
      const { data, error } = await supa
        .from('attendance')
        .insert([attendanceData])
        .select()
        .single();
      result = { data, error };
    }

    if (result.error) {
      throw new InternalServerErrorException('Failed to record permission time: ' + result.error.message);
    }

    // Format response
    const responseData = {
      ...result.data,
      check_in_ist: this.toIST(result.data.check_in),
      check_out_ist: this.toIST(result.data.check_out),
      total_time_formatted: result.data.check_in && result.data.check_out
        ? this.formatDuration(result.data.check_in, result.data.check_out)
        : null,
      status: 'Permission',
      user_info: {
        name: userData.name,
        employee_id: userData.employee_id
      },
      permission_details: {
        time: permissionTimeIST,
        duration_minutes: permissionMinutes,
        duration_formatted: this.formatMinutesToHHMM(permissionMinutes),
        adjusted_total_minutes: adjustedTotalMinutes,
        adjusted_total_formatted: adjustedTotalMinutes ? this.formatMinutesToHHMM(adjustedTotalMinutes) : null
      }
    };

    console.log('=== RECORD PERMISSION TIME COMPLETE ===');

    return {
      message: 'Permission time recorded successfully',
      data: responseData
    };
  } catch (err) {
    console.error('=== RECORD PERMISSION TIME ERROR ===');
    console.error('Error:', err);

    if (err instanceof BadRequestException) throw err;
    throw new InternalServerErrorException('Failed to record permission time: ' + err.message);
  }
}

// Helper method: Parse time to Date in IST timezone
private parseTimeToDateIST(dateStr: string, timeStr: string): Date | null {
  if (!timeStr || !dateStr) return null;

  try {
    const [hours, minutes] = timeStr.split(':').map(Number);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || isNaN(hours) || isNaN(minutes)) {
      throw new BadRequestException('Invalid time format. Use HH:mm (24-hour format)');
    }

    // Create date string with explicit IST timezone
    const dateTimeStr = `${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00.000+05:30`;
    
    // Parse as IST timezone
    return new Date(dateTimeStr);
  } catch {
    throw new BadRequestException('Invalid time format. Use HH:mm (24-hour format)');
  }
}

// Helper method: Format time to IST string (HH:mm)
private formatTimeIST(timeStr: string): string {
  if (!timeStr) return '';
  
  const [hours, minutes] = timeStr.split(':').map(Number);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// Helper method: Convert minutes to HH:mm format (renamed to avoid duplicate)
private formatMinutesToHHMM(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.floor(totalMinutes % 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// ✅ NEW: Generate PDF report with improved design
// ✅ NEW: Generate PDF report with improved design
async generatePDFReport(dto: GenerateReportDto) {
  const {
    startDate,
    endDate,
    day,
    month,
    employeeId,
    department,
    reportType = 'detailed',
  } = dto;

  const supa = this.supabase.getAdminClient();

  // Build query with filters - REMOVE joining_date as it doesn't exist
  let query = supa
    .from('attendance')
    .select(`
      *,
      users!attendance_user_id_fkey (
        id,
        name,
        email,
        employee_id,
        designation,
        department,
        profile_url
      )
    `)
    .order('date', { ascending: false });

  // Apply filters
  if (day) {
    query = query.eq('date', day);
  } else if (month) {
    const start = `${month}-01`;
    const end = new Date(
      new Date(start).getFullYear(),
      new Date(start).getMonth() + 1,
      0
    ).toISOString().slice(0, 10);
    query = query.gte('date', start).lte('date', end);
  } else if (startDate && endDate) {
    query = query.gte('date', startDate).lte('date', endDate);
  }

  if (employeeId) {
    query = query.eq('users.employee_id', employeeId);
  }

  if (department) {
    query = query.ilike('users.department', `%${department}%`);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Database error:', error);
    throw new InternalServerErrorException(error.message);
  }

  if (!data || data.length === 0) {
    throw new BadRequestException('No attendance data found');
  }

  // Process data for PDF
  const processedData = data.map(record => ({
    date: record.date,
    employee_id: record.users?.employee_id ?? 'N/A',
    name: record.users?.name ?? 'N/A',
    department: record.users?.department ?? 'N/A',
    designation: record.users?.designation ?? 'N/A',
    check_in: this.toIST(record.check_in) || '-',
    check_out: this.toIST(record.check_out) || '-',
    total_time: record.total_time_minutes != null
      ? this.formatMinutesToHHMM(record.total_time_minutes)
      : '00:00',
    status: this.getStatus(record),
    is_absent: record.is_absent ? 'Yes' : 'No',
    absence_reason: record.absence_reason?.substring(0, 50) || '-',
    half_day_type: record.half_day_type || '-',
    permission_time: record.permission_time || '-',
    permission_duration: record.permission_duration_minutes != null
      ? `${Math.floor(record.permission_duration_minutes / 60)}h ${record.permission_duration_minutes % 60}m`
      : '-',
    permission_reason: record.permission_reason?.substring(0, 50) || '-',
    manual_entry: record.manual_entry ? 'Yes' : 'No',
    notes: record.notes?.substring(0, 50) || '-',
    created_at: this.toIST(record.created_at),
    updated_at: this.toIST(record.updated_at),
  }));

  // Calculate summary statistics
  const summary = {
    totalRecords: processedData.length,
    present: processedData.filter(r => r.status === 'Present').length,
    absent: processedData.filter(r => r.status === 'Absent').length,
    halfDay: processedData.filter(r => r.status.includes('Half Day')).length,
    permission: processedData.filter(r => r.status === 'Permission').length,
    checkedIn: processedData.filter(r => r.status === 'Checked In').length,
    notCheckedIn: processedData.filter(r => r.status === 'Not Checked In').length,
  };

  // Create metadata object for PDF
  const metadata = {
    reportType,
    startDate: startDate || day || (month ? `${month}-01` : null),
    endDate: endDate || day || (month ? new Date(
      new Date(`${month}-01`).getFullYear(),
      new Date(`${month}-01`).getMonth() + 1,
      0
    ).toISOString().slice(0, 10) : null),
    employeeId: employeeId || null,
    department: department || null,
    generatedAt: new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'medium'
    }),
  };

  // Generate PDF based on report type
  const pdfBuffer = reportType === 'summary' 
    ? await this.createSummaryPDF(processedData, summary, metadata)
    : await this.createDetailedPDF(processedData, summary, metadata);

  return {
    pdfBuffer,
    meta: {
      filtersApplied: dto,
      totalRecords: processedData.length,
      summary,
    },
  };
}
// Helper to create detailed PDF with better design
private async createDetailedPDF(data: any[], summary: any, metadata: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      // Create PDF document with better margins
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margin: 30,
        bufferPages: true,
        font: 'Helvetica'
      });

      const buffers: Buffer[] = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      // ========== HEADER ==========
      doc.rect(0, 0, doc.page.width, 80)
        .fill('#1a237e'); // Deep blue header

      doc.fillColor('white')
        .fontSize(24)
        .font('Helvetica-Bold')
        .text('ATTENDANCE REPORT', 30, 30, {
          align: 'left',
          width: doc.page.width - 60
        });

      doc.fillColor('white')
        .fontSize(10)
        .font('Helvetica')
        .text('Generated by Attendance Management System', 30, 58, {
          align: 'left'
        });

      // Company logo (placeholder)
      doc.fillColor('white')
        .fontSize(8)
        .text('AMS', doc.page.width - 60, 30, {
          align: 'right'
        });

      // ========== METADATA SECTION ==========
      doc.y = 100;
      doc.fillColor('#37474f')
        .fontSize(11)
        .font('Helvetica-Bold')
        .text('Report Information', 30, doc.y);

      doc.moveDown(0.3);

      // Metadata table
      const metadataTable = {
        headers: ['Period', 'Employee ID', 'Department', 'Report Type', 'Generated On'],
        data: [[
          metadata.startDate && metadata.endDate 
            ? `${metadata.startDate} to ${metadata.endDate}` 
            : metadata.month || 'Custom Range',
          metadata.employeeId || 'All',
          metadata.department || 'All',
          metadata.reportType.charAt(0).toUpperCase() + metadata.reportType.slice(1),
          metadata.generatedAt
        ]]
      };

      // Draw metadata table
      doc.font('Helvetica');
      const metadataX = 30;
      let metadataY = doc.y;
      const colWidths = [120, 80, 100, 80, 120];

      // Draw headers
      doc.fontSize(9).font('Helvetica-Bold');
      metadataTable.headers.forEach((header, i) => {
        doc.fillColor('#546e7a')
          .text(header, metadataX + colWidths.slice(0, i).reduce((a, b) => a + b, 0), metadataY, {
            width: colWidths[i],
            align: 'left'
          });
      });

      metadataY += 15;

      // Draw data
      doc.fontSize(9).font('Helvetica');
      metadataTable.data.forEach(row => {
        row.forEach((cell, i) => {
          doc.fillColor('#263238')
            .text(cell, metadataX + colWidths.slice(0, i).reduce((a, b) => a + b, 0), metadataY, {
              width: colWidths[i],
              align: 'left'
            });
        });
        metadataY += 15;
      });

      doc.y = metadataY + 10;

      // ========== SUMMARY SECTION ==========
      if (summary) {
        doc.fillColor('#1a237e')
          .fontSize(12)
          .font('Helvetica-Bold')
          .text('SUMMARY STATISTICS', 30, doc.y);

        doc.moveDown(0.5);

        const summaryCards = [
          { label: 'Total Records', value: summary.totalRecords, color: '#1565c0' },
          { label: 'Present', value: summary.present, color: '#2e7d32' },
          { label: 'Absent', value: summary.absent, color: '#c62828' },
          { label: 'Half Day', value: summary.halfDay, color: '#f9a825' },
          { label: 'Permission', value: summary.permission, color: '#6a1b9a' },
          { label: 'Pending', value: summary.notCheckedIn, color: '#546e7a' }
        ];

        // Draw summary cards
        let cardX = 30;
        let cardY = doc.y;
        const cardWidth = (doc.page.width - 80) / 3;
        const cardHeight = 40;
        let cardCount = 0;

        summaryCards.forEach(card => {
          // Draw card background
          doc.roundedRect(cardX, cardY, cardWidth, cardHeight, 5)
            .fill(card.color);

          // Draw card content
          doc.fillColor('white')
            .fontSize(16)
            .font('Helvetica-Bold')
            .text(card.value.toString(), cardX + 15, cardY + 10, {
              width: cardWidth - 30,
              align: 'left'
            });

          doc.fillColor('white')
            .fontSize(8)
            .font('Helvetica')
            .text(card.label.toUpperCase(), cardX + 15, cardY + 28, {
              width: cardWidth - 30,
              align: 'left'
            });

          cardX += cardWidth + 10;
          cardCount++;

          if (cardCount % 3 === 0) {
            cardX = 30;
            cardY += cardHeight + 10;
          }
        });

        doc.y = cardY + cardHeight + 20;
      }

      // ========== ATTENDANCE DATA SECTION ==========
      doc.fillColor('#1a237e')
        .fontSize(12)
        .font('Helvetica-Bold')
        .text('ATTENDANCE DETAILS', 30, doc.y);

      doc.moveDown(0.5);

      // Check if we need a new page for data
      if (doc.y > 500) {
        doc.addPage();
        doc.y = 50;
      }

      // Table headers for detailed report
      const headers = [
        { label: 'Date', width: 60 },
        { label: 'Emp ID', width: 60 },
        { label: 'Name', width: 90 },
        { label: 'Department', width: 70 },
        { label: 'Check In', width: 60 },
        { label: 'Check Out', width: 60 },
        { label: 'Total Time', width: 60 },
        { label: 'Status', width: 70 },
        { label: 'Absent', width: 50 },
        { label: 'Permission', width: 70 },
        { label: 'Manual', width: 50 }
      ];

      const headerY = doc.y;
      let currentY = headerY;

      // Draw table headers with styling
      doc.fontSize(8).font('Helvetica-Bold');
      headers.forEach((header, i) => {
        const xPos = 30 + headers.slice(0, i).reduce((sum, h) => sum + h.width, 0);
        
        // Header background
        doc.rect(xPos, currentY, header.width, 20)
          .fill('#e8eaf6');
        
        // Header text
        doc.fillColor('#1a237e')
          .text(header.label, xPos + 5, currentY + 6, {
            width: header.width - 10,
            align: 'center'
          });
      });

      currentY += 20;

      // Draw data rows with alternating colors
      doc.fontSize(7).font('Helvetica');
      data.forEach((row, rowIndex) => {
        // Check if we need a new page
        if (currentY > doc.page.height - 50) {
          doc.addPage();
          currentY = 50;
          
          // Redraw headers on new page
          headers.forEach((header, i) => {
            const xPos = 30 + headers.slice(0, i).reduce((sum, h) => sum + h.width, 0);
            doc.rect(xPos, currentY, header.width, 20)
              .fill('#e8eaf6');
            doc.fillColor('#1a237e')
              .fontSize(8).font('Helvetica-Bold')
              .text(header.label, xPos + 5, currentY + 6, {
                width: header.width - 10,
                align: 'center'
              });
          });
          currentY += 20;
        }

        // Alternate row colors
        const rowColor = rowIndex % 2 === 0 ? '#fafafa' : '#ffffff';
        
        // Row data
        const rowData = [
          row.date,
          row.employee_id,
          row.name.substring(0, 20) + (row.name.length > 20 ? '...' : ''),
          row.department.substring(0, 15) + (row.department.length > 15 ? '...' : ''),
          row.check_in,
          row.check_out,
          row.total_time,
          row.status.substring(0, 15) + (row.status.length > 15 ? '...' : ''),
          row.is_absent,
          row.permission_time !== '-' ? 'Yes' : 'No',
          row.manual_entry
        ];

        // Draw row background
        headers.forEach((header, i) => {
          const xPos = 30 + headers.slice(0, i).reduce((sum, h) => sum + h.width, 0);
          doc.rect(xPos, currentY, header.width, 15)
            .fill(rowColor);
        });

        // Draw row data
        rowData.forEach((cell, i) => {
          const xPos = 30 + headers.slice(0, i).reduce((sum, h) => sum + h.width, 0);
          
          // Determine text color based on status
          let textColor = '#263238';
          if (headers[i].label === 'Status') {
            if (cell.includes('Present')) textColor = '#2e7d32';
            else if (cell.includes('Absent')) textColor = '#c62828';
            else if (cell.includes('Half Day')) textColor = '#f9a825';
            else if (cell.includes('Permission')) textColor = '#6a1b9a';
          }

          doc.fillColor(textColor)
            .text(cell.toString(), xPos + 5, currentY + 4, {
              width: headers[i].width - 10,
              align: 'center'
            });
        });

        currentY += 15;
      });

      // Draw table borders
      const tableWidth = headers.reduce((sum, h) => sum + h.width, 0);
      doc.rect(30, headerY, tableWidth, currentY - headerY)
        .stroke('#b0bec5');

      // ========== FOOTER ==========
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        
        // Footer background
        doc.rect(0, doc.page.height - 40, doc.page.width, 40)
          .fill('#f5f5f5');
        
        // Page number
        doc.fillColor('#546e7a')
          .fontSize(9)
          .text(
            `Page ${i + 1} of ${pageCount}`,
            30,
            doc.page.height - 30,
            { align: 'left' }
          );
        
        // Footer text
        doc.fillColor('#78909c')
          .fontSize(8)
          .text(
            `Confidential - For Internal Use Only | Generated on ${metadata.generatedAt}`,
            30,
            doc.page.height - 15,
            { align: 'left' }
          );
        
        // Company info
        doc.fillColor('#78909c')
          .fontSize(8)
          .text(
            '© 2024 Attendance Management System',
            doc.page.width - 200,
            doc.page.height - 30,
            { align: 'right' }
          );
      }

      doc.end();
    } catch (err) {
      console.error('PDF Generation Error:', err);
      reject(err);
    }
  });
}

// Helper method for simple summary report
private async createSummaryPDF(data: any[], summary: any, metadata: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        bufferPages: true,
      });

      const buffers: Buffer[] = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      // Header with company branding
      doc.fillColor('#1a237e')
        .fontSize(24)
        .font('Helvetica-Bold')
        .text('ATTENDANCE SUMMARY REPORT', { align: 'center' });

      doc.moveDown(0.5);
      doc.fillColor('#546e7a')
        .fontSize(10)
        .text(`Period: ${metadata.startDate} to ${metadata.endDate}`, { align: 'center' });
      
      doc.text(`Generated: ${metadata.generatedAt}`, { align: 'center' });
      doc.moveDown(1);

      // Summary Statistics
      doc.fillColor('#37474f')
        .fontSize(16)
        .text('Summary Statistics', { underline: true });
      doc.moveDown(0.5);

      const stats = [
        `• Total Records: ${summary.totalRecords}`,
        `• Present: ${summary.present} (${((summary.present / summary.totalRecords) * 100).toFixed(1)}%)`,
        `• Absent: ${summary.absent} (${((summary.absent / summary.totalRecords) * 100).toFixed(1)}%)`,
        `• Half Day: ${summary.halfDay} (${((summary.halfDay / summary.totalRecords) * 100).toFixed(1)}%)`,
        `• Permission: ${summary.permission} (${((summary.permission / summary.totalRecords) * 100).toFixed(1)}%)`,
        `• Checked In: ${summary.checkedIn}`,
        `• Not Checked In: ${summary.notCheckedIn}`
      ];

      stats.forEach(stat => {
        doc.fillColor('#263238')
          .fontSize(11)
          .text(stat, { indent: 20 });
      });

      doc.moveDown(1);

      // Simplified data table
      if (data.length > 0) {
        doc.fillColor('#37474f')
          .fontSize(16)
          .text('Attendance Overview', { underline: true });
        doc.moveDown(0.5);

        // Create a simpler table
        const tableTop = doc.y;
        const tableHeaders = ['Date', 'Employee', 'Check In', 'Check Out', 'Status'];
        const colWidths = [80, 150, 80, 80, 100];

        // Draw headers
        doc.fontSize(10).font('Helvetica-Bold');
        tableHeaders.forEach((header, i) => {
          doc.fillColor('#1a237e')
            .text(header, 40 + colWidths.slice(0, i).reduce((a, b) => a + b, 0), tableTop, {
              width: colWidths[i],
              align: 'left'
            });
        });

        let y = tableTop + 20;
        doc.font('Helvetica');

        // Draw data (limit to first 30 rows for summary)
        data.slice(0, 30).forEach((row, index) => {
          if (y > doc.page.height - 100) {
            doc.addPage();
            y = 50;
          }

          const rowData = [
            row.date,
            `${row.name} (${row.employee_id})`,
            row.check_in,
            row.check_out,
            row.status
          ];

          // Alternate row colors
          const fillColor = index % 2 === 0 ? '#f5f5f5' : '#ffffff';
          tableHeaders.forEach((_, i) => {
            doc.rect(40 + colWidths.slice(0, i).reduce((a, b) => a + b, 0), y, colWidths[i], 15)
              .fill(fillColor);
          });

          rowData.forEach((cell, i) => {
            doc.fontSize(9)
              .fillColor('#263238')
              .text(cell.toString(), 45 + colWidths.slice(0, i).reduce((a, b) => a + b, 0), y + 3, {
                width: colWidths[i] - 10,
                align: 'left'
              });
          });

          y += 15;
        });

        if (data.length > 30) {
          doc.moveDown();
          doc.fillColor('#546e7a')
            .fontSize(9)
            .text(`* Showing 30 of ${data.length} records. Use detailed report for complete data.`);
        }
      }

      // Footer
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        doc.fontSize(8)
          .fillColor('#78909c')
          .text(
            `Page ${i + 1} of ${pageCount}`,
            50,
            doc.page.height - 30,
            { align: 'center' }
          );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}


  // ✅ NEW: Bulk calculate attendance for specific time period
  async bulkCalculateAttendance(
    userIds: string[],
    startDate: string,
    endDate: string,
    workingHoursPerDay: number = 8
  ) {
    console.log('=== BULK CALCULATE START ===');
    console.log('Parameters:', { userIds: userIds.length, startDate, endDate, workingHoursPerDay });

    if (!userIds || userIds.length === 0) {
      throw new BadRequestException('User IDs are required');
    }

    if (!startDate || !endDate) {
      throw new BadRequestException('Start date and end date are required');
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      throw new BadRequestException('Dates must be in YYYY-MM-DD format');
    }

    if (startDate > endDate) {
      throw new BadRequestException('Start date must be before end date');
    }

    try {
      const supa = this.supabase.getAdminClient();

      // FIX: Define proper type for results array
      const results: Array<{
        userId: string;
        success: boolean;
        data?: {
          employee_id: any;
          name: any;
          designation: any;
          period: string;
          total_days: number;
          present_days: number;
          absent_days: number;
          half_days: number;
          permission_days: number;
          total_work_hours: number;
          expected_work_hours: number;
          attendance_rate: number;
          work_hours_percentage: number;
        };
        error?: string;
      }> = [];

      for (const userId of userIds) {
        try {
          console.log(`Processing user: ${userId}`);

          // Get user info
          const { data: userData } = await supa
            .from('users')
            .select('id, name, employee_id, designation')
            .eq('id', userId)
            .single();

          if (!userData) {
            results.push({
              userId,
              success: false,
              error: 'User not found'
            });
            continue;
          }

          // Get attendance for date range
          const { data: attendanceData } = await supa
            .from('attendance')
            .select('*')
            .eq('user_id', userId)
            .gte('date', startDate)
            .lte('date', endDate);

          // Calculate statistics
          let totalDays = 0;
          let presentDays = 0;
          let absentDays = 0;
          let halfDays = 0;
          let permissionDays = 0;
          let totalWorkHours = 0;
          let expectedWorkHours = 0;

          // Generate dates between start and end
          const start = new Date(startDate);
          const end = new Date(endDate);

          // FIX: Explicitly type the dateArray
          const dateArray: string[] = [];

          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().slice(0, 10);
            dateArray.push(dateStr);
            totalDays++;
            expectedWorkHours += workingHoursPerDay;
          }

          // Process each date
          dateArray.forEach(dateStr => {
            const attendanceForDate = attendanceData?.find(a => a.date === dateStr);

            if (!attendanceForDate) {
              // No record for this date
              return;
            }

            if (attendanceForDate.is_absent) {
              absentDays++;
            } else if (attendanceForDate.half_day_type) {
              halfDays++;
              totalWorkHours += workingHoursPerDay / 2;
            } else if (attendanceForDate.permission_time) {
              permissionDays++;
              if (attendanceForDate.check_in && attendanceForDate.check_out) {
                const workHours = attendanceForDate.total_time_minutes ?
                  (attendanceForDate.total_time_minutes / 60) :
                  (workingHoursPerDay - (attendanceForDate.permission_duration_minutes || 0) / 60);
                totalWorkHours += workHours;
              }
            } else if (attendanceForDate.check_in && attendanceForDate.check_out) {
              presentDays++;
              totalWorkHours += attendanceForDate.total_time_minutes ?
                (attendanceForDate.total_time_minutes / 60) :
                workingHoursPerDay;
            }
          });

          const attendanceRate = totalDays > 0 ? (presentDays / totalDays) * 100 : 0;
          const workHoursPercentage = expectedWorkHours > 0 ? (totalWorkHours / expectedWorkHours) * 100 : 0;

          results.push({
            userId,
            success: true,
            data: {
              employee_id: userData.employee_id,
              name: userData.name,
              designation: userData.designation,
              period: `${startDate} to ${endDate}`,
              total_days: totalDays,
              present_days: presentDays,
              absent_days: absentDays,
              half_days: halfDays,
              permission_days: permissionDays,
              total_work_hours: Number(totalWorkHours.toFixed(2)),
              expected_work_hours: expectedWorkHours,
              attendance_rate: Number(attendanceRate.toFixed(2)),
              work_hours_percentage: Number(workHoursPercentage.toFixed(2))
            }
          });

        } catch (userErr) {
          console.error(`Error processing user ${userId}:`, userErr);
          results.push({
            userId,
            success: false,
            error: userErr.message || 'Processing error'
          });
        }
      }

      console.log('=== BULK CALCULATE COMPLETE ===');

      return {
        start_date: startDate,
        end_date: endDate,
        working_hours_per_day: workingHoursPerDay,
        total_users: userIds.length,
        processed: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results: results.filter(r => r.success),
        errors: results.filter(r => !r.success).length > 0 ?
          results.filter(r => !r.success) : undefined
      };
    } catch (err) {
      console.error('=== BULK CALCULATE ERROR ===');
      console.error('Error:', err);

      if (err instanceof BadRequestException) throw err;
      throw new InternalServerErrorException('Failed to calculate attendance: ' + err.message);
    }
  }
  // ✅ Get dashboard statistics
 // In your AttendanceService.ts file, update the getDashboardStats method:

async getDashboardStats(date?: string) {
  try {
    const supa = this.supabase.getAdminClient();
    const targetDate = date || this.todayDate();

    // Get total users count (only users with role 'user', not 'admin')
    const { count: totalUsers, error: usersError } = await supa
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'user');

    if (usersError) {
      console.error('Error fetching users count:', usersError);
      throw new InternalServerErrorException('Failed to fetch users count');
    }

    // Get today's attendance - FIXED query
    const { data: attendanceData, error: attendanceError } = await supa
      .from('attendance')
      .select(`
        *,
        users!attendance_user_id_fkey (
          id,
          name,
          role
        )
      `)
      .eq('date', targetDate);

    if (attendanceError) {
      console.error('Error fetching attendance:', attendanceError);
      throw new InternalServerErrorException('Failed to fetch attendance data');
    }

    // Filter attendance records to only include users with role 'user' (not 'admin')
    const filteredAttendance = attendanceData.filter(record => 
      record.users?.role === 'user'
    );

    // Calculate statistics
    const presentToday = filteredAttendance.filter(a => 
      !a.is_absent && a.check_in
    ).length;
    
    const absentToday = filteredAttendance.filter(a => 
      a.is_absent
    ).length;
    
    const checkedInToday = filteredAttendance.filter(a => 
      a.check_in && !a.check_out
    ).length;
    
    const checkedOutToday = filteredAttendance.filter(a => 
      a.check_in && a.check_out
    ).length;

    return {
      date: targetDate,
      total_users: totalUsers || 0,
      today_attendance: filteredAttendance.length,
      present_today: presentToday,
      absent_today: absentToday,
      checked_in_today: checkedInToday,
      checked_out_today: checkedOutToday,
      pending_today: Math.max(0, (totalUsers || 0) - filteredAttendance.length)
    };
  } catch (err) {
    console.error('getDashboardStats error:', err);
    if (err instanceof BadRequestException) throw err;
    throw new InternalServerErrorException('Failed to fetch dashboard statistics');
  }
}

  async getAllAttendanceWithFilters(filters: {
    startDate?: string;
    endDate?: string;
    name?: string;
    employeeId?: string;
    status?: string;
    month?: string;
    year?: string;
    date?: string;
    department?: string;
    designation?: string;
    manualEntry?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    try {
      const supa = this.supabase.getAdminClient();

      // Start with base query including user details
      let query = supa
        .from('attendance')
        .select(`
          *,
          users!attendance_user_id_fkey (
            id,
            name,
            email,
            employee_id,
            designation,
            department,
            profile_url,
            role
          )
        `, { count: 'exact' });

      // Apply date filters
      if (filters.date) {
        // Specific date filter
        const date = new Date(filters.date);
        if (isNaN(date.getTime())) {
          throw new BadRequestException('Invalid date format');
        }
        query = query.eq('date', filters.date);
      } else if (filters.startDate || filters.endDate) {
        // Date range filter
        if (filters.startDate) {
          const startDate = new Date(filters.startDate);
          if (isNaN(startDate.getTime())) {
            throw new BadRequestException('Invalid start date format');
          }
          query = query.gte('date', filters.startDate);
        }
        if (filters.endDate) {
          const endDate = new Date(filters.endDate);
          if (isNaN(endDate.getTime())) {
            throw new BadRequestException('Invalid end date format');
          }
          query = query.lte('date', filters.endDate);
        }
      } else if (filters.month || filters.year) {
        // Month/Year filter
        const month = filters.month || String(new Date().getMonth() + 1).padStart(2, '0');
        const year = filters.year || String(new Date().getFullYear());

        const startDate = `${year}-${month}-01`;
        const endDate = new Date(parseInt(year), parseInt(month), 0)
          .toISOString().slice(0, 10);

        query = query.gte('date', startDate).lte('date', endDate);
      }

      // Apply user filters
      if (filters.name) {
        query = query.ilike('users.name', `%${filters.name}%`);
      }

      if (filters.employeeId) {
        query = query.eq('users.employee_id', filters.employeeId);
      }

      if (filters.department) {
        query = query.ilike('users.department', `%${filters.department}%`);
      }

      if (filters.designation) {
        query = query.ilike('users.designation', `%${filters.designation}%`);
      }

      // Apply attendance status filter
      if (filters.status) {
        const status = filters.status.toLowerCase();
        switch (status) {
          case 'present':
            query = query.eq('is_absent', false).not('check_in', 'is', null);
            break;
          case 'absent':
            query = query.eq('is_absent', true);
            break;
          case 'checked-in':
            query = query.not('check_in', 'is', null).is('check_out', null).eq('is_absent', false);
            break;
          case 'checked-out':
            query = query.not('check_in', 'is', null).not('check_out', 'is', null).eq('is_absent', false);
            break;
          case 'half-day':
            query = query.not('check_in', 'is', null).is('check_out', null).eq('is_absent', false);
            break;
          case 'pending':
            query = query.is('check_in', null).eq('is_absent', false);
            break;
        }
      }

      // Apply manual entry filter
      if (filters.manualEntry !== undefined) {
        const isManual = filters.manualEntry === 'true';
        query = query.eq('manual_entry', isManual);
      }

      // Apply sorting
      const sortField = filters.sortBy || 'date';
      const sortDirection = filters.sortOrder || 'desc';

      switch (sortField) {
        case 'name':
          query = query.order('users.name', { ascending: sortDirection === 'asc' });
          break;
        case 'check_in':
          query = query.order('check_in', { ascending: sortDirection === 'asc' });
          break;
        case 'check_out':
          query = query.order('check_out', { ascending: sortDirection === 'asc' });
          break;
        case 'total_time_minutes':
          query = query.order('total_time_minutes', { ascending: sortDirection === 'asc' });
          break;
        default:
          query = query.order('date', { ascending: sortDirection === 'asc' });
      }

      // Apply pagination
      const page = Math.max(1, filters.page || 1);
      const limit = Math.min(100, Math.max(1, filters.limit || 20));
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      query = query.range(from, to);

      // Execute query
      const { data, error, count } = await query;

      if (error) {
        console.error('Error fetching filtered attendance:', error);
        throw new InternalServerErrorException('Failed to fetch attendance data');
      }

      // Process and format the data
      const formattedData = data.map((record) => {
        const status = this.getDetailedStatus(record);

        return {
          id: record.id,
          user_id: record.user_id,
          date: record.date,
          check_in: record.check_in,
          check_out: record.check_out,
          check_in_ist: this.toIST(record.check_in),
          check_out_ist: this.toIST(record.check_out),
          total_time_minutes: record.total_time_minutes,
          total_time_formatted: record.check_in && record.check_out
            ? this.formatDuration(record.check_in, record.check_out)
            : (record.is_absent ? '00:00:00' : null),
          is_absent: record.is_absent,
          absence_reason: record.absence_reason,
          manual_entry: record.manual_entry || false,
          status: status.label,
          status_code: status.code,
          updated_at: record.updated_at,
          user_info: {
            id: record.users?.id,
            name: record.users?.name,
            email: record.users?.email,
            employee_id: record.users?.employee_id,
            designation: record.users?.designation,
            department: record.users?.department,
            profile_url: record.users?.profile_url,
            role: record.users?.role
          }
        };
      });

      // Calculate summary statistics
      const summary = this.calculateAttendanceSummary(data);

      return {
        data: formattedData,
        pagination: {
          page,
          limit,
          total: count || 0,
          total_pages: Math.ceil((count || 0) / limit),
          has_next: (from + limit) < (count || 0),
          has_prev: page > 1
        },
        filters: {
          ...filters,
          applied_filters: Object.keys(filters).filter(key => filters[key] !== undefined && key !== 'page' && key !== 'limit' && key !== 'sortBy' && key !== 'sortOrder')
        },
        summary
      };
    } catch (err) {
      console.error('getAllAttendanceWithFilters error:', err);
      if (err instanceof BadRequestException) throw err;
      throw new InternalServerErrorException('Failed to fetch attendance data');
    }
  }

  // Helper method for detailed status
  private getDetailedStatus(record: any): { label: string, code: string } {
    if (record.is_absent) {
      return { label: 'Absent', code: 'absent' };
    }

    if (record.check_in && !record.check_out) {
      return { label: 'Checked In', code: 'checked-in' };
    }

    if (record.check_in && record.check_out) {
      // Check if worked less than 4 hours (half day)
      const totalHours = record.total_time_minutes ? record.total_time_minutes / 60 : 0;
      if (totalHours > 0 && totalHours < 4) {
        return { label: 'Half Day', code: 'half-day' };
      }
      return { label: 'Present', code: 'present' };
    }

    return { label: 'Not Checked In', code: 'pending' };
  }

  // Calculate summary statistics
  private calculateAttendanceSummary(data: any[]) {
    const total = data.length;
    const present = data.filter(d => !d.is_absent && d.check_in && d.check_out).length;
    const absent = data.filter(d => d.is_absent).length;
    const checkedIn = data.filter(d => d.check_in && !d.check_out && !d.is_absent).length;
    const pending = data.filter(d => !d.check_in && !d.is_absent).length;
    const halfDays = data.filter(d => {
      if (d.is_absent || !d.check_in || !d.check_out) return false;
      const totalHours = d.total_time_minutes ? d.total_time_minutes / 60 : 0;
      return totalHours > 0 && totalHours < 4;
    }).length;

    // Calculate average work hours
    const completeDays = data.filter(d => d.check_in && d.check_out && !d.is_absent);
    const avgWorkHours = completeDays.length > 0
      ? Number((completeDays.reduce((sum, d) => sum + (d.total_time_minutes || 0), 0) / completeDays.length / 60).toFixed(2))
      : 0;

    return {
      total,
      present,
      absent,
      checked_in: checkedIn,
      pending,
      half_days: halfDays,
      average_work_hours: avgWorkHours,
      percentage_present: total > 0 ? Number(((present / total) * 100).toFixed(2)) : 0
    };
  }

  // Get monthly attendance report
  async getMonthlyReport(year?: string, month?: string, department?: string) {
    try {
      const supa = this.supabase.getAdminClient();

      const currentYear = year || String(new Date().getFullYear());
      const currentMonth = month || String(new Date().getMonth() + 1).padStart(2, '0');

      // Calculate date range
      const startDate = `${currentYear}-${currentMonth}-01`;
      const endDate = new Date(parseInt(currentYear), parseInt(currentMonth), 0)
        .toISOString().slice(0, 10);

      // Get all users
      let userQuery = supa
        .from('users')
        .select('id, name, email, employee_id, designation, department, role')
        .eq('role', 'user');

      if (department) {
        userQuery = userQuery.ilike('department', `%${department}%`);
      }

      const { data: users, error: usersError } = await userQuery;

      if (usersError) {
        console.error('Error fetching users:', usersError);
        throw new InternalServerErrorException('Failed to fetch users data');
      }

      // Get attendance for the month
      const { data: attendance, error: attendanceError } = await supa
        .from('attendance')
        .select('*')
        .in('user_id', users.map(u => u.id))
        .gte('date', startDate)
        .lte('date', endDate);

      if (attendanceError) {
        console.error('Error fetching attendance:', attendanceError);
        throw new InternalServerErrorException('Failed to fetch attendance data');
      }

      // Organize data by user
      const report = users.map(user => {
        const userAttendance = attendance.filter(a => a.user_id === user.id);
        const totalDays = userAttendance.length;
        const presentDays = userAttendance.filter(a => !a.is_absent && a.check_in && a.check_out).length;
        const absentDays = userAttendance.filter(a => a.is_absent).length;
        const halfDays = userAttendance.filter(a => {
          if (a.is_absent || !a.check_in || !a.check_out) return false;
          const totalHours = a.total_time_minutes ? a.total_time_minutes / 60 : 0;
          return totalHours > 0 && totalHours < 4;
        }).length;

        // Calculate total work hours
        const totalWorkMinutes = userAttendance
          .filter(a => a.check_in && a.check_out && !a.is_absent)
          .reduce((sum, a) => sum + (a.total_time_minutes || 0), 0);

        const averageWorkHours = presentDays > 0
          ? Number((totalWorkMinutes / presentDays / 60).toFixed(2))
          : 0;

        return {
          employee_id: user.employee_id,
          name: user.name,
          email: user.email,
          designation: user.designation,
          department: user.department,
          total_days: totalDays,
          present_days: presentDays,
          absent_days: absentDays,
          half_days: halfDays,
          total_work_hours: Number((totalWorkMinutes / 60).toFixed(2)),
          average_work_hours: averageWorkHours,
          attendance_rate: totalDays > 0 ? Number(((presentDays / totalDays) * 100).toFixed(2)) : 0,
          details: userAttendance.map(a => ({
            date: a.date,
            status: this.getDetailedStatus(a).label,
            check_in: this.toIST(a.check_in),
            check_out: this.toIST(a.check_out),
            total_time: a.check_in && a.check_out
              ? this.formatDuration(a.check_in, a.check_out)
              : null,
            is_absent: a.is_absent,
            absence_reason: a.absence_reason
          })).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        };
      });

      // Calculate overall summary
      const overallSummary = {
        total_employees: users.length,
        total_days_in_month: new Date(parseInt(currentYear), parseInt(currentMonth), 0).getDate(),
        month: currentMonth,
        year: currentYear,
        total_present_days: report.reduce((sum, r) => sum + r.present_days, 0),
        total_absent_days: report.reduce((sum, r) => sum + r.absent_days, 0),
        total_half_days: report.reduce((sum, r) => sum + r.half_days, 0),
        average_attendance_rate: report.length > 0
          ? Number((report.reduce((sum, r) => sum + r.attendance_rate, 0) / report.length).toFixed(2))
          : 0
      };

      return {
        report,
        overall_summary: overallSummary,
        period: {
          start_date: startDate,
          end_date: endDate,
          month: this.getMonthName(currentMonth),
          year: currentYear
        }
      };
    } catch (err) {
      console.error('getMonthlyReport error:', err);
      if (err instanceof BadRequestException) throw err;
      throw new InternalServerErrorException('Failed to generate monthly report');
    }
  }

  private getMonthName(month: string): string {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthIndex = parseInt(month) - 1;
    return months[monthIndex] || 'Unknown';
  }
}