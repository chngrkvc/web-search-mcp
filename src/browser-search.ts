import { callExecuteJsTool } from './crawl4ai.js';

export type SearchResult = {
  url: string;
  title: string;
  description: string;
};

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
    // Wait for results to load
    await new Promise(r => setTimeout(r, 2000));

    const results = [];
    const resultElements = document.querySelectorAll('.result');

    resultElements.forEach((el, index) => {
      if (index >= ${limit}) return;

      const titleEl = el.querySelector('.result__a');
      const snippetEl = el.querySelector('.result__snippet');

      if (titleEl) {
        let url = titleEl.getAttribute('href') || '';

        // DuckDuckGo URLs are redirects, extract the actual URL
        const uddgMatch = url.match(/uddg=([^&]+)/);
        if (uddgMatch) {
          url = decodeURIComponent(uddgMatch[1]);
        }

        results.push({
          url: url,
          title: titleEl.textContent?.trim() || '',
          description: snippetEl?.textContent?.trim() || ''
        });
      }
    });

    return JSON.stringify(results);
  `;

  try {
    const result = await callExecuteJsTool({
      url,
      scripts: [script],
    });

    // Parse the result
    const content = result as { content: { type: string; text: string }[] };
    const text = content.content?.[0]?.text;

    if (!text) {
      throw new Error('No response from DuckDuckGo');
    }

    // The execute_js returns the crawl result, we need to extract the JS result
    // Try to parse as JSON first, then look for the result in the response
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // If not direct JSON, try to extract from markdown
      const jsonMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    }

    throw new Error('Could not parse DuckDuckGo results');
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
    // Wait for results to load
    await new Promise(r => setTimeout(r, 3000));

    const results = [];
    const resultElements = document.querySelectorAll('[data-testid="web-result"]');

    resultElements.forEach((el, index) => {
      if (index >= ${limit}) return;

      const headingEl = el.querySelector('heading a, h3 a, a[href]');
      const snippetEl = el.querySelector('[data-testid="snippet-text"], .snippet');
      const citeEl = el.querySelector('cite');

      if (headingEl) {
        let resultUrl = headingEl.getAttribute('href') || citeEl?.textContent || '';

        // Clean up relative URLs
        if (resultUrl && !resultUrl.startsWith('http')) {
          resultUrl = 'https://' + resultUrl;
        }

        results.push({
          url: resultUrl,
          title: headingEl.textContent?.trim() || '',
          description: snippetEl?.textContent?.trim() || ''
        });
      }
    });

    return JSON.stringify(results);
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

    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      const jsonMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    }

    throw new Error('Could not parse Brave results');
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
    // If no results, fall through to Brave
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
