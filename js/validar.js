// Validador de passe da segurança (13/11/2026). Página: validar.html (ou /validar), também aberta direto pelo QR
// do passe (validar#<token>). Confere a assinatura ECDSA P-256 com a chave pública abaixo, sem internet.
// Guarda no aparelho os passes já conferidos para avisar quando o mesmo passe aparece de novo.
(function () {
  'use strict';
  var CHAVE_PUBLICA = { kty: 'EC', crv: 'P-256', x: 'BlezU8ZJxJpCGiCCX3cX9lGryinRFsjeh1-YCmL69iU', y: '4Hkcte3GeTjuCTsnT80Xsr3uYUNmV313NaRUZzIwES0' };
  var $ = function (id) { return document.getElementById(id); };
  var chave = null;

  function lerVistos() { try { return JSON.parse(localStorage.getItem('vl_vistos') || '{}'); } catch (e) { return {}; } }
  function gravarVistos(v) { try { localStorage.setItem('vl_vistos', JSON.stringify(v)); } catch (e) { /* ok */ } }
  function contar() { $('vlContagem').textContent = Object.keys(lerVistos()).length + ' conferidos'; }
  function b64u(t) {
    t = t.replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '=';
    var s = atob(t), b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b;
  }
  function hora(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  function el(tag, classe, texto) { var n = document.createElement(tag); if (classe) n.className = classe; if (texto != null) n.textContent = texto; return n; }

  // Cada leitura vai para o servidor (mede a jornada até a entrada). Sem internet fica guardada e sobe depois.
  var FUNCAO = 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/recepcao-evento';
  function lerPendentes() { try { return JSON.parse(localStorage.getItem('vl_pendentes') || '[]'); } catch (e) { return []; } }
  function gravarPendentes(p) { try { localStorage.setItem('vl_pendentes', JSON.stringify(p.slice(-500))); } catch (e) { /* ok */ } }
  var enviandoLeituras = false;
  function enviarLeituras() {
    var p = lerPendentes();
    if (enviandoLeituras || !p.length || navigator.onLine === false) return;
    enviandoLeituras = true;
    var item = p[0];
    fetch(FUNCAO, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(item) })
      .then(function (r) { return r.status; })
      .then(function (st) {
        enviandoLeituras = false;
        if (st < 500) { var q = lerPendentes(); q.shift(); gravarPendentes(q); setTimeout(enviarLeituras, 200); }
      }, function () { enviandoLeituras = false; });
  }
  function registrarLeitura(acao, token) { var p = lerPendentes(); p.push({ acao: acao, token: token, lido_em: new Date().toISOString() }); gravarPendentes(p); enviarLeituras(); }
  window.addEventListener('online', enviarLeituras);
  setInterval(enviarLeituras, 30000);

  function mostrar(tipo, titulo, linhas) {
    var r = $('vlResultado'); r.className = 'vl-resultado vl-' + tipo; r.textContent = '';
    r.appendChild(el('p', 'vl-status', titulo));
    (linhas || []).forEach(function (l) { if (l) r.appendChild(el('p', l[0], l[1])); });
    if (navigator.vibrate) navigator.vibrate(tipo === 'ok' ? 80 : [200, 80, 200]);
  }

  function validar(texto) {
    var token = String(texto || '').trim();
    var i = token.indexOf('#'); if (i >= 0) token = token.slice(i + 1);
    var partes = token.split('.');
    if (partes.length !== 2) { mostrar('erro', '✗ QR code não reconhecido', [['vl-dica', 'Este QR code não é de entrada deste evento.']]); return; }
    var dados, bytes;
    try { bytes = b64u(partes[0]); dados = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { mostrar('erro', '✗ QR code ilegível', []); return; }
    (chave ? Promise.resolve(chave) : crypto.subtle.importKey('jwk', CHAVE_PUBLICA, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']).then(function (k) { chave = k; return k; }))
      .then(function (k) { return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, b64u(partes[1]), bytes); })
      .then(function (ok) {
        if (!ok) { mostrar('erro', '✗ QR CODE FALSO', [['vl-dica', 'A assinatura não confere. Encaminhe para a recepção.']]); return; }
        // Cartão de entrada (poucos, reutilizáveis): a recepção vincula o número a uma pessoa; a segurança lê,
        // recolhe e devolve à recepção. A leitura libera o cartão. Com internet, mostra com quem ele está.
        if (dados.c) { lerCartao(dados, token); contar(); return; }
        var vistos = lerVistos(), id = partes[1].slice(0, 24), antes = vistos[id];
        var linhas = [['vl-info', dados.en || ''], ['vl-nome', dados.n || ''], ['vl-info', dados.t || ''], ['vl-info', 'Check-in: ' + hora(dados.d)]];
        // Lido de novo em menos de 1 minuto: é a mesma pessoa na frente da segurança (leitura repetida sem querer).
        if (antes && Date.now() - new Date(antes).getTime() < 60000) { mostrar('ok', '✓ QR CODE VÁLIDO', linhas); contar(); return; }
        if (antes) {
          mostrar('repetido', '✓ Válido · já conferido', linhas.concat([['vl-dica', 'Este QR code já entrou às ' + hora(antes) + ' (lido neste celular). Confira se é a mesma pessoa voltando.']]));
          contar(); return;
        }
        var agoraLido = new Date().toISOString();
        vistos[id] = agoraLido; gravarVistos(vistos);
        mostrar('ok', '✓ QR CODE VÁLIDO', linhas);
        contar();
        // Avisa o servidor. Com internet, ele diz se o mesmo QR code já entrou por outro celular da segurança
        // (print repassado). Sem internet, a leitura fica guardada e sobe depois.
        var ctl = window.AbortController ? new AbortController() : null;
        var tempo = setTimeout(function () { if (ctl) ctl.abort(); }, 5000);
        fetch(FUNCAO, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl ? ctl.signal : undefined,
          body: JSON.stringify({ acao: 'passe_validado', token: token, lido_em: agoraLido }) })
          .then(function (r) { if (r.status >= 500) throw new Error(); return r.json(); })
          .then(function (j) {
            clearTimeout(tempo);
            var primeira = j && j.repetido && j.primeira_em ? new Date(j.primeira_em).getTime() : 0;
            if (primeira && Math.abs(primeira - new Date(agoraLido).getTime()) > 60000 && vistos[id] === agoraLido && $('vlResultado').textContent.indexOf(dados.n || '\u0000') >= 0) {
              mostrar('repetido', '✓ Válido · já conferido', linhas.concat([['vl-dica', 'Este QR code já entrou às ' + hora(j.primeira_em) + ' por outro celular da segurança. Confira se é a mesma pessoa voltando.']]));
            }
          }, function () { clearTimeout(tempo); var q = lerPendentes(); q.push({ acao: 'passe_validado', token: token, lido_em: agoraLido }); gravarPendentes(q); });
      }, function () { mostrar('erro', '✗ Não foi possível conferir', [['vl-dica', 'Atualize o navegador ou use outro celular.']]); });
  }

  function lerCartao(dados, token) {
    var base = [['vl-info', dados.en || ''], ['vl-nome', 'Cartão de entrada nº ' + dados.c]];
    var fim = ['vl-dica', 'Recolha o cartão e devolva à recepção.'];
    mostrar('ok', '✓ CARTÃO VÁLIDO', base.concat([['vl-info', 'Conferindo com quem está…'], fim]));
    var ctl = window.AbortController ? new AbortController() : null;
    var tempo = setTimeout(function () { if (ctl) ctl.abort(); }, 6000);
    fetch('https://eovgljcowblwoxmobeno.supabase.co/functions/v1/recepcao-evento', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ acao: 'cartao_lido', token: token, lido_em: new Date().toISOString() }), signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        clearTimeout(tempo);
        if (j.ok && j.vinculado) mostrar('ok', '✓ CARTÃO VÁLIDO', base.concat([['vl-nome', j.nome], ['vl-info', 'Entregue pela recepção às ' + hora(j.vinculado_em)], fim]));
        else if (j.ok && j.ja_lido_em && Date.now() - new Date(j.ja_lido_em).getTime() < 90000) {
          // Lido duas vezes seguidas sem querer: é a mesma entrada.
          mostrar('ok', '✓ CARTÃO VÁLIDO', base.concat([j.nome_anterior ? ['vl-nome', j.nome_anterior] : null, fim]));
        }
        else if (j.ok) mostrar('repetido', '✓ Cartão válido · sem nome', base.concat([
          ['vl-info', 'Pode liberar a entrada.'],
          ['vl-dica', j.ja_lido_em ? 'A recepção entregou este cartão de novo sem digitar o número (última entrada às ' + hora(j.ja_lido_em) + ').' : 'A recepção ainda não digitou o número deste cartão.'],
          fim]));
        else throw new Error();
      })
      .catch(function () {
        clearTimeout(tempo); mostrar('ok', '✓ CARTÃO VÁLIDO', base.concat([['vl-info', 'Sem internet: não foi possível ver o nome.'], fim]));
        registrarLeitura('cartao_lido', token); // libera o cartão quando a internet voltar
      });
  }

  // ---------- Página do passe (passe.html / /passe#<token>) ----------
  // O participante abre o próprio passe (lendo o QR na tela da recepção, ou vindo do check-in pelo celular).
  // Mostra nome, telefone, horário, o selo de válido (assinatura conferida aqui mesmo) e o QR para a segurança.
  // O desenho do QR vem do servidor uma vez e fica guardado no celular; depois abre sem internet.
  function iniciarPasse() {
    var FUNCAO = 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/recepcao-evento';
    var guardar = function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ok */ } };
    var ler = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
    var token = (location.hash || '').replace(/^#/, '');
    // Celular da segurança (já abriu o validador): QR code lido pela câmera vai direto para o validador.
    if (token.length >= 20 && ler('vl_modo') === '1') { location.replace('validar#' + token); return; }
    if (token.length < 20) token = ler('meu_passe') || '';
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw-passe.js', { scope: './passe' }).catch(function () { /* ok */ });
    var st = $('psStatus');
    function status(classe, texto) { st.className = 'vl-resultado ' + classe; st.textContent = ''; st.appendChild(el('p', 'vl-status', texto)); }
    var partes = token.split('.');
    if (partes.length !== 2) { status('vl-espera', 'Nenhum QR code de entrada neste celular'); $('psDica').textContent = 'Faça o check-in pelo QR code do cartaz ou na recepção.'; return; }
    var dados, bytes;
    try { bytes = b64u(partes[0]); dados = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { status('vl-erro', '✗ QR code ilegível'); return; }
    // Cartão de entrada impresso: quem lê é a segurança (câmera do celular). Vai direto para o validador.
    if (dados.c) { location.replace('validar#' + token); return; }
    crypto.subtle.importKey('jwk', CHAVE_PUBLICA, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
      .then(function (k) { return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, b64u(partes[1]), bytes); })
      .then(function (ok) {
        if (!ok) { status('vl-erro', '✗ QR code inválido'); $('psDica').textContent = 'Procure a recepção.'; return; }
        status('vl-ok', '✓ QR code válido');
        guardar('meu_passe', token);
        $('psEvento').textContent = dados.en || 'Dia Mundial da Filosofia 2026';
        $('psNome').textContent = dados.c ? 'Cartão de entrada nº ' + dados.c : (dados.n || '');
        $('psInfo').textContent = dados.c ? 'Entregue este cartão à segurança.' : (dados.t || '') + ' · check-in ' + hora(dados.d);
        var svgGuardado = ler('meu_passe_svg_' + partes[1].slice(0, 16));
        if (svgGuardado) return desenhar(svgGuardado);
        fetch(FUNCAO, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ acao: 'passe_qr', token: token }) })
          .then(function (r) { return r.json(); })
          .then(function (j) { if (j.ok && j.svg) { guardar('meu_passe_svg_' + partes[1].slice(0, 16), j.svg); desenhar(j.svg); } else semQr(); }, semQr);
      }, function () { status('vl-erro', 'Não foi possível conferir'); });
    function desenhar(svgTexto) {
      var svg = new DOMParser().parseFromString(svgTexto, 'image/svg+xml').documentElement;
      if (svg && svg.nodeName.toLowerCase() === 'svg') { $('psQr').textContent = ''; $('psQr').appendChild(document.importNode(svg, true)); }
    }
    function semQr() { $('psDica').textContent = 'Sem internet para desenhar o QR code agora. Mostre esta tela com o selo verde à segurança.'; }
  }

  // Leitura com a câmera dentro da página (Chrome/Android). No iPhone, a câmera do sistema abre esta página.
  var leitor = null, stream = null, lendo = false;
  function pararCamera() {
    lendo = false; $('vlCamera').hidden = true; $('vlLer').textContent = 'Ler QR code';
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null;
  }
  function lerQuadro() {
    if (!lendo) return;
    leitor.detect($('vlVideo')).then(function (r) {
      if (r && r.length) { var v = r[0].rawValue; pararCamera(); validar(v); return; }
      requestAnimationFrame(lerQuadro);
    }, function () { requestAnimationFrame(lerQuadro); });
  }
  if ($('vlLer')) $('vlLer').addEventListener('click', function () {
    if (lendo) { pararCamera(); return; }
    if (!('BarcodeDetector' in window)) { $('vlAviso').textContent = 'Neste celular, use o app da câmera para ler o QR code do passe: ele abre esta página com o resultado.'; return; }
    leitor = leitor || new window.BarcodeDetector({ formats: ['qr_code'] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (s) {
      stream = s; $('vlVideo').srcObject = s; $('vlVideo').play(); $('vlCamera').hidden = false; lendo = true;
      $('vlLer').textContent = 'Parar'; $('vlAviso').textContent = ''; requestAnimationFrame(lerQuadro);
    }, function () { $('vlAviso').textContent = 'Permita o uso da câmera nas configurações do navegador.'; });
  });

  if (document.body.classList.contains('modo-passe')) { iniciarPasse(); return; }
  try { localStorage.setItem('vl_modo', '1'); } catch (e) { /* ok */ }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw-passe.js', { scope: './validar' }).catch(function () { /* ok */ });
  contar();
  if (location.hash.length > 10) validar(location.hash);
  window.addEventListener('hashchange', function () { validar(location.hash); });
})();
