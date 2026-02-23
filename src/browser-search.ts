import { callMdTool } from './crawl4ai.js';

export type SearchResult = {
  url: string;
  title: string;
  description: string;
};

// Use Crawl4AI to search DuckDuckGo HTML version
async function searchDuckDuckGo(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  // Use Crawl4AI's md tool to get the page content
  const result = await callMdTool({ url });

  const content = result as { content?: { text: string }[] };
  const text = content?.content?.[0]?.text;

  if (!text) {
    throw new Error('No response from DuckDuckGo');
  }

  // Parse markdown links: [title](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const results: SearchResult[] = [];
  let match;

  while ((match = linkRegex.exec(text)) !== null && results.length < limit) {
    const title = match[1];
    let url = match[2];

    // Skip internal DuckDuckGo links
    if (!url || url.startsWith('/') || url.includes('uddg=')) {
      continue;
    }

    // Decode DuckDuckGo redirect URLs
    const uddgMatch = url.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      url = decodeURIComponent(uddgMatch[1]);
    }

    // Skip non-http URLs
    if (!url.startsWith('http')) {
      continue;
    }

    results.push({
      url,
      title,
      description: '',
    });
  }

  if (results.length === 0) {
    throw new Error('No results parsed from DuckDuckGo');
  }

  return results;
}

export async function browserSearch(
  query: string,
  limit?: number,
): Promise<{ data: SearchResult[] }> {
  const maxResults = limit ?? 10;

  try {
    const results = await searchDuckDuckGo(query, maxResults);
    return { data: results };
  } catch (error) {
    throw new Error(
      `Search failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
