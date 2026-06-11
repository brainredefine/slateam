// app/api/webhook/setup/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { 
  createSubscription, 
  listSubscriptions, 
  deleteSubscription,
  renewSubscription,
  getUnreadEmails,
  processEmail
} from '@/lib/microsoft-graph';

export const maxDuration = 300; // 5 minutes — Excel processing with Claude can take a while

// GET - List subscriptions or process existing emails
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');
    // Process existing unread emails
    if (action === 'process') {
      const emails = await getUnreadEmails();
      const results = [];
      for (const email of emails) {
        const result = await processEmail(email.id);
        results.push({ 
          subject: email.subject,
          from: email.from.emailAddress.address,
          ...result 
        });
      }
      return NextResponse.json({ 
        success: true, 
        processed: results.length,
        results 
      });
    }
    // List active subscriptions
    const subscriptions = await listSubscriptions();
    return NextResponse.json({ success: true, subscriptions });
  } catch (error) {
    console.error('Setup GET error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
// POST - Create new subscription
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    
    const host = req.headers.get('host');
    const protocol = host?.includes('localhost') ? 'http' : 'https';
    const webhookUrl = body.webhookUrl || `${protocol}://${host}/api/webhook/email`;
    console.log('Creating subscription with webhook URL:', webhookUrl);
    // Delete existing subscriptions first
    const existing = await listSubscriptions();
    for (const sub of existing) {
      if (sub.resource.includes('mailFolders')) {
        await deleteSubscription(sub.id);
        console.log('Deleted existing subscription:', sub.id);
      }
    }
    const subscription = await createSubscription(webhookUrl);
    
    console.log('Created subscription:', subscription.id);
    console.log('Expires:', subscription.expirationDateTime);
    return NextResponse.json({ 
      success: true, 
      subscription,
      webhookUrl,
      message: 'Subscription created. Will receive notifications for new emails.'
    });
  } catch (error) {
    console.error('Setup POST error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
// PATCH - Renew subscription
export async function PATCH(req: NextRequest) {
  try {
    const { subscriptionId } = await req.json();
    
    if (!subscriptionId) {
      return NextResponse.json({ success: false, error: 'subscriptionId required' }, { status: 400 });
    }
    await renewSubscription(subscriptionId);
    
    return NextResponse.json({ 
      success: true, 
      message: 'Subscription renewed for another 3 days'
    });
  } catch (error) {
    console.error('Setup PATCH error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
// DELETE - Remove subscription
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const subscriptionId = searchParams.get('id');
    
    if (!subscriptionId) {
      const existing = await listSubscriptions();
      for (const sub of existing) {
        if (sub.resource.includes('mailFolders')) {
          await deleteSubscription(sub.id);
        }
      }
      return NextResponse.json({ success: true, message: 'All mail subscriptions deleted' });
    }
    await deleteSubscription(subscriptionId);
    return NextResponse.json({ success: true, message: 'Subscription deleted' });
  } catch (error) {
    console.error('Setup DELETE error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}