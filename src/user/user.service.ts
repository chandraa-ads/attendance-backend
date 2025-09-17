import { Injectable, BadRequestException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { Express } from 'express';

@Injectable()
export class UserService {
  constructor(private readonly supabase: SupabaseService) {}

  async uploadProfile(userId: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');

    const supa = this.supabase.getAdminClient(); // ✅ use admin client
    const bucket = process.env.PROFILE_BUCKET || 'profiles';
    const path = `${userId}/${Date.now()}_${file.originalname}`;

    const { error: uploadErr } = await supa.storage
      .from(bucket)
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: true });
    if (uploadErr) throw uploadErr;

    const { data: publicData } = supa.storage.from(bucket).getPublicUrl(path);
    const publicUrl = publicData.publicUrl;

    const { error: dbErr } = await supa
      .from('users') // ✅ correct table
      .update({ profile_url: publicUrl })
      .eq('id', userId);
    if (dbErr) throw dbErr;

    return { profileUrl: publicUrl };
  }

  async getUser(userId: string) {
    if (!userId) throw new BadRequestException('userId is required');

    const supa = this.supabase.getAdminClient(); // ✅ use admin client
    try {
      const { data, error } = await supa
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new NotFoundException(`User with id ${userId} not found`);

      return data;
    } catch (err) {
      console.error('Error fetching user:', err);
      throw new InternalServerErrorException('Failed to fetch user');
    }
  }

  async listUsers(role?: string, name?: string, employeeId?: string) {
    const supa = this.supabase.getAdminClient(); // ✅ use admin client
    let q = supa.from('users').select('*');

    if (role?.trim()) q = q.eq('role', role.trim());
    if (name?.trim()) q = q.ilike('name', `%${name.trim()}%`);
    if (employeeId?.trim()) q = q.ilike('employee_id', `%${employeeId.trim()}%`);

    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) throw error;

    return data;
  }
}
