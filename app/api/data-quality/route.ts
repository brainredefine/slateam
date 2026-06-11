// app/api/data-quality/route.ts
// =============================================================================
// Returns a full data quality report scanning all portfolios + their
// assets and tenants.
// Also handles POST/DELETE for acknowledging/un-acknowledging issues.
//
// IMPORTANT: Supabase has a default row limit of 1000 per query.
// We paginate all 3 tables (portfolios, assets, tenants) to handle larger DBs.
// =============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildDataQualityReport, type PortfolioRecord, type AssetRecord, type TenantRecord } from '@/lib/data-quality';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const PAGE_SIZE = 1000;

async function fetchAll<T>(table: string): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  while (true) {
    let query = supabase
      .from(table)
      .select('*')
      .range(from, from + PAGE_SIZE - 1);
 
    // Archived portfolios are excluded from the data-quality scan.
    if (table === 'portfolios') {
      query = query.is('archived_at', null);
    }
 
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

export async function GET() {
  try {
    const [portfolios, assets, tenants, acksRes] = await Promise.all([
      fetchAll<PortfolioRecord>('portfolios'),
      fetchAll<AssetRecord>('assets'),
      fetchAll<TenantRecord>('tenants'),
      supabase.from('data_quality_acks').select('issue_id'),
    ]);

    const ackedIds = new Set<string>(
      acksRes.error ? [] : (acksRes.data || []).map((r: { issue_id: string }) => r.issue_id)
    );

    const report = buildDataQualityReport(portfolios, assets, tenants, ackedIds);

    return NextResponse.json(report);
  } catch (err) {
    console.error('data-quality API error:', err);
    return NextResponse.json({ error: 'Failed to compute data quality report' }, { status: 500 });
  }
}

// ─── Acknowledge an issue ────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const { issue_id, note } = await req.json();
    if (!issue_id || typeof issue_id !== 'string') {
      return NextResponse.json({ error: 'issue_id is required' }, { status: 400 });
    }
    const { error } = await supabase
      .from('data_quality_acks')
      .upsert({ issue_id, note: note || null, acknowledged_at: new Date().toISOString() });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('ack error:', err);
    return NextResponse.json({ error: 'Failed to acknowledge issue' }, { status: 500 });
  }
}

// ─── Un-acknowledge an issue ────────────────────────────────────────────────
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const issue_id = searchParams.get('issue_id');
    if (!issue_id) {
      return NextResponse.json({ error: 'issue_id is required' }, { status: 400 });
    }
    const { error } = await supabase
      .from('data_quality_acks')
      .delete()
      .eq('issue_id', issue_id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('unack error:', err);
    return NextResponse.json({ error: 'Failed to un-acknowledge issue' }, { status: 500 });
  }
}