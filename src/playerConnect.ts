import { HiAnime } from 'aniwatch';

interface StreamSource {
  url: string;
  quality?: string;
}

interface Track {
  file: string;
  label: string;
  kind: string;
  default?: boolean;
}

interface StreamData {
  type: string;
  link: { file: string | null };
  tracks: Track[];
  intro: { start: number; end: number };
  outro: { start: number; end: number };
  server: string;
}

interface PlayerConnectResponse {
  success: boolean;
  data: {
    sub: StreamData;
    dub: StreamData | Record<string, never>;
  };
  note?: string;
}

class PlayerConnect {
  private scraper: InstanceType<typeof HiAnime.Scraper>;
  
  constructor() {
    this.scraper = new HiAnime.Scraper();
  }

  /**
   * Retry with exponential backoff
   */
  private async retryWithBackoff<T>(
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
          console.log(`[PlayerConnect] Retry ${attempt + 1}/${maxRetries - 1} after ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Get streaming sources for an episode
   * @param id - Episode ID (format: "anime-id?ep=number" or "anime-id::ep=number")
   * @param server - Server name (e.g., 'hd-1', 'hd-2', 'hd-3')
   * @returns PlayerConnectResponse with sub and dub streams
   */
  async getEpisodeStreams(id: string, server: string = 'hd-2'): Promise<PlayerConnectResponse> {
    try {
      // Normalize ID format
      let normalizedId = id.replace('::', '?');
      const serverParam = server.toLowerCase();
      
      console.log(`[PlayerConnect] 🎬 Fetching stream for: ${normalizedId} on server: ${serverParam}`);
      
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
        // Fetch SUB stream
        console.log(`[PlayerConnect] ⏳ Attempting to fetch SUB stream from ${serverParam}...`);
        const streamData = await this.retryWithBackoff(
          () => this.scraper.getEpisodeSources(normalizedId, serverParam as any, 'sub' as any),
          3,
          1000
        );
        
        if (streamData && streamData.sources && streamData.sources.length > 0) {
          transformedData.sub.link.file = streamData.sources[0].url;
          
          if (streamData.subtitles && Array.isArray(streamData.subtitles)) {
            transformedData.sub.tracks = streamData.subtitles.map((t: any) => ({
              file: t.url,
              label: t.lang || 'Unknown',
              kind: 'captions',
              default: t.default || false
            }));
          }
          console.log(`[PlayerConnect] ✅ SUB stream found on ${serverParam} with ${transformedData.sub.tracks.length} subtitle tracks`);
        }

        // Try to fetch DUB stream
        try {
          console.log(`[PlayerConnect] ⏳ Attempting to fetch DUB stream from ${serverParam}...`);
          const dubData = await this.retryWithBackoff(
            () => this.scraper.getEpisodeSources(normalizedId, serverParam as any, 'dub' as any),
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
            console.log(`[PlayerConnect] ✅ DUB stream found on ${serverParam} with ${dubTracks.length} subtitle tracks`);
          }
        } catch (e) {
          console.log(`[PlayerConnect] ⚠️ DUB not available on ${serverParam}`);
        }
      } catch (error: any) {
        console.log(`[PlayerConnect] ⚠️ Stream fetch error: ${error.message}`);
      }

      return {
        success: true,
        data: transformedData,
        note: transformedData.sub.link.file ? 'Stream loaded' : 'Stream not available - try another server'
      };
    } catch (error) {
      console.error('[PlayerConnect] Fatal error:', error);
      return {
        success: true,
        data: {
          sub: {
            type: 'sub',
            link: { file: null },
            tracks: [],
            intro: { start: 0, end: 0 },
            outro: { start: 0, end: 0 },
            server: 'hd-2'
          },
          dub: {}
        },
        note: 'No stream available'
      };
    }
  }

  /**
   * Get streams for a specific episode with format: /type/tvId/ep/epid
   * @param type - Content type (tv, movie, etc)
   * @param tvId - TV ID
   * @param epid - Episode ID
   * @returns Object with multiple servers' stream sources
   */
  async getEpisodeMultiServer(
    type: string,
    tvId: string,
    epid: string
  ): Promise<{ success: boolean; contentType: string; contentId: string; episode: string; servers: any[] }> {
    const id = `${tvId}?ep=${epid}`;
    console.log(`[PlayerConnect] 📺 Fetching ${type} ${tvId} - Episode ${epid}`);
    
    const serverList = ['hd-1', 'hd-2', 'hd-3'];
    const servers = [];
    
    for (const serverName of serverList) {
      const serverObj: any = {
        name: serverName.charAt(0).toUpperCase() + serverName.slice(1),
        id: serverName,
        sources: {
          sub: { type: 'sub', link: null, captions: {} },
          dub: { type: 'dub', link: null, captions: {} }
        }
      };
      
      try {
        // Fetch SUB stream
        const subData = await this.retryWithBackoff(() => 
          this.scraper.getEpisodeSources(id, serverName as any, 'sub' as any), 
          2, 500
        ).catch(() => null);
        
        if (subData?.sources?.[0]?.url) {
          serverObj.sources.sub.link = subData.sources[0].url;
          if (subData.tracks?.length) {
            const captionsObj: any = {};
            subData.tracks.forEach((t: any) => {
              if (t.lang && t.lang !== 'thumbnails' && t.url) {
                captionsObj[t.lang] = t.url;
              }
            });
            serverObj.sources.sub.captions = captionsObj;
            console.log(`[PlayerConnect] ✅ Found ${Object.keys(captionsObj).length} caption languages for SUB on ${serverName}`);
          }
        }
      } catch (e) {
        console.log(`[PlayerConnect] ⚠️ SUB not available on ${serverName}`);
      }
      
      try {
        // Fetch DUB stream
        const dubData = await this.retryWithBackoff(() => 
          this.scraper.getEpisodeSources(id, serverName as any, 'dub' as any), 
          2, 500
        ).catch(() => null);
        
        if (dubData?.sources?.[0]?.url) {
          serverObj.sources.dub.link = dubData.sources[0].url;
          if (dubData.tracks?.length) {
            const captionsObj: any = {};
            dubData.tracks.forEach((t: any) => {
              if (t.lang && t.lang !== 'thumbnails' && t.url) {
                captionsObj[t.lang] = t.url;
              }
            });
            serverObj.sources.dub.captions = captionsObj;
            console.log(`[PlayerConnect] ✅ Found ${Object.keys(captionsObj).length} caption languages for DUB on ${serverName}`);
          }
        }
      } catch (e) {
        console.log(`[PlayerConnect] ⚠️ DUB not available on ${serverName}`);
      }
      
      servers.push(serverObj);
    }
    
    return {
      success: true,
      contentType: type,
      contentId: tvId,
      episode: epid,
      servers
    };
  }

  /**
   * Get streams for a movie or show without episode
   * @param type - Content type (movie, show, etc)
   * @param tvId - TV ID
   * @returns Object with multiple servers' stream sources
   */
  async getMovieMultiServer(
    type: string,
    tvId: string
  ): Promise<{ success: boolean; contentType: string; contentId: string; servers: any[] }> {
    console.log(`[PlayerConnect] 📺 Fetching ${type} ${tvId}`);
    
    const serverList = ['hd-1', 'hd-2', 'hd-3'];
    const servers = [];
    
    for (const serverName of serverList) {
      const serverObj: any = {
        name: serverName.charAt(0).toUpperCase() + serverName.slice(1),
        id: serverName,
        sources: {
          sub: { type: 'sub', link: null, captions: {} },
          dub: { type: 'dub', link: null, captions: {} }
        }
      };
      
      try {
        const subData = await this.retryWithBackoff(() => 
          this.scraper.getEpisodeSources(tvId, serverName as any, 'sub' as any), 
          2, 500
        ).catch(() => null);
        
        if (subData?.sources?.[0]?.url) {
          serverObj.sources.sub.link = subData.sources[0].url;
          if (subData.tracks?.length) {
            const captionsObj: any = {};
            subData.tracks.forEach((t: any) => {
              if (t.lang && t.lang !== 'thumbnails' && t.url) {
                captionsObj[t.lang] = t.url;
              }
            });
            serverObj.sources.sub.captions = captionsObj;
            console.log(`[PlayerConnect] ✅ Found ${Object.keys(captionsObj).length} caption languages for SUB on ${serverName}`);
          }
        }
      } catch (e) {
        console.log(`[PlayerConnect] ⚠️ SUB not available on ${serverName}`);
      }
      
      try {
        const dubData = await this.retryWithBackoff(() => 
          this.scraper.getEpisodeSources(tvId, serverName as any, 'dub' as any), 
          2, 500
        ).catch(() => null);
        
        if (dubData?.sources?.[0]?.url) {
          serverObj.sources.dub.link = dubData.sources[0].url;
          if (dubData.tracks?.length) {
            const captionsObj: any = {};
            dubData.tracks.forEach((t: any) => {
              if (t.lang && t.lang !== 'thumbnails' && t.url) {
                captionsObj[t.lang] = t.url;
              }
            });
            serverObj.sources.dub.captions = captionsObj;
            console.log(`[PlayerConnect] ✅ Found ${Object.keys(captionsObj).length} caption languages for DUB on ${serverName}`);
          }
        }
      } catch (e) {
        console.log(`[PlayerConnect] ⚠️ DUB not available on ${serverName}`);
      }
      
      servers.push(serverObj);
    }
    
    return {
      success: true,
      contentType: type,
      contentId: tvId,
      servers
    };
  }
}

export default PlayerConnect;
export { PlayerConnectResponse, StreamData, Track };
