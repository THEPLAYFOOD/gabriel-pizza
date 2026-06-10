import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = 'C:/Users/gabri/Documents/Codex/2026-06-09/eu-falo-portugues-brasil/outputs/pizzaria-digital';
const dbPath = join(root, 'db.json');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};
const statuses = ['Pedido recebido', 'Em preparo', 'Saiu para entrega', 'Entregue'];

async function readDb() {
  const content = await readFile(dbPath, 'utf8');
  return JSON.parse(content.replace(/^\uFEFF/, ''));
}

async function writeDb(db) {
  await writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('JSON invalido');
  }
}

function calculateTotals(db, order) {
  const subtotal = order.items.reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0);
  const isCondo = order.delivery?.mode === 'condo';
  const deliveryFee = subtotal ? (isCondo ? db.delivery.condominiums[0].fee : db.delivery.commonFee) : 0;
  const couponCode = String(order.coupon || '').trim().toUpperCase();
  const coupon = db.coupons.find(item => item.active && item.code === couponCode);
  const discount = coupon?.type === 'percent' ? subtotal * (coupon.value / 100) : 0;
  return {
    subtotal: Number(subtotal.toFixed(2)),
    deliveryFee: Number(deliveryFee.toFixed(2)),
    discount: Number(discount.toFixed(2)),
    total: Number(Math.max(0, subtotal + deliveryFee - discount).toFixed(2))
  };
}

function normalizeOrder(db, body) {
  if (!body.customer?.name || !body.customer?.phone) throw new Error('Nome e telefone sao obrigatorios');
  if (!Array.isArray(body.items) || !body.items.length) throw new Error('Pedido sem itens');

  const items = body.items.map(item => {
    const product = db.products.find(productItem => productItem.id === Number(item.id));
    if (!product || !product.available) throw new Error(`Produto indisponivel: ${item.id}`);
    const qty = Math.max(1, Number(item.qty) || 1);
    return {
      id: product.id,
      name: product.name,
      category: product.category,
      price: product.price,
      qty
    };
  });

  const deliveryMode = body.delivery?.mode === 'condo' ? 'condo' : 'common';
  const delivery = deliveryMode === 'condo'
    ? {
        mode: 'condo',
        condominium: 'Condominio Reserva das Garcas 1',
        tower: String(body.delivery?.tower || ''),
        apartment: String(body.delivery?.apartment || ''),
        note: String(body.delivery?.note || '')
      }
    : {
        mode: 'common',
        street: String(body.delivery?.street || ''),
        number: String(body.delivery?.number || ''),
        district: String(body.delivery?.district || ''),
        zip: String(body.delivery?.zip || ''),
        complement: String(body.delivery?.complement || ''),
        reference: String(body.delivery?.reference || '')
      };

  const order = {
    id: `PED-${Date.now()}`,
    createdAt: new Date().toISOString(),
    status: statuses[0],
    customer: {
      name: String(body.customer.name),
      phone: String(body.customer.phone)
    },
    payment: {
      method: String(body.payment?.method || 'Pix'),
      changeFor: String(body.payment?.changeFor || '')
    },
    coupon: String(body.coupon || '').trim().toUpperCase(),
    notes: String(body.notes || ''),
    delivery,
    items
  };
  order.totals = calculateTotals(db, order);
  return order;
}

async function handleApi(req, res, url) {
  const db = await readDb();

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, name: db.store.name });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/store') {
    sendJson(res, 200, db.store);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/menu') {
    sendJson(res, 200, {
      store: db.store,
      categories: ['Todos', ...db.categories],
      products: db.products.filter(product => product.available),
      delivery: db.delivery,
      coupons: db.coupons.filter(coupon => coupon.active).map(coupon => coupon.code)
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/orders') {
    sendJson(res, 200, db.orders.slice().reverse());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/orders') {
    try {
      const body = await readBody(req);
      const order = normalizeOrder(db, body);
      db.orders.push(order);
      await writeDb(db);
      sendJson(res, 201, order);
    } catch (error) {
      sendError(res, 400, error.message);
    }
    return;
  }

  const statusMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
  if (req.method === 'PATCH' && statusMatch) {
    try {
      const body = await readBody(req);
      if (!statuses.includes(body.status)) throw new Error('Status invalido');
      const order = db.orders.find(item => item.id === statusMatch[1]);
      if (!order) {
        sendError(res, 404, 'Pedido nao encontrado');
        return;
      }
      order.status = body.status;
      order.updatedAt = new Date().toISOString();
      await writeDb(db);
      sendJson(res, 200, order);
    } catch (error) {
      sendError(res, 400, error.message);
    }
    return;
  }

  sendError(res, 404, 'Rota da API nao encontrada');
}

async function serveStatic(res, url) {
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = normalize(join(root, requested));
  if (!filePath.startsWith(normalize(root))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': types[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else await serveStatic(res, url);
  } catch (error) {
    sendError(res, 500, error.message || 'Erro interno');
  }
}).listen(4173, '127.0.0.1', () => console.log('Gabriel Pizza em http://127.0.0.1:4173'));

