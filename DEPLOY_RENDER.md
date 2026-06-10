# Deploy Gabriel Pizza no Render

## 1. Criar repositório no GitHub

Crie um repositório chamado `gabriel-pizza` e envie os arquivos desta pasta:

`outputs/pizzaria-digital`

Não envie o arquivo `.env`, porque ele contém senha de app do SMTP.

## 2. Criar Web Service no Render

No Render:

- New
- Web Service
- Conecte o repositório `gabriel-pizza`
- Runtime: Python
- Build Command: `pip install -r requirements.txt`
- Start Command: `python server.py`
- Plan: Free

## 3. Variáveis de ambiente

Configure no Render, em Environment:

```text
GABRIEL_SMTP_HOST=smtp.gmail.com
GABRIEL_SMTP_PORT=587
GABRIEL_SMTP_USER=seu-email@gmail.com
GABRIEL_SMTP_PASSWORD=sua-senha-de-app
GABRIEL_SMTP_FROM=seu-email@gmail.com
```

Se usar Google Maps, configure a chave pelo painel admin em Entregas.

## Observação importante

O SQLite local funciona para testar, mas no plano grátis os arquivos podem não ser permanentes após redeploy. Para uso real em produção, o ideal é migrar o banco para PostgreSQL.
