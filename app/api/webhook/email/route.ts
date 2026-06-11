// app/api/webhook/email/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { processEmail } from '@/lib/microsoft-graph';

export const maxDuration = 300;

// Handle webhook validation and notifications
export async function POST(req: NextRequest) {
  try {
    // Check if this is a validation request
    const url = new URL(req.url);
    const validationToken = url.searchParams.get('validationToken');

    if (validationToken) {
      // Microsoft Graph validation - must return the token as plain text
      console.log('Webhook validation request received');
      return new NextResponse(validationToken, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // Process notification
    const body = await req.json();
    console.log('Webhook notification received:', JSON.stringify(body, null, 2));

    // Validate client state
    const expectedState = process.env.WEBHOOK_SECRET || 'reanalyzer-secret-state';

    // Track processed IDs in this request to handle batch duplicates
    const queued: string[] = [];
    const seenInBatch = new Set<string>();

    if (body.value && Array.isArray(body.value)) {
      for (const notification of body.value) {
        // Verify client state
        if (notification.clientState !== expectedState) {
          console.warn('Invalid client state, skipping notification');
          continue;
        }

        // Get message ID from resourceData (more reliable)
        const messageId = notification.resourceData?.id;

        if (!messageId) {
          console.warn('No message ID in notification');
          continue;
        }

        // Skip if already queued in this batch
        if (seenInBatch.has(messageId)) {
          console.log(`Skipping duplicate in batch: ${messageId}`);
          continue;
        }
        seenInBatch.add(messageId);

        if (notification.changeType === 'created') {
          queued.push(messageId);
        }
      }
    }

    // ACK immediately, process asynchronously. Microsoft Graph expects a
    // fast response (~30s) — multi-PDF Opus extraction takes minutes, and a
    // slow endpoint triggers Graph retries (duplicate notifications) and can
    // get the subscription throttled. processEmail's lock + dedup absorb any
    // retries that still arrive.
    if (queued.length > 0) {
      after(async () => {
        for (const messageId of queued) {
          try {
            console.log(`Processing new email (async): ${messageId}`);
            const result = await processEmail(messageId);
            console.log(`Email ${messageId} →`, result.success ? 'ok' : `error: ${result.error}`);
          } catch (error) {
            console.error(`Async processing failed for ${messageId}:`, error);
          }
        }
      });
    }

    return NextResponse.json(
      { success: true, queued: queued.length },
      { status: 202 }
    );

  } catch (error) {
    console.error('Webhook error:', error);
    // Still return 200 to prevent Microsoft from retrying
    return NextResponse.json({ success: false, error: String(error) }, { status: 200 });
  }
}

// Handle GET for health check
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: 'email-webhook',
    timestamp: new Date().toISOString()
  });
}
