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
    if (navigator.vibrate && tipo !== 'espera') navigator.vibrate(tipo === 'ok' ? 80 : [200, 80, 200]);
  }

  function validar(texto) {
    var token = String(texto || '').trim();
    var i = token.indexOf('#'); if (i >= 0) token = token.slice(i + 1);
    var partes = token.split('.');
    if (partes.length !== 2) { mostrar('erro', '✗ QR code não reconhecido', [['vl-dica', 'Este não é um QR code de entrada. Peça o QR code que aparece depois do check-in, ou o cartão de entrada. Sem nenhum dos dois: recepção.']]); return; }
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
        var linhas = [['vl-info', dados.en || ''], ['vl-nome', dados.n || ''], ['vl-info', dados.t || ''], ['vl-info', 'Check-in: ' + hora(dados.d)], ['vl-dica', 'Pergunte o nome e confira com a tela. Na dúvida, peça documento.']];
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

  // Situação dos cartões baixada do servidor a cada minuto (com o PIN da equipe). Sem internet, o validador ainda sabe
  // com quem estava cada cartão até a última atualização.
  function lerCacheCartoes() { try { return JSON.parse(localStorage.getItem('vl_cartoes') || 'null'); } catch (e) { return null; } }
  function marcarCartaoLidoNoCache(num) {
    var c = lerCacheCartoes(); if (!c || !c.cartoes) return;
    var a = c.cartoes[num]; c.cartoes[num] = { tipo: 'cartao_lido', nome: a ? a.nome : null, em: new Date().toISOString() };
    try { localStorage.setItem('vl_cartoes', JSON.stringify(c)); } catch (e) { /* ok */ }
  }
  function sincronizarCartoes() {
    if (!buscaSessao() || navigator.onLine === false) return;
    chamarBusca({ acao: 'validador_cartoes' }).then(function (j) {
      if (j.ok) { try { localStorage.setItem('vl_cartoes', JSON.stringify({ cartoes: j.cartoes || {}, em: j.agora })); } catch (e) { /* ok */ } }
      if (j.precisa_pin) { try { localStorage.removeItem('vl_sessao'); } catch (e) { /* ok */ } atualizarBotaoPin(); }
    }, function () { /* sem internet: fica com a última lista */ });
  }

  function lerCartao(dados, token) {
    var num = String(parseInt(dados.c, 10) || dados.c); // o cartão traz "005"; a lista do servidor usa 5
    var base = [['vl-info', dados.en || ''], ['vl-nome', 'Cartão de entrada nº ' + num]];
    var fim = ['vl-dica', 'Recolha o cartão e devolva à recepção.'];
    var pergunte = function (nome) { return ['vl-info', 'Pergunte o nome: deve ser ' + nome + '. Se não bater, não libere e chame a recepção.']; };
    mostrar('espera', 'Conferindo o cartão…', base);
    var ctl = window.AbortController ? new AbortController() : null;
    var tempo = setTimeout(function () { if (ctl) ctl.abort(); }, 6000);
    fetch(FUNCAO, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ acao: 'cartao_lido', token: token, lido_em: new Date().toISOString() }), signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        clearTimeout(tempo);
        if (j.ok && j.vinculado) {
          marcarCartaoLidoNoCache(num);
          mostrar('ok', '✓ CARTÃO VÁLIDO', base.concat([['vl-nome', j.nome], pergunte(j.nome), ['vl-dica', 'Entregue pela recepção às ' + hora(j.vinculado_em)], fim]));
        } else if (j.ok && j.ja_lido_em && Date.now() - new Date(j.ja_lido_em).getTime() < 90000) {
          // Lido duas vezes seguidas sem querer: é a mesma entrada.
          mostrar('ok', '✓ CARTÃO VÁLIDO', base.concat([j.nome_anterior ? ['vl-nome', j.nome_anterior] : null, j.nome_anterior ? pergunte(j.nome_anterior) : null, fim]));
        } else if (j.ok) {
          // Cartão sem pessoa vinculada (não foi entregue pela mesa, ou já entrou e voltou sem nova entrega): não libera.
          mostrar('erro', '✗ NÃO LIBERE AINDA', base.concat([
            ['vl-info', 'Este cartão não está vinculado a ninguém' + (j.ja_lido_em ? ' (já foi usado às ' + hora(j.ja_lido_em) + (j.nome_anterior ? ' por ' + j.nome_anterior : '') + ')' : '') + '.'],
            ['vl-dica', 'Pergunte o nome e confirme com a recepção (ela pode estar sem internet e ainda não ter enviado a entrega). Sem confirmação: peça documento e anote nome e nº do cartão.']]));
        } else throw new Error();
      })
      .catch(function () {
        clearTimeout(tempo);
        registrarLeitura('cartao_lido', token); // registra quando a internet voltar
        var cache = lerCacheCartoes(), info = cache && cache.cartoes ? cache.cartoes[num] : null, ate = cache ? hora(cache.em) : '';
        if (info && info.tipo === 'cartao') {
          marcarCartaoLidoNoCache(num);
          mostrar('repetido', '✓ Cartão válido · sem internet', base.concat([['vl-nome', info.nome], pergunte(info.nome),
            ['vl-dica', 'Entregue às ' + hora(info.em) + ' (lista atualizada às ' + ate + ').'], fim]));
        } else if (info && info.tipo === 'cartao_lido') {
          mostrar('erro', '✗ CONFIRME ANTES DE LIBERAR', base.concat([
            ['vl-info', 'Este cartão já entrou às ' + hora(info.em) + (info.nome ? ' (' + info.nome + ')' : '') + ' e não tinha nova entrega até ' + ate + '.'],
            ['vl-dica', 'Sem internet. Pode ter sido entregue depois disso: confirme com a recepção, ou peça documento e anote nome e nº do cartão.']]));
        } else {
          mostrar('erro', '✗ CONFIRME ANTES DE LIBERAR', base.concat([
            ['vl-info', cache ? 'Este cartão não tinha sido entregue até ' + ate + '.' : 'Sem internet e sem a lista de cartões neste celular.'],
            ['vl-dica', 'Pergunte o nome, peça documento e anote nome e nº do cartão, ou confirme com a recepção.']]));
        }
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
      window.__qrAberto = true; manterTelaAcesa();
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

  // ---------- Busca pelo nome (sem QR code nem cartão) ----------
  // Pede o PIN da equipe uma vez; precisa de internet. Só libera quem já fez o check-in.
  function buscaSessao() { try { var v = JSON.parse(localStorage.getItem('vl_sessao') || 'null'); return v && new Date(v.expira) > new Date() ? v.token : null; } catch (e) { return null; } }
  function chamarBusca(corpo) {
    corpo.sessao = buscaSessao();
    return fetch(FUNCAO, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) })
      .then(function (r) { return r.json().catch(function () { return {}; }); });
  }
  function pedirPinBusca() {
    var pin = (prompt('PIN da equipe (só na primeira vez):') || '').replace(/\D/g, '');
    if (!pin) return Promise.resolve(false);
    return fetch(FUNCAO, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ acao: 'validador_pin', pin: pin }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { $('vlAviso').textContent = j.erro || 'PIN incorreto.'; return false; }
        try { localStorage.setItem('vl_sessao', JSON.stringify({ token: j.sessao, expira: j.expira_em })); } catch (e) { /* ok */ }
        return true;
      }, function () { $('vlAviso').textContent = 'Sem internet: a busca pelo nome precisa de conexão.'; return false; });
  }
  var buscaTimer = null;
  function buscarNome() {
    var q = $('vlBuscaNome').value.trim(), res = $('vlBuscaRes');
    if (q.length < 3) { res.textContent = ''; return; }
    chamarBusca({ acao: 'validador_buscar', q: q }).then(function (j) {
      if (j.precisa_pin) { pedirPinBusca().then(function (ok) { if (ok) buscarNome(); }); return; }
      res.textContent = '';
      if (!j.ok) { res.appendChild(el('p', 'dica', j.erro || 'Não foi possível buscar.')); return; }
      if (!j.achados.length) { res.appendChild(el('p', 'dica', 'Ninguém com esse nome na lista. Encaminhe para a recepção.')); return; }
      j.achados.forEach(function (p) {
        var item = el('div', 'vl-busca-item'), info = el('div');
        info.appendChild(el('strong', null, p.nome));
        info.appendChild(el('small', null, p.final_tel ? 'Celular final ' + p.final_tel : 'Inscrito na porta'));
        info.appendChild(el('div', p.presente ? 'ok' : 'nao', p.presente ? '✓ Check-in feito' : '✗ Sem check-in: encaminhe à recepção'));
        item.appendChild(info);
        if (p.presente) {
          var b = el('button', 'btn principal', 'Liberar');
          b.type = 'button';
          b.addEventListener('click', function () {
            mostrar('ok', '✓ ENTRADA LIBERADA', [['vl-nome', p.nome], ['vl-info', 'Encontrado pelo nome'], ['vl-dica', 'Confira um documento se tiver dúvida.']]);
            res.textContent = ''; $('vlBuscaNome').value = ''; $('vlBusca').hidden = true; window.scrollTo(0, 0);
            chamarBusca({ acao: 'validador_liberar', nome: p.nome, email_evento_id: p.email_evento_id, lido_em: new Date().toISOString() }).catch(function () { /* ok */ });
          });
          item.appendChild(b);
        }
        res.appendChild(item);
      });
    }, function () { res.textContent = ''; res.appendChild(el('p', 'dica', 'Sem internet: a busca pelo nome precisa de conexão. Encaminhe para a recepção.')); });
  }
  function atualizarBotaoPin() { if ($('vlPinEquipe')) $('vlPinEquipe').hidden = !!buscaSessao(); }
  if ($('vlPinEquipe')) {
    $('vlPinEquipe').addEventListener('click', function () { pedirPinBusca().then(function (ok) { atualizarBotaoPin(); if (ok) sincronizarCartoes(); }); });
  }
  if ($('vlBuscarAbrir')) {
    $('vlBuscarAbrir').addEventListener('click', function () {
      var abrir = $('vlBusca').hidden;
      $('vlBusca').hidden = !abrir;
      if (!abrir) return;
      var seguir = function () { $('vlBuscaNome').focus(); };
      if (buscaSessao()) seguir(); else pedirPinBusca().then(function (ok) { atualizarBotaoPin(); if (ok) { sincronizarCartoes(); seguir(); } else $('vlBusca').hidden = true; });
    });
    $('vlBuscaNome').addEventListener('input', function () { clearTimeout(buscaTimer); buscaTimer = setTimeout(buscarNome, 400); });
  }

  if (document.body.classList.contains('modo-passe')) { iniciarPasse(); return; }
  try { localStorage.setItem('vl_modo', '1'); } catch (e) { /* ok */ }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw-passe.js', { scope: './validar' }).catch(function () { /* ok */ });
  contar();
  atualizarBotaoPin(); sincronizarCartoes(); setInterval(sincronizarCartoes, 60000); window.addEventListener('online', sincronizarCartoes);
  if (location.hash.length > 10) validar(location.hash);
  window.addEventListener('hashchange', function () { validar(location.hash); });
})();
