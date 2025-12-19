import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import PlayerConnect from './src/playerConnect';

const app = express();
const playerConnect = new PlayerConnect();

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
        'Referer': 'https://megacloud.blog/',
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

// Example API endpoint: Basic stream request
// Uses the PlayerConnect module to fetch streams
// Usage: /api/stream?id=anime-id?ep=1&server=hd-2
app.get('/api/stream', async (req: Request, res: Response) => {
  try {
    let id = req.query.id as string;
    const server = (req.query.server as string || 'hd-2');

    if (!id) {
      return res.status(400).json({ error: 'Episode ID is required', success: false });
    }

    const result = await playerConnect.getEpisodeStreams(id, server);
    
    // Return response with data - servers will be fetched dynamically if needed
    res.json({
      ...result,
      servers: [] // Will be populated by client if needed
    });
  } catch (error) {
    console.error('API error:', error);
    res.json({
      success: true,
      data: {
        sub: { type: 'sub', link: { file: null }, tracks: [], intro: { start: 0, end: 0 }, outro: { start: 0, end: 0 }, server: 'hd-2' },
        dub: {}
      },
      servers: [],
      note: 'No stream available'
    });
  }
});

// Example endpoint: Get multi-server streams for episode with type
// Uses PlayerConnect.getEpisodeMultiServer()
// Usage: /api/stream/tv/tvId/ep/1
app.get('/api/stream/:type/:tvId/ep/:epid', async (req: Request, res: Response) => {
  try {
    const { type, tvId, epid } = req.params;
    const result = await playerConnect.getEpisodeMultiServer(type, tvId, epid);
    res.json(result);
  } catch (error) {
    console.error('Stream error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch stream' });
  }
});

// Example endpoint: Get multi-server streams for movie/show without episode
// Uses PlayerConnect.getMovieMultiServer()
// Usage: /api/stream/movie/tvId
app.get('/api/stream/:type/:tvId', async (req: Request, res: Response) => {
  try {
    const { type, tvId } = req.params;
    const result = await playerConnect.getMovieMultiServer(type, tvId);
    res.json(result);
  } catch (error) {
    console.error('Stream error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch stream' });
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
