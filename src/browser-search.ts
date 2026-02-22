export type SearchResult = {
  url: string;
  title: string;
  description: string;
};

type DuckDuckGoResponse = {
  RelatedTopics?: Array<{ Text: string; FirstURL: string }>;
  Results?: Array<{ Text: string; FirstURL: string }>;
  Answer?: string;
};

// DuckDuckGo Instant Answer API - direct HTTP
async function searchDuckDuckGoAPI(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&pretty=0`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo API failed: ${response.status}`);
  }

  const data = (await response.json()) as DuckDuckGoResponse;
  const results: SearchResult[] = [];

  // Try RelatedTopics first
  if (data.RelatedTopics && data.RelatedTopics.length > 0) {
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
  }

  // Also try Results array
  if (data.Results && data.Results.length > 0 && results.length < limit) {
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

  // If still no results, try Answer
  if (results.length === 0 && data.Answer) {
    // Create a result from the answer
    results.push({
      url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
      title: data.Answer.substring(0, 100),
      description: data.Answer,
    });
  }

  if (results.length === 0) {
    throw new Error('No results from DuckDuckGo');
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

  throw new Error('No results found from search');
}
