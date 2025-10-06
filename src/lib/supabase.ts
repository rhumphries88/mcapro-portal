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
    .select('id, mtd_summary, total_amount')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as Pick<ApplicationMTD, 'id'> & { mtd_summary?: unknown; total_amount?: number | null }
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
  let sel = supabase
    .from('application_mtd')
    .select('id, file_size')
    .eq('application_id', applicationId)
    .eq('file_name', file_name)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await sel;
  if (error) throw error
  const id = (data as any)?.id as string | undefined
  if (id) {
    await deleteApplicationMTD(id)
    return
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