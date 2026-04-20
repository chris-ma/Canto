export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { text } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ error: 'No text provided' });

  try {
    // Google Translate TTS — zh-yue is the Cantonese language code
    const url = new URL('https://translate.googleapis.com/translate_tts');
    url.searchParams.set('ie', 'UTF-8');
    url.searchParams.set('q', text);
    url.searchParams.set('tl', 'zh-yue');
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('ttsspeed', '0.9');

    const upstream = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://translate.google.com/',
      },
    });

    if (!upstream.ok) return res.status(502).json({ error: 'TTS upstream failed' });

    const buffer = await upstream.arrayBuffer();
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(buffer));
  } catch {
    res.status(502).json({ error: 'TTS request failed' });
  }
}
