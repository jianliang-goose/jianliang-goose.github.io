/* =========================================================
   建良鵝肉 官方網站 - 後台（admin.html）
   - 訂單、商品、設定都存在 Google 試算表，透過 Apps Script 後端讀寫
   - 登入密碼 = Apps Script「指令碼屬性」裡的 ADMIN_KEY
   - 需要後端 API 版本 2（網站後端 Code.gs）
   ========================================================= */

// GAS_API_URL 定義在 shop.js（測試時可用 localStorage.jl_dev_api 改連模擬後端）
const ADMIN_API = GAS_API_URL;
const ADMIN_KEY_STORE = 'jl_admin_key';
const ORDER_STATUSES = ['待處理', '已出貨', '完成待取', '已完成', '已取消'];
const VERIFIED_MARK = '已對帳';
const PRODUCT_CATEGORIES = { main: '主餐', addon: '加購', snack: '小菜 / 零嘴', sauce: '醬料', other: '其他' };
const SETTING_DEFAULTS = {
  is_open: 'true', closed_message: '', announcement: '',
  shipping_fee: '120', shipping_threshold: '3000',
  bank_name: '凱基銀行', bank_code: '809', bank_account: '0005-95-3239840-6', bank_holder: '林宛儒',
  jko_qr: 'images/pay-jkopay.jpg', linepay_qr: '',
};
// 後台第一次開啟時，沿用網站上原本的消息
const DEFAULT_NEWS = [
  { date: '2026-02-01', tag: '限時團購', title: '2 月限時開團・茶香鵝肉滿額免運', body: '本期團購已開放預訂，至 2/9 截止接單。單筆滿 NT$3,000 享免運費，兩盒以上 1/4 茶香鵝肉可加購肉燥包優惠價。' },
  { date: '2026-01-20', tag: '官網上線', title: '建良鵝肉官方網站正式上線！', body: '歷經四十年的累積，我們把店面從新竹光復路推到了網路上。即日起您可以在官網直接下單，超商冷凍宅配到家。歡迎舊雨新知支持指教！' },
  { date: '2025-12-28', tag: '公告', title: '過年休業通知', body: '本店將於 2/8（除夕）至 2/12（初五）休業，2/13（初六）恢復正常營業。年前最後一波出貨日為 2/6，請欲訂購過年用茶鵝的客人提早下單，以免向隅。' },
  { date: '2025-12-10', tag: '節慶禮盒', title: '農曆新年禮盒接單中', body: '過年送禮，送份體面又實用的茶香鵝肉禮盒最對味。本期推出「拜拜整隻茶鵝 + 鵝腳鵝舌」雙人組合，限量 200 組，送禮自用兩相宜。' },
  { date: '2025-11-15', tag: '媒體報導', title: '建良鵝肉獲在地美食媒體推薦', body: '感謝在地美食媒體報導我們的茶香鵝肉與煙燻工法。四十年的堅持被看見，是我們最大的鼓勵。我們會持續用心做每一隻鵝。' },
  { date: '2025-10-05', tag: '營業時間', title: '週一固定公休', body: '店家週一固定公休，方便師傅進貨備料。週二至週日 11:00 ~ 20:00 正常營業，歡迎來店品嚐。' },
];
const SITE_UPDATE_NOTE = '網站約 5 分鐘內更新';

const A = {
  key: '', orders: [], products: [], settings: {},
  tab: 'orders', orderFilter: 'todo', orderQuery: '',
  customerQuery: '', customerSort: 'recent', openCustomer: null,
  loadedAt: null,
};

/* ---------- 小工具 ---------- */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const digits = s => String(s ?? '').replace(/\D/g, '');
const pad = n => String(n).padStart(2, '0');
const fmtTime = d => d ? `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
const fmtDay = d => d ? `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}` : '';
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isHidden = p => /^(y|yes|true|1|是)$/i.test(String(p.Hidden ?? '').trim());
const isOpen = v => !/^(false|0|no|否)$/i.test(String(v ?? 'true').trim());
// 試算表裡還沒有這個設定時才用預設值；刻意清空的（例如移除收款碼）就維持空白
const setting = k => {
  const v = A.settings[k];
  return v === undefined || v === null ? SETTING_DEFAULTS[k] ?? '' : String(v);
};
const telHref = phone => 'tel:' + digits(phone);
const fmtPhone = p => { const d = digits(p); return d.length === 10 ? `${d.slice(0, 4)}-${d.slice(4, 7)}-${d.slice(7)}` : p; };

function splitItems(items) {
  return String(items || '').split(/[,，]\s*/).filter(Boolean).map(s => {
    const m = s.match(/^(.+?)\s*[xX×]\s*(\d+)$/);
    return m ? { name: m[1].trim(), qty: Number(m[2]) } : { name: s.trim(), qty: null };
  });
}

function translateError(msg) {
  const map = {
    'Unauthorized': '密碼不正確',
    'Unknown action': '後端還沒更新到新版（請到 Apps Script 貼上新版程式並重新部署）',
    'Refusing to save an empty product list': '至少要保留一項商品',
    'Image too large': '照片檔案太大，請換一張較小的照片',
    'No image data': '沒有讀到照片，請再選一次',
  };
  return map[msg] || msg || '發生錯誤，請稍後再試';
}

/* ---------- 後端 ---------- */

async function api(action, payload = {}) {
  let res;
  try {
    res = await fetch(ADMIN_API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...payload, action, key: A.key }),
    });
  } catch (e) {
    throw new Error('連線失敗，請確認網路後再試一次');
  }
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('伺服器回應異常，請稍後再試'); }
  if (data && data.result === 'error') {
    const err = new Error(translateError(data.error));
    err.code = data.error;
    throw err;
  }
  return data;
}

function normalizeOrder(o) {
  const t = o.Timestamp ? new Date(o.Timestamp) : null;
  const money = v => Number(String(v ?? 0).replace(/[$,\s]/g, '')) || 0;
  return {
    id: String(o.Order_ID ?? '').trim(),
    time: t && !isNaN(t) ? t : null,
    name: String(o.Name ?? ''),
    phone: String(o.Phone ?? '').replace(/^'/, ''),
    items: String(o.Items ?? ''),
    total: money(o.Total_Amount),
    shipping: money(o.Shipping_Fee),
    grand: money(o.Grand_Total) || money(o.Total_Amount),
    payMethod: String(o.Payment_Method ?? ''),
    payInfo: String(o.Payment_Info ?? ''),
    delivery: String(o.Delivery_Method ?? ''),
    store: String(o.Store_Info ?? ''),
    pickup: String(o.Pickup_Time ?? ''),
    status: String(o.Status || '待處理'),
    verified: String(o.Payment_Verified ?? '') === VERIFIED_MARK || String(o.Note ?? '').includes('[已對帳]'),
    note: String(o.Note ?? ''),
    customerNote: String(o.Customer_Note ?? ''),
  };
}

async function loadAll() {
  const d = await api('getAdminData');
  A.orders = (d.orders || []).map(normalizeOrder).filter(o => o.id)
    .sort((a, b) => (b.time?.getTime() || 0) - (a.time?.getTime() || 0));
  A.products = (d.products || []).filter(p => String(p.ID ?? '').trim() || String(p.Name ?? '').trim());
  A.settings = d.settings || {};
  A.loadedAt = new Date();
}

/* ---------- 讀取中遮罩 ---------- */

function setBusy(text) {
  let el = document.getElementById('adminBusy');
  if (!el) {
    el = document.createElement('div');
    el.id = 'adminBusy';
    el.className = 'a-busy';
    el.innerHTML = '<div class="a-busy-box"><span class="spinner"></span><span class="a-busy-text"></span></div>';
    document.body.appendChild(el);
  }
  el.querySelector('.a-busy-text').textContent = text || '';
  el.hidden = !text;
}

async function withBusy(text, fn) {
  setBusy(text);
  try {
    return await fn();
  } catch (e) {
    if (e.code === 'Unauthorized') return logout('密碼已變更或登入已失效，請重新登入');
    showToast(e.message, 'error');
    throw e;
  } finally {
    setBusy('');
  }
}

/* ---------- 登入 ---------- */

function savedKey() {
  try { return localStorage.getItem(ADMIN_KEY_STORE) || sessionStorage.getItem(ADMIN_KEY_STORE) || ''; } catch (e) { return ''; }
}

function renderLogin(message = '') {
  document.getElementById('app').innerHTML = `
    <div class="a-login">
      <form class="a-login-card" id="loginForm">
        <img src="brand_logo.png" alt="" class="a-login-logo">
        <h1>建良鵝肉 後台</h1>
        <p class="a-muted">管理訂單、商品與網站內容</p>
        <label class="form-label" for="loginKey">後台密碼</label>
        <input type="password" class="form-input" id="loginKey" autocomplete="current-password" required>
        <label class="a-check"><input type="checkbox" id="loginRemember" checked> 記住這台裝置</label>
        ${message ? `<div class="a-alert">${esc(message)}</div>` : ''}
        <button type="submit" class="btn btn-primary btn-block btn-lg">登入</button>
      </form>
    </div>`;
  document.getElementById('loginKey').focus();
  document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const key = document.getElementById('loginKey').value.trim();
    const remember = document.getElementById('loginRemember').checked;
    if (key) await login(key, remember);
  });
}

async function login(key, remember) {
  A.key = key;
  setBusy('登入中…');
  try {
    await api('ping');
    try {
      localStorage.removeItem(ADMIN_KEY_STORE);
      sessionStorage.removeItem(ADMIN_KEY_STORE);
      (remember ? localStorage : sessionStorage).setItem(ADMIN_KEY_STORE, key);
    } catch (e) {}
    await loadAll();
    renderShell();
  } catch (e) {
    A.key = '';
    renderLogin(e.message);
  } finally {
    setBusy('');
  }
}

function logout(message = '') {
  A.key = '';
  closeModal();
  try { localStorage.removeItem(ADMIN_KEY_STORE); sessionStorage.removeItem(ADMIN_KEY_STORE); } catch (e) {}
  renderLogin(message);
}

/* ---------- 版面 ---------- */

const TABS = [
  ['orders', '訂單', '<path d="M6 2h12l2 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z"/><path d="M4 6h16M9 11h6M9 15h6"/>'],
  ['products', '商品', '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/>'],
  ['customers', '客戶', '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M16 3.5a4 4 0 0 1 0 8M19 15c2 .8 3 2.8 3 6"/>'],
  ['news', '消息', '<path d="M4 5h13v14a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v10a2 2 0 0 1-2 2M8 9h5M8 13h5M8 17h3"/>'],
  ['settings', '設定', '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'],
];

function renderShell() {
  document.getElementById('app').innerHTML = `
    <header class="a-top">
      <div class="a-top-inner">
        <a class="a-brand" href="index.html" target="_blank" title="開啟網站">
          <img src="brand_logo.png" alt=""><span>建良鵝肉 <small>後台</small></span>
        </a>
        <div class="a-top-actions">
          <button type="button" class="a-icon-btn" data-act="refresh" title="重新整理">⟳<span>重新整理</span></button>
          <button type="button" class="a-icon-btn" data-act="help" title="使用說明">?<span>說明</span></button>
          <button type="button" class="a-icon-btn" data-act="logout" title="登出">⎋<span>登出</span></button>
        </div>
      </div>
      <nav class="a-tabs" id="adminTabs"></nav>
    </header>
    <main class="a-main" id="adminMain"></main>`;
  renderTabs();
  renderView();
}

function renderTabs() {
  const todo = A.orders.filter(o => o.status.includes('待處理')).length;
  document.getElementById('adminTabs').innerHTML = TABS.map(([id, label, icon]) => `
    <button type="button" class="a-tab${A.tab === id ? ' active' : ''}" data-tab="${id}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
      <span>${label}</span>${id === 'orders' && todo ? `<b class="a-badge">${todo}</b>` : ''}
    </button>`).join('');
}

function renderView(scrollTop = true) {
  const main = document.getElementById('adminMain');
  if (!main) return;
  ({ orders: renderOrders, products: renderProducts, customers: renderCustomers, news: renderNews, settings: renderSettings })[A.tab](main);
  if (scrollTop) window.scrollTo(0, 0);
}

/* ---------- 訂單 ---------- */

const ORDER_FILTERS = [
  ['todo', '待處理', o => o.status.includes('待處理')],
  ['unpaid', '還沒收款', o => !o.verified && !o.status.includes('取消')],
  ['shipped', '已出貨', o => o.status.includes('出貨')],
  ['ready', '完成待取', o => o.status.includes('待取')],
  ['done', '已完成', o => o.status === '已完成'],
  ['cancelled', '已取消', o => o.status.includes('取消')],
  ['all', '全部', () => true],
];

function renderOrders(main) {
  main.innerHTML = `
    <div class="a-toolbar">
      <input type="search" class="form-input a-search" id="orderSearch" placeholder="搜尋姓名、電話、訂單編號或商品" value="${esc(A.orderQuery)}">
    </div>
    <div class="a-chips" id="orderChips"></div>
    <div id="orderList"></div>`;
  renderOrderChips();
  renderOrderList();
}

function renderOrderChips() {
  document.getElementById('orderChips').innerHTML = ORDER_FILTERS.map(([id, label, fn]) => {
    const n = A.orders.filter(fn).length;
    return `<button type="button" class="chip${A.orderFilter === id ? ' active' : ''}" data-filter="${id}">${label} <b>${n}</b></button>`;
  }).join('');
}

function filteredOrders() {
  const f = ORDER_FILTERS.find(x => x[0] === A.orderFilter) || ORDER_FILTERS[0];
  const q = A.orderQuery.trim().toLowerCase();
  const qd = digits(q);
  return A.orders.filter(f[2]).filter(o => !q ||
    o.name.toLowerCase().includes(q) || o.id.toLowerCase().includes(q) || o.items.toLowerCase().includes(q) ||
    (qd.length >= 3 && digits(o.phone).includes(qd)));
}

function statusClass(s) {
  if (s.includes('取消')) return 'cancelled';
  if (s === '已完成') return 'done';
  if (s.includes('待取')) return 'ready';
  if (s.includes('出貨')) return 'shipped';
  return 'pending';
}

function orderCard(o) {
  const items = splitItems(o.items).map(i => `<li>${esc(i.name)}${i.qty ? ` <b>× ${i.qty}</b>` : ''}</li>`).join('');
  const statuses = ORDER_STATUSES.includes(o.status) ? ORDER_STATUSES : [o.status, ...ORDER_STATUSES];
  const where = o.store
    ? `${esc(o.delivery)}<br>${esc(o.store)}`
    : `${esc(o.delivery || '現場自取')}${o.pickup ? `<br>預計自取：${esc(o.pickup)}` : ''}`;
  return `
    <article class="a-card a-order" data-id="${esc(o.id)}">
      <header class="a-order-head">
        <div><span class="a-oid">${esc(o.id)}</span><span class="a-muted">${fmtTime(o.time)}</span></div>
        <span class="a-status s-${statusClass(o.status)}">${esc(o.status)}</span>
      </header>
      <div class="a-who">
        <strong>${esc(o.name)}</strong>
        <a href="${telHref(o.phone)}" class="a-tel">${esc(fmtPhone(o.phone))}</a>
      </div>
      <ul class="a-items">${items}</ul>
      <div class="a-money">合計 <b>${fmtPrice(o.grand)}</b>${o.shipping ? `<span class="a-muted">（含運費 ${fmtPrice(o.shipping)}）</span>` : ''}</div>
      <dl class="a-lines">
        <dt>付款</dt><dd>${esc(o.payMethod)}${o.payInfo ? `<br><span class="a-muted">${esc(o.payInfo)}</span>` : ''}</dd>
        <dt>取貨</dt><dd>${where}</dd>
        ${o.customerNote ? `<dt>客人備註</dt><dd class="a-cnote">${esc(o.customerNote).replace(/\n/g, '<br>')}</dd>` : ''}
      </dl>
      <div class="a-edit">
        <label class="a-paid${o.verified ? ' on' : ''}"><input type="checkbox" data-f="verified"${o.verified ? ' checked' : ''}> 已收到款項</label>
        <label class="a-field"><span>訂單狀態</span>
          <select class="form-select" data-f="status">${statuses.map(s => `<option${s === o.status ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
        </label>
        <label class="a-field a-field-wide"><span>店家備註（客人看不到）</span>
          <textarea class="form-textarea" data-f="note" rows="2">${esc(o.note)}</textarea>
        </label>
        <div class="a-actions">
          <button type="button" class="btn btn-primary btn-sm" data-act="save-order">儲存</button>
          ${o.store ? '<button type="button" class="btn btn-ghost btn-sm" data-act="copy-ship">複製寄件資料</button>' : ''}
        </div>
      </div>
    </article>`;
}

function renderOrderList() {
  const list = filteredOrders();
  const label = (ORDER_FILTERS.find(x => x[0] === A.orderFilter) || [])[1];
  document.getElementById('orderList').innerHTML = list.length
    ? list.map(orderCard).join('')
    : `<div class="a-empty">${A.orderQuery ? '找不到符合的訂單' : `目前沒有「${esc(label)}」的訂單`}</div>`;
}

function shippingText(o) {
  const m = o.store.match(/（收件人：(.+?)）/);
  const store = o.store.replace(/（收件人：.+?）/, '').trim();
  return `收件人：${m ? m[1] : o.name}\n電話：${digits(o.phone)}\n門市：${store}\n訂單：${o.id}`;
}

async function saveOrderCard(card) {
  const o = A.orders.find(x => x.id === card.dataset.id);
  if (!o) return;
  const status = card.querySelector('[data-f="status"]').value;
  const verified = card.querySelector('[data-f="verified"]').checked;
  const note = card.querySelector('[data-f="note"]').value;
  if (status.includes('取消') && !o.status.includes('取消') &&
      !confirm(`確定要取消訂單 ${o.id}？\n取消後，這筆訂單的商品會加回庫存。`)) return;
  await withBusy('儲存中…', async () => {
    await api('updateOrder', { orderId: o.id, status, note, paymentVerified: verified ? VERIFIED_MARK : '' });
    Object.assign(o, { status, verified, note });
    renderTabs();
    renderOrderChips();
    renderOrderList();
    showToast('訂單已更新');
  }).catch(() => {});
}

/* ---------- 商品 ---------- */

function productPrice(p) {
  const price = Number(p.Price) || 0;
  const disc = Number(p.DiscountPrice) || 0;
  return disc > 0 && disc < price
    ? `<b>${fmtPrice(disc)}</b> <s class="a-muted">${fmtPrice(price)}</s>`
    : `<b>${fmtPrice(price)}</b>`;
}

function stockLabel(p) {
  const s = String(p.Stock ?? '').trim();
  if (s === '') return '<span class="a-muted">不限量</span>';
  const n = Number(s);
  return n <= 0 ? '<span class="a-warn">已售完</span>' : `庫存 ${n}`;
}

function renderProducts(main) {
  main.innerHTML = `
    <div class="a-toolbar">
      <button type="button" class="btn btn-primary" data-act="new-product">＋ 新增商品</button>
      <span class="a-muted">排在越上面，網站上越前面</span>
    </div>
    <div class="a-plist">
      ${A.products.map((p, i) => `
        <article class="a-card a-product${isHidden(p) ? ' is-hidden' : ''}" data-index="${i}">
          <img src="${esc(imagePath(p.Image) || 'brand_logo.png')}" alt="" loading="lazy" onerror="this.src='brand_logo.png'">
          <div class="a-product-info">
            <div class="a-product-name">${esc(p.Name)}</div>
            <div>${productPrice(p)}</div>
            <div class="a-product-meta">${stockLabel(p)}${p.PromoTag ? ` · <span class="a-tag">${esc(p.PromoTag)}</span>` : ''}${isHidden(p) ? ' · <span class="a-warn">已下架</span>' : ''}</div>
          </div>
          <div class="a-product-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-act="edit-product">編輯</button>
            <button type="button" class="a-mini" data-act="toggle-product">${isHidden(p) ? '重新上架' : '下架'}</button>
            <div class="a-move">
              <button type="button" class="a-mini" data-act="move-up" ${i === 0 ? 'disabled' : ''} aria-label="往上移">↑</button>
              <button type="button" class="a-mini" data-act="move-down" ${i === A.products.length - 1 ? 'disabled' : ''} aria-label="往下移">↓</button>
            </div>
          </div>
        </article>`).join('')}
    </div>`;
}

async function saveProductList(next, message) {
  await withBusy('儲存中…', async () => {
    await api('saveProducts', { products: next });
    A.products = next;
    if (A.tab === 'products') renderView(false);
    showToast(message || `已儲存，${SITE_UPDATE_NOTE}`);
  });
}

function nextProductId() {
  const nums = A.products.map(p => Number(String(p.ID).replace(/^\D+/, ''))).filter(n => !isNaN(n));
  return 'p' + ((nums.length ? Math.max(...nums) : 0) + 1);
}

function openModal(html, onReady) {
  closeModal();
  const wrap = document.createElement('div');
  wrap.className = 'a-modal';
  wrap.id = 'adminModal';
  wrap.innerHTML = `<div class="a-modal-box" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('a-modal-open');
  wrap.addEventListener('click', e => { if (e.target === wrap) closeModal(); });
  if (onReady) onReady(wrap);
}

function closeModal() {
  document.getElementById('adminModal')?.remove();
  document.body.classList.remove('a-modal-open');
}

function imageField(id, url, { label, hint, qr = false } = {}) {
  return `
    <div class="a-image-field" data-image-field="${id}" data-qr="${qr ? 1 : 0}">
      <span class="form-label">${esc(label)}</span>
      <div class="a-image-row">
        <img src="${esc(url ? imagePath(url) : '')}" alt="" class="a-image-preview"${url ? '' : ' hidden'}>
        <div class="a-image-empty"${url ? ' hidden' : ''}>尚未設定</div>
        <div class="a-image-buttons">
          <label class="btn btn-ghost btn-sm a-upload">上傳照片<input type="file" accept="image/*" hidden></label>
          ${url ? '<button type="button" class="a-mini" data-act="clear-image">移除</button>' : ''}
        </div>
      </div>
      <input type="hidden" name="${id}" value="${esc(url)}">
      ${hint ? `<div class="form-help">${esc(hint)}</div>` : ''}
    </div>`;
}

function editProduct(index) {
  const isNew = index === null;
  const p = isNew ? { ID: nextProductId(), Name: '', Price: '', DiscountPrice: '', Description: '', Image: '', Category: 'other', Stock: '', PromoTag: '', PromoDesc: '', Hidden: '' } : A.products[index];
  openModal(`
    <form id="productForm" class="a-form">
      <h2>${isNew ? '新增商品' : '編輯商品'}</h2>
      <label class="a-field"><span>商品名稱 *</span><input class="form-input" name="Name" required value="${esc(p.Name)}" placeholder="例如：茶香鵝肉-前胸 (1/4 隻鵝)"></label>
      <div class="a-row2">
        <label class="a-field"><span>售價 *</span><input class="form-input" name="Price" type="number" min="0" inputmode="numeric" required value="${esc(p.Price)}"></label>
        <label class="a-field"><span>優惠價（選填）</span><input class="form-input" name="DiscountPrice" type="number" min="0" inputmode="numeric" value="${esc(p.DiscountPrice)}" placeholder="有填才會打折"></label>
      </div>
      ${imageField('Image', String(p.Image || ''), { label: '商品照片', hint: '可以直接用手機拍照上傳，照片會自動縮小。' })}
      <label class="a-field"><span>商品說明</span><textarea class="form-textarea" name="Description" rows="4" placeholder="口味、份量、加熱方式…">${esc(p.Description)}</textarea></label>
      <div class="a-row2">
        <label class="a-field"><span>庫存</span><input class="form-input" name="Stock" type="number" min="0" inputmode="numeric" value="${esc(p.Stock)}" placeholder="留空＝不限量"></label>
        <label class="a-field"><span>分類</span>
          <select class="form-select" name="Category">${Object.entries(PRODUCT_CATEGORIES).map(([k, v]) => `<option value="${k}"${(p.Category || 'other') === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
        </label>
      </div>
      <div class="a-row2">
        <label class="a-field"><span>標籤（選填）</span><input class="form-input" name="PromoTag" value="${esc(p.PromoTag)}" placeholder="例如：熱銷、新品"></label>
        <label class="a-field"><span>促銷說明（選填）</span><input class="form-input" name="PromoDesc" value="${esc(p.PromoDesc)}" placeholder="例如：兩盒以上加購優惠"></label>
      </div>
      <label class="a-check"><input type="checkbox" name="visible"${isHidden(p) ? '' : ' checked'}> 顯示在網站上（取消勾選＝下架）</label>
      <div class="a-form-actions">
        ${isNew ? '' : '<button type="button" class="a-danger" data-act="delete-product">刪除商品</button>'}
        <span class="a-grow"></span>
        <button type="button" class="btn btn-ghost" data-act="close-modal">取消</button>
        <button type="submit" class="btn btn-primary">儲存</button>
      </div>
    </form>`, wrap => {
    const form = wrap.querySelector('#productForm');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(form);
      const name = String(f.get('Name')).trim();
      const price = Number(f.get('Price'));
      const disc = String(f.get('DiscountPrice')).trim();
      if (!name) return showToast('請填寫商品名稱', 'error');
      if (!(price > 0)) return showToast('請填寫正確的售價', 'error');
      if (disc && Number(disc) >= price) return showToast('優惠價要比售價低', 'error');
      const updated = {
        ...p,
        Name: name,
        Price: price,
        DiscountPrice: disc ? Number(disc) : '',
        Description: String(f.get('Description')).trim(),
        Image: String(f.get('Image')).trim(),
        Stock: String(f.get('Stock')).trim() === '' ? '' : Number(f.get('Stock')),
        Category: f.get('Category'),
        PromoTag: String(f.get('PromoTag')).trim(),
        PromoDesc: String(f.get('PromoDesc')).trim(),
        Hidden: f.get('visible') ? '' : 'Y',
      };
      const next = A.products.slice();
      if (isNew) next.unshift(updated); else next[index] = updated;
      try {
        await saveProductList(next, isNew ? `已新增「${name}」，${SITE_UPDATE_NOTE}` : undefined);
        closeModal();
      } catch (e) {}
    });
    form.querySelector('[data-act="delete-product"]')?.addEventListener('click', async () => {
      if (!confirm(`確定要刪除「${p.Name}」？\n刪除後就無法復原。只是暫時不賣的話，建議用「下架」。`)) return;
      const next = A.products.filter((_, i) => i !== index);
      try { await saveProductList(next, '商品已刪除'); closeModal(); } catch (e) {}
    });
  });
}

/* ---------- 圖片上傳 ---------- */

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('無法讀取這張照片，請換一張試試')); };
    img.src = url;
  });
}

// 手機照片通常很大，先縮小再上傳；收款碼用 PNG 保持清晰
async function prepareImage(file, qr) {
  const img = await loadImage(file);
  const max = qr ? 1000 : 1400;
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const type = qr ? 'image/png' : 'image/jpeg';
  return { base64: canvas.toDataURL(type, 0.86).split(',')[1], type };
}

async function handleImageInput(input) {
  const field = input.closest('[data-image-field]');
  const file = input.files && input.files[0];
  input.value = '';
  if (!field || !file) return;
  const qr = field.dataset.qr === '1';
  await withBusy('照片上傳中…', async () => {
    const { base64, type } = await prepareImage(file, qr);
    const base = (file.name || 'photo').replace(/\.[^.]+$/, '');
    const r = await api('uploadImage', { base64, mimeType: type, filename: `${base}.${qr ? 'png' : 'jpg'}` });
    setImageField(field, r.url);
    showToast('照片已上傳，記得按「儲存」');
  }).catch(() => {});
}

function setImageField(field, url) {
  field.querySelector('input[type="hidden"]').value = url;
  const img = field.querySelector('.a-image-preview');
  img.src = url ? imagePath(url) : '';
  img.hidden = !url;
  field.querySelector('.a-image-empty').hidden = !!url;
}

/* ---------- 客戶 ---------- */

function buildCustomers() {
  const map = new Map();
  for (const o of A.orders) {
    const key = digits(o.phone) || 'name:' + o.name;
    let c = map.get(key);
    if (!c) {
      c = { key, name: o.name, phone: o.phone, orders: [], count: 0, total: 0, last: null, lastWhere: '' };
      map.set(key, c);
    }
    c.orders.push(o);
    if (!o.status.includes('取消')) { c.count++; c.total += o.grand; }
    if (o.time && (!c.last || o.time > c.last)) {
      c.last = o.time;
      c.name = o.name || c.name;
      c.lastWhere = o.store || (o.delivery || '現場自取');
    }
  }
  const list = [...map.values()];
  const sorters = {
    recent: (a, b) => (b.last?.getTime() || 0) - (a.last?.getTime() || 0),
    total: (a, b) => b.total - a.total,
    count: (a, b) => b.count - a.count,
  };
  return list.sort(sorters[A.customerSort] || sorters.recent);
}

function renderCustomers(main) {
  main.innerHTML = `
    <div class="a-toolbar">
      <input type="search" class="form-input a-search" id="customerSearch" placeholder="搜尋姓名或電話" value="${esc(A.customerQuery)}">
      <select class="form-select a-sort" id="customerSort">
        <option value="recent"${A.customerSort === 'recent' ? ' selected' : ''}>最近下單</option>
        <option value="total"${A.customerSort === 'total' ? ' selected' : ''}>消費金額</option>
        <option value="count"${A.customerSort === 'count' ? ' selected' : ''}>下單次數</option>
      </select>
      <button type="button" class="btn btn-ghost btn-sm" data-act="export-customers">匯出 Excel</button>
    </div>
    <div id="customerList"></div>`;
  renderCustomerList();
}

function filteredCustomers() {
  const q = A.customerQuery.trim().toLowerCase();
  const qd = digits(q);
  return buildCustomers().filter(c => !q || c.name.toLowerCase().includes(q) || (qd.length >= 3 && digits(c.phone).includes(qd)));
}

function renderCustomerList() {
  const list = filteredCustomers();
  document.getElementById('customerList').innerHTML = `
    <p class="a-muted a-count">共 ${list.length} 位客戶</p>
    ${list.map(c => `
      <article class="a-card a-customer" data-key="${esc(c.key)}">
        <button type="button" class="a-customer-head" data-act="toggle-customer">
          <div>
            <strong>${esc(c.name)}</strong>
            <span class="a-muted">${esc(fmtPhone(c.phone))}</span>
          </div>
          <div class="a-customer-sum">${c.count} 筆 · ${fmtPrice(c.total)}<br><span class="a-muted">最近 ${fmtDay(c.last)}</span></div>
        </button>
        ${A.openCustomer === c.key ? `
          <div class="a-customer-body">
            <div class="a-actions"><a class="btn btn-ghost btn-sm" href="${telHref(c.phone)}">打電話</a></div>
            <div class="a-muted">最近取貨：${esc(c.lastWhere)}</div>
            <ul class="a-mini-orders">
              ${c.orders.map(o => `<li><span>${esc(o.id)}</span><span>${fmtDay(o.time)}</span><span>${fmtPrice(o.grand)}</span><span class="a-status s-${statusClass(o.status)}">${esc(o.status)}</span></li>`).join('')}
            </ul>
          </div>` : ''}
      </article>`).join('')}`;
}

function exportCustomers() {
  const csvCell = v => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s; // 避免 Excel 把內容當公式
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = [['姓名', '電話', '訂單數', '消費金額', '最近下單', '最近取貨']]
    .concat(filteredCustomers().map(c => [c.name, digits(c.phone), c.count, c.total, fmtDay(c.last), c.lastWhere]));
  const csv = '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `建良客戶名單-${todayISO()}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------- 最新消息 ---------- */

function getNews() {
  const raw = A.settings.news_json;
  if (raw) {
    try {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    } catch (e) {}
  }
  return DEFAULT_NEWS.map(n => ({ ...n }));
}

async function saveNews(list) {
  const sorted = list.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 50);
  const json = JSON.stringify(sorted);
  if (json.length > 45000) throw new Error('消息內容太多了，請刪除幾則舊消息');
  await withBusy('儲存中…', async () => {
    await api('saveSettings', { settings: { news_json: json } });
    A.settings.news_json = json;
    renderView(false);
    showToast(`消息已更新，${SITE_UPDATE_NOTE}`);
  });
}

function renderNews(main) {
  const news = getNews();
  main.innerHTML = `
    <div class="a-toolbar">
      <button type="button" class="btn btn-primary" data-act="new-news">＋ 新增消息</button>
      <span class="a-muted">會顯示在網站的「最新消息」頁</span>
    </div>
    ${news.length ? news.map((n, i) => `
      <article class="a-card a-news" data-index="${i}">
        <div class="a-news-meta">${esc(String(n.date).replace(/-/g, '.'))}${n.tag ? ` <span class="a-tag">${esc(n.tag)}</span>` : ''}</div>
        <h3>${esc(n.title)}</h3>
        <p>${esc(n.body)}</p>
        <div class="a-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-act="edit-news">編輯</button>
          <button type="button" class="a-mini" data-act="delete-news">刪除</button>
        </div>
      </article>`).join('') : '<div class="a-empty">還沒有消息</div>'}`;
}

function editNews(index) {
  const news = getNews();
  const isNew = index === null;
  const n = isNew ? { date: todayISO(), tag: '公告', title: '', body: '' } : news[index];
  openModal(`
    <form id="newsForm" class="a-form">
      <h2>${isNew ? '新增消息' : '編輯消息'}</h2>
      <div class="a-row2">
        <label class="a-field"><span>日期</span><input class="form-input" type="date" name="date" required value="${esc(n.date)}"></label>
        <label class="a-field"><span>標籤</span><input class="form-input" name="tag" value="${esc(n.tag)}" list="newsTags" placeholder="例如：公告、優惠"></label>
      </div>
      <datalist id="newsTags"><option>公告</option><option>優惠</option><option>新品</option><option>節慶禮盒</option><option>營業時間</option></datalist>
      <label class="a-field"><span>標題 *</span><input class="form-input" name="title" required value="${esc(n.title)}"></label>
      <label class="a-field"><span>內容</span><textarea class="form-textarea" name="body" rows="5">${esc(n.body)}</textarea></label>
      <div class="a-form-actions">
        <span class="a-grow"></span>
        <button type="button" class="btn btn-ghost" data-act="close-modal">取消</button>
        <button type="submit" class="btn btn-primary">儲存</button>
      </div>
    </form>`, wrap => {
    wrap.querySelector('#newsForm').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const item = { date: f.get('date'), tag: String(f.get('tag')).trim(), title: String(f.get('title')).trim(), body: String(f.get('body')).trim() };
      if (!item.title) return showToast('請填寫標題', 'error');
      const next = news.slice();
      if (isNew) next.unshift(item); else next[index] = item;
      try { await saveNews(next); closeModal(); } catch (e) {}
    });
  });
}

/* ---------- 設定 ---------- */

function renderSettings(main) {
  const open = isOpen(setting('is_open'));
  main.innerHTML = `
    <form id="settingsForm" class="a-form a-settings">
      <section class="a-card">
        <h2>接單狀態</h2>
        <div class="a-seg">
          <label><input type="radio" name="is_open" value="true"${open ? ' checked' : ''}><span>開放接單</span></label>
          <label><input type="radio" name="is_open" value="false"${open ? '' : ' checked'}><span>暫停接單</span></label>
        </div>
        <label class="a-field"><span>暫停接單時，顯示給客人的說明</span>
          <textarea class="form-textarea" name="closed_message" rows="2" placeholder="例如：中秋節訂單已滿，10/1 恢復接單。">${esc(setting('closed_message'))}</textarea>
        </label>
      </section>

      <section class="a-card">
        <h2>網站公告</h2>
        <label class="a-field"><span>顯示在首頁、商品頁、結帳頁最上方（留空就不顯示）</span>
          <textarea class="form-textarea" name="announcement" rows="2" placeholder="例如：9/28 中秋節公休一天，9/29 起正常出貨。">${esc(setting('announcement'))}</textarea>
        </label>
      </section>

      <section class="a-card">
        <h2>運費</h2>
        <div class="a-row2">
          <label class="a-field"><span>超商冷凍運費</span><input class="form-input" type="number" min="0" inputmode="numeric" name="shipping_fee" value="${esc(setting('shipping_fee'))}"></label>
          <label class="a-field"><span>滿多少免運</span><input class="form-input" type="number" min="0" inputmode="numeric" name="shipping_threshold" value="${esc(setting('shipping_threshold'))}"></label>
        </div>
      </section>

      <section class="a-card">
        <h2>ATM 轉帳帳號</h2>
        <div class="a-row2">
          <label class="a-field"><span>銀行名稱</span><input class="form-input" name="bank_name" value="${esc(setting('bank_name'))}"></label>
          <label class="a-field"><span>銀行代碼</span><input class="form-input" name="bank_code" inputmode="numeric" value="${esc(setting('bank_code'))}"></label>
        </div>
        <div class="a-row2">
          <label class="a-field"><span>帳號</span><input class="form-input" name="bank_account" value="${esc(setting('bank_account'))}"></label>
          <label class="a-field"><span>戶名</span><input class="form-input" name="bank_holder" value="${esc(setting('bank_holder'))}"></label>
        </div>
      </section>

      <section class="a-card">
        <h2>行動支付收款碼</h2>
        ${imageField('jko_qr', setting('jko_qr'), { label: '街口支付', qr: true })}
        ${imageField('linepay_qr', setting('linepay_qr'), { label: 'LINE Pay', qr: true, hint: '還沒上傳 LINE Pay 收款碼之前，結帳頁不會出現 LINE Pay 選項。' })}
      </section>

      <div class="a-sticky-save">
        <button type="submit" class="btn btn-primary btn-block btn-lg">儲存設定</button>
      </div>
    </form>`;
  main.querySelector('#settingsForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const keys = ['is_open', 'closed_message', 'announcement', 'shipping_fee', 'shipping_threshold',
      'bank_name', 'bank_code', 'bank_account', 'bank_holder', 'jko_qr', 'linepay_qr'];
    const next = {};
    keys.forEach(k => { next[k] = String(f.get(k) ?? '').trim(); });
    if (!(Number(next.shipping_fee) >= 0) || !(Number(next.shipping_threshold) >= 0)) return showToast('運費請填數字', 'error');
    await withBusy('儲存中…', async () => {
      await api('saveSettings', { settings: next });
      Object.assign(A.settings, next);
      showToast(`設定已儲存，${SITE_UPDATE_NOTE}`);
    }).catch(() => {});
  });
}

/* ---------- 使用說明 ---------- */

function showHelp() {
  openModal(`
    <div class="a-help">
      <h2>後台使用說明</h2>
      <h3>收到新訂單</h3>
      <ol>
        <li>「訂單」頁預設顯示<b>待處理</b>的訂單。</li>
        <li>核對款項後，勾選<b>已收到款項</b>。</li>
        <li>寄出後把狀態改成<b>已出貨</b>；超商寄件可以按<b>複製寄件資料</b>，直接貼到寄件系統。</li>
        <li>自取訂單備好後改成<b>完成待取</b>，客人取走後改成<b>已完成</b>。</li>
        <li>改完記得按<b>儲存</b>。客人在網站「訂單查詢」看得到狀態。</li>
      </ol>
      <h3>商品</h3>
      <ul>
        <li>按<b>編輯</b>可以改價格、說明、照片、庫存。庫存留空＝不限量，填 0＝顯示已售完。</li>
        <li>暫時不賣請按<b>下架</b>，之後可以重新上架。</li>
        <li>用 ↑ ↓ 調整網站上的排列順序。</li>
      </ul>
      <h3>什麼時候看得到？</h3>
      <p>商品、公告、消息、運費等修改，<b>網站約 5 分鐘內更新</b>。訂單狀態是即時的。</p>
      <h3>改錯了怎麼辦？</h3>
      <p>每次儲存商品前，系統都會把舊資料記在試算表的「AdminLog」工作表，可以請 Evelyn 協助還原。</p>
      <div class="a-form-actions"><span class="a-grow"></span><button type="button" class="btn btn-primary" data-act="close-modal">知道了</button></div>
    </div>`);
}

/* ---------- 事件 ---------- */

document.addEventListener('click', async e => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) {
    A.tab = tabBtn.dataset.tab;
    renderTabs();
    renderView();
    return;
  }
  const chip = e.target.closest('[data-filter]');
  if (chip) {
    A.orderFilter = chip.dataset.filter;
    renderOrderChips();
    renderOrderList();
    return;
  }
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const productEl = btn.closest('[data-index]');
  const index = productEl ? Number(productEl.dataset.index) : null;

  if (act === 'refresh') {
    await withBusy('重新整理中…', async () => { await loadAll(); renderTabs(); renderView(); showToast('已更新到最新資料'); }).catch(() => {});
  } else if (act === 'help') {
    showHelp();
  } else if (act === 'logout') {
    if (confirm('確定要登出？')) logout();
  } else if (act === 'close-modal') {
    closeModal();
  } else if (act === 'save-order') {
    saveOrderCard(btn.closest('.a-order'));
  } else if (act === 'copy-ship') {
    const o = A.orders.find(x => x.id === btn.closest('.a-order').dataset.id);
    if (o) copyToClipboard(shippingText(o), btn);
  } else if (act === 'new-product') {
    editProduct(null);
  } else if (act === 'edit-product') {
    editProduct(index);
  } else if (act === 'toggle-product') {
    const next = A.products.slice();
    const p = { ...next[index], Hidden: isHidden(next[index]) ? '' : 'Y' };
    next[index] = p;
    saveProductList(next, isHidden(p) ? `「${p.Name}」已下架` : `「${p.Name}」已重新上架`).catch(() => {});
  } else if (act === 'move-up' || act === 'move-down') {
    const to = act === 'move-up' ? index - 1 : index + 1;
    if (to < 0 || to >= A.products.length) return;
    const next = A.products.slice();
    [next[index], next[to]] = [next[to], next[index]];
    saveProductList(next, '排列順序已更新').catch(() => {});
  } else if (act === 'clear-image') {
    setImageField(btn.closest('[data-image-field]'), '');
    btn.remove();
  } else if (act === 'toggle-customer') {
    const key = btn.closest('.a-customer').dataset.key;
    A.openCustomer = A.openCustomer === key ? null : key;
    renderCustomerList();
  } else if (act === 'export-customers') {
    exportCustomers();
  } else if (act === 'new-news') {
    editNews(null);
  } else if (act === 'edit-news') {
    editNews(index);
  } else if (act === 'delete-news') {
    const news = getNews();
    if (confirm(`確定要刪除「${news[index].title}」？`)) saveNews(news.filter((_, i) => i !== index)).catch(() => {});
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'orderSearch') { A.orderQuery = e.target.value; renderOrderList(); }
  if (e.target.id === 'customerSearch') { A.customerQuery = e.target.value; renderCustomerList(); }
});

document.addEventListener('change', e => {
  if (e.target.id === 'customerSort') { A.customerSort = e.target.value; renderCustomerList(); }
  if (e.target.matches('[data-image-field] input[type="file"]')) handleImageInput(e.target);
  if (e.target.matches('[data-f="verified"]')) e.target.closest('.a-paid').classList.toggle('on', e.target.checked);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

/* ---------- 啟動 ---------- */

(async function () {
  const key = savedKey();
  if (!key) return renderLogin();
  A.key = key;
  setBusy('讀取中…');
  try {
    await loadAll();
    renderShell();
  } catch (e) {
    if (e.code === 'Unauthorized') logout('登入已失效，請重新輸入密碼');
    else renderLogin(e.message);
  } finally {
    setBusy('');
  }
})();
