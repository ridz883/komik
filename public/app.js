let currentPage = 1;
let currentAction = 'latest';
let currentQuery = '';
let currentComic = null;

// Helper untuk membungkus gambar lewat proxy
function getProxiedImage(url) {
  if (!url) return '';
  return `/api/proxy?url=${encodeURIComponent(url)}`;
}

function showLoader(show) {
  document.getElementById('loader').style.display = show ? 'block' : 'none';
}

function navigateHome() {
  currentAction = 'latest';
  currentPage = 1;
  currentQuery = '';
  document.getElementById('searchInput').value = '';
  document.getElementById('sectionTitle').innerText = 'Komik Terbaru';
  document.getElementById('catalogView').style.display = 'block';
  document.getElementById('detailView').style.display = 'none';
  document.getElementById('readerView').style.display = 'none';
  loadCatalog();
}

async function loadCatalog() {
  showLoader(true);
  const grid = document.getElementById('comicGrid');
  grid.innerHTML = '';

  let endpoint = `/api?action=${currentAction}&page=${currentPage}`;
  if (currentAction === 'search') {
    endpoint += `&query=${encodeURIComponent(currentQuery)}`;
  }

  try {
    const res = await fetch(endpoint);
    const data = await res.json();

    if (data.status && data.result.comics.length > 0) {
      data.result.comics.forEach((c) => {
        const card = document.createElement('div');
        card.className = 'comic-card';
        card.onclick = () => loadDetail(c.url);
        card.innerHTML = `
          <img src="${getProxiedImage(c.thumbnail)}" alt="${c.title}" loading="lazy">
          <div class="card-title">${c.title}</div>
        `;
        grid.appendChild(card);
      });
    } else {
      grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center;">Tidak ada komik ditemukan.</p>';
    }

    document.getElementById('pageIndicator').innerText = `Halaman ${currentPage}`;
    document.getElementById('prevBtn').disabled = currentPage <= 1;
  } catch (err) {
    alert('Gagal memuat katalog: ' + err.message);
  } finally {
    showLoader(false);
  }
}

function changePage(delta) {
  currentPage += delta;
  loadCatalog();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleSearch(e) {
  e.preventDefault();
  const query = document.getElementById('searchInput').value.trim();
  if (!query) return;

  currentAction = 'search';
  currentQuery = query;
  currentPage = 1;

  document.getElementById('sectionTitle').innerText = `Hasil Pencarian: "${query}"`;
  document.getElementById('catalogView').style.display = 'block';
  document.getElementById('detailView').style.display = 'none';
  document.getElementById('readerView').style.display = 'none';
  loadCatalog();
}

async function loadDetail(url) {
  showLoader(true);
  try {
    const res = await fetch(`/api?action=detail&url=${encodeURIComponent(url)}`);
    const data = await res.json();

    if (!data.status) throw new Error(data.message);

    currentComic = data.result;

    document.getElementById('catalogView').style.display = 'none';
    document.getElementById('readerView').style.display = 'none';
    document.getElementById('detailView').style.display = 'block';

    document.getElementById('detailImg').src = getProxiedImage(currentComic.thumbnail);
    document.getElementById('detailTitle').innerText = currentComic.title;
    document.getElementById('detailDesc').innerText = currentComic.description || 'Tidak ada sinopsis.';

    // Tags
    const tagsContainer = document.getElementById('detailTags');
    tagsContainer.innerHTML = (currentComic.genres || []).map((g) => `<span>${g}</span>`).join('');

    // Meta
    document.getElementById('detailMeta').innerHTML = `
      <p><strong>Writer:</strong> ${currentComic.writer || '-'}</p>
      <p><strong>Artist:</strong> ${currentComic.artist || '-'}</p>
      <p><strong>Publisher:</strong> ${currentComic.publisher || '-'}</p>
      <p><strong>Year:</strong> ${currentComic.year || '-'}</p>
    `;

    // Chapters
    const chapterList = document.getElementById('chapterList');
    chapterList.innerHTML = '';

    if (currentComic.chapters && currentComic.chapters.length > 0) {
      currentComic.chapters.forEach((ch) => {
        const btn = document.createElement('div');
        btn.className = 'chapter-btn';
        btn.onclick = () => readChapter(currentComic.comic_id, ch.chapter_id, ch.title);
        btn.innerHTML = `
          <span>${ch.title}</span>
          <span style="color: #8b949e; font-size: 0.8rem;">${ch.pages_count} Hal</span>
        `;
        chapterList.appendChild(btn);
      });
    } else {
      chapterList.innerHTML = '<p style="grid-column: 1/-1;">Belum ada chapter yang diunggah.</p>';
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    alert('Gagal memuat detail komik: ' + err.message);
  } finally {
    showLoader(false);
  }
}

async function readChapter(newsId, chapterId, title) {
  showLoader(true);
  try {
    const res = await fetch(`/api?action=read&newsId=${newsId}&chapterId=${chapterId}`);
    const data = await res.json();

    if (!data.status) throw new Error(data.message);

    document.getElementById('detailView').style.display = 'none';
    document.getElementById('readerView').style.display = 'block';
    document.getElementById('readerChapterTitle').innerText = title;

    const pagesContainer = document.getElementById('readerPages');
    pagesContainer.innerHTML = '';

    data.result.pages.forEach((page) => {
      const img = document.createElement('img');
      img.src = getProxiedImage(page.image_url);
      img.loading = 'lazy';
      pagesContainer.appendChild(img);
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    alert('Gagal memuat isi chapter: ' + err.message);
  } finally {
    showLoader(false);
  }
}

function closeReader() {
  document.getElementById('readerView').style.display = 'none';
  document.getElementById('detailView').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Inisialisasi awal
loadCatalog();
