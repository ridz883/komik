const cheerio = require('cheerio');
const { execSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const os = require('os');

const BASE_URL = 'https://batcave.biz';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const COOKIE_FILE = path.join(os.tmpdir(), 'batcave_cookies.txt');

function decodeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function extractJsonObject(str, startIndex = 0) {
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;

  for (let i = startIndex; i < str.length; i++) {
    const ch = str[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          return str.slice(start, i + 1);
        }
      }
    }
  }
  return null;
}

function solveDleGuardChallenge(html, refererUrl = `${BASE_URL}/`) {
  const tokenMatch = html.match(/token:\s*["\x27]([^"\x27]+)["\x27]/);
  if (!tokenMatch) return false;

  const token = tokenMatch[1];
  let nonce = 0;
  let powHash = '';
  const start = Date.now();

  while (true) {
    const hash = crypto.createHash('sha256').update(token + ':' + nonce).digest('hex');
    if (hash.startsWith('00')) {
      powHash = hash;
      break;
    }
    nonce++;
  }

  const workTime = Math.max(20, Date.now() - start);

  const postBody = [
    'token=' + encodeURIComponent(token),
    'mode=modern',
    'workTime=' + encodeURIComponent(workTime),
    'iterations=' + encodeURIComponent(nonce + 1),
    'hasCrypto=1',
    'pow_nonce=' + encodeURIComponent(nonce),
    'pow_hash=' + encodeURIComponent(powHash),
    'webdriver=0',
    'touch=0',
    'screen_w=1920',
    'screen_h=1080',
    'screen_cd=24',
    'tz=-420',
    'dpr=1',
    'cdp=0',
    'cdpf='
  ].join('&');

  try {
    execSync(`curl -s -c "${COOKIE_FILE}" -b "${COOKIE_FILE}" -X POST "${BASE_URL}/_v" \
      -H "Content-Type: application/x-www-form-urlencoded" \
      -H "Referer: ${BASE_URL}/_c?t=${encodeURIComponent(token)}&u=${encodeURIComponent(refererUrl)}" \
      -H "Origin: ${BASE_URL}" \
      -A "${USER_AGENT}" \
      -d "${postBody}"`, { timeout: 15000 });
    return true;
  } catch (e) {
    return false;
  }
}

function requestBatCave(targetUrl, options = {}) {
  const method = options.method || 'GET';
  const postData = options.data || null;
  const isJson = options.isJson || false;

  const buildCmd = () => {
    let dataFlag = '';
    if (postData) {
      if (typeof postData === 'object') {
        const jsonStr = JSON.stringify(postData).replace(/'/g, `'\\''`);
        dataFlag = `-d '${jsonStr}'`;
      } else {
        dataFlag = `-d "${postData.replace(/"/g, '\\"')}"`;
      }
    }

    let headerFlags = ` -H "Referer: ${BASE_URL}/" -H "Accept: text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8" `;
    if (isJson) {
      headerFlags += ` -H "Content-Type: application/json" -H "X-Requested-With: XMLHttpRequest" `;
    } else if (method === 'POST') {
      headerFlags += ` -H "Content-Type: application/x-www-form-urlencoded" `;
    }

    return `curl -s -L -c "${COOKIE_FILE}" -b "${COOKIE_FILE}" -X ${method} \
      -A "${USER_AGENT}" \
      ${headerFlags} \
      ${dataFlag} \
      "${targetUrl}"`;
  };

  let response = '';
  try {
    response = execSync(buildCmd(), { timeout: 20000, maxBuffer: 20 * 1024 * 1024 }).toString();
  } catch (err) {
    throw new Error(`Gagal menghubungi server BatCave: ${err.message}`);
  }

  if (response.includes('p.token') || response.includes('/_c?t=')) {
    const solved = solveDleGuardChallenge(response, targetUrl);
    if (solved) {
      try {
        response = execSync(buildCmd(), { timeout: 20000, maxBuffer: 20 * 1024 * 1024 }).toString();
      } catch (err2) {
        throw new Error(`Gagal memuat ulang halaman setelah bypass: ${err2.message}`);
      }
    }
  }

  return response;
}

async function getChapterImages(newsId, chapterId) {
  const apiUrl = `${BASE_URL}/engine/ajax/controller.php?mod=api&action=reader/getChapterData`;
  const payload = {
    news_id: isNaN(newsId) ? newsId : Number(newsId),
    chapter_id: isNaN(chapterId) ? chapterId : Number(chapterId)
  };

  const raw = requestBatCave(apiUrl, {
    method: 'POST',
    data: payload,
    isJson: true
  });

  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.success && parsed.data && Array.isArray(parsed.data.images)) {
      return {
        title: decodeHtml(parsed.data.title || ''),
        chapter_id: parsed.data.chapter_id || chapterId,
        pages: parsed.data.images.map((img, idx) => ({
          page: idx + 1,
          image_url: img.startsWith('http') ? img.trim() : `${BASE_URL}${img.trim()}`
        }))
      };
    } else if (parsed && parsed.error) {
      throw new Error(`BatCave Reader Error: ${parsed.error}`);
    }
  } catch (err) {
    throw new Error(`Gagal memproses data gambar chapter: ${err.message}`);
  }

  throw new Error('Daftar gambar chapter tidak ditemukan.');
}

module.exports = async (req, res) => {
  // Support CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const q = req.query || {};
  const action = String(q.action || 'latest').trim().toLowerCase();
  const query = String(q.query || '').trim();
  const comicUrl = String(q.url || '').trim();
  const newsId = String(q.newsId || q.news_id || '').trim();
  const chapterId = String(q.chapterId || q.chapter_id || '').trim();
  const page = parseInt(q.page || '1', 10) || 1;

  try {
    // 1. LATEST
    if (action === 'latest') {
      const target = page > 1 ? `${BASE_URL}/comix/page/${page}/` : `${BASE_URL}/comix/`;
      const html = requestBatCave(target);
      const $ = cheerio.load(html);

      const items = [];
      $('.readed, #content-load > .latest.grid-item').each((_, el) => {
        const titleEl = $(el).find('.readed__title > a, .latest__title > a');
        const imgEl = $(el).find('.readed__img img, .latest__img img');
        const title = decodeHtml(titleEl.text());
        let link = titleEl.attr('href') || '';
        if (link && !link.startsWith('http')) link = `${BASE_URL}${link}`;

        let thumbnail = imgEl.attr('data-src') || imgEl.attr('src') || '';
        if (thumbnail && !thumbnail.startsWith('http')) thumbnail = `${BASE_URL}${thumbnail}`;

        if (title && link) {
          items.push({ title, url: link, thumbnail });
        }
      });

      return res.json({
        status: true,
        result: { page, total: items.length, comics: items }
      });
    }

    // 2. SEARCH
    if (action === 'search') {
      if (!query) {
        return res.status(400).json({ status: false, message: 'Parameter query diperlukan' });
      }

      const searchUrl = page > 1
        ? `${BASE_URL}/search/${encodeURIComponent(query)}/page/${page}/`
        : `${BASE_URL}/search/${encodeURIComponent(query)}`;

      const html = requestBatCave(searchUrl);
      const $ = cheerio.load(html);
      const results = [];

      $('.readed, #content-load > .latest.grid-item').each((_, el) => {
        const titleEl = $(el).find('.readed__title > a, .latest__title > a');
        const imgEl = $(el).find('.readed__img img, .latest__img img');
        const title = decodeHtml(titleEl.text());
        let link = titleEl.attr('href') || '';
        if (link && !link.startsWith('http')) link = `${BASE_URL}${link}`;

        let thumbnail = imgEl.attr('data-src') || imgEl.attr('src') || '';
        if (thumbnail && !thumbnail.startsWith('http')) thumbnail = `${BASE_URL}${thumbnail}`;

        if (title && link) {
          results.push({ title, url: link, thumbnail });
        }
      });

      return res.json({
        status: true,
        result: { query, page, total: results.length, comics: results }
      });
    }

    // 3. DETAIL
    if (action === 'detail') {
      if (!comicUrl) {
        return res.status(400).json({ status: false, message: 'Parameter url komik diperlukan' });
      }

      const fullUrl = comicUrl.startsWith('http') ? comicUrl : `${BASE_URL}/${comicUrl.replace(/^\//, '')}`;
      const html = requestBatCave(fullUrl);
      const $ = cheerio.load(html);

      const title = decodeHtml($('header.page__header h1').text() || $('title').text());
      let thumbnail = $('div.page__poster img').attr('src') || $('div.page__poster img').attr('data-src') || '';
      if (thumbnail && !thumbnail.startsWith('http')) thumbnail = `${BASE_URL}${thumbnail}`;

      const getInfo = (label) => {
        const el = $(`.page__list > li:has(> div:contains("${label}"))`);
        const text = el.find('> a').text() || el.text().replace(label, '').replace(':', '');
        return decodeHtml(text) || null;
      };

      const writer = getInfo('Writer');
      const artist = getInfo('Artist');
      const publisher = getInfo('Publisher');
      const year = getInfo('Year');
      const releaseType = getInfo('Release type');

      const genres = [];
      $('div.page__tags a').each((_, el) => {
        const tag = decodeHtml($(el).text());
        if (tag) genres.push(tag);
      });

      const description = decodeHtml($('div.page__text').text());

      let comicId = null;
      let chapters = [];

      $('script').each((_, el) => {
        const scriptContent = $(el).html() || '';
        const dataIndex = scriptContent.indexOf('window.__DATA__');
        if (dataIndex !== -1) {
          const jsonString = extractJsonObject(scriptContent, dataIndex);
          if (jsonString) {
            try {
              const parsed = JSON.parse(jsonString);
              comicId = parsed.news_id || parsed.comicId;
              if (Array.isArray(parsed.chapters)) {
                chapters = parsed.chapters.map((c) => ({
                  chapter_id: c.id,
                  chapter_number: c.posi || c.number,
                  pages_count: c.pages || 0,
                  title: decodeHtml(c.title || `Chapter ${c.posi || c.number}`),
                  date: c.date || '',
                  read_url: `${BASE_URL}/reader/${comicId}/${c.id}`
                }));
              }
            } catch (e) {}
          }
        }
      });

      if (!comicId) {
        const idMatch = fullUrl.match(/\/(\d+)-/);
        if (idMatch) comicId = idMatch[1];
      }

      return res.json({
        status: true,
        result: {
          comic_id: comicId,
          title,
          thumbnail,
          writer,
          artist,
          publisher,
          year,
          status: releaseType,
          genres,
          description,
          total_chapters: chapters.length,
          chapters
        }
      });
    }

    // 4. READ
    if (action === 'read') {
      let targetNewsId = newsId;
      let targetChapterId = chapterId;

      if ((!targetNewsId || !targetChapterId) && comicUrl) {
        const match = comicUrl.match(/reader\/(\d+)\/(\d+)/);
        if (match) {
          targetNewsId = match[1];
          targetChapterId = match[2];
        }
      }

      if (!targetNewsId || !targetChapterId) {
        return res.status(400).json({
          status: false,
          message: 'Parameter newsId & chapterId diperlukan'
        });
      }

      const chapterData = await getChapterImages(targetNewsId, targetChapterId);

      return res.json({
        status: true,
        result: {
          comic_id: targetNewsId,
          chapter_id: chapterData.chapter_id,
          chapter_title: chapterData.title,
          total_pages: chapterData.pages.length,
          pages: chapterData.pages
        }
      });
    }

    return res.status(400).json({ status: false, message: `Aksi '${action}' tidak dikenali` });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
};
