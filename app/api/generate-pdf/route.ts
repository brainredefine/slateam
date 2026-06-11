import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

async function getBrowser() {
  if (process.env.VERCEL_ENV || process.env.NODE_ENV === 'production') {
    // Production: use chromium-min for Vercel
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
    // Development: use full puppeteer
    const puppeteer = (await import('puppeteer')).default;
    return puppeteer.launch({ headless: true });
  }
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    const { cashflowResults, assets, assumptions } = data;
    
    // Generate HTML content
    const html = generatePDFHtml(cashflowResults, assets, assumptions);
    
    const browser = await getBrowser();
    const page = await browser.newPage();
    
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });
    
    await browser.close();
    
    return new NextResponse(Buffer.from(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Cashflow_Report_${new Date().toISOString().split('T')[0]}.pdf"`,
      },
    });
  } catch (error) {
    console.error('PDF generation error:', error);
    return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 });
  }
}

function generatePDFHtml(cashflowResults: any, assets: any[], assumptions: any): string {
  const years = cashflowResults.years;
  const totalGla = assets.reduce((s: number, a: any) => s + (a.gla || 0), 0);
  const totalSpot = assets.reduce((s: number, a: any) => s + (a.spot_price || 0), 0);
  const totalRent = assets.reduce((s: number, a: any) => s + (a.annual_rent || 0), 0);
  
  const fK = (v: number) => v === 0 ? '—' : `€${Math.abs(Math.round(v / 1000)).toLocaleString('en-US')}k`;
  const fKp = (v: number) => v === 0 ? '—' : (v < 0 ? `(${fK(Math.abs(v))})` : fK(v));
  const fM = (v: number) => `€${(v / 1_000_000).toFixed(2)}M`;
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 11px;
      color: #1f2937;
      background: white;
      line-height: 1.4;
    }
    .page {
      width: 100%;
      min-height: 100vh;
      padding: 20px;
      page-break-after: always;
    }
    .page:last-child { page-break-after: avoid; }
    
    .header {
      background: linear-gradient(135deg, #6D7C60 0%, #5a6950 100%);
      color: white;
      padding: 16px 24px;
      border-radius: 12px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h1 { font-size: 22px; font-weight: 700; }
    .header .date { font-size: 12px; opacity: 0.9; }
    
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }
    .summary-card {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 14px 16px;
    }
    .summary-card.green { background: linear-gradient(135deg, #ecfdf5, #d1fae5); border: 2px solid #6ee7b7; }
    .summary-card.orange { background: linear-gradient(135deg, #fff7ed, #ffedd5); border: 2px solid #fdba74; }
    .summary-card .label { font-size: 9px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .summary-card .value { font-size: 16px; font-weight: 700; color: #111827; }
    .summary-card.green .value { color: #047857; }
    .summary-card.orange .value { color: #c2410c; }
    
    .section-title {
      font-size: 14px;
      font-weight: 700;
      color: #374151;
      margin: 20px 0 12px 0;
      padding-bottom: 6px;
      border-bottom: 2px solid #e5e7eb;
    }
    
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th, td { padding: 8px 10px; text-align: right; border: 1px solid #e5e7eb; }
    th { background: linear-gradient(135deg, #6D7C60, #5a6950); color: white; font-weight: 600; font-size: 9px; text-transform: uppercase; }
    td:first-child, th:first-child { text-align: left; }
    tbody tr:nth-child(even) { background: #f9fafb; }
    .row-total { background: #f3f4f6 !important; font-weight: 700; }
    .row-bold { font-weight: 700; background: #f0fdf4 !important; }
    .row-subtotal { background: #f3f4f6 !important; font-weight: 600; }
    .row-gross { background: linear-gradient(90deg, #d1fae5, #a7f3d0) !important; font-weight: 700; font-size: 11px; }
    .row-net { background: linear-gradient(90deg, #6ee7b7, #34d399) !important; font-weight: 700; font-size: 11px; }
    
    .assumptions-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 12px;
      margin-bottom: 20px;
    }
    .assumption-box {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      overflow: hidden;
    }
    .assumption-box .box-header {
      background: #6D7C60;
      color: white;
      padding: 8px 12px;
      font-weight: 700;
      font-size: 11px;
    }
    .assumption-box.financing .box-header { background: #059669; }
    .assumption-box.transaction .box-header { background: #2563eb; }
    .assumption-box.operations .box-header { background: #ea580c; }
    .assumption-box.exit .box-header { background: #7c3aed; }
    .assumption-box.tax .box-header { background: #dc2626; }
    .assumption-box .box-content { padding: 10px 12px; }
    .assumption-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #f3f4f6; font-size: 10px; }
    .assumption-row:last-child { border-bottom: none; }
    .assumption-row .label { color: #6b7280; }
    .assumption-row .val { font-weight: 600; color: #111827; }
    
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 20px;
    }
    .kpi-card {
      border-radius: 12px;
      padding: 16px;
      border: 2px solid;
    }
    .kpi-card.green { background: linear-gradient(135deg, #ecfdf5, #d1fae5); border-color: #6ee7b7; }
    .kpi-card.blue { background: linear-gradient(135deg, #eff6ff, #dbeafe); border-color: #93c5fd; }
    .kpi-card.purple { background: linear-gradient(135deg, #f5f3ff, #ede9fe); border-color: #c4b5fd; }
    .kpi-card.orange { background: linear-gradient(135deg, #fff7ed, #ffedd5); border-color: #fdba74; }
    .kpi-label { font-size: 11px; font-weight: 700; color: #374151; margin-bottom: 10px; text-transform: uppercase; }
    .kpi-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(0,0,0,0.1); }
    .kpi-row:last-child { border-bottom: none; }
    .kpi-type { font-size: 10px; color: #6b7280; }
    .kpi-value { font-size: 14px; font-weight: 700; color: #111827; }
    
    .footer {
      margin-top: 20px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: #9ca3af;
    }
  </style>
</head>
<body>
  <!-- PAGE 1: Summary & Assets -->
  <div class="page">
    <div class="header">
      <h1>📊 Cashflow Simulation Report</h1>
      <span class="date">${today}</span>
    </div>
    
    <div class="summary-grid">
      <div class="summary-card">
        <div class="label">Assets</div>
        <div class="value">${assets.length}</div>
      </div>
      <div class="summary-card">
        <div class="label">Total GLA</div>
        <div class="value">${totalGla.toLocaleString('en-US')} m²</div>
      </div>
      <div class="summary-card">
        <div class="label">Spot Value</div>
        <div class="value">${fM(totalSpot)}</div>
      </div>
      <div class="summary-card">
        <div class="label">Annual Rent</div>
        <div class="value">${fK(totalRent)}</div>
      </div>
      <div class="summary-card green">
        <div class="label">Equity Required</div>
        <div class="value">${fM(cashflowResults.total_equity_required)}</div>
      </div>
      <div class="summary-card orange">
        <div class="label">Debt</div>
        <div class="value">${fM(cashflowResults.debt_amount)}</div>
      </div>
    </div>
    
    <div class="section-title">🏢 Assets Included</div>
    <table>
      <thead>
        <tr><th>Name</th><th>City</th><th>GLA (m²)</th><th>Spot Price</th><th>Annual Rent</th><th>NOI Margin</th><th>Yield</th></tr>
      </thead>
      <tbody>
        ${assets.map((a: any) => `
          <tr>
            <td>${a.name}</td>
            <td>${a.city || '—'}</td>
            <td>${(a.gla || 0).toLocaleString('en-US')}</td>
            <td>${fK(a.spot_price)}</td>
            <td>${fK(a.annual_rent)}</td>
            <td>${a.noi_margin?.toFixed(1) || '—'}%</td>
            <td>${a.spot_price > 0 ? ((a.annual_rent / a.spot_price) * 100).toFixed(2) : '—'}%</td>
          </tr>
        `).join('')}
        <tr class="row-total">
          <td>TOTAL</td>
          <td></td>
          <td>${totalGla.toLocaleString('en-US')}</td>
          <td>${fK(totalSpot)}</td>
          <td>${fK(totalRent)}</td>
          <td>—</td>
          <td>${((totalRent / totalSpot) * 100).toFixed(2)}%</td>
        </tr>
      </tbody>
    </table>
    
    <div class="footer"><span>Generated by RE Analyzer</span><span>Page 1 of 3</span></div>
  </div>
  
  <!-- PAGE 2: Assumptions & KPIs -->
  <div class="page">
    <div class="header">
      <h1>⚙️ Assumptions & Results</h1>
      <span class="date">${today}</span>
    </div>
    
    <div class="assumptions-grid">
      <div class="assumption-box financing">
        <div class="box-header">🏦 Financing</div>
        <div class="box-content">
          <div class="assumption-row"><span class="label">Equity</span><span class="val">${assumptions.equity_pct}%</span></div>
          <div class="assumption-row"><span class="label">Debt</span><span class="val">${(100 - assumptions.equity_pct).toFixed(1)}%</span></div>
          <div class="assumption-row"><span class="label">Interest Rate</span><span class="val">${assumptions.interest_rate}%</span></div>
          <div class="assumption-row"><span class="label">Financing Fees</span><span class="val">${assumptions.financing_fee_pct}%</span></div>
          <div class="assumption-row"><span class="label">Amortization</span><span class="val">${assumptions.amortization_type}</span></div>
        </div>
      </div>
      <div class="assumption-box transaction">
        <div class="box-header">📅 Transaction</div>
        <div class="box-content">
          <div class="assumption-row"><span class="label">Timeframe</span><span class="val">${assumptions.timeframe} years</span></div>
          <div class="assumption-row"><span class="label">Transaction Costs</span><span class="val">${assumptions.transaction_costs_pct}%</span></div>
          <div class="assumption-row"><span class="label">CPI Annual</span><span class="val">${assumptions.cpi_annual}%</span></div>
          <div class="assumption-row"><span class="label">Depreciation</span><span class="val">${assumptions.depreciation_rate}%/yr</span></div>
        </div>
      </div>
      <div class="assumption-box operations">
        <div class="box-header">🏢 Operations</div>
        <div class="box-content">
          <div class="assumption-row"><span class="label">Management Fees</span><span class="val">${assumptions.asset_management_fee_pct}%</span></div>
          <div class="assumption-row"><span class="label">Capex</span><span class="val">€${assumptions.capex_per_sqm}/m²</span></div>
          <div class="assumption-row"><span class="label">Leasing TI</span><span class="val">€${assumptions.leasing_ti_per_sqm}/m²</span></div>
          <div class="assumption-row"><span class="label">Yield on Cost</span><span class="val">${assumptions.yield_on_cost}%</span></div>
        </div>
      </div>
      <div class="assumption-box exit">
        <div class="box-header">🚪 Exit</div>
        <div class="box-content">
          <div class="assumption-row"><span class="label">Exit Rent Multiple</span><span class="val">${assumptions.exit_rent_multiple}×</span></div>
          <div class="assumption-row"><span class="label">Exit Transaction Costs</span><span class="val">${assumptions.exit_transaction_costs_pct}%</span></div>
        </div>
      </div>
      <div class="assumption-box tax">
        <div class="box-header">💰 Tax</div>
        <div class="box-content">
          <div class="assumption-row"><span class="label">Tax Rate</span><span class="val">${assumptions.tax_rate}%</span></div>
        </div>
      </div>
    </div>
    
    <div class="section-title">📈 Key Performance Indicators</div>
    <div class="kpi-grid">
      <div class="kpi-card green">
        <div class="kpi-label">Total Cashflow</div>
        <div class="kpi-row"><span class="kpi-type">Gross</span><span class="kpi-value">${fM(cashflowResults.total_cf_gross_sum)}</span></div>
        <div class="kpi-row"><span class="kpi-type">Net</span><span class="kpi-value">${fM(cashflowResults.total_cf_net_sum)}</span></div>
      </div>
      <div class="kpi-card blue">
        <div class="kpi-label">IRR</div>
        <div class="kpi-row"><span class="kpi-type">Gross</span><span class="kpi-value">${cashflowResults.irr_gross.toFixed(2)}%</span></div>
        <div class="kpi-row"><span class="kpi-type">Net</span><span class="kpi-value">${cashflowResults.irr_net.toFixed(2)}%</span></div>
      </div>
      <div class="kpi-card purple">
        <div class="kpi-label">MOIC</div>
        <div class="kpi-row"><span class="kpi-type">Gross</span><span class="kpi-value">${cashflowResults.moic_gross.toFixed(2)}×</span></div>
        <div class="kpi-row"><span class="kpi-type">Net</span><span class="kpi-value">${cashflowResults.moic_net.toFixed(2)}×</span></div>
      </div>
      <div class="kpi-card orange">
        <div class="kpi-label">Cash on Cash</div>
        <div class="kpi-row"><span class="kpi-type">Gross</span><span class="kpi-value">${cashflowResults.cash_on_cash_gross.toFixed(2)}%</span></div>
        <div class="kpi-row"><span class="kpi-type">Net</span><span class="kpi-value">${cashflowResults.cash_on_cash_net.toFixed(2)}%</span></div>
      </div>
    </div>
    
    <div class="footer"><span>Generated by RE Analyzer</span><span>Page 2 of 3</span></div>
  </div>
  
  <!-- PAGE 3: Cashflow Table -->
  <div class="page">
    <div class="header">
      <h1>📊 Cashflow Projection</h1>
      <span class="date">All figures in €000s</span>
    </div>
    
    <table>
      <thead>
        <tr><th style="width:160px">Item</th>${years.map((y: number) => `<th>${y === 0 ? 'Y0' : `Y${y}`}</th>`).join('')}</tr>
      </thead>
      <tbody>
        <tr><td>Purchase Price</td>${years.map((y: number) => `<td>${y === 0 ? fKp(-cashflowResults.total_spot_value) : '—'}</td>`).join('')}</tr>
        <tr><td>Transaction Costs</td>${years.map((y: number) => `<td>${y === 0 ? fKp(-cashflowResults.transaction_costs) : '—'}</td>`).join('')}</tr>
        <tr><td>Financing Fees</td>${years.map((y: number) => `<td>${y === 0 ? fKp(-cashflowResults.financing_fees) : '—'}</td>`).join('')}</tr>
        <tr><td>Debt Drawn</td>${years.map((y: number) => `<td>${y === 0 ? fK(cashflowResults.debt_amount) : '—'}</td>`).join('')}</tr>
        <tr><td>Equity Required</td>${years.map((y: number) => `<td>${y === 0 ? fKp(-cashflowResults.total_equity_required) : '—'}</td>`).join('')}</tr>
        
        <tr class="row-bold"><td>Gross Rental Income</td>${cashflowResults.gross_rental_income.map((v: number, i: number) => `<td>${i === 0 ? '—' : fK(v)}</td>`).join('')}</tr>
        <tr><td>Non-Recoverables</td>${cashflowResults.non_recoverables.map((v: number, i: number) => `<td>${i === 0 ? '—' : fKp(-v)}</td>`).join('')}</tr>
        <tr class="row-subtotal"><td>NOI</td>${cashflowResults.noi.map((v: number, i: number) => `<td>${i === 0 ? '—' : fK(v)}</td>`).join('')}</tr>
        
        <tr><td>Capex</td>${cashflowResults.capex.map((v: number, i: number) => `<td>${i === 0 ? '—' : fKp(-v)}</td>`).join('')}</tr>
        <tr><td>Leasing TI</td>${cashflowResults.leasing_ti.map((v: number, i: number) => `<td>${i === 0 ? '—' : fKp(-v)}</td>`).join('')}</tr>
        <tr class="row-subtotal"><td>CF Before Debt</td>${cashflowResults.cf_before_debt.map((v: number, i: number) => `<td>${i === 0 ? '—' : fK(v)}</td>`).join('')}</tr>
        
        <tr><td>Interest</td>${cashflowResults.interest.map((v: number, i: number) => `<td>${i === 0 ? '—' : fKp(-v)}</td>`).join('')}</tr>
        <tr><td>Amortization</td>${cashflowResults.amortization.map((v: number, i: number) => `<td>${i === 0 ? '—' : (v > 0 ? fKp(-v) : '—')}</td>`).join('')}</tr>
        <tr><td>Tax</td>${cashflowResults.total_tax.map((v: number, i: number) => `<td>${i === 0 ? '—' : (v > 0 ? fKp(-v) : '—')}</td>`).join('')}</tr>
        
        <tr><td>Sale Proceeds</td>${cashflowResults.sale_proceeds.map((v: number) => `<td>${v === 0 ? '—' : fK(v)}</td>`).join('')}</tr>
        <tr><td>Exit Trans. Costs</td>${cashflowResults.exit_transaction_costs.map((v: number) => `<td>${v === 0 ? '—' : fKp(-v)}</td>`).join('')}</tr>
        <tr><td>Debt Repayment</td>${cashflowResults.debt_repayment.map((v: number) => `<td>${v === 0 ? '—' : fKp(-v)}</td>`).join('')}</tr>
        
        <tr class="row-gross"><td>GROSS TOTAL</td>${cashflowResults.cf_gross.map((v: number) => `<td>${fKp(v)}</td>`).join('')}</tr>
        
        <tr><td>Management Fees & Structure</td>${cashflowResults.asset_management_fees.map((v: number, i: number) => `<td>${i === 0 ? '—' : fKp(-v)}</td>`).join('')}</tr>
        
        <tr class="row-net"><td>NET TOTAL</td>${cashflowResults.cf_net.map((v: number) => `<td>${fKp(v)}</td>`).join('')}</tr>
      </tbody>
    </table>
    
    <div class="footer"><span>Generated by RE Analyzer</span><span>Page 3 of 3</span></div>
  </div>
</body>
</html>
  `;
}