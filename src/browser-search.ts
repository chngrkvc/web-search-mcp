import { callExecuteJsTool } from './crawl4ai.js';

export type SearchResult = {
  url: string;
  title: string;
  description: string;
};

/**
 * Extract search results from DuckDuckGo HTML
 */
function parseDuckDuckGoHtml(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Match result blocks
  const resultRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const resultsRegex = /<div[^>]+class="[^"]*result[^"]*"[^>]*>[\s\S]*?<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/p>)?/gi;

  let match;
  let count = 0;

  while ((match = resultsRegex.exec(html)) !== null && count < limit) {
    const href = match[1] || '';
    const title = match[2]?.replace(/<[^>]+>/g, '').trim() || '';
    const description = match[3]?.replace(/<[^>]+>/g, '').trim() || '';

    // Extract actual URL from DuckDuckGo redirect
    let url = href;
    const uddgMatch = href.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      url = decodeURIComponent(uddgMatch[1]);
    }

    if (url && title) {
      results.push({ url, title, description });
      count++;
    }
  }

  return results;
}

/**
 * Extract search results from Brave Search HTML
 */
function parseBraveHtml(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Match Brave result blocks - more flexible matching
  const resultsRegex = /<div[^>]+data-testid="web-result"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?/gi;

  let match;
  let count = 0;

  while ((match = resultsRegex.exec(html)) !== null && count < limit) {
    let url = match[1] || '';
    const title = match[2]?.replace(/<[^>]+>/g, '').trim() || '';
    const description = match[3]?.replace(/<[^>]+>/g, '').trim() || '';

    // Clean up relative URLs
    if (url && !url.startsWith('http')) {
      url = 'https://' + url;
    }

    if (url && title) {
      results.push({ url, title, description });
      count++;
    }
  }

  return results;
}

/**
 * Search DuckDuckGo HTML version using browser-based execution
 * DuckDuckGo HTML has less bot protection than the main version
 */
async function searchDuckDuckGo(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

  const script = `
    await new Promise(r => setTimeout(r, 2000));
    return document.documentElement.outerHTML;
  `;

  try {
    const result = await callExecuteJsTool({
      url,
      scripts: [script],
    });

    const content = result as { content: { type: string; text: string }[] };
    const text = content.content?.[0]?.text;

    if (!text) {
      throw new Error('No response from DuckDuckGo');
    }

    // Extract HTML from the crawl result
    let html = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed.html) {
        html = parsed.html;
      }
    } catch {
      // text is already the HTML
    }

    const results = parseDuckDuckGoHtml(html, limit);

    if (results.length === 0) {
      throw new Error('No results parsed from DuckDuckGo HTML');
    }

    return results;
  } catch (error) {
    throw new Error(
      `DuckDuckGo search failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Search Brave Search using browser-based execution (fallback)
 */
async function searchBrave(query: string, limit: number): Promise<SearchResult[]> {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://search.brave.com/search?q=${encodedQuery}`;

  const script = `
    await new Promise(r => setTimeout(r, 3000));
    return document.documentElement.outerHTML;
  `;

  try {
    const result = await callExecuteJsTool({
      url,
      scripts: [script],
    });

    const content = result as { content: { type: string; text: string }[] };
    const text = content.content?.[0]?.text;

    if (!text) {
      throw new Error('No response from Brave');
    }

    // Extract HTML from the crawl result
    let html = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed.html) {
        html = parsed.html;
      }
    } catch {
      // text is already the HTML
    }

    const results = parseBraveHtml(html, limit);

    if (results.length === 0) {
      throw new Error('No results parsed from Brave HTML');
    }

    return results;
  } catch (error) {
    throw new Error(
      `Brave search failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Main search function - tries DuckDuckGo first, falls back to Brave
 */
export async function browserSearch(
  query: string,
  limit?: number,
): Promise<{ data: SearchResult[] }> {
  const maxResults = limit ?? 10;

  // Try DuckDuckGo first
  try {
    const results = await searchDuckDuckGo(query, maxResults);
    if (results.length > 0) {
      return { data: results };
    }
  } catch (error) {
    process.stderr.write(
      `DuckDuckGo search failed, falling back to Brave: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }

  // Fallback to Brave Search
  try {
    const results = await searchBrave(query, maxResults);
    return { data: results };
  } catch (error) {
    throw new Error(
      `Both search engines failed. Last error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
