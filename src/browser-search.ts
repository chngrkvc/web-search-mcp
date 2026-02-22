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

  // Use a simpler script that just extracts the results as a string
  const script = `
    await new Promise(r => setTimeout(r, 2000));

    const results = [];
    const resultElements = document.querySelectorAll('.result');

    resultElements.forEach((el, index) => {
      if (index >= ${limit}) return;

      const titleEl = el.querySelector('.result__a');
      const snippetEl = el.querySelector('.result__snippet');

      if (titleEl) {
        let href = titleEl.getAttribute('href') || '';

        // Extract actual URL from DuckDuckGo redirect
        const uddgMatch = href.match(/uddg=([^&]+)/);
        if (uddgMatch) {
          href = decodeURIComponent(uddgMatch[1]);
        }

        results.push({
          url: href,
          title: titleEl.textContent?.trim() || '',
          description: snippetEl?.textContent?.trim() || ''
        });
      }
    });

    return results;
  `;

  try {
    const result = await callExecuteJsTool({
      url,
      scripts: [script],
    });

    // Parse the result - Crawl4AI returns the full crawl with js_execution_result
    const content = result as { content: { type: string; text: string }[] };
    const text = content.content?.[0]?.text;

    if (!text) {
      throw new Error('No response from DuckDuckGo');
    }

    // The result is a JSON string inside the text field
    // It contains: {"url": "...", "html": "...", "js_execution_result": "..."}
    try {
      const parsed = JSON.parse(text);

      // Check for js_execution_result first
      if (parsed.js_execution_result) {
        const jsResult = JSON.parse(parsed.js_execution_result);
        if (Array.isArray(jsResult) && jsResult.length > 0) {
          return jsResult;
        }
      }

      // Try to find JSON array in the text
      const jsonMatch = text.match(/\[\s*\{[\s\S]*"url"[\s\S]*\}\s*\]/);
      if (jsonMatch) {
        const extracted = JSON.parse(jsonMatch[0]);
        if (Array.isArray(extracted) && extracted.length > 0) {
          return extracted;
        }
      }

      // If the parsed itself is an array
      if (Array.isArray(parsed)) {
        return parsed;
      }

      throw new Error('Could not extract results from response');
    } catch (parseError) {
      throw new Error(`Parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}. Response: ${text.substring(0, 500)}`);
    }
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

    const results = [];
    const resultElements = document.querySelectorAll('[data-testid="web-result"], .result, .snippet);

    resultElements.forEach((el, index) => {
      if (index >= ${limit}) return;

      const titleEl = el.querySelector('h3, .title, a[href]');
      const snippetEl = el.querySelector('[data-testid="snippet-text"], .snippet, .description');
      const linkEl = el.querySelector('a[href]');

      if (titleEl || linkEl) {
        let resultUrl = linkEl?.getAttribute('href') || '';

        // Clean up relative URLs
        if (resultUrl && !resultUrl.startsWith('http')) {
          resultUrl = 'https://' + resultUrl;
        }

        results.push({
          url: resultUrl,
          title: titleEl?.textContent?.trim() || linkEl?.textContent?.trim() || '',
          description: snippetEl?.textContent?.trim() || ''
        });
      }
    });

    return results;
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

      if (parsed.js_execution_result) {
        const jsResult = JSON.parse(parsed.js_execution_result);
        if (Array.isArray(jsResult) && jsResult.length > 0) {
          return jsResult;
        }
      }

      if (Array.isArray(parsed)) {
        return parsed;
      }

      const jsonMatch = text.match(/\[\s*\{[\s\S]*"url"[\s\S]*\}\s*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      throw new Error('Could not extract results from Brave response');
    } catch (parseError) {
      throw new Error(`Parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    }
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
