# Aventura da Família Lustosa em SC

Landing page do roteiro de viagem (16-21/08/2026).

## Como abrir

Basta abrir o `index.html` no navegador — não precisa servidor.

## Como editar o roteiro

**Tudo está em `data.js`.** Não toque no HTML/CSS/script.js para mudar conteúdo.

### Adicionar atividade num dia

Abra `data.js`, ache o dia, edite o array `atividades`:

```js
{
  hora: "14:00",
  titulo: "Sorvete na praia",
  local: "Quiosque do Zé",
  coords: { lat: -27.4321, lng: -48.5140 },
  dica: "Sabor de coco é o melhor",
  icone: "🍦",
}
```

### Marcar item "a confirmar"

Adicione `confirmar: true` no objeto. A página mostra badge amarelo automaticamente.

### Tirar o "Em breve" de um dia

Remova `placeholder: true` e preencha os campos (`resumo`, `atividades`, etc.). Veja o Dia 1 como modelo.

### Mudar cor de um dia

Edite `corAcento` no objeto do dia. Hex code (ex: `#FFD700`).

## Status

- [x] Dia 1 (Domingo 16/08 — Floripa Norte)
- [ ] Dia 2 (Segunda 17/08 — Centro Floripa + BC)
- [ ] Dia 3 (Terça 18/08 — Unipraias + Aquário + Summit BC)
- [ ] Dia 4 (Quarta 19/08 — Pomerode)
- [ ] Dia 5 (Quinta 20/08 — Beto Carrero D1)
- [ ] Dia 6 (Sexta 21/08 — Beto Carrero D2 + voo)
- [ ] Mapa interativo
- [ ] Checklist do que levar
- [ ] Orçamento detalhado
- [ ] Contatos úteis
- [ ] FAQ
