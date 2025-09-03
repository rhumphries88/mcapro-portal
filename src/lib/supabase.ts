import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Validate required environment variables before initializing the client
if (!supabaseUrl || !supabaseAnonKey) {
  // Provide a clear, actionable message during development
  throw new Error(
    'Missing Supabase configuration. Ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in your environment.\n' +
      'Create a .env.local at the project root with:\n' +
      'VITE_SUPABASE_URL=your_supabase_project_url\n' +
      'VITE_SUPABASE_ANON_KEY=your_supabase_anon_key'
  )
}

export const getApplicationById = async (id: string) => {
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Database types
export interface Application {
  id: string
  business_name: string
  owner_name: string
  email: string
  phone: string
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
  status: 'draft' | 'submitted' | 'under-review' | 'approved' | 'funded' | 'declined'
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

// Application document records (PDF uploads and parsed results)
export interface ApplicationDocument {
  id: string
  application_id: string
  file_name: string
  file_size?: number
  file_type?: string
  statement_date?: string // ISO date string
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

export const updateApplication = async (id: string, updates: Partial<Application>) => {
  const { data, error } = await supabase
    .from('applications')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
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

export const deleteApplicationDocument = async (id: string) => {
  const { error } = await supabase
    .from('application_documents')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// Qualification logic
export const qualifyLenders = (lenders: Lender[], application: Application): (Lender & { qualified: boolean; matchScore: number })[] => {
  return lenders.map(lender => {
    let qualified = true
    let matchScore = 100

    // Check amount range
    if (application.requested_amount < lender.min_amount || application.requested_amount > lender.max_amount) {
      qualified = false
      matchScore -= 30
    }

    // Check credit score
    if (application.credit_score < lender.min_credit_score || application.credit_score > lender.max_credit_score) {
      qualified = false
      matchScore -= 25
    }

    // Check time in business
    if (application.years_in_business < lender.min_time_in_business) {
      qualified = false
      matchScore -= 20
    }

    // Check monthly revenue
    if (application.monthly_revenue < lender.min_monthly_revenue) {
      qualified = false
      matchScore -= 15
    }

    // Check industry (if not "All Industries")
    if (!lender.industries.includes('All Industries') && !lender.industries.includes(application.industry)) {
      matchScore -= 10
    }

    // Bonus points for better rates and faster approval
    if (parseFloat(lender.factor_rate.split(' - ')[0]) < 1.15) {
      matchScore += 5
    }
    if (lender.approval_time.includes('24 hours') || lender.approval_time.includes('2 hours')) {
      matchScore += 3
    }

    return { ...lender, qualified, matchScore: Math.max(0, matchScore) }
  })
}