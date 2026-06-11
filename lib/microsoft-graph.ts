// lib/microsoft-graph.ts
import {
  createDocument,
  saveExtractedData,
  createExtractionLog,
  updateDocumentStatus,
  storeEmailAttachment,
  linkAttachmentsToPortfolio,
} from './database';
import {
  extractFromPDF,
  classifyPDF,
  extractFromEmailBody,
  classifyEmailBody,
  classifyExcel,
  extractFromExcel,
  resolveDealRelation,
  EXTRACTION_MODEL,
  type ExtractionResult,
  type DealCandidate,
  type DealRelationResult,
} from './extraction';
import {
  createPendingImport,
  fuzzyMatchPortfolio,
  fuzzyMatchAsset,
  findAssetsByCityInPortfolio,
  checkExistingData,
  selectAutoMatch,
  type MatchCandidate,
  type AssetCandidate,
} from './pending-imports';
import { supabaseAdmin } from './supabase';
import { normalizeGerman, normalizeCity, normalizeStreet, containsWords } from './text-normalize';
import * as XLSX from 'xlsx';

const TENANT_ID = process.env.AZURE_TENANT_ID!;
const CLIENT_ID = process.env.AZURE_CLIENT_ID!;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET!;
const MAILBOX_EMAIL = process.env.SHARED_MAILBOX_EMAIL!;

interface GraphToken {
  access_token: string;
  expires_in: number;
}

interface EmailMessage {
  id: string;
  subject: string;
  bodyPreview: string;
  body: { contentType?: string; content: string };
  from: { emailAddress: { name: string; address: string } };
  receivedDateTime: string;
  hasAttachments: boolean;
  isRead: boolean;
  conversationId?: string;
}

interface Attachment {
  id: string;
  name: string;
  contentType: string;
  // Absent on referenceAttachment (OneDrive/SharePoint links) and
  // itemAttachment (embedded .msg/.eml) — those have no inline bytes.
  contentBytes?: string;
  size: number;
  isInline?: boolean;
  '@odata.type'?: string;
}

// ============================================
// TEXT PREPARATION
// ============================================

/**
 * Convert an email body to plain text while PRESERVING NEWLINES.
 * The forward markers, thread markers and commission regexes all depend on
 * line boundaries — collapsing "\s+" to spaces (the old behavior) silently
 * disabled every multi-line pattern in this pipeline.
 */
function toPlainText(content: string, contentType?: string): string {
  let text = content || '';
  if (!contentType || contentType.toLowerCase() !== 'text') {
    text = text
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<head[\s\S]*?<\/head>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6]|table|ul|ol|blockquote|pre)>/gi, '\n')
      .replace(/<(td|th)[^>]*>/gi, ' | ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&apos;/gi, "'");
  }
  return text
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Cut off a trailing signature block (greetings, "--" separator, MfG/VG/LG).
 * Used on forwarder notes / top-level body before they get injected into
 * prompts with HIGHEST PRIORITY — a phone number in a signature must not
 * override values from a PDF.
 */
function stripSignature(text: string): string {
  if (!text) return '';
  const markers: RegExp[] = [
    /^-- ?$/m,
    /^(mit freundlichen grüßen|mit freundlichem gruß|mit besten grüßen|freundliche grüße|viele grüße|beste grüße|schöne grüße|herzliche grüße|best regards|kind regards|warm regards|cordialement|bien cordialement)\b/im,
    /^(mfg|vg|lg)\s*[,.!]?\s*$/im,
  ];
  let cut = text.length;
  for (const marker of markers) {
    const match = text.match(marker);
    if (match?.index !== undefined && match.index > 0 && match.index < cut) {
      cut = match.index;
    }
  }
  return text.slice(0, cut).trim();
}

// Stacked reply/forward prefixes: "AW: WG: Fwd: ..." — the subject is a
// forward when ANY forward token appears in the prefix chain.
const FORWARD_SUBJECT_RE = /^((re|aw|fwd?|tr|wg|wtr|sv|vs)\s*:\s*)*((fwd?|tr|wg|wtr)\s*:)/i;
const SUBJECT_PREFIX_RE = /^((re|aw|fwd?|tr|wg|wtr|sv|vs)\s*:\s*)+/i;

// Parse forwarded email to extract only useful parts
function parseForwardedEmail(body: string): {
  clientNotes: string;
  originalSenderBlock: string;
  originalBodyPreview: string;
  markerFound: boolean;
} {
  // Common forward markers (French, German, English)
  const forwardMarkers = [
    /---------- Forwarded message ---------/i,
    /-------- Message transféré --------/i,
    /-------- Weitergeleitete Nachricht --------/i,
    /-----Original Message-----/i,
    /-----Message d'origine-----/i,
    /----- Mail transféré -----/i,
    /Begin forwarded message:/i,
    /Début du message transféré/i,
    /_{10,}/, // Long underscore line
    /De\s*:\s*.*@.*\nEnvoyé\s*:/i, // French Outlook format
    /Von\s*:\s*.*@.*\nGesendet\s*:/i, // German Outlook format
    /From\s*:\s*.*@.*\nSent\s*:/i, // English Outlook format
  ];

  let splitIndex = -1;

  for (const marker of forwardMarkers) {
    const match = body.match(marker);
    if (match && match.index !== undefined) {
      if (splitIndex === -1 || match.index < splitIndex) {
        splitIndex = match.index;
      }
    }
  }

  // If no marker found, try to find the first "From:" or "De:" or "Von:" pattern
  if (splitIndex === -1) {
    const fromMatch = body.match(/(From|De|Von)\s*:\s*[^<\n]*<[^>]+>/i);
    if (fromMatch && fromMatch.index !== undefined) {
      splitIndex = fromMatch.index;
    }
  }

  if (splitIndex === -1) {
    // Couldn't parse, return everything as client notes
    return {
      clientNotes: body.substring(0, 1500),
      originalSenderBlock: '',
      originalBodyPreview: '',
      markerFound: false,
    };
  }

  // Client notes = everything BEFORE the forward marker
  const clientNotes = body.substring(0, splitIndex).trim();

  // Rest of email after the marker
  const afterMarker = body.substring(splitIndex);

  // Extract original sender block (From/De/Von line with details)
  const senderPatterns = [
    // Outlook format: "From: Name <email>\nSent: date\nTo: ...\nSubject: ..."
    /(From|De|Von)\s*:\s*([^\n]+)\n(Sent|Envoyé|Gesendet)\s*:\s*([^\n]+)\n(To|À|An)\s*:\s*([^\n]+)\n(Subject|Objet|Betreff)\s*:\s*([^\n]+)/i,
    // Simple format: "From: Name <email>"
    /(From|De|Von)\s*:\s*([^<\n]*<[^>]+>)/i,
  ];

  let originalSenderBlock = '';
  for (const pattern of senderPatterns) {
    const match = afterMarker.match(pattern);
    if (match) {
      originalSenderBlock = match[0];
      break;
    }
  }

  // Extract just the beginning of the original email body (skip headers)
  let originalBodyPreview = '';
  const bodyStartMatch = afterMarker.match(/(Subject|Objet|Betreff)\s*:[^\n]+\n/i);
  if (bodyStartMatch && bodyStartMatch.index !== undefined) {
    const bodyStart = afterMarker.substring(bodyStartMatch.index + bodyStartMatch[0].length);
    // Take first 500 chars, but stop at any reply marker
    const replyMarkers = [/^>+\s/m, /^On .* wrote:/m, /^Le .* a écrit/m, /^Am .* schrieb/m];
    let previewEnd = 500;
    for (const marker of replyMarkers) {
      const replyMatch = bodyStart.match(marker);
      if (replyMatch && replyMatch.index !== undefined && replyMatch.index < previewEnd) {
        previewEnd = replyMatch.index;
      }
    }
    originalBodyPreview = bodyStart.substring(0, previewEnd).trim();
  } else {
    // Fallback: just take some text after sender block
    originalBodyPreview = afterMarker.substring(0, 500).trim();
  }

  return {
    clientNotes: clientNotes.substring(0, 1500), // Limit client notes
    originalSenderBlock,
    originalBodyPreview,
    markerFound: true,
  };
}

// ============================================
// MICROSOFT GRAPH API
// ============================================

// Get access token using client credentials
export async function getAccessToken(): Promise<string> {
  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get token: ${error}`);
  }

  const data: GraphToken = await response.json();
  return data.access_token;
}

// Get unread emails from shared mailbox (deduplicated by thread — only most recent per conversation)
export async function getUnreadEmails(): Promise<EmailMessage[]> {
  const token = await getAccessToken();

  const url = `https://graph.microsoft.com/v1.0/users/${MAILBOX_EMAIL}/mailFolders/inbox/messages?$filter=isRead eq false&$top=20&$orderby=receivedDateTime desc&$select=id,subject,bodyPreview,body,from,receivedDateTime,hasAttachments,isRead,conversationId`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get emails: ${error}`);
  }

  const data = await response.json();
  const allEmails: EmailMessage[] = data.value || [];

  // Deduplicate by conversationId — only keep the MOST RECENT email per thread
  // Since we ordered by receivedDateTime desc, the first one per conversationId is the newest
  const seenConversations = new Set<string>();
  const deduped: EmailMessage[] = [];
  const skippedOlder: string[] = [];

  for (const email of allEmails) {
    const convId = email.conversationId || email.id; // fallback if no conversationId
    if (seenConversations.has(convId)) {
      skippedOlder.push(`"${email.subject}" (${email.receivedDateTime})`);
      // Mark older thread emails as read so they don't come back
      markAsRead(email.id).catch(() => {}); // fire and forget
      continue;
    }
    seenConversations.add(convId);
    deduped.push(email);
  }

  if (skippedOlder.length > 0) {
    console.log(`📧 Thread dedup: kept ${deduped.length} newest, skipped ${skippedOlder.length} older:`);
    skippedOlder.forEach(s => console.log(`   ⏭️  ${s}`));
  }

  return deduped;
}

// Get specific email by ID
export async function getEmail(messageId: string): Promise<EmailMessage> {
  const token = await getAccessToken();

  const url = `https://graph.microsoft.com/v1.0/users/${MAILBOX_EMAIL}/messages/${messageId}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get email: ${error}`);
  }

  return response.json();
}

// Get attachments for an email
export async function getAttachments(messageId: string): Promise<Attachment[]> {
  const token = await getAccessToken();

  const url = `https://graph.microsoft.com/v1.0/users/${MAILBOX_EMAIL}/messages/${messageId}/attachments`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get attachments: ${error}`);
  }

  const data = await response.json();
  return data.value || [];
}

// Mark email as read
export async function markAsRead(messageId: string): Promise<boolean> {
  try {
    const token = await getAccessToken();

    const url = `https://graph.microsoft.com/v1.0/users/${MAILBOX_EMAIL}/messages/${messageId}`;

    console.log(`Marking email as read: ${messageId}`);

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ isRead: true }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`❌ Failed to mark email as read: ${response.status} - ${error}`);
      return false;
    }

    console.log(`✅ Email marked as read: ${messageId}`);
    return true;
  } catch (error) {
    console.error(`❌ Error marking email as read:`, error);
    return false;
  }
}

// ============================================
// DEAL CANDIDATES & DUPLICATE DETECTION
// ============================================

/**
 * Compact view of existing deals used both by the LLM deal-resolution step
 * and by the duplicate safety net. Same-thread detection uses the cleaned
 * subject stored on previous documents (no schema change needed).
 */
async function getDealCandidates(cleanSubject: string): Promise<DealCandidate[]> {
  const { data: portfolios } = await supabaseAdmin
    .from('portfolios')
    .select('id, name, document_id, email_contact_email')
    .order('created_at', { ascending: false })
    .limit(150);
  if (!portfolios || portfolios.length === 0) return [];

  const ids = portfolios.map(p => p.id);
  const { data: assets } = await supabaseAdmin
    .from('assets')
    .select('portfolio_id, city, street')
    .in('portfolio_id', ids);

  let sameSubjectDocIds = new Set<string>();
  if (cleanSubject && cleanSubject.length >= 4) {
    const { data: docs } = await supabaseAdmin
      .from('documents')
      .select('id')
      .eq('email_subject', cleanSubject)
      .limit(50);
    sameSubjectDocIds = new Set((docs || []).map(d => d.id));
  }

  const assetsByPortfolio = new Map<string, { cities: string[]; streets: string[] }>();
  for (const a of assets || []) {
    if (!a.portfolio_id) continue;
    const entry = assetsByPortfolio.get(a.portfolio_id) || { cities: [], streets: [] };
    entry.cities.push(a.city || '');
    entry.streets.push(a.street || '');
    assetsByPortfolio.set(a.portfolio_id, entry);
  }

  return portfolios.map(p => {
    const entry = assetsByPortfolio.get(p.id) || { cities: [], streets: [] };
    return {
      id: p.id,
      name: p.name || 'Unnamed',
      cities: entry.cities,
      streets: entry.streets,
      brokerEmail: p.email_contact_email || null,
      sameThread: p.document_id ? sameSubjectDocIds.has(p.document_id) : false,
    };
  });
}

/**
 * Conservative duplicate detection against existing deals. Replaces the old
 * substring `includes()` logic which (a) matched any extracted city appearing
 * anywhere in an existing portfolio name (two different deals in the same
 * city = second one dropped) and (b) had no word boundaries ("Burg" matched
 * "Neuburg"). Rules:
 *  1. Strong project-name match (whole words, both names ≥ 6 chars).
 *  2. Same property: matching city AND street.
 *  3. City-only match ONLY when the candidate is the single-asset deal named
 *     after that city and neither side has a street to compare.
 */
function findDuplicatePortfolio(
  data: ExtractionResult['data'],
  candidates: DealCandidate[]
): DealCandidate | null {
  const assets = data.assets || [];
  const rawName = String(
    data.portfolio?.name
    || (assets.length === 1 ? assets[0].city || '' : '')
    || ''
  );
  const extractedName = normalizeGerman(rawName);
  const extractedAssets = assets.map(a => ({
    city: normalizeCity(a.city as string | null),
    street: normalizeStreet(a.street as string | null),
  }));

  for (const c of candidates) {
    const cName = normalizeGerman(c.name);

    // 1) Strong name match
    if (extractedName.length >= 6 && cName.length >= 6) {
      if (
        extractedName === cName ||
        containsWords(cName, extractedName) ||
        containsWords(extractedName, cName)
      ) {
        return c;
      }
    }

    // 2) Same property (city AND street), 3) city-only special case
    for (const ea of extractedAssets) {
      if (!ea.city) continue;
      for (let i = 0; i < c.cities.length; i++) {
        const cc = normalizeCity(c.cities[i]);
        if (!cc || cc !== ea.city) continue;
        const cs = normalizeStreet(c.streets[i]);
        if (ea.street && cs && (cs === ea.street || containsWords(cs, ea.street) || containsWords(ea.street, cs))) {
          return c;
        }
        if (!ea.street && !cs && cName === ea.city) {
          return c;
        }
      }
    }
  }
  return null;
}

// ============================================
// PENDING IMPORT CREATION (shared by PDF rent rolls, deal updates and Excel)
// ============================================

interface PendingCreationOpts {
  type: 'asset-list' | 'tenant-list';
  extraction: ExtractionResult;
  fileName: string;
  messageId: string;
  emailContext: string;
  forwarderNotes: string;
  cleanSubject: string;
  targetName?: string | null;
  /** When the deal-resolution step (or dedup) already identified the portfolio. */
  preferredPortfolioId?: string | null;
  /** Short explanation prepended to the forwarder notes for the reviewer. */
  preferredReason?: string;
  classifiedCities?: string[];
}

async function getPortfolioName(portfolioId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('portfolios').select('name').eq('id', portfolioId).single();
  return data?.name || 'Existing deal';
}

/**
 * Build the city→asset mapping + issue type for a tenant list targeting a
 * known portfolio (mirrors the historical Excel logic, factored out so PDF
 * rent rolls go through the same path).
 */
async function buildTenantMapping(
  portfolioId: string,
  cities: string[],
  anchorAssetId?: string,
): Promise<{
  cityAssetMapping: Record<string, AssetCandidate[]>;
  suggestedAssetId?: string;
  issueType: 'ambiguous_city' | 'multi_asset_tenants' | 'existing_data' | null;
}> {
  const cityAssetMapping = await findAssetsByCityInPortfolio(portfolioId, cities);

  let suggestedAssetId = anchorAssetId;
  if (!suggestedAssetId) {
    const { data: pAssets } = await supabaseAdmin
      .from('assets').select('id').eq('portfolio_id', portfolioId);
    if (pAssets && pAssets.length === 1) suggestedAssetId = pAssets[0].id;
  }

  let issueType: 'ambiguous_city' | 'multi_asset_tenants' | 'existing_data' | null = null;
  const totalAssets = Object.values(cityAssetMapping).reduce((sum, arr) => sum + arr.length, 0);
  const totalKeys = Object.keys(cityAssetMapping).length;
  const ambiguous = Object.entries(cityAssetMapping).filter(([, a]) => a.length > 1);
  if (totalKeys > 1 || totalAssets > cities.length) {
    issueType = ambiguous.length > 0 ? 'ambiguous_city' : 'multi_asset_tenants';
  }

  // Existing tenants over all involved assets (needed so the UI can propose replace/append)
  const allAssetIds = Object.values(cityAssetMapping).flat().map(a => a.asset_id);
  const uniqueAssetIds = [...new Set([...(anchorAssetId ? [anchorAssetId] : []), ...allAssetIds])];
  let totalExistingTenants = 0;
  for (const aid of uniqueAssetIds) {
    const existing = await checkExistingData('tenant-list', undefined, aid);
    totalExistingTenants += existing.existingCount;
  }
  if (!issueType && totalExistingTenants > 0) issueType = 'existing_data';
  if (totalExistingTenants > 0) {
    cityAssetMapping['_meta'] = [{
      asset_id: '_existing_tenants',
      tenant_count: totalExistingTenants,
      name: `${totalExistingTenants} existing tenants`,
    }];
  }

  return { cityAssetMapping, suggestedAssetId, issueType };
}

async function createPendingFromExtraction(opts: PendingCreationOpts): Promise<{ issueType: string }> {
  const {
    type, extraction, fileName, messageId, emailContext, forwarderNotes,
    cleanSubject, preferredPortfolioId, preferredReason, classifiedCities = [],
  } = opts;
  const targetName = opts.targetName || cleanSubject;

  let issueType: 'no_match' | 'multiple_matches' | 'existing_data' | 'ambiguous_city' | 'multi_asset_tenants' | null = null;
  let suggestedPortfolioId: string | undefined;
  let suggestedAssetId: string | undefined;
  let matchCandidates: MatchCandidate[] = [];
  let cityAssetMapping: Record<string, AssetCandidate[]> = {};

  // Cities: prefer what was actually EXTRACTED over the preview-based classification
  // (the classifier only sees the first rows of each sheet).
  const extractedCities = [...new Set(
    (extraction.data.tenants || [])
      .map((t: Record<string, unknown>) => t.asset_city as string)
      .filter(Boolean)
  )];
  const cities = extractedCities.length > 0 ? extractedCities : classifiedCities;

  if (type === 'asset-list') {
    if (preferredPortfolioId) {
      suggestedPortfolioId = preferredPortfolioId;
      matchCandidates = [{
        id: preferredPortfolioId,
        name: await getPortfolioName(preferredPortfolioId),
        score: 95,
        type: 'portfolio',
      }];
      const existing = await checkExistingData('asset-list', preferredPortfolioId);
      if (existing.hasExisting) {
        issueType = 'existing_data';
        cityAssetMapping['_meta'] = [{
          asset_id: '_existing_assets',
          tenant_count: existing.existingCount,
          name: `${existing.existingCount} existing assets`,
        }];
      }
    } else {
      const candidates = await fuzzyMatchPortfolio(targetName);
      matchCandidates = candidates;
      const auto = selectAutoMatch(candidates);
      if (candidates.length === 0) {
        issueType = 'no_match';
      } else if (auto) {
        suggestedPortfolioId = auto.id;
        const existing = await checkExistingData('asset-list', auto.id);
        if (existing.hasExisting) {
          issueType = 'existing_data';
          cityAssetMapping['_meta'] = [{
            asset_id: '_existing_assets',
            tenant_count: existing.existingCount,
            name: `${existing.existingCount} existing assets`,
          }];
        }
      } else {
        issueType = 'multiple_matches';
      }
    }
  } else {
    // tenant-list
    if (preferredPortfolioId) {
      suggestedPortfolioId = preferredPortfolioId;
      matchCandidates = [{
        id: preferredPortfolioId,
        name: await getPortfolioName(preferredPortfolioId),
        score: 95,
        type: 'portfolio',
      }];
      const mapping = await buildTenantMapping(preferredPortfolioId, cities);
      cityAssetMapping = mapping.cityAssetMapping;
      suggestedAssetId = mapping.suggestedAssetId;
      issueType = mapping.issueType;
    } else {
      const candidates = await fuzzyMatchAsset(targetName);
      matchCandidates = candidates;
      const auto = selectAutoMatch(candidates);
      if (candidates.length === 0) {
        issueType = 'no_match';
      } else if (auto) {
        suggestedAssetId = auto.id;
        const { data: assetRow } = await supabaseAdmin
          .from('assets').select('portfolio_id').eq('id', auto.id).single();
        if (assetRow?.portfolio_id) {
          suggestedPortfolioId = assetRow.portfolio_id;
          const mapping = await buildTenantMapping(assetRow.portfolio_id, cities, auto.id);
          cityAssetMapping = mapping.cityAssetMapping;
          if (mapping.suggestedAssetId) suggestedAssetId = mapping.suggestedAssetId;
          issueType = mapping.issueType;
        }
      } else {
        issueType = candidates.length > 1 ? 'multiple_matches' : 'no_match';
      }
    }
  }

  console.log(`  📋 Creating pending import (type: ${type}, issue: ${issueType || 'review_required'}, target: "${targetName}")`);
  await createPendingImport({
    type,
    status: 'pending_match',
    issue_type: issueType || 'no_match',
    raw_data: extraction.data,
    file_name: fileName,
    email_message_id: messageId,
    email_context: emailContext,
    forwarder_notes: preferredReason ? `🤖 ${preferredReason}\n\n${forwarderNotes}` : forwarderNotes,
    target_name: targetName,
    suggested_portfolio_id: suggestedPortfolioId,
    suggested_asset_id: suggestedAssetId,
    match_candidates: matchCandidates,
    city_asset_mapping: cityAssetMapping,
  });

  return { issueType: issueType || 'review_required' };
}

// ============================================
// SMALL HELPERS
// ============================================

async function appendPortfolioNote(portfolioId: string, note: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from('portfolios').select('notes').eq('id', portfolioId).single();
  const existing = typeof data?.notes === 'string' && data.notes.trim() ? data.notes.trim() + '\n\n' : '';
  await supabaseAdmin
    .from('portfolios')
    .update({ notes: existing + note })
    .eq('id', portfolioId);
}

/** Safety net: a portfolio must never end up with zero assets in the DB. */
async function forceCreateFallbackAsset(
  documentId: string,
  portfolioId: string,
  portfolio: Record<string, unknown> | undefined,
  fallbackCity: string,
): Promise<string | null> {
  const fallbackAsset: Record<string, unknown> = {
    city: fallbackCity || 'Unknown',
    notes: '⚠️ Auto-created: extraction returned no assets',
  };
  const p = portfolio || {};
  if (p.total_gla) fallbackAsset.gla = p.total_gla;
  if (p.annual_rent_income) fallbackAsset.annual_rent = p.annual_rent_income;
  if (p.purchase_price) fallbackAsset.purchase_price = p.purchase_price;
  if (p.noi) fallbackAsset.noi = p.noi;
  if (p.noi_margin) fallbackAsset.noi_margin = p.noi_margin;
  if (p.walt) fallbackAsset.walt = p.walt;
  if (p.total_plot_area) fallbackAsset.plot_area = p.total_plot_area;

  const { data: forceAsset, error } = await supabaseAdmin
    .from('assets')
    .insert({ document_id: documentId, portfolio_id: portfolioId, ...fallbackAsset })
    .select()
    .single();

  if (error) {
    console.error(`  ❌ Force-create asset failed:`, error);
    return null;
  }
  console.log(`  ✅ Force-created asset: ${forceAsset.id} (${fallbackAsset.city})`);
  return forceAsset.id;
}

/** Convert a spreadsheet attachment to CSV + a per-sheet preview for classification. */
function spreadsheetToCsv(buffer: Buffer, fileName: string): { csvContent: string; preview: string } {
  if (fileName.toLowerCase().endsWith('.csv')) {
    const csv = buffer.toString('utf-8');
    return { csvContent: csv, preview: csv.split('\n').slice(0, 30).join('\n') };
  }
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const allSheets: string[] = [];
  const previews: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ';', blankrows: false });
    if (csv.trim().length > 10) {
      allSheets.push(`--- Sheet: ${sheetName} ---\n${csv}`);
      // Headers + first rows of EVERY sheet — the classifier must not judge
      // a multi-sheet workbook by its cover sheet alone.
      previews.push(`--- Sheet: ${sheetName} ---\n${csv.split('\n').slice(0, 12).join('\n')}`);
    }
  }
  return { csvContent: allSheets.join('\n\n'), preview: previews.join('\n\n') };
}

// ============================================
// MAIN: PROCESS A SINGLE EMAIL
// ============================================

export async function processEmail(messageId: string): Promise<{
  success: boolean;
  documentIds?: string[];
  portfolioIds?: string[];
  processedCount?: number;
  skippedCount?: number;
  relation?: string;
  details?: Array<{
    fileName: string;
    status: 'processed' | 'skipped' | 'error';
    reason?: string;
    documentId?: string;
    portfolioId?: string;
  }>;
  error?: string;
}> {
  // Lock/audit document id — created early, finalized in the end/catch blocks.
  let lockDocId: string | null = null;

  try {
    // ============================================
    // DEDUP — no .single() here: multi-PDF emails have several document rows
    // and .single() errors on >1 rows, which used to BYPASS the dedup.
    // ============================================
    const { data: existingDocs } = await supabaseAdmin
      .from('documents')
      .select('id')
      .eq('email_message_id', messageId)
      .limit(1);

    if (existingDocs && existingDocs.length > 0) {
      console.log(`Email already processed (found in DB), skipping: ${messageId}`);
      await markAsRead(messageId); // Make sure it's marked as read
      return { success: true, error: 'Already processed (found in database)' };
    }

    // Also check pending_imports for dedup (Excel/rent-roll emails may not create documents)
    const { data: existingPending } = await supabaseAdmin
      .from('pending_imports')
      .select('id')
      .eq('email_message_id', messageId)
      .limit(1);

    if (existingPending && existingPending.length > 0) {
      console.log(`Email already has pending imports, skipping: ${messageId}`);
      await markAsRead(messageId);
      return { success: true, error: 'Already processed (found in pending_imports)' };
    }

    // Get email details
    const email = await getEmail(messageId);

    // Skip if already read
    if (email.isRead) {
      console.log(`Email already read, skipping: ${email.subject}`);
      return { success: true, error: 'Already processed (email was read)' };
    }

    const cleanSubject = email.subject.replace(SUBJECT_PREFIX_RE, '').trim();

    // ============================================
    // PROCESSING LOCK — a document row created BEFORE any heavy work.
    // It makes Graph webhook retries hit the dedup above, survives crashes
    // (status stays 'processing' → visible), and doubles as an audit trail
    // for emails that produce no portfolio at all.
    // ============================================
    const lockDoc = await createDocument(
      `📧 ${cleanSubject || email.subject || 'email'}`,
      'portfolio',
      undefined,
      cleanSubject,
      messageId
    );
    lockDocId = lockDoc.id;

    // Mark as read right after the lock to stop the cron path from re-picking it
    await markAsRead(messageId);

    console.log(`Processing email: ${email.subject}`);

    // ============================================
    // BODY PREPARATION (newline-preserving!)
    // ============================================
    const plainBody = toPlainText(email.body?.content || '', email.body?.contentType);
    const directSender = `${email.from.emailAddress.name} <${email.from.emailAddress.address}>`;

    const parsedFwd = parseForwardedEmail(plainBody);
    // Forward detection: stacked subject prefixes ("AW: WG: ...") OR a forward
    // marker inside the body (forwards without a subject prefix used to be
    // treated as direct emails — the broker's text then became top-priority
    // "client notes", inverting the whole hierarchy).
    const isForwarded = FORWARD_SUBJECT_RE.test(email.subject) || parsedFwd.markerFound;

    let emailContext: string;
    let forwarderNotes = '';
    if (isForwarded) {
      forwarderNotes = stripSignature(parsedFwd.clientNotes);
      emailContext = `📧 FORWARDED EMAIL ANALYSIS

FORWARDED BY: ${directSender}

CLIENT NOTES (🥇 HIGHEST PRIORITY - these values OVERRIDE the PDF):
${forwarderNotes || '(no notes added by forwarder)'}

ORIGINAL SENDER INFO (extract broker contact for emailContact: name, email, phone, company):
${parsedFwd.originalSenderBlock || directSender}

ORIGINAL EMAIL PREVIEW (🥉 LOWEST PRIORITY - only use for data NOT in client notes or PDF):
${parsedFwd.originalBodyPreview || '(no body)'}`;
    } else {
      // Strip any reply/thread history — only keep the top-level email
      let topLevelBody = plainBody;
      const threadMarkers = [
        /^>+\s/m, /^On .+ wrote:\s*$/m, /^Le .+ a écrit\s*:\s*$/m,
        /^Am .+ schrieb\s*:?\s*$/m, /^-{5,}Original Message-{5,}/mi,
        /^-{5,}Message d'origine-{5,}/mi,
        /^From:\s+.+\nSent:\s+/mi, /^De\s*:\s+.+\nEnvoyé\s*:\s+/mi,
        /^Von\s*:\s+.+\nGesendet\s*:\s+/mi,
      ];
      for (const marker of threadMarkers) {
        const match = topLevelBody.match(marker);
        if (match && match.index !== undefined && match.index > 100) {
          topLevelBody = topLevelBody.substring(0, match.index).trim();
          break;
        }
      }
      forwarderNotes = stripSignature(topLevelBody).substring(0, 1200);
      emailContext = `From: ${email.from.emailAddress.name} <${email.from.emailAddress.address}>
Subject: ${email.subject}
Date: ${email.receivedDateTime}

${topLevelBody.substring(0, 6000)}`;
    }

    const classificationContext = `Subject: ${cleanSubject}\nFrom: ${directSender}\nForwarder notes: ${forwarderNotes.substring(0, 800)}`;

    // ============================================
    // ATTACHMENTS
    // ============================================
    const attachments = await getAttachments(messageId);

    console.log(`📎 All attachments (${attachments.length}):`);
    for (const a of attachments) {
      console.log(`   - "${a.name}" (${a.contentType}, ${a.size} bytes${a.isInline ? ', inline' : ''}${a.contentBytes ? '' : ', NO CONTENT'})`);
    }

    const results: Array<{
      fileName: string;
      status: 'processed' | 'skipped' | 'error';
      reason?: string;
      documentId?: string;
      portfolioId?: string;
    }> = [];
    const processedDocs: string[] = [];
    const processedPortfolios: string[] = [];
    let pendingCreatedCount = 0;

    const pdfAttachments = attachments.filter(
      a => !!a.contentBytes && (a.contentType === 'application/pdf' || a.name.toLowerCase().endsWith('.pdf'))
    );

    // Excel detection: check MIME types AND file extensions
    // Microsoft Graph often sends application/octet-stream for Excel files
    const excelExtensions = ['.xlsx', '.xls', '.csv', '.xlsm', '.xlsb'];
    const excelMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/csv',
    ];
    const excelAttachments = attachments.filter(a => {
      if (!a.contentBytes) return false;
      const nameLC = a.name.toLowerCase();
      const isExcelByName = excelExtensions.some(ext => nameLC.endsWith(ext));
      const isExcelByType = excelMimeTypes.includes(a.contentType);
      const isOctetWithExcelExt = a.contentType === 'application/octet-stream' && isExcelByName;
      return isExcelByName || isExcelByType || isOctetWithExcelExt;
    });

    // ============================================
    // STORE ATTACHMENTS IN SUPABASE STORAGE
    // - skip inline images (signature logos) and tiny images
    // - surface unsupported attachments (SharePoint links, embedded .msg)
    //   instead of dropping them silently
    // ============================================
    console.log(`💾 Storing attachments in storage...`);
    for (const att of attachments) {
      if (!att.contentBytes) {
        const odataType = att['@odata.type'] || 'unknown type';
        console.warn(`   - ${att.name}: no contentBytes (${odataType})`);
        results.push({
          fileName: att.name,
          status: 'skipped',
          reason: `Unsupported attachment (${odataType.replace('#microsoft.graph.', '')}) — e.g. SharePoint/OneDrive link or embedded email. Retrieve it manually from the mailbox.`,
        });
        continue;
      }
      const isTinyImage = att.contentType?.startsWith('image/') && att.size < 50_000;
      if (att.isInline || isTinyImage) {
        console.log(`   ⏭️  Skipping ${att.isInline ? 'inline' : 'tiny'} image: ${att.name}`);
        continue;
      }
      const stored = await storeEmailAttachment({
        base64: att.contentBytes,
        fileName: att.name,
        contentType: att.contentType,
        sizeBytes: att.size,
        emailMessageId: messageId,
        emailSubject: email.subject,
        emailFrom: email.from.emailAddress.address,
        portfolioId: null, // will be linked later
        role: 'secondary',
      });
      if (stored) {
        console.log(`   ✅ Stored: ${att.name} → ${stored.storage_path}`);
      } else {
        console.warn(`   ⚠️ Failed to store: ${att.name}`);
      }
    }

    // ============================================
    // DEAL RESOLUTION — is this email about an EXISTING deal?
    // LLM router over a compact candidate list (recent portfolios + their
    // cities/streets + broker emails + same-subject-thread flag).
    // Fails safe to 'uncertain' → flow behaves like the legacy default.
    // ============================================
    let dealCandidates: DealCandidate[] = [];
    let dealRelation: DealRelationResult = {
      relation: 'uncertain', portfolioId: null, confidence: 0, reasoning: 'Resolution not run',
    };
    try {
      dealCandidates = await getDealCandidates(cleanSubject);
      if (dealCandidates.length > 0) {
        dealRelation = await resolveDealRelation(
          emailContext,
          attachments.map(a => a.name),
          dealCandidates
        );
      } else {
        dealRelation = { relation: 'new_deal', portfolioId: null, confidence: 0.5, reasoning: 'No existing deals yet' };
      }
      console.log(`🧭 Deal relation: ${dealRelation.relation} (${dealRelation.confidence}) — ${dealRelation.reasoning}`);
    } catch (error) {
      console.error('Deal resolution failed (continuing with default flow):', error);
    }
    const targetPortfolioId =
      dealRelation.relation === 'update_existing' && dealRelation.confidence >= 0.6
        ? dealRelation.portfolioId
        : null;

    // ============================================
    // STEP 1: Process PDFs
    // - rent rolls → pending import (tenant-list), like Excel
    // - updates to an existing deal → pending import (asset-list) for review
    // - new deals → duplicate safety net, then save
    // ============================================
    if (pdfAttachments.length > 0) {
      console.log(`📎 Processing ${pdfAttachments.length} PDF(s) in email`);

      for (let i = 0; i < pdfAttachments.length; i++) {
        const pdf = pdfAttachments[i];
        console.log(`\n📄 [${i + 1}/${pdfAttachments.length}] Analyzing: ${pdf.name}`);

        try {
          console.log(`  🔍 Step 1: Classifying PDF...`);
          const classification = await classifyPDF(pdf.contentBytes!, pdf.name, classificationContext);
          console.log(`  📊 Classification result:`, classification);

          if (!classification.isRelevant) {
            console.log(`  ⏭️  SKIPPED: ${classification.reason}`);
            results.push({ fileName: pdf.name, status: 'skipped', reason: classification.reason });
            continue;
          }

          console.log(`  ✅ RELEVANT: ${classification.reason}`);
          console.log(`  📝 Document type: ${classification.documentType}`);
          console.log(`  🔬 Step 2: Full extraction...`);

          const documentType = classification.documentType === 'unknown' ? 'asset' : classification.documentType;
          const extraction = await extractFromPDF(pdf.contentBytes!, documentType, emailContext);

          // ── Route A: rent roll PDF → same pending flow as Excel tenant lists.
          // (The old code created a brand-new duplicate portfolio from rent
          // rolls instead of attaching the tenants to the existing deal.)
          if (documentType === 'rent-roll' && (extraction.data.tenants?.length || 0) > 0) {
            const pendingInfo = await createPendingFromExtraction({
              type: 'tenant-list',
              extraction,
              fileName: pdf.name,
              messageId,
              emailContext,
              forwarderNotes,
              cleanSubject,
              targetName: (extraction.data.assets?.[0]?.city as string) || cleanSubject,
              preferredPortfolioId: targetPortfolioId,
              preferredReason: targetPortfolioId
                ? `Deal resolution matched this email to an existing deal: ${dealRelation.reasoning}`
                : undefined,
            });
            pendingCreatedCount++;
            results.push({
              fileName: pdf.name,
              status: 'processed',
              reason: `Rent roll routed to pending review (${pendingInfo.issueType})`,
            });
            continue;
          }

          // ── Route B: confident update of an existing deal → pending review,
          // never a silent new portfolio and never a silent drop.
          if (targetPortfolioId) {
            const pendingInfo = await createPendingFromExtraction({
              type: 'asset-list',
              extraction,
              fileName: pdf.name,
              messageId,
              emailContext,
              forwarderNotes,
              cleanSubject,
              preferredPortfolioId: targetPortfolioId,
              preferredReason: `Deal resolution matched this email to an existing deal: ${dealRelation.reasoning}`,
            });
            pendingCreatedCount++;
            results.push({
              fileName: pdf.name,
              status: 'processed',
              reason: `Update for existing deal — pending review (${pendingInfo.issueType})`,
            });
            continue;
          }

          // ── Route C: new deal. Duplicate safety net — when a duplicate is
          // found, route to pending review instead of deleting the extraction.
          const duplicate = findDuplicatePortfolio(extraction.data, dealCandidates);
          if (duplicate) {
            console.log(`  ⚠️  DEDUP: extraction matches existing "${duplicate.name}" — routing to pending review`);
            const pendingInfo = await createPendingFromExtraction({
              type: 'asset-list',
              extraction,
              fileName: pdf.name,
              messageId,
              emailContext,
              forwarderNotes,
              cleanSubject,
              preferredPortfolioId: duplicate.id,
              preferredReason: `Possible duplicate of existing deal "${duplicate.name}" — review before applying`,
            });
            pendingCreatedCount++;
            results.push({
              fileName: pdf.name,
              status: 'processed',
              reason: `Possible duplicate of "${duplicate.name}" — pending review (${pendingInfo.issueType})`,
            });
            continue;
          }

          // ── Save as a new portfolio
          const doc = await createDocument(pdf.name, documentType, emailContext, cleanSubject, messageId);
          const saved = await saveExtractedData(doc.id, extraction.data, {
            base64: pdf.contentBytes!, fileName: pdf.name
          });

          // 🔥 SAFETY NET: Verify portfolio has at least 1 asset in DB
          if (saved.portfolioId && saved.assetIds.length === 0) {
            console.warn(`  🚨 SAFETY NET: Portfolio ${saved.portfolioId} has 0 assets after save — force-creating one`);
            const forcedId = await forceCreateFallbackAsset(
              doc.id,
              saved.portfolioId,
              extraction.data.portfolio,
              String(extraction.data.portfolio?.name || extraction.data.assets?.[0]?.city || cleanSubject || 'Unknown'),
            );
            if (forcedId) saved.assetIds.push(forcedId);
          }

          await createExtractionLog(doc.id, {
            model_used: EXTRACTION_MODEL,
            prompt_tokens: extraction.usage.promptTokens,
            completion_tokens: extraction.usage.completionTokens,
            total_tokens: extraction.usage.totalTokens,
            processing_time_ms: extraction.processingTimeMs,
            source: isForwarded ? 'email_forwarded' : 'email',
            email_from: email.from.emailAddress.address,
            email_message_id: messageId,
            pdf_index: i,
            pdf_total: pdfAttachments.length,
          });

          console.log(`  ✅ Successfully processed: ${pdf.name} -> Portfolio ${saved.portfolioId}`);
          processedDocs.push(doc.id);
          if (saved.portfolioId) processedPortfolios.push(saved.portfolioId);

          // Link ONLY this PDF to its portfolio (multi-PDF emails used to dump
          // every attachment on the first portfolio created).
          if (saved.portfolioId) {
            const linkResult = await linkAttachmentsToPortfolio(messageId, saved.portfolioId, pdf.name);
            console.log(`  🔗 Linked ${linkResult.linkedCount} attachment(s) to portfolio ${saved.portfolioId} (${linkResult.movedCount} moved from unassigned/)`);

            await supabaseAdmin
              .from('email_attachments')
              .update({ attachment_role: 'primary' })
              .eq('email_message_id', messageId)
              .eq('file_name', pdf.name);
          }

          results.push({
            fileName: pdf.name, status: 'processed', reason: classification.reason,
            documentId: doc.id, portfolioId: saved.portfolioId
          });

        } catch (error) {
          console.error(`  ❌ Error processing ${pdf.name}:`, error);
          let errorMessage = 'Unknown error';
          if (error instanceof Error) errorMessage = error.message;
          else if (typeof error === 'string') errorMessage = error;
          else { try { errorMessage = JSON.stringify(error, null, 2); } catch { errorMessage = String(error); } }
          results.push({ fileName: pdf.name, status: 'error', reason: errorMessage });
        }
      }
    }

    // ============================================
    // STEP 2: Email body — runs whenever the PDFs yielded NOTHING useful
    // (no PDFs at all, or every PDF was skipped/errored). The old condition
    // `pdfAttachments.length === 0` meant a detailed body next to an
    // irrelevant cover-letter PDF was never extracted.
    // ============================================
    const pdfYieldedSomething = results.some(r => r.status === 'processed');
    if (!pdfYieldedSomething) {
      if (targetPortfolioId) {
        // Follow-up about an existing deal with no usable attachment:
        // preserve the info as a note instead of dropping it (or worse,
        // creating a duplicate portfolio).
        const noteBody = (forwarderNotes || plainBody).substring(0, 800).trim();
        if (noteBody) {
          const dateStr = (email.receivedDateTime || '').split('T')[0];
          await appendPortfolioNote(
            targetPortfolioId,
            `📧 Update ${dateStr} from ${email.from.emailAddress.address}${cleanSubject ? ` — "${cleanSubject}"` : ''}:\n${noteBody}`
          );
          console.log(`📝 Appended update note to existing portfolio ${targetPortfolioId}`);
          results.push({
            fileName: '(email body)',
            status: 'processed',
            reason: `Appended as update note to existing deal (${dealRelation.reasoning})`,
            portfolioId: targetPortfolioId,
          });
        }
      } else if (dealRelation.relation === 'irrelevant' && dealRelation.confidence >= 0.7) {
        console.log(`⏭️  Email judged irrelevant by deal resolution: ${dealRelation.reasoning}`);
      } else {
        console.log(`\n📝 Checking if email body contains deal data...`);

        const classification = await classifyEmailBody(emailContext, cleanSubject);
        console.log(`📊 Email body classification:`, classification);

        if (classification.isRelevant) {
          console.log(`✅ Email body contains deal data, extracting...`);
          const documentType =
            classification.documentType === 'deal-summary' || classification.documentType === 'unknown'
              ? 'portfolio'
              : classification.documentType;
          const extraction = await extractFromEmailBody(emailContext, documentType, cleanSubject);

          if (!extraction.data.assets || extraction.data.assets.length === 0) {
            console.warn(`⚠️ Extraction returned no assets from email body, skipping`);
          } else {
            const duplicate = findDuplicatePortfolio(extraction.data, dealCandidates);
            if (duplicate) {
              console.log(`⚠️  DEDUP (body): matches existing "${duplicate.name}" — routing to pending review`);
              const pendingInfo = await createPendingFromExtraction({
                type: 'asset-list',
                extraction,
                fileName: `${cleanSubject || 'email-body'}.email`,
                messageId,
                emailContext,
                forwarderNotes,
                cleanSubject,
                preferredPortfolioId: duplicate.id,
                preferredReason: `Possible duplicate of existing deal "${duplicate.name}" — review before applying`,
              });
              pendingCreatedCount++;
              results.push({
                fileName: `${cleanSubject || 'email-body'}.email`,
                status: 'processed',
                reason: `Possible duplicate of "${duplicate.name}" — pending review (${pendingInfo.issueType})`,
              });
            } else {
              const doc = await createDocument(`${cleanSubject || 'email-body'}.email`, documentType, emailContext, cleanSubject, messageId);
              const saved = await saveExtractedData(doc.id, extraction.data);

              // 🔥 SAFETY NET: same as PDF path
              if (saved.portfolioId && saved.assetIds.length === 0) {
                console.warn(`  🚨 SAFETY NET (email body): Portfolio ${saved.portfolioId} has 0 assets — force-creating one`);
                const forcedId = await forceCreateFallbackAsset(
                  doc.id,
                  saved.portfolioId,
                  extraction.data.portfolio,
                  String(extraction.data.portfolio?.name || cleanSubject || 'Unknown'),
                );
                if (forcedId) saved.assetIds.push(forcedId);
              }

              await createExtractionLog(doc.id, {
                model_used: EXTRACTION_MODEL,
                prompt_tokens: extraction.usage.promptTokens,
                completion_tokens: extraction.usage.completionTokens,
                total_tokens: extraction.usage.totalTokens,
                processing_time_ms: extraction.processingTimeMs,
                source: isForwarded ? 'email_body_forwarded' : 'email_body',
                email_from: email.from.emailAddress.address,
                email_message_id: messageId,
                pdf_index: -1, pdf_total: 0,
              });
              console.log(`✅ Extracted from email body → Portfolio ${saved.portfolioId}`);
              processedDocs.push(doc.id);
              if (saved.portfolioId) processedPortfolios.push(saved.portfolioId);

              results.push({
                fileName: `${cleanSubject || 'email-body'}.email`, status: 'processed',
                reason: `Extracted from email body: ${classification.reason}`,
                documentId: doc.id, portfolioId: saved.portfolioId
              });
            }
          }
        } else {
          console.log(`⏭️  Email body not relevant: ${classification.reason}`);
        }
      }
    }

    // ============================================
    // STEP 3: Process Excel files (if any) — always pending imports
    // Runs AFTER PDFs and body so matching finds just-created portfolios;
    // the deal-resolution target (if any) is passed as the preferred match.
    // ============================================
    if (excelAttachments.length > 0) {
      console.log(`\n📊 Processing ${excelAttachments.length} Excel file(s): ${excelAttachments.map(a => a.name).join(', ')}`);

      for (let i = 0; i < excelAttachments.length; i++) {
        const excel = excelAttachments[i];
        console.log(`\n📊 [${i + 1}/${excelAttachments.length}] Processing Excel: ${excel.name}`);

        try {
          const buffer = Buffer.from(excel.contentBytes!, 'base64');
          const { csvContent, preview } = spreadsheetToCsv(buffer, excel.name);

          if (csvContent.trim().length < 50) {
            console.log(`  ⏭️  Excel file too small/empty, skipping`);
            results.push({ fileName: excel.name, status: 'skipped', reason: 'Empty spreadsheet' });
            continue;
          }

          console.log(`  🔍 Classifying spreadsheet...`);
          const classification = await classifyExcel(preview, excel.name, forwarderNotes);
          console.log(`  📊 Classification:`, classification);

          if (classification.type === 'unknown') {
            results.push({ fileName: excel.name, status: 'skipped', reason: classification.reason });
            continue;
          }

          console.log(`  🔬 Extracting data (type: ${classification.type})...`);
          const extraction = await extractFromExcel(csvContent, classification.type, forwarderNotes, excel.name);

          // Prefer the just-created portfolio of this same email when the PDF
          // path produced one (teaser + Mieterliste in one email), then the
          // deal-resolution target.
          const preferredPortfolioId =
            (classification.type === 'tenant-list' && processedPortfolios.length === 1 ? processedPortfolios[0] : null)
            || targetPortfolioId;

          const pendingInfo = await createPendingFromExtraction({
            type: classification.type,
            extraction,
            fileName: excel.name,
            messageId,
            emailContext,
            forwarderNotes,
            cleanSubject,
            targetName: classification.targetName || cleanSubject,
            preferredPortfolioId,
            preferredReason: preferredPortfolioId
              ? (preferredPortfolioId === targetPortfolioId
                ? `Deal resolution matched this email to an existing deal: ${dealRelation.reasoning}`
                : 'Portfolio created from a PDF in the same email')
              : undefined,
            classifiedCities: classification.cities,
          });
          pendingCreatedCount++;

          results.push({
            fileName: excel.name, status: 'processed',
            reason: `Pending review (${pendingInfo.issueType}): ${classification.reason}`,
          });

        } catch (error) {
          console.error(`  ❌ Error processing Excel ${excel.name}:`, error);
          results.push({
            fileName: excel.name, status: 'error',
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // ============================================
    // POST-PROCESSING: Extract metadata from skipped cover letters
    // (regexes now work — plainBody preserves newlines — and captures are
    // bounded so a disclaimer can't leak into the notes)
    // ============================================
    const skippedCoverLetters = results.filter(r =>
      r.status === 'skipped' &&
      r.reason?.toLowerCase().includes('cover letter')
    );

    // Commission applies to ONE deal: only attach when this email produced
    // exactly one portfolio, or when it updates one known existing deal.
    const metadataTargets = processedPortfolios.length === 1
      ? processedPortfolios
      : (processedPortfolios.length === 0 && targetPortfolioId ? [targetPortfolioId] : []);

    if (skippedCoverLetters.length > 0 && metadataTargets.length > 0) {
      console.log(`\n📎 Found ${skippedCoverLetters.length} cover letter(s) with potential metadata`);

      const commissionPatterns = [
        /Provision[:\s]+([0-9,.]+\s*%[^\n]{0,150})/i,
        /Courtage[:\s]+([0-9,.]+\s*%[^\n]{0,150})/i,
        /Commission[:\s]+([0-9,.]+\s*%[^\n]{0,150})/i,
        /Maklergebühr[:\s]+([0-9,.]+\s*%[^\n]{0,150})/i,
        /Käuferprovision[:\s]+([0-9,.]+\s*%[^\n]{0,150})/i,
        /Vermittlungsprovision[:\s]+([0-9,.]+\s*%[^\n]{0,150})/i,
      ];

      let commissionMatch = null;
      for (const pattern of commissionPatterns) {
        commissionMatch = plainBody.match(pattern);
        if (commissionMatch) break;
      }

      const notesPatterns = [
        /Hinweise?[:\s]+([^\n]{20,300})/i,
        /Bitte beachten[:\s]+([^\n]{20,300})/i,
        /Wichtig[:\s]+([^\n]{20,300})/i,
        /Anmerkung(?:en)?[:\s]+([^\n]{20,300})/i,
      ];

      let notesMatch = null;
      for (const pattern of notesPatterns) {
        notesMatch = plainBody.match(pattern);
        if (notesMatch) break;
      }

      if (commissionMatch || notesMatch) {
        for (const portfolioId of metadataTargets) {
          try {
            const parts: string[] = [];
            if (commissionMatch) {
              parts.push(`📎 Broker Commission: ${commissionMatch[1].trim()}`);
              console.log(`  📌 Found commission: ${commissionMatch[1].trim()}`);
            }
            if (notesMatch) {
              parts.push(`📧 From cover letter: ${notesMatch[1].trim()}`);
            }
            await appendPortfolioNote(portfolioId, parts.join('\n'));
            console.log(`  ✅ Metadata attached to portfolio ${portfolioId}`);
          } catch (error) {
            console.error(`  ⚠️ Could not attach metadata:`, error);
          }
        }
      }
    } else if (skippedCoverLetters.length > 0 && processedPortfolios.length > 1) {
      console.log(`  ⏭️  Cover-letter metadata not attached: ${processedPortfolios.length} portfolios from this email, can't tell which deal it concerns`);
    }

    // ============================================
    // DEDUPLICATION: Detect duplicate assets across portfolios of this email
    // (city+street, normalized — the old key included exact GLA, so 4063 vs
    // 4063.5 m² slipped through)
    // ============================================
    if (processedPortfolios.length > 1) {
      console.log(`\n🔍 Checking for duplicate assets...`);

      const { data: allAssets } = await supabaseAdmin
        .from('assets')
        .select('id, portfolio_id, city, street')
        .in('portfolio_id', processedPortfolios);

      if (allAssets && allAssets.length > 1) {
        const assetMap = new Map<string, typeof allAssets>();

        for (const asset of allAssets) {
          const city = normalizeCity(asset.city);
          const street = normalizeStreet(asset.street);
          if (!city && !street) continue;
          const key = `${city}|${street}`;
          if (!assetMap.has(key)) {
            assetMap.set(key, []);
          }
          assetMap.get(key)!.push(asset);
        }

        for (const [key, duplicates] of assetMap.entries()) {
          if (duplicates.length > 1) {
            console.log(`  ⚠️ DUPLICATE: ${duplicates.length} assets match "${key}"`);
            for (const dup of duplicates) {
              await appendPortfolioNote(
                dup.portfolio_id,
                `⚠️ POTENTIAL DUPLICATE: Asset (${key.replace('|', ' / ')}) may be same as another in this email.`
              );
            }
          }
        }
      }
    }

    // ============================================
    // FINAL ATTACHMENT LINKING — remaining unassigned files go to the first
    // portfolio created by this email, or to the existing deal being updated.
    // ============================================
    const fallbackPortfolioId = processedPortfolios[0] || targetPortfolioId || null;
    if (fallbackPortfolioId) {
      const linkResult = await linkAttachmentsToPortfolio(messageId, fallbackPortfolioId);
      if (linkResult.linkedCount > 0) {
        console.log(`🔗 Linked ${linkResult.linkedCount} remaining attachment(s) to portfolio ${fallbackPortfolioId}`);
      }
    }

    // ============================================
    // FINALIZE LOCK DOCUMENT
    // - other records exist → delete the lock (they carry the dedup)
    // - nothing was created → keep it as the audit trail + dedup anchor
    // ============================================
    const otherRecordsExist = processedDocs.length > 0 || pendingCreatedCount > 0;
    if (lockDocId) {
      if (otherRecordsExist) {
        await supabaseAdmin.from('documents').delete().eq('id', lockDocId);
      } else {
        await updateDocumentStatus(lockDocId, 'completed', undefined, {
          results,
          dealRelation,
        });
      }
    }

    const processedCount = results.filter(r => r.status === 'processed').length;
    const skippedCount = results.filter(r => r.status === 'skipped').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    console.log(`\n📊 Email processing complete:`);
    console.log(`  ✅ Processed: ${processedCount}, ⏭️ Skipped: ${skippedCount}, ❌ Errors: ${errorCount} (of ${results.length} items)`);
    console.log(`  🧭 Relation: ${dealRelation.relation}, 📋 Pendings created: ${pendingCreatedCount}`);

    return {
      success: true,
      documentIds: processedDocs,
      portfolioIds: processedPortfolios,
      processedCount,
      skippedCount,
      relation: dealRelation.relation,
      details: results
    };

  } catch (error) {
    console.error('Error processing email:', error);
    // Keep the lock document as a FAILED audit trail (visible + dedup anchor)
    if (lockDocId) {
      try {
        await updateDocumentStatus(lockDocId, 'failed', error instanceof Error ? error.message : String(error));
      } catch {
        // best effort
      }
    }
    return { success: false, error: String(error) };
  }
}

// ============================================
// SUBSCRIPTIONS
// ============================================

// Create webhook subscription for new emails
export async function createSubscription(webhookUrl: string): Promise<{ id: string; expirationDateTime: string }> {
  const token = await getAccessToken();

  // Subscription expires in max 3 days for mail, we'll renew it
  const expiration = new Date();
  expiration.setHours(expiration.getHours() + 71); // Just under 3 days

  const url = 'https://graph.microsoft.com/v1.0/subscriptions';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      changeType: 'created',
      notificationUrl: webhookUrl,
      resource: `users/${MAILBOX_EMAIL}/mailFolders/inbox/messages`,
      expirationDateTime: expiration.toISOString(),
      clientState: process.env.WEBHOOK_SECRET || 'reanalyzer-secret-state',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create subscription: ${error}`);
  }

  return response.json();
}

// Renew existing subscription
export async function renewSubscription(subscriptionId: string): Promise<void> {
  const token = await getAccessToken();

  const expiration = new Date();
  expiration.setHours(expiration.getHours() + 71);

  const url = `https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expirationDateTime: expiration.toISOString(),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to renew subscription: ${error}`);
  }
}

// List active subscriptions
export async function listSubscriptions(): Promise<Array<{ id: string; resource: string; expirationDateTime: string }>> {
  const token = await getAccessToken();

  const url = 'https://graph.microsoft.com/v1.0/subscriptions';

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to list subscriptions: ${error}`);
  }

  const data = await response.json();
  return data.value || [];
}

// Delete subscription
export async function deleteSubscription(subscriptionId: string): Promise<void> {
  const token = await getAccessToken();

  const url = `https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`;

  await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}
