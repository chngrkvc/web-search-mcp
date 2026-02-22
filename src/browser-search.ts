import { callExecuteJsTool, callMdTool } from './crawl4ai.js';

export type SearchResult = {
  url: string;
  title: string;
  description: string;
};

function parseDuckDuckGoHtml(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Find all result blocks - more flexible regex
  const resultBlocks = html.split(/<div[^>]*class="[^"]*result[^"]*"[^>]*>/i);

  for (const block of resultBlocks.slice(1)) { // Skip first which is before first result
    if (results.length >= limit) break;

    // Extract URL and title from the link
    const linkMatch = block.match(/href="([^"]*result[^"]*)"[^>]*>([^<]+)</i);
    const urlMatch = block.match(/uddg=([^&"]+)/);
    const titleMatch = block.match(/class="[^"]*result__a[^"]*"[^>]*>([^<]+)</i);
    const snippetMatch = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([^<]+)</i>);

    let url = '';
    if (urlMatch) {
      url = decodeURIComponent(urlMatch[1]);
    } else if (linkMatch) {
      url = linkMatch[1];
    }

    const title = titleMatch ? titleMatch[1].trim() : '';
    const description = snippetMatch ? snippetMatch[1].trim() : '';

    if (url && title) {
      results.push({ url, title, description });
    }
  }

  return results;
}

function parseBraveHtml(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Find article blocks
  const articleBlocks = html.split(/<article/i);

  for (const block of articleBlocks.slice(1)) {
    if (results.length >= limit) break;

    const urlMatch = block.match(/href="([^"]+)"/);
    const titleMatch = block.match(/<h3[^>]*>([^<]+)</i);
    const descMatch = block.match(/<p[^>]*>([^<]+)</i);

    let url = urlMatch ? urlMatch[1] : '';
    if (url && !url.startsWith('http')) {
      url = 'https://' + url;
    }

    const title = titleMatch ? titleMatch[1].trim() : '';
    const description = descMatch ? descMatch[1].trim() : '';

    if (url && title) {
      results.push({ url, title, description });
    }
  }

  return results;
}

async function searchDuckDuckGo(query: string, limit: number): Promise<SearchResult[]> {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

  // Use md tool to get the HTML content
  try {
    const result = await callMdTool({ url });

    // MD tool returns markdown, but we need raw HTML
    // Let's use execute_js but just get the raw HTML without waiting
    const jsResult = await callExecuteJsTool({
      url,
      scripts: [
        `await new Promise(r => setTimeout(r, 1500));
         const results = [];
         document.querySelectorAll('.result').forEach((el, i) => {
           if (i >= ${limit}) return;
           const link = el.querySelector('.result__a');
           const snippet = el.querySelector('.result__snippet');
           if (link) {
             let href = link.getAttribute('href') || '';
             const match = href.match(/uddg=([^&]+)/);
             if (match) href = decodeURIComponent(match[1]);
             results.push({ url: href, title: link.textContent?.trim() || '', description: snippet?.textContent?.trim() || '' });
           }
         });
         return JSON.stringify(results);`
      ],
    });

    // Parse the JS result
    const content = jsResult as { content?: { text: unknown }[] };
    const text = content?.content?.[0]?.text;

    if (!text) throw new Error('No JS result');

    let results: SearchResult[] = [];

    // Try to extract the JSON result
    if (typeof text === 'string') {
      // Check if it's a JSON string
      try {
        const parsed = JSON.parse(text);
        if (parsed.js_execution_result) {
          results = JSON.parse(parsed.js_execution_result);
        } else if (Array.isArray(parsed)) {
          results = parsed;
        }
      } catch {
        // Try to extract array from string
        const match = text.match(/\[[\s\S]*\{[\s\S]*url[\s\S]*\}[\s\S]*\]/);
        if (match) {
          results = JSON.parse(match[0]);
        }
      }
    } else if (typeof text === 'object') {
      const obj = text as { js_execution_result?: string };
      if (obj.js_execution_result) {
        results = JSON.parse(obj.js_execution_result);
      }
    }

    if (results.length === 0) {
      throw new Error('Could not extract results from JS execution');
    }

    return results;
  } catch (error) {
    throw new Error(
      `DuckDuckGo search failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function searchBrave(query: string, limit: number): Promise<SearchResult[]> {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://search.brave.com/search?q=${encodedQuery}`;

  try {
    const result = await callExecuteJsTool({
      url,
      scripts: [
        `await new Promise(r => setTimeout(r, 2000));
         const results = [];
         document.querySelectorAll('[data-testid="web-result"], article').forEach((el, i) => {
           if (i >= ${limit}) return;
           const link = el.querySelector('a[href]');
           const title = el.querySelector('h3');
           const desc = el.querySelector('[data-testid="snippet-text"], p');
           if (link) {
             let href = link.getAttribute('href') || '';
             if (!href.startsWith('http')) href = 'https://' + href;
             results.push({ url: href, title: title?.textContent?.trim() || link.textContent?.trim() || '', description: desc?.textContent?.trim() || '' });
           }
         });
         return JSON.stringify(results);`
      ],
    });

    const content = result as { content?: { text: unknown }[] };
    const text = content?.content?.[0]?.text;

    if (!text) throw new Error('No JS result from Brave');

    let results: SearchResult[] = [];

    if (typeof text === 'string') {
      try {
        const parsed = JSON.parse(text);
        if (parsed.js_execution_result) {
          results = JSON.parse(parsed.js_execution_result);
        } else if (Array.isArray(parsed)) {
          results = parsed;
        }
      } catch {
        const match = text.match(/\[[\s\S]*\{[\s\S]*url[\s\S]*\}[\s\S]*\]/);
        if (match) results = JSON.parse(match[0]);
      }
    } else if (typeof text === 'object') {
      const obj = text as { js_execution_result?: string };
      if (obj.js_execution_result) {
        results = JSON.parse(obj.js_execution_result);
      }
    }

    if (results.length === 0) {
      throw new Error('Could not extract results from Brave JS execution');
    }

    return results;
  } catch (error) {
    throw new Error(
      `Brave search failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
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
