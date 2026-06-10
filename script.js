let categories = ['Todos'];
let products = [];
let store = { name: 'Gabriel Pizza', description: 'Pizzaria artesanal', phone: '5588992258066', displayPhone: '(88) 9 9225-8066', pixKey: '88992258066', isOpen: true, closedMessage: '' };
let deliveryConfig = { commonFee: 8, maxRadiusKm: 8, perKmFee: 1, condominiums: [{ id: 'reserva-garcas-1', name: 'Condominio Reserva das Garcas 1', fee: 4 }] };
let coupons = [];

const screenIds = ['cardapio', 'produto', 'pedido', 'admin', 'inicio'];
const state = { category: '', query: '', cart: [], activeComboId: null, detailProductId: null, deliveryQuote: null };
const adminState = { token: localStorage.getItem('adminToken') || '', email: localStorage.getItem('adminEmail') || '', products: [], categories: [], knownOrderIds: new Set(), orderPoller: null, firstOrdersLoad: true, activePanel: 'dashboard' };
const money = value => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const $ = selector => document.querySelector(selector);

function currentPixKey() {
  return String(store.pixKey || '88992258066').trim();
}

function activeCoupon(code) {
  const wanted = String(code || '').trim().toUpperCase();
  if (!wanted) return null;
  return coupons.find(coupon => String(coupon.code || coupon).toUpperCase() === wanted && coupon.active !== false) || null;
}

function currentScreenId() {
  const hash = window.location.hash.replace('#', '');
  return screenIds.includes(hash) ? hash : 'cardapio';
}

function routeToScreen() {
  const activeId = currentScreenId();
  if (activeId === 'pedido' && !store.isOpen) {
    window.location.hash = '#cardapio';
    return;
  }
  if (activeId === 'produto' && !state.detailProductId) {
    window.location.hash = '#cardapio';
    return;
  }
  document.querySelectorAll('.screen').forEach(section => section.classList.toggle('active', section.id === activeId));
  document.querySelectorAll('.desktop-nav a').forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${activeId}`));
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (activeId === 'produto') renderProductDetail();
  if (activeId === 'admin') refreshAdminView();
}

function adminHeaders() {
  return adminState.token ? { Authorization: `Bearer ${adminState.token}` } : {};
}

async function loadMenu() {
  try {
    const response = await fetch(`/api/menu?ts=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Nao foi possivel carregar o cardapio');
    const data = await response.json();
    categories = data.categories;
    products = data.products;
    store = data.store;
    deliveryConfig = data.delivery;
    coupons = data.coupons;
    renderStoreStatus();
    renderCondominiumOptions();
  } catch (error) {
    console.warn(error.message);
    $('#productGrid').innerHTML = '<p class="empty">Nao foi possivel carregar o cardapio agora.</p>';
  }
}

function renderStoreStatus() {
  const banner = $('#storeStatusBanner');
  if (!banner) return;
  banner.className = `store-status-banner ${store.isOpen ? 'open' : 'closed'}`;
  banner.textContent = store.isOpen ? 'aberta para pedidos' : (store.closedMessage || 'Estamos fechados no momento. Pedidos online indisponiveis.');
  document.querySelectorAll('.status-pill').forEach(item => { item.textContent = store.isOpen ? 'aberta para pedidos' : 'Fechado agora'; });
  document.querySelectorAll('.brand strong, .profile-row strong').forEach(item => { item.textContent = store.name; });
  document.querySelector('.admin-session-bar strong') && (document.querySelector('.admin-session-bar strong').textContent = `${store.name} Admin`);
  document.querySelector('.brand small') && (document.querySelector('.brand small').textContent = store.description || 'Pizzaria artesanal');
  document.querySelector('.profile-row p') && (document.querySelector('.profile-row p').textContent = store.address || '');
  document.querySelector('.store-info dd') && (document.querySelector('.store-info dd').textContent = store.displayPhone || '');
  document.querySelector('.whatsapp-mini')?.setAttribute('href', `https://wa.me/${String(store.phone || '').replace(/\D/g, '')}`);
  document.body.classList.toggle('store-closed', !store.isOpen);
  document.querySelectorAll('a[href="#pedido"]').forEach(link => link.classList.toggle('hidden', !store.isOpen));
  if (!store.isOpen) closeProductDetail();
}

function renderCategories() {
  $('#categoryTabs').innerHTML = customerCategories().map(category => `<button class="${category === state.category ? 'active' : ''}" data-category="${category}">${category}</button>`).join('');
}

function customerCategories() {
  return categories.filter(category => category !== 'Todos');
}

function firstCustomerCategory() {
  return customerCategories()[0] || 'Todos';
}

function syncSelectedCategory() {
  if (state.category === 'Todos' || !categories.includes(state.category)) state.category = firstCustomerCategory();
}

function renderCondominiumOptions() {
  const select = $('#condominiumSelect');
  if (!select) return;
  const condos = deliveryConfig.condominiums || [];
  select.innerHTML = condos.map(condo => `<option value="${condo.id}" ${condo.id === 'reserva-garcas-1' ? 'selected' : ''}>${condo.name}</option>`).join('');
}

function pizzaProducts() {
  return products.filter(product => product.category.startsWith('Pizzas') && product.visibleInMenu !== false && !product.outOfStock);
}

function comboPizzaBuilderCard(combo) {
  const pizzas = comboFlavorProducts(combo);
  if (!combo || !combo.comboAllowHalf || pizzas.length < 1 || state.activeComboId !== combo.id) return '';
  const options = pizzas.map(product => `<option value="${product.id}">${product.name} - ${money(product.price)}</option>`).join('');
  return `
    <article class="product-card half-card combo-builder-card">
      <div class="product-body">
        <div class="product-meta"><h3>${combo.name}</h3><span class="product-price" id="halfPizzaPrice">${money(combo.price)}</span></div>
        <p>Este combo permite escolher uma pizza inteira ou metade de um sabor e metade de outro. O valor do combo fica o cadastrado no admin.</p>
        <label>Tipo<select id="pizzaBuildMode"><option value="whole">Pizza inteira de um sabor</option><option value="half">Meio a meio</option></select></label>
        <label>Primeiro sabor<select id="halfFlavorA">${options}</select></label>
        <label id="halfFlavorBLabel" class="hidden">Segundo sabor<select id="halfFlavorB">${options}</select></label>
        <div class="combo-builder-actions">
          <button class="add-btn" id="addHalfPizza" type="button" data-combo-id="${combo.id}" ${store.isOpen ? '' : 'disabled'}>${store.isOpen ? 'Adicionar combo' : 'Loja fechada'}</button>
          <button class="ghost-btn" type="button" data-close-combo>Fechar</button>
        </div>
      </div>
    </article>
  `;
}

function updateHalfPizzaPrice() {
  const priceEl = $('#halfPizzaPrice');
  const a = $('#halfFlavorA');
  const b = $('#halfFlavorB');
  const mode = $('#pizzaBuildMode')?.value || 'whole';
  $('#halfFlavorBLabel')?.classList.toggle('hidden', mode !== 'half');
  if (!priceEl || !a) return;
  const combo = products.find(product => product.id === state.activeComboId);
  priceEl.textContent = combo ? money(combo.price) : '-';
}

function comboFlavorProducts(combo) {
  if (combo?.comboProductIds?.length) {
    return products.filter(product => combo.comboProductIds.includes(product.id) && product.category.startsWith('Pizzas') && !product.outOfStock);
  }
  return pizzaProducts();
}

function isComboProduct(product) {
  return product?.category === 'Combos' || Boolean(product?.comboProductIds?.length);
}

function detailFlavorOptions(combo) {
  return comboFlavorProducts(combo).map(product => `<option value="${product.id}">${product.name} - ${money(product.price)}</option>`).join('') || '<option value="">Nenhum sabor disponivel</option>';
}

function comboAllowsHalf(combo) {
  return comboFlavorProducts(combo).some(product => product.categoryAllowHalf || product.category.startsWith('Pizzas'));
}

function comboIncludedGroups(combo) {
  if (!combo?.comboProductIds?.length) return '';
  const selected = comboExtraProducts(combo);
  if (!selected.length) return '';
  const groups = selected.reduce((result, product) => {
    if (!result[product.category]) result[product.category] = [];
    result[product.category].push(product);
    return result;
  }, {});
  return `
    <div class="combo-included">
      <strong>Tambem incluso no combo</strong>
      ${Object.entries(groups).map(([category, items]) => `
        <section class="combo-included-group">
          <span>${category}</span>
          ${items.map(item => `<div class="combo-included-item"><small>${item.name}</small><b>${comboProductDiscount(combo, item.id) > 0 ? `${money(discountedProductPrice(combo, item))} <em>${money(item.price)}</em>` : money(item.price)}</b></div>`).join('')}
        </section>
      `).join('')}
    </div>
  `;
}

function comboProductDiscount(combo, productId) {
  const discounts = combo?.comboProductDiscounts || {};
  return Math.max(0, Number(discounts[String(productId)] ?? discounts[productId] ?? 0) || 0);
}

function discountedProductPrice(combo, product) {
  return Math.max(0, (Number(product?.price) || 0) - comboProductDiscount(combo, product?.id));
}

function comboExtraProducts(combo) {
  if (!combo?.comboProductIds?.length) return [];
  return products.filter(product => combo.comboProductIds.includes(product.id) && !product.category.startsWith('Pizzas') && !product.outOfStock);
}

function comboSelectionPrice(combo) {
  const flavorA = products.find(item => item.id === Number($('#detailFlavorA')?.value));
  const flavorB = products.find(item => item.id === Number($('#detailFlavorB')?.value));
  if (!flavorA) return Number(combo?.price || 0);
  const secondFlavor = comboAllowsHalf(combo) ? (flavorB || flavorA) : flavorA;
  const pizzaAverage = (discountedProductPrice(combo, flavorA) + discountedProductPrice(combo, secondFlavor)) / 2;
  const extrasTotal = comboExtraProducts(combo).reduce((total, product) => total + discountedProductPrice(combo, product), 0);
  return Number((pizzaAverage + extrasTotal).toFixed(2));
}

function openProductDetail(productId) {
  const product = products.find(item => item.id === Number(productId));
  if (!product || !store.isOpen) return;
  state.detailProductId = product.id;
  window.location.hash = '#produto';
  renderProductDetail();
}

function closeProductDetail() {
  state.detailProductId = null;
  const detail = $('#productDetail');
  if (detail) {
    detail.classList.add('hidden');
    detail.setAttribute('aria-hidden', 'true');
    detail.innerHTML = '';
  }
  const page = $('#productDetailPage');
  if (page) page.innerHTML = '';
  if (currentScreenId() === 'produto') window.location.hash = '#cardapio';
}

function renderProductDetail() {
  const product = products.find(item => item.id === state.detailProductId);
  const detail = $('#productDetailPage');
  if (!detail || !product || !store.isOpen) { closeProductDetail(); return; }
  const comboBuilder = isComboProduct(product) && comboFlavorProducts(product).length > 0;
  const allowHalf = comboAllowsHalf(product);
  detail.innerHTML = `
    <section class="product-detail-screen" aria-label="Detalhes do produto">
      <button class="detail-close" type="button" data-close-detail aria-label="Voltar">Voltar</button>
      <div class="detail-media" style="background-image: url('${product.image}')"></div>
      <div class="detail-content">
        <span class="detail-category">${product.category}</span>
        <div class="product-meta"><h2>${product.name}</h2>${comboBuilder ? `<span class="product-price" id="detailComboPrice">${money(product.price)}</span>` : `<span class="product-price">${money(product.price)}</span>`}</div>
        <p>${product.desc}</p>
        <div class="ingredients">Ingredientes: ${product.ingredients}</div>
        ${isComboProduct(product) ? comboIncludedGroups(product) : ''}
        ${comboBuilder ? `
          <div class="combo-pizza-builder">
            <strong>Escolha a pizza do combo</strong>
            <label id="detailFlavorALabel">${allowHalf ? 'Primeiro sabor' : 'Sabor'}<select id="detailFlavorA">${detailFlavorOptions(product)}</select></label>
            ${allowHalf ? `<label id="detailFlavorBLabel">Segundo sabor<select id="detailFlavorB">${detailFlavorOptions(product)}</select></label>` : ''}
          </div>
          <small class="price-hint">${allowHalf ? 'Escolha dois sabores. Para pizza inteira, selecione o mesmo sabor duas vezes.' : 'Esta categoria aceita um sabor neste combo.'}</small>
        ` : ''}
        <label>Quantidade<input id="detailQty" type="number" min="1" max="20" value="1" /></label>
        <button class="button primary full" type="button" data-detail-add="${product.id}">Adicionar ao carrinho</button>
      </div>
    </section>
  `;
  syncDetailMode();
}

function syncDetailMode() {
  const product = products.find(item => item.id === state.detailProductId);
  const price = $('#detailComboPrice');
  if (product && price) price.textContent = money(comboSelectionPrice(product));
}

function renderProducts() {
  const query = state.query.trim().toLowerCase();
  const visible = products.filter(product => {
    if (product.visibleInMenu === false || product.outOfStock) return false;
    const matchesCategory = state.category === 'Todos' || !customerCategories().length || product.category === state.category;
    const matchesQuery = !query || [product.name, product.desc, product.ingredients].join(' ').toLowerCase().includes(query);
    return matchesCategory && matchesQuery;
  });
  $('#productGrid').innerHTML = visible.map(product => `
    <article class="product-card">
      <div class="product-image" style="background-image: url('${product.image}')"></div>
      <div class="product-body">
        <div class="product-meta"><h3>${product.name}</h3><span class="product-price">${money(product.price)}</span></div>
        <p>${product.desc}</p>
        <div class="ingredients">Ingredientes: ${product.ingredients}</div>
        ${store.isOpen ? `<button class="add-btn" data-detail="${product.id}">${isComboProduct(product) ? 'Escolher combo' : 'Ver produto'}</button>` : ''}
      </div>
    </article>
  `).join('') || '<p class="empty">Nenhum produto encontrado.</p>';
  updateHalfPizzaPrice();
}

function getFees() {
  const subtotal = state.cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const isCondo = $('#addressMode').value === 'condo';
  const condoId = $('#condominiumSelect')?.value || 'reserva-garcas-1';
  const condoFee = deliveryConfig.condominiums?.find(condo => condo.id === condoId)?.fee ?? 4;
  const distance = Number(state.deliveryQuote?.distanceKm || 0);
  const commonFee = (deliveryConfig.commonFee ?? 8) + (distance > 0 ? distance * (deliveryConfig.perKmFee ?? 0) : 0);
  const delivery = subtotal ? (isCondo ? condoFee : commonFee) : 0;
  const coupon = $('#couponInput').value.trim().toUpperCase();
  const couponData = activeCoupon(coupon);
  const couponExpired = couponData?.maxUses != null && couponData.usedCount >= couponData.maxUses;
  const discount = couponData && !couponExpired ? subtotal * (Number(couponData.value || 0) / 100) : 0;
  return { subtotal, delivery, discount, total: Math.max(0, subtotal + delivery - discount) };
}

function renderCouponMessage() {
  const message = $('#couponMessage');
  if (!message) return;
  const code = $('#couponInput').value.trim().toUpperCase();
  if (!code) { message.textContent = ''; message.className = 'field-message'; return; }
  const coupon = activeCoupon(code);
  if (!coupon) {
    message.textContent = 'Cupom invalido.';
    message.className = 'field-message error';
    return;
  }
  if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
    message.textContent = 'Este cupom ja foi utilizado a quantidade maxima.';
    message.className = 'field-message error';
    return;
  }
  const remaining = coupon.maxUses == null ? 'uso ilimitado' : `${coupon.maxUses - coupon.usedCount} usos restantes`;
  message.textContent = `Cupom aplicado: ${coupon.value}% de desconto, ${remaining}.`;
  message.className = 'field-message ok';
}

function renderCart() {
  const itemCount = state.cart.reduce((sum, item) => sum + item.qty, 0);
  $('#cartCount').textContent = `${itemCount} itens`;
  $('#cartItems').innerHTML = state.cart.length ? state.cart.map(item => `
    <div class="cart-row">
      <div><strong>${item.name}</strong><small>${money(item.price)} cada</small></div>
      <div class="qty"><button data-dec="${item.id}">-</button><strong>${item.qty}</strong><button data-inc="${item.id}">+</button></div>
    </div>
  `).join('') : '<div class="empty">Seu carrinho esta vazio.</div>';
  const fees = getFees();
  $('#subtotal').textContent = money(fees.subtotal);
  $('#deliveryFee').textContent = money(fees.delivery);
  $('#discount').textContent = `-${money(fees.discount)}`;
  $('#total').textContent = money(fees.total);
  $('#cartFabCount').textContent = itemCount;
  $('#cartFabTotal').textContent = money(fees.total);
  $('#cartFab').classList.toggle('show', store.isOpen && itemCount > 0 && currentScreenId() !== 'pedido');
  renderCouponMessage();
}

function cartKey(id) { return String(id); }

function addToCart(id, button, qty = 1) {
  if (!store.isOpen) { alert(store.closedMessage || 'Estamos fechados no momento.'); return; }
  const product = products.find(item => item.id === id);
  if (!product) return;
  const existing = state.cart.find(item => cartKey(item.id) === cartKey(id));
  if (existing) existing.qty += qty;
  else state.cart.push({ ...product, qty });
  if (button) {
    button.classList.add('added');
    button.textContent = 'Adicionado';
    setTimeout(() => { button.classList.remove('added'); button.textContent = 'Adicionar ao carrinho'; }, 900);
  }
  renderCart();
}

function addHalfPizza() {
  if (!store.isOpen) { alert(store.closedMessage || 'Estamos fechados no momento.'); return; }
  const combo = products.find(product => product.id === Number($('#addHalfPizza')?.dataset.comboId));
  if (!combo || !combo.comboAllowHalf) return;
  const mode = $('#pizzaBuildMode')?.value || 'whole';
  const flavorA = products.find(product => product.id === Number($('#halfFlavorA')?.value));
  const flavorB = products.find(product => product.id === Number($('#halfFlavorB')?.value));
  if (!flavorA || (mode === 'half' && !flavorB)) return;
  const id = mode === 'half' ? `combo-${combo.id}-half-${flavorA.id}-${flavorB.id}` : `combo-${combo.id}-whole-${flavorA.id}`;
  const existing = state.cart.find(item => item.id === id);
  if (existing) existing.qty += 1;
  else {
    const name = mode === 'half' ? `${combo.name}: ${flavorA.name} / ${flavorB.name}` : `${combo.name}: ${flavorA.name}`;
    state.cart.push({ id, customType: 'comboPizza', comboId: combo.id, mode, flavorA: flavorA.id, flavorB: flavorB?.id || null, name, category: 'Combos', price: combo.price, qty: 1 });
  }
  renderCart();
}

function addDetailToCart(productId) {
  if (!store.isOpen) return;
  const product = products.find(item => item.id === Number(productId));
  const qty = Math.max(1, Number($('#detailQty')?.value || 1));
  if (!product) return;
  if (isComboProduct(product) && comboFlavorProducts(product).length > 0) {
    const mode = comboAllowsHalf(product) ? 'half' : 'whole';
    const flavorA = products.find(item => item.id === Number($('#detailFlavorA')?.value));
    const flavorB = products.find(item => item.id === Number($('#detailFlavorB')?.value));
    if (!flavorA || (mode === 'half' && !flavorB)) { alert('Escolha os sabores da pizza do combo.'); return; }
    const id = mode === 'half' ? `combo-${product.id}-half-${flavorA.id}-${flavorB.id}` : `combo-${product.id}-whole-${flavorA.id}`;
    const existing = state.cart.find(item => item.id === id);
    if (existing) existing.qty += qty;
    else {
      const name = mode === 'half' ? `${product.name}: ${flavorA.name} / ${flavorB.name}` : `${product.name}: ${flavorA.name}`;
      state.cart.push({ id, customType: 'comboPizza', comboId: product.id, mode, flavorA: flavorA.id, flavorB: flavorB?.id || null, name, category: 'Combos', price: comboSelectionPrice(product), qty });
    }
    renderCart();
  } else {
    addToCart(product.id, null, qty);
  }
  closeProductDetail();
  window.location.hash = '#pedido';
}

function changeQty(id, delta) {
  const item = state.cart.find(product => cartKey(product.id) === cartKey(id));
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) state.cart = state.cart.filter(product => cartKey(product.id) !== cartKey(id));
  renderCart();
}

function syncAddressMode() {
  const condo = $('#addressMode').value === 'condo';
  $('#commonAddress').classList.toggle('hidden', condo);
  $('#condoAddress').classList.toggle('hidden', !condo);
  if (condo) {
    $('#tower').value = localStorage.getItem('tower') || $('#tower').value;
    $('#apartment').value = localStorage.getItem('apartment') || $('#apartment').value;
  }
  renderCart();
}

function commonDeliveryPayload() {
  return { mode: 'common', street: $('#street').value, number: $('#number').value, district: $('#district').value, zip: $('#zip').value, complement: $('#complement').value, reference: $('#reference').value };
}

async function quoteDelivery() {
  const message = $('#deliveryQuoteMessage');
  message.textContent = 'Calculando...';
  message.className = 'field-message';
  state.deliveryQuote = null;
  $('#distanceKm').value = '';
  try {
    const response = await fetch('/api/delivery/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delivery: commonDeliveryPayload() })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Nao foi possivel calcular entrega');
    state.deliveryQuote = data;
    $('#distanceKm').value = `${data.distanceKm} km`;
    message.textContent = `Entrega calculada: ${money(data.deliveryFee)} em ${data.distanceKm} km.`;
    message.className = 'field-message ok';
  } catch (error) {
    message.textContent = error.message;
    message.className = 'field-message error';
  }
  renderCart();
}

function getAddressText() {
  const isCondo = $('#addressMode').value === 'condo';
  const condo = deliveryConfig.condominiums?.find(item => item.id === $('#condominiumSelect')?.value) || deliveryConfig.condominiums?.[0];
  return isCondo
    ? `${condo?.name || 'Condominio'}\nTorre: ${$('#tower').value}\nApartamento: ${$('#apartment').value}\nObs entrega: ${$('#condoNote').value}`
    : `${$('#street').value}, ${$('#number').value}\nBairro: ${$('#district').value}\nCEP: ${$('#zip').value}\nDistancia: ${state.deliveryQuote?.distanceKm || '-'} km\nComplemento: ${$('#complement').value}\nReferencia: ${$('#reference').value}`;
}

function buildOrderPayload() {
  const isCondo = $('#addressMode').value === 'condo';
  return {
    customer: { name: $('#customerName').value.trim(), phone: $('#customerPhone').value.trim() },
    items: state.cart.map(item => {
      if (item.customType === 'comboPizza') return { customType: 'comboPizza', comboId: item.comboId, mode: item.mode, flavorA: item.flavorA, flavorB: item.flavorB, qty: item.qty };
      if (item.customType === 'halfPizza') return { customType: 'halfPizza', flavorA: item.flavorA, flavorB: item.flavorB, qty: item.qty };
      return { id: item.id, qty: item.qty };
    }),
    payment: { method: $('#paymentMethod').value, changeFor: $('#changeFor').value },
    coupon: $('#couponInput').value,
    notes: $('#orderNotes').value,
    delivery: isCondo
      ? { mode: 'condo', condominiumId: $('#condominiumSelect').value, tower: $('#tower').value, apartment: $('#apartment').value, note: $('#condoNote').value }
      : { ...commonDeliveryPayload(), distanceKm: Number(state.deliveryQuote?.distanceKm || 0) }
  };
}

function buildWhatsappText(savedOrder) {
  const fees = savedOrder?.totals || getFees();
  const line = '--------------------------------';
  const items = state.cart.map((item, index) => {
    const unit = money(item.price);
    const total = money(item.price * item.qty);
    return `${String(index + 1).padStart(2, '0')}  ${item.qty}x ${item.name}\n    Unit: ${unit}  Total: ${total}`;
  }).join('\n');
  return [
    '       GABRIEL PIZZA',
    '        CUPOM DO PEDIDO',
    line,
    `Pedido: ${savedOrder?.id || 'Novo pedido'}`,
    `Data: ${new Date().toLocaleString('pt-BR')}`,
    line,
    `Cliente: ${$('#customerName').value}`,
    `Telefone: ${$('#customerPhone').value}`,
    line,
    'ITENS',
    items,
    line,
    `Subtotal: ${money(fees.subtotal)}`,
    `Entrega:  ${money(fees.deliveryFee ?? fees.delivery)}`,
    `Desconto: ${money(fees.discount)}`,
    `TOTAL:    ${money(fees.total)}`,
    line,
    'ENTREGA',
    getAddressText(),
    line,
    `Pagamento: ${$('#paymentMethod').value}`,
    $('#paymentMethod').value === 'Pix' ? 'Comprovante: envie o comprovante do Pix neste WhatsApp apos enviar o pedido.' : '',
    `Troco para: ${$('#changeFor').value || 'Nao precisa'}`,
    `Cupom: ${$('#couponInput').value || 'Nenhum'}`,
    `Obs: ${$('#orderNotes').value || 'Nenhuma'}`,
    line
  ].join('\n');
}

async function saveOrder() {
  const response = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildOrderPayload())
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Nao foi possivel salvar o pedido');
  return data;
}

function validateCheckout() {
  if (!store.isOpen) { alert(store.closedMessage || 'Estamos fechados no momento.'); return; }
  if (!state.cart.length) { alert('Adicione pelo menos um item ao carrinho.'); return; }
  if (!$('#customerName').value.trim() || !$('#customerPhone').value.trim()) { alert('Informe nome e telefone.'); return; }
  const isCondo = $('#addressMode').value === 'condo';
  if (isCondo) {
    if (!$('#condominiumSelect').value || !$('#tower').value.trim() || !$('#apartment').value.trim()) { alert('Preencha condominio, torre e apartamento.'); return; }
    localStorage.setItem('tower', $('#tower').value);
    localStorage.setItem('apartment', $('#apartment').value);
  } else {
    const required = [
      ['#street', 'rua'], ['#number', 'numero'], ['#district', 'bairro'], ['#zip', 'CEP'], ['#reference', 'ponto de referencia']
    ];
    const missing = required.find(([selector]) => !$(selector).value.trim());
    if (missing) { alert(`Preencha o campo ${missing[1]} do endereco.`); return; }
    const distance = Number(state.deliveryQuote?.distanceKm || 0);
    if (distance <= 0) { alert('Calcule a entrega pelo Google Maps antes de finalizar.'); return; }
    if (distance > Number(deliveryConfig.maxRadiusKm || 0)) {
      alert('Nao atendemos esse endereco porque ele fica fora do raio de entrega.');
      return;
    }
  }
  return true;
}

function openWhatsappWithOrder(savedOrder) {
  const text = buildWhatsappText(savedOrder);
  const phone = String(store.phone || '5588992258066').replace(/\D/g, '');
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
}

function showPixStep() {
  const pix = $('#pixStep');
  const fees = getFees();
  const pixKey = currentPixKey();
  pix.innerHTML = `
    <section class="pix-step-panel" role="dialog" aria-modal="true" aria-label="Pagamento Pix">
      <button class="detail-close" type="button" data-close-pix aria-label="Fechar">x</button>
      <span class="detail-category">Pagamento Pix</span>
      <h2>Copie a chave Pix</h2>
      <p>Faça o pagamento no app do seu banco. Depois clique em continuar para enviar o pedido pelo WhatsApp.</p>
      <p>Depois do envio, mande o comprovante de pagamento no WhatsApp para confirmar o Pix.</p>
      <div class="pix-key-box">
        <small>Chave Pix</small>
        <input id="pixKeyInput" class="pix-copy-field" type="text" value="${pixKey}" readonly />
      </div>
      <div class="pix-total">Total do pedido <strong>${money(fees.total)}</strong></div>
      <div class="pix-actions">
        <button class="button secondary" type="button" data-copy-pix>Copiar chave</button>
        <button class="button primary" type="button" data-continue-pix>Continuar</button>
      </div>
      <p id="pixMessage" class="admin-message"></p>
    </section>
  `;
  pix.classList.remove('hidden');
  pix.setAttribute('aria-hidden', 'false');
}

function closePixStep() {
  const pix = $('#pixStep');
  if (!pix) return;
  pix.classList.add('hidden');
  pix.setAttribute('aria-hidden', 'true');
  pix.innerHTML = '';
}

async function copyPixKey() {
  const message = $('#pixMessage');
  const pixKey = currentPixKey();
  try {
    if (!navigator.clipboard) throw new Error('Clipboard API indisponivel');
    await navigator.clipboard.writeText(pixKey);
    if (message) message.textContent = 'Chave Pix copiada.';
  } catch (error) {
    const input = $('#pixKeyInput');
    let copied = false;
    if (input) {
      input.focus();
      input.select();
      input.setSelectionRange(0, input.value.length);
      try {
        copied = document.execCommand('copy');
      } catch (copyError) {
        copied = false;
      }
    }
    if (message) message.textContent = copied ? 'Chave Pix copiada.' : `Nao foi possivel copiar automaticamente. Copie manualmente: ${pixKey}`;
  }
}

async function finishWhatsappOrder() {
  const button = $('#sendOrder');
  const originalText = button.textContent;
  button.textContent = 'Salvando pedido...';
  button.disabled = true;
  try {
    const savedOrder = await saveOrder();
    openWhatsappWithOrder(savedOrder);
    closePixStep();
    alert(`Pedido ${savedOrder.id} registrado no backend.`);
  } catch (error) {
    alert(error.message);
  } finally {
    button.textContent = originalText;
    button.disabled = false;
  }
}

async function buildWhatsappOrder() {
  if (!validateCheckout()) return;
  if ($('#paymentMethod').value === 'Pix') {
    showPixStep();
    return;
  }
  await finishWhatsappOrder();
}

function toggleAdminPasswordVisibility() {
  const input = $('#adminPassword');
  const button = $('#toggleAdminPassword');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  button.textContent = showing ? 'Ver' : 'Ocultar';
  button.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
}

function refreshAdminView() {
  const logged = Boolean(adminState.token);
  $('#adminLogin')?.classList.toggle('hidden', logged);
  $('#adminProtected')?.classList.toggle('hidden', !logged);
  if (logged) {
    loadAdminSummary();
    loadAdminOrders();
    startOrderNotifications();
  } else {
    stopOrderNotifications();
  }
}

async function adminLogin() {
  const message = $('#adminLoginMessage');
  message.textContent = '';
  const button = $('#adminLoginButton');
  const originalText = button.textContent;
  button.textContent = 'Entrando...';
  button.disabled = true;
  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('#adminEmail').value.trim(), password: $('#adminPassword').value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Falha no login');
    adminState.token = data.token;
    adminState.email = data.email;
    localStorage.setItem('adminToken', data.token);
    localStorage.setItem('adminEmail', data.email);
    $('#adminPassword').value = '';
    refreshAdminView();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.textContent = originalText;
    button.disabled = false;
  }
}

function adminLogout() {
  adminState.token = '';
  adminState.email = '';
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminEmail');
  $('#adminPanelOutput').innerHTML = '<div class="empty">Escolha uma opcao acima para gerenciar.</div>';
  stopOrderNotifications();
  refreshAdminView();
}

async function loadAdminSummary() {
  try {
    const response = await fetch('/api/admin/summary', { headers: adminHeaders() });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Nao foi possivel carregar metricas');
    $('#metricOrdersToday').textContent = data.ordersToday;
    $('#metricRevenue').textContent = money(data.revenue);
    $('#metricTopProduct').textContent = data.topProduct;
    $('#metricPending').textContent = data.pending;
  } catch (error) {
    $('#metricOrdersToday').textContent = '-';
    $('#metricRevenue').textContent = '-';
    $('#metricTopProduct').textContent = '-';
    $('#metricPending').textContent = '-';
  }
}

async function loadAdminOrders() {
  const container = $('#adminOrders');
  if (!container || !adminState.token) return;
  try {
    const response = await fetch('/api/orders', { headers: adminHeaders() });
    const orders = await response.json();
    if (!response.ok) throw new Error(orders.error || 'Nao foi possivel carregar pedidos');
    container.innerHTML = orders.length ? orders.slice(0, 6).map(order => adminOrderMarkup(order)).join('') : '<div class="empty">Nenhum pedido registrado ainda.</div>';
  } catch (error) {
    container.innerHTML = `<div class="empty">${error.message}</div>`;
  }
}


function playAdminNotificationSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = 0.08;
    gain.connect(ctx.destination);
    [660, 880].forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = frequency;
      osc.type = 'sine';
      osc.connect(gain);
      const start = ctx.currentTime + index * 0.16;
      osc.start(start);
      osc.stop(start + 0.12);
    });
  } catch (error) {
    console.warn('Som de notificacao indisponivel', error);
  }
}

function showAdminNotification(order) {
  let toast = document.querySelector('#adminToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'adminToast';
    toast.className = 'admin-toast';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<strong>Novo pedido recebido</strong><span>${order.customer.name} - ${money(order.totals.total)}</span>`;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 12000);
}

function orderReceiptHtml(order) {
  const lines = order.items.map(item => `<tr><td>${item.qty}x ${item.name}</td><td>${money(item.price * item.qty)}</td></tr>`).join('');
  const delivery = order.delivery.mode === 'condo'
    ? `${order.delivery.condominium}<br>Torre: ${order.delivery.tower}<br>Apto: ${order.delivery.apartment}`
    : `${order.delivery.street}, ${order.delivery.number}<br>${order.delivery.district}<br>${order.delivery.reference || ''}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${order.id}</title><style>body{font-family:monospace;width:300px;margin:0;padding:12px;color:#000}h1,p{margin:0 0 8px;text-align:center}table{width:100%;border-collapse:collapse}td{padding:3px 0;border-bottom:1px dashed #999;vertical-align:top}td:last-child{text-align:right}.line{border-top:1px dashed #000;margin:8px 0}.total{font-size:18px;font-weight:700}</style></head><body><h1>${store.name}</h1><p>CUPOM DO PEDIDO</p><div class="line"></div><p>${order.id}<br>${new Date(order.createdAt).toLocaleString('pt-BR')}</p><div class="line"></div><p><strong>${order.customer.name}</strong><br>${order.customer.phone}</p><table>${lines}</table><div class="line"></div><p>Entrega: ${money(order.totals.deliveryFee)}<br>Desconto: ${money(order.totals.discount)}</p><p class="total">TOTAL ${money(order.totals.total)}</p><div class="line"></div><p>${delivery}</p><div class="line"></div><p>Pagamento: ${order.payment.method}<br>${order.notes || ''}</p></body></html>`;
}

function showPrintMessage(text, ok = false) {
  const panel = $('#printStatusMessage');
  if (!panel) return;
  panel.textContent = text;
  panel.className = `field-message ${ok ? 'ok' : 'error'}`;
}

function printOrderReceipt(order) {
  try {
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    document.body.appendChild(frame);
    frame.contentDocument.open();
    frame.contentDocument.write(orderReceiptHtml(order));
    frame.contentDocument.close();
    frame.onload = () => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        showPrintMessage('Impressao enviada. Se nenhuma impressora abrir, verifique a impressora padrao.', true);
      } catch (error) {
        showPrintMessage('Nao foi possivel imprimir automaticamente. O pedido continua em pedidos recentes.');
      } finally {
        setTimeout(() => frame.remove(), 2000);
      }
    };
  } catch (error) {
    showPrintMessage('Nao foi possivel imprimir automaticamente. O pedido continua em pedidos recentes.');
  }
}

async function checkNewOrders() {
  if (!adminState.token) return;
  try {
    const response = await fetch('/api/orders', { headers: adminHeaders() });
    const orders = await response.json();
    if (!response.ok) throw new Error(orders.error || 'Nao foi possivel verificar pedidos');
    const incoming = orders.filter(order => !adminState.knownOrderIds.has(order.id));
    orders.forEach(order => adminState.knownOrderIds.add(order.id));
    if (adminState.firstOrdersLoad) {
      adminState.firstOrdersLoad = false;
      return;
    }
    if (incoming.length) {
      playAdminNotificationSound();
      showAdminNotification(incoming[0]);
      printOrderReceipt(incoming[0]);
      await loadAdminOrders();
      await loadAdminSummary();
    }
  } catch (error) {
    console.warn(error.message);
  }
}

function startOrderNotifications() {
  if (adminState.orderPoller) return;
  adminState.firstOrdersLoad = true;
  checkNewOrders();
  adminState.orderPoller = setInterval(checkNewOrders, 5000);
}

function stopOrderNotifications() {
  if (adminState.orderPoller) clearInterval(adminState.orderPoller);
  adminState.orderPoller = null;
  adminState.knownOrderIds.clear();
  adminState.firstOrdersLoad = true;
}

function adminOrderMarkup(order) {
  return `
    <article class="admin-order">
      <div>
        <strong>${order.id} - ${order.customer.name}</strong>
        <small>${order.items.map(item => `${item.qty}x ${item.name}`).join(', ')}</small>
        <span>Total: ${money(order.totals.total)} | ${new Date(order.createdAt).toLocaleString('pt-BR')}</span>
      </div>
      <div class="admin-order-side">
        <div class="order-status">${order.status}</div>
        <select data-order-status="${order.id}">
          <option ${order.status === 'Pedido recebido' ? 'selected' : ''}>Pedido recebido</option>
          <option ${order.status === 'Em preparo' ? 'selected' : ''}>Em preparo</option>
          <option ${order.status === 'Saiu para entrega' ? 'selected' : ''}>Saiu para entrega</option>
          <option ${order.status === 'Entregue' ? 'selected' : ''}>Entregue</option>
          <option ${order.status === 'Pedido cancelado' ? 'selected' : ''}>Pedido cancelado</option>
        </select>
      </div>
    </article>
  `;
}

async function updateOrderStatus(orderId, status) {
  const response = await fetch(`/api/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...adminHeaders() },
    body: JSON.stringify({ status })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Nao foi possivel atualizar status');
  await loadAdminSummary();
  await loadAdminOrders();
  renderAdminPanel('orders');
}

async function adminFetch(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(options.headers || {}), ...adminHeaders() } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Operacao nao realizada');
  return data;
}

async function loadAdminCatalog() {
  const [adminProducts, adminCategories] = await Promise.all([
    adminFetch('/api/admin/products'),
    adminFetch('/api/admin/categories')
  ]);
  adminState.products = adminProducts;
  adminState.categories = adminCategories;
}

function productForm(product = {}) {
  const categoryOptions = adminState.categories.map(category => `<option value="${category.id}" ${category.id === product.categoryId ? 'selected' : ''}>${category.name}${category.active ? '' : ' (oculta)'}</option>`).join('');
  return `
    <form id="adminProductForm" class="admin-form" data-edit-id="${product.id || ''}">
      <h3>${product.id ? 'Editar produto' : 'Cadastrar produto'}</h3>
      <div class="form-grid">
        <label>Nome<input name="name" value="${product.name || ''}" required /></label>
        <label>Categoria<select name="categoryId" required>${categoryOptions}</select></label>
        <label>Preco<input name="price" type="number" min="0" step="0.01" value="${product.price || ''}" required /></label>
        <label>Imagem do computador<input name="imageFile" type="file" accept="image/*" /></label>
        <input name="currentImage" type="hidden" value="${product.image || ''}" />
        <input name="comboProductIdsJson" type="hidden" value="${JSON.stringify(product.comboProductIds || [])}" />
        <input name="comboProductDiscountsJson" type="hidden" value='${JSON.stringify(product.comboProductDiscounts || {})}' />
        <input name="comboAllowHalfHidden" type="hidden" value="${product.comboAllowHalf ? '1' : '0'}" />
        <label class="wide">Descricao<textarea name="desc" rows="2" required>${product.desc || ''}</textarea></label>
        <label class="wide">Ingredientes<textarea name="ingredients" rows="2" required>${product.ingredients || ''}</textarea></label>
        <label class="admin-check"><input name="available" type="checkbox" ${product.available === false ? '' : 'checked'} /> Disponivel no cardapio</label>
        <label class="admin-check"><input name="outOfStock" type="checkbox" ${product.outOfStock ? 'checked' : ''} /> Acabou o produto</label>
      </div>
      <div class="admin-actions"><button class="button primary" type="submit">${product.id ? 'Salvar alteracoes' : 'Cadastrar produto'}</button><button class="button ghost" type="button" data-admin-panel="products">Limpar</button></div>
    </form>
  `;
}

function productsTable() {
  return `
    <table><thead><tr><th>Produto</th><th>Categoria</th><th>Preco</th><th>Status</th><th>Acoes</th></tr></thead><tbody>
      ${adminState.products.map(product => `<tr><td>${product.name}</td><td>${product.category}</td><td>${money(product.price)}</td><td>${product.outOfStock ? 'Acabou' : (product.available ? 'Disponivel' : 'Oculto')}</td><td><button data-edit-product="${product.id}">Editar</button><button data-toggle-product="${product.id}">${product.available ? 'Ocultar' : 'Reativar'}</button><button data-stock-product="${product.id}">${product.outOfStock ? 'Voltou' : 'Acabou'}</button><button data-delete-product="${product.id}">Excluir</button></td></tr>`).join('')}
    </tbody></table>
  `;
}


function comboForm(combo = {}) {
  const comboCategory = adminState.categories.find(category => category.name === 'Combos') || adminState.categories[0];
  const selectedCategoryId = combo.categoryId || comboCategory?.id || '';
  const categoryOptions = adminState.categories.map(category => `<option value="${category.id}" ${category.id === selectedCategoryId ? 'selected' : ''}>${category.name}${category.active ? '' : ' (oculta)'}</option>`).join('');
  const selectedComboProducts = combo.comboProductIds || [];
  const comboDiscounts = combo.comboProductDiscounts || {};
  const groupedProducts = adminState.products
    .filter(product => !product.outOfStock && !isComboProduct(product))
    .reduce((groups, product) => {
      if (!groups[product.category]) groups[product.category] = [];
      groups[product.category].push(product);
      return groups;
    }, {});
  const choices = Object.entries(groupedProducts).map(([categoryName, items], index) => {
    const categoryId = `comboCategory${index}`;
    const enabled = items.some(product => selectedComboProducts.includes(product.id));
    return `
      <section class="combo-category-group ${enabled ? 'enabled' : ''}" data-combo-category-group>
        <label class="admin-check combo-category-toggle">
          <input type="checkbox" id="${categoryId}" data-combo-category-toggle ${enabled ? 'checked' : ''} />
          ${categoryName}
        </label>
        <small class="combo-category-hint">Marque a categoria para liberar estes itens no combo.</small>
        <div class="combo-category-products">
          ${items.map(product => {
            const checked = selectedComboProducts.includes(product.id);
            const discount = comboDiscounts[String(product.id)] || comboDiscounts[product.id] || '';
            return `
            <div class="combo-product-option">
              <label class="admin-check">
                <input type="checkbox" name="comboProduct" value="${product.id}" ${checked ? 'checked' : ''} ${enabled ? '' : 'disabled'} />
                ${product.name} - ${money(product.price)}${product.available ? '' : ' (oculto no cardapio)'}
              </label>
              <label class="combo-discount-control">Desconto neste item
                <input name="comboDiscount_${product.id}" type="number" min="0" max="${product.price}" step="0.01" value="${discount}" placeholder="R$ 0,00" ${enabled && checked ? '' : 'disabled'} />
              </label>
            </div>
          `}).join('')}
        </div>
      </section>
    `;
  }).join('') || '<p class="empty">Nenhum produto disponivel para montar combo.</p>';
  return `
    <form id="adminComboForm" class="admin-form" data-edit-id="${combo.id || ''}">
      <h3>${combo.id ? 'Editar combo' : 'Criar combo'}</h3>
      <div class="form-grid">
        <label>Nome do combo<input name="name" value="${combo.name || ''}" placeholder="Ex: Combo Familia Especial" required /></label>
        <label>Categoria onde aparece<select name="categoryId" required>${categoryOptions}</select></label>
        <label>Valor do combo<input name="price" type="number" min="0.01" step="0.01" value="${combo.price || ''}" placeholder="Ex: 89.90" required /></label>
        <label class="admin-check combo-switch"><input type="checkbox" name="comboAllowHalf" ${combo.comboAllowHalf ? 'checked' : ''} /> Permitir pizza meio a meio para o cliente</label>
        <input name="currentImage" type="hidden" value="${combo.image || ''}" />
        <input name="outOfStockHidden" type="hidden" value="${combo.outOfStock ? '1' : '0'}" />
        <label class="wide">Imagem do computador<input name="imageFile" type="file" accept="image/*" /></label>
        <div class="wide combo-choice-list">${choices}</div>
      </div>
      <div class="admin-actions"><button class="button primary" type="submit">${combo.id ? 'Salvar combo' : 'Criar combo'}</button><button class="button ghost" type="button" data-admin-panel="combos">Limpar</button></div>
    </form>
  `;
}

async function submitComboForm(form) {
  const formData = new FormData(form);
  const selectedIds = formData.getAll('comboProduct').map(Number);
  if (!selectedIds.length) throw new Error('Selecione pelo menos um produto para o combo');
  const selected = adminState.products.filter(product => selectedIds.includes(product.id));
  const comboProductDiscounts = selectedIds.reduce((discounts, productId) => {
    const value = Math.max(0, Number(formData.get(`comboDiscount_${productId}`) || 0));
    if (value > 0) discounts[String(productId)] = value;
    return discounts;
  }, {});
  const price = Number(formData.get('price') || 0);
  if (price <= 0) throw new Error('Informe o valor do combo');
  const image = await fileToDataUrl(formData.get('imageFile')) || formData.get('currentImage') || selected[0]?.image || '';
  const payload = {
    name: formData.get('name'),
    categoryId: Number(formData.get('categoryId')),
    price,
    image,
    desc: `Inclui: ${selected.map(product => product.name).join(', ')}.${formData.get('comboAllowHalf') === 'on' ? ' Permite escolher pizza inteira ou meio a meio.' : ''}`,
    ingredients: selected.map(product => product.name).join(', '),
    available: true,
    outOfStock: formData.get('outOfStockHidden') === '1',
    comboProductIds: selectedIds,
    comboProductDiscounts,
    comboAllowHalf: formData.get('comboAllowHalf') === 'on'
  };
  const editId = form.dataset.editId;
  await adminFetch(editId ? `/api/admin/products/${editId}` : '/api/admin/products', { method: editId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  await loadMenu();
  renderCategories();
  renderProducts();
  await renderAdminPanel('combos');
}


function combosTable() {
  const rows = adminState.products
    .filter(product => isComboProduct(product))
    .map(product => `<tr><td>${product.name}</td><td>${product.category}</td><td>${product.comboAllowHalf ? 'Permite meio a meio' : 'Combo comum'}</td><td>${money(product.price)}</td><td>${product.outOfStock ? 'Acabou' : (product.available ? 'Disponivel' : 'Oculto')}</td><td><button data-edit-combo="${product.id}">Editar</button><button data-toggle-product="${product.id}">${product.available ? 'Ocultar' : 'Reativar'}</button><button data-stock-product="${product.id}">${product.outOfStock ? 'Voltou' : 'Acabou'}</button><button data-delete-product="${product.id}">Excluir</button></td></tr>`)
    .join('') || '<tr><td colspan="6">Nenhum combo cadastrado.</td></tr>';
  return `<table><thead><tr><th>Combo</th><th>Categoria</th><th>Tipo</th><th>Preco</th><th>Status</th><th>Acoes</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function weeklyHoursFields() {
  const days = ['Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado', 'Domingo'];
  const weekly = store.weeklyHours || {};
  return days.map((day, index) => {
    const config = weekly[String(index)] || { open: true, from: '18:00', to: '23:30' };
    return `<div class="schedule-row"><label class="admin-check"><input name="dayOpen${index}" type="checkbox" ${config.open ? 'checked' : ''} />${day}</label><input name="dayFrom${index}" type="time" value="${config.from || '18:00'}" /><input name="dayTo${index}" type="time" value="${config.to || '23:30'}" /></div>`;
  }).join('');
}

function storeForm() {
  return `<form id="adminStoreForm" class="admin-form"><h3>Loja, WhatsApp, Pix e horarios</h3><div class="form-grid"><label>Nome do restaurante<input name="name" value="${store.name || ''}" required /></label><label>Descricao<input name="description" value="${store.description || ''}" required /></label><label>Status manual<select name="isOpen"><option value="1" ${store.manualOpen !== false ? 'selected' : ''}>Aberta</option><option value="0" ${store.manualOpen === false ? 'selected' : ''}>Fechada</option></select></label><label class="admin-check">Horario automatico<input name="autoHours" type="checkbox" ${store.autoHours ? 'checked' : ''} /></label><label>WhatsApp dos pedidos<input name="phone" inputmode="tel" placeholder="88992258066" value="${store.phone || ''}" required /></label><label>Telefone exibido<input name="displayPhone" placeholder="(88) 9 9225-8066" value="${store.displayPhone || ''}" /></label><label>Chave Pix<input name="pixKey" placeholder="CPF, telefone, e-mail ou chave aleatoria" value="${store.pixKey || ''}" required /></label><label class="wide">Mensagem quando fechada<textarea name="closedMessage" rows="3">${store.closedMessage || 'Estamos fechados no momento. Volte mais tarde para fazer seu pedido.'}</textarea></label></div><div class="schedule-box"><strong>Dias e horarios de funcionamento</strong>${weeklyHoursFields()}</div><div class="admin-actions"><button class="button primary" type="submit">Salvar loja</button></div></form><form id="adminEmailForm" class="admin-form"><h3>Alterar e-mail do admin</h3><div class="form-grid"><label>Novo e-mail<input name="newEmail" type="email" placeholder="novo@email.com" required /></label><label>Codigo de verificacao<input name="code" inputmode="numeric" maxlength="6" placeholder="Codigo recebido" /></label></div><div class="admin-actions"><button class="button secondary" type="button" id="adminSendEmailCode">Enviar codigo</button><button class="button primary" type="submit">Confirmar e-mail</button></div><p id="adminEmailMessage" class="admin-message"></p></form>`;
}

function deliveryForm() {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(deliveryConfig.storeAddress || store.address || '')}`;
  return `<form id="adminDeliveryForm" class="admin-form"><h3>Entregas com Google Maps</h3><div class="form-grid"><label class="wide">Chave API Google Maps<input name="googleMapsKey" type="password" placeholder="${deliveryConfig.googleMapsKeyConfigured ? 'Chave configurada - preencha para trocar' : 'Cole sua chave da API Google Maps'}" /></label><label>Endereco da loja<input name="storeAddress" value="${deliveryConfig.storeAddress || store.address || ''}" required /></label><label>Taxa base endereco comum<input name="commonFee" type="number" min="0" step="0.01" value="${deliveryConfig.commonFee}" required /></label><label>Raio maximo em km<input name="maxRadiusKm" type="number" min="0.1" step="0.1" value="${deliveryConfig.maxRadiusKm || 8}" required /></label><label>Valor por km<input name="perKmFee" type="number" min="0" step="0.01" value="${deliveryConfig.perKmFee || 0}" required /></label><label>Latitude da loja<input name="storeLat" type="number" step="0.000001" value="${deliveryConfig.storeLat || -3.7319}" required /></label><label>Longitude da loja<input name="storeLng" type="number" step="0.000001" value="${deliveryConfig.storeLng || -38.5267}" required /></label></div><div class="map-preview"><div><strong>Google Maps</strong><span>${deliveryConfig.storeAddress || store.address || ''}</span><small>${deliveryConfig.googleMapsKeyConfigured ? 'API configurada para calcular distancia automaticamente.' : 'Configure a chave API para calcular distancia automaticamente.'}</small></div><a class="button secondary" target="_blank" rel="noreferrer" href="${mapsUrl}">Abrir no Google Maps</a></div><div class="admin-actions"><button class="button primary" type="submit">Salvar entrega</button></div></form>`;
}

function condosForm() {
  return (deliveryConfig.condominiums || []).map(condo => `<form id="adminCondoForm" class="admin-form" data-condo-id="${condo.id}"><h3>${condo.name}</h3><div class="form-grid"><label>Taxa especifica<input name="fee" type="number" min="0" step="0.01" value="${condo.fee ?? 4}" required /></label><label>Torres, separadas por virgula<input name="towers" value="${(condo.towers || []).join(', ')}" required /></label></div><div class="admin-actions"><button class="button primary" type="submit">Salvar condominio</button></div></form>`).join('');
}

function couponsTable() {
  const rows = coupons.map(coupon => `<tr><td>${coupon.code}</td><td>${coupon.value}%</td><td>${coupon.maxUses ?? 'Ilimitado'}</td><td>${coupon.usedCount || 0}</td><td><button data-delete-coupon="${coupon.id}">Excluir</button></td></tr>`).join('') || '<tr><td colspan="5">Nenhum cupom ativo.</td></tr>';
  return `<table><thead><tr><th>Cupom</th><th>Desconto</th><th>Limite</th><th>Usado</th><th>Acoes</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function categoriesTable() {
  const rows = adminState.categories.map((category, index) => `<tr><td>${index + 1}</td><td>${category.name}</td><td>${category.allowHalf ? 'Sim' : 'Nao'}</td><td>${category.active ? 'Ativa' : 'Oculta'}</td><td><button data-move-category="${category.id}" data-direction="up" ${index === 0 ? 'disabled' : ''}>Subir</button><button data-move-category="${category.id}" data-direction="down" ${index === adminState.categories.length - 1 ? 'disabled' : ''}>Descer</button><button data-edit-category="${category.id}">Editar</button><button data-toggle-category="${category.id}">${category.active ? 'Ocultar' : 'Reativar'}</button><button data-delete-category="${category.id}">Excluir</button></td></tr>`).join('');
  return `<table><thead><tr><th>Ordem</th><th>Categoria</th><th>Meio a meio</th><th>Status</th><th>Acoes</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function categoryForm(category = null) {
  return `<form id="adminCategoryForm" class="admin-form" ${category ? `data-edit-id="${category.id}"` : ''}><h3>${category ? 'Editar categoria' : 'Criar categoria'}</h3><div class="form-grid"><label>Nome da categoria<input name="name" value="${category?.name || ''}" required /></label><label>Ordem<input name="sortOrder" type="number" min="1" value="${category?.sortOrder || ''}" placeholder="Automatico" /></label><label class="admin-check">Ativa<input name="active" type="checkbox" ${category?.active !== false ? 'checked' : ''} /></label><label class="admin-check">Meio a meio<input name="allowHalf" type="checkbox" ${category?.allowHalf ? 'checked' : ''} /></label></div><div class="admin-actions"><button class="button primary" type="submit">${category ? 'Salvar categoria' : 'Criar categoria'}</button></div></form>`;
}

async function renderAdminPanel(panel) {
  const output = $('#adminPanelOutput');
  if (!output) return;
  adminState.activePanel = panel;
  try {
    if (['products', 'categories', 'combos'].includes(panel)) await loadAdminCatalog();
    const panels = {
      products: `${productForm()}${productsTable()}`,
      combos: `${comboForm()}<h3>Combos cadastrados</h3>${combosTable()}`,
      categories: `${categoryForm()}<h3>Categorias</h3>${categoriesTable()}`,
      orders: `<h3>Pedidos</h3><p>Use os seletores nos pedidos recentes para alterar o status em tempo real.</p>`,
      store: storeForm(),
      delivery: deliveryForm(),
      condo: condosForm(),
      promos: `<form id="adminCouponForm" class="admin-form"><h3>Criar cupom percentual</h3><div class="form-grid"><label>Codigo<input name="code" placeholder="EX: PIZZA10" required /></label><label>Desconto (%)<input name="value" type="number" min="1" step="1" value="10" required /></label><label>Limite de usos<input name="maxUses" type="number" min="1" placeholder="Vazio = ilimitado" /></label></div><div class="admin-actions"><button class="button primary" type="submit">Criar cupom</button></div></form><h3>Cupons ativos</h3>${couponsTable()}`
    };
    output.innerHTML = panels[panel] || '<div class="empty">Opcao nao encontrada.</div>';
  } catch (error) {
    output.innerHTML = `<div class="empty">${error.message}</div>`;
  }
}

async function fileToDataUrl(file) {
  if (!file || !file.size) return '';
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Nao foi possivel ler a imagem'));
    reader.readAsDataURL(file);
  });
}

async function submitProductForm(form) {
  const formData = new FormData(form);
  const imageFile = formData.get('imageFile');
  const image = await fileToDataUrl(imageFile) || formData.get('currentImage');
  const payload = {
    name: formData.get('name'),
    categoryId: Number(formData.get('categoryId')),
    price: Number(formData.get('price')),
    image,
    desc: formData.get('desc'),
    ingredients: formData.get('ingredients'),
    available: formData.get('available') === 'on',
    outOfStock: formData.get('outOfStock') === 'on',
    comboProductIds: JSON.parse(formData.get('comboProductIdsJson') || '[]'),
    comboProductDiscounts: JSON.parse(formData.get('comboProductDiscountsJson') || '{}'),
    comboAllowHalf: formData.get('comboAllowHalfHidden') === '1'
  };
  const editId = form.dataset.editId;
  await adminFetch(editId ? `/api/admin/products/${editId}` : '/api/admin/products', {
    method: editId ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  await loadMenu();
  renderCategories();
  renderProducts();
  await renderAdminPanel('products');
}

async function editProduct(productId) {
  await loadAdminCatalog();
  const product = adminState.products.find(item => item.id === Number(productId));
  if (!product) return;
  $('#adminPanelOutput').innerHTML = `${productForm(product)}${productsTable()}`;
}

async function editCombo(productId) {
  await loadAdminCatalog();
  const combo = adminState.products.find(item => item.id === Number(productId));
  if (!combo) return;
  $('#adminPanelOutput').innerHTML = `${comboForm(combo)}<h3>Combos cadastrados</h3>${combosTable()}`;
}

async function toggleProduct(productId) {
  await loadAdminCatalog();
  const product = adminState.products.find(item => item.id === Number(productId));
  if (!product) return;
  await adminFetch(`/api/admin/products/${productId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...product, available: !product.available }) });
  state.cart = state.cart.filter(item => item.id !== Number(productId));
  await loadMenu();
  renderCategories();
  renderProducts();
  renderCart();
  await renderAdminPanel(adminState.activePanel === 'combos' ? 'combos' : 'products');
}

async function toggleProductStock(productId) {
  await loadAdminCatalog();
  const product = adminState.products.find(item => item.id === Number(productId));
  if (!product) return;
  await adminFetch(`/api/admin/products/${productId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...product, outOfStock: !product.outOfStock }) });
  state.cart = state.cart.filter(item => item.id !== Number(productId));
  await loadMenu();
  renderCategories();
  renderProducts();
  renderCart();
  await renderAdminPanel(adminState.activePanel === 'combos' ? 'combos' : 'products');
}

async function deleteProduct(productId) {
  if (!confirm('Excluir este item definitivamente? Se ele ja tiver pedidos no historico, use Ocultar.')) return;
  await adminFetch(`/api/admin/products/${productId}`, { method: 'DELETE' });
  state.cart = state.cart.filter(item => item.id !== Number(productId));
  await loadMenu();
  renderCategories();
  renderProducts();
  renderCart();
  await renderAdminPanel(adminState.activePanel === 'combos' ? 'combos' : 'products');
}

async function submitCategoryForm(form) {
  const formData = new FormData(form);
  const payload = { name: formData.get('name'), sortOrder: Number(formData.get('sortOrder') || 0), active: formData.get('active') === 'on', allowHalf: formData.get('allowHalf') === 'on' };
  const editId = form.dataset.editId;
  await adminFetch(editId ? `/api/admin/categories/${editId}` : '/api/admin/categories', { method: editId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  await loadMenu();
  await loadAdminCatalog();
  syncSelectedCategory();
  renderCategories();
  renderProducts();
  await renderAdminPanel('categories');
}

async function editCategory(categoryId) {
  await loadAdminCatalog();
  const category = adminState.categories.find(item => item.id === Number(categoryId));
  if (!category) return;
  $('#adminPanelOutput').innerHTML = `${categoryForm(category)}<h3>Categorias</h3>${categoriesTable()}`;
}

async function toggleCategory(categoryId) {
  await loadAdminCatalog();
  const category = adminState.categories.find(item => item.id === Number(categoryId));
  if (!category) return;
  await adminFetch(`/api/admin/categories/${categoryId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...category, active: !category.active }) });
  await loadMenu();
  await loadAdminCatalog();
  syncSelectedCategory();
  renderCategories();
  renderProducts();
  await renderAdminPanel('categories');
}

async function deleteCategory(categoryId) {
  if (!confirm('Excluir esta categoria definitivamente? Isso tambem apaga os produtos cadastrados dentro dela.')) return;
  adminState.categories = await adminFetch(`/api/admin/categories/${categoryId}`, { method: 'DELETE' });
  await loadMenu();
  await loadAdminCatalog();
  syncSelectedCategory();
  renderCategories();
  renderProducts();
  await renderAdminPanel('categories');
}

async function moveCategory(categoryId, direction) {
  await loadAdminCatalog();
  const ordered = [...adminState.categories].sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
  const index = ordered.findIndex(category => category.id === Number(categoryId));
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;
  [ordered[index], ordered[targetIndex]] = [ordered[targetIndex], ordered[index]];
  for (const [sortIndex, category] of ordered.entries()) {
    await adminFetch(`/api/admin/categories/${category.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...category, sortOrder: sortIndex + 1 })
    });
  }
  await loadMenu();
  await loadAdminCatalog();
  syncSelectedCategory();
  renderCategories();
  renderProducts();
  await renderAdminPanel('categories');
}

function toggleComboCategory(input) {
  const group = input.closest('[data-combo-category-group]');
  if (!group) return;
  group.classList.toggle('enabled', input.checked);
  group.querySelectorAll('input[name="comboProduct"]').forEach(productInput => {
    productInput.disabled = !input.checked;
    productInput.checked = input.checked;
    syncComboProductDiscount(productInput);
  });
}

function syncComboProductDiscount(productInput) {
  const option = productInput.closest('.combo-product-option');
  const discountInput = option?.querySelector('.combo-discount-control input');
  if (!discountInput) return;
  discountInput.disabled = productInput.disabled || !productInput.checked;
  if (discountInput.disabled) discountInput.value = '';
}

async function submitStoreForm(form) {
  const formData = new FormData(form);
  const weeklyHours = {};
  for (let index = 0; index < 7; index += 1) {
    weeklyHours[String(index)] = {
      open: formData.get(`dayOpen${index}`) === 'on',
      from: formData.get(`dayFrom${index}`) || '18:00',
      to: formData.get(`dayTo${index}`) || '23:30'
    };
  }
  store = await adminFetch('/api/admin/store-status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: formData.get('name'),
      description: formData.get('description'),
      isOpen: formData.get('isOpen') === '1',
      autoHours: formData.get('autoHours') === 'on',
      weeklyHours,
      closedMessage: formData.get('closedMessage'),
      phone: formData.get('phone'),
      displayPhone: formData.get('displayPhone'),
      pixKey: formData.get('pixKey')
    })
  });
  renderStoreStatus();
  renderProducts();
  renderCart();
  await renderAdminPanel('store');
}

async function submitDeliveryForm(form) {
  const formData = new FormData(form);
  deliveryConfig = await adminFetch('/api/admin/delivery', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commonFee: Number(formData.get('commonFee')),
      storeAddress: formData.get('storeAddress'),
      storeLat: Number(formData.get('storeLat')),
      storeLng: Number(formData.get('storeLng')),
      maxRadiusKm: Number(formData.get('maxRadiusKm')),
      perKmFee: Number(formData.get('perKmFee')),
      googleMapsKey: formData.get('googleMapsKey')
    })
  });
  renderCart();
  await renderAdminPanel('delivery');
}

async function submitCondoForm(form) {
  const formData = new FormData(form);
  await adminFetch('/api/admin/condo', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: form.dataset.condoId, fee: Number(formData.get('fee')), towers: formData.get('towers') }) });
  await loadMenu();
  renderCart();
  await renderAdminPanel('condo');
}

async function submitCouponForm(form) {
  const formData = new FormData(form);
  coupons = await adminFetch('/api/admin/coupons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: formData.get('code'), value: Number(formData.get('value')), maxUses: formData.get('maxUses') }) });
  renderCart();
  await renderAdminPanel('promos');
}

async function deleteCoupon(couponId) {
  coupons = await adminFetch(`/api/admin/coupons/${couponId}`, { method: 'DELETE' });
  renderCart();
  await renderAdminPanel('promos');
}

async function requestAdminEmailCode() {
  const form = $('#adminEmailForm');
  const message = $('#adminEmailMessage');
  const formData = new FormData(form);
  message.textContent = '';
  const data = await adminFetch('/api/admin/email-change-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newEmail: formData.get('newEmail') })
  });
  message.textContent = data.devCode ? `Codigo de teste local: ${data.devCode}` : (data.emailSent === false ? (data.message || 'Nao foi possivel enviar o codigo por e-mail.') : 'Codigo enviado para o novo e-mail.');
}

async function submitAdminEmailForm(form) {
  const formData = new FormData(form);
  const data = await adminFetch('/api/admin/email-change-confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newEmail: formData.get('newEmail'), code: formData.get('code') })
  });
  adminState.email = data.email;
  localStorage.setItem('adminEmail', data.email);
  $('#adminEmailMessage').textContent = 'E-mail administrativo alterado com sucesso.';
}

function recoverAdminPassword() {
  $('#adminLoginMessage').textContent = '';
  $('#adminRecoverForm')?.classList.remove('hidden');
  $('#recoverEmail').value = $('#adminEmail').value.trim();
  $('#recoverEmail').focus();
}

function cancelRecoverPassword() {
  $('#adminRecoverForm')?.classList.add('hidden');
  $('#recoverCode').value = '';
  $('#recoverPassword').value = '';
  $('#recoverConfirm').value = '';
  $('#adminLoginMessage').textContent = '';
}

async function requestRecoveryCode() {
  const message = $('#adminLoginMessage');
  const button = $('#adminSendCodeButton');
  const originalText = button.textContent;
  message.textContent = '';
  button.textContent = 'Enviando...';
  button.disabled = true;
  try {
    const response = await fetch('/api/admin/recover-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('#recoverEmail').value.trim() })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Nao foi possivel enviar o codigo');
    if (data.devCode) {
      $('#recoverCode').value = data.devCode;
      message.textContent = `Codigo de teste local: ${data.devCode}. Configure SMTP para envio real por e-mail.`;
    } else if (data.emailSent === false) {
      message.textContent = data.message || 'Nao foi possivel enviar o codigo por e-mail.';
    } else {
      message.textContent = 'Codigo enviado para o e-mail cadastrado.';
    }
    $('#recoverCode').focus();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.textContent = originalText;
    button.disabled = false;
  }
}

async function saveRecoveredPassword() {
  const message = $('#adminLoginMessage');
  const button = $('#adminSavePasswordButton');
  const originalText = button.textContent;
  message.textContent = '';
  button.textContent = 'Salvando...';
  button.disabled = true;
  try {
    const response = await fetch('/api/admin/recover-confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: $('#recoverEmail').value.trim(),
        code: $('#recoverCode').value.trim(),
        password: $('#recoverPassword').value,
        confirm: $('#recoverConfirm').value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Nao foi possivel redefinir a senha');
    $('#adminEmail').value = $('#recoverEmail').value.trim();
    $('#adminPassword').value = '';
    cancelRecoverPassword();
    message.textContent = 'Senha redefinida com codigo de seguranca. Entre usando a nova senha.';
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.textContent = originalText;
    button.disabled = false;
  }
}

async function init() {
  await loadMenu();
  syncSelectedCategory();
  renderCategories();
  renderProducts();
  routeToScreen();
  renderCart();
  syncAddressMode();
}

document.addEventListener('click', event => {
  const category = event.target.closest('[data-category]');
  const add = event.target.closest('[data-id]');
  const detailButton = event.target.closest('[data-detail]');
  const detailAddButton = event.target.closest('[data-detail-add]');
  const closeDetailButton = event.target.closest('[data-close-detail]');
  const closePixButton = event.target.closest('[data-close-pix]');
  const copyPixButton = event.target.closest('[data-copy-pix]');
  const continuePixButton = event.target.closest('[data-continue-pix]');
  const inc = event.target.closest('[data-inc]');
  const dec = event.target.closest('[data-dec]');
  const adminPanel = event.target.closest('[data-admin-panel]');
  const halfButton = event.target.closest('#addHalfPizza');
  const openComboButton = event.target.closest('[data-open-combo]');
  const closeComboButton = event.target.closest('[data-close-combo]');
  const editProductButton = event.target.closest('[data-edit-product]');
  const editComboButton = event.target.closest('[data-edit-combo]');
  const editCategoryButton = event.target.closest('[data-edit-category]');
  const moveCategoryButton = event.target.closest('[data-move-category]');
  const deleteProductButton = event.target.closest('[data-delete-product]');
  const stockProductButton = event.target.closest('[data-stock-product]');
  const deleteCouponButton = event.target.closest('[data-delete-coupon]');
  const deleteCategoryButton = event.target.closest('[data-delete-category]');
  const toggleProductButton = event.target.closest('[data-toggle-product]');
  const toggleCategoryButton = event.target.closest('[data-toggle-category]');
  const sendEmailCodeButton = event.target.closest('#adminSendEmailCode');
  const quoteDeliveryButton = event.target.closest('#quoteDeliveryButton');
  if (category) { state.category = category.dataset.category; state.activeComboId = null; renderCategories(); renderProducts(); }
  if (openComboButton) { state.activeComboId = Number(openComboButton.dataset.openCombo); renderProducts(); }
  if (closeComboButton) { state.activeComboId = null; renderProducts(); }
  if (detailButton) openProductDetail(detailButton.dataset.detail);
  if (detailAddButton) addDetailToCart(detailAddButton.dataset.detailAdd);
  if (closeDetailButton || event.target.id === 'productDetail') closeProductDetail();
  if (closePixButton || event.target.id === 'pixStep') closePixStep();
  if (copyPixButton) copyPixKey();
  if (continuePixButton) finishWhatsappOrder();
  if (halfButton) addHalfPizza();
  if (add) addToCart(Number(add.dataset.id), add);
  if (inc) changeQty(inc.dataset.inc, 1);
  if (dec) changeQty(dec.dataset.dec, -1);
  if (adminPanel) renderAdminPanel(adminPanel.dataset.adminPanel);
  if (editProductButton) editProduct(editProductButton.dataset.editProduct).catch(error => alert(error.message));
  if (editComboButton) editCombo(editComboButton.dataset.editCombo).catch(error => alert(error.message));
  if (editCategoryButton) editCategory(editCategoryButton.dataset.editCategory).catch(error => alert(error.message));
  if (moveCategoryButton) moveCategory(moveCategoryButton.dataset.moveCategory, moveCategoryButton.dataset.direction).catch(error => alert(error.message));
  if (deleteProductButton) deleteProduct(deleteProductButton.dataset.deleteProduct).catch(error => alert(error.message));
  if (stockProductButton) toggleProductStock(stockProductButton.dataset.stockProduct).catch(error => alert(error.message));
  if (deleteCouponButton) deleteCoupon(deleteCouponButton.dataset.deleteCoupon).catch(error => alert(error.message));
  if (deleteCategoryButton) deleteCategory(deleteCategoryButton.dataset.deleteCategory).catch(error => alert(error.message));
  if (toggleProductButton) toggleProduct(toggleProductButton.dataset.toggleProduct).catch(error => alert(error.message));
  if (toggleCategoryButton) toggleCategory(toggleCategoryButton.dataset.toggleCategory).catch(error => alert(error.message));
  if (sendEmailCodeButton) requestAdminEmailCode().catch(error => alert(error.message));
  if (quoteDeliveryButton) quoteDelivery().catch(error => alert(error.message));
});

document.addEventListener('submit', event => {
  const form = event.target;
  if (form.id === 'adminProductForm') { event.preventDefault(); submitProductForm(form).catch(error => alert(error.message)); }
  if (form.id === 'adminComboForm') { event.preventDefault(); submitComboForm(form).catch(error => alert(error.message)); }
  if (form.id === 'adminCategoryForm') { event.preventDefault(); submitCategoryForm(form).catch(error => alert(error.message)); }
  if (form.id === 'adminStoreForm') { event.preventDefault(); submitStoreForm(form).catch(error => alert(error.message)); }
  if (form.id === 'adminEmailForm') { event.preventDefault(); submitAdminEmailForm(form).catch(error => alert(error.message)); }
  if (form.id === 'adminDeliveryForm') { event.preventDefault(); submitDeliveryForm(form).catch(error => alert(error.message)); }
  if (form.id === 'adminCondoForm') { event.preventDefault(); submitCondoForm(form).catch(error => alert(error.message)); }
  if (form.id === 'adminCouponForm') { event.preventDefault(); submitCouponForm(form).catch(error => alert(error.message)); }
});

document.addEventListener('change', event => {
  if (event.target.closest('#halfFlavorA') || event.target.closest('#halfFlavorB') || event.target.closest('#pizzaBuildMode')) updateHalfPizzaPrice();
  if (event.target.closest('#detailFlavorA') || event.target.closest('#detailFlavorB')) syncDetailMode();
  const comboCategoryToggle = event.target.closest('[data-combo-category-toggle]');
  if (comboCategoryToggle) toggleComboCategory(comboCategoryToggle);
  const comboProductInput = event.target.closest('input[name="comboProduct"]');
  if (comboProductInput) syncComboProductDiscount(comboProductInput);
  const statusSelect = event.target.closest('[data-order-status]');
  if (statusSelect) updateOrderStatus(statusSelect.dataset.orderStatus, statusSelect.value).catch(error => alert(error.message));
});

document.addEventListener('input', event => {
  if (event.target.closest('#commonAddress input:not(#distanceKm)')) {
    state.deliveryQuote = null;
    $('#distanceKm').value = '';
    const message = $('#deliveryQuoteMessage');
    if (message) { message.textContent = 'Calcule novamente a entrega pelo Google Maps.'; message.className = 'field-message'; }
    renderCart();
  }
});

window.addEventListener('hashchange', () => { routeToScreen(); renderCart(); });
$('#searchInput').addEventListener('input', event => { state.query = event.target.value; renderProducts(); });
$('#addressMode').addEventListener('change', syncAddressMode);
$('#couponInput').addEventListener('input', renderCart);
$('#condominiumSelect').addEventListener('change', renderCart);
$('#sendOrder').addEventListener('click', buildWhatsappOrder);
$('#cartFab').addEventListener('click', () => { window.location.hash = '#pedido'; });
$('#adminLoginButton').addEventListener('click', adminLogin);
$('#adminPassword').addEventListener('keydown', event => { if (event.key === 'Enter') adminLogin(); });
$('#toggleAdminPassword').addEventListener('click', toggleAdminPasswordVisibility);
$('#adminRecoverButton').addEventListener('click', recoverAdminPassword);
$('#adminSendCodeButton').addEventListener('click', requestRecoveryCode);
$('#adminSavePasswordButton').addEventListener('click', saveRecoveredPassword);
$('#adminCancelRecoverButton').addEventListener('click', cancelRecoverPassword);
$('#adminLogoutButton').addEventListener('click', adminLogout);
init();




