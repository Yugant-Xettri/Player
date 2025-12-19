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
      return res.status(400).json({ error: 'Episode ID is required' });
    }

    // Parse anime-id and episode number from format "anime-id?ep=number" or "anime-id::ep=number"
    id = id.replace('::', '?');
    const parts = id.split('?ep=');
    const animeId = parts[0];
    const epNum = parts[1] || '1';

    try {
      // Fetch from external anime API
      const streamUrl = `${EXTERNAL_API}/anime/${animeId}/${epNum}/servers`;
      console.log(`Fetching from: ${streamUrl}`);
      
      const response = await retryWithBackoff(() => 
        fetch(streamUrl).then(r => r.json()), 
        3, 
        1000
      );
      
      if (!response || !response.results) {
        return res.status(503).json({ error: 'No sources available' });
      }

      const sources = response.results || [];
      
      // Find source for requested server, default to first available
      const selectedServer = sources.find((s: any) => 
        s.serverName && s.serverName.toLowerCase().includes(server.split('-')[0])
      ) || sources[0];

      if (!selectedServer) {
        return res.status(503).json({ error: 'No sources available for this server' });
      }

      // Build response with SUB
      const transformedData: any = {
        sub: {
          type: 'sub',
          link: { file: selectedServer.link || selectedServer.url },
          tracks: [],
          intro: { start: 0, end: 0 },
          outro: { start: 0, end: 0 },
          server: selectedServer.serverName || server
        },
        dub: {}
      };

      // Try to fetch DUB version if available
      try {
        const dubResponse = await retryWithBackoff(() => 
          fetch(`${EXTERNAL_API}/anime/${animeId}/${epNum}/servers?type=dub`).then(r => r.json()), 
          2, 
          500
        ).catch(() => null);
        
        if (dubResponse && dubResponse.results && dubResponse.results.length > 0) {
          const dubServer = dubResponse.results[0];
          transformedData.dub = {
            type: 'dub',
            link: { file: dubServer.link || dubServer.url },
            tracks: [],
            intro: { start: 0, end: 0 },
            outro: { start: 0, end: 0 },
            server: dubServer.serverName || 'dub'
          };
        }
      } catch (e) {
        // DUB not available - stays empty
      }
      
      res.json({
        success: true,
        data: transformedData
      });
    } catch (error: any) {
      console.error('External API error:', error.message);
      res.status(503).json({ error: 'Streaming source temporarily unavailable' });
    }
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Failed to fetch stream data' });
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