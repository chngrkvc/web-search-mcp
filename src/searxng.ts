import { Config } from './config.js';

export type SearchResult = {
  url: string;
  title: string;
  description: string;
};

type SearXNGResult = {
  url: string;
  title: string;
  content: string;
};

type SearXNGResponse = {
  results: SearXNGResult[];
};

// Try SearXNG first
async function searchSearXNGInternal(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const { url: baseUrl, engines, categories } = Config.searxng;

  const params = new URLSearchParams({
    q: query,
    format: 'json',
  });

  if (engines) {
    params.set('engines', engines);
  }
  if (categories) {
    params.set('categories', categories);
  }

  const response = await fetch(`${baseUrl}/search?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`SearXNG failed: ${response.status}`);
  }

  const body = (await response.json()) as SearXNGResponse;

  const seen = new Set<string>();
  const data: SearchResult[] = [];

  for (const r of body.results) {
    if (!r.url || seen.has(r.url)) continue;
    seen.add(r.url);
    data.push({
      url: r.url,
      title: r.title || '',
      description: r.content || '',
    });
    if (data.length >= limit) break;
  }

  return data;
}

// Fallback to DuckDuckGo API
async function searchDuckDuckGo(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo failed: ${response.status}`);
  }

  const data = await response.json() as {
    RelatedTopics?: Array<{ Text: string; FirstURL: string }>;
    Results?: Array<{ Text: string; FirstURL: string }>;
  };

  const results: SearchResult[] = [];

  if (data.RelatedTopics) {
    for (const topic of data.RelatedTopics) {
      if (results.length >= limit) break;
      if (topic.Text && topic.FirstURL) {
        results.push({
          url: topic.FirstURL,
          title: topic.Text.replace(/\s*\([^)]*\)$/, '').trim(),
          description: '',
        });
      }
    }
  }

  return results;
}

export async function searchSearXNG(
  query: string,
  options?: { limit?: number; timeout?: number },
): Promise<{ data: SearchResult[] }> {
  const limit = options?.limit ?? 10;

  // Try SearXNG first
  try {
    const results = await searchSearXNGInternal(query, limit);
    if (results.length > 0) {
      return { data: results };
    }
  } catch (error) {
    process.stderr.write(
      `SearXNG failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }

  // Fallback to DuckDuckGo
  try {
    const results = await searchDuckDuckGo(query, limit);
    if (results.length > 0) {
      return { data: results };
    }
  } catch (error) {
    process.stderr.write(
      `DuckDuckGo fallback failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }

  throw new Error('All search engines failed');
}
