# PlayerConnect Module Guide

## Overview

The **PlayerConnect** module encapsulates all anime streaming source fetching logic using the `aniwatch` library. It provides a clean interface for server-side stream retrieval with retry logic and multi-server support.

## Module Location
- **File**: `src/playerConnect.ts`
- **Class**: `PlayerConnect`

## How It Works

The module directly uses the `aniwatch` HiAnime scraper to fetch streams. All API endpoints use this module instead of duplicating scraping logic.

### Key Methods

#### 1. `getEpisodeStreams(id, server)`
Fetches SUB and DUB streams for a single episode on a specified server.

```typescript
const playerConnect = new PlayerConnect();
const result = await playerConnect.getEpisodeStreams('anime-123?ep=1', 'hd-2');
// Returns: { success, data: { sub, dub }, note }
```

#### 2. `getEpisodeMultiServer(type, tvId, epid)`
Fetches streams from all available servers (hd-1, hd-2, hd-3) for a specific episode.

```typescript
const result = await playerConnect.getEpisodeMultiServer('tv', 'anime-123', '1');
// Returns: { success, contentType, contentId, episode, servers[] }
```

#### 3. `getMovieMultiServer(type, tvId)`
Fetches streams from all available servers for a movie or show without episode.

```typescript
const result = await playerConnect.getMovieMultiServer('movie', 'movie-456');
// Returns: { success, contentType, contentId, servers[] }
```

## API Endpoints (Examples)

These endpoints demonstrate how to use the PlayerConnect module:

### `/api/stream`
- **Method**: GET
- **Query Parameters**: `id` (required), `server` (optional, default: 'hd-2')
- **Uses**: `playerConnect.getEpisodeStreams()`
- **Example**: `/api/stream?id=anime-123?ep=1&server=hd-2`

### `/api/stream/:type/:tvId/ep/:epid`
- **Method**: GET
- **Uses**: `playerConnect.getEpisodeMultiServer()`
- **Example**: `/api/stream/tv/anime-123/ep/1`

### `/api/stream/:type/:tvId`
- **Method**: GET
- **Uses**: `playerConnect.getMovieMultiServer()`
- **Example**: `/api/stream/movie/movie-456`

## Architecture Flow

```
embed.html (client)
    ↓ (HTTP request)
API Endpoint (index.ts)
    ↓ (calls)
PlayerConnect Module (src/playerConnect.ts)
    ↓ (uses)
HiAnime.Scraper (aniwatch library)
    ↓ (fetches from)
Anime Streaming Sources
```

## Features

✅ **Retry Logic**: Exponential backoff for failed requests (configurable)
✅ **Multi-Server Support**: Try multiple streaming servers automatically
✅ **Sub/Dub Handling**: Fetch both subtitled and dubbed versions
✅ **Caption Tracks**: Extract and return available subtitle languages
✅ **Error Handling**: Graceful fallbacks for unavailable streams
✅ **Logging**: Detailed console logs with emoji indicators for debugging

## Server Details

- Fetches sources using the `aniwatch` HiAnime.Scraper
- Supports servers: `hd-1`, `hd-2`, `hd-3`
- Handles both SUB and DUB categories
- Extracts subtitle/caption tracks automatically
- Returns standardized response format for all methods

## Example Response

```json
{
  "success": true,
  "data": {
    "sub": {
      "type": "sub",
      "link": { "file": "https://stream-url.m3u8" },
      "tracks": [
        { "file": "https://subtitle-url", "label": "English", "kind": "captions", "default": true }
      ],
      "intro": { "start": 0, "end": 0 },
      "outro": { "start": 0, "end": 0 },
      "server": "hd-2"
    },
    "dub": {}
  },
  "note": "Stream loaded"
}
```
