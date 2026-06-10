from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlencode, unquote, urlparse
from urllib.request import Request, urlopen
from datetime import datetime, timezone
from email.message import EmailMessage
from zoneinfo import ZoneInfo
import json
import mimetypes
import os
import random
import re
import smtplib
import sqlite3
import ssl
import socket
import time
import uuid
try:
    import psycopg
    from psycopg.rows import dict_row
except Exception:
    psycopg = None
    dict_row = None

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / 'gabriel_pizza.db'
SCHEMA_PATH = ROOT / 'schema.sql'
PG_SCHEMA_PATH = ROOT / 'schema_pg.sql'
ENV_PATH = ROOT / '.env'
DATABASE_URL = os.environ.get('DATABASE_URL', '').strip()
USE_POSTGRES = bool(DATABASE_URL)
STATUSES = ['Pedido recebido', 'Em preparo', 'Saiu para entrega', 'Entregue', 'Pedido cancelado']
ADMIN_EMAIL = 'j.gabrielmc15@gmail.com'
ADMIN_PASSWORD = 'Boblindo123'
ADMIN_TOKEN = 'gabriel-pizza-admin-token'
LOCAL_TZ = ZoneInfo('America/Fortaleza')
DEFAULT_WEEKLY_HOURS = {
    '0': {'open': True, 'from': '18:00', 'to': '23:30'},
    '1': {'open': True, 'from': '18:00', 'to': '23:30'},
    '2': {'open': True, 'from': '18:00', 'to': '23:30'},
    '3': {'open': True, 'from': '18:00', 'to': '23:30'},
    '4': {'open': True, 'from': '18:00', 'to': '23:30'},
    '5': {'open': True, 'from': '18:00', 'to': '23:30'},
    '6': {'open': True, 'from': '18:00', 'to': '23:30'}
}

SEED_CATEGORIES = [
    'Pizzas Tradicionais', 'Pizzas Especiais', 'Combos', 'Bebidas', 'Sobremesas', 'Promocoes'
]

SEED_PRODUCTS = [
    ('Pizzas Tradicionais', 'Mussarela', 38.9, 'Molho de tomate, mussarela cremosa e oregano.', 'Mussarela, tomate, oregano', 'https://images.unsplash.com/photo-1604382354936-07c5d9983bd3?auto=format&fit=crop&w=900&q=80'),
    ('Pizzas Tradicionais', 'Calabresa', 42.9, 'Calabresa fatiada, cebola roxa e queijo.', 'Calabresa, cebola, mussarela', 'https://images.unsplash.com/photo-1594007654729-407eedc4be65?auto=format&fit=crop&w=900&q=80'),
    ('Pizzas Especiais', 'Brie com Parma', 67.9, 'Pizza especial com queijo brie, presunto parma e geleia.', 'Brie, parma, rucula, geleia', 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=900&q=80'),
    ('Combos', 'Combo Familia', 89.9, 'Uma pizza grande tradicional, refrigerante 2L e sobremesa.', 'Pizza grande, bebida, brownie', 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=900&q=80'),
    ('Bebidas', 'Refrigerante 2L', 13.9, 'Coca-Cola, Guarana ou soda limonada.', 'Escolha no pedido', 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=900&q=80'),
    ('Sobremesas', 'Brownie da Casa', 16.9, 'Brownie com casquinha crocante e calda de chocolate.', 'Chocolate, manteiga, cacau', 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=900&q=80'),
    ('Promocoes', 'Terca em Dobro', 74.9, 'Duas pizzas tradicionais medias com preco especial.', 'Sabores tradicionais', 'https://images.unsplash.com/photo-1579751626657-72bc17010498?auto=format&fit=crop&w=900&q=80'),
    ('Pizzas Especiais', 'Camarao Cremoso', 72.9, 'Camarao salteado, catupiry, alho poro e parmesao.', 'Camarao, catupiry, alho poro', 'https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?auto=format&fit=crop&w=900&q=80')
]

def load_env_file():
    if not ENV_PATH.exists():
        return
    for raw_line in ENV_PATH.read_text(encoding='utf-8-sig').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value

def translate_pg_sql(sql):
    sql = sql.strip()
    if sql.upper().startswith('PRAGMA '):
        return ''
    insert_ignore = bool(re.search(r'INSERT\s+OR\s+IGNORE\s+INTO', sql, flags=re.I))
    sql = re.sub(r'INSERT\s+OR\s+IGNORE\s+INTO', 'INSERT INTO', sql, flags=re.I)
    if insert_ignore and 'ON CONFLICT' not in sql.upper() and 'RETURNING' not in sql.upper():
        sql = f'{sql} ON CONFLICT DO NOTHING'
    return sql.replace('?', '%s')

class PostgresConnection:
    def __init__(self):
        if psycopg is None:
            raise RuntimeError('Instale psycopg[binary] para usar PostgreSQL')
        self.conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type:
            self.conn.rollback()
        else:
            self.conn.commit()
        self.conn.close()

    def execute(self, sql, params=()):
        translated = translate_pg_sql(sql)
        cursor = self.conn.cursor()
        if not translated:
            return cursor
        cursor.execute(translated, params)
        return cursor

    def executescript(self, script):
        cursor = self.conn.cursor()
        for statement in [part.strip() for part in script.split(';') if part.strip()]:
            cursor.execute(statement)
        return cursor

    def commit(self):
        self.conn.commit()

def db():
    if USE_POSTGRES:
        return PostgresConnection()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn

def table_columns(conn, table):
    if USE_POSTGRES:
        return [row['column_name'] for row in conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = ?",
            (table,)
        ).fetchall()]
    return [row['name'] for row in conn.execute(f'PRAGMA table_info({table})')]

def init_db():
    with db() as conn:
        conn.executescript((PG_SCHEMA_PATH if USE_POSTGRES else SCHEMA_PATH).read_text(encoding='utf-8-sig'))
        conn.execute("""
            INSERT OR IGNORE INTO store (id, name, phone, display_phone, address, opening_hours, delivery_estimate)
            VALUES (1, 'Gabriel Pizza', '5588992258066', '(88) 9 9225-8066', 'Av. das Pizzas, 1200 - Fortaleza, CE', 'Aberto hoje ate 23:30', '35 a 55 min')
        """)
        columns = table_columns(conn, 'store')
        if 'description' not in columns:
            conn.execute("ALTER TABLE store ADD COLUMN description TEXT NOT NULL DEFAULT 'Pizzaria artesanal'")
        if 'pix_key' not in columns:
            conn.execute("ALTER TABLE store ADD COLUMN pix_key TEXT NOT NULL DEFAULT '88992258066'")
        if 'is_open' not in columns:
            conn.execute('ALTER TABLE store ADD COLUMN is_open INTEGER NOT NULL DEFAULT 1')
        if 'closed_message' not in columns:
            conn.execute("ALTER TABLE store ADD COLUMN closed_message TEXT NOT NULL DEFAULT 'Estamos fechados no momento. Volte mais tarde para fazer seu pedido.'")
        if 'auto_hours' not in columns:
            conn.execute('ALTER TABLE store ADD COLUMN auto_hours INTEGER NOT NULL DEFAULT 0')
        if 'weekly_hours' not in columns:
            conn.execute("ALTER TABLE store ADD COLUMN weekly_hours TEXT NOT NULL DEFAULT '{}'")
        category_columns = table_columns(conn, 'categories')
        if 'allow_half' not in category_columns:
            conn.execute('ALTER TABLE categories ADD COLUMN allow_half INTEGER NOT NULL DEFAULT 0')
            conn.execute("UPDATE categories SET allow_half = 1 WHERE name LIKE 'Pizzas%'")
        product_columns = table_columns(conn, 'products')
        if 'combo_product_ids' not in product_columns:
            conn.execute("ALTER TABLE products ADD COLUMN combo_product_ids TEXT NOT NULL DEFAULT '[]'")
        if 'combo_product_discounts' not in product_columns:
            conn.execute("ALTER TABLE products ADD COLUMN combo_product_discounts TEXT NOT NULL DEFAULT '{}'")
        if 'combo_allow_half' not in product_columns:
            conn.execute('ALTER TABLE products ADD COLUMN combo_allow_half INTEGER NOT NULL DEFAULT 0')
        if 'out_of_stock' not in product_columns:
            conn.execute('ALTER TABLE products ADD COLUMN out_of_stock INTEGER NOT NULL DEFAULT 0')
        delivery_columns = table_columns(conn, 'delivery_settings')
        for column, definition in {
            'store_address': "TEXT NOT NULL DEFAULT 'Av. das Pizzas, 1200 - Fortaleza, CE'",
            'store_lat': 'REAL NOT NULL DEFAULT -3.7319',
            'store_lng': 'REAL NOT NULL DEFAULT -38.5267',
            'max_radius_km': 'REAL NOT NULL DEFAULT 8',
            'per_km_fee': 'REAL NOT NULL DEFAULT 1',
            'google_maps_key': "TEXT NOT NULL DEFAULT ''"
        }.items():
            if column not in delivery_columns:
                conn.execute(f'ALTER TABLE delivery_settings ADD COLUMN {column} {definition}')
        coupon_columns = table_columns(conn, 'coupons')
        if 'max_uses' not in coupon_columns:
            conn.execute('ALTER TABLE coupons ADD COLUMN max_uses INTEGER')
        if 'used_count' not in coupon_columns:
            conn.execute('ALTER TABLE coupons ADD COLUMN used_count INTEGER NOT NULL DEFAULT 0')
        conn.execute("INSERT OR IGNORE INTO delivery_settings (id, common_fee, estimated_time) VALUES (1, 8, '35 a 55 min')")
        conn.execute("INSERT OR IGNORE INTO admin_settings (id, email, password) VALUES (1, ?, ?)", (ADMIN_EMAIL, ADMIN_PASSWORD))
        for index, name in enumerate(SEED_CATEGORIES, start=1):
            conn.execute('INSERT OR IGNORE INTO categories (name, sort_order, active) VALUES (?, ?, 1)', (name, index))
        category_ids = {row['name']: row['id'] for row in conn.execute('SELECT id, name FROM categories')}
        if conn.execute('SELECT COUNT(*) AS total FROM products').fetchone()['total'] == 0:
            for category, name, price, desc, ingredients, image in SEED_PRODUCTS:
                conn.execute(
                    'INSERT INTO products (category_id, name, price, description, ingredients, image_url, available) VALUES (?, ?, ?, ?, ?, ?, 1)',
                    (category_ids[category], name, price, desc, ingredients, image)
                )
        conn.execute(
            "INSERT OR IGNORE INTO condominiums (id, name, fee, towers, active) VALUES (?, ?, ?, ?, 1)",
            ('reserva-garcas-1', 'Condominio Reserva das Garcas 1', 4, json.dumps(['Torre 1', 'Torre 2', 'Torre 3', 'Torre 4']))
        )
        conn.execute(
            "INSERT OR IGNORE INTO condominiums (id, name, fee, towers, active) VALUES (?, ?, ?, ?, 1)",
            ('reserva-garcas-2', 'Condominio Reserva das Garcas 2', 4, json.dumps(['Torre 1', 'Torre 2', 'Torre 3', 'Torre 4']))
        )
        conn.execute("INSERT OR IGNORE INTO coupons (code, discount_type, discount_value, active) VALUES ('GARCA10', 'percent', 10, 1)")

def row_to_store(row):
    weekly_hours = parse_json_dict(row['weekly_hours'], DEFAULT_WEEKLY_HOURS)
    auto_hours = bool(row['auto_hours'])
    schedule_open = schedule_open_now(weekly_hours) if auto_hours else True
    effective_open = bool(row['is_open']) and schedule_open
    return {
        'name': row['name'], 'description': row['description'], 'phone': row['phone'], 'displayPhone': row['display_phone'], 'pixKey': row['pix_key'],
        'address': row['address'], 'openingHours': 'aberta para pedidos' if effective_open else 'Fechado agora', 'deliveryEstimate': row['delivery_estimate'],
        'isOpen': effective_open, 'manualOpen': bool(row['is_open']), 'autoHours': auto_hours, 'weeklyHours': weekly_hours,
        'closedMessage': row['closed_message'] if effective_open else (row['closed_message'] or 'Estamos fechados no momento.')
    }

def digits_only(value):
    return re.sub(r'\D+', '', str(value or ''))

def format_brazil_phone(value):
    digits = digits_only(value)
    national = digits[2:] if digits.startswith('55') and len(digits) > 11 else digits
    if len(national) == 11:
        return f"({national[:2]}) {national[2]} {national[3:7]}-{national[7:]}"
    if len(national) == 10:
        return f"({national[:2]}) {national[2:6]}-{national[6:]}"
    return str(value or '')

def parse_json_dict(value, fallback):
    try:
        data = json.loads(value or '{}')
        return data if isinstance(data, dict) else fallback
    except Exception:
        return fallback

def schedule_open_now(weekly_hours):
    now = datetime.now(LOCAL_TZ)
    day = str(now.weekday())
    config = weekly_hours.get(day) or {}
    if not config.get('open'):
        return False
    start = str(config.get('from') or '00:00')
    end = str(config.get('to') or '23:59')
    current = now.strftime('%H:%M')
    if start <= end:
        return start <= current <= end
    return current >= start or current <= end

def get_menu():
    with db() as conn:
        store = row_to_store(conn.execute('SELECT * FROM store WHERE id = 1').fetchone())
        categories = [row['name'] for row in conn.execute('SELECT name FROM categories WHERE active = 1 ORDER BY sort_order, name')]
        combo_ingredient_ids = set()
        for combo in conn.execute('''
            SELECT p.combo_product_ids
            FROM products p JOIN categories c ON c.id = p.category_id
            WHERE p.available = 1 AND p.out_of_stock = 0 AND c.active = 1 AND p.combo_product_ids != '[]'
        '''):
            try:
                combo_ingredient_ids.update(int(item) for item in json.loads(combo['combo_product_ids'] or '[]'))
            except Exception:
                pass
        products = [
            {
                'id': row['id'], 'category': row['category'], 'name': row['name'], 'price': row['price'],
                'desc': row['description'], 'ingredients': row['ingredients'], 'available': bool(row['available']),
                'outOfStock': bool(row['out_of_stock']), 'visibleInMenu': bool(row['available']),
                'image': row['image_url'], 'comboProductIds': json.loads(row['combo_product_ids'] or '[]'),
                'comboProductDiscounts': parse_json_dict(row['combo_product_discounts'], {}),
                'comboAllowHalf': bool(row['combo_allow_half']), 'categoryAllowHalf': bool(row['category_allow_half'])
            }
            for row in conn.execute('''
                SELECT p.*, c.name AS category, c.allow_half AS category_allow_half
                FROM products p JOIN categories c ON c.id = p.category_id
                WHERE c.active = 1 AND p.out_of_stock = 0
                ORDER BY c.sort_order, p.id
            ''')
            if row['available'] or row['id'] in combo_ingredient_ids
        ]
        delivery_row = conn.execute('SELECT * FROM delivery_settings WHERE id = 1').fetchone()
        condos = [
            {'id': row['id'], 'name': row['name'], 'fee': row['fee'], 'active': bool(row['active']), 'towers': json.loads(row['towers'])}
            for row in conn.execute('SELECT * FROM condominiums WHERE active = 1 ORDER BY name')
        ]
        coupons = [
            {
                'id': row['id'], 'code': row['code'], 'type': row['discount_type'], 'value': row['discount_value'],
                'maxUses': row['max_uses'], 'usedCount': row['used_count'], 'active': bool(row['active'])
            }
            for row in conn.execute('SELECT * FROM coupons WHERE active = 1 ORDER BY code')
        ]
        return {
            'store': store,
            'categories': ['Todos', *categories],
            'products': products,
            'delivery': {
                'commonFee': delivery_row['common_fee'], 'estimatedTime': delivery_row['estimated_time'],
                'storeAddress': delivery_row['store_address'], 'storeLat': delivery_row['store_lat'], 'storeLng': delivery_row['store_lng'],
                'maxRadiusKm': delivery_row['max_radius_km'], 'perKmFee': delivery_row['per_km_fee'],
                'googleMapsKeyConfigured': bool(delivery_row['google_maps_key']),
                'condominiums': condos
            },
            'coupons': coupons
        }

def request_json(handler):
    length = int(handler.headers.get('Content-Length') or 0)
    if length == 0:
        return {}
    return json.loads(handler.rfile.read(length).decode('utf-8'))

def admin_credentials():
    with db() as conn:
        row = conn.execute('SELECT email, password FROM admin_settings WHERE id = 1').fetchone()
        if not row:
            return {'email': ADMIN_EMAIL, 'password': ADMIN_PASSWORD}
        return {'email': row['email'], 'password': row['password']}

def send_security_email(email, code):
    subject = 'Codigo de seguranca - Gabriel Pizza'
    text = (
        f"Seu codigo de seguranca para redefinir a senha do painel Gabriel Pizza e: {code}\n\n"
        "Esse codigo expira em 10 minutos. Se voce nao solicitou, ignore este e-mail."
    )
    html = f"""
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
          <h2>Codigo de seguranca - Gabriel Pizza</h2>
          <p>Use o codigo abaixo para continuar:</p>
          <p style="font-size:28px;font-weight:700;letter-spacing:4px">{code}</p>
          <p>Esse codigo expira em 10 minutos. Se voce nao solicitou, ignore este e-mail.</p>
        </div>
    """
    resend_key = os.environ.get('RESEND_API_KEY')
    if resend_key:
        sender = os.environ.get('RESEND_FROM') or 'Gabriel Pizza <onboarding@resend.dev>'
        payload = json.dumps({'from': sender, 'to': [email], 'subject': subject, 'text': text, 'html': html}).encode('utf-8')
        request = Request(
            'https://api.resend.com/emails',
            data=payload,
            headers={'Authorization': f'Bearer {resend_key}', 'Content-Type': 'application/json'},
            method='POST'
        )
        try:
            with urlopen(request, timeout=15) as response:
                ok = 200 <= response.status < 300
                if not ok:
                    print(f'Resend API status: {response.status}', flush=True)
                return ok
        except Exception as error:
            print(f'Resend API error: {type(error).__name__}: {error}', flush=True)

    brevo_key = os.environ.get('BREVO_API_KEY')
    if brevo_key:
        from_email = os.environ.get('BREVO_FROM_EMAIL') or os.environ.get('GABRIEL_SMTP_FROM') or email
        from_name = os.environ.get('BREVO_FROM_NAME') or 'Gabriel Pizza'
        payload = json.dumps({
            'sender': {'name': from_name, 'email': from_email},
            'to': [{'email': email}],
            'subject': subject,
            'htmlContent': html,
            'textContent': text
        }).encode('utf-8')
        request = Request(
            'https://api.brevo.com/v3/smtp/email',
            data=payload,
            headers={'api-key': brevo_key, 'accept': 'application/json', 'content-type': 'application/json'},
            method='POST'
        )
        try:
            with urlopen(request, timeout=15) as response:
                ok = 200 <= response.status < 300
                if not ok:
                    print(f'Brevo API status: {response.status}', flush=True)
                return ok
        except Exception as error:
            print(f'Brevo API error: {type(error).__name__}: {error}', flush=True)

    host = os.environ.get('GABRIEL_SMTP_HOST')
    user = os.environ.get('GABRIEL_SMTP_USER')
    password = os.environ.get('GABRIEL_SMTP_PASSWORD')
    if not host or not user or not password or password in {'sua-senha-de-app', 'COLOQUE_SUA_SENHA_DE_APP_AQUI'}:
        print('SMTP not configured: missing host/user/password', flush=True)
        return False
    port = int(os.environ.get('GABRIEL_SMTP_PORT') or 587)
    sender = os.environ.get('GABRIEL_SMTP_FROM') or user
    message = EmailMessage()
    message['Subject'] = subject
    message['From'] = sender
    message['To'] = email
    message.set_content(text)
    context = ssl.create_default_context()
    if port == 465:
        try:
            with smtplib.SMTP_SSL(host, port, timeout=15, context=context) as smtp:
                smtp.login(user, password)
                smtp.send_message(message)
            return True
        except Exception as error:
            print(f'SMTP SSL error: {type(error).__name__}: {error}', flush=True)
            return False
    try:
        with smtplib.SMTP(host, port, timeout=15) as smtp:
            smtp.starttls(context=context)
            smtp.login(user, password)
            smtp.send_message(message)
        return True
    except Exception as error:
        print(f'SMTP STARTTLS error: {type(error).__name__}: {error}', flush=True)
    try:
        addresses = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)
    except OSError:
        return False
    for family, socktype, proto, _, address in addresses:
        smtp = None
        try:
            sock = socket.socket(family, socktype, proto)
            sock.settimeout(15)
            sock.connect(address)
            smtp = smtplib.SMTP(timeout=15)
            smtp.sock = sock
            smtp.file = sock.makefile('rb')
            smtp._host = host
            code_response, _ = smtp.getreply()
            if code_response != 220:
                smtp.close()
                continue
            smtp.ehlo()
            smtp.starttls(context=context)
            smtp.ehlo()
            smtp.login(user, password)
            smtp.send_message(message)
            smtp.quit()
            return True
        except Exception:
            print('SMTP IPv4 fallback failed', flush=True)
            try:
                if smtp:
                    smtp.close()
            except Exception:
                pass
    return False

def should_log_recovery_codes():
    return str(os.environ.get('GABRIEL_LOG_RECOVERY_CODES') or '').strip().lower() in {'1', 'true', 'sim', 'yes'}

def configured_recovery_code():
    code = str(os.environ.get('GABRIEL_RECOVERY_CODE') or '').strip()
    return code if len(code) >= 4 else ''

def request_admin_password_code(payload):
    email = str(payload.get('email') or '').strip().lower()
    credentials = admin_credentials()
    print(f'Password recovery requested for {email}', flush=True)
    if email != credentials['email'].lower():
        raise ValueError('E-mail administrativo nao encontrado')
    recovery_code = configured_recovery_code()
    code = recovery_code or f"{random.randint(0, 999999):06d}"
    expires_at = time.time() + (15 * 60)
    with db() as conn:
        conn.execute('UPDATE admin_password_resets SET used = 1 WHERE email = ? AND used = 0', (credentials['email'],))
        conn.execute(
            'INSERT INTO admin_password_resets (email, code, expires_at, used) VALUES (?, ?, ?, 0)',
            (credentials['email'], code, expires_at)
        )
    if recovery_code:
        return {
            'ok': True,
            'email': credentials['email'],
            'emailSent': False,
            'message': 'Use o codigo de recuperacao configurado no Render para definir a nova senha.'
        }
    email_sent = send_security_email(credentials['email'], code)
    print(f'Password recovery emailSent={email_sent}', flush=True)
    response = {'ok': True, 'email': credentials['email'], 'emailSent': email_sent}
    if not email_sent:
        if should_log_recovery_codes():
            print(f'Password recovery code for {credentials["email"]}: {code}', flush=True)
            response['message'] = 'Nao foi possivel enviar por e-mail. O codigo temporario foi registrado nos logs do Render.'
        else:
            response['message'] = 'Nao foi possivel enviar o codigo por e-mail. Configure RESEND_API_KEY no Render ou confira o SMTP.'
        if not os.environ.get('RENDER'):
            response['devCode'] = code
            response['message'] = 'SMTP nao configurado. Codigo exibido apenas para teste local.'
    return response

def confirm_admin_password_code(payload):
    email = str(payload.get('email') or '').strip().lower()
    code = str(payload.get('code') or '').strip()
    password = str(payload.get('password') or '')
    confirm = str(payload.get('confirm') or '')
    credentials = admin_credentials()
    if email != credentials['email'].lower():
        raise ValueError('E-mail administrativo nao encontrado')
    if not code:
        raise ValueError('Informe o codigo de seguranca')
    if len(password) < 8:
        raise ValueError('A nova senha deve ter pelo menos 8 caracteres')
    if password != confirm:
        raise ValueError('As senhas nao conferem')
    with db() as conn:
        reset = conn.execute(
            '''SELECT id FROM admin_password_resets
               WHERE email = ? AND code = ? AND used = 0 AND expires_at >= ?
               ORDER BY id DESC LIMIT 1''',
            (credentials['email'], code, time.time())
        ).fetchone()
        if not reset:
            raise ValueError('Codigo invalido ou expirado')
        conn.execute('UPDATE admin_settings SET password = ? WHERE id = 1', (password,))
        conn.execute('UPDATE admin_password_resets SET used = 1 WHERE id = ?', (reset['id'],))
    return {'ok': True, 'email': credentials['email']}

def request_admin_email_code(payload):
    credentials = admin_credentials()
    new_email = str(payload.get('newEmail') or '').strip().lower()
    if '@' not in new_email or '.' not in new_email:
        raise ValueError('Informe um novo e-mail valido')
    recovery_code = configured_recovery_code()
    code = recovery_code or f"{random.randint(0, 999999):06d}"
    expires_at = time.time() + 15 * 60
    sent = False if recovery_code else send_security_email(new_email, code)
    with db() as conn:
        conn.execute('INSERT INTO admin_email_resets (current_email, new_email, code, expires_at) VALUES (?, ?, ?, ?)', (credentials['email'], new_email, code, expires_at))
    result = {'ok': True, 'emailSent': sent, 'newEmail': new_email}
    if recovery_code:
        result['message'] = 'Use o codigo de recuperacao configurado no Render para confirmar a troca de e-mail.'
        return result
    if not sent:
        if should_log_recovery_codes():
            print(f'Admin email change code for {new_email}: {code}', flush=True)
            result['message'] = 'Nao foi possivel enviar por e-mail. O codigo temporario foi registrado nos logs do Render.'
        else:
            result['message'] = 'Nao foi possivel enviar o codigo por e-mail. Configure RESEND_API_KEY no Render ou confira o SMTP.'
        if not os.environ.get('RENDER'):
            result['devCode'] = code
    return result

def confirm_admin_email_code(payload):
    code = str(payload.get('code') or '').strip()
    new_email = str(payload.get('newEmail') or '').strip().lower()
    with db() as conn:
        reset = conn.execute('''
            SELECT * FROM admin_email_resets
            WHERE new_email = ? AND code = ? AND used = 0 AND expires_at > ?
            ORDER BY id DESC LIMIT 1
        ''', (new_email, code, time.time())).fetchone()
        if not reset:
            raise ValueError('Codigo invalido ou expirado')
        conn.execute('UPDATE admin_settings SET email = ? WHERE id = 1', (new_email,))
        conn.execute('UPDATE admin_email_resets SET used = 1 WHERE id = ?', (reset['id'],))
    return {'ok': True, 'email': new_email}

def common_address_text(delivery):
    parts = [
        f"{delivery.get('street', '')}, {delivery.get('number', '')}",
        str(delivery.get('district') or ''),
        str(delivery.get('zip') or ''),
        str(delivery.get('reference') or '')
    ]
    return ', '.join(part for part in parts if part.strip())

def google_distance_km(settings, delivery):
    key = str(settings['google_maps_key'] or '').strip()
    if not key:
        raise ValueError('Configure a chave do Google Maps no painel de entregas para calcular a distancia.')
    origin = f"{settings['store_lat']},{settings['store_lng']}" if settings['store_lat'] and settings['store_lng'] else settings['store_address']
    params = urlencode({
        'origins': origin,
        'destinations': common_address_text(delivery),
        'key': key,
        'units': 'metric',
        'language': 'pt-BR',
        'region': 'br'
    })
    with urlopen(f'https://maps.googleapis.com/maps/api/distancematrix/json?{params}', timeout=8) as response:
        data = json.loads(response.read().decode('utf-8'))
    if data.get('status') != 'OK':
        raise ValueError('Nao foi possivel consultar o Google Maps para esse endereco.')
    element = data.get('rows', [{}])[0].get('elements', [{}])[0]
    if element.get('status') != 'OK':
        raise ValueError('Nao foi possivel calcular entrega para esse endereco pelo Google Maps.')
    return round(float(element['distance']['value']) / 1000, 2)

def quote_common_delivery(conn, delivery):
    settings = conn.execute('SELECT * FROM delivery_settings WHERE id = 1').fetchone()
    distance = google_distance_km(settings, delivery)
    if distance > float(settings['max_radius_km']):
        raise ValueError('Nao atendemos esse endereco porque ele fica fora do raio de entrega.')
    fee = round(float(settings['common_fee']) + (distance * float(settings['per_km_fee'])), 2)
    return {'distanceKm': distance, 'deliveryFee': fee, 'maxRadiusKm': settings['max_radius_km']}

def delivery_quote(payload):
    delivery = payload.get('delivery') or payload
    with db() as conn:
        return quote_common_delivery(conn, delivery)

def validate_delivery(conn, delivery):
    mode = 'condo' if delivery.get('mode') == 'condo' else 'common'
    if mode == 'condo':
        required = ['condominiumId', 'tower', 'apartment']
    else:
        required = ['street', 'number', 'district', 'zip', 'reference']
    missing = [field for field in required if str(delivery.get(field) or '').strip() == '']
    if missing:
        raise ValueError('Preencha todos os campos obrigatorios do endereco')
    if mode == 'common':
        quote_common_delivery(conn, delivery)
    return mode

def calculate_totals(conn, items, coupon_code, delivery):
    subtotal = round(sum(item['price'] * item['qty'] for item in items), 2)
    delivery_mode = 'condo' if delivery.get('mode') == 'condo' else 'common'
    if delivery_mode == 'condo':
        condo_id = str(delivery.get('condominiumId') or 'reserva-garcas-1')
        condo = conn.execute('SELECT fee FROM condominiums WHERE id = ? AND active = 1', (condo_id,)).fetchone()
        if not condo:
            raise ValueError('Condominio indisponivel')
        fee = condo['fee']
    else:
        quote = quote_common_delivery(conn, delivery)
        fee = quote['deliveryFee']
    coupon = conn.execute('SELECT * FROM coupons WHERE code = ? AND active = 1', (coupon_code,)).fetchone() if coupon_code else None
    if coupon_code and not coupon:
        raise ValueError('Cupom invalido')
    if coupon and coupon['max_uses'] is not None and coupon['used_count'] >= coupon['max_uses']:
        raise ValueError('Este cupom ja foi utilizado a quantidade maxima.')
    discount = round(subtotal * (coupon['discount_value'] / 100), 2) if coupon and coupon['discount_type'] == 'percent' else 0
    return {'subtotal': subtotal, 'deliveryFee': round(fee if subtotal else 0, 2), 'discount': discount, 'total': round(max(0, subtotal + (fee if subtotal else 0) - discount), 2), 'couponApplied': coupon['code'] if coupon else ''}

def create_order(payload):
    customer = payload.get('customer') or {}
    delivery = payload.get('delivery') or {}
    payment = payload.get('payment') or {}
    raw_items = payload.get('items') or []
    if not customer.get('name') or not customer.get('phone'):
        raise ValueError('Nome e telefone sao obrigatorios')
    if not raw_items:
        raise ValueError('Pedido sem itens')

    with db() as conn:
        store_status = row_to_store(conn.execute('SELECT * FROM store WHERE id = 1').fetchone())
        if not store_status['isOpen']:
            raise ValueError(store_status['closedMessage'] or 'Estamos fechados no momento.')
        items = []
        for raw_item in raw_items:
            qty = max(1, int(raw_item.get('qty') or 1))
            if raw_item.get('customType') == 'comboPizza':
                combo = conn.execute('''
                    SELECT p.id, p.name, p.price, p.combo_allow_half, p.combo_product_ids, p.combo_product_discounts, c.name AS category
                    FROM products p JOIN categories c ON c.id = p.category_id
                    WHERE p.id = ? AND p.available = 1 AND p.out_of_stock = 0 AND p.combo_product_ids != '[]'
                ''', (int(raw_item.get('comboId')),)).fetchone()
                if not combo:
                    raise ValueError('Combo indisponivel')
                mode = str(raw_item.get('mode') or 'whole')
                flavor_ids = [int(raw_item.get('flavorA') or 0)]
                if mode == 'half':
                    flavor_ids.append(int(raw_item.get('flavorB') or 0))
                combo_allowed_ids = [int(item) for item in json.loads(combo['combo_product_ids'] or '[]') if str(item).isdigit()]
                combo_discounts = parse_json_dict(combo['combo_product_discounts'], {})
                if any(flavor_id not in combo_allowed_ids for flavor_id in flavor_ids):
                    raise ValueError('Sabor nao pertence a este combo')
                placeholders = ','.join('?' for _ in flavor_ids)
                flavors = conn.execute(f'''
                    SELECT p.id, p.name, p.price, c.name AS category, c.allow_half AS category_allow_half
                    FROM products p JOIN categories c ON c.id = p.category_id
                    WHERE p.id IN ({placeholders}) AND p.out_of_stock = 0 AND c.name LIKE 'Pizzas%'
                ''', flavor_ids).fetchall()
                if len(flavors) != len(set(flavor_ids)):
                    raise ValueError('Sabores do combo invalidos')
                by_id = {flavor['id']: flavor for flavor in flavors}
                selected_flavors = [by_id[flavor_id] for flavor_id in flavor_ids]
                if mode == 'half' and not any(flavor['category_allow_half'] or str(flavor['category']).startswith('Pizzas') for flavor in selected_flavors):
                    raise ValueError('Esta categoria nao permite meio a meio')
                extras_total = 0
                extra_ids = [item_id for item_id in combo_allowed_ids if item_id not in flavor_ids]
                if extra_ids:
                    extra_placeholders = ','.join('?' for _ in extra_ids)
                    extras = conn.execute(f'''
                        SELECT p.id, p.price
                        FROM products p JOIN categories c ON c.id = p.category_id
                        WHERE p.id IN ({extra_placeholders}) AND p.out_of_stock = 0 AND c.name NOT LIKE 'Pizzas%'
                    ''', extra_ids).fetchall()
                    extras_total = sum(max(0, float(extra['price']) - float(combo_discounts.get(str(extra['id']), 0) or 0)) for extra in extras)
                pizza_average = sum(max(0, float(flavor['price']) - float(combo_discounts.get(str(flavor['id']), 0) or 0)) for flavor in selected_flavors) / len(selected_flavors)
                price = round(pizza_average + extras_total, 2)
                if mode == 'half':
                    name = f"{combo['name']} - meio a meio: {by_id[flavor_ids[0]]['name']} / {by_id[flavor_ids[1]]['name']}"
                else:
                    name = f"{combo['name']} - pizza inteira: {by_id[flavor_ids[0]]['name']}"
                items.append({'id': combo['id'], 'name': name, 'category': 'Combos', 'price': price, 'qty': qty})
                continue
            if raw_item.get('customType') == 'halfPizza':
                flavor_ids = [int(raw_item.get('flavorA')), int(raw_item.get('flavorB'))]
                flavors = conn.execute('''
                    SELECT p.id, p.name, p.price, c.name AS category
                    FROM products p JOIN categories c ON c.id = p.category_id
                    WHERE p.id IN (?, ?) AND p.out_of_stock = 0 AND c.name LIKE 'Pizzas%'
                ''', (flavor_ids[0], flavor_ids[1])).fetchall()
                if len(flavors) != 2 and flavor_ids[0] != flavor_ids[1]:
                    raise ValueError('Sabores da pizza meio a meio invalidos')
                if flavor_ids[0] == flavor_ids[1] and len(flavors) == 1:
                    flavors = [flavors[0], flavors[0]]
                price = max(flavor['price'] for flavor in flavors)
                name = f"Meio a meio: {flavors[0]['name']} / {flavors[1]['name']}"
                items.append({'id': flavors[0]['id'], 'name': name, 'category': 'Pizzas Meio a Meio', 'price': price, 'qty': qty})
                continue
            product = conn.execute('''
                SELECT p.id, p.name, p.price, c.name AS category
                FROM products p JOIN categories c ON c.id = p.category_id
                WHERE p.id = ? AND p.available = 1 AND p.out_of_stock = 0
            ''', (int(raw_item.get('id')),)).fetchone()
            if not product:
                raise ValueError(f"Produto indisponivel: {raw_item.get('id')}")
            items.append({'id': product['id'], 'name': product['name'], 'category': product['category'], 'price': product['price'], 'qty': qty})

        delivery_mode = validate_delivery(conn, delivery)
        coupon_code = str(payload.get('coupon') or '').strip().upper()
        totals = calculate_totals(conn, items, coupon_code, delivery)
        order_id = f"PED-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6].upper()}"
        now = datetime.now(timezone.utc).isoformat()
        condo_id = str(delivery.get('condominiumId') or 'reserva-garcas-1')
        condo_name = ''
        if delivery_mode == 'condo':
            condo_row = conn.execute('SELECT name FROM condominiums WHERE id = ?', (condo_id,)).fetchone()
            condo_name = condo_row['name'] if condo_row else 'Condominio'

        conn.execute('''
            INSERT INTO orders (
                id, created_at, status, customer_name, customer_phone, payment_method, change_for,
                coupon_code, notes, delivery_mode, street, number, district, zip, complement, reference,
                condominium_name, tower, apartment, delivery_note, subtotal, delivery_fee, discount, total
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            order_id, now, STATUSES[0], str(customer['name']), str(customer['phone']), str(payment.get('method') or 'Pix'), str(payment.get('changeFor') or ''),
            coupon_code, str(payload.get('notes') or ''), delivery_mode, str(delivery.get('street') or ''), str(delivery.get('number') or ''),
            str(delivery.get('district') or ''), str(delivery.get('zip') or ''), str(delivery.get('complement') or ''), str(delivery.get('reference') or ''),
            condo_name if delivery_mode == 'condo' else '', str(delivery.get('tower') or ''), str(delivery.get('apartment') or ''), str(delivery.get('note') or ''),
            totals['subtotal'], totals['deliveryFee'], totals['discount'], totals['total']
        ))
        if totals.get('couponApplied'):
            conn.execute('UPDATE coupons SET used_count = used_count + 1 WHERE code = ?', (totals['couponApplied'],))
        for item in items:
            conn.execute('''
                INSERT INTO order_items (order_id, product_id, product_name, category_name, unit_price, quantity, line_total)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (order_id, item['id'], item['name'], item['category'], item['price'], item['qty'], round(item['price'] * item['qty'], 2)))
        return get_order(conn, order_id)

def get_order(conn, order_id):
    order = conn.execute('SELECT * FROM orders WHERE id = ?', (order_id,)).fetchone()
    items = conn.execute('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', (order_id,)).fetchall()
    return order_to_json(order, items)

def order_to_json(order, items):
    delivery = {'mode': order['delivery_mode']}
    if order['delivery_mode'] == 'condo':
        delivery.update({'condominium': order['condominium_name'], 'tower': order['tower'], 'apartment': order['apartment'], 'note': order['delivery_note']})
    else:
        delivery.update({'street': order['street'], 'number': order['number'], 'district': order['district'], 'zip': order['zip'], 'complement': order['complement'], 'reference': order['reference']})
    return {
        'id': order['id'], 'createdAt': order['created_at'], 'updatedAt': order['updated_at'], 'status': order['status'],
        'customer': {'name': order['customer_name'], 'phone': order['customer_phone']},
        'payment': {'method': order['payment_method'], 'changeFor': order['change_for'] or ''},
        'coupon': order['coupon_code'] or '', 'notes': order['notes'] or '', 'delivery': delivery,
        'items': [{'id': item['product_id'], 'name': item['product_name'], 'category': item['category_name'], 'price': item['unit_price'], 'qty': item['quantity']} for item in items],
        'totals': {'subtotal': order['subtotal'], 'deliveryFee': order['delivery_fee'], 'discount': order['discount'], 'total': order['total']}
    }

def list_orders():
    with db() as conn:
        orders = conn.execute('SELECT * FROM orders ORDER BY created_at DESC').fetchall()
        return [order_to_json(order, conn.execute('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', (order['id'],)).fetchall()) for order in orders]

def admin_products():
    with db() as conn:
        return [
            {
                'id': row['id'], 'category': row['category'], 'categoryId': row['category_id'], 'name': row['name'],
                'price': row['price'], 'desc': row['description'], 'ingredients': row['ingredients'],
                'image': row['image_url'], 'available': bool(row['available']), 'outOfStock': bool(row['out_of_stock']),
                'comboProductIds': json.loads(row['combo_product_ids'] or '[]'),
                'comboProductDiscounts': parse_json_dict(row['combo_product_discounts'], {}),
                'comboAllowHalf': bool(row['combo_allow_half']), 'categoryAllowHalf': bool(row['category_allow_half'])
            }
            for row in conn.execute('''
                SELECT p.*, c.name AS category, c.allow_half AS category_allow_half
                FROM products p JOIN categories c ON c.id = p.category_id
                ORDER BY c.sort_order, p.id
            ''')
        ]

def admin_categories():
    with db() as conn:
        return [
            {'id': row['id'], 'name': row['name'], 'sortOrder': row['sort_order'], 'active': bool(row['active']), 'allowHalf': bool(row['allow_half'])}
            for row in conn.execute('SELECT id, name, sort_order, active, allow_half FROM categories ORDER BY sort_order, name')
        ]

def require_text(payload, key):
    value = str(payload.get(key) or '').strip()
    if not value:
        raise ValueError(f'{key} obrigatorio')
    return value

def product_payload(payload):
    name = require_text(payload, 'name')
    category_id = int(payload.get('categoryId') or 0)
    price = float(payload.get('price') or 0)
    if price <= 0:
        raise ValueError('Preco deve ser maior que zero')
    desc = require_text(payload, 'desc')
    ingredients = require_text(payload, 'ingredients')
    image = str(payload.get('image') or '').strip() or 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=900&q=80'
    available = 1 if payload.get('available', True) else 0
    out_of_stock = 1 if payload.get('outOfStock') else 0
    combo_product_ids = payload.get('comboProductIds') or []
    if not isinstance(combo_product_ids, list):
        combo_product_ids = []
    combo_product_ids = [int(item) for item in combo_product_ids if str(item).isdigit()]
    raw_discounts = payload.get('comboProductDiscounts') or {}
    if not isinstance(raw_discounts, dict):
        raw_discounts = {}
    combo_product_discounts = {}
    for product_id in combo_product_ids:
        try:
            discount = max(0, float(raw_discounts.get(str(product_id), raw_discounts.get(product_id, 0)) or 0))
        except Exception:
            discount = 0
        if discount > 0:
            combo_product_discounts[str(product_id)] = round(discount, 2)
    combo_allow_half = 1 if payload.get('comboAllowHalf') else 0
    return category_id, name, price, desc, ingredients, image, available, out_of_stock, combo_product_ids, combo_product_discounts, combo_allow_half

def create_product(payload):
    with db() as conn:
        category_id, name, price, desc, ingredients, image, available, out_of_stock, combo_product_ids, combo_product_discounts, combo_allow_half = product_payload(payload)
        if not conn.execute('SELECT id FROM categories WHERE id = ?', (category_id,)).fetchone():
            raise ValueError('Categoria invalida')
        insert_sql = '''
            INSERT INTO products (category_id, name, price, description, ingredients, image_url, available, out_of_stock, combo_product_ids, combo_product_discounts, combo_allow_half)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        '''
        if USE_POSTGRES:
            insert_sql += ' RETURNING id'
            product_id = conn.execute(insert_sql, (category_id, name, price, desc, ingredients, image, available, out_of_stock, json.dumps(combo_product_ids), json.dumps(combo_product_discounts), combo_allow_half)).fetchone()['id']
        else:
            cursor = conn.execute(insert_sql, (category_id, name, price, desc, ingredients, image, available, out_of_stock, json.dumps(combo_product_ids), json.dumps(combo_product_discounts), combo_allow_half))
            product_id = cursor.lastrowid
    return next(item for item in admin_products() if item['id'] == product_id)

def update_product(product_id, payload):
    with db() as conn:
        if not conn.execute('SELECT id FROM products WHERE id = ?', (product_id,)).fetchone():
            return None
        category_id, name, price, desc, ingredients, image, available, out_of_stock, combo_product_ids, combo_product_discounts, combo_allow_half = product_payload(payload)
        if not conn.execute('SELECT id FROM categories WHERE id = ?', (category_id,)).fetchone():
            raise ValueError('Categoria invalida')
        conn.execute('''
            UPDATE products
            SET category_id = ?, name = ?, price = ?, description = ?, ingredients = ?, image_url = ?, available = ?, out_of_stock = ?, combo_product_ids = ?, combo_product_discounts = ?, combo_allow_half = ?
            WHERE id = ?
        ''', (category_id, name, price, desc, ingredients, image, available, out_of_stock, json.dumps(combo_product_ids), json.dumps(combo_product_discounts), combo_allow_half, product_id))
    return next(item for item in admin_products() if item['id'] == product_id)

def delete_product(product_id):
    with db() as conn:
        product = conn.execute('SELECT id, combo_product_ids FROM products WHERE id = ?', (product_id,)).fetchone()
        if not product:
            return False
        is_combo = bool(json.loads(product['combo_product_ids'] or '[]'))
        order_count = conn.execute('SELECT COUNT(*) AS total FROM order_items WHERE product_id = ?', (product_id,)).fetchone()['total']
        if order_count and not is_combo:
            raise ValueError('Este produto ja possui historico de pedidos. Use Ocultar para remover do cardapio sem apagar o historico.')
        for combo in conn.execute('SELECT id, combo_product_ids FROM products WHERE combo_product_ids != ?', ('[]',)):
            try:
                combo_ids = [int(item) for item in json.loads(combo['combo_product_ids'] or '[]')]
            except Exception:
                combo_ids = []
            if product_id in combo_ids and int(combo['id']) != product_id:
                raise ValueError('Este produto esta vinculado a um combo. Remova ele dos combos antes de excluir.')
        if is_combo and order_count:
            conn.execute('PRAGMA foreign_keys = OFF')
            conn.execute('DELETE FROM products WHERE id = ?', (product_id,))
            conn.execute('PRAGMA foreign_keys = ON')
            return True
        conn.execute('DELETE FROM products WHERE id = ?', (product_id,))
        return True

def create_category(payload):
    name = require_text(payload, 'name')
    allow_half = 1 if payload.get('allowHalf') else 0
    with db() as conn:
        sort = conn.execute('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_sort FROM categories').fetchone()['next_sort']
        conn.execute('INSERT OR IGNORE INTO categories (name, sort_order, active, allow_half) VALUES (?, ?, 1, ?)', (name, sort, allow_half))
    return admin_categories()

def update_category(category_id, payload):
    name = require_text(payload, 'name')
    active = 1 if payload.get('active', True) else 0
    allow_half = 1 if payload.get('allowHalf') else 0
    sort_order = int(payload.get('sortOrder') or 0)
    with db() as conn:
        current = conn.execute('SELECT sort_order FROM categories WHERE id = ?', (category_id,)).fetchone()
        if not current:
            return None
        if sort_order <= 0:
            sort_order = current['sort_order']
        conn.execute('UPDATE categories SET name = ?, active = ?, allow_half = ?, sort_order = ? WHERE id = ?', (name, active, allow_half, sort_order, category_id))
    return admin_categories()

def delete_category(category_id):
    with db() as conn:
        category = conn.execute('SELECT id FROM categories WHERE id = ?', (category_id,)).fetchone()
        if not category:
            return False
        product_rows = conn.execute('SELECT id FROM products WHERE category_id = ?', (category_id,)).fetchall()
        product_ids = [int(row['id']) for row in product_rows]
        if product_ids:
            for combo in conn.execute('SELECT id, combo_product_ids FROM products WHERE combo_product_ids != ?', ('[]',)):
                try:
                    combo_ids = [int(item) for item in json.loads(combo['combo_product_ids'] or '[]')]
                except Exception:
                    combo_ids = []
                updated_ids = [item for item in combo_ids if item not in product_ids]
                if updated_ids != combo_ids and int(combo['id']) not in product_ids:
                    conn.execute('UPDATE products SET combo_product_ids = ? WHERE id = ?', (json.dumps(updated_ids), combo['id']))
            conn.commit()
            conn.execute('PRAGMA foreign_keys = OFF')
            try:
                for product_id in product_ids:
                    conn.execute('DELETE FROM products WHERE id = ?', (product_id,))
                result = conn.execute('DELETE FROM categories WHERE id = ?', (category_id,))
                conn.commit()
                return result.rowcount > 0
            finally:
                conn.execute('PRAGMA foreign_keys = ON')
        result = conn.execute('DELETE FROM categories WHERE id = ?', (category_id,))
        return result.rowcount > 0


def update_store_status(payload):
    is_open = 1 if payload.get('isOpen') else 0
    name = str(payload.get('name') or 'Gabriel Pizza').strip()
    description = str(payload.get('description') or 'Pizzaria artesanal').strip()
    closed_message = str(payload.get('closedMessage') or 'Estamos fechados no momento. Volte mais tarde para fazer seu pedido.').strip()
    whatsapp = digits_only(payload.get('phone'))
    if len(whatsapp) in (10, 11):
        whatsapp = f'55{whatsapp}'
    if len(whatsapp) < 12:
        raise ValueError('Informe um WhatsApp valido com DDD')
    display_phone = str(payload.get('displayPhone') or format_brazil_phone(whatsapp)).strip()
    pix_key = str(payload.get('pixKey') or '').strip()
    if not pix_key:
        raise ValueError('Informe a chave Pix')
    auto_hours = 1 if payload.get('autoHours') else 0
    weekly_hours = payload.get('weeklyHours') if isinstance(payload.get('weeklyHours'), dict) else DEFAULT_WEEKLY_HOURS
    with db() as conn:
        conn.execute(
            'UPDATE store SET name = ?, description = ?, is_open = ?, closed_message = ?, phone = ?, display_phone = ?, pix_key = ?, auto_hours = ?, weekly_hours = ? WHERE id = 1',
            (name, description, is_open, closed_message, whatsapp, display_phone, pix_key, auto_hours, json.dumps(weekly_hours))
        )
    with db() as conn:
        return row_to_store(conn.execute('SELECT * FROM store WHERE id = 1').fetchone())

def update_delivery(payload):
    fee = float(payload.get('commonFee') or 0)
    max_radius = float(payload.get('maxRadiusKm') or 0)
    per_km_fee = float(payload.get('perKmFee') or 0)
    store_lat = float(payload.get('storeLat') or 0)
    store_lng = float(payload.get('storeLng') or 0)
    store_address = str(payload.get('storeAddress') or '').strip()
    if fee < 0 or max_radius <= 0 or per_km_fee < 0:
        raise ValueError('Taxa invalida')
    if not store_address:
        raise ValueError('Informe o endereco da loja')
    with db() as conn:
        current_key = conn.execute('SELECT google_maps_key FROM delivery_settings WHERE id = 1').fetchone()['google_maps_key']
        google_maps_key = str(payload.get('googleMapsKey') or '').strip() or current_key
        conn.execute(
            'UPDATE delivery_settings SET common_fee = ?, store_address = ?, store_lat = ?, store_lng = ?, max_radius_km = ?, per_km_fee = ?, google_maps_key = ? WHERE id = 1',
            (fee, store_address, store_lat, store_lng, max_radius, per_km_fee, google_maps_key)
        )
    return get_menu()['delivery']

def update_condo(payload):
    condo_id = str(payload.get('id') or 'reserva-garcas-1')
    fee = float(payload.get('fee') or 0)
    towers = [item.strip() for item in str(payload.get('towers') or '').split(',') if item.strip()]
    if fee < 0:
        raise ValueError('Taxa invalida')
    if not towers:
        raise ValueError('Informe pelo menos uma torre')
    with db() as conn:
        conn.execute('UPDATE condominiums SET fee = ?, towers = ? WHERE id = ?', (fee, json.dumps(towers), condo_id))
    return next((condo for condo in get_menu()['delivery']['condominiums'] if condo['id'] == condo_id), None)

def create_coupon(payload):
    code = require_text(payload, 'code').upper()
    value = float(payload.get('value') or 0)
    max_uses_raw = str(payload.get('maxUses') or '').strip()
    max_uses = int(max_uses_raw) if max_uses_raw else None
    if value <= 0:
        raise ValueError('Desconto deve ser maior que zero')
    if max_uses is not None and max_uses <= 0:
        raise ValueError('Limite de uso deve ser maior que zero')
    with db() as conn:
        if USE_POSTGRES:
            conn.execute('''
                INSERT INTO coupons (code, discount_type, discount_value, max_uses, used_count, active)
                VALUES (?, ?, ?, ?, COALESCE((SELECT used_count FROM coupons WHERE code = ?), 0), 1)
                ON CONFLICT (code) DO UPDATE SET
                  discount_type = EXCLUDED.discount_type,
                  discount_value = EXCLUDED.discount_value,
                  max_uses = EXCLUDED.max_uses,
                  active = 1
            ''', (code, 'percent', value, max_uses, code))
        else:
            conn.execute('INSERT OR REPLACE INTO coupons (code, discount_type, discount_value, max_uses, used_count, active) VALUES (?, ?, ?, ?, COALESCE((SELECT used_count FROM coupons WHERE code = ?), 0), 1)', (code, 'percent', value, max_uses, code))
        return get_menu()['coupons']

def delete_coupon(coupon_id):
    with db() as conn:
        result = conn.execute('UPDATE coupons SET active = 0 WHERE id = ?', (coupon_id,))
        return result.rowcount > 0

def admin_authorized(handler):
    return handler.headers.get('Authorization') == f'Bearer {ADMIN_TOKEN}'

def admin_summary():
    with db() as conn:
        rows = conn.execute('SELECT * FROM orders').fetchall()
        today = datetime.now(timezone.utc).date().isoformat()
        today_orders = [row for row in rows if str(row['created_at']).startswith(today) and row['status'] != 'Pedido cancelado']
        revenue = round(sum(row['total'] for row in today_orders), 2)
        pending = sum(1 for row in rows if row['status'] not in ('Entregue', 'Pedido cancelado'))
        top = conn.execute('''
            SELECT product_name, SUM(quantity) AS total
            FROM order_items
            GROUP BY product_name
            ORDER BY total DESC
            LIMIT 1
        ''').fetchone()
        return {
            'ordersToday': len(today_orders),
            'revenue': revenue,
            'pending': pending,
            'topProduct': top['product_name'] if top else '-'
        }

def update_order_status(order_id, status):
    if status not in STATUSES:
        raise ValueError('Status invalido')
    with db() as conn:
        if not conn.execute('SELECT id FROM orders WHERE id = ?', (order_id,)).fetchone():
            return None
        conn.execute('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', (status, datetime.now(timezone.utc).isoformat(), order_id))
        return get_order(conn, order_id)

class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, data):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status, message):
        self.send_json(status, {'error': message})

    def do_GET(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path == '/api/health':
                self.send_json(200, {'ok': True, 'name': get_menu()['store']['name'], 'database': 'PostgreSQL' if USE_POSTGRES else str(DB_PATH.name)})
            elif parsed.path == '/api/menu':
                self.send_json(200, get_menu())
            elif parsed.path == '/api/orders':
                if not admin_authorized(self):
                    self.send_error_json(401, 'Login administrativo necessario')
                else:
                    self.send_json(200, list_orders())
            elif parsed.path == '/api/admin/summary':
                if not admin_authorized(self):
                    self.send_error_json(401, 'Login administrativo necessario')
                else:
                    self.send_json(200, admin_summary())
            elif parsed.path == '/api/admin/products':
                if not admin_authorized(self):
                    self.send_error_json(401, 'Login administrativo necessario')
                else:
                    self.send_json(200, admin_products())
            elif parsed.path == '/api/admin/categories':
                if not admin_authorized(self):
                    self.send_error_json(401, 'Login administrativo necessario')
                else:
                    self.send_json(200, admin_categories())
            elif parsed.path.startswith('/api/'):
                self.send_error_json(404, 'Rota da API nao encontrada')
            else:
                self.serve_static(parsed.path)
        except Exception as error:
            if parsed.path.startswith('/api/'):
                self.send_error_json(500, str(error))
            else:
                raise

    def do_POST(self):
        path = urlparse(self.path).path
        if path == '/api/admin/login':
            try:
                body = request_json(self)
                credentials = admin_credentials()
                if body.get('email') == credentials['email'] and body.get('password') == credentials['password']:
                    self.send_json(200, {'token': ADMIN_TOKEN, 'email': credentials['email']})
                else:
                    self.send_error_json(401, 'E-mail ou senha invalidos')
            except Exception as error:
                self.send_error_json(400, str(error))
            return
        if path == '/api/admin/recover-request':
            try:
                self.send_json(200, request_admin_password_code(request_json(self)))
            except Exception as error:
                self.send_error_json(400, str(error))
            return
        if path == '/api/admin/recover-confirm':
            try:
                self.send_json(200, confirm_admin_password_code(request_json(self)))
            except Exception as error:
                self.send_error_json(400, str(error))
            return
        if path == '/api/delivery/quote':
            try:
                self.send_json(200, delivery_quote(request_json(self)))
            except Exception as error:
                self.send_error_json(400, str(error))
            return
        if path == '/api/admin/email-change-request':
            if not admin_authorized(self):
                self.send_error_json(401, 'Login administrativo necessario')
                return
            try:
                self.send_json(200, request_admin_email_code(request_json(self)))
            except Exception as error:
                self.send_error_json(400, str(error))
            return
        if path == '/api/admin/email-change-confirm':
            if not admin_authorized(self):
                self.send_error_json(401, 'Login administrativo necessario')
                return
            try:
                self.send_json(200, confirm_admin_email_code(request_json(self)))
            except Exception as error:
                self.send_error_json(400, str(error))
            return
        if path.startswith('/api/admin/'):
            if not admin_authorized(self):
                self.send_error_json(401, 'Login administrativo necessario')
                return
            try:
                body = request_json(self)
                if path == '/api/admin/products':
                    self.send_json(201, create_product(body))
                elif path == '/api/admin/categories':
                    self.send_json(201, create_category(body))
                elif path == '/api/admin/coupons':
                    self.send_json(201, create_coupon(body))
                else:
                    self.send_error_json(404, 'Rota da API nao encontrada')
            except Exception as error:
                self.send_error_json(400, str(error))
            return
        if path != '/api/orders':
            self.send_error_json(404, 'Rota da API nao encontrada')
            return
        try:
            self.send_json(201, create_order(request_json(self)))
        except Exception as error:
            self.send_error_json(400, str(error))

    def do_PATCH(self):
        path = urlparse(self.path).path
        parts = path.strip('/').split('/')
        if path == '/api/admin/store-status':
            if not admin_authorized(self):
                self.send_error_json(401, 'Login administrativo necessario')
                return
            try:
                self.send_json(200, update_store_status(request_json(self)))
            except Exception as error:
                self.send_error_json(400, str(error))
            return
        if path == '/api/admin/delivery':
            if not admin_authorized(self):
                self.send_error_json(401, 'Login administrativo necessario')
                return
            try:
                self.send_json(200, update_delivery(request_json(self)))
            except Exception as error:
                self.send_error_json(400, str(error))
            return
        if path == '/api/admin/condo':
            if not admin_authorized(self):
                self.send_error_json(401, 'Login administrativo necessario')
                return
            try:
                self.send_json(200, update_condo(request_json(self)))
            except Exception as error:
                self.send_error_json(400, str(error))
            return
        if len(parts) == 4 and parts[0] == 'api' and parts[1] == 'orders' and parts[3] == 'status':
            if not admin_authorized(self):
                self.send_error_json(401, 'Login administrativo necessario')
                return
            try:
                updated = update_order_status(parts[2], request_json(self).get('status'))
                if updated is None:
                    self.send_error_json(404, 'Pedido nao encontrado')
                else:
                    self.send_json(200, updated)
            except Exception as error:
                self.send_error_json(400, str(error))
            return
        self.send_error_json(404, 'Rota da API nao encontrada')

    def do_PUT(self):
        path = urlparse(self.path).path
        if not admin_authorized(self):
            self.send_error_json(401, 'Login administrativo necessario')
            return
        try:
            parts = path.strip('/').split('/')
            if len(parts) == 4 and parts[:3] == ['api', 'admin', 'products']:
                updated = update_product(int(parts[3]), request_json(self))
                if updated is None:
                    self.send_error_json(404, 'Produto nao encontrado')
                else:
                    self.send_json(200, updated)
            elif len(parts) == 4 and parts[:3] == ['api', 'admin', 'categories']:
                updated = update_category(int(parts[3]), request_json(self))
                if updated is None:
                    self.send_error_json(404, 'Categoria nao encontrada')
                else:
                    self.send_json(200, updated)
            else:
                self.send_error_json(404, 'Rota da API nao encontrada')
        except Exception as error:
            self.send_error_json(400, str(error))

    def do_DELETE(self):
        path = urlparse(self.path).path
        if not admin_authorized(self):
            self.send_error_json(401, 'Login administrativo necessario')
            return
        try:
            parts = path.strip('/').split('/')
            if len(parts) == 4 and parts[:3] == ['api', 'admin', 'products']:
                if delete_product(int(parts[3])):
                    self.send_json(200, {'ok': True})
                else:
                    self.send_error_json(404, 'Produto nao encontrado')
            elif len(parts) == 4 and parts[:3] == ['api', 'admin', 'coupons']:
                if delete_coupon(int(parts[3])):
                    self.send_json(200, get_menu()['coupons'])
                else:
                    self.send_error_json(404, 'Cupom nao encontrado')
            elif len(parts) == 4 and parts[:3] == ['api', 'admin', 'categories']:
                if delete_category(int(parts[3])):
                    self.send_json(200, admin_categories())
                else:
                    self.send_error_json(404, 'Categoria nao encontrada')
            else:
                self.send_error_json(404, 'Rota da API nao encontrada')
        except Exception as error:
            self.send_error_json(400, str(error))

    def serve_static(self, path):
        requested = '/index.html' if path == '/' else unquote(path)
        file_path = (ROOT / requested.lstrip('/')).resolve()
        if not str(file_path).startswith(str(ROOT)) or not file_path.exists() or not file_path.is_file():
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'Not found')
            return
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mimetypes.guess_type(file_path.name)[0] or 'application/octet-stream')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        return

if __name__ == '__main__':
    load_env_file()
    DATABASE_URL = os.environ.get('DATABASE_URL', '').strip()
    USE_POSTGRES = bool(DATABASE_URL)
    init_db()
    port = int(os.environ.get('PORT') or 4173)
    host = os.environ.get('HOST') or '0.0.0.0'
    server = ThreadingHTTPServer((host, port), Handler)
    database_label = 'PostgreSQL' if USE_POSTGRES else 'SQLite'
    print(f'Gabriel Pizza com {database_label} em http://{host}:{port}')
    server.serve_forever()




