import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(
    private reflector: Reflector,
    private readonly supabase: SupabaseService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.get<string[]>('roles', context.getHandler());
    
    // If no roles are required, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      this.logger.debug('No roles required, allowing access');
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    
    // Check if authorization header exists
    if (!authHeader) {
      this.logger.warn('No authorization header found');
      throw new UnauthorizedException('No authorization header');
    }

    // Extract token from header
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      this.logger.warn('No token found in authorization header');
      throw new UnauthorizedException('Invalid authorization header');
    }

    try {
      this.logger.debug(`Required roles: ${requiredRoles.join(', ')}`);
      
      // Step 1: Verify token with Supabase Auth
      const { data: { user }, error: authError } = await this.supabase.getClient().auth.getUser(token);
      
      if (authError || !user) {
        this.logger.error(`Supabase auth error: ${authError?.message || 'No user returned'}`);
        throw new UnauthorizedException('Invalid or expired token');
      }

      this.logger.debug(`User authenticated: ${user.email}, ID: ${user.id}`);
      
      // Step 2: Try to find user in database by email (more reliable than ID)
      let userRole: string;
      let dbUserId: string;
      
      try {
        // First try to find by email (most reliable)
        const { data: userByEmail, error: emailError } = await this.supabase.getClient()
          .from('users')
          .select('id, role, email, name')
          .eq('email', user.email)
          .single();

        if (emailError && emailError.code !== 'PGRST116') {
          this.logger.error(`Database error (email lookup): ${emailError.message}`);
        }

        if (userByEmail) {
          // User found by email
          userRole = userByEmail.role;
          dbUserId = userByEmail.id;
          this.logger.debug(`User found in database by email: ${userByEmail.email}, Role: ${userRole}`);
        } else {
          // Try to find by ID (in case emails don't match)
          const { data: userById, error: idError } = await this.supabase.getClient()
            .from('users')
            .select('id, role, email, name')
            .eq('id', user.id)
            .single();

          if (idError && idError.code !== 'PGRST116') {
            this.logger.error(`Database error (ID lookup): ${idError.message}`);
          }

          if (userById) {
            // User found by ID
            userRole = userById.role;
            dbUserId = userById.id;
            this.logger.debug(`User found in database by ID: ${userById.email}, Role: ${userRole}`);
          } else {
            // User not found in database, check JWT metadata
            this.logger.warn(`User ${user.email} not found in users table, checking JWT metadata...`);
            
            // Decode JWT to get user_metadata (no verification needed for decoding)
            try {
              const base64Payload = token.split('.')[1];
              const payload = JSON.parse(Buffer.from(base64Payload, 'base64').toString());
              
              if (payload.user_metadata?.role) {
                userRole = payload.user_metadata.role;
                dbUserId = user.id; // Use auth ID since not in database
                this.logger.debug(`Using role from JWT metadata: ${userRole}`);
              } else {
                this.logger.error('No role found in JWT metadata');
                throw new UnauthorizedException('User role not found');
              }
            } catch (jwtError) {
              this.logger.error('Failed to decode JWT:', jwtError);
              throw new UnauthorizedException('Unable to verify user role');
            }
          }
        }
      } catch (dbLookupError) {
        this.logger.error('Database lookup failed:', dbLookupError);
        throw new UnauthorizedException('Failed to verify user permissions');
      }

      // Step 3: Validate the role
      if (!userRole) {
        this.logger.error('User role is undefined');
        throw new UnauthorizedException('User role not found');
      }

      // Step 4: Check if user has required role
      const hasRequiredRole = requiredRoles.includes(userRole);
      
      this.logger.debug(`User role: ${userRole}, Has required role: ${hasRequiredRole}`);
      
      if (!hasRequiredRole) {
        this.logger.warn(`User ${user.email} with role ${userRole} does not have required role(s): ${requiredRoles.join(', ')}`);
        throw new UnauthorizedException('Insufficient permissions');
      }

      // Step 5: Attach user info to request for use in controllers
      request.user = {
        userId: dbUserId || user.id, // Use database ID if available, otherwise auth ID
        authId: user.id, // Always include auth ID
        email: user.email,
        role: userRole,
        name: user.user_metadata?.name || 'Unknown'
      };

      this.logger.debug(`Access granted to user: ${request.user.email} with role: ${request.user.role}`);
      return true;

    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error; // Re-throw auth errors
      }
      
      this.logger.error('Unexpected error in RolesGuard:', error);
      throw new UnauthorizedException('Authentication failed');
    }
  }
}