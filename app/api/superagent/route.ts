import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

function normalizeExa(json: any): SearchResult[] {
  const items = Array.isArray(json?.results) ? json.results : Array.isArray(json) ? json : [];
  return items.map((r: any) => ({
    title: r.title || r.name || r.url || 'Untitled',
    url: r.url || r.link || '',
    snippet: r.text || r.snippet || r.highlights?.[0]?.snippet || r.summary || '',
  }));
}

function normalizeTavily(json: any): SearchResult[] {
  const items = Array.isArray(json?.results) ? json.results : [];
  return items.map((r: any) => ({
    title: r.title || r.url || 'Untitled',
    url: r.url || '',
    snippet: r.content || r.snippet || '',
  }));
}

async function exaSearch(query: string, numResults: number): Promise<SearchResult[]> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) throw new Error('Missing EXA_API_KEY');

  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ query, numResults }),
  });
  if (!res.ok) throw new Error(`Exa request failed: ${res.status}`);
  const json = await res.json();
  return normalizeExa(json);
}

async function tavilySearch(query: string, numResults: number): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('Missing TAVILY_API_KEY');

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: numResults, include_answer: false }),
  });
  if (!res.ok) throw new Error(`Tavily request failed: ${res.status}`);
  const json = await res.json();
  return normalizeTavily(json);
}

async function doSearch(query: string, numResults: number) {
  try {
    const results = await exaSearch(query, numResults);
    return { provider: 'exa', results };
  } catch (e) {
    const results = await tavilySearch(query, numResults);
    return { provider: 'tavily', results };
  }
}

export async function POST(req: NextRequest) {
  try {
    const { query, numResults = 5 } = await req.json().catch(() => ({}));
    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }
    const data = await doSearch(query, Math.max(1, Math.min(Number(numResults) || 5, 10)));
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Search failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q');
    const numResults = parseInt(searchParams.get('n') || '5', 10);
    if (!query) return NextResponse.json({ error: 'q is required' }, { status: 400 });
    const data = await doSearch(query, Math.max(1, Math.min(Number.isNaN(numResults) ? 5 : numResults, 10)));
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Search failed' }, { status: 500 });
  }
}
