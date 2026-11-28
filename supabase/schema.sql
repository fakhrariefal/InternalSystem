-- ============================================================================
-- DOMESTIQ HUB SYSTEM (PT DOMESTIQ HUB INDONESIA) — SUPABASE POSTGRESQL SCHEMA
-- Jalankan seluruh script ini di SQL Editor Supabase.
-- Mencakup: 24 Tabel ERP B2B, Relasi Foreign Key, Indexes, Trigger Auth -> Profiles,
-- Row Level Security (RLS) Multi-Tenant per Perusahaan & Role, dan Storage Bucket.
-- ============================================================================

-- 0. Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. COMPANIES & PROFILES (MULTI-TENANT ROOT + USER RBAC)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL DEFAULT 'PT Domestiq Hub Indonesia',
  tagline TEXT DEFAULT 'General Supplier ERP',
  npwp TEXT DEFAULT '',
  address TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  logo_url TEXT DEFAULT '',
  bank_name TEXT DEFAULT '',
  bank_account_number TEXT DEFAULT '',
  bank_account_holder TEXT DEFAULT '',
  manager_approval_limit_idr NUMERIC(18,2) NOT NULL DEFAULT 25000000,
  default_exchange_rate_usd_idr NUMERIC(18,4) NOT NULL DEFAULT 16250,
  tax_rate_percent NUMERIC(5,2) NOT NULL DEFAULT 11,
  is_pkp BOOLEAN NOT NULL DEFAULT FALSE,
  supplier_categories JSONB NOT NULL DEFAULT '["IT","Safety/MRO","Packaging","ATK"]'::jsonb,
  initial_seed_completed BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Viewer'
    CHECK (role IN ('Direktur','Manager','Purchasing','Warehouse','Sales','Finance','Viewer','Angel Investor')),
  department TEXT DEFAULT 'Umum',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  photo_url TEXT DEFAULT '',
  claimed_from_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_company_email_unique
  ON public.profiles (company_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_profiles_auth_user_id
  ON public.profiles (auth_user_id);

-- ============================================================================
-- 2. MASTER DATA TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT DEFAULT '',
  pic_name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.uoms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  vendor_category TEXT DEFAULT 'Safety/MRO',
  nib TEXT DEFAULT '',
  npwp TEXT DEFAULT '',
  tax_status TEXT DEFAULT 'PKP' CHECK (tax_status IN ('PKP','Non-PKP')),
  address TEXT DEFAULT '',
  contact_person TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  bank_name TEXT DEFAULT '',
  bank_account TEXT DEFAULT '',
  payment_scheme TEXT DEFAULT 'TOP' CHECK (payment_scheme IN ('CBD','COD','TOP')),
  payment_term_days NUMERIC(10,0) NOT NULL DEFAULT 30,
  default_currency TEXT NOT NULL DEFAULT 'IDR' CHECK (default_currency IN ('IDR','USD')),
  nib_doc_url TEXT,
  nib_file_name TEXT,
  npwp_doc_url TEXT,
  npwp_file_name TEXT,
  ktp_director_doc_url TEXT,
  ktp_director_file_name TEXT,
  verification_status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (verification_status IN ('Pending','Verified','Blacklisted')),
  verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  nib TEXT DEFAULT '',
  npwp TEXT DEFAULT '',
  tax_status TEXT DEFAULT 'PKP' CHECK (tax_status IN ('PKP','Non-PKP')),
  address TEXT DEFAULT '',
  billing_address TEXT DEFAULT '',
  shipping_address TEXT DEFAULT '',
  contact_person TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  pic_purchasing_name TEXT DEFAULT '',
  pic_purchasing_phone TEXT DEFAULT '',
  pic_warehouse_name TEXT DEFAULT '',
  pic_warehouse_phone TEXT DEFAULT '',
  pic_finance_name TEXT DEFAULT '',
  pic_finance_phone TEXT DEFAULT '',
  payment_scheme TEXT DEFAULT 'CBD',
  credit_limit NUMERIC(18,2) NOT NULL DEFAULT 0,
  payment_term_days NUMERIC(10,0) NOT NULL DEFAULT 0,
  contract_prices JSONB NOT NULL DEFAULT '[]'::jsonb,
  nib_doc_url TEXT,
  nib_file_name TEXT,
  npwp_doc_url TEXT,
  npwp_file_name TEXT,
  verification_status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (verification_status IN ('Pending','Verified','Blacklisted')),
  verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  category_name TEXT DEFAULT '',
  uom_code TEXT NOT NULL,
  description TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  buy_price NUMERIC(18,2) NOT NULL DEFAULT 0,
  sell_price NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'IDR' CHECK (currency IN ('IDR','USD')),
  min_stock NUMERIC(18,2) NOT NULL DEFAULT 0,
  max_stock NUMERIC(18,2) NOT NULL DEFAULT 0,
  track_serial_or_expiry BOOLEAN NOT NULL DEFAULT FALSE,
  is_service BOOLEAN NOT NULL DEFAULT FALSE,
  warehouse_stocks JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 3. PROCUREMENT & SALES TRANSACTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  po_number TEXT NOT NULL,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT DEFAULT '',
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  warehouse_name TEXT DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'IDR' CHECK (currency IN ('IDR','USD')),
  exchange_rate NUMERIC(18,4) NOT NULL DEFAULT 16250,
  status TEXT NOT NULL DEFAULT 'Draft'
    CHECK (status IN ('Draft','Submitted','Approved by Manager','Ordered','Partially Received','Fully Received','Closed','Cancelled')),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  expected_date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  payment_term TEXT DEFAULT '',
  payment_term_custom TEXT DEFAULT '',
  incoterm TEXT DEFAULT '',
  delivery_location TEXT DEFAULT '',
  terms_and_conditions TEXT DEFAULT '',
  attachment_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  approval_tier_required TEXT DEFAULT 'Manager' CHECK (approval_tier_required IN ('Manager','Direktur')),
  director_approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_name TEXT DEFAULT '',
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.purchase_order_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  note TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sales_quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  quotation_number TEXT NOT NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name TEXT DEFAULT '',
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  warehouse_name TEXT DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'IDR' CHECK (currency IN ('IDR','USD')),
  status TEXT NOT NULL DEFAULT 'Draft'
    CHECK (status IN ('Draft','Sent','Accepted','Rejected','Expired','Converted')),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  valid_until TEXT NOT NULL,
  validity_period TEXT DEFAULT '',
  lead_time TEXT DEFAULT '',
  payment_term TEXT DEFAULT '',
  payment_term_custom TEXT DEFAULT '',
  incoterm TEXT DEFAULT '',
  delivery_location TEXT DEFAULT '',
  terms_and_conditions TEXT DEFAULT '',
  opening_text TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  converted_so_id UUID,
  converted_so_number TEXT DEFAULT '',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_name TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  so_number TEXT NOT NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name TEXT DEFAULT '',
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  warehouse_name TEXT DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'IDR' CHECK (currency IN ('IDR','USD')),
  status TEXT NOT NULL DEFAULT 'Draft'
    CHECK (status IN ('Draft','Confirmed','Partially Delivered','Fully Delivered','Invoiced','Closed')),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  due_date TEXT DEFAULT '',
  invoice_number TEXT DEFAULT '',
  tax_invoice_number TEXT DEFAULT '',
  quotation_id UUID REFERENCES public.sales_quotations(id) ON DELETE SET NULL,
  quotation_number TEXT DEFAULT '',
  pod_image_url TEXT,
  pod_file_name TEXT,
  pod_receiver_name TEXT,
  pod_timestamp TEXT,
  notes TEXT DEFAULT '',
  payment_term TEXT DEFAULT '',
  payment_term_custom TEXT DEFAULT '',
  incoterm TEXT DEFAULT '',
  delivery_location TEXT DEFAULT '',
  terms_and_conditions TEXT DEFAULT '',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_name TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vendor_rfqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  rfq_number TEXT NOT NULL,
  title TEXT NOT NULL,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  warehouse_name TEXT DEFAULT '',
  deadline_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft'
    CHECK (status IN ('Draft','Open','Awarded','Cancelled')),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  invited_supplier_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  quotes JSONB NOT NULL DEFAULT '[]'::jsonb,
  awarded_supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  awarded_po_id UUID REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  awarded_po_number TEXT DEFAULT '',
  opening_text TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_name TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.goods_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  return_number TEXT NOT NULL,
  return_type TEXT NOT NULL CHECK (return_type IN ('PURCHASE_RETURN','SALES_RETURN')),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Completed','Cancelled')),
  reference_order_id UUID,
  reference_order_number TEXT NOT NULL,
  counterparty_id UUID,
  counterparty_name TEXT NOT NULL,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  warehouse_name TEXT DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'IDR' CHECK (currency IN ('IDR','USD')),
  return_date TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_name TEXT DEFAULT '',
  completed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 4. INVENTORY & WAREHOUSE MUTATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inventory_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  product_sku TEXT DEFAULT '',
  product_name TEXT DEFAULT '',
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE CASCADE,
  warehouse_name TEXT DEFAULT '',
  batch_number TEXT NOT NULL,
  serial_number TEXT DEFAULT '',
  qty NUMERIC(18,2) NOT NULL DEFAULT 0,
  warranty_until TEXT DEFAULT '',
  expiry_date TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Quarantine','Expired','Depleted')),
  notes TEXT DEFAULT '',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  movement_number TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('GOODS_RECEIPT','GOODS_ISSUE','TRANSFER','STOCK_OPNAME')),
  reference_type TEXT DEFAULT '',
  reference_id UUID,
  reference_number TEXT DEFAULT '',
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_sku TEXT DEFAULT '',
  product_name TEXT DEFAULT '',
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  warehouse_name TEXT DEFAULT '',
  target_warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  target_warehouse_name TEXT DEFAULT '',
  quantity_delta NUMERIC(18,2) NOT NULL DEFAULT 0,
  before_qty NUMERIC(18,2) NOT NULL DEFAULT 0,
  after_qty NUMERIC(18,2) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(18,2) DEFAULT 0,
  notes TEXT DEFAULT '',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_name TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 5. ACCOUNTING, AP/AR INVOICES, JOURNAL ENTRIES, PERIOD CLOSING & BUDGET
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  ledger_type TEXT NOT NULL CHECK (ledger_type IN ('AP','AR')),
  counterparty_id UUID,
  counterparty_name TEXT DEFAULT '',
  reference_order_id UUID,
  reference_order_number TEXT DEFAULT '',
  tax_invoice_number TEXT DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'IDR' CHECK (currency IN ('IDR','USD')),
  exchange_rate NUMERIC(18,4) NOT NULL DEFAULT 16250,
  total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  balance_due NUMERIC(18,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (status IN ('UNPAID','PARTIAL','PAID','OVERDUE')),
  issue_date TEXT DEFAULT '',
  due_date TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'IDR' CHECK (currency IN ('IDR','USD')),
  exchange_rate NUMERIC(18,4) DEFAULT 16250,
  payment_method TEXT NOT NULL,
  reference_no TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  recorded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  recorded_by_name TEXT DEFAULT '',
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Aset','Kewajiban','Ekuitas','Pendapatan','Beban')),
  normal_balance TEXT NOT NULL CHECK (normal_balance IN ('Debit','Kredit')),
  opening_balance_idr NUMERIC(18,2) NOT NULL DEFAULT 0,
  description TEXT DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  entry_number TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  journal_type TEXT NOT NULL,
  reference_type TEXT DEFAULT '',
  reference_id UUID,
  reference_number TEXT DEFAULT '',
  description TEXT NOT NULL,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_debit_idr NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_credit_idr NUMERIC(18,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Posted' CHECK (status IN ('Posted','Void')),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_name TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.accounting_period_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT DEFAULT '',
  locked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  locked_by_name TEXT DEFAULT '',
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, period_key)
);

CREATE TABLE IF NOT EXISTS public.monthly_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  target_revenue_idr NUMERIC(18,2) NOT NULL DEFAULT 0,
  max_cogs_idr NUMERIC(18,2) NOT NULL DEFAULT 0,
  max_opex_idr NUMERIC(18,2) NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, period_key)
);

-- ============================================================================
-- 6. AUDIT LOGS & INTERNAL NOTIFICATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  target_label TEXT,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_email TEXT DEFAULT '',
  actor_role TEXT NOT NULL,
  details TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  target_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  read_by JSONB NOT NULL DEFAULT '[]'::jsonb,
  link_module TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 7. PERFORMANCE INDEXES PER COMPANY_ID
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_warehouses_company ON public.warehouses (company_id);
CREATE INDEX IF NOT EXISTS idx_categories_company ON public.categories (company_id);
CREATE INDEX IF NOT EXISTS idx_uoms_company ON public.uoms (company_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_company ON public.suppliers (company_id);
CREATE INDEX IF NOT EXISTS idx_customers_company ON public.customers (company_id);
CREATE INDEX IF NOT EXISTS idx_products_company ON public.products (company_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_company_created ON public.purchase_orders (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_logs_po ON public.purchase_order_logs (purchase_order_id, timestamp ASC);
CREATE INDEX IF NOT EXISTS idx_sales_quotations_company_created ON public.sales_quotations (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_orders_company_created ON public.sales_orders (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_rfqs_company_created ON public.vendor_rfqs (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_goods_returns_company_created ON public.goods_returns (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_company_created ON public.inventory_batches (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_company_created ON public.stock_movements (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_company_created ON public.invoices (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_inv ON public.invoice_payments (invoice_id, paid_at ASC);
CREATE INDEX IF NOT EXISTS idx_coa_company ON public.chart_of_accounts (company_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_company_created ON public.journal_entries (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_period_locks_company ON public.accounting_period_locks (company_id, period_key);
CREATE INDEX IF NOT EXISTS idx_budgets_company ON public.monthly_budgets (company_id, period_key);
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created ON public.audit_logs (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_company_created ON public.notifications (company_id, created_at DESC);

-- ============================================================================
-- 8. HELPER FUNCTIONS UNTUK ROW LEVEL SECURITY (MULTI-TENANT + ROLE)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id
  FROM public.profiles
  WHERE auth_user_id = auth.uid() AND active = TRUE
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.profiles
  WHERE auth_user_id = auth.uid() AND active = TRUE
  LIMIT 1;
$$;

-- ============================================================================
-- 9. TRIGGER OTOMATIS SAAT USER BARU MENDAFTAR VIA SUPABASE AUTH
--    - Jika email sudah didaftarkan oleh Direktur di tabel profiles sebelumnya,
--      akun auth otomatis terhubung ke company_id & role yang sudah disiapkan.
--    - Jika pendaftar baru membuat workspace perusahaan baru, otomatis dibuatkan
--      row di public.companies dan dijadikan Direktur perusahaan tersebut.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_display_name TEXT;
  v_photo_url TEXT;
  v_company_name TEXT;
  v_invited_id UUID;
  v_company_id UUID;
BEGIN
  v_email := lower(trim(COALESCE(NEW.email, '')));
  v_display_name := NULLIF(
    trim(COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', '')),
    ''
  );
  IF v_display_name IS NULL THEN
    v_display_name := COALESCE(NULLIF(split_part(v_email, '@', 1), ''), 'User Domestiq');
  END IF;
  v_photo_url := COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', '');

  -- Cek apakah user sudah pernah dibuatkan profil undangan oleh Direktur sebelumnya
  SELECT id, company_id
  INTO v_invited_id, v_company_id
  FROM public.profiles
  WHERE lower(email) = v_email AND auth_user_id IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_invited_id IS NOT NULL THEN
    UPDATE public.profiles
    SET
      auth_user_id = NEW.id,
      display_name = COALESCE(NULLIF(display_name, ''), v_display_name),
      photo_url = CASE WHEN COALESCE(photo_url, '') = '' THEN v_photo_url ELSE photo_url END,
      updated_at = NOW()
    WHERE id = v_invited_id;
    RETURN NEW;
  END IF;

  -- Jika belum ada profil: buat company workspace baru agar terisolasi multi-tenant
  v_company_name := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'company_name', '')), '');
  IF v_company_name IS NULL THEN
    v_company_name := 'PT Domestiq Hub Indonesia';
  END IF;

  INSERT INTO public.companies (
    company_name,
    tagline,
    email,
    initial_seed_completed
  ) VALUES (
    v_company_name,
    'General Supplier ERP',
    v_email,
    FALSE
  )
  RETURNING id INTO v_company_id;

  INSERT INTO public.profiles (
    auth_user_id,
    company_id,
    email,
    display_name,
    role,
    department,
    active,
    photo_url
  ) VALUES (
    NEW.id,
    v_company_id,
    v_email,
    left(v_display_name, 120),
    'Direktur',
    'Direksi & Sistem',
    TRUE,
    left(v_photo_url, 512)
  )
  ON CONFLICT (auth_user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 10. ENABLE ROW LEVEL SECURITY (RLS) & POLICIES DI SELURUH TABEL
-- ============================================================================

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_period_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Policy: companies
DROP POLICY IF EXISTS companies_select_own ON public.companies;
CREATE POLICY companies_select_own ON public.companies
  FOR SELECT TO authenticated
  USING (id = public.current_company_id());

DROP POLICY IF EXISTS companies_update_admin ON public.companies;
CREATE POLICY companies_update_admin ON public.companies
  FOR UPDATE TO authenticated
  USING (id = public.current_company_id() AND public.current_user_role() IN ('Direktur', 'Manager'))
  WITH CHECK (id = public.current_company_id() AND public.current_user_role() IN ('Direktur', 'Manager'));

-- Policy: profiles
DROP POLICY IF EXISTS profiles_select_own_or_admin ON public.profiles;
CREATE POLICY profiles_select_own_or_admin ON public.profiles
  FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR (
      company_id = public.current_company_id()
      AND public.current_user_role() IN ('Direktur', 'Manager')
    )
  );

DROP POLICY IF EXISTS profiles_insert_director ON public.profiles;
CREATE POLICY profiles_insert_director ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_company_id()
    AND public.current_user_role() = 'Direktur'
  );

DROP POLICY IF EXISTS profiles_update_director ON public.profiles;
CREATE POLICY profiles_update_director ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.current_user_role() = 'Direktur'
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND public.current_user_role() = 'Direktur'
  );

DROP POLICY IF EXISTS profiles_delete_director ON public.profiles;
CREATE POLICY profiles_delete_director ON public.profiles
  FOR DELETE TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.current_user_role() = 'Direktur'
    AND (auth_user_id IS NULL OR auth_user_id <> auth.uid())
  );

-- Helper macro via DO block untuk seluruh tabel tenant-scoped (SELECT, INSERT, UPDATE, DELETE)
DO $$
DECLARE
  tbl TEXT;
  tenant_tables TEXT[] := ARRAY[
    'warehouses',
    'categories',
    'uoms',
    'suppliers',
    'customers',
    'products',
    'purchase_orders',
    'purchase_order_logs',
    'sales_quotations',
    'sales_orders',
    'vendor_rfqs',
    'goods_returns',
    'inventory_batches',
    'stock_movements',
    'invoices',
    'invoice_payments',
    'chart_of_accounts',
    'journal_entries',
    'accounting_period_locks',
    'monthly_budgets'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', tbl || '_select_tenant', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (company_id = public.current_company_id());',
      tbl || '_select_tenant', tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', tbl || '_insert_tenant', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (company_id = public.current_company_id() AND public.current_user_role() NOT IN (''Viewer'', ''Angel Investor''));',
      tbl || '_insert_tenant', tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', tbl || '_update_tenant', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (company_id = public.current_company_id() AND public.current_user_role() NOT IN (''Viewer'', ''Angel Investor'')) WITH CHECK (company_id = public.current_company_id() AND public.current_user_role() NOT IN (''Viewer'', ''Angel Investor''));',
      tbl || '_update_tenant', tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', tbl || '_delete_director', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (company_id = public.current_company_id() AND public.current_user_role() = ''Direktur'');',
      tbl || '_delete_director', tbl
    );
  END LOOP;
END $$;

-- Policy: audit_logs (semua user aktif di company bisa membaca & menambah log, hanya Direktur bisa hapus)
DROP POLICY IF EXISTS audit_logs_select_tenant ON public.audit_logs;
CREATE POLICY audit_logs_select_tenant ON public.audit_logs
  FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

DROP POLICY IF EXISTS audit_logs_insert_tenant ON public.audit_logs;
CREATE POLICY audit_logs_insert_tenant ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_company_id());

DROP POLICY IF EXISTS audit_logs_delete_director ON public.audit_logs;
CREATE POLICY audit_logs_delete_director ON public.audit_logs
  FOR DELETE TO authenticated
  USING (company_id = public.current_company_id() AND public.current_user_role() = 'Direktur');

-- Policy: notifications (semua user aktif di company bisa baca & tandai dibaca, Direktur bisa hapus)
DROP POLICY IF EXISTS notifications_select_tenant ON public.notifications;
CREATE POLICY notifications_select_tenant ON public.notifications
  FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

DROP POLICY IF EXISTS notifications_insert_tenant ON public.notifications;
CREATE POLICY notifications_insert_tenant ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_company_id());

DROP POLICY IF EXISTS notifications_update_tenant ON public.notifications;
CREATE POLICY notifications_update_tenant ON public.notifications
  FOR UPDATE TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

DROP POLICY IF EXISTS notifications_delete_director ON public.notifications;
CREATE POLICY notifications_delete_director ON public.notifications
  FOR DELETE TO authenticated
  USING (company_id = public.current_company_id() AND public.current_user_role() = 'Direktur');

-- ============================================================================
-- 11. SUPABASE STORAGE BUCKET UNTUK DOKUMEN PARTNER, PO, POD & PRODUK
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('erp-documents', 'erp-documents', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS erp_docs_select ON storage.objects;
CREATE POLICY erp_docs_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'erp-documents');

DROP POLICY IF EXISTS erp_docs_insert ON storage.objects;
CREATE POLICY erp_docs_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'erp-documents');

DROP POLICY IF EXISTS erp_docs_delete ON storage.objects;
CREATE POLICY erp_docs_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'erp-documents');
