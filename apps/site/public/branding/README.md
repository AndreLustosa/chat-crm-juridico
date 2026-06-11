# Assets de branding pra mensagens WhatsApp

Imagens servidas publicamente em `https://andrelustosaadvogados.com.br/branding/...`
e usadas pelo backend ao enviar mensagens automatizadas (arquivamento de
processo, etc).

## Arquivos esperados

### `sticker-andre.webp`

**Usado em**: `apps/api/src/legal-cases/legal-cases.service.ts:archive()` —
enviado como figurinha (sticker) APOS a mensagem de despedida ao cliente
quando o processo eh arquivado.

**Especs**:
- Formato: **WebP** (transparente, 512x512px, < 100KB)
- Conteudo sugerido: foto do Andre Lustosa fazendo joinha + logo do
  escritorio sobreposto (recortado em fundo transparente)
- Override: env `BRANDING_STICKER_URL` aponta pra outra URL se quiser

**Como criar**:
1. Pega a imagem original (PNG/JPG)
2. Converte pra WebP 512x512 transparente:
   - Online: https://cloudconvert.com/png-to-webp (configura "lossless" + 512x512)
   - CLI: `cwebp -resize 512 512 -lossless input.png -o sticker-andre.webp`
3. Salva como `apps/web/public/branding/sticker-andre.webp`
4. Faz commit + deploy do web

Se nao salvar a imagem, o backend ainda envia a mensagem de texto
normalmente — apenas loga warn no envio do sticker (`Falha ao enviar
figurinha apos texto`). Sem regressao funcional.
