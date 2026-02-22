import { callExecuteJsTool } from './crawl4ai.js';

export type SearchResult = {
  url: string;
  title: string;
  description: string;
};

function parseDuckDuckGoHtml(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Try multiple regex patterns to find results
  const patterns = [
    // Pattern with snippet
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
    // Just the link
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null && results.length < limit) {
      let url = match[1] || '';
      const title = match[2]?.replace(/<[^>]+>/g, '').trim() || '';
      const description = match[3]?.replace(/<[^>]+>/g, '').trim() || '';

      // Extract actual URL from DuckDuckGo redirect
      const uddgMatch = url.match(/uddg=([^&]+)/);
      if (uddgMatch) url = decodeURIComponent(uddgMatch[1]);

      if (url && title) {
        results.push({ url, title, description });
      }
    }
    if (results.length > 0) break;
  }

  return results;
}

function parseBraveHtml(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];

  const patterns = [
    /<article[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?/gi,
    /<div[^>]*data-testid="web-result"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null && results.length < limit) {
      let url = match[1] || '';
      const title = match[2]?.replace(/<[^>]+>/g, '').trim() || '';
      const description = match[3]?.replace(/<[^>]+>/g, '').trim() || '';

      if (url && !url.startsWith('http')) url = 'https://' + url;
      if (url && title) results.push({ url, title, description });
    }
    if (results.length > 0) break;
  }

  return results;
}

function extractHtml(result: unknown): string {
  const response = result as { content?: { text: unknown }[] };
  const textField = response?.content?.[0]?.text;

  if (!textField) {
    throw new Error('No response from Crawl4AI');
  }

  // Direct check for object with html property
  if (typeof textField === 'object' && textField !== null && 'html' in textField) {
    const obj = textField as { html?: string };
    if (obj.html) return obj.html;
  }

  // If string, try JSON parse
  if (typeof textField === 'string') {
    try {
      const parsed = JSON.parse(textField);
      if (parsed && typeof parsed === 'object' && 'html' in parsed) {
        return (parsed as { html?: string }).html || '';
      }
    } catch {
      // Not JSON, return as-is
    }
    return textField;
  }

  return String(textField);
}

async function searchDuckDuckGo(query: string, limit: number): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const result = await callExecuteJsTool({
    url,
    scripts: [`await new Promise(r => setTimeout(r, 2500)); return document.documentElement.outerHTML;`],
  });

  const html = extractHtml(result);

  // Check if we got a valid page or a bot detection page
  if (html.length < 1000) {
    process.stderr.write(`DDG response too short: ${html.substring(0, 500)}\n`);
    throw new Error('DuckDuckGo returned a short/empty response - possibly bot detection');
  }

  const results = parseDuckDuckGoHtml(html, limit);
  process.stderr.write(`DDG: got ${results.length} results from ${html.length} bytes\n`);

  if (results.length === 0) {
    throw new Error('No results parsed from DuckDuckGo HTML');
  }

  return results;
}

async function searchBrave(query: string, limit: number): Promise<SearchResult[]> {
  const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;

  const result = await callExecuteJsTool({
    url,
    scripts: [`await new Promise(r => setTimeout(r, 3500)); return document.documentElement.outerHTML;`],
  });

  const html = extractHtml(result);

  if (html.length < 1000) {
    process.stderr.write(`Brave response too short: ${html.substring(0, 500)}\n`);
    throw new Error('Brave returned a short/empty response');
  }

  const results = parseBraveHtml(html, limit);
  process.stderr.write(`Brave: got ${results.length} results from ${html.length} bytes\n`);

  if (results.length === 0) {
    throw new Error('No results parsed from Brave HTML');
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
    if (results.length > 0) return { data: results };
  } catch (error) {
    process.stderr.write(
      `DuckDuckGo failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }

  try {
    const results = await searchBrave(query, maxResults);
    return { data: results };
  } catch (error) {
    throw new Error(
      `Both search engines failed. Last error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
