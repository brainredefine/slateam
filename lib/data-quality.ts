// lib/data-quality.ts
// =============================================================================
// Data Quality detection engine.
// Scans portfolios + their assets + their tenants and returns a list of issues
// grouped by severity. Used by /dashboard and /dashboard/data-quality.
// =============================================================================

export type IssueSeverity = 'critical' | 'derivable' | 'missing' | 'anomaly';

export interface DataQualityIssue {
  id: string;                  // stable hash, useful for React keys
  portfolioId: string;
  portfolioName: string;
  dealStatus?: string;
  investmentType?: string;
  severity: IssueSeverity;
  category: string;            // short label e.g. "Missing core field", "Derivable", "Lease data"
  field?: string;              // the field name involved (when applicable)
  description: string;         // human-readable description
  details?: string;            // optional extra info ("→ 7.42%" preview value, etc.)
  suggestedValue?: number | string; // computed value when the issue is derivable
  autoFixable: boolean;        // can be auto-fixed via /api/portfolios/[id] recalc
  targetSubpath?: string;      // tab to land on in portfolio page ('assets', 'tenants', etc.)
  acknowledged?: boolean;      // user has chosen to hide this issue
}

export interface DataQualityReport {
  totalIssues: number;          // active (un-acked) issues
  totalAcknowledged: number;    // acked issues count
  totalPortfolios: number;
  affectedPortfolios: number;
  overallScore: number;         // 0..100 completeness score (based on active only)
  scoreDelta?: number;          // optional week-over-week delta (set externally)
  byCategory: {
    critical: DataQualityIssue[];
    derivable: DataQualityIssue[];
    missing: DataQualityIssue[];
    anomaly: DataQualityIssue[];
  };
  acknowledged: DataQualityIssue[]; // separate list of acked issues
  byPortfolio: Record<string, DataQualityIssue[]>; // all issues (acked + active)
}

// =============================================================================
// Input types (subset of portfolio/asset/tenant we need)
// =============================================================================

export interface PortfolioRecord {
  id: string;
  name?: string | null;
  deal_status?: string | null;
  investment_type?: string | null;
  asset_class?: string | null;
  country?: string | null;
  region?: string | null;
  seller?: string | null;

  total_gla?: number | null;
  purchase_price?: number | null;
  spot?: number | null;
  annual_rent_income?: number | null;
  noi?: number | null;
  walt?: number | null;
  equity_on_spot?: number | null;
  number_of_assets?: number | null;

  multiplier?: number | null;
  cap_rate?: number | null;
  ltv?: number | null;
  noi_margin?: number | null;
  occupancy_rate?: number | null;
  price_per_sqm?: number | null;
  rent_per_sqm?: number | null;

  top_tenant?: string | null;
  top_tenant_share?: number | null;
  leh_percentage?: number | null;

  bid_date?: string | null;
  closing_date?: string | null;
  expected_closing?: string | null;
  updated_at?: string | null;
}

export interface AssetRecord {
  id: string;
  portfolio_id: string;
  name?: string | null;
  address?: string | null;
  city?: string | null;
  gla?: number | null;
  annual_rent?: number | null;
  noi?: number | null;
  rent_per_sqm?: number | null;
}

export interface TenantRecord {
  id: string;
  portfolio_id: string;
  asset_id?: string | null;
  tenant_name?: string | null;
  brand?: string | null;
  sector?: string | null;
  leased_area?: number | null;
  annual_rent?: number | null;
  share_of_rent?: number | null;
  lease_start?: string | null;
  lease_end?: string | null;
  remaining_lease_years?: number | null;
  is_leh?: boolean | null;
  is_vacant?: boolean | null;
}

// =============================================================================
// Helpers
// =============================================================================
const hasNum = (v: number | null | undefined): v is number =>
  typeof v === 'number' && !isNaN(v) && v > 0;

const hasVal = (v: unknown): boolean =>
  v !== null && v !== undefined && v !== '' && !(typeof v === 'number' && isNaN(v));

const hasStr = (v: string | null | undefined): v is string =>
  typeof v === 'string' && v.trim().length > 0;

// Crude vacant detection — kept aligned with portfolio-detail page logic.
const VACANT_RE = /\b(vacant|vacancy|empty|libre|free|to\s*let|disponible|non[-\s]lou[ée])\b/i;
const isVacantTenant = (t: TenantRecord): boolean => {
  if (t.is_vacant === true) return true;
  if (t.tenant_name && VACANT_RE.test(t.tenant_name)) return true;
  if (t.brand && VACANT_RE.test(t.brand)) return true;
  return false;
};

const stableId = (...parts: string[]): string => parts.join('::');

// Format helpers for descriptions
const fmtM = (v: number): string => {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toFixed(0)}`;
};
const fmtNum = (v: number, dec = 2): string =>
  v.toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtPct = (v: number): string => `${v.toFixed(1)}%`;
const fmtSqm = (v: number): string => `${Math.round(v).toLocaleString('de-DE')} m²`;

// =============================================================================
// Detection rules per portfolio
// =============================================================================

interface PortfolioScanInput {
  portfolio: PortfolioRecord;
  assets: AssetRecord[];
  tenants: TenantRecord[];
}

function scanPortfolio(input: PortfolioScanInput): DataQualityIssue[] {
  const { portfolio: p, assets, tenants } = input;
  const issues: DataQualityIssue[] = [];

  const baseMeta = {
    portfolioId: p.id,
    portfolioName: p.name || 'Unnamed portfolio',
    dealStatus: p.deal_status || undefined,
    investmentType: p.investment_type || undefined,
  };

  const push = (issue: Omit<DataQualityIssue, 'portfolioId' | 'portfolioName' | 'dealStatus' | 'investmentType'>) => {
    issues.push({ ...baseMeta, ...issue });
  };

  // ───────────────────────────────────────────────────────────────────────────
  // 🔴 CRITICAL — Missing core fields
  // ───────────────────────────────────────────────────────────────────────────
  if (!hasStr(p.name)) {
    push({
      id: stableId(p.id, 'crit', 'name'),
      severity: 'critical',
      category: 'Missing identity',
      field: 'name',
      description: 'Portfolio has no name',
      autoFixable: false,
    });
  }
  if (!hasStr(p.deal_status)) {
    push({
      id: stableId(p.id, 'crit', 'deal_status'),
      severity: 'critical',
      category: 'Missing deal context',
      field: 'deal_status',
      description: 'Missing **deal status** — not placed in any funnel stage',
      autoFixable: false,
    });
  }
  if (!hasStr(p.investment_type)) {
    push({
      id: stableId(p.id, 'crit', 'investment_type'),
      severity: 'critical',
      category: 'Missing deal context',
      field: 'investment_type',
      description: 'Missing **investment type** — excluded from comparables and type analytics',
      autoFixable: false,
    });
  }
  if (!hasNum(p.purchase_price)) {
    push({
      id: stableId(p.id, 'crit', 'purchase_price'),
      severity: 'critical',
      category: 'Missing pricing',
      field: 'purchase_price',
      description: 'Missing **asking price** — cannot compute multiplier, cap rate, or price/m²',
      autoFixable: false,
    });
  }
  if (!hasNum(p.spot)) {
    push({
      id: stableId(p.id, 'crit', 'spot'),
      severity: 'critical',
      category: 'Missing pricing',
      field: 'spot',
      description: 'Missing **spot value** — cannot compute LTV',
      autoFixable: false,
    });
  }
  if (!hasNum(p.annual_rent_income)) {
    push({
      id: stableId(p.id, 'crit', 'annual_rent_income'),
      severity: 'critical',
      category: 'Missing pricing',
      field: 'annual_rent_income',
      description: 'Missing **annual rent income** — cannot compute NOI margin, rent/m², or multiplier',
      autoFixable: false,
    });
  }
  if (!hasNum(p.noi)) {
    push({
      id: stableId(p.id, 'crit', 'noi'),
      severity: 'critical',
      category: 'Missing pricing',
      field: 'noi',
      description: 'Missing **NOI** — cap rate and NOI margin cannot be derived',
      autoFixable: false,
    });
  }
  if (!hasNum(p.walt)) {
    push({
      id: stableId(p.id, 'crit', 'walt'),
      severity: 'critical',
      category: 'Missing pricing',
      field: 'walt',
      description: 'Missing **WALT** — lease duration analysis unavailable',
      autoFixable: false,
    });
  }
  if (!hasNum(p.total_gla)) {
    push({
      id: stableId(p.id, 'crit', 'total_gla'),
      severity: 'critical',
      category: 'Missing pricing',
      field: 'total_gla',
      description: 'Missing **total GLA** — €/m² metrics unavailable',
      autoFixable: false,
    });
  }

  // Deal-stage timing
  if (['bidding', 'exclusivity', 'firm'].includes((p.deal_status || '').toLowerCase()) && !hasStr(p.bid_date)) {
    push({
      id: stableId(p.id, 'crit', 'bid_date'),
      severity: 'critical',
      category: 'Missing timing',
      field: 'bid_date',
      description: `Deal is in **${p.deal_status}** stage but has no **bid date**`,
      autoFixable: false,
    });
  }
  if ((p.deal_status || '').toLowerCase() === 'closed' && !hasStr(p.closing_date)) {
    push({
      id: stableId(p.id, 'crit', 'closing_date'),
      severity: 'critical',
      category: 'Missing timing',
      field: 'closing_date',
      description: 'Deal marked **closed** but no closing date is set',
      autoFixable: false,
    });
  }

  // Assets without name/address — missing data (asset-level, not portfolio-level)
  assets.forEach(a => {
    if (!hasStr(a.name)) {
      push({
        id: stableId(p.id, 'sec', 'asset_name', a.id),
        severity: 'missing',
        category: 'Asset incomplete',
        description: `An asset has no name`,
        autoFixable: false,
        targetSubpath: 'assets',
      });
    }
    if (!hasStr(a.address) && !hasStr(a.city)) {
      push({
        id: stableId(p.id, 'sec', 'asset_addr', a.id),
        severity: 'missing',
        category: 'Asset incomplete',
        description: `Asset **"${a.name || 'unnamed'}"** has no address — location-based analysis unavailable`,
        autoFixable: false,
        targetSubpath: 'assets',
      });
    }
  });

  // Tenants without name (non-vacant) — missing data
  const nonVacantTenants = tenants.filter(t => !isVacantTenant(t));
  nonVacantTenants.forEach(t => {
    if (!hasStr(t.tenant_name) && !hasStr(t.brand)) {
      push({
        id: stableId(p.id, 'sec', 'tenant_name', t.id),
        severity: 'missing',
        category: 'Tenant incomplete',
        description: `A non-vacant tenant has no name or brand`,
        autoFixable: false,
        targetSubpath: 'tenants',
      });
    }
    if (!hasNum(t.annual_rent)) {
      push({
        id: stableId(p.id, 'sec', 'tenant_rent', t.id),
        severity: 'missing',
        category: 'Tenant incomplete',
        description: `Tenant **${t.tenant_name || t.brand || 'unnamed'}** is non-vacant but has no annual rent`,
        autoFixable: false,
        targetSubpath: 'tenants',
      });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 🟡 DERIVABLE — Triangular and binary computations
  // ───────────────────────────────────────────────────────────────────────────

  // Triangle: GLA + purchase_price ↔ price_per_sqm
  triangleCheck({
    issues: push,
    pid: p.id,
    label: 'price/m² triangle',
    a: { name: 'GLA', val: p.total_gla, format: fmtSqm },
    b: { name: 'asking price', val: p.purchase_price, format: fmtM },
    c: { name: 'price/m²', val: p.price_per_sqm, format: (v) => `€${v.toFixed(0)}/m²` },
    computeC: (a, b) => b / a, // price_per_sqm = price / gla
    computeA: (c, b) => b / c, // gla = price / price_per_sqm
    computeB: (a, c) => a * c, // price = gla * price_per_sqm
    fieldA: 'total_gla',
    fieldB: 'purchase_price',
    fieldC: 'price_per_sqm',
  });

  // Triangle: GLA + annual_rent ↔ rent_per_sqm (MONTHLY — industry standard)
  triangleCheck({
    issues: push,
    pid: p.id,
    label: 'rent/m² triangle',
    a: { name: 'GLA', val: p.total_gla, format: fmtSqm },
    b: { name: 'annual rent', val: p.annual_rent_income, format: fmtM },
    c: { name: 'rent/m²/month', val: p.rent_per_sqm, format: (v) => `€${v.toFixed(1)}/m²/mo` },
    computeC: (a, b) => b / a / 12,     // monthly rent per sqm
    computeA: (c, b) => b / (c * 12),   // gla = annual_rent / (monthly * 12)
    computeB: (a, c) => a * c * 12,     // annual_rent = gla * monthly * 12
    fieldA: 'total_gla',
    fieldB: 'annual_rent_income',
    fieldC: 'rent_per_sqm',
  });

  // Triangle: purchase_price + annual_rent ↔ multiplier
  triangleCheck({
    issues: push,
    pid: p.id,
    label: 'multiplier triangle',
    a: { name: 'asking price', val: p.purchase_price, format: fmtM },
    b: { name: 'annual rent', val: p.annual_rent_income, format: fmtM },
    c: { name: 'multiplier', val: p.multiplier, format: (v) => `${v.toFixed(2)}×` },
    computeC: (a, b) => a / b,
    computeA: (c, b) => c * b,
    computeB: (a, c) => a / c,
    fieldA: 'purchase_price',
    fieldB: 'annual_rent_income',
    fieldC: 'multiplier',
  });

  // Triangle: purchase_price + noi ↔ cap_rate
  triangleCheck({
    issues: push,
    pid: p.id,
    label: 'cap rate triangle',
    a: { name: 'asking price', val: p.purchase_price, format: fmtM },
    b: { name: 'NOI', val: p.noi, format: fmtM },
    c: { name: 'cap rate', val: p.cap_rate, format: fmtPct },
    // cap_rate stored as percentage (e.g. 7.42), so divide computed ratio by 100 in storage convention
    computeC: (a, b) => (b / a) * 100,
    computeA: (c, b) => b / (c / 100),
    computeB: (a, c) => a * (c / 100),
    fieldA: 'purchase_price',
    fieldB: 'noi',
    fieldC: 'cap_rate',
  });

  // Triangle: noi + annual_rent ↔ noi_margin
  triangleCheck({
    issues: push,
    pid: p.id,
    label: 'noi margin triangle',
    a: { name: 'NOI', val: p.noi, format: fmtM },
    b: { name: 'annual rent', val: p.annual_rent_income, format: fmtM },
    c: { name: 'NOI margin', val: p.noi_margin, format: fmtPct },
    computeC: (a, b) => (a / b) * 100,
    computeA: (c, b) => b * (c / 100),
    computeB: (a, c) => a / (c / 100),
    fieldA: 'noi',
    fieldB: 'annual_rent_income',
    fieldC: 'noi_margin',
  });

  // Triangle: spot + equity ↔ LTV (debt-based)
  triangleCheck({
    issues: push,
    pid: p.id,
    label: 'LTV triangle',
    a: { name: 'spot', val: p.spot, format: fmtM },
    b: { name: 'equity on spot', val: p.equity_on_spot, format: fmtM },
    c: { name: 'LTV', val: p.ltv, format: fmtPct },
    // ltv = (spot - equity) / spot, stored as %
    computeC: (a, b) => ((a - b) / a) * 100,
    computeA: (c, b) => b / (1 - c / 100),
    computeB: (a, c) => a * (1 - c / 100),
    fieldA: 'spot',
    fieldB: 'equity_on_spot',
    fieldC: 'ltv',
  });

  // Tenants exist → top_tenant should be set
  if (tenants.length > 0 && !hasStr(p.top_tenant)) {
    const withRent = nonVacantTenants.filter(t => hasNum(t.annual_rent));
    if (withRent.length > 0) {
      const top = withRent.sort((a, b) => (b.annual_rent || 0) - (a.annual_rent || 0))[0];
      push({
        id: stableId(p.id, 'der', 'top_tenant'),
        severity: 'derivable',
        category: 'Derivable',
        field: 'top_tenant',
        description: `**Top tenant** not identified — ${withRent.length} tenants with rent data exist`,
        details: top.tenant_name || top.brand || 'unknown tenant',
        suggestedValue: top.tenant_name || top.brand || undefined,
        autoFixable: true,
      });
    }
  }

  // LEH percentage derivable if tenants tagged
  if (!hasNum(p.leh_percentage) && tenants.length > 0) {
    const tagged = tenants.filter(t => t.is_leh !== null && t.is_leh !== undefined);
    if (tagged.length >= tenants.length * 0.7) {
      const totalRent = tenants.reduce((s, t) => s + (t.annual_rent || 0), 0);
      const lehRent = tenants.filter(t => t.is_leh).reduce((s, t) => s + (t.annual_rent || 0), 0);
      if (totalRent > 0) {
        const pct = (lehRent / totalRent) * 100;
        push({
          id: stableId(p.id, 'der', 'leh_percentage'),
          severity: 'derivable',
          category: 'Derivable',
          field: 'leh_percentage',
          description: `**LEH percentage** not computed — ${tagged.length} of ${tenants.length} tenants tagged`,
          details: `→ ${fmtPct(pct)}`,
          suggestedValue: pct,
          autoFixable: true,
        });
      }
    }
  }

  // Aggregation: Σ asset.gla → portfolio.total_gla
  if (!hasNum(p.total_gla) && assets.length > 0) {
    const withGla = assets.filter(a => hasNum(a.gla));
    if (withGla.length === assets.length) {
      const sum = withGla.reduce((s, a) => s + (a.gla || 0), 0);
      push({
        id: stableId(p.id, 'der', 'total_gla_agg'),
        severity: 'derivable',
        category: 'Derivable from aggregation',
        field: 'total_gla',
        description: `**Total GLA** not set — ${assets.length} assets sum to ${fmtSqm(sum)}`,
        details: `→ ${fmtSqm(sum)}`,
        suggestedValue: sum,
        autoFixable: true,
      });
    }
  }

  // Aggregation: Σ asset.annual_rent → portfolio.annual_rent_income
  if (!hasNum(p.annual_rent_income) && assets.length > 0) {
    const withRent = assets.filter(a => hasNum(a.annual_rent));
    if (withRent.length === assets.length) {
      const sum = withRent.reduce((s, a) => s + (a.annual_rent || 0), 0);
      push({
        id: stableId(p.id, 'der', 'annual_rent_agg'),
        severity: 'derivable',
        category: 'Derivable from aggregation',
        field: 'annual_rent_income',
        description: `**Annual rent income** not set — ${assets.length} assets sum to ${fmtM(sum)}`,
        details: `→ ${fmtM(sum)}`,
        suggestedValue: sum,
        autoFixable: true,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 📅 LEASE — WALT / lease data completeness
  // ───────────────────────────────────────────────────────────────────────────

  if (nonVacantTenants.length > 0) {
    // Tenants with rent but no remaining lease
    const noRemaining = nonVacantTenants.filter(t => hasNum(t.annual_rent) && !hasNum(t.remaining_lease_years));
    if (noRemaining.length > 0) {
      push({
        id: stableId(p.id, 'lease', 'no_remaining'),
        severity: 'missing',
        category: 'Lease data',
        description: `${noRemaining.length} of ${nonVacantTenants.length} tenants have **annual rent** but no **remaining lease years** — WALT may be biased`,
        autoFixable: false,
        targetSubpath: 'tenants',
      });
    }

    // Tenants with lease_start but no lease_end and no remaining
    const noEnd = nonVacantTenants.filter(t =>
      hasStr(t.lease_start) && !hasStr(t.lease_end) && !hasNum(t.remaining_lease_years)
    );
    if (noEnd.length > 0) {
      push({
        id: stableId(p.id, 'lease', 'no_end'),
        severity: 'missing',
        category: 'Lease data',
        description: `${noEnd.length} tenant${noEnd.length > 1 ? 's' : ''} have a **lease start** but no **lease end** or remaining duration`,
        autoFixable: false,
        targetSubpath: 'tenants',
      });
    }

    // Tenants completely without any lease data
    const noLeaseAtAll = nonVacantTenants.filter(t =>
      !hasStr(t.lease_start) && !hasStr(t.lease_end) && !hasNum(t.remaining_lease_years)
    );
    if (noLeaseAtAll.length > 0) {
      push({
        id: stableId(p.id, 'lease', 'no_lease_data'),
        severity: 'missing',
        category: 'Lease data',
        description: `${noLeaseAtAll.length} non-vacant tenant${noLeaseAtAll.length > 1 ? 's have' : ' has'} **no lease dates at all**`,
        autoFixable: false,
        targetSubpath: 'tenants',
      });
    }

    // Tenants with remaining but no lease_start (untraceable origin)
    const remainingNoStart = nonVacantTenants.filter(t =>
      hasNum(t.remaining_lease_years) && !hasStr(t.lease_start)
    );
    if (remainingNoStart.length > 0) {
      push({
        id: stableId(p.id, 'lease', 'remaining_no_start'),
        severity: 'missing',
        category: 'Lease data',
        description: `${remainingNoStart.length} tenant${remainingNoStart.length > 1 ? 's have' : ' has'} **remaining lease years** but no **lease start date** — origin untraceable`,
        autoFixable: false,
        targetSubpath: 'tenants',
      });
    }

    // Portfolio WALT exists but lease coverage < 70%
    if (hasNum(p.walt)) {
      const withLease = nonVacantTenants.filter(t => hasNum(t.remaining_lease_years));
      const coverage = withLease.length / nonVacantTenants.length;
      if (coverage < 0.7) {
        push({
          id: stableId(p.id, 'lease', 'walt_low_coverage'),
          severity: 'missing',
          category: 'Lease data',
          description: `Portfolio WALT exists (${fmtNum(p.walt as number, 1)}y) but only **${Math.round(coverage * 100)}%** of tenants have lease data backing it`,
          autoFixable: false,
          targetSubpath: 'tenants',
        });
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ⚠️ ANOMALIES — Suspicious values
  // ───────────────────────────────────────────────────────────────────────────

  // Out-of-physical-bounds values
  if (hasNum(p.occupancy_rate) && ((p.occupancy_rate as number) > 100 || (p.occupancy_rate as number) < 0)) {
    push({
      id: stableId(p.id, 'ano', 'occupancy_bounds'),
      severity: 'anomaly',
      category: 'Anomaly',
      field: 'occupancy_rate',
      description: `**Occupancy rate = ${fmtPct(p.occupancy_rate as number)}** — impossible value`,
      autoFixable: false,
    });
  }
  if (hasNum(p.noi_margin) && ((p.noi_margin as number) > 100 || (p.noi_margin as number) < 0)) {
    push({
      id: stableId(p.id, 'ano', 'noi_margin_bounds'),
      severity: 'anomaly',
      category: 'Anomaly',
      field: 'noi_margin',
      description: `**NOI margin = ${fmtPct(p.noi_margin as number)}** — out of [0,100] range`,
      autoFixable: false,
    });
  }
  if (hasNum(p.ltv) && ((p.ltv as number) > 100 || (p.ltv as number) < 0)) {
    push({
      id: stableId(p.id, 'ano', 'ltv_bounds'),
      severity: 'anomaly',
      category: 'Anomaly',
      field: 'ltv',
      description: `**LTV = ${fmtPct(p.ltv as number)}** — out of [0,100] range`,
      autoFixable: false,
    });
  }
  if (hasNum(p.leh_percentage) && (p.leh_percentage as number) > 100) {
    push({
      id: stableId(p.id, 'ano', 'leh_bounds'),
      severity: 'anomaly',
      category: 'Anomaly',
      field: 'leh_percentage',
      description: `**LEH percentage = ${fmtPct(p.leh_percentage as number)}** — over 100%`,
      autoFixable: false,
    });
  }

  // Out-of-realistic-range warnings
  if (hasNum(p.cap_rate) && ((p.cap_rate as number) < 2 || (p.cap_rate as number) > 12)) {
    push({
      id: stableId(p.id, 'ano', 'cap_rate_range'),
      severity: 'anomaly',
      category: 'Anomaly',
      field: 'cap_rate',
      description: `**Cap rate = ${fmtPct(p.cap_rate as number)}** — extreme value, verify NOI or purchase price`,
      autoFixable: false,
    });
  }
  if (hasNum(p.multiplier) && ((p.multiplier as number) < 5 || (p.multiplier as number) > 25)) {
    push({
      id: stableId(p.id, 'ano', 'multiplier_range'),
      severity: 'anomaly',
      category: 'Anomaly',
      field: 'multiplier',
      description: `**Multiplier = ${fmtNum(p.multiplier as number)}×** — extreme value`,
      autoFixable: false,
    });
  }
  if (hasNum(p.walt) && (p.walt as number) > 30) {
    push({
      id: stableId(p.id, 'ano', 'walt_range'),
      severity: 'anomaly',
      category: 'Anomaly',
      field: 'walt',
      description: `**WALT = ${fmtNum(p.walt as number, 1)} years** — likely typo, average lease is 5–15 years`,
      autoFixable: false,
    });
  }

  // Logical impossibility: noi > rent
  if (hasNum(p.noi) && hasNum(p.annual_rent_income) && (p.noi as number) > (p.annual_rent_income as number)) {
    push({
      id: stableId(p.id, 'ano', 'noi_gt_rent'),
      severity: 'anomaly',
      category: 'Anomaly',
      description: `**NOI (${fmtM(p.noi as number)}) > Annual rent (${fmtM(p.annual_rent_income as number)})** — logically impossible`,
      autoFixable: false,
    });
  }

  // Mismatch: portfolio NOI vs sum of asset NOIs.
  // We only flag this when ALL assets have a non-null NOI (otherwise the sum
  // is incomplete and meaningless). Tolerance: 2% relative.
  if (hasNum(p.noi) && assets.length > 0) {
    const allHaveNoi = assets.every(a => hasNum((a as any).noi));
    if (allHaveNoi) {
      const sumAssetNoi = assets.reduce((s, a) => s + ((a as any).noi as number), 0);
      const diff = Math.abs(sumAssetNoi - (p.noi as number)) / Math.max(sumAssetNoi, p.noi as number);
      if (diff > 0.02) {
        push({
          id: stableId(p.id, 'ano', 'noi_portfolio_vs_assets'),
          severity: 'anomaly',
          category: 'Inconsistency',
          description: `**Portfolio NOI (${fmtM(p.noi as number)}) ≠ Σ asset NOI (${fmtM(sumAssetNoi)})** — ${Math.round(diff * 100)}% gap. Asset values were changed but not propagated.`,
          autoFixable: false,
        });
      }
    }
  }

  // Asking vs spot huge gap
  if (hasNum(p.purchase_price) && hasNum(p.spot)) {
    const ratio = (p.purchase_price as number) / (p.spot as number);
    if (ratio > 2 || ratio < 0.5) {
      push({
        id: stableId(p.id, 'ano', 'asking_spot_gap'),
        severity: 'anomaly',
        category: 'Anomaly',
        description: `**Asking price (${fmtM(p.purchase_price as number)}) and spot value (${fmtM(p.spot as number)}) diverge by ${ratio > 1 ? '+' : ''}${((ratio - 1) * 100).toFixed(0)}%** — verify both`,
        autoFixable: false,
      });
    }
  }

  // Asset with gla=0 but rent>0 — missing GLA data, not an anomaly
  assets.forEach(a => {
    if ((a.gla === 0 || a.gla === null) && hasNum(a.annual_rent)) {
      push({
        id: stableId(p.id, 'mis', 'asset_no_gla_with_rent', a.id),
        severity: 'missing',
        category: 'Missing GLA',
        description: `Asset **"${a.name || 'unnamed'}"** has no GLA but generates ${fmtM(a.annual_rent as number)} of rent`,
        autoFixable: false,
        targetSubpath: 'assets',
      });
    }
  });

  // Portfolio annual_rent > 0 but no tenants — missing tenant data, not anomaly
  if (hasNum(p.annual_rent_income) && tenants.length === 0) {
    push({
      id: stableId(p.id, 'mis', 'rent_no_tenants'),
      severity: 'missing',
      category: 'Missing tenants',
      description: `Portfolio has ${fmtM(p.annual_rent_income as number)} of annual rent but **no tenants** are recorded`,
      autoFixable: false,
      targetSubpath: 'tenants',
    });
  }

  // Vacant tenants with rent > 0
  tenants.forEach(t => {
    if (isVacantTenant(t) && hasNum(t.annual_rent)) {
      push({
        id: stableId(p.id, 'ano', 'vacant_with_rent', t.id),
        severity: 'anomaly',
        category: 'Anomaly',
        description: `Tenant **"${t.tenant_name || t.brand || 'vacant unit'}"** is marked vacant but has ${fmtM(t.annual_rent as number)} of rent`,
        autoFixable: false,
        targetSubpath: 'tenants',
      });
    }
  });

  // Aggregation mismatches
  if (hasNum(p.total_gla) && assets.length > 0) {
    const sumGla = assets.reduce((s, a) => s + (a.gla || 0), 0);
    if (sumGla > 0) {
      const diff = Math.abs(sumGla - (p.total_gla as number)) / (p.total_gla as number);
      if (diff > 0.05) {
        push({
          id: stableId(p.id, 'ano', 'gla_mismatch'),
          severity: 'anomaly',
          category: 'Anomaly',
          description: `Sum of **asset GLA (${fmtSqm(sumGla)}) ≠ portfolio total GLA (${fmtSqm(p.total_gla as number)})** — ${Math.round(diff * 100)}% mismatch`,
          autoFixable: false,
        });
      }
    }
  }

  if (hasNum(p.annual_rent_income) && tenants.length > 0) {
    const sumRent = tenants.reduce((s, t) => s + (t.annual_rent || 0), 0);
    if (sumRent > 0) {
      const diff = Math.abs(sumRent - (p.annual_rent_income as number)) / (p.annual_rent_income as number);
      if (diff > 0.10) {
        push({
          id: stableId(p.id, 'ano', 'rent_mismatch'),
          severity: 'anomaly',
          category: 'Anomaly',
          description: `Sum of **tenant rents (${fmtM(sumRent)}) ≠ portfolio annual_rent (${fmtM(p.annual_rent_income as number)})** — ${Math.round(diff * 100)}% gap`,
          autoFixable: false,
          targetSubpath: 'tenants',
        });
      }
    }
  }

  if (hasNum(p.number_of_assets) && assets.length > 0 && assets.length !== p.number_of_assets) {
    push({
      id: stableId(p.id, 'ano', 'asset_count_mismatch'),
      severity: 'anomaly',
      category: 'Anomaly',
      description: `Portfolio declares **${p.number_of_assets} assets** but ${assets.length} are recorded in the database`,
      autoFixable: false,
      targetSubpath: 'assets',
    });
  }

  // Tenant share of rent > 100
  tenants.forEach(t => {
    if (hasNum(t.share_of_rent) && (t.share_of_rent as number) > 100) {
      push({
        id: stableId(p.id, 'ano', 'share_over_100', t.id),
        severity: 'anomaly',
        category: 'Anomaly',
        description: `Tenant **"${t.tenant_name || t.brand}"** has share of rent = ${fmtPct(t.share_of_rent as number)} — over 100%`,
        autoFixable: false,
        targetSubpath: 'tenants',
      });
    }
  });

  // Sum of tenant shares should be ≈ 100%
  if (tenants.length > 0) {
    const withShare = tenants.filter(t => hasNum(t.share_of_rent));
    if (withShare.length === tenants.length) {
      const sum = withShare.reduce((s, t) => s + (t.share_of_rent || 0), 0);
      if (sum > 105 || sum < 95) {
        push({
          id: stableId(p.id, 'ano', 'share_sum'),
          severity: 'anomaly',
          category: 'Anomaly',
          description: `Sum of tenant rent shares = **${fmtPct(sum)}** (should be ~100%)`,
          autoFixable: false,
          targetSubpath: 'tenants',
        });
      }
    }
  }

  return issues;
}

// =============================================================================
// Triangle check helper — handles all 3 directions of 2-of-3 → derivable
// =============================================================================
type Pusher = (issue: Omit<DataQualityIssue, 'portfolioId' | 'portfolioName' | 'dealStatus' | 'investmentType'>) => void;

interface TrianglePoint {
  name: string;
  val: number | null | undefined;
  format: (v: number) => string;
}

interface TriangleCheckOptions {
  issues: Pusher;
  pid: string;
  label: string;
  a: TrianglePoint;
  b: TrianglePoint;
  c: TrianglePoint;
  computeC: (a: number, b: number) => number;
  computeA: (c: number, b: number) => number;
  computeB: (a: number, c: number) => number;
  fieldA: string;
  fieldB: string;
  fieldC: string;
}

function triangleCheck(opts: TriangleCheckOptions) {
  const { issues: push, pid, a, b, c, computeC, computeA, computeB, fieldA, fieldB, fieldC } = opts;
  const ha = hasNum(a.val);
  const hb = hasNum(b.val);
  const hc = hasNum(c.val);

  // If 2 of 3 are present, the 3rd is derivable.
  if (ha && hb && !hc) {
    const computed = computeC(a.val as number, b.val as number);
    if (!isFinite(computed) || computed <= 0) return;
    push({
      id: stableId(pid, 'der', fieldC),
      severity: 'derivable',
      category: 'Derivable',
      field: fieldC,
      description: `**${capitalize(c.name)}** not computed — ${a.name} (${a.format(a.val as number)}) + ${b.name} (${b.format(b.val as number)}) available`,
      details: `→ ${c.format(computed)}`,
      suggestedValue: computed,
      autoFixable: true,
    });
    return;
  }
  if (ha && !hb && hc) {
    const computed = computeB(a.val as number, c.val as number);
    if (!isFinite(computed) || computed <= 0) return;
    push({
      id: stableId(pid, 'der', fieldB),
      severity: 'derivable',
      category: 'Derivable',
      field: fieldB,
      description: `**${capitalize(b.name)}** not set — ${a.name} (${a.format(a.val as number)}) + ${c.name} (${c.format(c.val as number)}) available`,
      details: `→ ${b.format(computed)}`,
      suggestedValue: computed,
      autoFixable: true,
    });
    return;
  }
  if (!ha && hb && hc) {
    const computed = computeA(c.val as number, b.val as number);
    if (!isFinite(computed) || computed <= 0) return;
    push({
      id: stableId(pid, 'der', fieldA),
      severity: 'derivable',
      category: 'Derivable',
      field: fieldA,
      description: `**${capitalize(a.name)}** not set — ${b.name} (${b.format(b.val as number)}) + ${c.name} (${c.format(c.val as number)}) available`,
      details: `→ ${a.format(computed)}`,
      suggestedValue: computed,
      autoFixable: true,
    });
    return;
  }

  // If all 3 present, verify consistency. Tolerance: 2% relative.
  if (ha && hb && hc) {
    const expectedC = computeC(a.val as number, b.val as number);
    if (!isFinite(expectedC) || expectedC <= 0) return;
    const diff = Math.abs(expectedC - (c.val as number)) / Math.max(expectedC, c.val as number);
    if (diff > 0.02) {
      push({
        id: stableId(pid, 'ano', fieldA, fieldB, fieldC),
        severity: 'anomaly',
        category: 'Inconsistency',
        description: `**${capitalize(c.name)} (${c.format(c.val as number)})** doesn't match ${a.name} & ${b.name} (expected ${c.format(expectedC)}) — ${Math.round(diff * 100)}% gap`,
        autoFixable: false,
      });
    }
  }
}

const capitalize = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

// =============================================================================
// Public API
// =============================================================================

export function buildDataQualityReport(
  portfolios: PortfolioRecord[],
  assets: AssetRecord[],
  tenants: TenantRecord[],
  acknowledgedIds: Set<string> = new Set(),
): DataQualityReport {

  // Group assets by portfolio_id for fast lookup
  const assetsByPortfolio: Record<string, AssetRecord[]> = {};
  for (const a of assets) {
    if (!assetsByPortfolio[a.portfolio_id]) assetsByPortfolio[a.portfolio_id] = [];
    assetsByPortfolio[a.portfolio_id].push(a);
  }

  // Build asset_id → portfolio_id index, so we can resolve tenants that are
  // linked only via asset_id (no direct portfolio_id).
  const assetIdToPortfolioId: Record<string, string> = {};
  for (const a of assets) {
    assetIdToPortfolioId[a.id] = a.portfolio_id;
  }

  // Group tenants by portfolio_id. A tenant can be attached either:
  //   - directly via tenant.portfolio_id, OR
  //   - indirectly via tenant.asset_id → assets.portfolio_id
  // We resolve the indirect case using the index above.
  const tenantsByPortfolio: Record<string, TenantRecord[]> = {};
  for (const t of tenants) {
    let pid = t.portfolio_id;
    if (!pid && t.asset_id && assetIdToPortfolioId[t.asset_id]) {
      pid = assetIdToPortfolioId[t.asset_id];
    }
    if (!pid) continue; // tenant orphan, ignore
    if (!tenantsByPortfolio[pid]) tenantsByPortfolio[pid] = [];
    tenantsByPortfolio[pid].push(t);
  }

  const allIssues: DataQualityIssue[] = [];
  const byPortfolio: Record<string, DataQualityIssue[]> = {};
  const affectedSet = new Set<string>();

  for (const p of portfolios) {
    const issues = scanPortfolio({
      portfolio: p,
      assets: assetsByPortfolio[p.id] || [],
      tenants: tenantsByPortfolio[p.id] || [],
    });

    // Tag each issue with acknowledged flag
    issues.forEach(i => {
      if (acknowledgedIds.has(i.id)) i.acknowledged = true;
    });

    if (issues.length > 0) {
      byPortfolio[p.id] = issues;
      // Only count portfolios with at least one un-acked issue as "affected"
      if (issues.some(i => !i.acknowledged)) affectedSet.add(p.id);
      allIssues.push(...issues);
    }
  }

  // Active issues = not acknowledged
  const activeIssues = allIssues.filter(i => !i.acknowledged);

  // Group by severity (active only — acked goes in byCategoryAcked)
  const byCategory = {
    critical: activeIssues.filter(i => i.severity === 'critical'),
    derivable: activeIssues.filter(i => i.severity === 'derivable'),
    missing: activeIssues.filter(i => i.severity === 'missing'),
    anomaly: activeIssues.filter(i => i.severity === 'anomaly'),
  };

  const acked = allIssues.filter(i => i.acknowledged);

  // Completeness score: based on active issues only
  // Weights:
  //   - critical:  -3 (portfolio-level missing core field)
  //   - anomaly:   -2 (suspicious/impossible/inconsistent value)
  //   - derivable: -1 (auto-fixable)
  //   - missing:   -0.5 (tenant/asset level data gap)
  const totalMaxPoints = portfolios.length * 20;
  let lostPoints = 0;
  for (const pid in byPortfolio) {
    const issues = byPortfolio[pid].filter(i => !i.acknowledged);
    let portfolioLoss = 0;
    issues.forEach(i => {
      const weight =
        i.severity === 'critical'  ? 3 :
        i.severity === 'anomaly'   ? 2 :
        i.severity === 'derivable' ? 1 :
        /* missing */                0.5;
      portfolioLoss += weight;
    });
    lostPoints += Math.min(portfolioLoss, 20);
  }
  const overallScore = portfolios.length === 0 ? 100 : Math.max(0, Math.round((1 - lostPoints / totalMaxPoints) * 100));

  return {
    totalIssues: activeIssues.length,
    totalAcknowledged: acked.length,
    totalPortfolios: portfolios.length,
    affectedPortfolios: affectedSet.size,
    overallScore,
    byCategory,
    acknowledged: acked,
    byPortfolio,
  };
}

// =============================================================================
// Severity → UI metadata (for shared use across pages)
// =============================================================================

export const SEVERITY_META: Record<IssueSeverity, {
  label: string;
  color: string;
  bgClass: string;
  bgSoftClass: string;
  textClass: string;
  borderClass: string;
  dotClass: string;
  buttonClass: string;
  description: string;
}> = {
  critical: {
    label: 'Critical',
    color: '#dc2626',
    bgClass: 'bg-red-500',
    bgSoftClass: 'bg-red-50',
    textClass: 'text-red-700',
    borderClass: 'border-red-200',
    dotClass: 'bg-red-500',
    buttonClass: 'bg-zinc-900 hover:bg-zinc-700 text-white',
    description: 'Missing core fields',
  },
  derivable: {
    label: 'Derivable',
    color: '#d97706',
    bgClass: 'bg-amber-500',
    bgSoftClass: 'bg-amber-50',
    textClass: 'text-amber-700',
    borderClass: 'border-amber-200',
    dotClass: 'bg-amber-500',
    buttonClass: 'bg-amber-100 hover:bg-amber-200 text-amber-900',
    description: 'Computable from existing data',
  },
  missing: {
    label: 'Missing',
    color: '#475569',
    bgClass: 'bg-slate-500',
    bgSoftClass: 'bg-slate-50',
    textClass: 'text-slate-700',
    borderClass: 'border-slate-200',
    dotClass: 'bg-slate-500',
    buttonClass: 'bg-slate-100 hover:bg-slate-200 text-slate-700',
    description: 'Tenant/asset data not provided',
  },
  anomaly: {
    label: 'Anomaly',
    color: '#2563eb',
    bgClass: 'bg-blue-500',
    bgSoftClass: 'bg-blue-50',
    textClass: 'text-blue-700',
    borderClass: 'border-blue-200',
    dotClass: 'bg-blue-500',
    buttonClass: 'bg-blue-100 hover:bg-blue-200 text-blue-900',
    description: 'Suspicious or inconsistent values',
  },
};