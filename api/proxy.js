const { execSync } = require('child_process');

module.exports = async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) {
    return res.status(400).send('Parameter url diperlukan');
  }

  try {
    // Ambil gambar via curl dengan referer BatCave
    const buffer = execSync(
      `curl -s -L -H "Referer: https://batcave.biz/" -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" "${imageUrl}"`,
      { maxBuffer: 15 * 1024 * 1024 }
    );

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    return res.send(buffer);
  } catch (err) {
    return res.status(500).send('Gagal memuat gambar');
  }
};
