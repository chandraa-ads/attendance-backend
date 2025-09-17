// src/supabase/supabase.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private readonly adminClient: SupabaseClient;
  private readonly client: SupabaseClient;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.SUPABASE_ANON_KEY;

    if (!url || !serviceKey || !anonKey) {
      this.logger.error('Missing Supabase environment variables. Please check your .env file');
      throw new Error(
        'Missing Supabase environment variables. Please check your .env file',
      );
    }

    // Client with service role key for admin backend operations (bypasses RLS)
    this.adminClient = createClient(url, serviceKey, {
      // Optional: specify global fetch options or headers here if needed
      // headers: { 'x-my-custom-header': 'value' }
    });

    // Client with anon key for regular user operations (subject to RLS)
    this.client = createClient(url, anonKey);
  }

  // Get admin client - full access, bypasses RLS policies
  getAdminClient(): SupabaseClient {
    return this.adminClient;
  }

  // Get regular client - anon key, subject to RLS policies
  getClient(): SupabaseClient {
    return this.client;
  }
}
