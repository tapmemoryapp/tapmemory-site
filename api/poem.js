// Timeline to Verse — POST /api/poem
// Looks up an X handle, reads its recent posts and replies, and asks Claude for a poem.
//
// Environment variables (set in Vercel → Project → Settings → Environment Variables):
//   X_BEARER_TOKEN     App-only bearer token from the X Developer Console (pay-per-use credits)
//   ANTHROPIC_API_KEY  Claude API key from console.anthropic.com
//   ANTHROPIC_MODEL    optional, defaults to claude-sonnet-5-5
//   POEMS_PER_IP_HOUR  optional, defaults to 5
//   POEMS_PER_DAY      optional, defaults to 200 (rough guard; counted per server instance)

const FORMS = {
  'free verse': 'free verse',
  'sonnet': 'a Shakespearean sonnet (14 lines, iambic pentameter, ABAB CDCD EFEF GG)',
  'haiku': 'a sequence of five haiku (5-7-5)',
  'limerick': 'two limericks (AABBA)',
  'rap': 'a 16-bar rap verse with internal rhyme',
  'ode': 'an ode',
  'ballad': 'a ballad in quatrains',
};
const MOODS = {
  tender: 'honest and a little tender',
  roast: 'funny and gently roasting — affectionate, never cruel',
  epic: 'epic and mythic, as if the timeline were a saga',
  latenight: 'melancholy and late-night',
  hype: 'hype and triumphant',
};

const CACHE_MS = 60 * 60 * 1000;      // reuse X results for an hour so repeat poems cost nothing
const cache = new Map();               // handle -> { at, user, posts, replies }
const ipHits = new Map();              // ip -> [timestamps]
let day = { key: '', count: 0 };

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function clean(text) {
  return (text || '')
    .replace(/https?:\/\/t\.co\/\S+/g, '')
    .replace(/^(@\w+\s*)+/, '')          // leading @mentions on replies
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function x(path) {
  const r = await fetch('https://api.x.com/2' + path, {
    headers: { Authorization: 'Bearer ' + process.env.X_BEARER_TOKEN },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error('x_' + r.status);
    err.status = r.status; err.body = body;
    throw err;
  }
  return body;
}

async function loadTimeline(handle) {
  const key = handle.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;

  const u = await x(`/users/by/username/${encodeURIComponent(handle)}?user.fields=name,description,protected,public_metrics`);
  if (!u.data) { const e = new Error('not_found'); e.code = 'not_found'; throw e; }
  if (u.data.protected) { const e = new Error('protected'); e.code = 'protected'; throw e; }

  const t = await x(`/users/${u.data.id}/tweets?max_results=100&exclude=retweets&tweet.fields=public_metrics,created_at,in_reply_to_user_id`);
  const posts = [], replies = [];
  for (const tw of t.data || []) {
    const text = clean(tw.text);
    if (!text) continue;
    const m = tw.public_metrics || {};
    const item = { text, likes: m.like_count || 0, replies: m.reply_count || 0, reposts: m.retweet_count || 0, at: tw.created_at };
    (tw.in_reply_to_user_id && tw.in_reply_to_user_id !== u.data.id ? replies : posts).push(item);
  }
  const entry = { at: Date.now(), user: u.data, posts, replies };
  cache.set(key, entry);
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return entry;
}

function limited(ip) {
  const perIp = +process.env.POEMS_PER_IP_HOUR || 5;
  const perDay = +process.env.POEMS_PER_DAY || 200;
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  if (day.key !== today) day = { key: today, count: 0 };
  if (day.count >= perDay) return 'The poem machine is resting for today. Come back tomorrow.';
  const hits = (ipHits.get(ip) || []).filter(t => now - t < 3600e3);
  if (hits.length >= perIp) return 'That’s a lot of poems! Try again in a little while.';
  hits.push(now); ipHits.set(ip, hits); day.count++;
  return null;
}

function buildPrompt({ user, posts, replies }, form, mood, pick) {
  const sortTop = (a, b) => (b.likes + b.replies * 2 + b.reposts * 2) - (a.likes + a.replies * 2 + a.reposts * 2);
  const p = (pick === 'recent' ? posts : posts.slice().sort(sortTop)).slice(0, 40);
  const r = replies.slice(0, 20);
  const trim = s => s.length > 280 ? s.slice(0, 277) + '…' : s;
  const totalLikes = posts.reduce((s, q) => s + q.likes, 0);

  return `You are a poet. Below is a sample of one person's public activity on X (formerly Twitter). Write ONE original poem about the person behind this timeline.

Form: ${form}
Mood: ${mood}

Guidelines:
- Find the recurring themes, obsessions, voice and contradictions. The poem is about the person, not a list of their posts.
- You may echo one or two short, memorable phrases from their posts, but mostly transform rather than quote.
- Treat the posts with the most likes and replies as the moments the crowd answered back; the replies show who they are in conversation.
- No @handles, no links, nothing that looks like private personal information.
- Respect the form's structure (rhyme, meter, line counts).

Output format: the first line is a short title prefixed with "# ", then a blank line, then the poem. Nothing else.

Display name: ${user.name}
Bio: ${clean(user.description) || '(none)'}
Followers: ${user.public_metrics?.followers_count ?? 'unknown'}

THEIR POSTS (${posts.length} recent, ${totalLikes.toLocaleString('en-US')} likes between them; [likes / comments] in brackets):
${p.map(q => `- [${q.likes} likes / ${q.replies} comments] ${trim(q.text)}`).join('\n') || '(none)'}

THEIR REPLIES TO OTHERS:
${r.map(q => `- ${trim(q.text)}`).join('\n') || '(none)'}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
  if (!process.env.X_BEARER_TOKEN || !process.env.ANTHROPIC_API_KEY)
    return json(res, 500, { error: 'The poem machine isn’t set up yet (missing API keys).' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const handle = String(body.handle || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '').split(/[/?#]/)[0];
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return json(res, 400, { error: 'That doesn’t look like an X handle.' });
  const form = FORMS[body.form] || FORMS['free verse'];
  const mood = MOODS[body.mood] || MOODS.tender;
  const pick = body.pick === 'recent' ? 'recent' : 'top';

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const wait = limited(ip);
  if (wait) return json(res, 429, { error: wait });

  let tl;
  try {
    tl = await loadTimeline(handle);
  } catch (e) {
    if (e.code === 'not_found' || e.status === 404) return json(res, 404, { error: `Couldn’t find @${handle} on X.` });
    if (e.code === 'protected') return json(res, 403, { error: `@${handle} is a private account, so its posts can’t be read.` });
    if (e.status === 429) return json(res, 429, { error: 'X is busy right now. Try again in a few minutes.' });
    if (e.status === 402 || e.status === 403) {
      console.error('X API refused', e.status, JSON.stringify(e.body));
      return json(res, 503, { error: 'The poem machine is out of X credits. Check back soon.' });
    }
    console.error('X API error', e.status, JSON.stringify(e.body || e.message));
    return json(res, 502, { error: 'Couldn’t reach X. Try again.' });
  }
  if (!tl.posts.length && !tl.replies.length)
    return json(res, 404, { error: `@${handle} hasn’t posted anything recently to write about.` });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
        max_tokens: 1200,
        messages: [{ role: 'user', content: buildPrompt(tl, form, mood, pick) }],
      }),
    });
    const out = await r.json();
    if (!r.ok) {
      console.error('Claude API error', r.status, JSON.stringify(out));
      return json(res, 502, { error: 'The poet is busy. Try again in a moment.' });
    }
    const text = (out.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
    const m = text.match(/^\s*#\s*(.+)\n?/);
    return json(res, 200, {
      handle: handle,
      name: tl.user.name,
      title: m ? m[1].trim() : '',
      poem: (m ? text.slice(m[0].length) : text).replace(/^\n+/, ''),
      used: { posts: Math.min(tl.posts.length, 40), replies: Math.min(tl.replies.length, 20) },
    });
  } catch (e) {
    console.error('Claude call failed', e);
    return json(res, 502, { error: 'The poet is busy. Try again in a moment.' });
  }
};
