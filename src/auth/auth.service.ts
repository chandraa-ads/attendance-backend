import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateUserDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(private readonly supabase: SupabaseService) {}

  // Create user with profile image upload & password setup
async createUser(payload: CreateUserDto, file?: Express.Multer.File) {
  const supa = this.supabase.getAdminClient();
  let profileUrl: string | null = null;

  // 1. Upload profile image if file provided
  if (file) {
    const filePath = `profiles/${Date.now()}-${file.originalname}`;
    const { error: uploadErr } = await supa.storage
      .from('profiles')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadErr) throw new BadRequestException('Failed to upload profile image: ' + uploadErr.message);

    const { data: publicUrl } = supa.storage.from('profiles').getPublicUrl(filePath);
    profileUrl = publicUrl.publicUrl;
  }

  // 2. Check if user already exists by email
  const { data: existingUser, error: fetchError } = await supa.auth.admin.listUsers();
  if (fetchError) {
    throw new BadRequestException('Failed to list users: ' + fetchError.message);
  }

  const userExists = existingUser?.users.find(u => u.email === payload.email);

  if (!userExists) {
    // 3a. Create user if does not exist
    if (!payload.password) {
      throw new BadRequestException('Password is required for new user creation');
    }

    const { data: createdUser, error: createUserErr } = await supa.auth.admin.createUser({
      email: payload.email,
      password: payload.password,
      email_confirm: true,
      user_metadata: {
        name: payload.name,
        role: payload.role === 'admin' ? 'admin' : 'user',
      },
    });

    if (createUserErr) {
      throw new BadRequestException('Failed to create user: ' + createUserErr.message);
    }
  } else {
    // 3b. User exists — update password if provided
    if (payload.password) {
      const { error: updatePasswordError } = await supa.auth.admin.updateUserById(userExists.id, {
        password: payload.password,
      });

      if (updatePasswordError) {
        throw new BadRequestException('Failed to update password: ' + updatePasswordError.message);
      }
    }
  }

  // 4. Upsert user profile into users table
  const { data, error: upsertError } = await supa
    .from('users')
    .upsert(
      {
        username: payload.username,
        email: payload.email,
        name: payload.name,
        mobile: payload.mobile,
        ien: payload.ien,
        role: payload.role || 'user',
        profile_url: profileUrl,
        employee_id: payload.employee_id,
        designation: payload.designation,
      },
      { onConflict: 'email' }
    )
    .select()
    .single();

  if (upsertError) {
    throw new BadRequestException('Failed to insert or update user profile: ' + upsertError.message);
  }

  return data;
}


  // Login user with anon client, verify profile & return role
  async login(email: string, password: string) {
    const supa = this.supabase.getClient();

    // Sign in with password (anon client)
    const { data, error } = await supa.auth.signInWithPassword({ email, password });
    if (error) {
      throw new UnauthorizedException('Invalid login credentials: ' + error.message);
    }

    // Fetch user profile from users table
    const { data: profile, error: profileError } = await supa
      .from('users')
      .select('id, name, email, profile_url, role')
      .eq('email', email)
      .single();

    if (profileError) throw new UnauthorizedException('User logged in but profile not found');

    // Compose and return login result
    return {
      ...data,
      profile,
      role: data.user?.user_metadata?.role || profile.role || 'user',
      id: profile.id,
    };
  }
}
