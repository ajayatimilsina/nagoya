const categories = ['定食', 'ナンセット', 'ナン単品', '鍋・麺', 'サブメニュー', 'ご飯', 'お子様メニュー', 'ドリンク', '飲み放題ドリンク', 'ラーメン', 'デザート', '飲み放題', 'お品書き', 'コース料理'];
const labels = { received: '受付', preparing: '調理中', ready: '完成（カウンターへ）', served: '提供済み' };
const tableNo = Math.max(1, Math.min(999, Number(new URLSearchParams(location.search).get('table')) || 1));
const cart = new Map();
let menuItems = [];
let toastTimer;

const $ = (selector, root = document) => root.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const yen = (amount) => `¥${Number(amount).toLocaleString('ja-JP')}`;

$('#table-heading').textContent = `Table ${tableNo}`;
for (const value of Array.from({ length: 10 }, (_, index) => index + 1)) $('#adults').add(new Option(String(value), String(value), value === 2, value === 2));
for (const value of Array.from({ length: 10 }, (_, index) => index)) $('#children').add(new Option(String(value), String(value), value === 0, value === 0));

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

function selectedOptions(card) {
  return [...card.querySelectorAll('[data-option-group]')].map((select) => {
    const choice = JSON.parse(select.value);
    return choice ? { group: select.dataset.optionGroup, ...choice } : null;
  }).filter(Boolean);
}

function lineKey(itemId, options) {
  return `${itemId}:${JSON.stringify(options)}`;
}

function quantityFor(itemId) {
  return [...cart.values()].filter((line) => line.menuItemId === itemId).reduce((sum, line) => sum + line.quantity, 0);
}

function cartTotal() {
  return [...cart.values()].reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
}

function updateDock() {
  const count = [...cart.values()].reduce((sum, line) => sum + line.quantity, 0);
  $('#cart-count').textContent = `${count}点`;
  $('#cart-total').textContent = yen(cartTotal());
  $('#open-cart').disabled = count === 0;
}

function renderMenu() {
  $('#category-nav').innerHTML = categories.map((category, index) => `<button class="category-tab" type="button" data-category="${escapeHtml(category)}" aria-current="${index === 0}">${escapeHtml(category)}</button>`).join('');
  $('#menu-sections').innerHTML = categories.map((category) => {
    const items = menuItems.filter((item) => item.category === category);
    return `<section class="menu-section" id="category-${encodeURIComponent(category)}" data-menu-category="${escapeHtml(category)}">
      <div class="section-heading"><h2>${escapeHtml(category)}</h2><span>${items.length ? `${items.length}品` : ''}</span></div>
      ${items.length ? `<div class="product-list">${items.map(renderProduct).join('')}</div>` : '<p class="empty-category">準備中です。</p>'}
    </section>`;
  }).join('');
  document.querySelectorAll('.category-tab').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('.category-tab').forEach((tab) => tab.setAttribute('aria-current', 'false'));
    button.setAttribute('aria-current', 'true');
    document.getElementById(`category-${encodeURIComponent(button.dataset.category)}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

function renderProduct(item) {
  const unavailable = item.soldOut || item.stock <= 0;
  const optionMarkup = item.options.map((group, groupIndex) => `<label class="option-field">${escapeHtml(group.name)}<select data-option-group="${escapeHtml(group.name)}" aria-label="${escapeHtml(group.name)}">
    <option value="null">選択してください</option>${group.choices.map((choice) => `<option value='${escapeHtml(JSON.stringify({ name: choice.name, extraPrice: choice.extraPrice || 0 }))}'>${escapeHtml(choice.name)}${choice.extraPrice ? ` +${yen(choice.extraPrice)}` : ''}</option>`).join('')}
  </select></label>`).join('');
  return `<article class="product-card${unavailable ? ' is-sold-out' : ''}" data-item-id="${item.id}">
    <div class="product-top"><h3 class="product-name">${escapeHtml(item.name)}${unavailable ? ' <small>欠品</small>' : ''}</h3><span class="product-price">${yen(item.price)}</span></div>
    ${item.description ? `<p class="product-detail">${escapeHtml(item.description)}</p>` : ''}
    ${optionMarkup ? `<div class="option-list">${optionMarkup}</div>` : ''}
    <div class="quantity-control"><button type="button" data-action="minus" aria-label="${escapeHtml(item.name)}を減らす" ${unavailable ? 'disabled' : ''}>−</button><span class="quantity-number">${quantityFor(item.id)}</span><button type="button" data-action="plus" aria-label="${escapeHtml(item.name)}を増やす" ${unavailable ? 'disabled' : ''}>+</button></div>
  </article>`;
}

function rerenderQuantities() {
  document.querySelectorAll('.product-card').forEach((card) => {
    card.querySelector('.quantity-number').textContent = quantityFor(Number(card.dataset.itemId));
  });
}

function addItem(card) {
  const menuItemId = Number(card.dataset.itemId);
  const options = selectedOptions(card);
  const key = lineKey(menuItemId, options);
  const item = menuItems.find((entry) => entry.id === menuItemId);
  const existing = cart.get(key);
  if (quantityFor(menuItemId) >= item.stock) return showToast('在庫数を超えて注文できません。');
  cart.set(key, { key, menuItemId, name: item.name, basePrice: item.price, unitPrice: item.price + options.reduce((sum, option) => sum + Number(option.extraPrice || 0), 0), options, quantity: (existing?.quantity || 0) + 1, note: existing?.note || '' });
  updateDock();
  rerenderQuantities();
}

function renderCart() {
  const lines = [...cart.values()];
  $('#cart-lines').innerHTML = lines.map((line) => `<article class="cart-line" data-cart-key="${escapeHtml(line.key)}">
    <div><h3>${escapeHtml(line.name)}</h3><p>${line.options.map((option) => `${escapeHtml(option.group)}: ${escapeHtml(option.name)}`).join(' / ') || '通常'}</p><p>${yen(line.unitPrice)} × ${line.quantity}</p></div>
    <div class="cart-line-actions"><button type="button" data-cart-action="minus" aria-label="1つ減らす">−</button><strong>${line.quantity}</strong><button type="button" data-cart-action="plus" aria-label="1つ増やす">+</button></div>
    <input data-note-for="${escapeHtml(line.key)}" maxlength="300" value="${escapeHtml(line.note)}" placeholder="この商品のご要望">
  </article>`).join('') || '<p class="empty-category">商品を選んでください。</p>';
  $('#dialog-total').textContent = yen(cartTotal());
}

function updatePartyCount() {
  const count = Number($('#adults').value) + Number($('#children').value);
  $('#party-total').textContent = `合計 ${count}名`;
  $('#cart-party').textContent = `${count}名`;
}

async function refreshTable() {
  const response = await fetch(`/api/customer/tables/${tableNo}`);
  const data = await response.json();
  renderStatus(data.orders || []);
  renderNotices(data.notices || []);
}

function renderStatus(orders) {
  const active = orders.filter((order) => order.status !== 'served');
  $('#status-region').innerHTML = active.length ? `<section class="order-status"><h2>ご注文状況</h2>${active.map((order) => `<div class="status-line"><span>${new Date(order.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} · ${order.items.reduce((sum, item) => sum + item.quantity, 0)}点</span><strong>${labels[order.status] || labels.received}</strong></div>`).join('')}</section>` : '';
}

function renderNotices(notices) {
  $('#notice-region').innerHTML = notices.map((notice) => `<div class="notice-banner ${notice.type}" data-notice-id="${notice.id}"><span>${escapeHtml(notice.message)}</span><button type="button" data-ack="${notice.id}">受け取りました</button></div>`).join('');
}

async function acknowledgeNotice(id) {
  await fetch(`/api/notices/${id}/ack`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tableNo }) });
  refreshTable();
}

async function callStaff() {
  const response = await fetch(`/api/tables/${tableNo}/call`, { method: 'POST' });
  if (response.ok) showToast('店員を呼びました。少々お待ちください。');
}

async function submitOrder() {
  const payload = {
    tableNo,
    adults: Number($('#adults').value),
    children: Number($('#children').value),
    gender: $('#gender').value,
    allergy: $('#allergy').value,
    memberPrice: $('#member-price').checked,
    receiptNeeded: $('#receipt-needed').checked,
    addressee: $('#addressee').value.trim(),
    notes: $('#order-notes').value.trim(),
    items: [...cart.values()].map((line) => ({ menuItemId: line.menuItemId, quantity: line.quantity, options: line.options, note: line.note }))
  };
  if (payload.receiptNeeded && !payload.addressee) return showToast('領収書の宛名を入力してください。');
  const button = $('#submit-order');
  button.disabled = true;
  try {
    const response = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '注文を送信できませんでした。');
    cart.clear();
    $('#order-notes').value = '';
    $('#cart-dialog').close();
    updateDock();
    rerenderQuantities();
    await refreshTable();
    showToast('ご注文を受け付けました。');
    loadMenu();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function loadMenu() {
  const response = await fetch('/api/menu');
  menuItems = await response.json();
  renderMenu();
}

$('#menu-sections').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const card = button.closest('.product-card');
  if (button.dataset.action === 'plus') addItem(card);
  if (button.dataset.action === 'minus') {
    const itemId = Number(card.dataset.itemId);
    const key = [...cart.keys()].reverse().find((candidate) => candidate.startsWith(`${itemId}:`));
    if (key) {
      const line = cart.get(key);
      if (line.quantity <= 1) cart.delete(key);
      else line.quantity -= 1;
      updateDock();
      rerenderQuantities();
    }
  }
});

$('#open-cart').addEventListener('click', () => { renderCart(); $('#cart-dialog').showModal(); });
$('#cancel-order').addEventListener('click', () => $('#cart-dialog').close());
$('#submit-order').addEventListener('click', submitOrder);
$('#cart-lines').addEventListener('input', (event) => {
  const key = event.target.dataset.noteFor;
  if (key && cart.has(key)) cart.get(key).note = event.target.value;
});
$('#cart-lines').addEventListener('click', (event) => {
  const button = event.target.closest('[data-cart-action]');
  if (!button) return;
  const row = button.closest('[data-cart-key]');
  const line = cart.get(row.dataset.cartKey);
  if (button.dataset.cartAction === 'plus') {
    const item = menuItems.find((entry) => entry.id === line.menuItemId);
    if (quantityFor(item.id) >= item.stock) return showToast('在庫数を超えて注文できません。');
    line.quantity += 1;
  } else if (line.quantity <= 1) cart.delete(line.key);
  else line.quantity -= 1;
  renderCart();
  updateDock();
  rerenderQuantities();
});
$('#receipt-needed').addEventListener('change', (event) => { $('#addressee-field').hidden = !event.target.checked; });
$('#adults').addEventListener('change', updatePartyCount);
$('#children').addEventListener('change', updatePartyCount);
$('#call-staff-footer').addEventListener('click', callStaff);
$('#notice-region').addEventListener('click', (event) => { if (event.target.dataset.ack) acknowledgeNotice(event.target.dataset.ack); });

const events = new EventSource('/api/events');
events.addEventListener('message', (event) => {
  const update = JSON.parse(event.data);
  if (update.tableNo === tableNo || update.tableNo === 0 || update.type === 'menu.updated') {
    refreshTable();
    if (update.type === 'menu.updated') loadMenu();
    if (update.type === 'table.closed' && update.tableNo === tableNo) showToast('ありがとうございました');
    if (update.type === 'customer.notice' && update.notice?.type === 'pickup' && update.tableNo === tableNo && navigator.vibrate) navigator.vibrate([120, 80, 120]);
  }
});

loadMenu().then(refreshTable).catch(() => { $('#menu-sections').innerHTML = '<p class="empty-category">メニューを読み込めませんでした。ページを更新してください。</p>'; });
updatePartyCount();