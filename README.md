# BuscaSKU — Localizador Inteligente de Produtos

Aplicação web **Mobile-First** (HTML + CSS + JavaScript puro, sem dependências externas) para localização rápida de **Código / SKU**, visualização de fotos e geração instantânea de **QR Code** em loja.

## Funcionalidades
- **Busca Inteligente & Fuzzy**: pesquisa por múltiplos termos soltos com normalização de acentos e tolerância a erros de digitação.
- **Modo Grade**: agrupa numerações do mesmo modelo/cor em um único card, trocando o SKU e o QR Code ao tocar no tamanho.
- **QR Code Offline (ISO/IEC 18004)**: toque na foto do produto para exibir o QR Code de alto contraste ou baixar a etiqueta em PNG.
- **Filtros Retráteis em Cascata**: Setor, Público (*Feminino, Masculino, Infantil, Unissex*), Categoria, Marca, Tamanho e Cor, com recolhimento automático ao rolar a tela.
- **Fixados de Balcão (`★`) e Últimos Consultados**: salvos localmente no aparelho (`localStorage`).
- **Modo Dark & PWA**: tema escuro sem flash de tela e instalável na tela inicial do celular.
- **Sigilo de Dados**: os `.csv` brutos de inventário ficam protegidos fora do Git (`.gitignore`) e apenas o `catalogo.js` higienizado (sem colunas de estoque/quantidade) é publicado na pasta `dist/`.

---

## Como atualizar a base de produtos (novos CSVs / XLSXs)
1. Coloque os arquivos `.csv` ou `.xlsx` na pasta `planilhas/` (protegida pelo `.gitignore`).
2. Gere o novo catálogo higienizado rodando:
   ```bash
   npm run build
   ```
3. Faça commit e push do `catalogo.js` atualizado para o GitHub — a Vercel publicará automaticamente.

---

## Como subir para o GitHub e publicar na Vercel

### 1. Criar repositório no GitHub e enviar o projeto
Crie um repositório vazio no GitHub (recomendado **Privado**) e rode no terminal desta pasta:

```bash
git add .
git commit -m "feat: versao inicial BuscaSKU mobile-first"
git branch -M main
git remote add origin https://github.com/mathletsgo/stokeimg.git
git push -u origin main
```

### 2. Importar na Vercel
1. Acesse [vercel.com/new](https://vercel.com/new) e importe o repositório recém-criado.
2. A Vercel detectará automaticamente o `vercel.json`:
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
3. Clique em **Deploy**!
