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

Para nao perder produtos, categorias, combos, pedidos e configuracoes apos redeploy, configure um banco PostgreSQL externo no Render:

```text
DATABASE_URL=postgresql://usuario:senha@host:5432/banco
```

Voce pode pegar essa URL em servicos como Supabase ou Neon. Sem `DATABASE_URL`, o sistema usa SQLite local e os dados podem resetar quando o Render recriar o servidor.

Para a recuperacao de senha simples, sem depender de e-mail, configure:

```text
GABRIEL_RECOVERY_CODE=123456
```

Quando clicar em "Enviar codigo" na tela de recuperacao, use esse codigo para definir a nova senha. Troque `123456` por um codigo seu, com pelo menos 4 caracteres.

Para recuperacao por e-mail no Render, prefira Resend:

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

Outra alternativa sem dominio proprio e usar a API da Brevo:

```text
BREVO_API_KEY=sua-chave-da-brevo
BREVO_FROM_EMAIL=seu-email-verificado@gmail.com
BREVO_FROM_NAME=Gabriel Pizza
```

Na Brevo, o remetente precisa estar cadastrado e verificado antes do envio funcionar.

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

O SQLite local continua funcionando para testar no computador. Em producao, use `DATABASE_URL` com PostgreSQL para persistencia real.
