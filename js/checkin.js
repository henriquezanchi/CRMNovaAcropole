// Check-in pelo próprio celular (13/11/2026). Página: checkin.html#<código público> (QR code no local do evento).
// A pessoa informa celular + primeiro nome; o servidor só marca a presença no Ulisses se os dois baterem com a
// mesma inscrição e só funciona no dia/horário do evento.
(function () {
  'use strict';
  var FUNCAO = 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/recepcao-evento';
  var codigo = (location.hash || '').replace(/^#/, '');
  var $ = function (id) { return document.getElementById(id); };

  function chamar(corpo) {
    corpo.publico = codigo;
    return fetch(FUNCAO, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) })
      .then(function (r) { return r.json().catch(function () { return {}; }); });
  }
  function nomeEvento(n) {
    var minusc = { da: 1, de: 1, 'do': 1, das: 1, dos: 1, e: 1 };
    return String(n || '').split(' - ')[0].toLowerCase().split(' ').map(function (p, i) { return i && minusc[p] ? p : p.charAt(0).toUpperCase() + p.slice(1); }).join(' ');
  }

  if (!/^[A-Za-z0-9_-]{10,}$/.test(codigo)) { $('ckMsg').textContent = 'Link incompleto. Aponte a câmera para o QR Code de novo.'; $('ckBotao').disabled = true; return; }

  chamar({ acao: 'auto_info' }).then(function (j) {
    if (!j.ok) { $('ckMsg').textContent = j.erro || 'Link inválido.'; $('ckBotao').disabled = true; return; }
    if (j.evento && j.evento.nome) $('titulo').textContent = nomeEvento(j.evento.nome);
    if (j.inscricao) $('ckLinkInscricao').href = j.inscricao;
    if (!j.aberto) $('ckMsg').textContent = 'O check-in pelo celular abre no dia e no horário do evento.';
  }, function () { $('ckMsg').textContent = 'Sem conexão. Verifique a internet e tente de novo.'; });

  // Celular em formato (62) 99999-9999 enquanto digita.
  $('ckCelular').addEventListener('input', function () {
    var d = this.value.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '').slice(0, 11);
    this.value = d.length > 6 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, d.length - 4) + '-' + d.slice(-4) : d.length > 2 ? '(' + d.slice(0, 2) + ') ' + d.slice(2) : d;
  });

  $('formCheckin').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var cel = $('ckCelular').value.replace(/\D/g, ''), nome = $('ckNome').value.trim();
    if (cel.length < 10) { $('ckMsg').textContent = 'Informe o celular com DDD.'; return; }
    if (!nome) { $('ckMsg').textContent = 'Informe seu primeiro nome.'; return; }
    $('ckBotao').disabled = true; $('ckBotao').textContent = 'Confirmando…'; $('ckMsg').textContent = ''; $('ckInscrever').hidden = true;
    chamar({ acao: 'auto_checkin', celular: cel, nome: nome }).then(function (j) {
      $('ckBotao').disabled = false; $('ckBotao').textContent = 'Fazer check-in';
      if (j.ok) {
        $('passoForm').hidden = true; $('passoOk').hidden = false;
        $('ckBoasVindas').textContent = 'Boas-vindas, ' + (j.nome || '') + '!';
        $('ckOkTexto').textContent = j.ja_feito ? 'Seu check-in já estava feito. Bom evento!' : 'Check-in feito. Bom evento!';
        return;
      }
      $('ckMsg').textContent = j.erro || 'Não foi possível fazer o check-in. Fale com a recepção.';
      if (j.nao_encontrado) { if (j.inscricao) $('ckLinkInscricao').href = j.inscricao; $('ckInscrever').hidden = false; }
    }, function () {
      $('ckBotao').disabled = false; $('ckBotao').textContent = 'Fazer check-in';
      $('ckMsg').textContent = 'Sem conexão. Verifique a internet e tente de novo, ou fale com a recepção.';
    });
  });
})();
