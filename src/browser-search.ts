import { callExecuteJsTool } from './crawl4ai.js';

export type SearchResult = {
  url: string;
  title: string;
  description: string;
};

function parseDuckDuckGoHtml(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];
  const snippetRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const linkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = snippetRegex.exec(html)) !== null && results.length < limit) {
    let url = match[1] || '';
    const title = match[2]?.replace(/<[^>]+>/g, '').trim() || '';
    const description = match[3]?.replace(/<[^>]+>/g, '').trim() || '';

    const uddgMatch = url.match(/uddg=([^&]+)/);
    if (uddgMatch) url = decodeURIComponent(uddgMatch[1]);

    if (url && title) results.push({ url, title, description });
  }

  if (results.length === 0) {
    while ((match = linkRegex.exec(html)) !== null && results.length < limit) {
      let url = match[1] || '';
      const title = match[2]?.replace(/<[^>]+>/g, '').trim() || '';

      const uddgMatch = url.match(/uddg=([^&]+)/);
      if (uddgMatch) url = decodeURIComponent(uddgMatch[1]);

      if (url && title) results.push({ url, title, description: '' });
    }
  }

  return results;
}

function parseBraveHtml(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];
  const regex = /<article[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?/gi;

  let match;
  while ((match = regex.exec(html)) !== null && results.length < limit) {
    let url = match[1] || '';
    const title = match[2]?.replace(/<[^>]+>/g, '').trim() || '';
    const description = match[3]?.replace(/<[^>]+>/g, '').trim() || '';

    if (url && !url.startsWith('http')) url = 'https://' + url;
    if (url && title) results.push({ url, title, description });
  }

  return results;
}

function extractHtml(result: unknown): string {
  // Crawl4AI returns { content: [{ type, text }] }
  // text can be a string (JSON) or an object
  const content = result as { content?: { type: string; text: unknown }[] };
  const textField = content?.content?.[0]?.text;

  if (!textField) throw new Error('No response from Crawl4AI');

  // If text is already an object (not a string)
  if (typeof textField === 'object' && textField !== null) {
    const obj = textField as { html?: string };
    if (obj.html) return obj.html;
    return JSON.stringify(textField);
  }

  // If text is a string, try to parse as JSON to get html field
  const text = String(textField);
  try {
    const parsed = JSON.parse(text);
    if (parsed.html) return parsed.html;
  } catch {
    // text is already the HTML
  }

  return text;
}

async function searchDuckDuckGo(query: string, limit: number): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const result = await callExecuteJsTool({
    url,
    scripts: [`await new Promise(r => setTimeout(r, 2000)); return document.documentElement.outerHTML;`],
  });

  const html = extractHtml(result);
  const results = parseDuckDuckGoHtml(html, limit);

  if (results.length === 0) {
    process.stderr.write(`DDG HTML sample (first 1000 chars): ${html.substring(0, 1000)}\n`);
    throw new Error('No results parsed from DuckDuckGo HTML');
  }

  return results;
}

async function searchBrave(query: string, limit: number): Promise<SearchResult[]> {
  const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;

  const result = await callExecuteJsTool({
    url,
    scripts: [`await new Promise(r => setTimeout(r, 3000)); return document.documentElement.outerHTML;`],
  });

  const html = extractHtml(result);
  const results = parseBraveHtml(html, limit);

  if (results.length === 0) {
    process.stderr.write(`Brave HTML sample (first 1000 chars): ${html.substring(0, 1000)}\n`);
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
      `DuckDuckGo failed, trying Brave: ${error instanceof Error ? error.message : String(error)}\n`,
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
