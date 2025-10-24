/**
 * Enhanced Supabase Client Configuration
 * 
 * Features:
 * - Full session persistence with localStorage
 * - Automatic token refresh
 * - URL-based session detection (OAuth callbacks)
 * - Enhanced error handling
 * - Session monitoring with retry logic
 * - OAuth provider support
 * - Password reset functionality
 * 
 * Compatible with Vite environment variables
 */

import { createClient, SupabaseClient, Session, AuthChangeEvent } from '@supabase/supabase-js'

// Environment variables validation
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase configuration. Ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in your environment.\n' +
      'Create a .env.local at the project root with:\n' +
      'VITE_SUPABASE_URL=your_supabase_project_url\n' +
      'VITE_SUPABASE_ANON_KEY=your_supabase_anon_key'
  )
}

export const getApplicationAdditionalByApplicationId = async (
  applicationId: string
): Promise<ApplicationAdditionalRow[]> => {
  const { data, error } = await supabase
    .from('application_additional')
    .select('*')
    .eq('application_id', applicationId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data as unknown as ApplicationAdditionalRow[]) || []
}

// ===================== ADDITIONAL DOCUMENTS =====================
export interface ApplicationAdditionalRow {
  id?: string
  application_id: string
  file_name: string
  file_size?: number | null
  file_type?: string | null
  file_url?: string | null
  created_at?: string
  description?: string | null
}

// Upload an additional document to Storage and return public URL + storage path
export const uploadApplicationAdditionalFile = async (
  applicationId: string,
  file: File
): Promise<{ publicUrl: string | null; storagePath: string }> => {
  const safeAppId = applicationId || 'unassigned'
  const storagePath = `docs/${safeAppId}/additional/${Date.now()}-${file.name}`
  const { error: uploadError } = await supabase.storage
    .from('application_documents')
    .upload(storagePath, file, {
      upsert: true,
      contentType: file.type || 'application/octet-stream',
      cacheControl: '3600',
    })
  if (uploadError) throw uploadError

  const { data: pub } = supabase.storage
    .from('application_documents')
    .getPublicUrl(storagePath)
  let publicUrl: string | null = pub?.publicUrl ?? null
  if (!publicUrl) {
    const { data: signed } = await supabase.storage
      .from('application_documents')
      .createSignedUrl(storagePath, 60 * 60)
    publicUrl = (signed && typeof signed.signedUrl === 'string') ? signed.signedUrl : null
  }
  return { publicUrl, storagePath: `application_documents/${storagePath}` }
}

// Insert a row into application_additional (only columns likely present)
export const insertApplicationAdditional = async (row: ApplicationAdditionalRow) => {
  const payload: Record<string, unknown> = {
    application_id: row.application_id,
    file_name: row.file_name,
  }
  if (row.file_size !== undefined) payload.file_size = row.file_size
  if (row.file_type !== undefined) payload.file_type = row.file_type
  if (row.file_url !== undefined) payload.file_url = row.file_url
  if (row.description !== undefined) payload.description = row.description

  const { data, error } = await supabase
    .from('application_additional')
    .insert([payload])
    .select()
    .single()

  if (error) throw error
  return data as ApplicationAdditionalRow
}

// Fetch application_form rows linked to a specific application_id
export const getApplicationFormByApplicationId = async (
  applicationId: string
): Promise<ApplicationFormRow[]> => {
  const { data, error } = await supabase
    .from('application_form')
    .select('*')
    .eq('application_id', applicationId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data || []) as ApplicationFormRow[]
}

// Fetch the latest application_form row for a user that hasn't been linked to an application yet
export const getLatestPendingApplicationForm = async (
  userId: string
): Promise<ApplicationFormRow | null> => {
  const { data, error } = await supabase
    .from('application_form')
    .select('*')
    .eq('user_id', userId)
    .is('application_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error && error.code !== 'PGRST116') throw error
  return data as ApplicationFormRow | null
}

// Application form uploads (the initial completed application PDF/DOC)
export interface ApplicationFormRow {
  id?: string
  application_id?: string | null
  user_id?: string | null
  file_name: string
  file_size?: number | null
  file_type?: string | null
  file_url?: string | null
  created_at?: string
  description?: string | null
}

// Insert a row into application_form
export const insertApplicationForm = async (row: ApplicationFormRow) => {
  // Build payload conditionally to avoid referencing columns that may not exist (e.g., application_id)
  const payload: Record<string, unknown> = {
    file_name: row.file_name,
  }
  if (row.user_id !== undefined) payload.user_id = row.user_id
  if (row.file_size !== undefined) payload.file_size = row.file_size
  if (row.file_type !== undefined) payload.file_type = row.file_type
  if (row.file_url !== undefined) payload.file_url = row.file_url
  if (row.description !== undefined) payload.description = row.description

  const { data, error } = await supabase
    .from('application_form')
    .insert([payload])
    .select()
    .single()

  if (error) throw error
  return data as ApplicationFormRow
}

// Upload application form file to Storage and return public URL
export const uploadApplicationFormFile = async (
  file: File,
  opts?: { applicationId?: string | null; userId?: string | null }
): Promise<{ publicUrl: string | null; storagePath: string }> => {
  // Reuse existing bucket to avoid missing-bucket errors; namespace under forms/
  const appId = opts?.applicationId || opts?.userId || 'unassigned'
  // Use 'docs/' prefix to match existing policies used elsewhere in the app
  const storagePath = `docs/${appId}/${Date.now()}-${file.name}`
  const { error: uploadError } = await supabase.storage
    .from('application_documents')
    .upload(storagePath, file, {
      upsert: true,
      contentType: file.type || 'application/octet-stream',
      cacheControl: '3600',
    })

  if (uploadError) throw uploadError

  const { data: pub } = supabase.storage
    .from('application_documents')
    .getPublicUrl(storagePath)
  let publicUrl: string | null = pub?.publicUrl ?? null
  if (!publicUrl) {
    // Fallback to signed URL if bucket isn't public
    const { data: signed } = await supabase.storage
      .from('application_documents')
      .createSignedUrl(storagePath, 60 * 60) // 1 hour
    publicUrl = (signed && typeof signed.signedUrl === 'string') ? signed.signedUrl : null
  }
  return { publicUrl, storagePath: `application_documents/${storagePath}` }
}

// Update application_form row by id
export const updateApplicationForm = async (
  id: string,
  updates: Partial<ApplicationFormRow>
): Promise<ApplicationFormRow> => {
  const { error } = await supabase
    .from('application_form')
    .update(updates)
    .eq('id', id)
  if (error) throw error
  return {
    id,
    ...(updates as object),
  } as ApplicationFormRow
}

// Fetch an application's access map across users: user_id -> can_access
export const getApplicationAccessMapByApp = async (
  applicationId: string
): Promise<{ [userId: string]: boolean }> => {
  const { data, error } = await supabase
    .from('application_access')
    .select('user_id, can_access')
    .eq('application_id', applicationId)

  if (error) throw error
  const map: { [userId: string]: boolean } = {}
  for (const row of (data || []) as { user_id: string; can_access: boolean }[]) {
    map[row.user_id] = !!row.can_access
  }
  return map
}

// Upsert a single access row for a specific user and application
export const setApplicationAccess = async (
  userId: string,
  applicationId: string,
  can_access: boolean
) => {
  const { error } = await supabase
    .from('application_access')
    .upsert(
      [{ user_id: userId, application_id: applicationId, can_access }],
      { onConflict: 'user_id,application_id' }
    )
  if (error) throw error
  return { userId, applicationId, can_access }
}

// Create Supabase client with enhanced configuration
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Enable automatic token refresh
    autoRefreshToken: true,
    // Persist session in localStorage
    persistSession: true,
    // Detect session from URL (for OAuth callbacks)
    detectSessionInUrl: true,
    // Storage key for session persistence
    storageKey: 'mcapro-auth-token',
    // Custom storage implementation (optional - uses localStorage by default)
    storage: {
      getItem: (key: string) => {
        if (typeof window !== 'undefined') {
          return window.localStorage.getItem(key)
        }
        return null
      },
      setItem: (key: string, value: string) => {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(key, value)
        }
      },
      removeItem: (key: string) => {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(key)
        }
      }
    }
  },
  // Global configuration
  global: {
    headers: {
      'X-Client-Info': 'mcapro-portal@1.0.0'
    }
  }
})

// ===================== AUTHENTICATION HELPERS =====================

/**
 * Enhanced logout function with cleanup
 * Clears both Supabase session and local storage
 */
export const logoutUser = async (): Promise<void> => {
  console.log('Starting Supabase signOut...');
  
  // Try Supabase signOut with timeout
  try {
    const timeoutId = setTimeout(() => {
      console.warn('Supabase signOut taking too long, forcing logout...');
    }, 2000);
    
    const { error } = await supabase.auth.signOut();
    clearTimeout(timeoutId);
    
    if (error) {
      console.error('Supabase signOut error:', error);
    } else {
      console.log('Supabase signOut successful');
    }
  } catch (error) {
    console.error('Supabase signOut failed:', error);
  }

  // Always clear local storage items
  if (typeof window !== 'undefined') {
    localStorage.removeItem('mcapro_user');
    localStorage.removeItem('mcapro-auth-token');
    localStorage.removeItem('adminLoggedIn'); // Clear admin flag too
    console.log('LocalStorage items cleared in supabase.ts');
  }
  
  console.log('Logout process completed');
}

/**
 * Get current authenticated user
 */
export const getCurrentUser = async () => {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) throw error
  return user
}

/**
 * Get current session with automatic refresh
 */
export const getCurrentSession = async () => {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw error
  return session
}

/**
 * Check if user is authenticated
 */
export const isAuthenticated = async (): Promise<boolean> => {
  try {
    const session = await getCurrentSession()
    return !!session?.user
  } catch {
    return false
  }
}

/**
 * Refresh the current session
 */
export const refreshSession = async () => {
  const { data, error } = await supabase.auth.refreshSession()
  if (error) throw error
  return data
}

/**
 * Sign in with OAuth provider (Google, GitHub, etc.)
 */
export const signInWithOAuth = async (provider: 'google' | 'github' | 'discord' | 'facebook') => {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/dashboard`
    }
  })
  if (error) throw error
  return data
}

/**
 * Handle OAuth callback and session detection
 * Call this on app initialization to detect OAuth sessions from URL
 */
export const handleOAuthCallback = async () => {
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) throw error
    return data.session
  } catch (error) {
    console.error('OAuth callback error:', error)
    return null
  }
}

/**
 * Reset password via email
 */
export const resetPassword = async (email: string) => {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`
  })
  if (error) throw error
  return data
}

/**
 * Update user password
 */
export const updatePassword = async (newPassword: string) => {
  const { data, error } = await supabase.auth.updateUser({
    password: newPassword
  })
  if (error) throw error
  return data
}

// ===================== SESSION MONITORING =====================

/**
 * Session event listener type
 */
export type SessionEventListener = (event: AuthChangeEvent, session: Session | null) => void

/**
 * Subscribe to auth state changes with enhanced error handling
 */
export const onAuthStateChange = (callback: SessionEventListener) => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    try {
      callback(event, session)
    } catch (error) {
      console.error('Auth state change callback error:', error)
    }
  })

  return {
    unsubscribe: () => subscription.unsubscribe()
  }
}

/**
 * Get session with retry logic for better reliability
 */
export const getSessionWithRetry = async (maxRetries = 3): Promise<Session | null> => {
  let lastError: Error | null = null
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const { data: { session }, error } = await supabase.auth.getSession()
      if (error) throw error
      return session
    } catch (error) {
      lastError = error as Error
      if (i < maxRetries - 1) {
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000))
      }
    }
  }
  
  throw lastError
}

/**
 * Register a new user with role-based approval system
 */
export const registerUser = async (userData: {
  email: string
  password: string
  fullName: string
}) => {
  // Create the auth user but prevent session creation
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: userData.email,
    password: userData.password,
    options: {
      data: {
        full_name: userData.fullName
      }
    }
  })

  if (authError) throw authError

  // Immediately sign out to prevent session persistence
  await supabase.auth.signOut()

  // Create the user record in the users table
  if (authData.user) {
    const { data: userRecord, error: userError } = await supabase
      .from('users')
      .insert([{
        id: authData.user.id,
        email: userData.email,
        full_name: userData.fullName,
        roles: null // Requires admin approval
      }])
      .select()
      .single()

    if (userError) throw userError
    
    return { authData, userRecord }
  }

  return { authData, userRecord: null }
}

/**
 * Login user with email and password
 */
export const loginUser = async (credentials: {
  email: string
  password: string
}) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password
  })

  if (error) throw error
  return data
}

// ===================== DATABASE TYPES =====================

export interface User {
  id: string
  created_at: string
  email: string
  full_name: string
  phone?: string
  address?: string
  roles?: string
  avatar_url?: string
}

export const getUserProfile = async (userId: string) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, roles, created_at, avatar_url')
    .eq('id', userId)
    .single()
  if (error) throw error
  return data as User
}

export const updateUserProfile = async (
  userId: string,
  updates: Partial<Pick<User, 'full_name' | 'avatar_url'>>
) => {
  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId)
    .select('id, email, full_name, roles, created_at, avatar_url')
    .single()
  if (error) throw error
  return data as User
}

export const uploadUserAvatar = async (userId: string, file: File): Promise<string> => {
  // Use existing bucket to avoid 'Bucket not found' errors in environments without the avatars bucket
  const path = `avatars/${userId}/${Date.now()}-${file.name}`
  const { error } = await supabase.storage
    .from('application_documents')
    .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg', cacheControl: '3600' })
  if (error) throw error
  const { data } = supabase.storage.from('application_documents').getPublicUrl(path)
  return data.publicUrl
}

// ===================== ACCESS CONTROL =====================
// Expected table: application_access(user_id uuid, application_id uuid, can_access boolean, updated_at timestamptz)

export type AccessMap = { [applicationId: string]: boolean }

// Fetch a user's access map for applications
export const getUserApplicationAccessMap = async (userId: string): Promise<AccessMap> => {
  const { data, error } = await supabase
    .from('application_access')
    .select('application_id, can_access')
    .eq('user_id', userId)

  if (error) throw error
  const map: AccessMap = {}
  for (const row of (data || []) as { application_id: string; can_access: boolean }[]) {
    map[row.application_id] = !!row.can_access
  }
  return map
}

// Upsert a user's access map for applications
export const setUserApplicationAccessMap = async (userId: string, access: AccessMap) => {
  const rows = Object.entries(access).map(([application_id, can_access]) => ({
    user_id: userId,
    application_id,
    can_access,
  }))
  if (rows.length === 0) return { count: 0 }
  const { error } = await supabase
    .from('application_access')
    .upsert(rows, { onConflict: 'user_id,application_id' })
  if (error) throw error
  return { count: rows.length }
}

// Get all applications visible to a member: own + those granted via access
export const getApplicationsForMember = async (userId: string) => {
  // Fetch own applications
  const { data: own, error: ownErr } = await supabase
    .from('applications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (ownErr) throw ownErr

  // Fetch all access rows for this user (both true and false)
  const { data: accessRows, error: accessErr } = await supabase
    .from('application_access')
    .select('application_id, can_access')
    .eq('user_id', userId)
  if (accessErr) throw accessErr

  const accessMap: Record<string, boolean> = {}
  for (const row of (accessRows || []) as { application_id: string; can_access: boolean }[]) {
    accessMap[row.application_id] = !!row.can_access
  }

  // Determine which own apps to keep: include unless explicitly set to false
  const ownFiltered = (own || []).filter(a => {
    const v = accessMap[a.id]
    return v === undefined ? true : v === true
  })

  // Non-owned apps that are granted (can_access = true)
  const grantedTrueIds = Object.entries(accessMap)
    .filter(([, v]) => v === true)
    .map(([k]) => k)

  const nonOwnedGrantedIds = grantedTrueIds.filter(id => !own?.some(o => o.id === id))

  let grantedApps: Application[] = []
  if (nonOwnedGrantedIds.length > 0) {
    const { data: granted, error: grantedErr } = await supabase
      .from('applications')
      .select('*')
      .in('id', nonOwnedGrantedIds)
    if (grantedErr) throw grantedErr
    grantedApps = (granted || []) as Application[]
  }

  return [ ...ownFiltered, ...grantedApps ] as Application[]
}

// Fetch users filtered by role (e.g., 'member')
export const getUsersByRole = async (role: string) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, created_at, email, full_name, roles')
    .eq('roles', role)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data as User[]
}

// ===================== APPLICATION HELPERS =====================

/**
 * Get application by ID
 */
export const getApplicationById = async (id: string) => {
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export interface Application {
  id: string
  business_name: string
  owner_name: string
  email: string
  phone: string
  dateBirth?: string
  date_of_birth?: string
  address: string
  ein: string
  business_type: string
  industry: string
  years_in_business: number
  number_of_employees: number
  annual_revenue: number
  monthly_revenue: number
  monthly_deposits: number
  existing_debt: number
  credit_score: number
  requested_amount: number
  status: string
  documents: string[]
  created_at: string
  updated_at: string
  user_id?: string
}

export interface Lender {
  id: string
  name: string
  contact_email: string
  phone: string
  status: 'active' | 'inactive' | 'pending'
  rating: number
  total_applications: number
  approval_rate: number
  min_amount: number
  max_amount: number
  min_credit_score: number
  max_credit_score: number
  min_time_in_business: number
  min_monthly_revenue: number
  industries: string[]
  factor_rate: string
  payback_term: string
  approval_time: string
  features: string[]
  created_at: string
  updated_at: string
  cc_emails?: string[]
}

export interface LenderSubmission {
  id: string
  application_id: string
  lender_id: string
  status: 'pending' | 'approved' | 'declined' | 'counter-offer' | 'funded'
  response?: string
  offered_amount?: number
  factor_rate?: string
  terms?: string
  response_date?: string
  notes?: string
  created_at: string
  updated_at: string
}

// Lender notes (free-form internal notes per application)
export interface LenderNote {
  id: string
  application_id: string
  notes: string
  created_at: string
}

// Application document records (PDF uploads and parsed results)
export interface ApplicationDocument {
  id: string
  application_id: string
  file_name: string
  file_size?: number
  file_type?: string
  statement_date?: string // ISO date string
  upload_date?: string // ISO date string (optional, if present in schema)
  file_url?: string
  extracted_json?: unknown
  created_at: string
}

// Application functions
export const createApplication = async (applicationData: Omit<Application, 'id' | 'created_at' | 'updated_at'>) => {
  const { data, error } = await supabase
    .from('applications')
    .insert([applicationData])
    .select()
    .single()

  if (error) throw error
  return data
}

export const getApplications = async () => {
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export const getAllApplications = async () => {
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export const getApplicationsByUserId = async (userId: string) => {
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export const updateApplication = async (id: string, updates: Partial<Application>) => {
  const existing = await getApplicationById(id)
  if (!existing) throw new Error('Application not found')

  const { error } = await supabase
    .from('applications')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
  return await getApplicationById(id)
}

// Update total_amount (sum of selected Transactions rows) for a specific MTD record
export const updateApplicationMTDTotalAmount = async (
  id: string,
  total_amount: number
) => {
  const { data, error } = await supabase
    .from('application_mtd')
    .update({ total_amount })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data as ApplicationMTD
}

// Optional type for rows in application_financials (kept loose to avoid coupling to migrations)
export interface ApplicationFinancialRow {
  id: string
  application_id: string
  created_at?: string
  updated_at?: string
  [key: string]: unknown
}

// Prefer fetching financials from dedicated application_financials table
export const getApplicationFinancialsByApplicationId = async (
  applicationId: string
): Promise<ApplicationFinancialRow | null> => {
  const { data, error } = await supabase
    .from('application_financials')
    .select('*')
    .eq('application_id', applicationId)
    .limit(1)

  if (error) throw error
  const rows = data as unknown as ApplicationFinancialRow[] | null
  return rows && rows.length ? rows[0] : null
}

// Optional type for rows in application_summary
export interface ApplicationSummaryRow {
  id: string
  application_id: string
  created_at?: string
  updated_at?: string
  [key: string]: unknown
}

// Fetch ALL application summary data by application_id
export const getApplicationSummaryByApplicationId = async (
  applicationId: string
): Promise<ApplicationSummaryRow[]> => {
  const { data, error } = await supabase
    .from('application_summary')
    .select('*')
    .eq('application_id', applicationId)
    .order('month', { ascending: true })

  if (error) throw error
  return (data as unknown as ApplicationSummaryRow[]) || []
}

export const deleteApplication = async (id: string) => {
  const { error } = await supabase
    .from('applications')
    .delete()
    .eq('id', id)

  if (error) throw error
}
// Lender functions
export const getLenders = async () => {
  const { data, error } = await supabase
    .from('lenders')
    .select('*')
    .order('name')

  if (error) throw error
  return data
}

export const createLender = async (lenderData: Omit<Lender, 'id' | 'created_at' | 'updated_at'>) => {
  const { data, error } = await supabase
    .from('lenders')
    .insert([lenderData])
    .select()
    .single()

  if (error) throw error
  return data
}

export const updateLender = async (id: string, updates: Partial<Lender>) => {
  const { data, error } = await supabase
    .from('lenders')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export const deleteLender = async (id: string) => {
  const { error } = await supabase
    .from('lenders')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// Lender submission functions
export const createLenderSubmissions = async (applicationId: string, lenderIds: string[]) => {
  const submissions = lenderIds.map(lenderId => ({
    application_id: applicationId,
    lender_id: lenderId,
    status: 'pending' as const
  }))

  // Use upsert to avoid 409 conflicts on unique (application_id, lender_id)
  const { data, error } = await supabase
    .from('lender_submissions')
    .upsert(submissions, { onConflict: 'application_id,lender_id', ignoreDuplicates: true })
    .select()

  if (error) throw error
  return data
}

export const getLenderSubmissions = async (applicationId: string) => {
  const { data, error } = await supabase
    .from('lender_submissions')
    .select(`
      *,
      lender:lenders(*)
    `)
    .eq('application_id', applicationId)

  if (error) throw error
  return data
}

// Lender notes helpers
export const getLenderNotes = async (applicationId: string): Promise<LenderNote[]> => {
  const { data, error } = await supabase
    .from('lenders_notes')
    .select('*')
    .eq('application_id', applicationId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data || []) as LenderNote[]
}

export const addLenderNote = async (applicationId: string, notes: string): Promise<LenderNote> => {
  const payload = { application_id: applicationId, notes }
  const { data, error } = await supabase
    .from('lenders_notes')
    .insert([payload])
    .select()
    .single()

  if (error) throw error
  return data as LenderNote
}

export const updateLenderNote = async (id: string, updates: Partial<Pick<LenderNote, 'notes'>>): Promise<{ id: string }> => {
  const { error } = await supabase
    .from('lenders_notes')
    .update(updates)
    .eq('id', id)

  if (error) throw error
  return { id }
}

export const deleteLenderNote = async (id: string): Promise<{ id: string }> => {
  const { error } = await supabase
    .from('lenders_notes')
    .delete()
    .eq('id', id)

  if (error) throw error
  return { id }
}

export const updateLenderSubmission = async (id: string, updates: Partial<LenderSubmission>) => {
  const { data, error } = await supabase
    .from('lender_submissions')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

// Application documents
export const getApplicationDocuments = async (applicationId: string) => {
  const { data, error } = await supabase
    .from('application_documents')
    .select('*')
    .eq('application_id', applicationId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data as ApplicationDocument[]
}

// ===================== MTD Uploads =====================
export interface ApplicationMTD {
  id: string
  application_id: string
  file_name: string
  file_size?: number
  file_type?: string
  upload_date?: string
  created_at?: string
  statement_date?: string
  file_url?: string
  upload_status?: 'pending' | 'processing' | 'completed' | 'failed'
  // Analysis result columns
  mtd_summary?: unknown
  total_amount?: number | null
  available_balance?: number | null
  negative?: number | null
  funder_mtd?: unknown
  total_mtd?: number | null
  // Persisted selection of funder rows (jsonb)
  mtd_selected?: unknown
}

export const insertApplicationMTD = async (row: {
  application_id: string
  file_name: string
  file_size?: number
  file_type?: string
  statement_date?: string
  file_url?: string
  upload_status?: ApplicationMTD['upload_status']
}): Promise<ApplicationMTD> => {
  const payload = {
    application_id: row.application_id,
    file_name: row.file_name,
    file_size: row.file_size ?? null,
    file_type: row.file_type ?? null,
    statement_date: row.statement_date ?? null,
    file_url: row.file_url ?? null,
    upload_status: row.upload_status ?? 'pending',
  }
  const { data, error } = await supabase
    .from('application_mtd')
    .insert([payload])
    .select()
    .single()

  if (error) throw error
  return data as unknown as ApplicationMTD
}

export const updateApplicationMTDStatus = async (
  id: string,
  upload_status: ApplicationMTD['upload_status']
): Promise<ApplicationMTD> => {
  const { data, error } = await supabase
    .from('application_mtd')
    .update({ upload_status })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data as unknown as ApplicationMTD
}

export const updateApplicationMTDFileUrl = async (
  id: string,
  file_url: string
): Promise<ApplicationMTD> => {
  const { data, error } = await supabase
    .from('application_mtd')
    .update({ file_url })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data as unknown as ApplicationMTD
}

export const getApplicationMTDByApplicationId = async (
  applicationId: string
): Promise<ApplicationMTD[]> => {
  const { data, error } = await supabase
    .from('application_mtd')
    .select('*')
    .eq('application_id', applicationId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data as unknown as ApplicationMTD[]) || []
}

// Fetch only mtd_summary and total_amount for a specific MTD row
export const getApplicationMTDAnalysisById = async (
  id: string
) => {
  const { data, error } = await supabase
    .from('application_mtd')
    .select('id, mtd_summary, total_amount, available_balance, negative, funder_mtd, total_mtd, mtd_selected')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as Pick<ApplicationMTD, 'id'> & { mtd_summary?: unknown; total_amount?: number | null; available_balance?: number | null; negative?: number | null; funder_mtd?: unknown; total_mtd?: number | null; mtd_selected?: unknown }
}

// Update total_mtd (sum of selected Funder MTD rows) for a specific MTD record
export const updateApplicationMTDTotalMTD = async (
  id: string,
  total_mtd: number
) => {
  const { data, error } = await supabase
    .from('application_mtd')
    .update({ total_mtd })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data as ApplicationMTD
}

// Update mtd_selected (jsonb of selected funder rows)
export const updateApplicationMTDMtdSelected = async (
  id: string,
  mtd_selected: unknown
) => {
  const { data, error } = await supabase
    .from('application_mtd')
    .update({ mtd_selected })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data as ApplicationMTD
}

export const deleteApplicationMTD = async (id: string) => {
  const { error } = await supabase
    .from('application_mtd')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export const deleteApplicationMTDByAppAndName = async (
  applicationId: string,
  file_name: string,
  file_size?: number
) => {
  let query = supabase
    .from('application_mtd')
    .delete()
    .eq('application_id', applicationId)
    .eq('file_name', file_name)

  if (typeof file_size === 'number') {
    query = query.eq('file_size', file_size)
  }

  const { error } = await query
  if (error) throw error
}

export const resolveAndDeleteApplicationMTD = async (
  applicationId: string,
  file_name: string,
  file_size?: number
) => {
  // Look up id safely first
  const sel = supabase
    .from('application_mtd')
    .select('id, file_size')
    .eq('application_id', applicationId)
    .eq('file_name', file_name)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await sel;
  if (error) throw error
  const id = (data as { id: string } | null)?.id as string | undefined
  if (id) {
    await deleteApplicationMTD(id)
    return
  }
  // Secondary attempt: case-insensitive match on file_name (handles casing/format differences)
  const { data: ciRows, error: ciErr } = await supabase
    .from('application_mtd')
    .select('id, file_name, created_at')
    .eq('application_id', applicationId)
    .ilike('file_name', file_name)
    .order('created_at', { ascending: false })
    .limit(1);
  if (ciErr) throw ciErr;
  const ciId = (Array.isArray(ciRows) && ciRows.length > 0) ? (ciRows[0] as { id: string }).id : undefined;
  if (ciId) {
    await deleteApplicationMTD(ciId);
    return;
  }
  // Fallback to direct conditional delete
  await deleteApplicationMTDByAppAndName(applicationId, file_name, file_size)
}

export const deleteApplicationDocument = async (id: string) => {
  const { error } = await supabase
    .from('application_documents')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// Delete one or more documents by application_id and statement_date.
// Optionally narrow by file_name to avoid removing multiple rows when duplicates exist.
export const deleteApplicationDocumentByAppAndDate = async (
  applicationId: string,
  statementDate: string,
  fileName?: string
) => {
  let query = supabase
    .from('application_documents')
    .delete()
    .eq('application_id', applicationId)
    .eq('statement_date', statementDate)

  if (fileName) {
    query = query.eq('file_name', fileName)
  }

  const { error } = await query
  if (error) throw error
}

// Update monthly_revenue for a specific application document
export const updateApplicationDocumentMonthlyRevenue = async (
  documentId: string,
  monthlyRevenue: number
) => {
  const { data, error } = await supabase
    .from('application_documents')
    .update({ monthly_revenue: monthlyRevenue })
    .eq('id', documentId)
    .select()
    .single()

  if (error) throw error
  return data
}

// Qualification logic
export const qualifyLenders = (lenders: Lender[], application: Application): (Lender & { qualified: boolean; matchScore: number })[] => {
  // Helpers
  const clamp = (val: number, min: number, max: number) => Math.min(max, Math.max(min, val));
  const rndJitter = (range = 5) => (Math.random() * range * 2) - range; // ±range

  // Prepare application industry words (case-insensitive, exact words only)
  const appIndustryWords = (application.industry || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);

  const isIndustryMatch = (l: Lender) => {
    if ((l.industries || []).some(i => (i || '').trim().toLowerCase() === 'all industries')) return true;
    if (appIndustryWords.length === 0) return false;
    for (const entry of (l.industries || [])) {
      const lenderWords = (entry || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .filter(Boolean);
      if (appIndustryWords.some(w => lenderWords.includes(w))) return true; // exact word match only
    }
    return false;
  };

  // Rule 1: Active lenders only
  const active = (lenders || []).filter(l => l.status === 'active');

  // Evaluate qualification per rules
  const qualified = active
    .map((l) => {
      // Rule 2: Industry match
      const industryOk = isIndustryMatch(l);

      // Rule 3: Average Revenue Matching
      const lenderMinRev = (l as Partial<Lender>).min_monthly_revenue as unknown as number | null | undefined;
      const appMonthly = (application as Partial<Application>).monthly_revenue as unknown as number | null | undefined;
      const revenueOk = lenderMinRev == null || (Number(appMonthly) || 0) >= Number(lenderMinRev);

      const passes = industryOk && revenueOk;

      // Rule 4: Scoring
      let score = 0;
      if (industryOk) score += 50; // base for industry
      if (revenueOk && lenderMinRev != null) score += 20; // bonus for meeting revenue requirement
      score += rndJitter(5); // ±5 jitter
      score = clamp(Math.round(score), 0, 100);

      return { ...l, qualified: passes, matchScore: score };
    })
    .filter(l => l.qualified);

  // Rule 5: Ranking by score desc; tie-break with small jitter
  qualified.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    return rndJitter(0.5);
  });

  return qualified;
}

// Deferred MCA results
export interface McaResult {
  job_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  result_json?: unknown
  error?: string
  application_id?: string
  statement_date?: string
  created_at?: string
  updated_at?: string
}

export const getMcaResult = async (jobId: string): Promise<McaResult | null> => {
  const { data, error } = await supabase
    .from('mca_results')
    .select('*')
    .eq('job_id', jobId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as unknown as McaResult) ?? null
}

// Get application financial data
export const getApplicationFinancials = async (applicationId: string) => {
  const { data, error } = await supabase
    .from('applications')
    .select(`
      id,
      business_name,
      annual_revenue,
      monthly_revenue,
      monthly_deposits,
      existing_debt,
      credit_score,
      requested_amount,
      years_in_business,
      number_of_employees,
      industry,
      business_type,
      created_at,
      updated_at
    `)
    .eq('id', applicationId)
    .single()

  if (error) throw error
  return data
}