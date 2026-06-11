// /app/api/analyze/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { extractFromPDF, EXTRACTION_MODEL } from '@/lib/extraction';
import { createDocument, saveExtractedData, createExtractionLog } from '@/lib/database';

// Route segment config for App Router
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const start = Date.now();
  
  try {
    const { documentType, fileBase64, fileName, emailBody } = await req.json();

    if (!fileBase64 || !fileName) {
      return NextResponse.json({ success: false, error: 'Missing file' }, { status: 400 });
    }

    // Create document record
    const doc = await createDocument(fileName, documentType, emailBody);

    // Extract with Claude
    const extraction = await extractFromPDF(fileBase64, documentType, emailBody);

    // Save to database with PDF
    const saved = await saveExtractedData(doc.id, extraction.data, {
      base64: fileBase64,
      fileName: fileName
    });

    // Log extraction
    await createExtractionLog(doc.id, {
      model_used: EXTRACTION_MODEL,
      prompt_tokens: extraction.usage.promptTokens,
      completion_tokens: extraction.usage.completionTokens,
      total_tokens: extraction.usage.totalTokens,
      processing_time_ms: extraction.processingTimeMs,
    });

    return NextResponse.json({
      success: true,
      documentId: doc.id,
      portfolioId: saved.portfolioId,
      assetIds: saved.assetIds,
      tenantIds: saved.tenantIds,
      extractedData: extraction.data,
      usage: extraction.usage,
      processingTimeMs: Date.now() - start,
      errors: saved.errors,
    });

  } catch (error) {
    console.error('Analyze error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}