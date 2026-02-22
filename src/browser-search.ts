export type SearchResult = {
  url: string;
  title: string;
  description: string;
};

type DuckDuckGoResponse = {
  RelatedTopics?: Array<{ Text: string; FirstURL: string }>;
  Results?: Array<{ Text: string; FirstURL: string }>;
};

// DuckDuckGo Instant Answer API - direct HTTP
async function searchDuckDuckGoAPI(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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
      const title = topic.Text.replace(/\s*\([^)]*\)$/, '').trim();

      results.push({
        url: topic.FirstURL,
        title: title || topic.Text,
        description: '',
      });
    }
  }

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

export async function browserSearch(
  query: string,
  limit?: number,
): Promise<{ data: SearchResult[] }> {
  const maxResults = limit ?? 10;

  // Try DuckDuckGo API
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

  // If DuckDuckGo returns 0 results (not error), still return empty array
  throw new Error('No results found from DuckDuckGo');
}
