#!/usr/bin/env node
// Verificador estático SEM dependências (pedido do usuário, 2026-09-30:
// "siga com tudo o que pode melhorar" — item "sem testes automatizados").
//
// Motivação real: `abrirChatWpp()` (js/whatsapp.js) referenciava `${id}`
// dentro de um template literal, mas a variável se chamava `leadId` —
// um ReferenceError síncrono no meio da função, sem NENHUM erro visível
// pro usuário (o clique "simplesmente não fazia nada"). Um linter de
// verdade (ESLint) pegaria isso na hora — mas `npm install` não funciona
// neste drive (G:\, streaming do Google Drive — mesma limitação já
// documentada no CLAUDE.md pra scraper/), então este script reimplementa
// só a checagem que interessa (`no-undef` dentro de `${...}`), sem
// dependência nenhuma — roda com `node verificar-globais.mjs`, sem
// `npm install` de propósito.
//
// Como funciona (heurística, não um parser de verdade — pode ter falso
// positivo/negativo, é uma rede de segurança, não uma garantia):
// 1. Lê todo js/*.js e extrai toda declaração de função/const/let/var
//    na COLUNA 0 (sem indentação) — são os "globais" que qualquer
//    arquivo pode chamar (os 14 arquivos são <script> clássicos, sem
//    type="module", compartilhando 1 escopo global só).
// 2. Pra cada função de NÍVEL SUPERIOR de cada arquivo, extrai o corpo
//    inteiro (brace-aware, ignora chaves dentro de strings/comentários/
//    template literals) — funções ANINHADAS ficam incluídas no texto do
//    corpo do pai, então uma variável do pai continua "visível" pra
//    checagem de uma função filha (closures).
// 3. Dentro de cada corpo, acha todo `${identificador}` SIMPLES (só
//    identificador puro, sem `.prop`/`()`/`[...]` — esses são mais
//    difíceis de validar e menos prováveis de ser o bug em questão) e
//    confere se o nome está: nos globais do projeto, num builtin comum
//    do navegador/JS, ou declarado em ALGUM LUGAR do próprio corpo
//    (parâmetro da função, const/let/var, parâmetro de arrow function,
//    for/catch) — se não estiver em NENHUM desses, reporta como suspeito.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PASTA_JS = path.resolve(__dirname, "../../js");

const BUILTINS = new Set([
    "window", "document", "console", "alert", "confirm", "prompt", "fetch",
    "localStorage", "sessionStorage", "navigator", "location", "history",
    "setTimeout", "setInterval", "clearTimeout", "clearInterval",
    "Date", "JSON", "Array", "Object", "Math", "Number", "String", "Boolean",
    "RegExp", "Promise", "Map", "Set", "WeakMap", "WeakSet", "Error", "Symbol",
    "URL", "URLSearchParams", "FormData", "Blob", "File", "FileReader",
    "Notification", "MediaRecorder", "crypto", "CSS", "IntersectionObserver",
    "MutationObserver", "requestAnimationFrame", "cancelAnimationFrame",
    "XMLHttpRequest", "WebSocket", "Intl", "self", "globalThis", "event",
    "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI",
    "isNaN", "isFinite", "parseInt", "parseFloat", "structuredClone",
    "TextEncoder", "TextDecoder", "NaN", "Infinity", "undefined", "null",
    "this", "arguments", "true", "false",
    // Bibliotecas CDN (index.html) — nunca declaradas em js/.
    "Papa", "JSZip", "supabase",
]);

function listarArquivosJs() {
    return fs.readdirSync(PASTA_JS).filter((f) => f.endsWith(".js")).sort();
}

// Extrai nomes declarados na COLUNA 0 (globais de verdade neste projeto).
function extrairGlobaisDoProjeto(arquivos) {
    const nomes = new Set();
    for (const arquivo of arquivos) {
        const texto = fs.readFileSync(path.join(PASTA_JS, arquivo), "utf8");
        for (const linha of texto.split("\n")) {
            let m = linha.match(/^(?:async\s+)?function\s+(\w+)\s*\(/);
            if (m) { nomes.add(m[1]); continue; }
            m = linha.match(/^(?:const|let|var)\s+([\w\s,]+?)\s*=/);
            if (m) m[1].split(",").map((s) => s.trim()).filter(Boolean).forEach((n) => nomes.add(n));
        }
    }
    return nomes;
}

// Varre o texto caractere a caractere pra achar, a partir de `inicio`
// (posição de uma `{` de abertura), a posição da `}` que fecha ela —
// via uma PILHA de contextos (não um simples contador+flag), porque 2
// bugs reais foram achados testando este próprio script contra o
// código de verdade:
// 1. `csvEscapeCampo()` (js/app.js) tem `if (/[",\n;]/.test(str))` —
//    sem tratar literal de regex, o `"` DENTRO do regex era
//    interpretado como início de uma STRING nova, desincronizando o
//    parser pro resto do arquivo.
// 2. `abrirChatWpp()` (js/whatsapp.js) tem um template literal com uma
//    interpolação que contém OUTRO template literal completo (`` `${x
//    ? `texto ${y}` : ''}` ``) — um simples toggle "entrei/saí de
//    template" nunca dá conta disso (o backtick de DENTRO fecha o de
//    FORA por engano), quebrando a busca pro resto do arquivo (`fecha
//    === -1`, a função "nunca terminava").
// Detectar regex de verdade exige um tokenizer completo (não dá pra
// saber só pelo caractere se `/` é divisão ou início de regex) — a
// heurística usada aqui (olhar o último caractere "significativo" antes
// do `/`: operador/pontuação/abre-parênteses = quase certamente regex)
// cobre o padrão real deste código (`.test(...)`, `.replace(/…/, …)` etc.).
function acharFechamento(texto, inicio) {
    const pilha = []; // topo = contexto atual: 'BRACE' | 'INTERP' | 'TEMPLATE' | 'STRING1' | 'STRING2' | 'REGEX' | 'REGEX_CLASSE'
    const emModoCodigo = () => pilha.length === 0 || ["BRACE", "INTERP"].includes(pilha[pilha.length - 1]);
    let i = inicio;
    let comentario = null; // 'linha' | 'bloco' | null — ortogonal à pilha
    let ultimoSignificativo = null;
    const PODE_PRECEDER_REGEX = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "+", "-", "~", "^", "%", "<", ">", ";", "{", "}", null]);

    for (; i < texto.length; i++) {
        const c = texto[i];
        const prox = texto[i + 1];

        if (comentario === "linha") { if (c === "\n") comentario = null; continue; }
        if (comentario === "bloco") { if (c === "*" && prox === "/") { comentario = null; i++; } continue; }

        const topo = pilha[pilha.length - 1];
        if (topo === "STRING1") { if (c === "\\") i++; else if (c === "'") pilha.pop(); continue; }
        if (topo === "STRING2") { if (c === "\\") i++; else if (c === '"') pilha.pop(); continue; }
        if (topo === "REGEX") {
            if (c === "\\") { i++; continue; }
            if (c === "[") { pilha.push("REGEX_CLASSE"); continue; }
            if (c === "/") { pilha.pop(); while (/[a-z]/i.test(texto[i + 1] || "")) i++; ultimoSignificativo = "/"; continue; }
            continue;
        }
        if (topo === "REGEX_CLASSE") { if (c === "\\") i++; else if (c === "]") pilha.pop(); continue; }
        if (topo === "TEMPLATE") {
            if (c === "\\") { i++; continue; }
            if (c === "`") { pilha.pop(); continue; }
            if (c === "$" && prox === "{") { pilha.push("INTERP"); i++; continue; }
            continue;
        }

        // emModoCodigo() — pilha vazia (nível da própria função) ou topo
        // BRACE/INTERP: regras normais de JS.
        if (c === "/" && prox === "/") { comentario = "linha"; continue; }
        if (c === "/" && prox === "*") { comentario = "bloco"; continue; }
        if (c === "/" && PODE_PRECEDER_REGEX.has(ultimoSignificativo)) { pilha.push("REGEX"); continue; }
        if (c === "'") { pilha.push("STRING1"); continue; }
        if (c === '"') { pilha.push("STRING2"); continue; }
        if (c === "`") { pilha.push("TEMPLATE"); continue; }
        if (c === "{") { pilha.push("BRACE"); ultimoSignificativo = c; continue; }
        if (c === "}") {
            pilha.pop(); // fecha o BRACE (ou, raro/malformado, um INTERP sem $ visto — defensivo, só remove o topo)
            if (pilha.length === 0) return i; // fechou a chave INICIAL desta função
            ultimoSignificativo = c;
            continue;
        }
        if (!/\s/.test(c)) ultimoSignificativo = c;
    }
    return -1;
}

// Acha funções de NÍVEL SUPERIOR (coluna 0) — `function nome(params) {`
// ou `const nome = (params) => {` / `const nome = function(params) {`.
function extrairFuncoesDeNivelSuperior(texto) {
    const funcoes = [];
    const regexTopo = /^(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*\{|^(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:function\s*\(([^)]*)\)|\(([^)]*)\)\s*=>|(\w+)\s*=>)\s*\{/gm;
    let m;
    while ((m = regexTopo.exec(texto))) {
        const nome = m[1] || m[3];
        const params = m[2] ?? m[4] ?? m[5] ?? m[6] ?? "";
        const abreChave = texto.indexOf("{", m.index);
        if (abreChave === -1) continue;
        const fechaChave = acharFechamento(texto, abreChave);
        if (fechaChave === -1) continue;
        funcoes.push({ nome, params, corpo: texto.slice(abreChave + 1, fechaChave) });
    }
    return funcoes;
}

// Divide `str` no separador `sep`, mas só nos pontos FORA de
// `(...)`/`[...]`/`{...}` — necessário pra declarações com vários
// nomes numa linha só e valor com vírgula dentro (ex: `let a = f(1, 2),
// b = 3;`), onde um split ingênuo por vírgula cortaria no lugar errado.
function splitNivelZero(str, sep) {
    const partes = [];
    let atual = "";
    let profundidade = 0;
    for (const c of str) {
        if ("([{".includes(c)) profundidade++;
        else if (")]}".includes(c)) profundidade--;
        if (c === sep && profundidade === 0) { partes.push(atual); atual = ""; }
        else atual += c;
    }
    partes.push(atual);
    return partes;
}

// Nomes declarados EM QUALQUER LUGAR dentro do corpo de uma função —
// própria (recursão), parâmetros, const/let/var (incluindo aninhados E
// com vários nomes na mesma declaração — `let a = 0, b = 1;`, bug real
// achado testando este script contra o código de verdade: um regex
// não-guloso parava no PRIMEIRO `=`, nunca capturando o 2º/3º nome em
// diante), parâmetros de arrow function (`x =>`/`(x, y) =>`/
// `(x, {a,b}) =>`), for/catch. Deliberadamente permissivo (menos falso
// positivo) — é uma rede de segurança, não um linter de precisão.
function nomesDeclaradosNoCorpo(corpo, nomeProprio, params) {
    const nomes = new Set();
    if (nomeProprio) nomes.add(nomeProprio);
    params.split(",").map((s) => s.trim().split("=")[0].trim()).filter(Boolean).forEach((n) => nomes.add(n.replace(/[{}[\]]/g, "").trim()));

    // const/let/var — captura a declaração INTEIRA até `;` (não só até o
    // 1º `=`), depois separa por vírgula em nível 0 e tira o nome de
    // cada declarator (parte antes do próprio `=`, se tiver).
    const regexDeclaracao = /(?:const|let|var)\s+([^;]+);/g;
    let m;
    while ((m = regexDeclaracao.exec(corpo))) {
        splitNivelZero(m[1], ",").forEach((declarator) => {
            const antesDoIgual = splitNivelZero(declarator, "=")[0];
            // Vírgula entra no strip também — cobre destructuring dentro
            // de 1 só declarator (`const { count, error } = ...`, `const
            // [ano, mes, dia] = ...`): sem isso, sobrava "count," (com a
            // vírgula) em vez de "count", nunca batendo no split por
            // espaço em branco depois (bug real achado testando).
            const limpo = antesDoIgual.replace(/[{}[\],:]/g, " ").trim();
            limpo.split(/\s+/).filter(Boolean).forEach((n) => nomes.add(n));
        });
    }

    const padroesSimples = [
        /\bcatch\s*\(\s*(\w+)\s*\)/g,
        /\bfor\s*\(\s*(?:const|let|var)\s+(\w+)/g,
        // Arrow function com 1 parâmetro sem parênteses: `x => ...`
        /(?:^|[^\w.])(\w+)\s*=>/g,
        // Arrow function/função anônima com parênteses: `(x, y) => ...` / `function(x, y)`
        /\(([^)]*)\)\s*=>/g,
        /function\s*\(([^)]*)\)/g,
    ];
    for (const re of padroesSimples) {
        while ((m = re.exec(corpo))) {
            const bruto = m[1];
            bruto.split(",").forEach((parte) => {
                const limpo = parte.split("=")[0].replace(/[{}[\]:]/g, " ").trim();
                limpo.split(/\s+/).filter(Boolean).forEach((n) => nomes.add(n));
            });
        }
    }
    return nomes;
}

function verificarArquivo(arquivo, globaisDoProjeto) {
    const caminho = path.join(PASTA_JS, arquivo);
    const texto = fs.readFileSync(caminho, "utf8");
    const linhas = texto.split("\n");
    const achados = [];

    for (const fn of extrairFuncoesDeNivelSuperior(texto)) {
        const declarados = nomesDeclaradosNoCorpo(fn.corpo, fn.nome, fn.params);
        const regexInterp = /\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g;
        let m;
        while ((m = regexInterp.exec(fn.corpo))) {
            const nome = m[1];
            if (BUILTINS.has(nome) || globaisDoProjeto.has(nome) || declarados.has(nome)) continue;
            const offsetAbsoluto = texto.indexOf(fn.corpo) + m.index; // aproximado, corpo é único o bastante na prática
            const numeroLinha = texto.slice(0, offsetAbsoluto).split("\n").length;
            achados.push({ funcao: fn.nome || "(anônima)", nome, linha: numeroLinha, trecho: linhas[numeroLinha - 1]?.trim().slice(0, 100) });
        }
    }
    return achados;
}

const arquivos = listarArquivosJs();
const globaisDoProjeto = extrairGlobaisDoProjeto(arquivos);
let totalAchados = 0;

for (const arquivo of arquivos) {
    const achados = verificarArquivo(arquivo, globaisDoProjeto);
    if (achados.length === 0) continue;
    totalAchados += achados.length;
    console.log(`\n${arquivo}:`);
    for (const a of achados) {
        console.log(`  linha ${a.linha}, dentro de ${a.funcao}(): "\${${a.nome}}" não parece declarado em lugar nenhum`);
        console.log(`    ${a.trecho}`);
    }
}

if (totalAchados === 0) {
    console.log(`OK — nenhuma variável suspeita dentro de template literals, em ${arquivos.length} arquivo(s).`);
    process.exit(0);
} else {
    console.log(`\n${totalAchados} suspeita(s) encontrada(s) — revise antes de assumir que é bug de verdade (heurística, não parser).`);
    process.exit(1);
}
