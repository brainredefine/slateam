// app/api/portfolios/[id]/attachments/route.ts
// =============================================================================
// List all email attachments for a portfolio (PDF, Excel, docs, images, ...).
// =============================================================================
import { NextResponse } from 'next/server';
import { getPortfolioAttachments } from '@/lib/database';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const attachments = await getPortfolioAttachments(id);
    return NextResponse.json({ success: true, attachments });
  } catch (err) {
    console.error('attachments fetch error:', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}