import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'path';

const app = express();
const EXTERNAL_API = 'https://anime-api-rose-delta.vercel.app/api';

app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.static('public'));

function rewriteM3u8(content: string, baseUrl: string, isMaster: boolean): string {
  const lines = content.split('\n');
  return lines.map(line => {
    let processedLine = line;

    if (isMaster && line.includes('CODECS=')) {
      processedLine = line.replace(/,CODECS="[^"]*"/g, '').replace(/CODECS="[^"]*",?/g, '');
    }

    const trimmedLine = processedLine.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      if (trimmedLine.startsWith('/proxy?url=')) {
        return trimmedLine;
      }
      let fullUrl = trimmedLine;
      if (!trimmedLine.startsWith('http://') && !trimmedLine.startsWith('https://')) {
        fullUrl = baseUrl + trimmedLine;
      }
      return '/proxy?url=' + encodeURIComponent(fullUrl);
    }
    return processedLine;
  }).join('\n');
}

app.get('/proxy', async (req: Request, res: Response) => {
  try {
    const targetUrl = req.query.url as string;
    if (!targetUrl) {
      return res.status(400).json({ error: 'URL parameter required' });
    }

    const response = await fetch(targetUrl, {
      headers: {
        'Referer': 'https://vidwish.live/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const contentType = response.headers.get('content-type') || '';
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (targetUrl.endsWith('.m3u8') || contentType.includes('mpegurl') || contentType.includes('m3u8')) {
      const text = await response.text();
      const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
      const isMaster = text.includes('#EXT-X-STREAM-INF');
      const rewritten = rewriteM3u8(text, baseUrl, isMaster);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.send(rewritten);
    } else {
      if (contentType) {
        res.setHeader('Content-Type', contentType);
      }
      const arrayBuffer = await response.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
    }
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch resource' });
  }
});

// Helper function to retry with exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 500
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`Retry attempt ${attempt + 1}/${maxRetries - 1} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

app.get('/api/stream', async (req: Request, res: Response) => {
  try {
    let id = req.query.id as string;
    const server = (req.query.server as string || 'hd-2').toLowerCase();

    if (!id) {
      return res.status(400).json({ error: 'Episode ID is required', success: false });
    }

    // Parse anime-id and episode number from format "anime-id?ep=number" or "anime-id::ep=number"
    id = id.replace('::', '?');
    const parts = id.split('?ep=');
    const animeId = parts[0];
    const epNum = parts[1] || '1';

    // Return response with empty streams but allow controls to work
    const transformedData: any = {
      sub: {
        type: 'sub',
        link: { file: null },
        tracks: [],
        intro: { start: 0, end: 0 },
        outro: { start: 0, end: 0 },
        server: server
      },
      dub: {}
    };

    try {
      // Try fetching from external API - but don't fail if it doesn't work
      const streamUrl = `${EXTERNAL_API}/streaming-info?episode_id=${animeId}-episode-${epNum}`;
      console.log(`Fetching from: ${streamUrl}`);
      
      const response = await fetch(streamUrl, {
        signal: AbortSignal.timeout(5000)
      }).then(r => {
        if (!r.ok) throw new Error('API returned ' + r.status);
        return r.json();
      }).catch(() => null);
      
      if (response?.results?.sources && response.results.sources.length > 0) {
        const source = response.results.sources.find((s: any) => 
          s.url || s.link
        ) || response.results.sources[0];
        
        if (source) {
          transformedData.sub.link.file = source.url || source.link;
          console.log(`Found stream: ${transformedData.sub.link.file}`);
        }
      }
    } catch (error: any) {
      console.log(`API call failed (graceful): ${error.message}`);
      // Continue - return response with null stream so UI can show controls
    }
      
    res.json({
      success: true,
      data: transformedData,
      note: transformedData.sub.link.file ? 'Stream loaded' : 'Stream not available - try another server'
    });
  } catch (error) {
    console.error('API error:', error);
    // Return successful response but with empty stream
    res.json({
      success: true,
      data: {
        sub: { type: 'sub', link: { file: null }, tracks: [], intro: { start: 0, end: 0 }, outro: { start: 0, end: 0 }, server: 'hd-2' },
        dub: {}
      },
      note: 'No stream available'
    });
  }
});

app.get('/embed', (req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), 'public', 'embed.html'));
});

app.get('/embed/:id', (req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), 'public', 'embed.html'));
});

const PORT = parseInt(process.env.PORT || '5000', 10);

if (process.env.VERCEL !== '1') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

export default app;