#!/bin/bash
# Script de teste rápido do Copaiba Web

echo "🌿 Testando Copaiba Web Modular"
echo "================================"
echo ""

# Verificar estrutura
echo "📁 Verificando estrutura de arquivos..."
if [ -d "css" ] && [ -d "js" ] && [ -d "js/ui" ]; then
    echo "✅ Diretórios criados"
else
    echo "❌ Faltam diretórios"
    exit 1
fi

# Verificar arquivos
echo ""
echo "📄 Verificando arquivos JavaScript..."
files=(
    "js/config.js"
    "js/utils.js"
    "js/storage.js"
    "js/oto-parser.js"
    "js/encoding.js"
    "js/main.js"
    "js/ui/toast.js"
)

for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file"
    else
        echo "❌ $file (faltando)"
    fi
done

echo ""
echo "📄 Verificando CSS..."
if [ -f "css/styles.css" ]; then
    echo "✅ css/styles.css"
else
    echo "❌ css/styles.css (faltando)"
fi

echo ""
echo "📄 Verificando HTML..."
if [ -f "index.html" ]; then
    echo "✅ index.html"
    lines=$(wc -l < index.html)
    echo "   Linhas: $lines (esperado: ~300)"
else
    echo "❌ index.html (faltando)"
fi

echo ""
echo "📄 Verificando backup..."
if [ -f "indexv4.legado.html" ]; then
    echo "✅ indexv4.legado.html (backup criado)"
else
    echo "❌ indexv4.legado.html (backup não encontrado)"
fi

echo ""
echo "🌐 Servidor HTTP"
echo "================================"
echo "Executando: python3 -m http.server 8081"
echo ""
echo "📱 Acesse no navegador:"
echo "   http://localhost:8081"
echo ""
echo "🧪 Testes a fazer:"
echo "   1. Verificar se a página carrega sem erros"
echo "   2. Abrir DevTools (F12) e verificar console"
echo "   3. Verificar se toast de sucesso aparece"
echo "   4. Testar tema claro/escuro"
echo "   5. Testar botão 'Abrir pasta .wav'"
echo ""

# Iniciar servidor
python3 -m http.server 8081
