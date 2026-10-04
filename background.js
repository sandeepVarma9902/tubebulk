// TubeBulk background service worker (Manifest V3)
// Handles: ExtensionPay, Google OAuth token management, YouTube Data API calls.

importScripts('ExtPay.js');

// === CONFIG — owner fills these in (see README) ===
const EXTPAY_EXTENSION_ID = 'tubebulk'; // <-- replace with your ExtensionPay extension id
const FREE_VIDEO_LIMIT = 5;             // free tier: videos updated before paywall

var extpay = ExtPay(EXTPAY_EXTENSION_ID);
extpay.startBackground();

const API = 'https://www.googleapis.com/youtube/v3';

// ---------- OAuth token ----------
async function getToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || 'OAuth failed'));
      } else resolve(token);
    });
  });
}

async function apiFetch(path, { method = 'GET', body = null, retry = true } = {}) {
  const token = await getToken(false).catch(() => getToken(true));
  const res = await fetch(API + path, {
    method,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && retry) {
    // Token expired — drop cache and retry once with fresh interactive token
    await new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, r));
    return apiFetch(path, { method, body, retry: false });
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`YouTube API ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

// ---------- Video listing ----------
async function getUploadsPlaylistId() {
  const data = await apiFetch('/channels?part=contentDetails&mine=true');
  const ch = data.items?.[0];
  if (!ch) throw new Error('No YouTube channel found on this Google account.');
  return ch.contentDetails.relatedPlaylists.uploads;
}

async function listAllVideos(onProgress) {
  const playlistId = await getUploadsPlaylistId();
  let pageToken = '';
  const ids = [];
  do {
    const p = await apiFetch(
      `/playlistItems?part=contentDetails&playlistId=${playlistId}&maxResults=50` +
      (pageToken ? `&pageToken=${pageToken}` : '')
    );
    for (const it of p.items || []) ids.push(it.contentDetails.videoId);
    pageToken = p.nextPageToken || '';
    onProgress?.(ids.length);
  } while (pageToken);

  // Fetch snippets in batches of 50
  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const v = await apiFetch(`/videos?part=snippet,status&id=${batch.join(',')}&maxResults=50`);
    for (const item of v.items || []) {
      videos.push({
        id: item.id,
        title: item.snippet.title,
        description: item.snippet.description || '',
        categoryId: item.snippet.categoryId,
        publishedAt: item.snippet.publishedAt,
        privacy: item.status?.privacyStatus || 'unknown',
      });
    }
    onProgress?.(videos.length);
  }
  return videos;
}

// ---------- Bulk update ----------
function applyOperation(description, op) {
  if (op.type === 'replace') {
    if (!op.find) return { changed: false, result: description };
    const result = description.split(op.find).join(op.replace || '');
    return { changed: result !== description, result };
  }
  if (op.type === 'prepend') {
    const block = (op.text || '').trim();
    if (!block || description.startsWith(block)) return { changed: false, result: description };
    return { changed: true, result: block + '\n\n' + description };
  }
  if (op.type === 'append') {
    const block = (op.text || '').trim();
    if (!block || description.endsWith(block)) return { changed: false, result: description };
    return { changed: true, result: description + '\n\n' + block };
  }
  return { changed: false, result: description };
}

async function updateVideoDescription(video, newDescription) {
  // videos.update REPLACES the whole snippet — title & categoryId must be sent back
  await apiFetch('/videos?part=snippet', {
    method: 'PUT',
    body: {
      id: video.id,
      snippet: {
        title: video.title,
        description: newDescription,
        categoryId: video.categoryId,
      },
    },
  });
}

async function bulkUpdate(videos, op, onProgress) {
  const results = { updated: 0, skipped: 0, failed: [] };
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    try {
      const { changed, result } = applyOperation(v.description, op);
      if (!changed) { results.skipped++; }
      else {
        await updateVideoDescription(v, result);
        results.updated++;
        // small delay to stay friendly to quota/rate limits
        await new Promise((r) => setTimeout(r, 350));
      }
    } catch (e) {
      results.failed.push({ id: v.id, title: v.title, error: e.message });
    }
    onProgress?.(i + 1, videos.length);
  }
  return results;
}

// ---------- Paywall helpers ----------
async function getUsage() {
  const s = await chrome.storage.local.get({ tb_free_used: 0, tb_paid: false });
  // ExtensionPay is source of truth for paid status
  try {
    const user = await new Promise((resolve) => {
      const ep = ExtPay(EXTPAY_EXTENSION_ID);
      ep.getUser().then(resolve).catch(() => resolve(null));
    });
    if (user?.paid) s.tb_paid = true;
  } catch (_) { /* offline — fall back to cached flag */ }
  return s;
}

// ---------- Message router ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'BG_LIST_VIDEOS') {
      const videos = await listAllVideos((n) => {
        chrome.runtime.sendMessage({ type: 'BG_PROGRESS', loaded: n }).catch(() => {});
      });
      // cache for the session so popup can re-read without refetching
      await chrome.storage.session.set({ tb_videos: videos });
      return { ok: true, videos };
    }
    if (msg.type === 'BG_PREVIEW') {
      const { tb_videos = [] } = await chrome.storage.session.get('tb_videos');
      const selected = tb_videos.filter((v) => msg.ids.includes(v.id));
      const preview = selected.slice(0, 5).map((v) => {
        const { changed, result } = applyOperation(v.description, msg.op);
        return { id: v.id, title: v.title, changed, before: v.description.slice(0, 220), after: result.slice(0, 220) };
      });
      const changeCount = selected.filter((v) => applyOperation(v.description, msg.op).changed).length;
      return { ok: true, preview, total: selected.length, changeCount };
    }
    if (msg.type === 'BG_APPLY') {
      const usage = await getUsage();
      const { tb_videos = [] } = await chrome.storage.session.get('tb_videos');
      const selected = tb_videos.filter((v) => msg.ids.includes(v.id));
      if (!usage.tb_paid && usage.tb_free_used + selected.length > FREE_VIDEO_LIMIT) {
        return { ok: false, needsPayment: true, freeLeft: Math.max(0, FREE_VIDEO_LIMIT - usage.tb_free_used) };
      }
      const results = await bulkUpdate(selected, msg.op, (done, total) => {
        chrome.runtime.sendMessage({ type: 'BG_PROGRESS', done, total }).catch(() => {});
      });
      if (!usage.tb_paid) {
        await chrome.storage.local.set({ tb_free_used: usage.tb_free_used + results.updated });
      }
      // refresh cached descriptions for updated videos
      const updatedIds = new Set(selected.map((v) => v.id));
      const fresh = tb_videos.map((v) => {
        if (!updatedIds.has(v.id)) return v;
        const { result } = applyOperation(v.description, msg.op);
        return { ...v, description: result };
      });
      await chrome.storage.session.set({ tb_videos: fresh });
      return { ok: true, results };
    }
    if (msg.type === 'BG_GET_USAGE') {
      return { ok: true, usage: await getUsage(), freeLimit: FREE_VIDEO_LIMIT };
    }
    if (msg.type === 'BG_SIGNOUT') {
      const token = await getToken(false).catch(() => null);
      if (token) {
        await new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, r));
        await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`).catch(() => {});
      }
      await chrome.storage.session.remove('tb_videos');
      return { ok: true };
    }
    return { ok: false, error: 'Unknown message' };
  })()
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e.message }));
  return true; // async response
});
