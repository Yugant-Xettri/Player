import express from 'express';
import type { Request, Response, NextFunction } from 'express';
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
    const serverParam = (req.query.server as string || 'hd-2').toLowerCase();

    if (!id) {
      return res.status(400).json({ error: 'Episode ID is required', success: false });
    }

    // Convert format from "anime-id::ep=number" to "anime-id?ep=number"
    id = id.replace('::', '?');
    console.log(`🎬 Fetching stream for: ${id} on server: ${serverParam}`);

    // Return response with empty streams but allow controls to work
    const transformedData: any = {
      sub: {
        type: 'sub',
        link: { file: null },
        tracks: [],
        intro: { start: 0, end: 0 },
        outro: { start: 0, end: 0 },
        server: serverParam
      },
      dub: {}
    };

    try {
      // Try fetching SUB stream with category='sub'
      console.log(`⏳ Attempting to fetch SUB stream from ${serverParam}...`);
      const streamData = await retryWithBackoff(() => 
        scraper.getEpisodeSources(id, serverParam as any, 'sub' as any), 
        3, 
        1000
      );
      
      if (streamData && streamData.sources && streamData.sources.length > 0) {
        transformedData.sub.link.file = streamData.sources[0].url;
        
        // Extract subtitle tracks from scraper response
        if (streamData.subtitles && Array.isArray(streamData.subtitles)) {
          transformedData.sub.tracks = streamData.subtitles.map((t: any) => ({
            file: t.url,
            label: t.lang || 'Unknown',
            kind: 'captions',
            default: t.default || false
          }));
        }
        console.log(`✅ SUB stream found on ${serverParam} with ${transformedData.sub.tracks.length} subtitle tracks`);
      }

      // Try to fetch DUB stream with same server, category='dub'
      try {
        console.log(`⏳ Attempting to fetch DUB stream from ${serverParam}...`);
        const dubData = await retryWithBackoff(() => 
          scraper.getEpisodeSources(id, serverParam as any, 'dub' as any), 
          2, 
          500
        ).catch(() => null);
        
        if (dubData && dubData.sources && dubData.sources.length > 0) {
          const dubTracks: any[] = [];
          if (dubData.subtitles && Array.isArray(dubData.subtitles)) {
            dubTracks.push(...dubData.subtitles.map((t: any) => ({
              file: t.url,
              label: t.lang || 'Unknown',
              kind: 'captions',
              default: t.default || false
            })));
          }
          
          transformedData.dub = {
            type: 'dub',
            link: { file: dubData.sources[0].url },
            tracks: dubTracks,
            intro: { start: 0, end: 0 },
            outro: { start: 0, end: 0 },
            server: serverParam
          };
          console.log(`✅ DUB stream found on ${serverParam} with ${dubTracks.length} subtitle tracks`);
        }
      } catch (e) {
        console.log(`⚠️ DUB not available on ${serverParam}`);
      }
    } catch (error: any) {
      console.log(`⚠️ Stream fetch error (graceful): ${error.message}`);
    }
      
    res.json({
      success: true,
      data: transformedData,
      note: transformedData.sub.link.file ? 'Stream loaded' : 'Stream not available - try another server'
    });
  } catch (error) {
    console.error('API error:', error);
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

// New endpoint: Get streaming sources with multiple servers
// Format: /api/stream/movie/tvId or /api/stream/tv/tvId/ep/1
app.get('/api/stream/:type/:tvId/ep/:epid', async (req: Request, res: Response) => {
  try {
    const { type, tvId, epid } = req.params;
    
    console.log(`📺 Fetching ${type} ${tvId} - Episode ${epid}`);
    
    const servers = [
      {
        name: 'Server 1',
        id: 'server-1',
        sources: {
          sub: {
            type: 'sub',
            link: `https://stream.example.com/${type}/${tvId}/ep${epid}/sub`,
            captions: [
              { lang: 'English', url: `https://stream.example.com/${type}/${tvId}/ep${epid}/sub.vtt` },
              { lang: 'Spanish', url: `https://stream.example.com/${type}/${tvId}/ep${epid}/sub-es.vtt` }
            ]
          },
          dub: {
            type: 'dub',
            link: `https://stream.example.com/${type}/${tvId}/ep${epid}/dub`,
            captions: [
              { lang: 'English', url: `https://stream.example.com/${type}/${tvId}/ep${epid}/dub.vtt` }
            ]
          }
        }
      },
      {
        name: 'Server 2',
        id: 'server-2',
        sources: {
          sub: {
            type: 'sub',
            link: `https://cdn2.example.com/${type}/${tvId}/ep${epid}/sub`,
            captions: [
              { lang: 'English', url: `https://cdn2.example.com/${type}/${tvId}/ep${epid}/sub.vtt` },
              { lang: 'German', url: `https://cdn2.example.com/${type}/${tvId}/ep${epid}/sub-de.vtt` }
            ]
          },
          dub: {
            type: 'dub',
            link: `https://cdn2.example.com/${type}/${tvId}/ep${epid}/dub`,
            captions: [
              { lang: 'English', url: `https://cdn2.example.com/${type}/${tvId}/ep${epid}/dub.vtt` }
            ]
          }
        }
      },
      {
        name: 'Server 3',
        id: 'server-3',
        sources: {
          sub: {
            type: 'sub',
            link: `https://mirror.example.com/${type}/${tvId}/ep${epid}/sub`,
            captions: [
              { lang: 'English', url: `https://mirror.example.com/${type}/${tvId}/ep${epid}/sub.vtt` },
              { lang: 'French', url: `https://mirror.example.com/${type}/${tvId}/ep${epid}/sub-fr.vtt` },
              { lang: 'Italian', url: `https://mirror.example.com/${type}/${tvId}/ep${epid}/sub-it.vtt` }
            ]
          },
          dub: {
            type: 'dub',
            link: `https://mirror.example.com/${type}/${tvId}/ep${epid}/dub`,
            captions: [
              { lang: 'English', url: `https://mirror.example.com/${type}/${tvId}/ep${epid}/dub.vtt` }
            ]
          }
        }
      }
    ];
    
    res.json({
      success: true,
      contentType: type,
      contentId: tvId,
      episode: epid,
      servers: servers
    });
  } catch (error) {
    console.error('Stream error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch stream' });
  }
});

// Endpoint for movie/show without episode
// Format: /api/stream/movie/tvId
app.get('/api/stream/:type/:tvId', async (req: Request, res: Response) => {
  try {
    const { type, tvId } = req.params;
    
    console.log(`📺 Fetching ${type} ${tvId}`);
    
    const servers = [
      {
        name: 'Server 1',
        id: 'server-1',
        sources: {
          sub: {
            type: 'sub',
            link: `https://stream.example.com/${type}/${tvId}/sub`,
            captions: [
              { lang: 'English', url: `https://stream.example.com/${type}/${tvId}/sub.vtt` },
              { lang: 'Spanish', url: `https://stream.example.com/${type}/${tvId}/sub-es.vtt` }
            ]
          },
          dub: {
            type: 'dub',
            link: `https://stream.example.com/${type}/${tvId}/dub`,
            captions: [
              { lang: 'English', url: `https://stream.example.com/${type}/${tvId}/dub.vtt` }
            ]
          }
        }
      },
      {
        name: 'Server 2',
        id: 'server-2',
        sources: {
          sub: {
            type: 'sub',
            link: `https://cdn2.example.com/${type}/${tvId}/sub`,
            captions: [
              { lang: 'English', url: `https://cdn2.example.com/${type}/${tvId}/sub.vtt` },
              { lang: 'German', url: `https://cdn2.example.com/${type}/${tvId}/sub-de.vtt` }
            ]
          },
          dub: {
            type: 'dub',
            link: `https://cdn2.example.com/${type}/${tvId}/dub`,
            captions: [
              { lang: 'English', url: `https://cdn2.example.com/${type}/${tvId}/dub.vtt` }
            ]
          }
        }
      },
      {
        name: 'Server 3',
        id: 'server-3',
        sources: {
          sub: {
            type: 'sub',
            link: `https://mirror.example.com/${type}/${tvId}/sub`,
            captions: [
              { lang: 'English', url: `https://mirror.example.com/${type}/${tvId}/sub.vtt` },
              { lang: 'French', url: `https://mirror.example.com/${type}/${tvId}/sub-fr.vtt` },
              { lang: 'Italian', url: `https://mirror.example.com/${type}/${tvId}/sub-it.vtt` }
            ]
          },
          dub: {
            type: 'dub',
            link: `https://mirror.example.com/${type}/${tvId}/dub`,
            captions: [
              { lang: 'English', url: `https://mirror.example.com/${type}/${tvId}/dub.vtt` }
            ]
          }
        }
      }
    ];
    
    res.json({
      success: true,
      contentType: type,
      contentId: tvId,
      servers: servers
    });
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