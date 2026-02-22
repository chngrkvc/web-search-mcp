export type SearchResult = {
  url: string;
  title: string;
  description: string;
};

type DuckDuckGoResponse = {
  RelatedTopics?: Array<{ Text: string; FirstURL: string }>;
  Results?: Array<{ Text: string; FirstURL: string }>;
};

// DuckDuckGo Instant Answer API - no bot detection, direct HTTP
async function searchDuckDuckGoAPI(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; WebSearchBot/1.0)',
    },
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo API failed: ${response.status}`);
  }

  const data = (await response.json()) as DuckDuckGoResponse;

  if (!data.RelatedTopics || data.RelatedTopics.length === 0) {
    throw new Error('No results from DuckDuckGo');
  }

  const results: SearchResult[] = [];

  for (const topic of data.RelatedTopics) {
    if (results.length >= limit) break;

    if (topic.Text && topic.FirstURL) {
      // Clean up the title - remove source in parentheses
      const title = topic.Text.replace(/\s*\([^)]*\)$/, '').trim();

      results.push({
        url: topic.FirstURL,
        title: title || topic.Text,
        description: '',
      });
    }
  }

  // Also add results from Results array if present
  if (data.Results) {
    for (const topic of data.Results) {
      if (results.length >= limit) break;

      if (topic.Text && topic.FirstURL) {
        const title = topic.Text.replace(/\s*\([^)]*\)$/, '').trim();

        results.push({
          url: topic.FirstURL,
          title: title || topic.Text,
          description: '',
        });
      }
    }
  }

  return results;
}

// Fallback: use Brave Search API
async function searchBraveAPI(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': '', // Brave API needs a token, but this might work for basic
    },
  });

  if (!response.ok) {
    throw new Error(`Brave API failed: ${response.status}`);
  }

  const data = await response.json() as { web?: { results?: Array<{ url: string; title: string; description: string }> } };

  if (!data.web?.results) {
    throw new Error('No results from Brave');
  }

  return data.web.results.slice(0, limit).map(r => ({
    url: r.url,
    title: r.title,
    description: r.description || '',
  }));
}

export async function browserSearch(
  query: string,
  limit?: number,
): Promise<{ data: SearchResult[] }> {
  const maxResults = limit ?? 10;

  // Try DuckDuckGo API first
  try {
    const results = await searchDuckDuckGoAPI(query, maxResults);
    if (results.length > 0) {
      process.stderr.write(`DuckDuckGo API: got ${results.length} results\n`);
      return { data: results };
    }
  } catch (error) {
    process.stderr.write(
      `DuckDuckGo API failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }

  // Try Brave
  try {
    const results = await searchBraveAPI(query, maxResults);
    return { data: results };
  } catch (error) {
    throw new Error(
      `All search engines failed. Last error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
