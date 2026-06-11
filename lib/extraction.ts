import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  timeout: 10 * 60 * 1000, // 10 minutes timeout (pour multi-PDF processing)
});

// Central model configuration. Everything that logs `model_used` should
// import these constants so the extraction_logs never lie about the model.
export const EXTRACTION_MODEL = 'claude-opus-4-8';
export const CLASSIFICATION_MODEL = 'claude-sonnet-4-6';

// The model has no clock — inject the current date so "Restlaufzeit",
// two-digit years and lease sanity checks are interpreted correctly.
const todayLine = () => `Today's date: ${new Date().toISOString().split('T')[0]}`;

// ============================================
// SHARED HELPERS (parsing & streaming)
// ============================================

function getResponseText(content: Anthropic.Messages.Message['content']): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}

/**
 * Robust JSON extraction from a model response:
 * 1. Strip a full markdown fence wrapper if present.
 * 2. Try plain JSON.parse.
 * 3. Fall back to the outermost {...} substring (handles stray prose around the JSON).
 */
function parseModelJson<T>(raw: string, context: string): T {
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  if (fence) text = fence[1].trim();
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as T;
      } catch {
        // fall through to throw below
      }
    }
    throw new Error(`Failed to parse JSON from ${context}. First 300 chars: ${text.substring(0, 300)}`);
  }
}

/**
 * Run a large request via streaming (avoids HTTP timeouts at high max_tokens)
 * and fail loudly if the output was truncated — a truncated response means
 * invalid JSON, which must surface as an explicit error, not a parse mystery.
 */
async function runStreamed(params: {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Anthropic.Messages.MessageParam[];
}): Promise<Anthropic.Messages.Message> {
  const message = await anthropic.messages.stream(params).finalMessage();
  if (message.stop_reason === 'max_tokens') {
    throw new Error(
      `Model response truncated at max_tokens=${params.max_tokens} (${params.model}). ` +
      `Document too large for a single extraction — split it (e.g. rent roll in batches).`
    );
  }
  return message;
}

// ============================================
// PROMPTS
// ============================================

const SYSTEM_PROMPT = `You are an expert real estate analyst for German commercial properties.
Extract structured data from documents (exposés, rent rolls, portfolios, deal summaries).

CRITICAL RULES:
1. Extract ALL data, calculate derived values when possible
2. All areas in m², currencies in EUR
3. ALWAYS CALCULATE lease_end when you have lease_start + duration
4. Each tenant must include "asset_city" AND "asset_street" (when available) to link to the correct asset — the street is REQUIRED to disambiguate when multiple buildings share a city
5. Return null for missing data — NEVER invent values. When you have to make an assumption, record it in "extraction_warnings"
6. rent_per_sqm MUST BE MONTHLY (€/m²/Monat). If document shows annual rate, DIVIDE BY 12!

🔢 GERMAN NUMBER PARSING (frequent source of order-of-magnitude errors — be careful):
- German format uses comma as decimal and dot as thousands separator: "1.234,56" → 1234.56 ; "8.500 m²" → 8500
- "8,5 Mio. €" / "8,5 Mio" / "EUR 8.5m" → 8500000
- "T€ 450" / "450 TEUR" / "450k€" → 450000
- Always output plain JSON numbers with a decimal POINT and no separators
- A rent like "12.000 €" without "p.a." or "p.M.": decide from magnitude (compare to area × plausible €/m²); if genuinely ambiguous, choose the more plausible reading AND add an extraction_warning
- Price ranges ("8-9 Mio. €"): use the midpoint and add an extraction_warning
- "Kaufpreis auf Anfrage" / "VB" (Verhandlungsbasis): purchase_price = null, mention it in notes

📅 DATES:
- German dates DD.MM.YY or DD.MM.YYYY → YYYY-MM-DD
- Two-digit years: 00-49 → 20xx, 50-99 → 19xx. Sanity-check: lease_start can be in the past, lease_end is usually in the future relative to today's date

🔥 DATA PRIORITY HIERARCHY (CRITICAL - ALWAYS FOLLOW THIS ORDER):
1. 🥇 FORWARDER NOTES (HIGHEST PRIORITY) — The notes added by the person who forwarded the email.
   These OVERRIDE everything else. If the forwarder says "purchase price: 85M€", use 85M€ even if the PDF says something different.
2. 🥈 DOCUMENT CONTENT (PDF / spreadsheet) — Second priority.
3. 🥉 ORIGINAL EMAIL BODY (LOWEST PRIORITY) — The original email text from the broker.
   Only use this for data NOT found in forwarder notes or the document.
When there is a CONFLICT between sources, ALWAYS use the higher-priority source,
and add an extraction_warning describing the conflict (e.g. "forwarder price 85M overrides PDF asking price 90M").

🔥 CLIENT NOTES EXTRACTION:
When email context contains client notes (e.g., "Lege hierzu...an:", etc.):
- NOI margin: "82,5% NOI margin" → Extract as noi_margin: 82.5
- Purchase price multiple: "14x multiple" → Extract as multiplier: 14
- Match to correct property by CITY NAME
- These values OVERRIDE PDF values

Example:
Email: "bad soden (14x multiple und 82,5% NOI margin)"
PDF: city = "Bad Soden", annual_rent = 571428
→ Extract: { city: "Bad Soden", annual_rent: 571428, noi_margin: 82.5, multiplier: 14 }

RELATIONSHIP BETWEEN NOI FIELDS:
- noi_margin = percentage of rent that becomes NOI (e.g., 82.5%)
- leakage_percent = percentage lost to costs (e.g., 17.5%)
- Relationship: noi_margin + leakage_percent = 100
- NOI = annual_rent × (noi_margin / 100)
- If you have noi_margin, you can calculate leakage_percent = 100 - noi_margin
- If you have leakage_percent, you can calculate noi_margin = 100 - leakage_percent

INVESTMENT TYPE CLASSIFICATION:
Classify the deal as core, core+, value-add or opportunistic based on cap rate, WALT, occupancy,
tenant quality, location, building condition, lease structure, risks and upside potential.
If the document contains too little information for a meaningful judgment, return null — do NOT guess.

SPECIAL CASES TO HANDLE:
- "Mit Übergabe" = lease starts at handover → set lease_start to null, put "Mit Übergabe" in lease_start_note
- "Jährliche Verlängerung" = auto-renewing → put this in lease_end_note
- "unbefristet" = open-ended lease → lease_end null, "unbefristet" in lease_end_note
- "Restlaufzeit" / "Restmietlaufzeit" = REMAINING lease term from TODAY → put directly in remaining_lease_years (THIS IS FOR WALT CALCULATION!)
- Indexation like "2/10/65" means: every 2 years, if CPI changes >10%, apply 65% of change
- "II. BV" or "II. BV ohne Grundsteuer" = cost allocation type → put in cost_allocation
- Future rent increases like "ab 3. Mietjahr: 9.715€" → put in rent_increase_note
- "Nettokaltmiete" = net cold rent → this is the rent figure to use
- "Bruttomiete"/"Warmmiete" includes service charges → if only gross rent is given, use it but add an extraction_warning
- "zzgl. NK" = plus service charges → the stated rent is net, use it as-is
- Any special conditions in "Bemerkung" → put in notes
- NOI (Net Operating Income) = rental income minus operating expenses
- Leakage = non-recoverable costs, management fees, vacancy costs etc.

FORWARDED EMAIL HANDLING:
When the email context shows "FORWARDED EMAIL ANALYSIS":
- CLIENT NOTES section: extract purchase_price, asking price, deal comments, noi_margin, multiplier → HIGHEST PRIORITY, overrides PDF
- PDF CONTENT: second priority source
- ORIGINAL SENDER INFO section: extract broker contact → put in emailContact
- ORIGINAL EMAIL PREVIEW: LOWEST priority, only use for data not found elsewhere

CONTACT EXTRACTION (extract 2 SEPARATE contacts):
1. emailContact: Contact from the EMAIL (the broker who sent the original email before forwarding)
   - For forwarded emails: look in "ORIGINAL SENDER INFO" section
   - For direct emails: look in "From:" header
2. documentContact: Contact found IN THE PDF DOCUMENT itself
   - Usually at the bottom or header of the exposé/teaser
   - May be different from email sender (e.g. different broker, seller, asset manager)
   - Look for names, phone numbers, email addresses printed on the PDF

DOCUMENT TYPES:
- "portfolio": Multiple assets, extract portfolio summary + all assets + tenants
- "asset": Single property, extract just the asset details + its tenants (no portfolio object needed)
- "rent-roll": Tenant list, extract tenants with their asset_city and asset_street to link them
- "deal-summary": Short summary of one deal (often an email body or brief teaser) → treat like "asset" (or "portfolio" if it covers several properties)

🚨 CRITICAL REQUIREMENT - ASSETS ARRAY:
For EVERY document, you MUST include the "assets" array in your JSON response with AT LEAST ONE item:
- Single asset document → Put the property in assets[0]
- Multi-asset portfolio → Put all properties in the assets array
- NEVER return "assets": [] (empty array) — this is a FATAL ERROR
- Even if portfolio is null, assets array MUST exist with at least one item
- Even if you only have a city name and nothing else, create an asset with just { "city": "..." }
- If you truly cannot find ANY location, create the asset with "city": null and add an extraction_warning — do NOT invent a city from the email subject

⚠️ EXTRACTION WARNINGS:
The top-level "extraction_warnings" array lists every assumption, ambiguity or data-quality concern
as short strings (e.g. "annual_rent assumed p.a. — document did not specify",
"purchase price range 8-9M → midpoint 8.5M used"). Return [] when there are none.

Return ONLY valid JSON, no markdown fences, no commentary.`;

const SCHEMA = `{
  "portfolio": {
    "_note": "OPTIONAL - only for multi-asset portfolio documents, omit for single assets",
    "name": "string|null",
    "notes": "string|null (important remarks, special conditions, risks)",
    "purchase_price": "number|null (this is the ASKING PRICE from the document OR calculated from multiplier × annual_rent)",
    "multiplier": "number|null (purchase price multiple of annual rent, e.g., 14 for 14x)",
    "annual_rent_income": "number|null",
    "noi": "number|null (Net Operating Income at portfolio level - can be calculated from annual_rent × (noi_margin/100))",
    "noi_margin": "number|null (NOI as percentage of rent, e.g., 82.5 for 82.5%)",
    "leakage_percent": "number|null (costs as percentage of rent, e.g., 17.5 for 17.5% - inverse of noi_margin)",
    "total_gla": "number|null",
    "total_plot_area": "number|null",
    "total_parking_spaces": "number|null",
    "walt": "number|null (years)",
    "occupancy_rate": "number|null (percentage)",
    "leh_percentage": "number|null (food retail %)",
    "number_of_assets": "number|null",
    "top_tenant": "string|null",
    "top_tenant_share": "number|null",
    "ltv": "number|null (Loan-to-Value percentage, e.g. 65 for 65%)",
    "investment_type": "value-add|core|core+|opportunistic|null",
    "exclusivity": "boolean|null (is there exclusivity on this deal?)"
  },
  "assets": [{
    "_note": "REQUIRED ARRAY - MUST be present in every response, even if just 1 item",
    "city": "string|null",
    "street": "string|null",
    "postal_code": "string|null",
    "state": "string|null",
    "notes": "string|null (CRITICAL - extract ALL important information: legal issues, disputes, environmental concerns, structural problems, special conditions, tenant disputes, deal-critical info)",
    "asset_type": "string|null (retail, office, logistics, etc.)",
    "purchase_price": "number|null (can be calculated from multiplier × annual_rent)",
    "multiplier": "number|null (purchase price multiple of annual rent, e.g., 14 for 14x)",
    "annual_rent": "number|null",
    "monthly_rent": "number|null",
    "noi": "number|null (Net Operating Income - can be calculated from annual_rent × (noi_margin/100))",
    "noi_margin": "number|null (NOI as percentage of rent, e.g., 82.5 for 82.5%)",
    "leakage": "number|null (non-recoverable costs - annual amount in EUR)",
    "leakage_percent": "number|null (costs as percentage of rent, e.g., 17.5 for 17.5% - inverse of noi_margin)",
    "gla": "number|null",
    "plot_area": "number|null",
    "parking_spaces": "number|null",
    "parking_spaces_underground": "number|null",
    "walt": "number|null",
    "anchor_tenant": "string|null",
    "planned_completion": "YYYY-MM-DD|null (Fertigstellung)",
    "construction_year": "number|null (Baujahr - year built)",
    "renovation_year": "number|null (Renovierungsjahr/Sanierungsjahr - year of last major renovation)",
    "green_building_certified": "boolean|null (DGNB, LEED, BREEAM certification)",
    "green_certification_type": "string|null (e.g. 'DGNB Gold', 'LEED Platinum', 'BREEAM Excellent')",
    "kki": "number|null",
    "einwohner": "number|null (population of the city/town)",
    "zentralitaetsindex": "number|null (Zentralitätsindex - centrality index)",
    "kaufkraftniveau": "number|null (Kaufkraftniveau - purchasing power level, often as index like 95.2)",
    "catchment_population_5min": "number|null (Einzugsgebiet 5 Min)",
    "catchment_population_10min": "number|null (Einzugsgebiet 10 Min)",
    "catchment_population_20min": "number|null (Einzugsgebiet 20 Min)",
    "rent_per_sqm": "number|null (€/m²/MONAT - ALWAYS convert to monthly! If document shows '120 €/m²/Jahr', output 10.0)"
  }],
  "tenants": [{
    "asset_city": "string (REQUIRED - city of the asset this tenant belongs to)",
    "asset_street": "string|null (street/address of the asset this tenant belongs to — REQUIRED when multiple assets share the same city)",
    "tenant_name": "string",
    "notes": "string|null (Bemerkung - important remarks)",
    "sector": "food_retail|fashion|discount|services|other|null",
    "leased_area": "number|null (Mietfläche)",
    "annual_rent": "number|null (Mietzins p.a. / Jahresmiete)",
    "monthly_rent": "number|null (Mietzins p.M. / Monatsmiete)",
    "rent_per_sqm": "number|null (€/m²/MONAT - ALWAYS convert to monthly! If document shows '120 €/m²/Jahr', output 10.0)",
    "lease_start": "YYYY-MM-DD|null (Mietbeginn)",
    "lease_start_note": "string|null (e.g. 'Mit Übergabe' if start depends on handover)",
    "lease_end": "YYYY-MM-DD|null (Mietende / Ende Festmietzeit - the actual end DATE of the lease)",
    "lease_end_note": "string|null (e.g. 'Jährliche Verlängerung' if auto-renewing, 'unbefristet' if open-ended)",
    "lease_duration_years": "number|null (Mietdauer / Laufzeit - TOTAL duration of the lease from start to end)",
    "remaining_lease_years": "number|null (Restlaufzeit / Restmietlaufzeit - REMAINING years from TODAY. THIS IS THE WALT INPUT! If document shows 'Restlaufzeit: 5.2 Jahre' this goes here)",
    "option_details": "string|null (Optionen - e.g. '2 x 5 Jahre', '3 x 3 Jahre')",
    "number_of_options": "number|null",
    "indexation_details": "string|null (Wertsicherung - e.g. '2/10/65' = every 2 years, 10% threshold, 65% adjustment)",
    "cost_allocation": "string|null (Betriebskostenumlage - e.g. 'II. BV', 'II. BV ohne Grundsteuer')",
    "rent_increase_note": "string|null (Bemerkung about future rent increases, e.g. 'ab 3. Mietjahr: 9.715€')"
  }],
  "marketData": [{
    "city": "string",
    "city_population": "number|null",
    "catchment_area_population": "number|null",
    "kki": "number|null"
  }],
  "emailContact": {
    "_note": "Contact from the EMAIL (the broker/sender who sent the original email, before any forwarding)",
    "email_contact_name": "string|null",
    "email_contact_email": "string|null",
    "email_contact_phone": "string|null",
    "email_contact_company": "string|null"
  },
  "documentContact": {
    "_note": "Contact from the PDF DOCUMENT itself (may be different from email sender)",
    "doc_contact_name": "string|null",
    "doc_contact_email": "string|null",
    "doc_contact_phone": "string|null",
    "doc_contact_company": "string|null",
    "doc_contact_role": "string|null (e.g. 'Broker', 'Asset Manager', 'Seller', 'Advisor')"
  },
  "extraction_warnings": ["string (assumptions, ambiguities, source conflicts — [] if none)"],
  "summary": "string (2-3 sentences)"
}`;

const CLASSIFICATION_PROMPT = `You are a document classifier for German commercial real estate deals.

Your job is to quickly analyze a PDF and determine:
1. Is this PDF RELEVANT for extracting investment deal data?
2. What type of document is it?

You may also receive EMAIL CONTEXT (subject + forwarder notes). Use it: if the forwarder
explicitly says the key figures are inside this document, lean towards RELEVANT.

RELEVANT documents (analyze these):
✅ Exposé / Teaser with SPECIFIC property data (GLA, asking price, NOI, location)
✅ Portfolio overview (multi-asset summaries WITH NUMBERS)
✅ Rent roll / Mieterliste (tenant lists WITH RENTS)
✅ Due diligence materials
✅ Financial summaries with cap rates, NOI, WALT
✅ Property details with location, GLA, tenants
✅ Investment memorandums

NOT RELEVANT documents (skip these):
❌ Email signatures / disclaimers
❌ Legal terms & conditions (AGB, Allgemeine Geschäftsbedingungen)
❌ Generic email footers
❌ Marketing flyers without deal specifics
❌ Company logos / letterheads only
❌ NDAs / confidentiality agreements (unless they contain deal data)
❌ Empty pages or cover pages with just a title
❌ Documents with <3 sentences of actual content
❌ **COVER LETTERS (Anschreiben) that only REFERENCE attachments**

🚨 CRITICAL: COVER LETTERS & ANSCHREIBEN
Documents that:
- Say "Hiermit übersende ich Ihnen...", "Anbei erhalten Sie...", "Im Anhang finden Sie..."
- Say "bitte beachten Sie folgende Hinweise:" followed by commission/fee info
- Reference "attached documents" or "Anhang" or "beigefügten Unterlagen"
- Contain ONLY broker contact info, commission rates, and references to other documents

These should be classified as:
- isRelevant: **false**
- documentType: "cover-letter"
- reason: "Cover letter with broker info - no standalone investment data"

⚠️ EXCEPTION: A cover letter is ONLY relevant if it contains:
- Specific asking prices (e.g., "€8.5M for Bad Soden property")
- Specific GLA measurements (e.g., "4,063 m² total area")
- Specific NOI or cap rate numbers (e.g., "NOI of €476k")
- Specific tenant names and rents

If it just says "two properties, see attachments" → NOT RELEVANT!

EDGE CASES:
⚠️ Cover letter with basic summary → Check if it has NUMBERS. If no numbers, skip it.
⚠️ NDA with embedded deal teaser → RELEVANT (has investment data)
⚠️ Multi-page doc where only first page is signature → Check other pages before deciding

Return ONLY valid JSON:
{
  "isRelevant": true/false,
  "documentType": "portfolio" | "asset" | "rent-roll" | "cover-letter" | "deal-summary" | "unknown",
  "confidence": 0.0-1.0,
  "reason": "Brief explanation why relevant/not relevant (1 sentence)"
}

Be VERY aggressive about filtering out cover letters that just reference other documents!`;

// ============================================
// TYPES
// ============================================

export interface ExtractionResult {
  data: {
    portfolio?: Record<string, unknown>;
    assets?: Record<string, unknown>[];
    tenants?: Record<string, unknown>[];
    marketData?: Record<string, unknown>[];
    emailContact?: Record<string, unknown>;
    documentContact?: Record<string, unknown>;
    extraction_warnings?: string[];
    summary?: string;
  };
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  processingTimeMs: number;
}

export interface ClassificationResult {
  isRelevant: boolean;
  documentType: 'portfolio' | 'asset' | 'rent-roll' | 'cover-letter' | 'deal-summary' | 'unknown';
  confidence: number;
  reason: string;
}

// ============================================
// DEAL RESOLUTION (router: new deal vs update of an existing one)
// ============================================

export interface DealCandidate {
  id: string;
  name: string;
  cities: string[];
  streets: string[];
  brokerEmail?: string | null;
  sameThread?: boolean;
}

export interface DealRelationResult {
  relation: 'new_deal' | 'update_existing' | 'irrelevant' | 'uncertain';
  portfolioId: string | null;
  confidence: number;
  reasoning: string;
}

const DEAL_RESOLUTION_PROMPT = `You route incoming emails for a German commercial real estate investment team.
Decide whether an email relates to a deal that is ALREADY tracked, announces a NEW deal, or is not deal-related.

You receive the email (subject, sender, body, attachment names) and a list of EXISTING DEALS:
one per line as "id | name | cities | streets | broker email | same email thread: yes/no".

Decision rules:
- "update_existing": the email clearly concerns ONE specific existing deal — same project name,
  same property (matching city AND street), a reply/forward in the same email thread, or the same
  broker following up on their own deal. Set portfolio_id to that deal's id, copied EXACTLY from the list.
- "new_deal": a deal offering that does not match any existing deal. The same CITY alone is NOT
  enough to call it an update — a different street or different project name in the same city is a NEW deal.
- "irrelevant": no real-estate deal content at all (newsletters, scheduling, out-of-office, small talk).
- "uncertain": you cannot decide with reasonable confidence.

Set confidence between 0.0 and 1.0. Be conservative: prefer "uncertain" over a wrong "update_existing".

Return ONLY valid JSON:
{"relation": "new_deal"|"update_existing"|"irrelevant"|"uncertain", "portfolio_id": "string|null", "confidence": 0.0-1.0, "reasoning": "1 short sentence"}`;

/**
 * Decide whether an incoming email is a new deal, an update to an existing
 * tracked deal, or irrelevant. Fails safe to 'uncertain' (caller then treats
 * the email like today's default flow).
 */
export async function resolveDealRelation(
  emailContext: string,
  attachmentNames: string[],
  candidates: DealCandidate[]
): Promise<DealRelationResult> {
  const fallback: DealRelationResult = {
    relation: 'uncertain',
    portfolioId: null,
    confidence: 0,
    reasoning: 'Deal resolution unavailable',
  };
  if (candidates.length === 0) {
    return { ...fallback, relation: 'new_deal', confidence: 0.5, reasoning: 'No existing deals to compare against' };
  }

  const start = Date.now();
  try {
    const candidateLines = candidates.slice(0, 80).map(c => {
      const cities = [...new Set(c.cities.filter(Boolean))].slice(0, 6).join(', ') || '-';
      const streets = [...new Set(c.streets.filter(Boolean))].slice(0, 6).join(', ') || '-';
      return `${c.id} | ${c.name} | ${cities} | ${streets} | ${c.brokerEmail || '-'} | same email thread: ${c.sameThread ? 'yes' : 'no'}`;
    });

    const response = await anthropic.messages.create({
      model: CLASSIFICATION_MODEL,
      max_tokens: 600,
      system: DEAL_RESOLUTION_PROMPT,
      messages: [{
        role: 'user',
        content: `${todayLine()}

EXISTING DEALS (id | name | cities | streets | broker email | same email thread):
${candidateLines.join('\n')}

ATTACHMENTS: ${attachmentNames.join(', ') || '(none)'}

EMAIL:
${emailContext.substring(0, 8000)}

Which existing deal (if any) does this email relate to? Return ONLY the JSON.`
      }]
    });

    const result = parseModelJson<DealRelationResult>(getResponseText(response.content), 'deal resolution');
    console.log(`  ⏱️  Deal resolution took ${Date.now() - start}ms → ${result.relation} (${result.confidence})`);

    // Guard against hallucinated ids: the portfolio_id MUST come from the candidate list.
    if (result.portfolioId && !candidates.some(c => c.id === result.portfolioId)) {
      console.warn(`  ⚠️ Deal resolution returned unknown portfolio id "${result.portfolioId}" — downgrading to uncertain`);
      return { ...result, relation: 'uncertain', portfolioId: null };
    }
    if (result.relation === 'update_existing' && !result.portfolioId) {
      return { ...result, relation: 'uncertain' };
    }
    return result;
  } catch (error) {
    console.error('Deal resolution error:', error);
    return fallback;
  }
}

// ============================================
// PDF CLASSIFICATION & EXTRACTION
// ============================================

/**
 * Safety net: ensure extracted data always has at least one asset.
 * Claude should never return an empty assets array, but if it does, create a minimal one.
 */
function ensureAssetsNotEmpty(parsed: ExtractionResult['data'], source: string): void {
  if (!parsed.assets || parsed.assets.length === 0) {
    console.warn(`⚠️ Claude returned empty assets array from ${source} — creating minimal asset`);
    const fallback: Record<string, unknown> = {
      city: parsed.portfolio?.name || 'Unknown',
      notes: `Auto-created: no assets were extracted from ${source}`
    };
    if (parsed.portfolio) {
      if (parsed.portfolio.total_gla) fallback.gla = parsed.portfolio.total_gla;
      if (parsed.portfolio.annual_rent_income) fallback.annual_rent = parsed.portfolio.annual_rent_income;
      if (parsed.portfolio.purchase_price) fallback.purchase_price = parsed.portfolio.purchase_price;
      if (parsed.portfolio.noi) fallback.noi = parsed.portfolio.noi;
      if (parsed.portfolio.noi_margin) fallback.noi_margin = parsed.portfolio.noi_margin;
    }
    parsed.assets = [fallback];
  }
}

/**
 * Quickly classify a PDF to determine if it's worth analyzing.
 * `emailContext` (subject + forwarder notes) helps judge cover letters correctly.
 */
export async function classifyPDF(
  base64: string,
  fileName: string,
  emailContext?: string
): Promise<ClassificationResult> {
  const start = Date.now();

  try {
    const contextBlock = emailContext
      ? `\n\nEMAIL CONTEXT:\n${emailContext.substring(0, 1500)}`
      : '';

    const response = await anthropic.messages.create({
      model: CLASSIFICATION_MODEL,
      max_tokens: 600,
      system: CLASSIFICATION_PROMPT,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 }
          },
          {
            type: 'text',
            text: `Classify this PDF: "${fileName}"${contextBlock}\n\nReturn ONLY valid JSON with isRelevant, documentType, confidence, and reason.`
          }
        ]
      }]
    });

    const result = parseModelJson<ClassificationResult>(getResponseText(response.content), `PDF classification (${fileName})`);

    console.log(`  ⏱️  Classification took ${Date.now() - start}ms`);
    console.log(`  📊 Used ${response.usage.input_tokens} input + ${response.usage.output_tokens} output tokens`);

    return result;

  } catch (error) {
    console.error('Classification error:', error);
    // Default to analyzing if classification fails (better safe than sorry)
    return {
      isRelevant: true,
      documentType: 'unknown',
      confidence: 0.5,
      reason: `Classification failed: ${String(error)} - defaulting to analyze`
    };
  }
}

export async function extractFromPDF(
  base64: string,
  documentType: string,
  emailBody?: string
): Promise<ExtractionResult> {
  const start = Date.now();

  const context = emailBody ? `\nADDITIONAL CONTEXT FROM EMAIL:\n${emailBody}\n\nIMPORTANT: Extract TWO separate contacts:
1. emailContact: from the email sender info above (broker who sent the email)
2. documentContact: from contact info found IN THE PDF DOCUMENT (may be different person)` : '';

  const response = await runStreamed({
    model: EXTRACTION_MODEL,
    max_tokens: 60000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 }
        },
        {
          type: 'text',
          text: `${todayLine()}\nDocument type: ${documentType}${context}\n\nExtract data using this schema:\n${SCHEMA}`
        }
      ]
    }]
  });

  const parsed = parseModelJson<ExtractionResult['data']>(getResponseText(response.content), 'PDF extraction');

  console.log(`  📦 Extraction result: ${parsed.assets?.length || 0} assets, ${parsed.tenants?.length || 0} tenants, portfolio: ${parsed.portfolio ? 'yes' : 'no'}`);
  if (parsed.extraction_warnings?.length) {
    console.log(`  ⚠️ Extraction warnings: ${parsed.extraction_warnings.join(' | ')}`);
  }
  if (!parsed.assets || parsed.assets.length === 0) {
    console.warn(`  🚨 Claude returned ZERO assets from PDF! Portfolio data: ${JSON.stringify(parsed.portfolio || {}).substring(0, 200)}`);
  }

  ensureAssetsNotEmpty(parsed, 'PDF');

  return {
    data: parsed,
    usage: {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens
    },
    processingTimeMs: Date.now() - start
  };
}

// ============================================
// EMAIL BODY CLASSIFICATION & EXTRACTION
// ============================================

/**
 * Classify email body text to determine if it contains enough deal data
 * to create a portfolio without any PDF attachment.
 */
export async function classifyEmailBody(
  emailBody: string,
  subject: string
): Promise<ClassificationResult> {
  const start = Date.now();

  try {
    const response = await anthropic.messages.create({
      model: CLASSIFICATION_MODEL,
      max_tokens: 600,
      system: `You are a classifier for German commercial real estate deal emails.

Your job is to determine if an email body (WITHOUT any PDF attachment) contains enough
investment deal data to create a portfolio/asset record.

RELEVANT emails (can create a portfolio from these):
✅ Deal summaries with key metrics (price, GLA, NOI, yield, WALT, etc.)
✅ Investment opportunity descriptions with numbers
✅ Portfolio overviews listing multiple assets with data
✅ Rent roll data included in email text
✅ Teaser info with property details and financials

NOT RELEVANT emails (cannot create a portfolio):
❌ Emails that just say "see attached" or reference PDF attachments
❌ Generic greetings or meeting requests
❌ Emails with only broker contact info, no deal data
❌ Auto-replies, out-of-office, disclaimers
❌ Emails with just a project name but no financial/property metrics

MINIMUM DATA REQUIRED to be relevant:
- At least a city/location AND one financial metric (price, rent, yield, etc.)
- OR at least 2-3 specific deal metrics (GLA + price, rent + WALT, etc.)

Return ONLY valid JSON:
{
  "isRelevant": true/false,
  "documentType": "portfolio" | "asset" | "deal-summary" | "unknown",
  "confidence": 0.0-1.0,
  "reason": "Brief explanation (1 sentence)"
}`,
      messages: [{
        role: 'user',
        content: `${todayLine()}\nSubject: ${subject}\n\nEmail body:\n${emailBody.substring(0, 12000)}\n\nDoes this email contain enough deal data to create a portfolio record WITHOUT a PDF?`
      }]
    });

    const result = parseModelJson<ClassificationResult>(getResponseText(response.content), 'email body classification');
    console.log(`  ⏱️  Email body classification took ${Date.now() - start}ms`);
    return result;

  } catch (error) {
    console.error('Email body classification error:', error);
    return {
      isRelevant: false,
      documentType: 'unknown',
      confidence: 0.3,
      reason: `Classification failed: ${String(error)}`
    };
  }
}

/**
 * Extract deal data from email body text only (no PDF).
 * Uses the same schema and system prompt as extractFromPDF.
 */
export async function extractFromEmailBody(
  emailBody: string,
  documentType: string,
  subject: string
): Promise<ExtractionResult> {
  const start = Date.now();

  const response = await runStreamed({
    model: EXTRACTION_MODEL,
    max_tokens: 60000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `${todayLine()}
You are extracting deal data from an EMAIL BODY (no PDF attached).
The email itself contains the deal information.
Apply the DATA PRIORITY HIERARCHY from your instructions (forwarder notes > email body > original quoted email).

Subject: ${subject}
Document type: ${documentType}

EMAIL CONTENT:
${emailBody}

🚨 CRITICAL: You MUST return an "assets" array with at least 1 item.
Every deal has at least one property/asset. Extract city, price, GLA, rent, etc.
If the email describes multiple projects/deals, each one is a separate asset.
A portfolio object should also be created to group the asset(s).

Extract all available data using this schema:
${SCHEMA}`
    }]
  });

  const parsed = parseModelJson<ExtractionResult['data']>(getResponseText(response.content), 'email body extraction');
  ensureAssetsNotEmpty(parsed, 'email body');

  return {
    data: parsed,
    usage: {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens
    },
    processingTimeMs: Date.now() - start
  };
}

// ============================================
// EXCEL / SPREADSHEET HANDLING
// ============================================

export interface ExcelClassificationResult {
  type: 'asset-list' | 'tenant-list' | 'unknown';
  targetName: string | null;
  confidence: number;
  reason: string;
  cities: string[];
}

const EXCEL_CLASSIFICATION_PROMPT = `You are a classifier for German commercial real estate spreadsheets.

Analyze the spreadsheet content and determine:
1. Is this an ASSET LIST (list of properties/buildings) or a TENANT LIST (Mieterliste)?
2. What portfolio or asset name is this for? (look in forwarder notes)
3. What cities are mentioned? (for matching)

ASSET LIST indicators:
- Columns like: Stadt/City, Straße/Street, Fläche/GLA, Kaufpreis/Price, Miete/Rent
- Each row = one property/building
- Portfolio-level data (multiple locations)

TENANT LIST (Mieterliste) indicators:
- Columns like: Mieter/Tenant, Mietfläche/Area, Mietzins/Rent, Mietbeginn/Start, Mietende/End
- Each row = one tenant/lease
- May cover multiple assets (check for city/building columns)

NOTE: If the workbook contains BOTH (one sheet of assets, one sheet of tenants),
classify by the sheet with the most rows and mention the mix in "reason".

Return ONLY valid JSON:
{
  "type": "asset-list" | "tenant-list" | "unknown",
  "targetName": "string|null (name of portfolio/asset from forwarder notes, e.g. 'Project Boost', 'Bad Soden')",
  "confidence": 0.0-1.0,
  "reason": "Brief explanation",
  "cities": ["Berlin", "Hamburg", ...]
}`;

/**
 * Classify an Excel/CSV spreadsheet to determine if it's an asset list or tenant list.
 * Pass a per-sheet preview (headers + first rows of EVERY sheet), not just the first 3000 chars.
 */
export async function classifyExcel(
  csvPreview: string,
  fileName: string,
  forwarderNotes: string
): Promise<ExcelClassificationResult> {
  const start = Date.now();

  try {
    const response = await anthropic.messages.create({
      model: CLASSIFICATION_MODEL,
      max_tokens: 600,
      system: EXCEL_CLASSIFICATION_PROMPT,
      messages: [{
        role: 'user',
        content: `File: "${fileName}"

FORWARDER NOTES (check for portfolio/asset name):
${forwarderNotes || '(no notes)'}

SPREADSHEET PREVIEW (headers + first rows of each sheet):
${csvPreview.substring(0, 8000)}

Classify this spreadsheet and extract the target name.`
      }]
    });

    const result = parseModelJson<ExcelClassificationResult>(getResponseText(response.content), `Excel classification (${fileName})`);
    console.log(`  ⏱️  Excel classification took ${Date.now() - start}ms`);
    return result;
  } catch (error) {
    console.error('Excel classification error:', error);
    return {
      type: 'unknown',
      targetName: null,
      confidence: 0.3,
      reason: `Classification failed: ${String(error)}`,
      cities: []
    };
  }
}

// Spreadsheets beyond this size would blow up the context — truncate with an explicit notice.
const EXCEL_MAX_CHARS = 150_000;

/**
 * Extract structured data from a spreadsheet (asset list or tenant list).
 */
export async function extractFromExcel(
  csvContent: string,
  type: 'asset-list' | 'tenant-list',
  forwarderNotes: string,
  fileName: string
): Promise<ExtractionResult> {
  const start = Date.now();

  const truncated = csvContent.length > EXCEL_MAX_CHARS;
  const content = truncated ? csvContent.substring(0, EXCEL_MAX_CHARS) : csvContent;
  if (truncated) {
    console.warn(`  ⚠️ Spreadsheet "${fileName}" truncated for extraction: ${csvContent.length} → ${EXCEL_MAX_CHARS} chars`);
  }

  const typeInstructions = type === 'asset-list'
    ? `This is an ASSET LIST. Extract each row as an asset in the "assets" array.
Each row represents a property/building. Extract all available fields.
Also create a portfolio object summarizing the totals if possible.`
    : `This is a TENANT LIST (Mieterliste). Extract each row as a tenant in the "tenants" array.
Each row represents a lease/tenant. ALWAYS include "asset_city" for each tenant.
ALSO include "asset_street" when the data indicates which specific building/address the tenant belongs to.
This is CRITICAL when multiple assets share the same city — the street is needed to match tenants to the right asset.
If there are columns indicating which building/asset the tenant belongs to (city, street, building name, Objekt), use them.
If all tenants are for the same asset, use the same city and street for all.`;

  const response = await runStreamed({
    model: EXTRACTION_MODEL,
    max_tokens: 60000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `${todayLine()}
You are extracting data from a SPREADSHEET (Excel/CSV), not a PDF.
Note: Excel sometimes exports dates as serial numbers (e.g. 45123) — convert them to YYYY-MM-DD (serial 1 = 1900-01-01).

File: "${fileName}"
Type: ${type}

${typeInstructions}

FORWARDER NOTES (HIGHEST PRIORITY — override spreadsheet values if conflicting):
${forwarderNotes || '(no notes)'}

SPREADSHEET CONTENT${truncated ? ' (⚠️ TRUNCATED — add an extraction_warning that rows may be missing)' : ''}:
${content}

🔥 DATA PRIORITY: Forwarder notes > Spreadsheet content.
🚨 For asset-list: MUST return "assets" array.
🚨 For tenant-list: MUST return "tenants" array with "asset_city" and "asset_street" on each tenant.

Extract using this schema:
${SCHEMA}`
    }]
  });

  const parsed = parseModelJson<ExtractionResult['data']>(getResponseText(response.content), `Excel extraction (${fileName})`);
  if (truncated) {
    parsed.extraction_warnings = [
      ...(parsed.extraction_warnings || []),
      `Spreadsheet was truncated before extraction (${csvContent.length} chars > ${EXCEL_MAX_CHARS}) — some rows may be missing`,
    ];
  }

  return {
    data: parsed,
    usage: {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens
    },
    processingTimeMs: Date.now() - start
  };
}
