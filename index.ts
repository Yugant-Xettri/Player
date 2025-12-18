import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { HiAnime } from 'aniwatch';

const app = express();
const scraper = new HiAnime.Scraper();

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

app.get('/api/stream', async (req: Request, res: Response) => {
  try {
    let id = req.query.id as string;
    const server = (req.query.server as string || 'hd-2').toLowerCase();

    if (!id) {
      return res.status(400).json({ error: 'Episode ID is required' });
    }

    // Convert format from "anime-id::ep=number" to "anime-id?ep=number"
    id = id.replace('::', '?');

    try {
      const streamData = await scraper.getEpisodeSources(id, server);
      
      // Transform aniwatch response to match player expectations
      // The player expects: { sub: {link, tracks, intro, outro}, dub: {link, tracks, intro, outro} }
      // But aniwatch returns: { headers, sources, tracks, intro, outro }
      
      // Transform aniwatch source format to match player expectations
      // Player expects: link.file (string URL)
      // Aniwatch provides: sources[0].url (string URL)
      const sourceData = streamData.sources?.[0];
      const transformedData = {
        sub: {
          type: 'sub',
          link: sourceData ? { file: sourceData.url } : null,
          tracks: streamData.tracks || [],
          intro: streamData.intro || { start: 0, end: 0 },
          outro: streamData.outro || { start: 0, end: 0 },
          server: server
        },
        dub: {}  // Aniwatch doesn't separate dub from sub, so dub is empty
      };
      
      res.json({
        success: true,
        data: transformedData
      });
    } catch (error: any) {
      console.error('Aniwatch API error:', error.message);
      // Return 503 for provider errors so client knows to retry
      const status = error.status === 500 || error.message.includes('client key') ? 503 : 400;
      res.status(status).json({ error: 'Provider temporarily unavailable. Please try again.' });
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