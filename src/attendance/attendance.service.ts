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
import PDFDocument = require('pdfkit');
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

  // ✅ NEW: Generate PDF report with improved design and user statistics
  async generatePDFReport(dto: GenerateReportDto & {
    name?: string;
    status?: string;
    designation?: string;
    lateArrivalsOnly?: boolean;
    earlyDeparturesOnly?: boolean;
    includeSummary?: boolean;
    groupByDepartment?: boolean;
    includeCharts?: boolean;
  }) {
    console.log('=== GENERATE PDF REPORT START ===');
    console.log('Filters DTO:', JSON.stringify(dto, null, 2));

    const {
      startDate,
      endDate,
      day,
      month,
      employeeId,
      department,
      name,
      status,
      designation,
      lateArrivalsOnly = false,
      earlyDeparturesOnly = false,
      includeSummary = true,
      groupByDepartment = false,
      includeCharts = false,
      reportType = 'detailed',
    } = dto;

    const supa = this.supabase.getAdminClient();

    // Build query with all possible filters
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
        created_at
      )
    `)
      .order('date', { ascending: false });

    // In generatePDFReport method, replace the date filtering section:

    // Apply date filters
    if (day) {
      // Specific day filter
      query = query.eq('date', day);
      console.log(`PDF Report: Filtering by day: ${day}`);
    } else if (month) {
      // Month filter (e.g., "2024-12")
      const [year, monthNum] = month.split('-');
      const start = `${year}-${monthNum}-01`;
      const endDate = new Date(parseInt(year), parseInt(monthNum), 0); // Last day of month
      const end = endDate.toISOString().slice(0, 10);
      query = query.gte('date', start).lte('date', end);
      console.log(`PDF Report: Filtering by month: ${month} (${start} to ${end})`);
    } else if (startDate && endDate) {
      // Date range filter - IMPORTANT FIX HERE
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new BadRequestException('Invalid date format');
      }

      // Format dates to YYYY-MM-DD
      const startFormatted = start.toISOString().split('T')[0];
      const endFormatted = end.toISOString().split('T')[0];

      query = query.gte('date', startFormatted).lte('date', endFormatted);
      console.log(`PDF Report: Filtering by date range: ${startFormatted} to ${endFormatted}`);
    } else if (startDate) {
      // Single start date
      const start = new Date(startDate);
      if (isNaN(start.getTime())) {
        throw new BadRequestException('Invalid start date format');
      }
      const startFormatted = start.toISOString().split('T')[0];
      query = query.gte('date', startFormatted);
      console.log(`PDF Report: Filtering from date: ${startFormatted}`);
    } else if (endDate) {
      // Single end date
      const end = new Date(endDate);
      if (isNaN(end.getTime())) {
        throw new BadRequestException('Invalid end date format');
      }
      const endFormatted = end.toISOString().split('T')[0];
      query = query.lte('date', endFormatted);
      console.log(`PDF Report: Filtering to date: ${endFormatted}`);
    }

    // Apply employee filters
    if (employeeId) {
      query = query.eq('users.employee_id', employeeId);
      console.log(`PDF Report: Filtering by employee ID: ${employeeId}`);
    }

    if (name) {
      query = query.ilike('users.name', `%${name}%`);
      console.log(`PDF Report: Filtering by name: ${name}`);
    }

    if (department) {
      query = query.ilike('users.department', `%${department}%`);
      console.log(`PDF Report: Filtering by department: ${department}`);
    }

    if (designation) {
      query = query.ilike('users.designation', `%${designation}%`);
      console.log(`PDF Report: Filtering by designation: ${designation}`);
    }

    // Apply status filter
    if (status) {
      const statusLower = status.toLowerCase();
      switch (statusLower) {
        case 'present':
          query = query.eq('is_absent', false)
            .not('check_in', 'is', null)
            .not('check_out', 'is', null);
          console.log(`PDF Report: Filtering by status: Present`);
          break;
        case 'absent':
          query = query.eq('is_absent', true);
          console.log(`PDF Report: Filtering by status: Absent`);
          break;
        case 'checked-in':
          query = query.not('check_in', 'is', null)
            .is('check_out', null)
            .eq('is_absent', false);
          console.log(`PDF Report: Filtering by status: Checked In`);
          break;
        case 'checked-out':
          query = query.not('check_in', 'is', null)
            .not('check_out', 'is', null)
            .eq('is_absent', false);
          console.log(`PDF Report: Filtering by status: Checked Out`);
          break;
        case 'half-day':
          query = query.not('half_day_type', 'is', null)
            .eq('is_absent', false);
          console.log(`PDF Report: Filtering by status: Half Day`);
          break;
        case 'permission':
          query = query.not('permission_time', 'is', null)
            .eq('is_absent', false);
          console.log(`PDF Report: Filtering by status: Permission`);
          break;
        case 'manual':
          query = query.eq('manual_entry', true);
          console.log(`PDF Report: Filtering by status: Manual Entry`);
          break;
        case 'auto':
          query = query.eq('manual_entry', false);
          console.log(`PDF Report: Filtering by status: Auto Entry`);
          break;
        default:
          console.log(`PDF Report: Unknown status filter: ${status}`);
      }
    }

    console.log(`PDF Report: Executing query with filters...`);

    const { data, error } = await query;

    if (error) {
      console.error('Database error:', error);
      throw new InternalServerErrorException(`Database error: ${error.message}`);
    }

    console.log(`PDF Report: Found ${data?.length || 0} records`);

    if (!data || data.length === 0) {
      throw new BadRequestException('No attendance data found for the selected filters');
    }

    // Process data for PDF with enhanced information
    const processedData = data.map(record => {
      const checkInTime = record.check_in ? this.parseTimeFromDateTime(record.check_in) : null;
      const checkOutTime = record.check_out ? this.parseTimeFromDateTime(record.check_out) : null;

      // Calculate late arrival (after 09:30 AM)
      const isLateArrival = checkInTime ?
        this.isLateArrival(checkInTime) : false;

      // Calculate early departure (before 19:00 PM)
      const isEarlyDeparture = checkOutTime ?
        this.isEarlyDeparture(checkOutTime) : false;

      // Get status with detailed code
      const statusDetail = this.getDetailedStatus(record);

      return {
        date: record.date,
        user_id: record.user_id,
        employee_id: record.users?.employee_id ?? 'N/A',
        name: record.users?.name ?? 'N/A',
        department: record.users?.department ?? 'N/A',
        designation: record.users?.designation ?? 'N/A',
        email: record.users?.email ?? 'N/A',
        check_in: this.toIST(record.check_in) || '-',
        check_out: this.toIST(record.check_out) || '-',
        check_in_raw: record.check_in,
        check_out_raw: record.check_out,
        check_in_time: checkInTime,
        check_out_time: checkOutTime,
        total_time: record.total_time_minutes != null
          ? this.formatMinutesToHHMM(record.total_time_minutes)
          : '00:00',
        total_minutes: record.total_time_minutes || 0,
        status: statusDetail.label,
        status_code: statusDetail.code,
        is_absent: record.is_absent ? 'Yes' : 'No',
        is_late_arrival: isLateArrival ? 'Yes' : 'No',
        is_early_departure: isEarlyDeparture ? 'Yes' : 'No',
        absence_reason: record.absence_reason?.substring(0, 100) || '-',
        half_day_type: record.half_day_type || '-',
        permission_time: record.permission_time || '-',
        permission_duration: record.permission_duration_minutes != null
          ? `${Math.floor(record.permission_duration_minutes / 60)}h ${record.permission_duration_minutes % 60}m`
          : '-',
        permission_reason: record.permission_reason?.substring(0, 100) || '-',
        manual_entry: record.manual_entry ? 'Yes' : 'No',
        entry_type: record.manual_entry ? 'Manual' : 'Auto',
        notes: record.notes?.substring(0, 100) || '-',
        created_at: this.toIST(record.created_at),
        updated_at: this.toIST(record.updated_at),
        user_created_at: record.users?.created_at ?
          new Date(record.users.created_at).toLocaleDateString('en-IN') : 'N/A',
        users: record.users // Include full user object for statistics
      };
    });

    // Apply advanced filters on processed data
    let filteredData = processedData;

    if (lateArrivalsOnly) {
      filteredData = filteredData.filter(r => r.is_late_arrival === 'Yes');
      console.log(`PDF Report: Filtered to ${filteredData.length} late arrivals`);
    }

    if (earlyDeparturesOnly) {
      filteredData = filteredData.filter(r => r.is_early_departure === 'Yes');
      console.log(`PDF Report: Filtered to ${filteredData.length} early departures`);
    }

    if (filteredData.length === 0) {
      throw new BadRequestException('No records match the additional filters (late arrivals/early departures)');
    }

    // Calculate comprehensive summary statistics
    const summary = this.calculateComprehensiveSummary(filteredData);

    // Group data by department if requested
    let departmentGroups: any[] | null = null;
    if (groupByDepartment) {
      departmentGroups = this.groupByDepartment(filteredData);
    }

    // Calculate user statistics (NEW FEATURE)
    const userStatistics = this.calculateUserStatistics(filteredData);
    console.log(`PDF Report: Calculated statistics for ${userStatistics.length} users`);

    // Create metadata object for PDF
    const metadata = {
      reportType,
      filters: {
        dateRange: startDate && endDate ? `${startDate} to ${endDate}` :
          day ? `Day: ${day}` :
            month ? `Month: ${month}` : 'All Dates',
        employeeId: employeeId || 'All',
        department: department || 'All',
        name: name || 'All',
        designation: designation || 'All',
        status: status || 'All',
        lateArrivalsOnly,
        earlyDeparturesOnly,
      },
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
        dateStyle: 'full',
        timeStyle: 'medium'
      }),
      includeSummary,
      includeCharts,
      groupByDepartment,
      totalFilteredRecords: filteredData.length,
      totalUsers: userStatistics.length, // Add user count to metadata
    };

    console.log(`PDF Report: Generating ${reportType} PDF with ${filteredData.length} records for ${userStatistics.length} users`);

    // Generate PDF based on report type
    let pdfBuffer: Buffer;

    if (reportType === 'summary') {
      pdfBuffer = await this.createSummaryPDF(filteredData, summary, metadata, departmentGroups, includeCharts);
    } else {
      // For detailed reports, include user statistics
      pdfBuffer = await this.createDetailedPDF(
        filteredData,
        summary,
        metadata,
        departmentGroups,
        includeCharts,
        userStatistics // Pass user statistics to detailed PDF
      );
    }

    // Return the PDF buffer along with metadata
    // In generatePDFReport method, update the return statement:
    return {
      pdfBuffer,
      meta: {
        filtersApplied: dto,
        dateRange: metadata.filters.dateRange,
        totalRecords: filteredData.length,
        totalUsers: userStatistics.length,
        perUserSummary: userStatistics.map(user => ({
          name: user.name,
          employee_id: user.employee_id,
          present_days: user.present_days,
          absent_days: user.absent_days,
          half_days: {
            total: user.total_half_days,
            fn: user.half_day_fn,
            an: user.half_day_an
          },
          permission_days: user.permission_days,
          attendance_rate: user.attendance_rate,
          average_work_hours: user.average_work_hours
        })),
        overallSummary: {
          total_present_days: userStatistics.reduce((sum, user) => sum + (user.present_days || 0), 0),
          total_absent_days: userStatistics.reduce((sum, user) => sum + (user.absent_days || 0), 0),
          total_half_days: userStatistics.reduce((sum, user) => sum + (user.total_half_days || 0), 0),
          total_permission_days: userStatistics.reduce((sum, user) => sum + (user.permission_days || 0), 0),
          average_attendance_rate: userStatistics.length > 0
            ? (userStatistics.reduce((sum, user) => sum + parseFloat(user.attendance_rate || 0), 0) / userStatistics.length).toFixed(2)
            : '0.00'
        },
        generatedAt: metadata.generatedAt,
      },
    };
  }


  private createPerUserSummaryTable(doc: any, userStats: any[], startY: number, metadata: any) {
    console.log('Creating per-user summary table...');

    const headers = [
      'Employee Name',
      'Emp ID',
      'Present',
      'Absent',
      'Half Days',
      'Permission',
      'Attendance %'
    ];

    const colWidths = [80, 60, 50, 50, 60, 50, 60];
    const headerX = 30;
    const headerY = startY;

    // Table header with background
    doc.rect(headerX, headerY, colWidths.reduce((a, b) => a + b), 25)
      .fill('#2196F3')
      .stroke('#0D47A1');

    doc.fillColor('#fff')
      .fontSize(10)
      .font('Helvetica-Bold');

    headers.forEach((header, i) => {
      doc.text(header,
        headerX + colWidths.slice(0, i).reduce((a, b) => a + b, 0) + 5,
        headerY + 8,
        { width: colWidths[i] - 10 }
      );
    });

    // Table data
    let tableY = headerY + 30;
    doc.fillColor('#263238')
      .fontSize(9);

    userStats.forEach((user, rowIndex) => {
      if (tableY > doc.page.height - 50) {
        doc.addPage();
        tableY = 50;
        // Redraw header on new page
        doc.rect(headerX, tableY - 20, colWidths.reduce((a, b) => a + b), 25)
          .fill('#2196F3')
          .stroke('#0D47A1');

        doc.fillColor('#fff')
          .fontSize(10)
          .font('Helvetica-Bold');

        headers.forEach((header, i) => {
          doc.text(header,
            headerX + colWidths.slice(0, i).reduce((a, b) => a + b, 0) + 5,
            tableY - 12,
            { width: colWidths[i] - 10 }
          );
        });

        tableY += 10;
      }

      // Alternate row colors
      const rowBgColor = rowIndex % 2 === 0 ? '#E3F2FD' : '#FFFFFF';
      doc.rect(headerX, tableY - 5, colWidths.reduce((a, b) => a + b), 20)
        .fill(rowBgColor);

      // Highlight attendance percentages
      const attendanceRate = parseFloat(user.attendance_rate);
      if (attendanceRate >= 90) {
        doc.rect(headerX, tableY - 5, colWidths.reduce((a, b) => a + b), 20)
          .stroke('#4CAF50')
          .lineWidth(1);
      } else if (attendanceRate < 70) {
        doc.rect(headerX, tableY - 5, colWidths.reduce((a, b) => a + b), 20)
          .stroke('#F44336')
          .lineWidth(1);
      }

      // Format half days as "FN/AN"
      const halfDaysFormatted = user.half_day_fn > 0 || user.half_day_an > 0
        ? `${user.half_day_fn}FN/${user.half_day_an}AN`
        : '0';

      const rowData = [
        user.name.length > 20 ? user.name.substring(0, 18) + '...' : user.name,
        user.employee_id || 'N/A',
        user.present_days.toString(),
        user.absent_days.toString(),
        halfDaysFormatted,
        user.permission_days.toString(),
        `${attendanceRate}%`
      ];

      rowData.forEach((cell, i) => {
        const cellX = headerX + colWidths.slice(0, i).reduce((a, b) => a + b, 0) + 5;
        const cellWidth = colWidths[i] - 10;

        // Color code based on performance
        if (i === 6) { // Attendance rate column
          let cellColor = '#4CAF50'; // Green for good
          if (attendanceRate < 70) {
            cellColor = '#F44336'; // Red for poor
          } else if (attendanceRate < 90) {
            cellColor = '#FF9800'; // Orange for average
          }

          doc.fillColor(cellColor)
            .font('Helvetica-Bold');
        } else if (i === 2) { // Present days
          doc.fillColor('#2E7D32') // Dark green
            .font('Helvetica-Bold');
        } else if (i === 3) { // Absent days
          doc.fillColor('#C62828') // Dark red
            .font('Helvetica-Bold');
        } else {
          doc.fillColor('#263238');
        }

        doc.text(cell.toString(), cellX, tableY, { width: cellWidth });
      });

      tableY += 20;
    });

    // Add summary statistics at the bottom
    const summaryY = tableY + 20;
    doc.fillColor('#37474F')
      .fontSize(11)
      .font('Helvetica-Bold')
      .text('📊 Overall Summary:', headerX, summaryY);

    const totalUsers = userStats.length;
    const totalPresent = userStats.reduce((sum, user) => sum + (user.present_days || 0), 0);
    const totalAbsent = userStats.reduce((sum, user) => sum + (user.absent_days || 0), 0);
    const totalHalfDays = userStats.reduce((sum, user) => sum + (user.total_half_days || 0), 0);
    const totalPermission = userStats.reduce((sum, user) => sum + (user.permission_days || 0), 0);

    const summaryStats = [
      `• Total Employees: ${totalUsers}`,
      `• Total Present Days: ${totalPresent}`,
      `• Total Absent Days: ${totalAbsent}`,
      `• Total Half Days: ${totalHalfDays} (FN: ${userStats.reduce((sum, user) => sum + (user.half_day_fn || 0), 0)}, AN: ${userStats.reduce((sum, user) => sum + (user.half_day_an || 0), 0)})`,
      `• Total Permission Days: ${totalPermission}`,
      `• Date Range: ${metadata.filters.dateRange}`
    ];

    doc.fillColor('#546E7A')
      .fontSize(10)
      .font('Helvetica');

    summaryStats.forEach((stat, i) => {
      doc.text(stat, headerX + 10, summaryY + 20 + (i * 15));
    });
  }

  // Replace the calculateUserStatistics method with this improved version:
  private calculateUserStatistics(data: any[]): any[] {
    console.log('Calculating detailed user statistics...');

    // Group data by user
    const userMap: { [key: string]: any } = {};

    data.forEach(record => {
      const userId = record.user_id;
      const userName = record.name || 'Unknown';
      const employeeId = record.employee_id || 'N/A';
      const department = record.department || 'N/A';
      const designation = record.designation || 'N/A';

      if (!userMap[userId]) {
        userMap[userId] = {
          user_id: userId,
          name: userName,
          employee_id: employeeId,
          department: department,
          designation: designation,
          total_days: 0,
          present_days: 0,
          absent_days: 0,
          half_day_morning: 0, // FN (Forenoon)
          half_day_afternoon: 0, // AN (Afternoon)
          permission_days: 0,
          total_work_minutes: 0,
          records: []
        };
      }

      const userStats = userMap[userId];
      userStats.total_days++;
      userStats.records.push(record);

      // Categorize by status
      if (record.is_absent === 'Yes') {
        userStats.absent_days++;
      } else if (record.half_day_type && record.half_day_type !== '-') {
        if (record.half_day_type.toLowerCase().includes('morning') ||
          record.half_day_type.toLowerCase().includes('fn')) {
          userStats.half_day_morning++; // FN
        } else if (record.half_day_type.toLowerCase().includes('afternoon') ||
          record.half_day_type.toLowerCase().includes('an')) {
          userStats.half_day_afternoon++; // AN
        }
      } else if (record.permission_time && record.permission_time !== '-') {
        userStats.permission_days++;
      } else if (record.check_in && record.check_in !== '-' &&
        record.check_out && record.check_out !== '-') {
        userStats.present_days++;
        userStats.total_work_minutes += record.total_minutes || 0;
      }
    });

    // Convert map to array and format
    const userStatsArray = Object.values(userMap).map((user: any) => {
      const presentDays = user.present_days || 0;
      const totalDays = user.total_days || 0;
      const totalWorkMinutes = user.total_work_minutes || 0;
      const totalHalfDays = (user.half_day_morning || 0) + (user.half_day_afternoon || 0);

      return {
        ...user,
        total_half_days: totalHalfDays,
        half_day_fn: user.half_day_morning || 0,
        half_day_an: user.half_day_afternoon || 0,
        total_work_hours: (totalWorkMinutes / 60).toFixed(2),
        average_work_hours: presentDays > 0
          ? (totalWorkMinutes / presentDays / 60).toFixed(2)
          : '0.00',
        attendance_rate: totalDays > 0
          ? ((presentDays / totalDays) * 100).toFixed(2)
          : '0.00',
        attendance_percentage: totalDays > 0
          ? ((presentDays / totalDays) * 100).toFixed(2)
          : '0.00'
      };
    });

    // Sort by name for better readability
    return userStatsArray.sort((a: any, b: any) => {
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  // Helper method to get top reason from map
  private getTopReason(reasonMap: Map<string, number>): string {
    if (!reasonMap || reasonMap.size === 0) return 'None';

    let topReason = '';
    let maxCount = 0;

    reasonMap.forEach((count, reason) => {
      if (count > maxCount) {
        maxCount = count;
        topReason = reason;
      }
    });

    // Truncate long reasons
    return topReason.length > 30 ? topReason.substring(0, 27) + '...' : topReason;
  }

  // Helper method for detailed status


  // Update the createDetailedPDF method signature to include userStatistics
  private async createDetailedPDF(
    data: any[],
    summary: any,
    metadata: any,
    departmentGroups?: any,
    includeCharts?: boolean,
    userStatistics?: any // Add this parameter
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 30,
          font: 'Helvetica'
        });
        const buffers: Buffer[] = [];

        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);

        // ==================== COVER PAGE ====================
        doc.rect(0, 0, doc.page.width, doc.page.height)
          .fill('#1a237e');

        doc.fillColor('white')
          .fontSize(36)
          .font('Helvetica-Bold')
          .text('ATTENDANCE', 0, 150, { align: 'center' });

        doc.fontSize(24)
          .text('ANALYSIS REPORT', 0, 200, { align: 'center' });

        doc.fontSize(14)
          .text('Status-wise Detailed Analysis with Employee Statistics', 0, 280, { align: 'center' });

        doc.fontSize(12)
          .text(`Period: ${metadata.filters.dateRange}`, 0, 320, { align: 'center' })
          .text(`Total Records: ${metadata.totalFilteredRecords}`, 0, 340, { align: 'center' })
          .text(`Total Employees: ${metadata.totalUsers}`, 0, 360, { align: 'center' }); // Add employee count

        doc.fontSize(10)
          .text('Status Categories: Present • Absent • Half Day • Permission • Late Arrivals • Employee Statistics',
            0, doc.page.height - 100, { align: 'center' });

        doc.addPage();

        // ==================== STATUS SUMMARY DASHBOARD ====================
        doc.fillColor('#1a237e')
          .fontSize(20)
          .font('Helvetica-Bold')
          .text('STATUS DASHBOARD', 30, 50);

        // Status statistics in boxes
        const statusStats = [
          {
            label: 'PRESENT',
            value: summary.byStatus?.present || 0,
            color: '#4CAF50',
            icon: '✓',
            bgColor: '#E8F5E9'
          },
          {
            label: 'ABSENT',
            value: summary.byStatus?.absent || 0,
            color: '#F44336',
            icon: '✗',
            bgColor: '#FFEBEE'
          },
          {
            label: 'HALF DAY',
            value: summary.byStatus?.halfDay || 0,
            color: '#FF9800',
            icon: '½',
            bgColor: '#FFF3E0'
          },
          {
            label: 'PERMISSION',
            value: summary.byStatus?.permission || 0,
            color: '#9C27B0',
            icon: '⏰',
            bgColor: '#F3E5F5'
          },
          {
            label: 'CHECKED IN',
            value: summary.byStatus?.checkedIn || 0,
            color: '#2196F3',
            icon: '↪',
            bgColor: '#E3F2FD'
          },
          {
            label: 'LATE ARRIVALS',
            value: summary.timing?.lateArrivals || 0,
            color: '#FF5722',
            icon: '⌛',
            bgColor: '#FBE9E7'
          }
        ];

        let statX = 30;
        let statY = 90;
        const statWidth = 80;
        const statHeight = 70;

        statusStats.forEach((stat, index) => {
          if (index > 0 && index % 3 === 0) {
            statY += statHeight + 15;
            statX = 30;
          }

          // Stat box with background
          doc.rect(statX, statY, statWidth, statHeight)
            .fill(stat.bgColor)
            .stroke(stat.color);

          // Icon
          doc.fillColor(stat.color)
            .fontSize(24)
            .text(stat.icon, statX + statWidth / 2, statY + 15, { align: 'center' });

          // Value
          doc.fillColor('#263238')
            .fontSize(18)
            .font('Helvetica-Bold')
            .text(stat.value.toString(), statX + statWidth / 2, statY + 35, { align: 'center' });

          // Label
          doc.fillColor('#666')
            .fontSize(10)
            .font('Helvetica')
            .text(stat.label, statX + statWidth / 2, statY + 55, { align: 'center' });

          statX += statWidth + 15;
        });

        // ==================== EMPLOYEE STATISTICS SUMMARY TABLE ====================
        // In createDetailedPDF method, replace the user statistics section with:

        // ==================== PER-USER SUMMARY TABLE ====================
        if (userStatistics && userStatistics.length > 0) {
          doc.addPage();

          // Header with background
          doc.rect(30, 30, doc.page.width - 60, 50)
            .fill('#E3F2FD')
            .stroke('#2196F3');

          doc.fillColor('#0D47A1')
            .fontSize(18)
            .font('Helvetica-Bold')
            .text('👥 EMPLOYEE ATTENDANCE SUMMARY', 40, 45);

          doc.fillColor('#1565C0')
            .fontSize(11)
            .text(`Date Range: ${metadata.filters.dateRange}`, doc.page.width - 150, 45, { align: 'right' });

          doc.fontSize(10)
            .fillColor('#1976D2')
            .text(`Total Employees: ${userStatistics.length}`, doc.page.width - 150, 60, { align: 'right' });

          // Create per-user summary table
          this.createPerUserSummaryTable(doc, userStatistics, 100, metadata);
        }
        // ==================== EXISTING TABLES ====================

        // Present Employees Table
        const presentRecords = data.filter(record =>
          record.check_in && record.check_out && !record.is_absent && !record.half_day_type && !record.permission_time
        );

        if (presentRecords.length > 0) {
          doc.addPage();
          this.createStatusTable(doc, presentRecords, 'Present', 90, '#4CAF50', '#E8F5E9');
        }

        // Absent Employees Table
        const absentRecords = data.filter(record => record.is_absent === 'Yes');

        if (absentRecords.length > 0) {
          doc.addPage();
          this.createStatusTable(doc, absentRecords, 'Absent', 90, '#F44336', '#FFEBEE');
        }

        // Half Day Employees Table
        const halfDayRecords = data.filter(record => record.half_day_type && record.half_day_type !== '-');

        if (halfDayRecords.length > 0) {
          doc.addPage();
          this.createHalfDayTable(doc, halfDayRecords, 90, '#FF9800', '#FFF3E0');
        }

        // Permission Employees Table
        const permissionRecords = data.filter(record => record.permission_time && record.permission_time !== '-');

        if (permissionRecords.length > 0) {
          doc.addPage();
          this.createPermissionTable(doc, permissionRecords, 90, '#9C27B0', '#F3E5F5');
        }

        // Late Arrivals Table
        const lateRecords = data.filter(record => {
          if (record.is_absent === 'Yes' || !record.check_in_time) return false;
          const [hours, minutes] = record.check_in_time.split(':').map(Number);
          return hours > 9 || (hours === 9 && minutes > 30);
        });

        if (lateRecords.length > 0) {
          doc.addPage();
          this.createLateArrivalsTable(doc, lateRecords, 90, '#FF5722', '#FBE9E7');
        }

        // ==================== INDIVIDUAL EMPLOYEE DETAIL PAGES ====================
        if (userStatistics && userStatistics.length > 0) {
          // Add individual user detail pages
          this.createIndividualUserDetails(doc, userStatistics);
        }

        // ==================== DEPARTMENT-WISE SUMMARY ====================
        doc.addPage();

        doc.rect(30, 30, doc.page.width - 60, 40)
          .fill('#E0F7FA')
          .stroke('#00BCD4');

        doc.fillColor('#00838F')
          .fontSize(18)
          .font('Helvetica-Bold')
          .text('🏢 DEPARTMENT PERFORMANCE', 40, 45);

        if (departmentGroups && departmentGroups.length > 0) {
          this.createDepartmentSummaryTable(doc, departmentGroups, 90);
        } else {
          doc.fillColor('#666')
            .fontSize(12)
            .text('No department data available', 40, 100);
        }

        // ==================== SUMMARY AND RECOMMENDATIONS ====================
        doc.addPage();

        doc.rect(30, 30, doc.page.width - 60, 40)
          .fill('#F1F8E9')
          .stroke('#8BC34A');

        doc.fillColor('#558B2F')
          .fontSize(18)
          .font('Helvetica-Bold')
          .text('📊 FINAL SUMMARY & INSIGHTS', 40, 45);

        // Overall statistics
        const overallY = 100;
        doc.fillColor('#1a237e')
          .fontSize(14)
          .text('Overall Attendance Statistics:', 40, overallY);

        const overallStats = [
          `• Total Working Days Analyzed: ${data.length}`,
          `• Total Employees: ${userStatistics?.length || 0}`,
          `• Overall Attendance Rate: ${summary.averages?.attendanceRate || 0}%`,
          `• Average Working Hours: ${summary.averages?.averageWorkHours || 0} hours/day`,
          `• Late Arrival Rate: ${summary.timing?.lateArrivalRate || 0}%`,
          `• Manual Entries: ${summary.byEntryType?.manualEntries || 0} (${summary.byEntryType?.manualPercentage || 0}%)`,
          `• Auto Entries: ${summary.byEntryType?.autoEntries || 0}`
        ];

        doc.fillColor('#444')
          .fontSize(11);

        overallStats.forEach((stat, i) => {
          doc.text(stat, 50, overallY + 25 + i * 18);
        });

        // Employee performance highlights
        if (userStatistics && userStatistics.length > 0) {
          const topPerformer = userStatistics[0];
          const bottomPerformer = userStatistics[userStatistics.length - 1];

          const perfY = overallY + 160;
          doc.fillColor('#1a237e')
            .fontSize(14)
            .text('Employee Performance Highlights:', 40, perfY);

          doc.fillColor('#444')
            .fontSize(11)
            .text(`🏆 Top Performer: ${topPerformer.name} (${topPerformer.employee_id}) - ${topPerformer.attendance_rate}% attendance, ${topPerformer.average_work_hours}h avg`,
              50, perfY + 25);

          doc.text(`📉 Needs Attention: ${bottomPerformer.name} (${bottomPerformer.employee_id}) - ${bottomPerformer.attendance_rate}% attendance`,
            50, perfY + 45);
        }

        // Recommendations box
        const recY = overallY + 220;
        doc.rect(40, recY, doc.page.width - 80, 120)
          .fill('#FFF8E1')
          .stroke('#FFC107');

        doc.fillColor('#FF8F00')
          .fontSize(14)
          .font('Helvetica-Bold')
          .text('📋 RECOMMENDATIONS', 50, recY + 15);

        const recommendations = [
          '1. Address high absenteeism through counseling sessions',
          '2. Implement flexible working hours for departments with late arrivals',
          '3. Recognize departments with >90% attendance rate',
          '4. Automate attendance tracking for accuracy',
          '5. Regular review of permission patterns',
          '6. Address individual performance gaps identified in employee statistics'
        ];

        doc.fillColor('#5D4037')
          .fontSize(10);

        recommendations.forEach((rec, i) => {
          doc.text(rec, 55, recY + 40 + i * 16);
        });

        // Footer on all pages
        const totalPages = doc.bufferedPageRange().count;
        for (let i = 0; i < totalPages; i++) {
          doc.switchToPage(i);

          // Page number
          doc.fillColor('#78909c')
            .fontSize(8)
            .text(
              `Page ${i + 1} of ${totalPages}`,
              30,
              doc.page.height - 20
            );

          // Report title
          doc.text(
            'ATTENDANCE ANALYSIS REPORT WITH EMPLOYEE STATISTICS',
            doc.page.width / 2 - 90,
            doc.page.height - 20
          );

          // Confidential
          doc.text(
            'CONFIDENTIAL',
            doc.page.width - 80,
            doc.page.height - 20
          );
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  // Add this method for creating user statistics table
  private createUserStatisticsTable(doc: any, userStats: any[], startY: number) {
    console.log('Creating user statistics table...');

    const headers = [
      'Employee',
      'ID',
      'Present',
      'Absent',
      'Half Days',
      'Permission',
      'Attendance %',
      'Avg Hours'
    ];

    const colWidths = [70, 60, 40, 40, 50, 50, 50, 50];
    const headerX = 30;
    const headerY = startY;

    // Table header with background
    doc.rect(headerX, headerY, colWidths.reduce((a, b) => a + b), 25)
      .fill('#03A9F4' + '40')
      .stroke('#03A9F4');

    doc.fillColor('#fff')
      .fontSize(9)
      .font('Helvetica-Bold');

    headers.forEach((header, i) => {
      doc.text(header,
        headerX + colWidths.slice(0, i).reduce((a, b) => a + b, 0) + 5,
        headerY + 8,
        { width: colWidths[i] - 10 }
      );
    });

    // Table data
    let tableY = headerY + 30;
    doc.fillColor('#263238')
      .fontSize(8);

    userStats.slice(0, 30).forEach((user, rowIndex) => {
      if (tableY > doc.page.height - 50) {
        doc.addPage();
        tableY = 50;
        // Redraw header on new page
        doc.rect(headerX, tableY - 20, colWidths.reduce((a, b) => a + b), 25)
          .fill('#03A9F4' + '40')
          .stroke('#03A9F4');

        doc.fillColor('#fff')
          .fontSize(9)
          .font('Helvetica-Bold');

        headers.forEach((header, i) => {
          doc.text(header,
            headerX + colWidths.slice(0, i).reduce((a, b) => a + b, 0) + 5,
            tableY - 12,
            { width: colWidths[i] - 10 }
          );
        });

        tableY += 10;
      }

      // Alternate row colors
      if (rowIndex % 2 === 0) {
        doc.rect(headerX, tableY - 5, colWidths.reduce((a, b) => a + b), 20)
          .fill('#E1F5FE');
      } else {
        doc.rect(headerX, tableY - 5, colWidths.reduce((a, b) => a + b), 20)
          .fill('#FFFFFF');
      }

      // Highlight top performers (attendance > 90%)
      const attendanceRate = parseFloat(user.attendance_rate);
      if (attendanceRate >= 90) {
        doc.rect(headerX, tableY - 5, colWidths.reduce((a, b) => a + b), 20)
          .stroke('#4CAF50')
          .lineWidth(1);
      }

      // Highlight poor performers (attendance < 60%)
      if (attendanceRate < 60) {
        doc.rect(headerX, tableY - 5, colWidths.reduce((a, b) => a + b), 20)
          .stroke('#F44336')
          .lineWidth(1);
      }

      const rowData = [
        user.name.length > 15 ? user.name.substring(0, 12) + '...' : user.name,
        user.employee_id || 'N/A',
        user.present_days.toString(),
        user.absent_days.toString(),
        `${user.total_half_days} (${user.half_day_morning}M/${user.half_day_afternoon}A)`,
        user.permission_days.toString(),
        `${attendanceRate}%`,
        user.average_work_hours + 'h'
      ];

      rowData.forEach((cell, i) => {
        const cellX = headerX + colWidths.slice(0, i).reduce((a, b) => a + b, 0) + 5;
        const cellWidth = colWidths[i] - 10;

        // Color code based on performance
        if (i === 6) { // Attendance rate column
          let cellColor = '#4CAF50'; // Green for good
          if (attendanceRate < 60) {
            cellColor = '#F44336'; // Red for poor
          } else if (attendanceRate < 80) {
            cellColor = '#FF9800'; // Orange for average
          }

          doc.fillColor(cellColor)
            .font('Helvetica-Bold');
        } else if (i === 7) { // Average hours column
          const avgHours = parseFloat(user.average_work_hours);
          let cellColor = '#4CAF50';
          if (avgHours < 6) {
            cellColor = '#F44336';
          } else if (avgHours < 7) {
            cellColor = '#FF9800';
          }

          doc.fillColor(cellColor)
            .font('Helvetica-Bold');
        } else {
          doc.fillColor('#263238');
        }

        doc.text(cell.toString(), cellX, tableY, { width: cellWidth });
      });

      tableY += 20;
    });

    // Add detailed user breakdown section
    if (userStats.length > 0) {
      const detailsY = tableY + 20;
      doc.fillColor('#37474F')
        .fontSize(10)
        .font('Helvetica-Bold')
        .text('📋 DETAILED USER BREAKDOWN', 40, detailsY);

      let detailY = detailsY + 20;
      doc.fontSize(8)
        .font('Helvetica');

      // Show top 5 and bottom 5 performers
      const topPerformers = userStats.slice(0, 5);
      const bottomPerformers = userStats.slice(-5).reverse();

      // Top Performers
      doc.fillColor('#2E7D32')
        .text('Top 5 Performers:', 40, detailY);

      detailY += 15;
      doc.fillColor('#37474F');
      topPerformers.forEach((user, index) => {
        doc.text(`${index + 1}. ${user.name} (${user.employee_id}): ${user.attendance_rate}% attendance, ${user.average_work_hours}h avg`,
          50, detailY);
        detailY += 12;
      });

      detailY += 10;

      // Bottom Performers
      doc.fillColor('#C62828')
        .text('Needs Improvement (Bottom 5):', 40, detailY);

      detailY += 15;
      doc.fillColor('#37474F');
      bottomPerformers.forEach((user, index) => {
        const absenceInfo = user.absence_reasons_count !== 'None'
          ? `, Absences: ${user.absent_days} (${user.top_absence_reason})`
          : '';
        doc.text(`${index + 1}. ${user.name} (${user.employee_id}): ${user.attendance_rate}% attendance${absenceInfo}`,
          50, detailY);
        detailY += 12;
      });
    }
  }

  // Add this method for creating individual user detail pages
  private createIndividualUserDetails(doc: any, userStats: any[]) {
    console.log('Creating individual user detail pages...');

    // Sort by employee ID for consistency
    const sortedUsers = [...userStats].sort((a, b) =>
      (a.employee_id || '').localeCompare(b.employee_id || '')
    );

    sortedUsers.forEach((user, userIndex) => {
      if (userIndex > 0) {
        doc.addPage();
      }

      // User header
      doc.rect(30, 30, doc.page.width - 60, 50)
        .fill('#F3E5F5')
        .stroke('#9C27B0');

      doc.fillColor('#4A148C')
        .fontSize(16)
        .font('Helvetica-Bold')
        .text(`EMPLOYEE DETAILED REPORT`, 40, 45);

      doc.fontSize(12)
        .text(`${user.name} (${user.employee_id})`, 40, 70);

      doc.fontSize(10)
        .fillColor('#6A1B9A')
        .text(`${user.designation} | ${user.department}`, 40, 90);

      let contentY = 120;

      // Key Statistics
      const stats = [
        { label: 'Total Days Tracked', value: user.total_days, color: '#2196F3' },
        { label: 'Present Days', value: user.present_days, color: '#4CAF50' },
        { label: 'Absent Days', value: user.absent_days, color: '#F44336' },
        { label: 'Half Days', value: user.total_half_days, color: '#FF9800' },
        { label: 'Permission Days', value: user.permission_days, color: '#9C27B0' },
        { label: 'Attendance Rate', value: `${user.attendance_rate}%`, color: '#009688' },
        { label: 'Avg Work Hours/Day', value: `${user.average_work_hours}h`, color: '#3F51B5' },
        { label: 'Late Arrivals', value: user.late_arrivals, color: '#FF5722' }
      ];

      // Create stats boxes
      let statX = 40;
      stats.forEach((stat, index) => {
        if (index > 0 && index % 3 === 0) {
          contentY += 70;
          statX = 40;
        }

        // Stat box
        doc.rect(statX, contentY, 150, 60)
          .fill(stat.color + '20')
          .stroke(stat.color);

        // Label
        doc.fillColor('#37474F')
          .fontSize(9)
          .text(stat.label, statX + 10, contentY + 10, { width: 130 });

        // Value
        doc.fillColor(stat.color)
          .fontSize(16)
          .font('Helvetica-Bold')
          .text(stat.value, statX + 10, contentY + 25, { width: 130 });

        statX += 160;
      });

      contentY += 80;

      // Detailed breakdown section
      doc.fillColor('#37474F')
        .fontSize(12)
        .font('Helvetica-Bold')
        .text('📊 Detailed Breakdown', 40, contentY);

      contentY += 20;

      // Half Day Details
      if (user.total_half_days > 0) {
        doc.fillColor('#37474F')
          .fontSize(10)
          .text('Half Day Distribution:', 50, contentY);

        contentY += 15;
        doc.fillColor('#666')
          .fontSize(9)
          .text(`• Morning Half Days: ${user.half_day_morning}`, 60, contentY);
        contentY += 12;
        doc.text(`• Afternoon Half Days: ${user.half_day_afternoon}`, 60, contentY);
        contentY += 20;
      }

      // Absence Reasons
      if (user.absent_days > 0) {
        doc.fillColor('#37474F')
          .fontSize(10)
          .text('Absence Reasons:', 50, contentY);

        contentY += 15;
        if (user.absence_reasons && user.absence_reasons.length > 0) {
          user.absence_reasons.forEach(([reason, count]: [string, number]) => {
            doc.fillColor('#D32F2F')
              .fontSize(9)
              .text(`• ${reason}: ${count} day${count > 1 ? 's' : ''}`, 60, contentY);
            contentY += 12;
          });
        } else {
          doc.fillColor('#666')
            .fontSize(9)
            .text('• No specific reasons recorded', 60, contentY);
          contentY += 12;
        }
        contentY += 10;
      }

      // Permission Reasons
      if (user.permission_days > 0) {
        doc.fillColor('#37474F')
          .fontSize(10)
          .text('Permission Reasons:', 50, contentY);

        contentY += 15;
        if (user.permission_reasons && user.permission_reasons.length > 0) {
          user.permission_reasons.forEach(([reason, count]: [string, number]) => {
            doc.fillColor('#7B1FA2')
              .fontSize(9)
              .text(`• ${reason}: ${count} day${count > 1 ? 's' : ''}`, 60, contentY);
            contentY += 12;
          });
        } else {
          doc.fillColor('#666')
            .fontSize(9)
            .text('• No specific reasons recorded', 60, contentY);
          contentY += 12;
        }
        contentY += 10;
      }

      // Performance Assessment
      contentY += 10;
      doc.fillColor('#37474F')
        .fontSize(12)
        .font('Helvetica-Bold')
        .text('📈 Performance Assessment', 40, contentY);

      contentY += 20;
      doc.fillColor('#263238')
        .fontSize(10);

      const attendanceRate = parseFloat(user.attendance_rate);
      let assessment = '';
      let assessmentColor = '#4CAF50';

      if (attendanceRate >= 90) {
        assessment = 'Excellent: Consistently high attendance and reliability.';
        assessmentColor = '#4CAF50';
      } else if (attendanceRate >= 80) {
        assessment = 'Good: Regular attendance with minor exceptions.';
        assessmentColor = '#2196F3';
      } else if (attendanceRate >= 70) {
        assessment = 'Average: Moderate attendance record.';
        assessmentColor = '#FF9800';
      } else {
        assessment = 'Needs Improvement: Attendance patterns require attention.';
        assessmentColor = '#F44336';
      }

      doc.fillColor(assessmentColor)
        .text(assessment, 50, contentY, { width: doc.page.width - 100 });
    });
  }

  // Update the PDF generation methods to accept new parameters
  private async createSummaryPDF(
    data: any[],
    summary: any,
    metadata: any,
    departmentGroups?: any,
    includeCharts?: boolean
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        const buffers: Buffer[] = [];

        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        // Header
        doc.fontSize(20).text('ATTENDANCE SUMMARY REPORT', { align: 'center' });
        doc.moveDown(0.5);

        // Report info
        doc.fontSize(10)
          .text(`Generated: ${metadata.generatedAt}`, { align: 'center' })
          .text(`Filters: ${JSON.stringify(metadata.filters, null, 2)}`, { align: 'center' });
        doc.moveDown();

        // Summary statistics
        doc.fontSize(16).text('SUMMARY STATISTICS', { underline: true });
        doc.moveDown(0.5);

        doc.fontSize(12).text(`Total Records: ${summary.totalRecords}`);
        doc.fontSize(12).text(`Present: ${summary.byStatus.present} (${summary.percentages.presentRate}%)`);
        doc.fontSize(12).text(`Absent: ${summary.byStatus.absent} (${summary.percentages.absentRate}%)`);
        doc.fontSize(12).text(`Attendance Rate: ${summary.averages.attendanceRate}%`);
        doc.fontSize(12).text(`Late Arrivals: ${summary.timing.lateArrivals}`);
        doc.fontSize(12).text(`Early Departures: ${summary.timing.earlyDepartures}`);
        doc.moveDown();

        // Department groups if available
        if (departmentGroups && departmentGroups.length > 0) {
          doc.fontSize(16).text('DEPARTMENT-WISE SUMMARY', { underline: true });
          doc.moveDown(0.5);

          departmentGroups.forEach((dept: any, index: number) => {
            doc.fontSize(12)
              .text(`${index + 1}. ${dept.department} (${dept.recordCount} records, ${dept.employees} employees)`);
          });
          doc.moveDown();
        }

        // Footer
        doc.fontSize(8)
          .text(`Page 1 of 1`, { align: 'center' })
          .text(`© Attendance Management System`, { align: 'center' });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }



  // ==================== HELPER METHODS FOR TABLES ====================

  // Generic table creation for Present/Absent
  private createStatusTable(doc: any, records: any[], statusType: string, startY: number,
    borderColor: string, rowColor: string) {
    if (records.length === 0) {
      doc.fillColor('#666')
        .fontSize(12)
        .text(`No ${statusType.toLowerCase()} records found`, 40, startY);
      return;
    }

    const headers = ['Date', 'Employee ID', 'Name', 'Department', 'Check In', 'Check Out', 'Total Hours'];
    const colWidths = [60, 70, 80, 70, 60, 60, 50];
    const headerX = 30;
    const headerY = startY;

    // Table header with background
    doc.rect(headerX, headerY, colWidths.reduce((a, b) => a + b), 25)
      .fill(borderColor + '40') // Light version of border color
      .stroke(borderColor);

    doc.fillColor('#fff')
      .fontSize(10)
      .font('Helvetica-Bold');

    headers.forEach((header, i) => {
      doc.text(header,
        headerX + colWidths.slice(0, i).reduce((a, b) => a + b, 0) + 5,
        headerY + 8,
        { width: colWidths[i] - 10 }
      );
    });

    // Table data
    let tableY = headerY + 30;
    doc.fillColor('#263238')
      .fontSize(9);

    records.slice(0, 20).forEach((record, rowIndex) => {
      if (tableY > doc.page.height - 50) {
        doc.addPage();
        tableY = 50;
      }

      // Alternate row colors with highlight for current row
      if (rowIndex % 2 === 0) {
        doc.rect(headerX, tableY - 5, colWidths.reduce((a, b) => a + b), 20)
          .fill(rowColor);
      } else {
        doc.rect(headerX, tableY - 5, colWidths.reduce((a, b) => a + b), 20)
          .fill('#FFFFFF');
      }

      // Highlight border for important rows
      if (statusType === 'Absent' && record.absence_reason?.toLowerCase().includes('emergency')) {
        doc.rect(headerX, tableY - 5, colWidths.reduce((a, b) => a + b), 20)
          .stroke('#FF5722');
      }

      const rowData = [
        record.date,
        record.users?.employee_id || 'N/A',
        record.users?.name?.substring(0, 20) + (record.users?.name?.length > 20 ? '...' : '') || 'Unknown',
        record.users?.department?.substring(0, 15) + (record.users?.department?.length > 15 ? '...' : '') || 'N/A',
        this.toIST(record.check_in) || '--:--',
        this.toIST(record.check_out) || '--:--',
        record.total_time_minutes ? `${(record.total_time_minutes / 60).toFixed(1)}h` : '--'
      ];

      rowData.forEach((cell, i) => {
        const cellX = headerX + colWidths.slice(0, i).reduce((a, b) => a + b, 0) + 5;
        const cellWidth = colWidths[i] - 10;

        // Special formatting for absent reasons
        if (statusType === 'Absent' && i === 2 && record.absence_reason) {
          doc.fillColor('#D32F2F')
            .font('Helvetica-Bold');
          doc.text(cell + ' *', cellX, tableY, { width: cellWidth });
          doc.fillColor('#263238')
            .font('Helvetica');
        } else {
          doc.fillColor('#263238');
          doc.text(cell.toString(), cellX, tableY, { width: cellWidth });
        }
      });

      tableY += 20;
    });

    // Add absent reason notes if any
    if (statusType === 'Absent') {
      const absentWithReasons = records.filter(r => r.absence_reason);
      if (absentWithReasons.length > 0) {
        doc.fillColor('#D32F2F')
          .fontSize(8)
          .text('* Includes employees with recorded absence reasons',
            headerX, tableY + 10);
      }
    }
  }

  // Special table for Half Day
  private createHalfDayTable(doc: any, records: any[], startY: number,
    borderColor: string, rowColor: string) {
    if (records.length === 0) {
      doc.fillColor('#666')
        .fontSize(12)
        .text('No half day records found', 40, startY);
      return;
    }

    const headers = ['Date', 'Employee', 'Half Day Type', 'Start Time', 'End Time', 'Duration', 'Notes'];
    const colWidths = [60, 80, 50, 50, 50, 40, 70];
    const headerX = 30;
    const headerY = startY;

    // Table header
    doc.rect(headerX, headerY, colWidths.reduce((a, b) => a + b), 25)
      .fill(borderColor + '40')
      .stroke(borderColor);

    doc.fillColor('#fff')
      .fontSize(10)
      .font('Helvetica-Bold');

    headers.forEach((header, i) => {
      doc.text(header,
        headerX + colWidths.slice(0, i).reduce((a, b) => a + b, 0) + 5,
        headerY + 8,
        { width: colWidths[i] - 10 }
      );
    });

    // Table data
    let tableY = headerY + 30;
    doc.fillColor('#263238')
      .fontSize(9);

    records.slice(0, 20).forEach((record, rowIndex) => {
      if (tableY > doc.page.height - 50) {
        doc.addPage();
        tableY = 50;
      }

      // Color based on half day type
      const typeColor = record.half_day_type === 'morning' ? '#FF9800' : '#FF5722';
      const rowBgColor = rowIndex % 2 === 0 ? rowColor : '#FFFFFF';

      doc.rect(headerX, tableY - 5, colWidths.reduce((a, b) => a + b), 20)
        .fill(rowBgColor);

      const rowData = [
        record.date,
        record.users?.name?.substring(0, 18) + (record.users?.name?.length > 18 ? '...' : '') || 'Unknown',
        record.half_day_type?.toUpperCase() || 'N/A',
        this.toIST(record.check_in) || '--:--',
        this.toIST(record.check_out) || '--:--',
        record.total_time_minutes ? `${(record.total_time_minutes / 60).toFixed(1)}h` : '--',
        record.notes?.substring(0, 25) + (record.notes?.length > 25 ? '...' : '') || '-'
      ];

      rowData.forEach((cell, i) => {
        const cellX = headerX + colWidths.slice(0, i).reduce((a, b) => a + b, 0) + 5;
        const cellWidth = colWidths[i] - 10;

        // Highlight half day type
        if (i === 2) {
          doc.fillColor(typeColor)
            .font('Helvetica-Bold');
        } else {
          doc.fillColor('#263238');
        }

        doc.text(cell.toString(), cellX, tableY, { width: cellWidth });
      });

      tableY += 20;
    });
  }

  // Special table for Permission
  private createPermissionTable(doc: any, records: any[], startY: number,
    borderColor: string, rowColor: string) {
    if (records.length === 0) {
      doc.fillColor('#666')
        .fontSize(12)
        .text('No permission records found', 40, startY);
      return;
    }

    const headers = ['Date', 'Employee', 'Permission Time', 'Duration', 'Reason', 'Deduction', 'Status'];
    const colWidths = [60, 80, 60, 40, 80, 50, 40];
    const headerX = 30;
    const headerY = startY;

    // Table header
    doc.rect(headerX, headerY, colWidths.reduce((a, b) => a + b), 25)
      .fill(borderColor + '40')
      .stroke(borderColor);

    doc.fillColor('#fff')
      .fontSize(10)
      .font('Helvetica-Bold');

    headers.forEach((header, i) => {
      doc.text(header,
        headerX + colWidths.slice(0, i).reduce((a, b) => a + b, 0) + 5,
        headerY + 8,
        { width: colWidths[i] - 10 }
      );
    });

    // Table data
    let tableY = headerY + 30;
    doc.fillColor('#263238')
      .fontSize(9);

    records.slice(0, 20).forEach((record, rowIndex) => {
      if (tableY > doc.page.height - 50) {
        doc.addPage();
        tableY = 50;
      }

      const rowBgColor = rowIndex % 2 === 0 ? rowColor : '#FFFFFF';
      const deduction = record.permission_duration_minutes || 0;
      const deductionHours = (deduction / 60).toFixed(1);

      doc.rect(headerX, tableY - 5, colWidths.reduce((a, b) => a + b), 20)
        .fill(rowBgColor);

      const rowData = [
        record.date,
        record.users?.name?.substring(0, 18) + (record.users?.name?.length > 18 ? '...' : '') || 'Unknown',
        record.permission_time || '--:--',
        `${deductionHours}h`,
        record.permission_reason?.substring(0, 30) + (record.permission_reason?.length > 30 ? '...' : '') || '-',
        deduction > 120 ? 'High' : deduction > 60 ? 'Medium' : 'Low',
        'Applied'
      ];

      rowData.forEach((cell, i) => {
        const cellX = headerX + colWidths.slice(0, i).reduce((a, b) => a + b, 0) + 5;
        const cellWidth = colWidths[i] - 10;

        // Color code deduction level
        if (i === 5) {
          const deductionColor = cell === 'High' ? '#F44336' :
            cell === 'Medium' ? '#FF9800' : '#4CAF50';
          doc.fillColor(deductionColor)
            .font('Helvetica-Bold');
        } else if (i === 6) {
          doc.fillColor('#4CAF50')
            .font('Helvetica-Bold');
        } else {
          doc.fillColor('#263238');
        }

        doc.text(cell.toString(), cellX, tableY, { width: cellWidth });
      });

      tableY += 20;
    });
  }

  // Special table for Late Arrivals
  private createLateArrivalsTable(doc: any, records: any[], startY: number,
    borderColor: string, rowColor: string) {
    if (records.length === 0) {
      doc.fillColor('#666')
        .fontSize(12)
        .text('No late arrival records found', 40, startY);
      return;
    }

    const headers = ['Date', 'Employee', 'Check In Time', 'Late By', 'Department', 'Status', 'Pattern'];
    const colWidths = [60, 80, 60, 40, 60, 50, 40];
    const headerX = 30;
    const headerY = startY;

    // Table header
    doc.rect(headerX, headerY, colWidths.reduce((a, b) => a + b), 25)
      .fill(borderColor + '40')
      .stroke(borderColor);

    doc.fillColor('#fff')
      .fontSize(10)
      .font('Helvetica-Bold');

    headers.forEach((header, i) => {
      doc.text(header,
        headerX + colWidths.slice(0, i).reduce((a, b) => a + b, 0) + 5,
        headerY + 8,
        { width: colWidths[i] - 10 }
      );
    });

    // Table data
    let tableY = headerY + 30;
    doc.fillColor('#263238')
      .fontSize(9);

    records.slice(0, 20).forEach((record, rowIndex) => {
      if (tableY > doc.page.height - 50) {
        doc.addPage();
        tableY = 50;
      }

      const checkInTime = new Date(record.check_in);
      const lateByMinutes = (checkInTime.getHours() - 9) * 60 + (checkInTime.getMinutes() - 30);
      const lateBy = lateByMinutes > 0 ? `${lateByMinutes}m` : '0m';

      const rowBgColor = rowIndex % 2 === 0 ? rowColor : '#FFFFFF';

      doc.rect(headerX, tableY - 5, colWidths.reduce((a, b) => a + b), 20)
        .fill(rowBgColor);

      // Highlight severe lateness (>60 minutes)
      if (lateByMinutes > 60) {
        doc.rect(headerX, tableY - 5, colWidths.reduce((a, b) => a + b), 20)
          .stroke('#D84315');
      }

      const rowData = [
        record.date,
        record.users?.name?.substring(0, 18) + (record.users?.name?.length > 18 ? '...' : '') || 'Unknown',
        this.toIST(record.check_in) || '--:--',
        lateBy,
        record.users?.department?.substring(0, 15) + (record.users?.department?.length > 15 ? '...' : '') || 'N/A',
        this.getStatus(record),
        lateByMinutes > 60 ? 'Severe' : lateByMinutes > 30 ? 'Moderate' : 'Minor'
      ];

      rowData.forEach((cell, i) => {
        const cellX = headerX + colWidths.slice(0, i).reduce((a, b) => a + b, 0) + 5;
        const cellWidth = colWidths[i] - 10;

        // Color code based on lateness
        if (i === 3 || i === 6) {
          let cellColor = '#4CAF50';
          if (cell === 'Severe' || parseInt(cell) > 60) cellColor = '#F44336';
          else if (cell === 'Moderate' || (parseInt(cell) > 30 && parseInt(cell) <= 60)) cellColor = '#FF9800';

          doc.fillColor(cellColor)
            .font('Helvetica-Bold');
        } else {
          doc.fillColor('#263238');
        }

        doc.text(cell.toString(), cellX, tableY, { width: cellWidth });
      });

      tableY += 20;
    });
  }

  // Special table for Checked In (Not Checked Out)
  private createCheckedInTable(doc: any, records: any[], startY: number,
    borderColor: string, rowColor: string) {
    if (records.length === 0) return;

    const headers = ['Date', 'Employee', 'Check In Time', 'Current Status', 'Department', 'Hours Since', 'Action'];
    const colWidths = [60, 80, 60, 60, 60, 50, 40];
    const headerX = 30;
    const headerY = startY;

    // Table header
    doc.rect(headerX, headerY, colWidths.reduce((a, b) => a + b), 25)
      .fill(borderColor + '40')
      .stroke(borderColor);

    doc.fillColor('#fff')
      .fontSize(10)
      .font('Helvetica-Bold');

    headers.forEach((header, i) => {
      doc.text(header,
        headerX + colWidths.slice(0, i).reduce((a, b) => a + b, 0) + 5,
        headerY + 8,
        { width: colWidths[i] - 10 }
      );
    });

    // Table data
    let tableY = headerY + 30;
    doc.fillColor('#263238')
      .fontSize(9);

    records.slice(0, 15).forEach((record, rowIndex) => {
      if (tableY > doc.page.height - 50) {
        doc.addPage();
        tableY = 50;
      }

      const checkInTime = new Date(record.check_in);
      const now = new Date();
      const hoursSince = Math.floor((now.getTime() - checkInTime.getTime()) / (1000 * 60 * 60));

      const rowBgColor = rowIndex % 2 === 0 ? rowColor : '#FFFFFF';

      doc.rect(headerX, tableY - 5, colWidths.reduce((a, b) => a + b), 20)
        .fill(rowBgColor);

      // Highlight if checked in for more than 10 hours
      if (hoursSince > 10) {
        doc.rect(headerX, tableY - 5, colWidths.reduce((a, b) => a + b), 20)
          .stroke('#D84315');
      }

      const rowData = [
        record.date,
        record.users?.name?.substring(0, 18) + (record.users?.name?.length > 18 ? '...' : '') || 'Unknown',
        this.toIST(record.check_in) || '--:--',
        'Active',
        record.users?.department?.substring(0, 15) + (record.users?.department?.length > 15 ? '...' : '') || 'N/A',
        `${hoursSince}h`,
        hoursSince > 10 ? 'Follow Up' : 'Monitor'
      ];

      rowData.forEach((cell, i) => {
        const cellX = headerX + colWidths.slice(0, i).reduce((a, b) => a + b, 0) + 5;
        const cellWidth = colWidths[i] - 10;

        // Color code hours since
        if (i === 5 || i === 6) {
          let cellColor = '#4CAF50';
          if (cell === 'Follow Up' || parseInt(cell) > 10) cellColor = '#F44336';
          else if (parseInt(cell) > 8) cellColor = '#FF9800';

          doc.fillColor(cellColor)
            .font('Helvetica-Bold');
        } else if (i === 3) {
          doc.fillColor('#2196F3')
            .font('Helvetica-Bold');
        } else {
          doc.fillColor('#263238');
        }

        doc.text(cell.toString(), cellX, tableY, { width: cellWidth });
      });

      tableY += 20;
    });
  }

  // Department Summary Table
  private createDepartmentSummaryTable(doc: any, departmentGroups: any[], startY: number) {
    const headers = ['Department', 'Employees', 'Records', 'Present', 'Absent', 'Rate', 'Performance'];
    const colWidths = [80, 50, 50, 50, 50, 50, 60];
    const headerX = 30;
    const headerY = startY;

    // Table header
    doc.rect(headerX, headerY, colWidths.reduce((a, b) => a + b), 25)
      .fill('#00BCD4' + '40')
      .stroke('#00BCD4');

    doc.fillColor('#fff')
      .fontSize(10)
      .font('Helvetica-Bold');

    headers.forEach((header, i) => {
      doc.text(header,
        headerX + colWidths.slice(0, i).reduce((a, b) => a + b, 0) + 5,
        headerY + 8,
        { width: colWidths[i] - 10 }
      );
    });

    // Table data
    let tableY = headerY + 30;
    doc.fillColor('#263238')
      .fontSize(9);

    departmentGroups.slice(0, 15).forEach((dept: any, rowIndex) => {
      if (tableY > doc.page.height - 50) {
        doc.addPage();
        tableY = 50;
      }

      const attendanceRate = dept.summary?.averages?.attendanceRate || 0;
      let performance = 'Excellent';
      let rowColor = '#E8F5E9';

      if (attendanceRate < 60) {
        performance = 'Poor';
        rowColor = '#FFEBEE';
      } else if (attendanceRate < 80) {
        performance = 'Average';
        rowColor = '#FFF3E0';
      } else if (attendanceRate < 90) {
        performance = 'Good';
        rowColor = '#E3F2FD';
      }

      // Alternate row background
      if (rowIndex % 2 === 0) {
        doc.rect(headerX, tableY - 5, colWidths.reduce((a, b) => a + b), 20)
          .fill(rowColor);
      } else {
        doc.rect(headerX, tableY - 5, colWidths.reduce((a, b) => a + b), 20)
          .fill('#FFFFFF');
      }

      const rowData = [
        dept.department?.substring(0, 20) + (dept.department?.length > 20 ? '...' : '') || 'Unknown',
        dept.employees || 0,
        dept.recordCount || 0,
        dept.summary?.byStatus?.present || 0,
        dept.summary?.byStatus?.absent || 0,
        `${attendanceRate}%`,
        performance
      ];

      rowData.forEach((cell, i) => {
        const cellX = headerX + colWidths.slice(0, i).reduce((a, b) => a + b, 0) + 5;
        const cellWidth = colWidths[i] - 10;

        // Color code performance
        if (i === 6) {
          let cellColor = '#4CAF50';
          if (cell === 'Poor') cellColor = '#F44336';
          else if (cell === 'Average') cellColor = '#FF9800';
          else if (cell === 'Good') cellColor = '#2196F3';

          doc.fillColor(cellColor)
            .font('Helvetica-Bold');
        } else if (i === 5) {
          // Color code attendance rate
          let cellColor = '#4CAF50';
          const rate = parseInt(cell);
          if (rate < 60) cellColor = '#F44336';
          else if (rate < 80) cellColor = '#FF9800';
          else if (rate < 90) cellColor = '#2196F3';

          doc.fillColor(cellColor)
            .font('Helvetica-Bold');
        } else {
          doc.fillColor('#263238');
        }

        doc.text(cell.toString(), cellX, tableY, { width: cellWidth });
      });

      tableY += 20;
    });
  }

  // Helper method to format time for display
  private formatTimeForPDF(datetime: any): string {
    if (!datetime) return '--:--';
    try {
      const date = new Date(datetime);
      if (isNaN(date.getTime())) return '--:--';

      const hours = date.getHours();
      const minutes = date.getMinutes();
      const period = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;

      return `${displayHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} ${period}`;
    } catch {
      return '--:--';
    }
  }

  // Helper method to get employee name safely
  private getEmployeeName(record: any): string {
    if (record.users?.name) return record.users.name;
    if (record.user_info?.name) return record.user_info.name;
    return 'Unknown Employee';
  }

  // Helper method to get employee department safely
  private getEmployeeDepartment(record: any): string {
    if (record.users?.department) return record.users.department;
    if (record.user_info?.department) return record.user_info.department;
    return 'N/A';
  }

  // Helper method to get employee ID safely
  private getEmployeeId(record: any): string {
    if (record.users?.employee_id) return record.users.employee_id;
    if (record.user_info?.employee_id) return record.user_info.employee_id;
    return 'N/A';
  }

  // Helper method: Group data by week
  private groupDataByWeek(data: any[]) {
    const weeks: { [key: string]: any } = {};

    data.forEach(record => {
      const date = new Date(record.date);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay()); // Start of week (Sunday)

      const weekKey = weekStart.toISOString().slice(0, 10);

      if (!weeks[weekKey]) {
        weeks[weekKey] = {
          weekLabel: `Week ${weekStart.getDate()}/${weekStart.getMonth() + 1}`,
          days: 0,
          present: 0,
          absent: 0,
          late: 0,
          totalHours: 0,
          records: []
        };
      }

      weeks[weekKey].days++;
      if (record.is_absent) {
        weeks[weekKey].absent++;
      } else if (record.check_in && record.check_out) {
        weeks[weekKey].present++;
        weeks[weekKey].totalHours += (record.total_time_minutes || 0) / 60;
      }

      // Check for late arrival (after 9:30 AM)
      if (record.check_in) {
        const checkInTime = new Date(record.check_in);
        const hours = checkInTime.getHours();
        const minutes = checkInTime.getMinutes();
        if (hours > 9 || (hours === 9 && minutes > 30)) {
          weeks[weekKey].late++;
        }
      }
    });

    // Calculate averages
    Object.values(weeks).forEach((week: any) => {
      week.avgHours = week.present > 0 ? (week.totalHours / week.present).toFixed(1) : 0;
      week.attendanceRate = week.days > 0 ? Math.round((week.present / week.days) * 100) : 0;
    });

    return Object.values(weeks).sort((a: any, b: any) =>
      new Date(b.weekKey || 0).getTime() - new Date(a.weekKey || 0).getTime()
    );
  }

  // Helper method: Group data by employee
  private groupDataByEmployee(data: any[]) {
    const employees: { [key: string]: any } = {};

    data.forEach(record => {
      const employeeId = record.users?.employee_id || record.user_id;

      if (!employees[employeeId]) {
        employees[employeeId] = {
          name: record.users?.name || 'Unknown',
          department: record.users?.department || 'N/A',
          totalDays: 0,
          present: 0,
          absent: 0,
          late: 0,
          totalHours: 0,
          records: []
        };
      }

      employees[employeeId].totalDays++;
      if (record.is_absent) {
        employees[employeeId].absent++;
      } else if (record.check_in && record.check_out) {
        employees[employeeId].present++;
        employees[employeeId].totalHours += (record.total_time_minutes || 0) / 60;
      }

      // Check for late arrival
      if (record.check_in) {
        const checkInTime = new Date(record.check_in);
        const hours = checkInTime.getHours();
        const minutes = checkInTime.getMinutes();
        if (hours > 9 || (hours === 9 && minutes > 30)) {
          employees[employeeId].late++;
        }
      }

      employees[employeeId].records.push(record);
    });

    // Calculate averages and rates
    Object.values(employees).forEach((emp: any) => {
      emp.avgHours = emp.present > 0 ? (emp.totalHours / emp.present).toFixed(1) : 0;
      emp.attendanceRate = emp.totalDays > 0 ? Math.round((emp.present / emp.totalDays) * 100) : 0;
    });

    return employees;
  }

  // Helper method: Get best department
  private getBestDepartment(departmentGroups?: any[]): string {
    if (!departmentGroups || departmentGroups.length === 0) {
      return 'N/A';
    }

    const bestDept = departmentGroups.reduce((best, current) => {
      const bestRate = best.summary?.averages?.attendanceRate || 0;
      const currentRate = current.summary?.averages?.attendanceRate || 0;
      return currentRate > bestRate ? current : best;
    });

    return bestDept.department || 'N/A';
  }
  // Helper methods (add these to your service class)
  private parseTimeFromDateTime(dateTime: string | Date): string | null {
    if (!dateTime) return null;

    try {
      const date = new Date(dateTime);
      if (isNaN(date.getTime())) return null;

      return date.toLocaleTimeString('en-IN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return null;
    }
  }

  private isLateArrival(timeStr: string): boolean {
    if (!timeStr) return false;

    try {
      const [hours, minutes] = timeStr.split(':').map(Number);
      const totalMinutes = hours * 60 + minutes;

      // Late if after 9:30 AM (9*60 + 30 = 570 minutes)
      return totalMinutes > 570;
    } catch {
      return false;
    }
  }

  private isEarlyDeparture(timeStr: string): boolean {
    if (!timeStr) return false;

    try {
      const [hours, minutes] = timeStr.split(':').map(Number);
      const totalMinutes = hours * 60 + minutes;

      // Early if before 19:00 (19*60 = 1140 minutes)
      return totalMinutes < 1140 && totalMinutes > 0;
    } catch {
      return false;
    }
  }

  private calculateComprehensiveSummary(data: any[]) {
    const totalRecords = data.length;

    // Count by status
    const present = data.filter(r => r.status_code === 'present').length;
    const absent = data.filter(r => r.status_code === 'absent').length;
    const checkedIn = data.filter(r => r.status_code === 'checked-in').length;
    const halfDay = data.filter(r => r.status_code.includes('half-day')).length;
    const permission = data.filter(r => r.status_code === 'permission').length;

    // Count by entry type
    const manualEntries = data.filter(r => r.entry_type === 'Manual').length;
    const autoEntries = data.filter(r => r.entry_type === 'Auto').length;

    // Calculate timing statistics
    const lateArrivals = data.filter(r => r.is_late_arrival === 'Yes').length;
    const earlyDepartures = data.filter(r => r.is_early_departure === 'Yes').length;

    // Calculate average work hours
    const presentRecords = data.filter(r =>
      r.status_code === 'present' || r.status_code === 'checked-out'
    );
    const totalWorkMinutes = presentRecords.reduce((sum, r) => sum + (r.total_minutes || 0), 0);
    const averageWorkHours = presentRecords.length > 0
      ? Number((totalWorkMinutes / presentRecords.length / 60).toFixed(2))
      : 0;

    // Calculate percentages
    const attendanceRate = totalRecords > 0
      ? Number(((present + checkedIn + halfDay + permission) / totalRecords * 100).toFixed(2))
      : 0;

    const lateArrivalRate = totalRecords > 0
      ? Number((lateArrivals / totalRecords * 100).toFixed(2))
      : 0;

    const earlyDepartureRate = totalRecords > 0
      ? Number((earlyDepartures / totalRecords * 100).toFixed(2))
      : 0;

    return {
      totalRecords,
      byStatus: {
        present,
        absent,
        checkedIn,
        halfDay,
        permission,
        notCheckedIn: totalRecords - (present + absent + checkedIn + halfDay + permission),
      },
      byEntryType: {
        manualEntries,
        autoEntries,
        manualPercentage: totalRecords > 0 ? Number((manualEntries / totalRecords * 100).toFixed(2)) : 0,
      },
      timing: {
        lateArrivals,
        earlyDepartures,
        lateArrivalRate,
        earlyDepartureRate,
      },
      averages: {
        averageWorkHours,
        attendanceRate,
      },
      percentages: {
        presentRate: totalRecords > 0 ? Number((present / totalRecords * 100).toFixed(2)) : 0,
        absentRate: totalRecords > 0 ? Number((absent / totalRecords * 100).toFixed(2)) : 0,
      },
    };
  }

  private groupByDepartment(data: any[]) {
    const groups: { [key: string]: any[] } = {};

    data.forEach(record => {
      const dept = record.department || 'Unknown';
      if (!groups[dept]) {
        groups[dept] = [];
      }
      groups[dept].push(record);
    });

    // Convert to array and calculate department statistics
    const result = Object.entries(groups).map(([department, records]) => {
      const deptSummary = this.calculateComprehensiveSummary(records);

      return {
        department,
        recordCount: records.length,
        summary: deptSummary,
        employees: [...new Set(records.map(r => r.employee_id))].length,
        records: records.slice(0, 10), // Include first 10 records for preview
      };
    }).sort((a, b) => b.recordCount - a.recordCount);

    return result;
  }


  // Update the DTO interface to include new parameters
  // In your attendance.dto.ts file, update GenerateReportDto:
  /*
  export class GenerateReportDto {
    @IsOptional()
    @IsString()
    startDate?: string;
  
    @IsOptional()
    @IsString()
    endDate?: string;
  
    @IsOptional()
    @IsString()
    day?: string;
  
    @IsOptional()
    @IsString()
    month?: string;
  
    @IsOptional()
    @IsString()
    employeeId?: string;
  
    @IsOptional()
    @IsString()
    department?: string;
  
    @IsOptional()
    @IsString()
    @IsIn(['detailed', 'summary'])
    reportType?: string;
  
    @IsOptional()
    @IsString()
    name?: string;
  
    @IsOptional()
    @IsString()
    status?: string;
  
    @IsOptional()
    @IsString()
    designation?: string;
  
    @IsOptional()
    @IsBoolean()
    lateArrivalsOnly?: boolean;
  
    @IsOptional()
    @IsBoolean()
    earlyDeparturesOnly?: boolean;
  
    @IsOptional()
    @IsBoolean()
    includeSummary?: boolean;
  
    @IsOptional()
    @IsBoolean()
    groupByDepartment?: boolean;
  
    @IsOptional()
    @IsBoolean()
    includeCharts?: boolean;
  }
  */
  // Helper to create detailed PDF with better design


  // Add this helper method to your AttendanceService class



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