-- REAL ESTATE ANALYZER - DATABASE SCHEMA
-- Run this in Supabase SQL Editor

-- 1. DOCUMENTS
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    file_name TEXT NOT NULL,
    document_type TEXT NOT NULL CHECK (document_type IN ('portfolio', 'asset', 'rent-roll')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    email_subject TEXT,
    email_body TEXT,
    processing_error TEXT,
    raw_extraction JSONB
);

-- 2. PORTFOLIOS
CREATE TABLE portfolios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    name TEXT,
    description TEXT,
    country TEXT,
    regions TEXT[],
    purchase_price DECIMAL(18,2),
    asking_price DECIMAL(18,2),
    net_initial_yield DECIMAL(6,4),
    gross_initial_yield DECIMAL(6,4),
    annual_rent_income DECIMAL(18,2),
    monthly_rent_income DECIMAL(18,2),
    total_gla DECIMAL(12,2),
    total_plot_area DECIMAL(12,2),
    total_parking_spaces INTEGER,
    price_per_sqm DECIMAL(10,2),
    rent_per_sqm DECIMAL(10,2),
    number_of_assets INTEGER,
    walt DECIMAL(6,2),
    occupancy_rate DECIMAL(5,2),
    leh_percentage DECIMAL(5,2),
    top_tenant TEXT,
    top_tenant_share DECIMAL(5,2),
    green_building_certified BOOLEAN DEFAULT FALSE,
    green_building_type TEXT,
    developer_name TEXT,
    broker_name TEXT,
    highlights TEXT[],
    risks TEXT[]
);

-- 3. ASSETS
CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    portfolio_id UUID REFERENCES portfolios(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    name TEXT,
    asset_type TEXT,
    street TEXT,
    street_number TEXT,
    postal_code TEXT,
    city TEXT,
    state TEXT,
    country TEXT DEFAULT 'Germany',
    purchase_price DECIMAL(18,2),
    price_per_sqm DECIMAL(10,2),
    annual_rent DECIMAL(18,2),
    monthly_rent DECIMAL(18,2),
    rent_per_sqm DECIMAL(10,2),
    gla DECIMAL(12,2),
    plot_area DECIMAL(12,2),
    parking_spaces INTEGER,
    parking_spaces_underground INTEGER,
    walt DECIMAL(6,2),
    occupancy_rate DECIMAL(5,2),
    number_of_tenants INTEGER,
    anchor_tenant TEXT,
    anchor_tenant_area DECIMAL(12,2),
    planned_completion DATE,
    building_status TEXT,
    kki DECIMAL(6,2),
    catchment_population_20min INTEGER,
    green_building_certified BOOLEAN DEFAULT FALSE
);

-- 4. TENANTS
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    tenant_name TEXT NOT NULL,
    tenant_type TEXT,
    brand TEXT,
    sector TEXT,
    leased_area DECIMAL(12,2),
    annual_rent DECIMAL(18,2),
    monthly_rent DECIMAL(18,2),
    rent_per_sqm DECIMAL(10,2),
    lease_start DATE,
    lease_end DATE,
    lease_duration_years DECIMAL(4,1),
    remaining_lease_years DECIMAL(4,1),
    has_options BOOLEAN DEFAULT FALSE,
    option_details TEXT,
    number_of_options INTEGER,
    option_duration_years DECIMAL(4,1),
    indexation_type TEXT,
    indexation_details TEXT,
    indexation_threshold DECIMAL(5,2),
    indexation_adjustment DECIMAL(5,2)
);

-- 5. MARKET DATA
CREATE TABLE market_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    city TEXT,
    city_population INTEGER,
    catchment_area_population INTEGER,
    catchment_radius_minutes INTEGER,
    kki DECIMAL(6,2)
);

-- 6. KPIs
CREATE TABLE kpi_calculations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    portfolio_id UUID REFERENCES portfolios(id) ON DELETE SET NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    kpi_name TEXT NOT NULL,
    kpi_category TEXT,
    value_numeric DECIMAL(18,4),
    value_text TEXT,
    confidence_score DECIMAL(3,2)
);

-- 7. EXTRACTION LOGS
CREATE TABLE extraction_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    model_used TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    processing_time_ms INTEGER,
    raw_response JSONB,
    warnings TEXT[]
);

-- INDEXES
CREATE INDEX idx_portfolios_document ON portfolios(document_id);
CREATE INDEX idx_assets_portfolio ON assets(portfolio_id);
CREATE INDEX idx_assets_city ON assets(city);
CREATE INDEX idx_tenants_asset ON tenants(asset_id);
CREATE INDEX idx_tenants_name ON tenants(tenant_name);
