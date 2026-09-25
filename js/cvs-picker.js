/* =========================================================
   建良鵝肉 官方網站 - 超商門市選擇（結帳頁）
   - 門市清單：data/cvs-711.json、data/cvs-family.json
     由 _tools/update_cvs_stores.py 產生，GitHub Actions 每週自動更新
   - 輸入關鍵字搜尋，或依 縣市 → 鄉鎮市區 → 門市 選擇
   - 選好後自動帶入店名、店號、地址；找不到門市可改手動輸入
   ========================================================= */

const CVS_CHAINS = {
  familymart: {
    label: '全家 FamilyMart',
    file: 'data/cvs-family.json',
    lookup: 'https://www.family.com.tw/Marketing/zh/Map',
    lookupLabel: '全家門市查詢',
    note: '醫院、學校、園區內等特殊門市可能無法收冷凍包裹，如有問題我們會再與您聯繫。',
    manualExample: '例如：全家新竹東園店 / 020814',
  },
  '711': {
    label: '7-11',
    file: 'data/cvs-711.json',
    lookup: 'https://emap.pcsc.com.tw/',
    lookupLabel: '7-11 門市查詢',
    note: '清單只列出有提供「冷凍交貨便」的 7-11 門市。',
    manualExample: '例如：7-11 華國門市 / 238119',
  },
};
const CVS_LAST_KEY = 'jl_last_store_v1';
const CVS_MAX_RESULTS = 30;

const _cvsData = {};

function loadCvsData(chain) {
  if (!_cvsData[chain]) {
    _cvsData[chain] = fetch(CVS_CHAINS[chain].file)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(data => {
        data.stores = [];
        data.cities.forEach(([city, towns]) => towns.forEach(([town, list]) => list.forEach(([id, name, addr, note]) => {
          data.stores.push({ id, name, addr, note: note || '', city, town, key: cvsNorm(id + name + addr) });
        })));
        return data;
      })
      .catch(err => { delete _cvsData[chain]; throw err; });
  }
  return _cvsData[chain];
}

// 搜尋用：全形轉半形、臺→台、去空白、小寫
function cvsNorm(s) {
  return String(s || '')
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/臺/g, '台')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function cvsEsc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 下拉選單裡的地址省略縣市、區，比較好讀
function cvsShortAddr(store) {
  const prefix = store.city + store.town;
  return store.addr.startsWith(prefix) ? store.addr.slice(prefix.length) : store.addr;
}

function createCvsPicker(root) {
  root.innerHTML = `
    <label class="form-label" for="storeSearch">收件門市 <span class="required">*</span></label>
    <div id="storeListMode">
      <div class="store-search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <input type="search" class="form-input" id="storeSearch" autocomplete="off" enterkeyhint="search"
               role="combobox" aria-expanded="false" aria-controls="storeResults" aria-autocomplete="list"
               placeholder="輸入店名、店號或地址搜尋，例如：東園、光復路">
        <ul class="store-results" id="storeResults" role="listbox" hidden></ul>
      </div>
      <div class="store-or">或依地區選擇</div>
      <div class="store-selects">
        <select class="form-select" id="storeCity" aria-label="縣市"></select>
        <select class="form-select" id="storeTown" aria-label="鄉鎮市區"></select>
        <select class="form-select" id="storeSelect" aria-label="門市"></select>
      </div>
      <div class="store-status" id="storeStatus" hidden></div>
      <div class="store-selected" id="storeSelected" hidden></div>
    </div>
    <div id="storeManualMode" hidden>
      <input type="text" class="form-input" id="storeManualInput">
      <div class="form-help">可先到 <a id="storeLookupLink" target="_blank" rel="noopener"></a> 查詢店名與店號。</div>
    </div>
    <div class="form-help store-help">
      <span id="storeNote"></span>
      <button type="button" class="link-btn" id="storeModeToggle"></button>
    </div>
  `;

  const $ = id => root.querySelector('#' + id);
  const els = {
    listMode: $('storeListMode'), manualMode: $('storeManualMode'),
    search: $('storeSearch'), results: $('storeResults'),
    city: $('storeCity'), town: $('storeTown'), store: $('storeSelect'),
    status: $('storeStatus'), selected: $('storeSelected'),
    manualInput: $('storeManualInput'), lookup: $('storeLookupLink'),
    note: $('storeNote'), toggle: $('storeModeToggle'),
  };
  const state = { chain: null, data: null, selected: null, manual: false, results: [], active: -1, loadSeq: 0 };

  /* ---------- 下拉選單 ---------- */
  function fillSelect(sel, placeholder, items) {
    sel.innerHTML = `<option value="">${placeholder}</option>` +
      items.map(([value, text]) => `<option value="${cvsEsc(value)}">${cvsEsc(text)}</option>`).join('');
    sel.disabled = !items.length;
  }
  function townsOf(city) {
    const c = state.data && state.data.cities.find(x => x[0] === city);
    return c ? c[1] : [];
  }
  function storesOf(city, town) {
    return state.data ? state.data.stores.filter(s => s.city === city && s.town === town) : [];
  }
  function fillCities() {
    fillSelect(els.city, '縣市', state.data ? state.data.cities.map(([c]) => [c, c]) : []);
    fillTowns('');
  }
  function fillTowns(city) {
    fillSelect(els.town, '鄉鎮市區', townsOf(city).map(([t]) => [t, t]));
    fillStores('', '');
  }
  function fillStores(city, town) {
    fillSelect(els.store, '選擇門市', storesOf(city, town).map(s => [s.id, `${s.name}｜${cvsShortAddr(s)}`]));
  }
  function syncSelects(store) {
    els.city.value = store.city;
    fillTowns(store.city);
    els.town.value = store.town;
    fillStores(store.city, store.town);
    els.store.value = store.id;
  }

  /* ---------- 已選門市 ---------- */
  function renderSelected() {
    const s = state.selected;
    els.selected.hidden = !s;
    if (!s) { els.selected.innerHTML = ''; return; }
    els.selected.innerHTML = `
      <div class="store-selected-tag">✓ 已選擇門市</div>
      <div class="store-selected-name">${cvsEsc(s.name)}<span class="store-selected-id">店號 ${cvsEsc(s.id)}</span></div>
      <div class="store-selected-addr">${cvsEsc(s.addr)}</div>
      ${s.note ? `<div class="store-selected-note">⚠ 此門市${cvsEsc(s.note)}，請留意取貨時間</div>` : ''}
    `;
  }
  function selectStore(store, { remember = true } = {}) {
    state.selected = store;
    if (store) syncSelects(store);
    renderSelected();
    if (store && remember) {
      try { localStorage.setItem(CVS_LAST_KEY, JSON.stringify({ chain: state.chain, id: store.id })); } catch (e) {}
    }
  }

  /* ---------- 搜尋 ---------- */
  function hideResults() {
    els.results.hidden = true;
    els.search.setAttribute('aria-expanded', 'false');
    state.active = -1;
  }
  function runSearch() {
    const terms = els.search.value.split(/\s+/).map(cvsNorm).filter(Boolean);
    if (!state.data || terms.join('').length < 2) { hideResults(); return; }
    const matches = state.data.stores.filter(s => terms.every(t => s.key.includes(t)));
    const first = terms[0];
    const rank = s => (s.id === first ? 0 : cvsNorm(s.name).includes(first) ? 1 : 2);
    matches.sort((a, b) => rank(a) - rank(b));
    state.results = matches.slice(0, CVS_MAX_RESULTS);
    state.active = -1;
    const more = matches.length - state.results.length;
    els.results.innerHTML = state.results.length
      ? state.results.map((s, i) => `
          <li role="option" id="storeOpt${i}" data-i="${i}">
            <div class="r-name">${cvsEsc(s.name)}<span class="r-id">${cvsEsc(s.id)}</span></div>
            <div class="r-addr">${cvsEsc(s.addr)}</div>
          </li>`).join('') + (more > 0 ? `<li class="r-more" aria-disabled="true">還有 ${more} 間門市，請輸入更完整的關鍵字</li>` : '')
      : `<li class="r-more" aria-disabled="true">找不到符合的門市，換個關鍵字試試，或改用下方地區選擇</li>`;
    els.results.hidden = false;
    els.search.setAttribute('aria-expanded', 'true');
  }
  function setActive(i) {
    const items = els.results.querySelectorAll('li[data-i]');
    if (!items.length) return;
    state.active = (i + items.length) % items.length;
    items.forEach((li, k) => li.classList.toggle('active', k === state.active));
    items[state.active].scrollIntoView({ block: 'nearest' });
    els.search.setAttribute('aria-activedescendant', items[state.active].id);
  }
  function pickResult(i) {
    const s = state.results[i];
    if (!s) return;
    selectStore(s);
    els.search.value = '';
    hideResults();
  }

  let searchTimer = null;
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 120);
  });
  els.search.addEventListener('focus', () => { if (els.search.value.trim()) runSearch(); });
  els.search.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (els.results.hidden) runSearch(); setActive(state.active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(state.active - 1); }
    else if (e.key === 'Enter') {
      e.preventDefault(); // 避免送出整張表單
      if (!els.results.hidden) pickResult(state.active >= 0 ? state.active : 0);
    }
    else if (e.key === 'Escape') hideResults();
  });
  // mousedown：在輸入框失焦前就選取
  els.results.addEventListener('mousedown', e => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    e.preventDefault();
    pickResult(Number(li.dataset.i));
  });
  document.addEventListener('click', e => {
    if (!root.querySelector('.store-search').contains(e.target)) hideResults();
  });

  /* ---------- 下拉選單事件 ---------- */
  els.city.addEventListener('change', () => { fillTowns(els.city.value); selectStore(null); });
  els.town.addEventListener('change', () => { fillStores(els.city.value, els.town.value); selectStore(null); });
  els.store.addEventListener('change', () => {
    const s = state.data && state.data.stores.find(x => x.id === els.store.value);
    selectStore(s || null);
  });

  /* ---------- 手動輸入 ---------- */
  function setManual(on, { focus = true } = {}) {
    state.manual = on;
    els.listMode.hidden = on;
    els.manualMode.hidden = !on;
    els.toggle.textContent = on ? '改回從門市清單選擇' : '找不到門市？改為手動輸入';
    if (on && focus) els.manualInput.focus();
  }
  els.toggle.addEventListener('click', () => setManual(!state.manual));

  function setStatus(msg) {
    els.status.hidden = !msg;
    els.status.textContent = msg || '';
  }

  /* ---------- 對外 API ---------- */
  async function setChain(chain) {
    const cfg = CVS_CHAINS[chain];
    state.chain = chain;
    state.data = null;
    selectStore(null, { remember: false });
    els.search.value = '';
    hideResults();
    fillCities();
    els.manualInput.placeholder = cfg.manualExample;
    els.lookup.href = cfg.lookup;
    els.lookup.textContent = cfg.lookupLabel;
    els.note.textContent = cfg.note;
    setStatus('門市清單載入中…');

    const seq = ++state.loadSeq;
    try {
      const data = await loadCvsData(chain);
      if (seq !== state.loadSeq) return; // 載入途中又切換了超商
      state.data = data;
      setStatus('');
      fillCities();
      els.note.textContent = `${cfg.note}（門市清單更新：${data.updated.replace(/-/g, '/')}）`;
      try {
        const last = JSON.parse(localStorage.getItem(CVS_LAST_KEY) || 'null');
        const s = last && last.chain === chain && data.stores.find(x => x.id === last.id);
        if (s) selectStore(s, { remember: false });
      } catch (e) {}
    } catch (err) {
      if (seq !== state.loadSeq) return;
      console.warn('門市清單載入失敗', err);
      setStatus('門市清單暫時無法載入，請改為手動輸入門市。');
      setManual(true, { focus: false });
    }
  }

  function getValue() {
    if (state.manual) {
      const text = els.manualInput.value.trim();
      return text ? { text } : null;
    }
    return state.selected ? { store: state.selected } : null;
  }

  function focus() {
    root.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (state.manual ? els.manualInput : els.search).focus({ preventScroll: true });
  }

  setManual(false, { focus: false });
  return { setChain, getValue, focus };
}
