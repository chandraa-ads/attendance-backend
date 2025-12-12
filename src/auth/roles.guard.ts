import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private readonly supabase: SupabaseService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.get<string[]>('roles', context.getHandler());
    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    
    if (!authHeader) {
      return false;
    }

    try {
      const token = authHeader.replace('Bearer ', '');
      const supa = this.supabase.getClient();
      
      const { data: { user }, error } = await supa.auth.getUser(token);
      
      if (error || !user) {
        return false;
      }

      // Get user role from database
      const { data: userData } = await supa
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single();

      return requiredRoles.includes(userData?.role);
    } catch (err) {
      return false;
    }
  }
}