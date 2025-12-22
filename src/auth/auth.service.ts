import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateUserDto } from './dto/auth.dto';
import { User } from '@supabase/supabase-js';
import { UpdateUserDto} from './dto/update-auth.dto';

@Injectable()
export class AuthService {
  constructor(private readonly supabase: SupabaseService) {}

  /* ================= HELPERS ================= */

  private async uploadProfile(file?: Express.Multer.File) {
    if (!file) return null;

    const supa = this.supabase.getAdminClient();
    const path = `profiles/${Date.now()}-${file.originalname}`;

    const { error } = await supa.storage
      .from('profiles')
      .upload(path, file.buffer, { contentType: file.mimetype });

    if (error) throw new BadRequestException(error.message);

    const { data } = supa.storage.from('profiles').getPublicUrl(path);
    return data.publicUrl;
  }

  private async findUserByEmployeeId(employeeId: string) {
    const supa = this.supabase.getAdminClient();

    const { data, error } = await supa
      .from('users')
      .select('email, employee_id')
      .eq('employee_id', employeeId)
      .single();

    if (error || !data) {
      throw new NotFoundException('User not found');
    }

    return data;
  }

  private async findAuthUserByEmail(email: string): Promise<User | null> {
    const supa = this.supabase.getAdminClient();

    const { data, error } = await supa.auth.admin.listUsers();

    if (error) {
      throw new BadRequestException(error.message);
    }

    const authUser = data.users.find(
      (u: User) => u.email === email,
    );

    return authUser || null;
  }

  private async checkUserExists(email: string, employeeId: string) {
    const supa = this.supabase.getAdminClient();

    // Check if user exists in users table
    const { data: existingUser, error } = await supa
      .from('users')
      .select('email, employee_id')
      .or(`email.eq.${email},employee_id.eq.${employeeId}`)
      .maybeSingle();

    if (error) {
      console.error('Error checking user existence:', error);
      return false;
    }

    return !!existingUser;
  }

  /* ================= CREATE ================= */

  async createUser(payload: CreateUserDto, file?: Express.Multer.File) {
    const supa = this.supabase.getAdminClient();
    const profileUrl = await this.uploadProfile(file);

    // Check if user already exists
    const userExists = await this.checkUserExists(payload.email, payload.employee_id);
    if (userExists) {
      throw new BadRequestException('User with this email or employee ID already exists');
    }

    // Check if auth user exists
    const existingAuthUser = await this.findAuthUserByEmail(payload.email);
    
    if (existingAuthUser) {
      throw new BadRequestException('User with this email already exists in authentication system');
    }

    // Create new auth user (for new users only)
    if (!payload.password) {
      throw new BadRequestException('Password is required for new user');
    }

    const { data: authData, error: authError } = await supa.auth.admin.createUser({
      email: payload.email,
      password: payload.password,
      email_confirm: true,
      user_metadata: {
        role: payload.role ?? 'user',
        name: payload.name,
      },
    });

    if (authError) {
      if (authError.message.includes('already registered') || 
          authError.message.includes('duplicate') ||
          authError.status === 422) {
        throw new BadRequestException('User with this email already exists');
      }
      throw new BadRequestException(`Failed to create user: ${authError.message}`);
    }

    // Create user in users table
    const { data, error } = await supa
      .from('users')
      .insert({
        employee_id: payload.employee_id,
        email: payload.email,
        username: payload.username,
        name: payload.name,
        mobile: payload.mobile,
        ien: payload.ien,
        role: payload.role ?? 'user',
        designation: payload.designation,
        profile_url: profileUrl,
      })
      .select()
      .single();

    if (error) {
      // Rollback: delete auth user if users table insert fails
      await supa.auth.admin.deleteUser(authData.user.id);
      throw new BadRequestException(error.message);
    }

    return data;
  }

  /* ================= LOGIN ================= */

  async login(email: string, password: string, expectedRole: 'admin' | 'user') {
    const supa = this.supabase.getClient();

    const { data, error } = await supa.auth.signInWithPassword({ email, password });
    if (error) throw new UnauthorizedException(error.message);

    const { data: profile } = await supa
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    const role = data.user.user_metadata?.role || profile?.role || 'user';

    if (role !== expectedRole) {
      throw new UnauthorizedException('Access denied');
    }

    return { ...data, profile, role };
  }

  /* ================= FULL UPDATE (PUT) ================= */

  async updateUserFull(
    employeeId: string,
    payload: CreateUserDto,
    file?: Express.Multer.File,
  ) {
    const supa = this.supabase.getAdminClient();

    const user = await this.findUserByEmployeeId(employeeId);
    const authUser = await this.findAuthUserByEmail(user.email);

    if (!authUser) {
      throw new NotFoundException('Authentication user not found');
    }

    const profileUrl = await this.uploadProfile(file);

    // Update auth user if password or role changed
    const updateAuthData: any = {};
    if (payload.password) {
      updateAuthData.password = payload.password;
    }
    if (payload.role) {
      updateAuthData.user_metadata = { role: payload.role };
    }

    if (Object.keys(updateAuthData).length > 0) {
      const { error: authUpdateError } = await supa.auth.admin.updateUserById(authUser.id, updateAuthData);
      if (authUpdateError) {
        throw new BadRequestException(`Failed to update auth user: ${authUpdateError.message}`);
      }
    }

    // Update user in users table
    const { data, error } = await supa
      .from('users')
      .update({
        username: payload.username,
        name: payload.name,
        mobile: payload.mobile,
        ien: payload.ien,
        role: payload.role,
        designation: payload.designation,
        profile_url: profileUrl || undefined,
      })
      .eq('employee_id', employeeId)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /* ================= PARTIAL UPDATE (PATCH) ================= */

  async updateUserPartial(
    employeeId: string,
    payload: UpdateUserDto,
    file?: Express.Multer.File,
  ) {
    const supa = this.supabase.getAdminClient();

    const user = await this.findUserByEmployeeId(employeeId);
    const authUser = await this.findAuthUserByEmail(user.email);

    if (!authUser) {
      throw new NotFoundException('Authentication user not found');
    }

    const profileUrl = await this.uploadProfile(file);

    // Update auth user if password or role changed
    const updateAuthData: any = {};
    if (payload.password) {
      updateAuthData.password = payload.password;
    }
    if (payload.role) {
      updateAuthData.user_metadata = { role: payload.role };
    }

    if (Object.keys(updateAuthData).length > 0) {
      const { error: authUpdateError } = await supa.auth.admin.updateUserById(authUser.id, updateAuthData);
      if (authUpdateError) {
        throw new BadRequestException(`Failed to update auth user: ${authUpdateError.message}`);
      }
    }

    // Update user in users table
    const updateData: any = { ...payload };
    delete updateData.password;

    if (profileUrl) updateData.profile_url = profileUrl;

    const { data, error } = await supa
      .from('users')
      .update(updateData)
      .eq('employee_id', employeeId)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /* ================= DELETE ================= */

  async deleteUser(employeeId: string) {
    const supa = this.supabase.getAdminClient();

    const user = await this.findUserByEmployeeId(employeeId);
    const authUser = await this.findAuthUserByEmail(user.email);

    if (!authUser) {
      throw new NotFoundException('Authentication user not found');
    }

    // Delete auth user first
    const { error: authDeleteError } = await supa.auth.admin.deleteUser(authUser.id);
    if (authDeleteError) {
      throw new BadRequestException(`Failed to delete auth user: ${authDeleteError.message}`);
    }

    // Delete user from users table
    const { error } = await supa.from('users').delete().eq('employee_id', employeeId);
    if (error) {
      throw new BadRequestException(error.message);
    }

    return { message: 'User deleted successfully' };
  }

  /* ================= GET ALL USERS ================= */

  async getUsers() {
    const supa = this.supabase.getAdminClient();
    
    const { data, error } = await supa
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /* ================= GET USER BY ID ================= */
  
  async getUserById(employeeId: string) {
    const supa = this.supabase.getAdminClient();
    
    const { data, error } = await supa
      .from('users')
      .select('*')
      .eq('employee_id', employeeId)
      .single();
    
    if (error) throw new NotFoundException('User not found');
    return data;
  }
}