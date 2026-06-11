# RE Analyzer

AI-powered German commercial real estate document analyzer.

## Structure

```
re-analyzer/
├── app/
│   ├── layout.tsx              # Layout principal
│   ├── page.tsx                # Page Upload (/)
│   ├── globals.css
│   ├── api/
│   │   ├── analyze/route.ts    # POST /api/analyze
│   │   └── data/route.ts       # GET /api/data
│   └── dashboard/
│       ├── page.tsx            # Liste portfolios (/dashboard)
│       └── portfolio/
│           └── [id]/
│               └── page.tsx    # Détail portfolio (/dashboard/portfolio/xxx)
├── lib/
│   ├── supabase.ts             # Client Supabase
│   ├── extraction.ts           # Claude AI extraction
│   └── database.ts             # CRUD operations
├── supabase/
│   └── schema.sql              # SQL à exécuter dans Supabase
└── package.json
```

## Setup

1. **Install**
```bash
npm install
```

2. **Configure `.env.local`**
```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-api03-...
```

3. **Create database**
- Go to Supabase > SQL Editor
- Paste content of `supabase/schema.sql`
- Run

4. **Start**
```bash
npm run dev
```

5. **Open** http://localhost:3000

## Features

- Upload PDF → AI extracts portfolio, assets, tenants
- Dashboard with portfolio list
- Portfolio detail with:
  - Overview (key metrics)
  - Assets table (column picker)
  - Tenants table (filter by asset, column picker)
- Calculates lease_end from completion date + lease duration
