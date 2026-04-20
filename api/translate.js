export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, direction = 'to-english' } = req.body || {};
  if (!text?.trim()) return res.json({ translation: '' });

  const langpair = direction === 'to-cantonese' ? 'en|zh-TW' : 'zh|en';

  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langpair}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.responseStatus === 200) {
      res.json({ translation: data.responseData.translatedText });
    } else {
      res.status(502).json({ error: 'Translation service unavailable', translation: '' });
    }
  } catch (err) {
    res.status(502).json({ error: 'Translation failed', translation: '' });
  }
}
