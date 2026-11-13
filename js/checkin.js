// Check-in e inscrição pelo próprio celular (13/11/2026). Página: checkin.html#<código>[&inscrever] (QR codes no
// local do evento). Só funciona no dia/horário do evento (o servidor confere).
// - Já inscrito: celular + primeiro nome da mesma inscrição -> presença no Ulisses.
// - Não inscrito: nome, celular e e-mail -> inscrição + presença (sem e-mail, vaga reservada no CRM).
// Nos dois casos sai um passe com QR code assinado (nome, telefone, horário) para a segurança conferir
// (validar.html). O passe fica guardado no celular e abre de novo sem internet.
(function () {
  'use strict';
  var FUNCAO = 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/recepcao-evento';
  var partes = (location.hash || '').replace(/^#/, '').split('&');
  var codigo = partes[0];
  var $ = function (id) { return document.getElementById(id); };
  var CHAVE_PASSES = 'ck_passes_' + codigo.slice(0, 10);
  var paraInscrever = /\/inscrever/.test(location.pathname) || partes.indexOf('inscrever') > 0;

  function chamar(corpo) {
    corpo.publico = codigo;
    return fetch(FUNCAO, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) })
      .then(function (r) { return r.json().catch(function () { return {}; }); });
  }
  function nomeEvento(n) {
    var minusc = { da: 1, de: 1, 'do': 1, das: 1, dos: 1, e: 1 };
    return String(n || '').split(' - ')[0].toLowerCase().split(' ').map(function (p, i) { return i && minusc[p] ? p : p.charAt(0).toUpperCase() + p.slice(1); }).join(' ');
  }
  function lerPasses() { try { return JSON.parse(localStorage.getItem(CHAVE_PASSES) || '[]'); } catch (e) { return []; } }
  function guardarPasse(p) {
    var lista = lerPasses().filter(function (x) { return x.token !== p.token; }); lista.unshift(p);
    try { localStorage.setItem('meu_passe', p.token); } catch (e) { /* ok */ }
    try { localStorage.setItem(CHAVE_PASSES, JSON.stringify(lista.slice(0, 6))); } catch (e) { /* ok */ }
  }

  function modo(m) {
    document.querySelectorAll('[data-modo]').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-modo') === m)); });
    $('formCheckin').hidden = m !== 'checkin'; $('formInscrever').hidden = m !== 'inscrever';
  }
  document.querySelectorAll('[data-modo]').forEach(function (b) { b.addEventListener('click', function () { modo(b.getAttribute('data-modo')); }); });

  function mostrarPasse(p, texto) {
    $('passoForm').hidden = true; $('passoPasse').hidden = false;
    $('psBoasVindas').textContent = 'Boas-vindas, ' + String(p.nome || '').split(' ')[0] + '!';
    $('psTexto').textContent = texto || 'Check-in feito. Bom evento!';
    var area = $('psQr'); area.textContent = '';
    if (p.svg) {
      var svg = new DOMParser().parseFromString(p.svg, 'image/svg+xml').documentElement;
      if (svg && svg.nodeName.toLowerCase() === 'svg') area.appendChild(document.importNode(svg, true));
    }
    $('psNome').textContent = p.nome || '';
    var h = new Date(p.em); $('psInfo').textContent = (p.telefone || '') + (isNaN(h) ? '' : ' · check-in às ' + h.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    window.scrollTo(0, 0);
  }
  function sucesso(j, texto) {
    if (j.passe) { guardarPasse(j.passe); mostrarPasse(j.passe, texto); return; }
    // Sem passe (falha ao gerar): o check-in vale do mesmo jeito.
    mostrarPasse({ nome: j.nome || '' }, texto);
  }
  $('psOutro').addEventListener('click', function () {
    $('passoPasse').hidden = true; $('passoForm').hidden = false;
    ['ckCelular', 'ckNome', 'inNome', 'inCelular', 'inEmail'].forEach(function (id) { $(id).value = ''; });
    modo('checkin');
  });

  // Celular em formato (62) 99999-9999 enquanto digita.
  document.querySelectorAll('input.cel').forEach(function (c) {
    c.addEventListener('input', function () {
      var d = c.value.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '').slice(0, 11);
      c.value = d.length > 6 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, d.length - 4) + '-' + d.slice(-4) : d.length > 2 ? '(' + d.slice(0, 2) + ') ' + d.slice(2) : d;
    });
  });

  function ocupado(botao, sim, texto) { botao.disabled = sim; botao.textContent = sim ? 'Confirmando…' : texto; }
  var semConexao = 'Sem conexão. Verifique a internet e tente de novo, ou fale com a recepção.';

  $('formCheckin').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var cel = $('ckCelular').value.replace(/\D/g, ''), nome = $('ckNome').value.trim();
    if (cel.length < 10) { $('ckMsg').textContent = 'Informe o celular com DDD.'; return; }
    if (!nome) { $('ckMsg').textContent = 'Informe seu primeiro nome.'; return; }
    ocupado($('ckBotao'), true); $('ckMsg').textContent = '';
    chamar({ acao: 'auto_checkin', celular: cel, nome: nome }).then(function (j) {
      ocupado($('ckBotao'), false, 'Fazer check-in');
      if (j.ok) return sucesso(j, j.ja_feito ? 'Seu check-in já estava feito. Bom evento!' : null);
      $('ckMsg').textContent = j.erro || 'Não foi possível fazer o check-in. Fale com a recepção.';
      if (j.nao_encontrado) $('ckMsg').textContent += ' Ainda não se inscreveu? Toque em "Ainda não me inscrevi".';
    }, function () { ocupado($('ckBotao'), false, 'Fazer check-in'); $('ckMsg').textContent = semConexao; });
  });

  $('formInscrever').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var nome = $('inNome').value.trim(), cel = $('inCelular').value.replace(/\D/g, ''), email = $('inEmail').value.trim();
    if (nome.split(/\s+/).length < 2) { $('inMsg').textContent = 'Escreva seu nome e sobrenome.'; return; }
    if (cel.length < 10) { $('inMsg').textContent = 'Escreva seu celular com DDD.'; return; }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('inMsg').textContent = 'Confira o e-mail.'; return; }
    ocupado($('inBotao'), true); $('inMsg').textContent = '';
    chamar({ acao: 'auto_inscrever', nome: nome, celular: cel, email: email, interesse_curso: $('inInteresse').checked || null }).then(function (j) {
      ocupado($('inBotao'), false, 'Inscrever e fazer check-in');
      if (j.ok) return sucesso(j, j.ja_feito ? 'Você já estava inscrito(a) e com check-in feito. Bom evento!' : 'Inscrição e check-in feitos. Bom evento!');
      $('inMsg').textContent = j.erro || 'Não foi possível fazer a inscrição. Fale com a recepção.';
    }, function () { ocupado($('inBotao'), false, 'Inscrever e fazer check-in'); $('inMsg').textContent = semConexao; });
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw-passe.js', { scope: paraInscrever ? './inscrever' : './checkin' }).catch(function () { /* ok */ });

  if (!/^[A-Za-z0-9_-]{10,}$/.test(codigo)) { $('ckMsg').textContent = 'Link incompleto. Aponte a câmera para o QR Code de novo.'; $('ckBotao').disabled = true; $('inBotao').disabled = true; return; }
  // /inscrever#<código> (cartaz "Ainda não está inscrito?") abre direto na inscrição; #<código>&inscrever também vale.
  modo(paraInscrever ? 'inscrever' : 'checkin');

  // Passe já guardado neste celular: abre direto (funciona sem internet).
  var guardados = lerPasses();
  if (guardados.length && !paraInscrever) mostrarPasse(guardados[0], 'Seu passe do evento.');

  chamar({ acao: 'auto_info' }).then(function (j) {
    if (!j.ok) { $('ckMsg').textContent = j.erro || 'Link inválido.'; return; }
    if (j.evento && j.evento.nome) $('titulo').textContent = nomeEvento(j.evento.nome);
    if (!j.aberto) { $('ckMsg').textContent = 'O check-in pelo celular abre no dia e no horário do evento.'; $('inMsg').textContent = $('ckMsg').textContent; }
  }, function () { /* sem internet: segue com o que tem */ });
})();
