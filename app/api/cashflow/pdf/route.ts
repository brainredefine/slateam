import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

async function getBrowser() {
  if (process.env.VERCEL_ENV || process.env.NODE_ENV === 'production') {
    const chromium = (await import('@sparticuz/chromium-min')).default;
    const puppeteer = (await import('puppeteer-core')).default;
    const executablePath = await chromium.executablePath(
      'https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar'
    );
    return puppeteer.launch({
      args: chromium.args,
      executablePath,
      headless: true,
    });
  } else {
    const puppeteer = (await import('puppeteer')).default;
    return puppeteer.launch({ headless: true });
  }
}

export async function POST(request: NextRequest) {
  let browser;
  try {
    const data = await request.json();
    const { cashflowResults, assets, assumptions } = data;

    const html = generatePDFHtml(cashflowResults, assets || [], assumptions || {});

    browser = await getBrowser();
    const page = await browser.newPage();

    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
    });

    await browser.close();

    return new NextResponse(Buffer.from(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Cashflow_Report_${new Date().toISOString().split('T')[0]}.pdf"`,
      },
    });
  } catch (error: any) {
    console.error('PDF generation error:', error?.message || error);
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
    return NextResponse.json({ error: 'PDF generation failed', details: error?.message }, { status: 500 });
  }
}

/* ============================================================================
 * HTML GENERATOR — Cashflow Model V4.1
 * ============================================================================ */
function generatePDFHtml(cf: any, assets: any[], assumptions: any): string {
  const years: number[] = cf.years || [];
  const numYears = years.length;
  const totalGla = assets.reduce((s: number, a: any) => s + (a.gla || a.total_gla || 0), 0);
  const totalSpot = assets.reduce((s: number, a: any) => s + (a.spot_price || 0), 0);
  const totalRent = assets.reduce((s: number, a: any) => s + (a.annual_rent || 0), 0);
  const avgYield = totalSpot > 0 ? ((totalRent / totalSpot) * 100).toFixed(2) : '—';
  const avgExitMultiple = totalSpot > 0
    ? assets.reduce((sum: number, a: any) => sum + (a.exit_rent_multiple || 0) * ((a.spot_price || 0) / totalSpot), 0)
    : (assumptions.default_exit_rent_multiple || 0);
  const cfAfterDebt = (cf.cf_before_debt || []).map((v: number, i: number) =>
    i === 0 ? 0 : v - (cf.interest?.[i] || 0) - (cf.amortization?.[i] || 0)
  );

  const fK = (v: number) => {
    if (v === 0 || v === undefined || v === null) return '—';
    return '€' + Math.abs(Math.round(v / 1000)).toLocaleString('en-US') + 'k';
  };
  const fSigned = (v: number, invert = false) => {
    if (v === 0 || v === undefined || v === null) return '—';
    const val = invert ? -v : v;
    return val < 0 ? `(${fK(Math.abs(val))})` : fK(val);
  };
  const fM = (v: number) => {
    if (!v && v !== 0) return '—';
    return '€' + (v / 1_000_000).toFixed(2) + 'M';
  };
  const pct = (v: number, d = 2) => (v != null ? v.toFixed(d) + '%' : '—');
  const mul = (v: number, d = 2) => (v != null ? v.toFixed(d) + '×' : '—');
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  // ── Table font size adaptive ──
  const tFs = numYears <= 8 ? '9px' : numYears <= 11 ? '8px' : '7px';
  const tHFs = numYears <= 8 ? '7.5px' : numYears <= 11 ? '7px' : '6px';

  // ── Cashflow row helpers ──
  const cfRow = (label: string, arr: number[], opts: { invert?: boolean; skipY0?: boolean; nz?: boolean; cls?: string } = {}) => {
    const { invert = false, skipY0 = true, nz = false, cls = '' } = opts;
    const cells = (arr || []).map((v: number, i: number) => {
      if (i === 0 && skipY0) return '<td>—</td>';
      if (nz && v === 0) return '<td>—</td>';
      return `<td>${fSigned(v, invert)}</td>`;
    }).join('');
    return `<tr class="${cls}"><td class="lbl">${label}</td>${cells}</tr>`;
  };

  const y0Row = (label: string, value: number, cls = '') => {
    const cells = years.map((y: number) => y === 0 ? `<td>${fSigned(value)}</td>` : '<td>—</td>').join('');
    return `<tr class="${cls}"><td class="lbl">${label}</td>${cells}</tr>`;
  };

  // ── ASSUMPTION ROW ──
  const aRow = (label: string, val: string) =>
    `<div class="a-row"><span class="a-l">${label}</span><span class="a-v">${val}</span></div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @page { margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, Helvetica, Arial, sans-serif;
    font-size: 10px;
    color: #18181b;
    background: #fff;
    line-height: 1.4;
    -webkit-font-smoothing: antialiased;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ═══ PAGE ═══ */
  .page { width: 100%; padding: 22px 26px 32px; page-break-after: always; position: relative; min-height: 100vh; }
  .page:last-child { page-break-after: avoid; }

  /* ═══ HEADER ═══ */
  .hdr { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 12px; border-bottom: 2.5px solid #18181b; margin-bottom: 18px; }
  .hdr h1 { font-size: 18px; font-weight: 800; letter-spacing: -0.4px; color: #18181b; line-height: 1.1; }
  .hdr .sub { font-size: 9px; color: #71717a; margin-top: 2px; font-weight: 400; }
  .hdr-r { text-align: right; }
  .hdr-r .brand { font-weight: 700; font-size: 10px; color: #18181b; letter-spacing: -0.2px; }
  .hdr-r .date { font-size: 8px; color: #a1a1aa; margin-top: 1px; }

  /* ═══ FOOTER ═══ */
  .ftr { position: absolute; bottom: 14px; left: 26px; right: 26px; display: flex; justify-content: space-between; font-size: 7px; color: #a1a1aa; border-top: 1px solid #e4e4e7; padding-top: 6px; }

  /* ═══ KPI STRIP ═══ */
  .kpi-strip { display: grid; grid-template-columns: repeat(8, 1fr); gap: 8px; margin-bottom: 18px; }
  .kb { border: 1px solid #e4e4e7; border-radius: 6px; padding: 8px 10px; background: #fafafa; }
  .kb.dark { background: #18181b; border-color: #18181b; }
  .kb .kl { font-size: 6.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.7px; color: #a1a1aa; margin-bottom: 3px; }
  .kb .kv { font-size: 13px; font-weight: 700; color: #18181b; }
  .kb.dark .kv { color: #fff; }

  /* ═══ SECTION TITLE ═══ */
  .stitle { font-size: 11px; font-weight: 700; color: #18181b; margin-bottom: 8px; padding-bottom: 5px; border-bottom: 1.5px solid #e4e4e7; letter-spacing: -0.1px; }

  /* ═══ DUAL KPI CARDS ═══ */
  .kpi-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
  .kc { border: 1px solid #e4e4e7; border-radius: 8px; overflow: hidden; background: #fff; }
  .kc-h { padding: 6px 12px; font-size: 7px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.7px; background: #f4f4f5; color: #52525b; border-bottom: 1px solid #e4e4e7; }
  .kc-b { padding: 10px 12px; }
  .kc-r { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; }
  .kc-r + .kc-r { border-top: 1px solid #f4f4f5; }
  .kc-r .t { font-size: 8px; color: #71717a; }
  .kc-r .v { font-size: 13px; font-weight: 700; color: #18181b; }

  /* ═══ TABLES ═══ */
  table { width: 100%; border-collapse: collapse; font-size: ${tFs}; }
  th, td { padding: 4.5px 5px; text-align: right; white-space: nowrap; }
  th { background: #18181b; color: #fff; font-weight: 600; font-size: ${tHFs}; text-transform: uppercase; letter-spacing: 0.4px; border: none; }
  th:first-child { text-align: left; }
  td { border-bottom: 1px solid #f4f4f5; color: #3f3f46; }
  td.lbl { text-align: left; font-weight: 500; color: #3f3f46; min-width: 130px; }
  tbody tr:nth-child(even) { background: #fafafb; }

  /* Row styles */
  .sec td { background: #f4f4f5 !important; font-weight: 700; font-size: ${tHFs}; text-transform: uppercase; letter-spacing: 0.5px; color: #52525b; border-bottom: 1px solid #e4e4e7; padding: 6px 5px; }
  .sub td { font-weight: 600; color: #18181b; border-bottom: 1.5px solid #d4d4d8; background: #fafafa !important; }
  .sub td.lbl { font-weight: 700; }
  .rg td { font-weight: 700; color: #18181b; background: #f0fdf4 !important; border-top: 2px solid #18181b; border-bottom: 2px solid #18181b; font-size: calc(${tFs} + 0.5px); }
  .rg td.lbl { color: #166534; }
  .rn td { font-weight: 700; color: #18181b; background: #ecfdf5 !important; border-bottom: 2px solid #18181b; font-size: calc(${tFs} + 0.5px); }
  .rn td.lbl { color: #14532d; }

  /* Assets table */
  .at td { font-size: 8.5px; }
  .at .tot td { font-weight: 700; background: #f4f4f5 !important; border-top: 2px solid #18181b; color: #18181b; }

  /* ═══ ASSUMPTIONS GRID ═══ */
  .agrid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 20px; }
  .acard { border: 1px solid #e4e4e7; border-radius: 6px; overflow: hidden; }
  .acard-h { padding: 6px 10px; font-size: 7px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.7px; background: #18181b; color: #fff; }
  .acard-b { padding: 6px 10px; }
  .a-row { display: flex; justify-content: space-between; padding: 3.5px 0; font-size: 8px; }
  .a-row + .a-row { border-top: 1px solid #f4f4f5; }
  .a-l { color: #71717a; }
  .a-v { font-weight: 600; color: #18181b; }

  /* ═══ SOURCES & USES ═══ */
  .su-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .su-grid table { font-size: 8.5px; }
  .su-grid th { font-size: 7px; }
  .su-grid .total td { font-weight: 700; background: #f4f4f5 !important; border-top: 2px solid #18181b; color: #18181b; }
  .su-grid .em td { font-weight: 600; }
</style>
</head>
<body>

<!-- ═══════════════════════════════════════════════════════════════════
     PAGE 1 — OVERVIEW
     ═══════════════════════════════════════════════════════════════════ -->
<div class="page">
  <div class="hdr">
    <div>
      <h1>Investment Cashflow Report</h1>
      <div class="sub">${assets.length} asset${assets.length !== 1 ? 's' : ''} · ${totalGla.toLocaleString('en-US')} m² GLA · ${assumptions.cashflow_period || '—'}-year hold</div>
    </div>
    <div class="hdr-r">
      <div class="brand">RE Analyzer</div>
      <div class="date">${today}</div>
    </div>
  </div>

  <!-- KPI Strip -->
  <div class="kpi-strip">
    <div class="kb"><div class="kl">Spot Value</div><div class="kv">${fM(cf.total_spot_value)}</div></div>
    <div class="kb"><div class="kl">Acq. Costs</div><div class="kv">${fM(cf.acquisition_costs)}</div></div>
    <div class="kb"><div class="kl">Total Cost</div><div class="kv">${fM(cf.total_acquisition_cost)}</div></div>
    <div class="kb"><div class="kl">Equity</div><div class="kv">${fM(cf.total_equity_required)}</div></div>
    <div class="kb"><div class="kl">Debt</div><div class="kv">${fM(cf.debt_amount)}</div></div>
    <div class="kb"><div class="kl">Annual Rent</div><div class="kv">${fK(totalRent)}</div></div>
    <div class="kb"><div class="kl">Gross Yield</div><div class="kv">${avgYield}%</div></div>
    <div class="kb dark"><div class="kl">LTV</div><div class="kv">${(100 - (assumptions.equity_pct || 0)).toFixed(0)}%</div></div>
  </div>

  <!-- Performance -->
  <div class="stitle">Performance Summary</div>
  <div class="kpi-cards">
    <div class="kc">
      <div class="kc-h">Total Profit</div>
      <div class="kc-b">
        <div class="kc-r"><span class="t">Gross</span><span class="v">${fM(cf.total_profit_gross)}</span></div>
        <div class="kc-r"><span class="t">Net</span><span class="v">${fM(cf.total_profit_net)}</span></div>
      </div>
    </div>
    <div class="kc">
      <div class="kc-h">IRR</div>
      <div class="kc-b">
        <div class="kc-r"><span class="t">Gross</span><span class="v">${pct(cf.irr_gross)}</span></div>
        <div class="kc-r"><span class="t">Net</span><span class="v">${pct(cf.irr_net)}</span></div>
      </div>
    </div>
    <div class="kc">
      <div class="kc-h">MOIC</div>
      <div class="kc-b">
        <div class="kc-r"><span class="t">Gross</span><span class="v">${mul(cf.moic_gross)}</span></div>
        <div class="kc-r"><span class="t">Net</span><span class="v">${mul(cf.moic_net)}</span></div>
      </div>
    </div>
    <div class="kc">
      <div class="kc-h">Cash-on-Cash</div>
      <div class="kc-b">
        <div class="kc-r"><span class="t">Gross</span><span class="v">${pct(cf.cash_on_cash_gross)}</span></div>
        <div class="kc-r"><span class="t">Net</span><span class="v">${pct(cf.cash_on_cash_net)}</span></div>
      </div>
    </div>
  </div>

  <!-- Assets -->
  <div class="stitle">Portfolio Composition</div>
  <table class="at">
    <thead>
      <tr>
        <th style="text-align:left">Asset</th>
        <th style="text-align:left">City</th>
        <th>GLA (m²)</th>
        <th>Spot Price</th>
        <th>Annual Rent</th>
        <th>NOI %</th>
        <th>Yield</th>
        <th>Exit ×</th>
        <th>Disp. Yr</th>
      </tr>
    </thead>
    <tbody>
      ${assets.map((a: any) => `<tr>
        <td style="text-align:left;font-weight:600;color:#18181b">${a.name || '—'}</td>
        <td style="text-align:left">${a.city || '—'}</td>
        <td>${(a.gla || 0).toLocaleString('en-US')}</td>
        <td>${fM(a.spot_price)}</td>
        <td>${fK(a.annual_rent)}</td>
        <td>${a.noi_margin != null ? a.noi_margin.toFixed(1) + '%' : '—'}</td>
        <td>${a.spot_price > 0 ? ((a.annual_rent / a.spot_price) * 100).toFixed(2) + '%' : '—'}</td>
        <td>${a.exit_rent_multiple != null ? a.exit_rent_multiple.toFixed(1) + '×' : '—'}</td>
        <td>Y${a.disposition_year || assumptions.default_disposition_year || '—'}</td>
      </tr>`).join('')}
      <tr class="tot">
        <td style="text-align:left">Total / Wtd Avg</td>
        <td></td>
        <td>${totalGla.toLocaleString('en-US')}</td>
        <td>${fM(totalSpot)}</td>
        <td>${fK(totalRent)}</td>
        <td>—</td>
        <td>${avgYield}%</td>
        <td>${avgExitMultiple.toFixed(1)}×</td>
        <td>—</td>
      </tr>
    </tbody>
  </table>

  <div class="ftr"><span>Confidential — Generated by RE Analyzer</span><span>Page 1 of 3</span></div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════
     PAGE 2 — ASSUMPTIONS
     ═══════════════════════════════════════════════════════════════════ -->
<div class="page">
  <div class="hdr">
    <div>
      <h1>Assumptions & Parameters</h1>
      <div class="sub">Model inputs used for this simulation</div>
    </div>
    <div class="hdr-r">
      <div class="brand">RE Analyzer</div>
      <div class="date">${today}</div>
    </div>
  </div>

  <div class="agrid">
    <div class="acard">
      <div class="acard-h">Transaction</div>
      <div class="acard-b">
        ${aRow('Cashflow Period', (assumptions.cashflow_period || '—') + ' yrs')}
        ${aRow('Acquisition Costs', (assumptions.acquisition_costs_pct ?? '—') + '%')}
        ${aRow('CPI Annual', (assumptions.cpi_annual ?? '—') + '%')}
      </div>
    </div>
    <div class="acard">
      <div class="acard-h">Financing</div>
      <div class="acard-b">
        ${aRow('Equity / Debt', (assumptions.equity_pct || '—') + '% / ' + (100 - (assumptions.equity_pct || 0)).toFixed(0) + '%')}
        ${aRow('Interest Rate', (assumptions.interest_rate ?? '—') + '%')}
        ${aRow('Financing Fees', (assumptions.financing_fee_pct ?? '—') + '%')}
        ${aRow('Amort. Type', (assumptions.amortization_type || '—').charAt(0).toUpperCase() + (assumptions.amortization_type || '').slice(1))}
        ${assumptions.amortization_type !== 'bullet' ? aRow('Amort. Years', (assumptions.amortization_years || '—') + ' yrs') : ''}
        ${assumptions.amortization_type === 'hybrid' ? aRow('Amort. Pct', (assumptions.amortization_pct || '—') + '%') : ''}
      </div>
    </div>
    <div class="acard">
      <div class="acard-h">Operations</div>
      <div class="acard-b">
        ${aRow('AM Fees', (assumptions.asset_management_fee_pct ?? '—') + '% of NOI')}
        ${aRow('Structure Costs', '€' + ((assumptions.structure_costs_annual || 0) / 1000).toFixed(0) + 'k/yr')}
        ${aRow('Capex', '€' + (assumptions.capex_per_sqm ?? '—') + '/m²')}
        ${aRow('Leasing TI', '€' + (cf.leasing_ti_per_sqm_year || 0).toFixed(2) + '/m²/yr')}
        ${aRow('Yield on Cost', (assumptions.yield_on_cost ?? '—') + '%')}
      </div>
    </div>
    <div class="acard">
      <div class="acard-h">Exit / Disposition</div>
      <div class="acard-b">
        ${aRow('Wtd Exit Multiple', avgExitMultiple.toFixed(1) + '×')}
        ${aRow('Default Disp. Year', 'Y' + (assumptions.default_disposition_year || '—'))}
        ${aRow('Default Disp. Costs', (assumptions.default_disposition_costs_pct ?? '—') + '%')}
      </div>
    </div>
    <div class="acard">
      <div class="acard-h">Tax</div>
      <div class="acard-b">
        ${aRow('Tax Rate', (assumptions.tax_rate ?? '—') + '%')}
        ${aRow('Depreciation', '3.0%/yr')}
        ${aRow('Land/Building', '20/80 split')}
      </div>
    </div>
  </div>

  <!-- Sources & Uses -->
  <div class="stitle">Sources & Uses</div>
  <div class="su-grid">
    <table>
      <thead><tr><th style="text-align:left">Uses</th><th>Amount</th></tr></thead>
      <tbody>
        <tr><td style="text-align:left">Acquisition Price</td><td>${fM(cf.total_spot_value)}</td></tr>
        <tr><td style="text-align:left">Acquisition Costs (${assumptions.acquisition_costs_pct || 0}%)</td><td>${fM(cf.acquisition_costs)}</td></tr>
        <tr class="total"><td style="text-align:left">Total Uses</td><td>${fM(cf.total_acquisition_cost)}</td></tr>
      </tbody>
    </table>
    <table>
      <thead><tr><th style="text-align:left">Sources</th><th>Amount</th></tr></thead>
      <tbody>
        <tr><td style="text-align:left">Equity (${assumptions.equity_pct || 0}%)</td><td>${fM(cf.equity_amount)}</td></tr>
        <tr><td style="text-align:left">Financing Fees</td><td>${fM(cf.financing_fees)}</td></tr>
        <tr class="em"><td style="text-align:left">Total Equity Required</td><td>${fM(cf.total_equity_required)}</td></tr>
        <tr><td style="text-align:left">Senior Debt (${(100 - (assumptions.equity_pct || 0)).toFixed(0)}%)</td><td>${fM(cf.debt_amount)}</td></tr>
        <tr class="total"><td style="text-align:left">Total Sources</td><td>${fM(cf.total_acquisition_cost)}</td></tr>
      </tbody>
    </table>
  </div>

  <div class="ftr"><span>Confidential — Generated by RE Analyzer</span><span>Page 2 of 3</span></div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════
     PAGE 3 — CASHFLOW TABLE
     ═══════════════════════════════════════════════════════════════════ -->
<div class="page">
  <div class="hdr">
    <div>
      <h1>Cashflow Projection</h1>
      <div class="sub">All figures in €000s · ${assumptions.cashflow_period || '—'}-year model</div>
    </div>
    <div class="hdr-r">
      <div class="brand">RE Analyzer</div>
      <div class="date">${today}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="text-align:left;min-width:130px">Item</th>
        ${years.map((y: number) => `<th>${y === 0 ? 'Y0' : 'Y' + y}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      <tr class="sec"><td class="lbl" colspan="${numYears + 1}">Acquisition & Financing</td></tr>
      ${y0Row('Acquisition Price', -(cf.total_spot_value || 0))}
      ${y0Row('Acquisition Costs', -(cf.acquisition_costs || 0))}
      ${y0Row('Financing Fees', -(cf.financing_fees || 0))}
      ${y0Row('Debt Drawn', cf.debt_amount || 0)}
      ${y0Row('Equity Required', -(cf.total_equity_required || 0), 'sub')}

      <tr class="sec"><td class="lbl" colspan="${numYears + 1}">Disposition</td></tr>
      ${cfRow('Disposition Price', cf.disposition_price, { nz: true })}
      ${cfRow('Disposition Costs', cf.disposition_costs, { invert: true, nz: true })}
      ${cfRow('Debt Repayment', cf.debt_repayment, { invert: true, nz: true })}

      <tr class="sec"><td class="lbl" colspan="${numYears + 1}">Operating Cashflow</td></tr>
      ${cfRow('Gross Rental Income', cf.gross_rental_income)}
      ${cfRow('Non-Recoverables', cf.non_recoverables, { invert: true })}
      ${cfRow('NOI', cf.noi, { cls: 'sub' })}
      ${cfRow('Capex', cf.capex, { invert: true })}
      ${cfRow('Leasing TI', cf.leasing_ti, { invert: true, nz: true })}
      ${cfRow('CF Before Debt', cf.cf_before_debt, { cls: 'sub' })}

      <tr class="sec"><td class="lbl" colspan="${numYears + 1}">Debt Service & Tax</td></tr>
      ${cfRow('Interest', cf.interest, { invert: true })}
      ${cfRow('Amortization', cf.amortization, { invert: true, nz: true })}
      ${cfRow('CF After Debt', cfAfterDebt, { cls: 'sub' })}
      ${cfRow('Tax', cf.total_tax, { invert: true, nz: true })}

      ${cfRow('GROSS TOTAL', cf.cf_gross, { cls: 'rg', skipY0: false })}
      ${cfRow('Asset Management Fees', cf.asset_management_fees, { invert: true })}
      ${cfRow('Structure Costs', cf.structure_costs, { invert: true })}
      ${cfRow('NET TOTAL', cf.cf_net, { cls: 'rn', skipY0: false })}
    </tbody>
  </table>

  <div class="ftr"><span>Confidential — Generated by RE Analyzer</span><span>Page 3 of 3</span></div>
</div>

</body>
</html>`;
}