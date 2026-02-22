import { callMdTool } from './crawl4ai.js';

export type SearchResult = {
  url: string;
  title: string;
  description: string;
};

// DuckDuckGo Instant Answer API - no bot detection
async function searchDuckDuckGoAPI(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

  const result = await callMdTool({ url });

  const content = result as { content?: { text: string }[] };
  const text = content?.content?.[0]?.text;

  if (!text) {
    throw new Error('No response from DuckDuckGo API');
  }

  // Parse the JSON response
  const data = JSON.parse(text);

  if (!data.RelatedTopics || data.RelatedTopics.length === 0) {
    throw new Error('No results from DuckDuckGo');
  }

  const results: SearchResult[] = [];

  for (const topic of data.RelatedTopics) {
    if (results.length >= limit) break;

    if (topic.Text && topic.FirstURL) {
      results.push({
        url: topic.FirstURL,
        title: topic.Text.split(' - ')[0] || topic.Text,
        description: '',
      });
    }
  }

  // Also add results from Results array if present
  if (data.Results) {
    for (const topic of data.Results) {
      if (results.length >= limit) break;

      if (topic.Text && topic.FirstURL) {
        results.push({
          url: topic.FirstURL,
          title: topic.Text.split(' - ')[0] || topic.Text,
          description: '',
        });
      }
    }
  }

  return results;
}

// Fallback: scrape Bing or use textise dot iitty
async function searchBingScrape(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;

  const result = await callMdTool({ url });

  const content = result as { content?: { text: string }[] };
  const text = content?.content?.[0]?.text;

  if (!text) {
    throw new Error('No response from Bing');
  }

  // Extract URLs from markdown-style links
  const urlRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const results: SearchResult[] = [];
  let match;

  while ((match = urlRegex.exec(text)) !== null && results.length < limit) {
    const title = match[1];
    const url = match[2];

    if (url && !url.includes('bing') && !url.includes('microsoft.com')) {
      results.push({
        url,
        title,
        description: '',
      });
    }
  }

  if (results.length === 0) {
    throw new Error('No results parsed from Bing');
  }

  return results;
}

// Use textise dot iitty - a simple text-based search
async function searchTextise(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const result = await callMdTool({ url });

  const content = result as { content?: { text: string }[] };
  const text = content?.content?.[0]?.text;

  if (!text) {
    throw new Error('No response from DuckDuckGo');
  }

  // Try to parse as markdown links
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const results: SearchResult[] = [];
  let match;

  while ((match = linkRegex.exec(text)) !== null && results.length < limit) {
    const title = match[1];
    let url = match[2];

    // Skip relative URLs and DuckDuckGo internal links
    if (!url || url.startsWith('/') || url.includes('uddg=')) {
      continue;
    }

    // Decode DuckDuckGo redirect URLs
    const uddgMatch = url.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      url = decodeURIComponent(uddgMatch[1]);
    }

    if (url && title) {
      results.push({
        url,
        title,
        description: '',
      });
    }
  }

  if (results.length === 0) {
    throw new Error('No results parsed from textise');
  }

  return results;
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

  // Try textise version
  try {
    const results = await searchTextise(query, maxResults);
    if (results.length > 0) {
      process.stderr.write(`DuckDuckGo textise: got ${results.length} results\n`);
      return { data: results };
    }
  } catch (error) {
    process.stderr.write(
      `DuckDuckGo textise failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }

  // Try Bing scrape
  try {
    const results = await searchBingScrape(query, maxResults);
    return { data: results };
  } catch (error) {
    throw new Error(
      `All search engines failed. Last error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
