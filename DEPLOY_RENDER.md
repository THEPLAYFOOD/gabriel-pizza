# Deploy Gabriel Pizza no Render

## 1. Criar Web Service no Render

No Render:

- New
- Web Service
- Conecte o repositorio `gabriel-pizza`
- Runtime: Python
- Build Command: `pip install -r requirements.txt`
- Start Command: `python server.py`
- Plan: Free

## 2. Variaveis de ambiente

Para recuperacao de senha por e-mail no Render, prefira Resend:

```text
RESEND_API_KEY=sua-chave-da-resend
RESEND_FROM=Gabriel Pizza <onboarding@resend.dev>
```

Se usar outro remetente, configure um dominio/remetente verificado na Resend e coloque em `RESEND_FROM`.

Sem dominio, se a Resend bloquear o envio, voce pode ativar temporariamente:

```text
GABRIEL_LOG_RECOVERY_CODES=true
```

Com isso, quando o envio por e-mail falhar, o codigo de recuperacao aparece nos logs do Render. Depois de recuperar o acesso, volte para `false`.

O SMTP do Gmail pode ficar como fallback, mas em alguns deploys gratuitos o acesso SMTP pode falhar:

```text
GABRIEL_SMTP_HOST=smtp.gmail.com
GABRIEL_SMTP_PORT=465
GABRIEL_SMTP_USER=seu-email@gmail.com
GABRIEL_SMTP_PASSWORD=sua-senha-de-app
GABRIEL_SMTP_FROM=seu-email@gmail.com
```

Se usar Google Maps, configure a chave pelo painel admin em Entregas.

## 3. Observacao importante

O SQLite local funciona para testar, mas no plano gratis os arquivos podem nao ser permanentes apos redeploy. Para uso real em producao, o ideal e migrar o banco para PostgreSQL.
