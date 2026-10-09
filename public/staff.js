const view = document.body.dataset.view;
const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const yen = (value) => `¥${Number(value || 0).toLocaleString('ja-JP')}`;
const today = new Date().toISOString().slice(0, 10);
let token = sessionStorage.getItem('ajimaruyStaffToken') || '';
let selectedTableNo = null;
let currentTables = [];
let toastTimer;
let audioContext;
let speechEnabled = localStorage.getItem('ajimaruyVoice') === 'enabled';
const printedOrders = new Set();

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...options, headers });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error || '処理に失敗しました。');
  return data;
}

function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2800);
}

function soundAlert() {
  try {
    audioContext ||= new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = 880;
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.18);
  } catch {}
}

function speak(message) {
  if (!speechEnabled || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = 'ja-JP';
  window.speechSynthesis.speak(utterance);
}

function titlebar(title, detail) {
  return `<div class="staff-titlebar"><div><span class="eyebrow">あじまるや · 中島駅</span><h1>${title}</h1><p>${detail}</p></div></div>`;
}

function ticketMarkup(order, item, isNew = false) {
  const options = item.options.map((option) => `${option.group}: ${option.name}`).join(' / ');
  const notes = [item.note, order.notes].filter(Boolean).join('\n');
  const statuses = { received: '受付', preparing: '調理中', ready: '完成', served: '提供済み' };
  return `<article class="kitchen-ticket${isNew ? ' is-new' : ''}" data-order-id="${esc(order.id)}" data-item-id="${esc(item.id)}" data-status="${esc(item.status)}">
    <div class="ticket-head"><strong>${Number(order.table_no)}番テーブル</strong><time>${new Date(order.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} · ${statuses[item.status] || '受付'}</time></div>
    <div class="ticket-body"><h3>${esc(item.name)}</h3><p class="ticket-quantity">${item.quantity}点</p>${options ? `<p>${esc(options)}</p>` : ''}${notes ? `<p>メモ: ${esc(notes)}</p>` : ''}</div>
    <div class="ticket-actions"><button class="btn btn-outline-secondary" data-action="item-status" data-item-id="${esc(item.id)}" data-status="preparing">調理開始</button><button class="btn btn-success" data-action="item-status" data-item-id="${esc(item.id)}" data-status="ready">完成</button><button class="btn btn-outline-success" data-action="item-status" data-item-id="${esc(item.id)}" data-status="served">提供済み</button><button class="btn btn-warning" data-action="pickup" data-order-id="${esc(order.id)}" data-table-no="${Number(order.table_no)}">📣 カウンターまで取りに来てください</button></div>
  </article>`;
}

function printTicketMarkup(order, item) {
  const options = item.options.map((option) => `${option.group}: ${option.name}`).join(' / ');
  return `<article class="print-ticket"><h1>あじまるや · 中島駅</h1><h2>${Number(order.table_no)}番テーブル</h2><p>${new Date(order.created_at).toLocaleString('ja-JP')}</p><h2>${esc(item.name)} × ${item.quantity}</h2>${options ? `<p>${esc(options)}</p>` : ''}${item.note ? `<p>メモ: ${esc(item.note)}</p>` : ''}${order.notes ? `<p>注文メモ: ${esc(order.notes)}</p>` : ''}</article>`;
}

function printNewOrder(order) {
  if (!order || printedOrders.has(order.id)) return;
  printedOrders.add(order.id);
  $('#print-root').innerHTML = order.items.map((item) => printTicketMarkup(order, item)).join('');
  setTimeout(() => window.print(), 250);
}

async function loadKitchen(newOrderId = '') {
  const orders = await api('/api/staff/orders');
  const container = $('#ticket-grid');
  if (!container) return;
  container.innerHTML = orders.length
    ? orders.flatMap((order) => order.items.filter((item) => item.status !== 'served').map((item) => ticketMarkup(order, item, order.id === newOrderId))).join('')
    : '<p class="staff-empty">新しい注文をお待ちしています。</p>';
  if (newOrderId) {
    const order = orders.find((entry) => entry.id === newOrderId);
    if (order) {
      soundAlert();
      speak(`${order.table_no}番テーブル、新規注文です`);
      if ($('#auto-print').checked) printNewOrder(order);
    }
  }
}

function renderKitchen() {
  $('#staff-view').innerHTML = `${titlebar('厨房', '新しい注文は音と点滅で通知されます。各商品を1枚ずつ表示します。')}
    <section class="staff-panel"><div class="staff-toolbar"><button id="enable-audio" class="btn btn-outline-secondary">🔊 音声を有効にする</button><label class="form-check"><input id="auto-print" class="form-check-input" type="checkbox"> 自動印刷</label><label>用紙幅<select id="paper-width"><option value="80">80 mm</option><option value="58">58 mm</option></select></label><button class="btn btn-outline-primary" data-announcement="welcome">いらっしゃいませ</button><button class="btn btn-outline-primary" data-announcement="thanks">ありがとうございました</button><label class="form-check"><input id="customer-broadcast" class="form-check-input" type="checkbox"> お客様画面にも表示</label></div></section>
    <div id="ticket-grid" class="ticket-grid"></div>`;
  $('#auto-print').checked = localStorage.getItem('ajimaruyAutoPrint') === 'true';
  $('#auto-print').addEventListener('change', (event) => localStorage.setItem('ajimaruyAutoPrint', String(event.target.checked)));
  $('#paper-width').value = localStorage.getItem('ajimaruyPaperWidth') || '80';
  document.body.classList.toggle('paper-58mm', $('#paper-width').value === '58');
  $('#paper-width').addEventListener('change', (event) => {
    localStorage.setItem('ajimaruyPaperWidth', event.target.value);
    document.body.classList.toggle('paper-58mm', event.target.value === '58');
  });
  $('#enable-audio').addEventListener('click', () => {
    audioContext ||= new AudioContext();
    audioContext.resume();
    speechEnabled = true;
    localStorage.setItem('ajimaruyVoice', 'enabled');
    speak('音声を有効にしました');
    notify('音声を有効にしました。');
  });
  loadKitchen();
}

function receiptMarkup(receipt) {
  const methods = { cash: '現金', paypay: 'PayPay', card: 'クレジットカード' };
  const lines = receipt.orders.flatMap((order) => order.items.map((item) => `<div class="receipt-line"><span>${esc(item.name)} × ${item.quantity}</span><span>${yen(item.unit_price * item.quantity)}</span></div>`)).join('');
  return `<article class="receipt-paper"><h1>あじまるや</h1><p style="text-align:center">中島駅 · レシート</p>${receipt.receiptNeeded ? `<p>宛名: ${esc(receipt.addressee || '上様')}</p><p style="text-align:center">領収書</p>` : ''}<p>テーブル ${receipt.tableNo} · ${new Date(receipt.createdAt).toLocaleString('ja-JP')}</p><hr>${lines}<hr><div class="receipt-line"><strong>小計</strong><strong>${yen(receipt.subtotal)}</strong></div><div class="receipt-line"><span>割引</span><span>-${yen(receipt.discountAmount)}</span></div><div class="receipt-line"><strong>合計</strong><strong>${yen(receipt.total)}</strong></div><p>お支払い: ${methods[receipt.method] || receipt.method}</p><p style="text-align:center">ありがとうございました</p></article>`;
}

function printReceipt(receipt) {
  $('#print-root').innerHTML = receiptMarkup(receipt);
  window.print();
}

async function loadPos() {
  const data = await api('/api/staff/tables');
  currentTables = data.tables;
  if (!currentTables.some((table) => table.tableNo === selectedTableNo)) selectedTableNo = currentTables[0]?.tableNo ?? null;
  renderPos(data.calls);
}

function renderPos(calls = []) {
  const selected = currentTables.find((table) => table.tableNo === selectedTableNo);
  const tablesMarkup = currentTables.length ? currentTables.map((table) => `<button class="table-select" type="button" data-table="${table.tableNo}" aria-pressed="${table.tableNo === selectedTableNo}"><strong>${table.tableNo}番テーブル</strong><span>${yen(table.orders.reduce((sum, order) => sum + order.total, 0))}</span></button>`).join('') : '<p class="staff-empty">会計待ちのテーブルはありません。</p>';
  const alertMarkup = calls.length ? `<div class="alert alert-warning" role="alert"><strong>店員呼び出し</strong>${calls.map((call) => `<button class="btn btn-sm btn-outline-dark ms-2" data-action="ack-call" data-notice-id="${call.id}" data-table-no="${call.table_no}">${call.table_no}番 · 対応済み</button>`).join('')}</div>` : '';
  let detail = '<p class="staff-empty">会計するテーブルを選択してください。</p>';
  if (selected) {
    const lines = selected.orders.flatMap((order) => order.items.map((item) => `<div class="pos-line"><span>${esc(item.name)} × ${item.quantity}<small>${item.options.map((option) => `${esc(option.group)}: ${esc(option.name)}`).join(' / ')}</small></span><strong>${yen(item.unit_price * item.quantity)}</strong></div>`)).join('');
    const total = selected.orders.reduce((sum, order) => sum + order.total, 0);
    detail = `<section class="staff-panel"><h2>${selected.tableNo}番テーブル · ご注文履歴</h2><div class="order-list">${lines}</div><p class="pos-line"><strong>小計</strong><strong>${yen(total)}</strong></p><form id="checkout-form" class="checkout-form" data-table-no="${selected.tableNo}"><div class="checkout-row"><label>お支払い<select name="method"><option value="cash">現金</option><option value="paypay">PayPay</option><option value="card">クレジットカード</option></select></label><label>割引方式<select name="discountType"><option value="yen">金額（円）</option><option value="percent">割合（%）</option></select></label></div><label>割引<input name="discountValue" type="number" min="0" step="1" value="0"></label><button class="btn btn-primary" type="submit">会計してテーブルを閉じる</button></form></section>`;
  }
  $('#staff-view').innerHTML = `${titlebar('レジ・会計', '呼び出し対応、テーブル会計、日次集計と領収書を管理します。')}${alertMarkup}<div class="table-layout"><section><h2 class="h6 mb-3">会計待ち</h2><div class="table-list">${tablesMarkup}</div></section><div>${detail}</div></div>
    <section class="staff-panel"><h2>日次集計</h2><div class="staff-toolbar"><input id="summary-date" type="date" value="${today}"><button id="load-summary" class="btn btn-outline-primary">集計を表示</button><button id="print-summary" class="btn btn-outline-secondary">印刷</button></div><div id="summary-result"></div></section>
    <section class="staff-panel"><h2>テーブルQRコード</h2><form id="qr-form" class="staff-toolbar"><label>テーブル番号<input name="tableNo" type="number" min="1" max="999" value="1" required></label><button class="btn btn-outline-primary" type="submit">QRコードを作成</button></form><div id="qr-result"></div></section>`;
  $('#staff-view').querySelectorAll('[data-table]').forEach((button) => button.addEventListener('click', () => { selectedTableNo = Number(button.dataset.table); renderPos(calls); }));
  $('#load-summary').addEventListener('click', loadSummary);
  $('#print-summary').addEventListener('click', () => {
    const summary = $('#summary-result').innerHTML;
    $('#print-root').innerHTML = `<article class="receipt-paper"><h1>あじまるや</h1><p style="text-align:center">中島駅 · 日次集計</p><p>${esc($('#summary-date').value)}</p>${summary}</article>`;
    window.print();
  });
  $('#qr-form').addEventListener('submit', generateQr);
  $('#checkout-form')?.addEventListener('submit', checkout);
  loadSummary();
}

async function loadSummary() {
  const data = await api(`/api/staff/summary?date=${encodeURIComponent($('#summary-date').value || today)}`);
  const names = { cash: '現金', paypay: 'PayPay', card: 'クレジットカード' };
  $('#summary-result').innerHTML = `<div class="staff-grid mt-3"><div class="staff-stat"><span>売上合計 · ${data.date}</span><strong>${yen(data.sales)}</strong></div><div class="staff-stat"><span>注文数 / 割引</span><strong>${data.orders}件 · ${yen(data.discounts)}</strong></div>${Object.entries(data.methods).map(([key, amount]) => `<div class="staff-stat"><span>${names[key]}</span><strong>${yen(amount)}</strong></div>`).join('')}</div>`;
}

async function checkout(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  try {
    const receipt = await api('/api/staff/checkout', { method: 'POST', body: JSON.stringify({ tableNo: Number(form.dataset.tableNo), method: values.get('method'), discountType: values.get('discountType'), discountValue: values.get('discountValue') }) });
    notify('会計を完了しました。');
    printReceipt(receipt);
    selectedTableNo = null;
    await loadPos();
  } catch (error) { notify(error.message); }
}

async function acknowledgeCall(event) {
  const button = event.target.closest('[data-action="ack-call"]');
  if (!button) return;
  await fetch(`/api/notices/${button.dataset.noticeId}/ack`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tableNo: Number(button.dataset.tableNo) }) });
  await loadPos();
}

async function generateQr(event) {
  event.preventDefault();
  const tableNo = Number(new FormData(event.currentTarget).get('tableNo'));
  try {
    const result = await api(`/api/staff/qr/${tableNo}`);
    $('#qr-result').innerHTML = `<div class="qr-result"><img src="${result.dataUrl}" alt="${tableNo}番テーブルの注文QRコード"><a href="${esc(result.url)}">${esc(result.url)}</a><a class="btn btn-outline-secondary" download="ajimaruy-table-${tableNo}.png" href="${result.dataUrl}">PNGを保存</a></div>`;
  } catch (error) { notify(error.message); }
}

function renderMenuPage() {
  $('#staff-view').innerHTML = `${titlebar('メニュー管理', '商品、価格、追加オプション、在庫と欠品状態を編集します。')}
    <section class="staff-panel"><h2 id="menu-form-title">商品を追加</h2><form id="menu-form" class="staff-form"><div class="staff-form-grid"><label>ID<input class="form-control" name="id" type="number" required></label><label>商品名<input class="form-control" name="name" required></label><label>カテゴリー<input class="form-control" name="category" list="category-suggestions" required><datalist id="category-suggestions">${['定食', 'ナンセット', 'ナン単品', '鍋・麺', 'サブメニュー', 'ご飯', 'お子様メニュー', 'ドリンク', '飲み放題ドリンク', 'ラーメン', 'デザート', '飲み放題', 'お品書き', 'コース料理'].map((category) => `<option>${category}</option>`).join('')}</datalist></label><label>価格（円）<input class="form-control" name="price" type="number" min="0" step="1" required></label><label>在庫数<input class="form-control" name="stock" type="number" min="0" step="1" value="30" required></label><label class="d-flex align-items-center gap-2"><input name="soldOut" type="checkbox"> 欠品</label><div class="wide"><div class="option-editor-toolbar"><strong>オプション</strong><button id="add-option" class="btn btn-sm btn-outline-primary" type="button">+ OPTION</button></div><div id="option-rows"></div></div></div><div class="toolbar-group"><button class="btn btn-primary" type="submit">保存</button><button id="reset-menu-form" class="btn btn-outline-secondary" type="button">新規入力</button><span id="menu-form-feedback" role="status"></span></div></form></section>
    <section class="staff-panel"><h2>登録商品</h2><div id="menu-table"></div></section>`;
  $('#menu-form').addEventListener('submit', saveMenuItem);
  $('#reset-menu-form').addEventListener('click', resetMenuForm);
  $('#add-option').addEventListener('click', () => addOptionRow());
  $('#option-rows').addEventListener('click', (event) => {
    if (event.target.closest('[data-remove-option]')) event.target.closest('.option-row').remove();
  });
  $('#menu-table').addEventListener('click', menuTableAction);
  loadMenuItems();
}

function addOptionRow(option = {}) {
  const row = document.createElement('div');
  row.className = 'option-row';
  row.innerHTML = `<input data-option-group placeholder="項目名" value="${esc(option.group || '')}"><input data-option-name placeholder="選択肢" value="${esc(option.name || '')}"><input data-option-price type="number" min="0" step="1" value="${Number(option.extraPrice || 0)}" aria-label="追加料金"><button class="btn btn-sm btn-outline-danger" type="button" data-remove-option aria-label="オプションを削除">削除</button>`;
  $('#option-rows').append(row);
}

function readOptionRows() {
  const groups = new Map();
  for (const row of document.querySelectorAll('.option-row')) {
    const groupName = row.querySelector('[data-option-group]').value.trim();
    const choiceName = row.querySelector('[data-option-name]').value.trim();
    if (!groupName && !choiceName) continue;
    if (!groupName || !choiceName) throw new Error('オプションの項目名と選択肢を入力してください。');
    if (!groups.has(groupName)) groups.set(groupName, { name: groupName, choices: [] });
    groups.get(groupName).choices.push({ name: choiceName, extraPrice: Number(row.querySelector('[data-option-price]').value) || 0 });
  }
  return [...groups.values()];
}

async function loadMenuItems() {
  const items = await api('/api/staff/menu');
  $('#menu-table').innerHTML = `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>ID</th><th>商品名</th><th>カテゴリー</th><th>価格</th><th>在庫</th><th>状態</th><th>操作</th></tr></thead><tbody>${items.map((item) => `<tr><td>${item.id}</td><td>${esc(item.name)}</td><td>${esc(item.category)}</td><td>${yen(item.price)}</td><td>${item.stock}</td><td>${item.soldOut ? '欠品' : '販売中'}</td><td><div class="toolbar-group"><button class="btn btn-sm btn-outline-primary" data-action="edit" data-id="${item.id}">編集</button><button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${item.id}">削除</button></div></td></tr>`).join('')}</tbody></table></div>`;
}

function resetMenuForm() {
  $('#menu-form').reset();
  $('#menu-form').dataset.editing = '';
  $('#menu-form-title').textContent = '商品を追加';
  $('#menu-form-feedback').textContent = '';
  $('#menu-form').elements.stock.value = 30;
  $('#option-rows').replaceChildren();
}

async function saveMenuItem(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  let options;
  try { options = readOptionRows(); }
  catch (error) { return notify(error.message); }
  const item = { id: Number(values.get('id')), name: values.get('name'), category: values.get('category'), price: Number(values.get('price')), stock: Number(values.get('stock')), soldOut: values.has('soldOut'), options };
  try {
    const editing = form.dataset.editing;
    await api(editing ? `/api/staff/menu/${editing}` : '/api/staff/menu', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(item) });
    notify('メニューを保存しました。');
    resetMenuForm();
    await loadMenuItems();
  } catch (error) { notify(error.message); }
}

async function menuTableAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const id = Number(button.dataset.id);
  const items = await api('/api/staff/menu');
  const item = items.find((entry) => entry.id === id);
  if (!item) return;
  if (button.dataset.action === 'edit') {
    const form = $('#menu-form');
    form.dataset.editing = String(id);
    form.elements.id.value = item.id;
    form.elements.name.value = item.name;
    form.elements.category.value = item.category;
    form.elements.price.value = item.price;
    form.elements.stock.value = item.stock;
    form.elements.soldOut.checked = item.soldOut;
    $('#option-rows').replaceChildren();
    for (const group of item.options) for (const choice of group.choices || []) addOptionRow({ group: group.name, name: choice.name, extraPrice: choice.extraPrice });
    $('#menu-form-title').textContent = `商品を編集 · ${item.name}`;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (button.dataset.action === 'delete' && confirm(`${item.name}をメニューから削除しますか？`)) {
    await api(`/api/staff/menu/${id}`, { method: 'DELETE' });
    await loadMenuItems();
  }
}

function renderInventoryPage() {
  $('#staff-view').innerHTML = `${titlebar('棚卸', '注文ごとに在庫を自動で減算します。5個未満は残りわずか、0個で欠品になります。')}
    <section class="staff-panel"><div id="inventory-table"></div></section>`;
  $('#inventory-table').addEventListener('click', stocktake);
  loadInventory();
}

async function loadInventory() {
  const items = await api('/api/staff/inventory');
  $('#inventory-table').innerHTML = `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>商品</th><th>システム数</th><th>状態</th><th>実在庫</th><th>棚卸</th></tr></thead><tbody>${items.map((item) => `<tr class="${item.soldOut ? 'stock-out' : ''}" data-inventory-row="${item.id}"><td>${esc(item.name)}<small class="d-block text-secondary">${esc(item.category)}</small></td><td>${item.stock}</td><td class="${item.lowStock ? 'low-stock' : ''}">${item.soldOut ? '欠品' : item.lowStock ? '残りわずか' : '在庫あり'}</td><td><input class="form-control" type="number" min="0" step="1" value="${item.stock}" aria-label="${esc(item.name)}の実在庫"></td><td><button class="btn btn-sm btn-outline-primary" data-action="stocktake" data-id="${item.id}">差異を記録</button></td></tr>`).join('')}</tbody></table></div>`;
}

async function stocktake(event) {
  const button = event.target.closest('[data-action="stocktake"]');
  if (!button) return;
  const row = button.closest('[data-inventory-row]');
  const actualCount = Number(row.querySelector('input').value);
  try {
    const result = await api(`/api/staff/inventory/${button.dataset.id}/stocktake`, { method: 'POST', body: JSON.stringify({ actualCount }) });
    notify(`棚卸を記録しました。差異: ${result.difference > 0 ? '+' : ''}${result.difference}`);
    await loadInventory();
  } catch (error) { notify(error.message); }
}

function renderFinancePage() {
  const month = today.slice(0, 7);
  $('#staff-view').innerHTML = `${titlebar('財務・損益', '売上、仕入、経費、人件費を月ごとに確認します。')}
    <section class="staff-panel"><div class="staff-toolbar"><label>対象月<input id="finance-month" type="month" value="${month}"></label><button id="load-finance" class="btn btn-outline-primary">表示</button><button id="export-csv" class="btn btn-outline-secondary">CSVを書き出す</button></div><div id="finance-summary"></div></section>
    <section class="staff-panel"><h2>経費を登録</h2><form id="expense-form" class="staff-form"><div class="staff-form-grid"><label>日付<input class="form-control" name="date" type="date" value="${today}" required></label><label>区分<select class="form-control" name="category"><option>仕入</option><option>経費</option><option>人件費</option><option>その他</option></select></label><label>内容<input class="form-control" name="description" maxlength="200"></label><label>金額（円）<input class="form-control" name="amount" type="number" min="0" step="1" required></label></div><button class="btn btn-primary" type="submit">経費を登録</button></form></section>
    <section class="staff-panel"><h2>経費明細</h2><div id="expense-table"></div></section>`;
  $('#load-finance').addEventListener('click', loadFinance);
  $('#export-csv').addEventListener('click', exportFinanceCsv);
  $('#expense-form').addEventListener('submit', saveExpense);
  loadFinance();
}

let financeData = null;
async function loadFinance() {
  financeData = await api(`/api/staff/finance?month=${encodeURIComponent($('#finance-month').value)}`);
  const maxProfit = Math.max(1, ...financeData.daily.map((row) => Math.abs(row.profit)));
  $('#finance-summary').innerHTML = `<div class="staff-grid mt-3"><div class="staff-stat"><span>月間売上</span><strong>${yen(financeData.salesTotal)}</strong></div><div class="staff-stat"><span>月間経費</span><strong>${yen(financeData.expenseTotal)}</strong></div><div class="staff-stat"><span>月間利益 / 損失</span><strong>${yen(financeData.profit)}</strong></div></div><h2 class="h6 mt-4">日別損益</h2><div class="summary-bars">${financeData.daily.map((row) => `<div class="summary-bar"><span>${row.day.slice(5)}</span><div class="summary-bar-track"><div class="summary-bar-fill${row.profit < 0 ? ' is-negative' : ''}" style="width:${Math.max(2, Math.abs(row.profit) / maxProfit * 100)}%"></div></div><strong>${yen(row.profit)}</strong><small>売上 ${yen(row.sales)} · 経費 ${yen(row.expenses)}</small></div>`).join('') || '<p class="staff-empty">この月の損益データはありません。</p>'}</div>`;
  $('#expense-table').innerHTML = financeData.expenses.length ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>日付</th><th>区分</th><th>内容</th><th>金額</th></tr></thead><tbody>${financeData.expenses.map((expense) => `<tr><td>${expense.expense_date}</td><td>${esc(expense.category)}</td><td>${esc(expense.description)}</td><td>${yen(expense.amount)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="staff-empty">経費明細はありません。</p>';
}

async function saveExpense(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  values.amount = Number(values.amount);
  try {
    await api('/api/staff/expenses', { method: 'POST', body: JSON.stringify(values) });
    notify('経費を登録しました。');
    form.reset();
    await loadFinance();
  } catch (error) { notify(error.message); }
}

function exportFinanceCsv() {
  if (!financeData) return;
  const rows = [['日付', '区分', '内容', '金額'], ...financeData.sales.map((row) => [row.day, '売上', '決済売上', row.amount]), ...financeData.expenses.map((row) => [row.expense_date, row.category, row.description, row.amount])];
  const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = Object.assign(document.createElement('a'), { href: url, download: `ajimaruy-${financeData.month}.csv` });
  anchor.click();
  URL.revokeObjectURL(url);
}

async function renderAuthenticatedView() {
  $('#staff-login').hidden = true;
  $('#staff-content').hidden = false;
  $('#logout').hidden = false;
  if (view === 'kitchen') renderKitchen();
  if (view === 'pos') await loadPos();
  if (view === 'menu') renderMenuPage();
  if (view === 'inventory') renderInventoryPage();
  if (view === 'finance') renderFinancePage();
}

async function authenticate() {
  if (token) {
    try {
      await api('/api/staff/orders');
      await renderAuthenticatedView();
      return;
    } catch { sessionStorage.removeItem('ajimaruyStaffToken'); token = ''; }
  }
  $('#staff-content').hidden = true;
  $('#staff-login').hidden = false;
  $('#pin-input').focus();
}

$('#pin-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/staff/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: $('#pin-input').value }) });
  const data = await response.json();
  if (!response.ok) { $('#login-error').textContent = data.error || 'ログインできませんでした。'; return; }
  token = data.token;
  sessionStorage.setItem('ajimaruyStaffToken', token);
  audioContext ||= new AudioContext();
  authenticate();
});

$('#logout').addEventListener('click', () => {
  sessionStorage.removeItem('ajimaruyStaffToken');
  token = '';
  location.reload();
});

$('#staff-view').addEventListener('click', async (event) => {
  const statusButton = event.target.closest('[data-action="item-status"]');
  const pickupButton = event.target.closest('[data-action="pickup"]');
  const callButton = event.target.closest('[data-action="ack-call"]');
  const announcementButton = event.target.closest('[data-announcement]');
  try {
    if (callButton) return acknowledgeCall(event);
    if (statusButton) {
      await api(`/api/staff/order-items/${statusButton.dataset.itemId}/status`, { method: 'POST', body: JSON.stringify({ status: statusButton.dataset.status }) });
      await loadKitchen();
    }
    if (pickupButton) {
      await api(`/api/staff/tables/${pickupButton.dataset.tableNo}/notice`, { method: 'POST', body: JSON.stringify({ type: 'pickup', orderId: pickupButton.dataset.orderId }) });
      notify('受け取り通知を送りました。');
      await loadKitchen();
    }
    if (announcementButton) {
      const type = announcementButton.dataset.announcement;
      const result = await api('/api/staff/announcement', { method: 'POST', body: JSON.stringify({ type, showCustomers: $('#customer-broadcast').checked }) });
      speak(result.message);
      notify(`${result.message}をアナウンスしました。`);
    }
  } catch (error) { notify(error.message); }
});

const eventStream = new EventSource('/api/events');
document.body.classList.toggle('paper-58mm', localStorage.getItem('ajimaruyPaperWidth') === '58');
eventStream.addEventListener('message', async (event) => {
  if (!token || $('#staff-content').hidden) return;
  const update = JSON.parse(event.data);
  try {
    if (update.type === 'staff.call' && view === 'pos') { soundAlert(); await loadPos(); }
    if (view === 'kitchen' && update.type === 'order.created') await loadKitchen(update.orderId);
    else if (view === 'kitchen' && ['order.updated', 'table.closed'].includes(update.type)) await loadKitchen();
    if (view === 'pos' && ['order.created', 'table.closed', 'staff.call'].includes(update.type)) await loadPos();
    if (view === 'menu' && update.type === 'menu.updated') await loadMenuItems();
    if (view === 'inventory' && ['inventory.updated', 'order.created'].includes(update.type)) await loadInventory();
    if (view === 'finance' && update.type === 'table.closed') await loadFinance();
  } catch (error) { notify(error.message); }
});

authenticate();