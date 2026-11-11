// Painel de resultados para dirigentes (resultados.html). A chave de acesso vem
// no fragmento do link (#chave), nunca vai para o servidor de arquivos; a Edge
// Function painel-resultados confere a chave e o escopo. Todo texto vindo do
// servidor entra como texto (textContent), nunca como HTML.
(function () {
  'use strict';
  var URL_API = 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/painel-resultados';
  var chave = (location.hash || '').replace(/^#/, '').trim();
  // Sessão do diretor (PIN): token de 12 h guardado só neste aparelho.
  var CHAVE_SESSAO = 'painel_sessao_' + chave.slice(0, 12);
  function sessaoAtual() { try { var s = JSON.parse(localStorage.getItem(CHAVE_SESSAO) || 'null'); if (s && s.token && new Date(s.expira) > new Date()) return s.token; } catch (e) { /* sem armazenamento */ } return null; }
  function guardarSessao(token, expira) { try { localStorage.setItem(CHAVE_SESSAO, JSON.stringify({ token: token, expira: expira })); } catch (e) { /* sem armazenamento */ } }
  function limparSessao() { try { localStorage.removeItem(CHAVE_SESSAO); } catch (e) { /* sem armazenamento */ } }
  function chamar(corpo) {
    corpo.chave = chave; var t = sessaoAtual(); if (t) corpo.sessao = t;
    return fetch(URL_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), cache: 'no-store', referrerPolicy: 'no-referrer' })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) { if (j && j.precisa_pin) limparSessao(); throw new Error((j && j.erro) || 'Não foi possível consultar.'); } return j; }); });
  }
  var dias = 30;
  var dados = null;
  var abaAtual = null;

  var ROTULOS_FUNIL = [
    ['Frios', 'A convidar'], ['VaiPalestra', 'Vai à palestra'], ['ComoFoi', 'Pós-evento'],
    ['FalarCurso', 'Conversando sobre o curso'], ['QuerEntrar', 'Quer se matricular'],
    ['Matriculados', 'Matriculados no mês'], ['Alunos', 'Alunos'], ['Truncados', 'Fora de perfil']
  ];
  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  function el(tag, attrs, filhos) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'texto') n.textContent = attrs[k];
      else if (k === 'classe') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (filhos || []).forEach(function (f) { if (f != null) n.appendChild(typeof f === 'string' ? document.createTextNode(f) : f); });
    return n;
  }
  function svg(tag, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function num(v) { return (Number(v) || 0).toLocaleString('pt-BR'); }
  function pct(a, b) { return b ? Math.round((a / b) * 100) + '%' : '—'; }
  function dataCurta(iso) {
    if (!iso) return '';
    var p = String(iso).slice(0, 10).split('-');
    return p[2] + '/' + p[1];
  }
  function dataHora(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function nomeEscola(n) { return String(n || '').replace(/^Goiânia - /, ''); }
  var SIGLAS = {};
  function sigla(n) { return SIGLAS[n] || nomeEscola(n).normalize('NFD').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase(); }
  function nomeProprio(n) {
    return String(n || '').toLowerCase().replace(/(^|\s)(\S)/g, function (m, a, b) { return a + b.toUpperCase(); })
      .replace(/\s(Da|De|Do|Das|Dos|E)\s/g, function (m) { return m.toLowerCase(); });
  }
  function barra(valor, total, classe) {
    var b = el('div', { classe: 'barra' + (classe ? ' ' + classe : '') });
    var p = total ? Math.min(100, Math.round((valor / total) * 100)) : 0;
    var s = el('span'); s.style.width = p + '%';
    b.appendChild(s);
    return b;
  }
  function cartao(n, r, d) {
    return el('div', { classe: 'cartao' }, [el('div', { classe: 'n', texto: n }), el('div', { classe: 'r', texto: r }), d ? el('div', { classe: 'd', texto: d }) : null]);
  }
  function tabela(cabecalho, linhas, numericas) {
    var t = el('table');
    var thead = el('thead'); var tr = el('tr');
    cabecalho.forEach(function (c, i) { tr.appendChild(el('th', { texto: c, classe: numericas && numericas.indexOf(i) >= 0 ? 'num' : '' })); });
    thead.appendChild(tr); t.appendChild(thead);
    var tb = el('tbody');
    linhas.forEach(function (l) {
      var r = el('tr', l.classe ? { classe: l.classe } : null);
      l.celulas.forEach(function (c, i) {
        var td = el('td', { classe: numericas && numericas.indexOf(i) >= 0 ? 'num' : '' });
        if (c instanceof Node) td.appendChild(c); else td.textContent = c == null ? '' : String(c);
        r.appendChild(td);
      });
      tb.appendChild(r);
    });
    t.appendChild(tb);
    return el('div', { classe: 'tabela-wrap' }, [t]);
  }

  // Barras agrupadas por dia/semana, com até 3 séries.
  function graficoBarras(rotulos, series) {
    var W = Math.max(560, rotulos.length * 44), H = 220, base = 180, topo = 16, esq = 30;
    var max = 1;
    series.forEach(function (s) { s.valores.forEach(function (v) { if (v > max) max = v; }); });
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Gráfico' });
    [0, 0.5, 1].forEach(function (f) {
      var y = base - (base - topo) * f;
      s.appendChild(svg('line', { x1: esq, x2: W, y1: y, y2: y, stroke: '#e1e7e5' }));
      var t = svg('text', { x: 2, y: y + 4, 'font-size': 11, fill: '#5b6b67' }); t.textContent = Math.round(max * f); s.appendChild(t);
    });
    var passo = (W - esq) / rotulos.length, larg = Math.min(14, (passo - 8) / series.length);
    rotulos.forEach(function (r, i) {
      var x0 = esq + i * passo + (passo - larg * series.length) / 2;
      series.forEach(function (se, k) {
        var v = se.valores[i] || 0, h = ((base - topo) * v) / max;
        var rect = svg('rect', { x: x0 + k * larg, y: base - h, width: larg - 2, height: Math.max(h, v ? 2 : 0), rx: 2, fill: se.cor });
        var tt = svg('title'); tt.textContent = se.nome + ': ' + v + ' (' + r + ')'; rect.appendChild(tt);
        s.appendChild(rect);
      });
      if (rotulos.length <= 20 || i % 2 === 0) {
        var t = svg('text', { x: esq + i * passo + passo / 2, y: base + 16, 'font-size': 11, fill: '#5b6b67', 'text-anchor': 'middle' }); t.textContent = r; s.appendChild(t);
      }
    });
    var leg = el('div', { classe: 'legenda' });
    series.forEach(function (se) { var i = el('i'); i.style.background = se.cor; leg.appendChild(el('span', null, [i, se.nome])); });
    return el('div', { classe: 'grafico' }, [s, leg]);
  }

  function listaComBusca(titulo, itens, colunas, linhaDe, vazio, pessoaDe, legenda) {
    // Fechada por padrão: no celular as listas abertas deixavam a página com ~15 telas.
    var cont = el('details');
    cont.appendChild(el('summary', { texto: titulo + ' (' + num(itens.length) + ')' }));
    var entrada = el('input', { type: 'search', placeholder: 'Buscar por nome, telefone ou escola', 'aria-label': 'Buscar' });
    var info = el('span', { classe: 'muted' });
    cont.appendChild(el('div', { classe: 'busca' }, [entrada, info]));
    if (legenda) cont.appendChild(el('p', { classe: 'legenda-icones so-celular', texto: legenda }));
    var area = el('div'); cont.appendChild(area);
    function desenhar() {
      var q = entrada.value.trim().toLowerCase();
      var filtrados = itens.filter(function (x) { return !q || [x.nome, x.telefone, x.escola].join(' ').toLowerCase().indexOf(q) >= 0; });
      area.textContent = '';
      if (!filtrados.length) { area.appendChild(el('p', { classe: 'muted', texto: vazio })); info.textContent = ''; return; }
      var mostrar = filtrados.slice(0, 300);
      var comAcoes = dados.diretor && mostrar.some(function (x) { return x.pid; });
      var linhas = mostrar.map(function (x) { var cel = linhaDe(x); if (comAcoes) cel.push(el('span', { classe: 'acoes-inline' }, acoesPessoa(x))); return { celulas: cel }; });
      var t = tabela(comAcoes ? colunas.concat(['Ações']) : colunas, linhas); t.classList.add('so-tela-larga'); area.appendChild(t);
      if (pessoaDe) {
        var lista = el('div', { classe: 'pessoas-lista so-celular' });
        mostrar.forEach(function (x) { lista.appendChild(pessoaDe(x)); });
        area.appendChild(lista);
      } else area.appendChild(cartoes(colunas, linhas));
      info.textContent = filtrados.length > 300 ? 'Mostrando 300 de ' + num(filtrados.length) + '. Use a busca para encontrar alguém.' : '';
    }
    entrada.addEventListener('input', desenhar);
    desenhar();
    return cont;
  }

  // No celular cada pessoa vira um cartão: nome em destaque, telefone que liga com
  // um toque e as demais colunas como "rótulo: valor" (sem rolar para o lado).
  function cartoes(colunas, linhas) {
    var lista = el('div', { classe: 'pessoas-cartoes so-celular' });
    linhas.forEach(function (l) {
      var c = el('div', { classe: 'cartao-pessoa' });
      l.celulas.forEach(function (v, i) {
        var rot = String(colunas[i] || '');
        if (i === 0) { c.appendChild(el('strong', { texto: v instanceof Node ? v.textContent : String(v == null ? '' : v) })); return; }
        if (v == null || v === '' || (v instanceof Node && !v.textContent)) return;
        var linha = el('div', { classe: 'cartao-linha' });
        if (/telefone/i.test(rot) && !(v instanceof Node)) {
          var dig = String(v).replace(/\D/g, '');
          var a = el('a', { href: 'tel:+55' + dig, texto: String(v) }); linha.appendChild(a);
        } else {
          linha.appendChild(el('span', { classe: 'muted', texto: rot + ': ' }));
          if (v instanceof Node) linha.appendChild(v.cloneNode(true)); else linha.appendChild(document.createTextNode(String(v)));
        }
        c.appendChild(linha);
      });
      lista.appendChild(c);
    });
    return lista;
  }

  // Linha compacta de pessoa (celular): nome, sigla da escola e ícones com a situação.
  // O telefone fica escondido até tocar no ícone (pedido do usuário, 05/11).
  function icone(simbolo, titulo, classe) {
    return el('span', { classe: 'ic' + (classe ? ' ' + classe : ''), title: titulo, 'aria-label': titulo, role: 'img', texto: simbolo });
  }
  function pessoa(x, icones) {
    var linha = el('div', { classe: 'pessoa' });
    var topo = el('div', { classe: 'pessoa-topo' }, [
      el('span', { classe: 'pessoa-nome', texto: nomeProprio(x.nome) }),
      el('span', { classe: 'sigla', title: nomeEscola(x.escola), texto: sigla(x.escola) })
    ]);
    linha.appendChild(topo);
    var ics = el('div', { classe: 'pessoa-icones' });
    icones.filter(Boolean).forEach(function (i) { ics.appendChild(i); });
    acoesPessoa(x).forEach(function (b) { ics.appendChild(b); });
    if (x.borrado && x.telefone) ics.appendChild(el('span', { classe: 'ic-data', title: 'Entre com o PIN para ver', texto: x.telefone }));
    else if (x.telefone) {
      var bt = el('button', { type: 'button', classe: 'ic ic-tel', title: 'Mostrar telefone', 'aria-label': 'Mostrar telefone', texto: '📞' });
      bt.addEventListener('click', function () {
        var a = el('a', { href: 'tel:+55' + String(x.telefone).replace(/\D/g, ''), classe: 'pessoa-tel', texto: x.telefone });
        bt.replaceWith(a);
      });
      ics.appendChild(bt);
    }
    linha.appendChild(ics);
    return linha;
  }


  // ---- Acesso do diretor (PIN da escola) ----
  function renderizarBarraDiretor() {
    var bar = document.getElementById('diretor-bar');
    if (!bar) { bar = el('div', { id: 'diretor-bar', classe: 'diretor-bar' }); document.querySelector('.topo-in > div').appendChild(bar); }
    bar.textContent = '';
    if (!dados.escola_unica) return;
    if (dados.diretor) {
      var sair = el('button', { type: 'button', classe: 'secundario', texto: 'Sair' }); sair.addEventListener('click', sairDiretor);
      bar.appendChild(el('span', { texto: '🔓 Acesso do diretor ativo ' })); bar.appendChild(sair);
    } else if (dados.pin_disponivel) {
      var b = el('button', { type: 'button', classe: 'secundario', texto: 'Entrar com o PIN da escola' }); b.addEventListener('click', entrarComPin);
      bar.appendChild(b); bar.appendChild(el('span', { texto: ' Nomes e telefones aparecem completos com o PIN.' }));
    } else bar.appendChild(el('span', { texto: 'Nomes e telefones aparecem resumidos. O administrador ainda não definiu o PIN desta escola.' }));
  }
  function entrarComPin() {
    var pin = prompt('PIN da escola (6 números):'); if (pin == null) return;
    chamar({ acao: 'pin', pin: String(pin).replace(/\D/g, '') }).then(function (j) { guardarSessao(j.sessao, j.expira_em); carregar(); }).catch(function (e) { alert(e.message); });
  }
  function sairDiretor() { chamar({ acao: 'sair' }).catch(function () {}).then(function () { limparSessao(); carregar(); }); }

  // Ações do diretor por pessoa: ver a conversa, não contatar, observação.
  function acoesPessoa(x) {
    if (!x.pid || !dados.diretor) return [];
    var ver = el('button', { type: 'button', classe: 'ic ic-acao', title: 'Ver a conversa', 'aria-label': 'Ver a conversa', texto: '🗨️' });
    ver.addEventListener('click', function () { verConversa(x); });
    var nc = el('button', { type: 'button', classe: 'ic ic-acao', title: x.parar ? 'Liberar contato' : 'Marcar: não contatar', texto: x.parar ? '🔓' : '🚫' });
    nc.addEventListener('click', function () { marcarNaoContatar(x, nc); });
    var obs = el('button', { type: 'button', classe: 'ic ic-acao', title: 'Deixar uma observação para a equipe', texto: '✏️' });
    obs.addEventListener('click', function () { deixarObservacao(x); });
    return [ver, nc, obs];
  }
  function verConversa(x) {
    chamar({ acao: 'resumo', pid: x.pid }).then(function (j) {
      var folha = document.getElementById('folha-conversa');
      if (!folha) { folha = el('div', { id: 'folha-conversa', classe: 'folha' }); document.body.appendChild(folha); folha.addEventListener('click', function (e) { if (e.target === folha) folha.remove(); }); }
      var caixa = el('div', { classe: 'folha-caixa' });
      var fechar = el('button', { type: 'button', classe: 'secundario', texto: 'Fechar' }); fechar.addEventListener('click', function () { folha.remove(); });
      caixa.appendChild(el('div', { classe: 'folha-topo' }, [el('strong', { texto: nomeProprio(j.nome) }), fechar]));
      // Etiquetas em linguagem do diretor (11/11/2026: "Temperatura: Fria" não explicava nada).
      var EXPLICA = {
        'Temperatura: Quente': 'Interesse recente: inscrição ou presença em evento, ou mensagem nas últimas 2 semanas',
        'Temperatura: Morna': 'Teve contato com a escola nos últimos 6 meses',
        'Temperatura: Fria': 'Sem contato com a escola nos últimos 6 meses',
        'Não Contatar': 'Pediu para não ser contatado'
      };
      var sit = (j.situacao || []).map(function (t) { return EXPLICA[t] || t.replace(/^Campanha: /, 'Campanha: ').replace(/^Convite: /, 'Resposta ao convite: ').replace(/^Conversa: /, 'Conversa: '); });
      if (sit.length) caixa.appendChild(el('p', { classe: 'muted', texto: sit.join(' · ') }));
      if (j.resumo_conversa) { caixa.appendChild(el('h4', { texto: 'O que a conversa mostrou' })); caixa.appendChild(el('p', { texto: j.resumo_conversa })); }
      if (j.proximo_passo) caixa.appendChild(el('p', { classe: 'muted', texto: 'Próximo passo: ' + j.proximo_passo }));
      if (j.anotacoes) { caixa.appendChild(el('h4', { texto: 'Anotações da equipe' })); caixa.appendChild(el('p', { classe: 'pre', texto: j.anotacoes })); }
      if ((j.ultimas_mensagens || []).length) {
        caixa.appendChild(el('h4', { texto: 'Últimas mensagens' }));
        var msgs = j.ultimas_mensagens, respondeu = msgs.some(function (m) { return m.de === 'pessoa'; });
        var quandoMsg = function (iso) { var d = new Date(iso); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
        if (!respondeu) {
          var ult = msgs[msgs.length - 1];
          caixa.appendChild(el('p', { classe: 'muted', texto: 'Recebeu ' + (msgs.length > 1 ? 'nossas mensagens' : 'nossa mensagem') + (ult.situacao === 'lida' ? ' e leu' : '') + ', mas ainda não respondeu.' }));
        }
        msgs.forEach(function (m) {
          caixa.appendChild(el('p', { classe: 'fala-quem ' + (m.de === 'escola' ? 'fala-quem-escola' : ''), texto: (m.de === 'escola' ? 'Escola' : nomeProprio(j.nome)) + ' · ' + quandoMsg(m.em) + (m.situacao ? ' · ' + m.situacao : '') }));
          caixa.appendChild(el('p', { classe: 'fala ' + (m.de === 'escola' ? 'fala-escola' : 'fala-pessoa'), texto: m.texto }));
        });
      }
      if (!j.resumo_conversa && !j.anotacoes && !(j.ultimas_mensagens || []).length) caixa.appendChild(el('p', { classe: 'muted', texto: 'Ainda não há conversa registrada com esta pessoa.' }));
      folha.textContent = ''; folha.appendChild(caixa);
    }).catch(function (e) { alert(e.message); });
  }
  function marcarNaoContatar(x, botao) {
    var desfazer = !!x.parar, nome = nomeProprio(x.nome);
    if (!confirm(desfazer ? 'Liberar o contato com ' + nome + '?' : 'Marcar ' + nome + ' para NÃO ser contatado pela equipe?')) return;
    var motivo = desfazer ? '' : (prompt('Motivo (opcional):') || '');
    chamar({ acao: 'nao_contatar', pid: x.pid, motivo: motivo, desfazer: desfazer }).then(function () {
      x.parar = !desfazer; botao.textContent = x.parar ? '🔓' : '🚫'; botao.title = x.parar ? 'Liberar contato' : 'Marcar: não contatar';
      alert(x.parar ? 'Marcado: a equipe não vai mais contatar.' : 'Contato liberado.');
    }).catch(function (e) { alert(e.message); });
  }
  function deixarObservacao(x) {
    var t = prompt('Observação para a equipe sobre ' + nomeProprio(x.nome) + ':'); if (!t || !t.trim()) return;
    chamar({ acao: 'observacao', pid: x.pid, texto: t.trim() }).then(function () { alert('Enviada. A equipe vê no CRM hoje.'); }).catch(function (e) { alert(e.message); });
  }

  // ---- Abertura de turma: vagas, turmas e prazo (configurável pelo diretor) ----
  function configDaCampanha(c) {
    var ev = c.evento || {}, lista = dados.turmas_config || [];
    return lista.filter(function (t) { return String(t.data) === String(ev.data); })[0] || lista[0] || null;
  }
  function metaTurma(c) {
    var n = c.numeros || {}, cfg = configDaCampanha(c), box = el('div');
    var inscritos = Number(n.inscritos_total) || 0;
    var total = cfg && cfg.vagas_por_turma ? cfg.vagas_por_turma * (cfg.qtd_turmas || 1) : 0;
    var detalhe = total && (cfg.qtd_turmas || 1) > 1 ? ' (' + cfg.qtd_turmas + ' turmas × ' + cfg.vagas_por_turma + ')' : '';
    box.appendChild(el('div', { classe: 'meta-topo' }, [
      el('div', null, [el('div', { classe: 'r muted', texto: 'Inscritos na turma' }),
        el('div', { classe: 'meta-num' }, [num(inscritos), el('small', { texto: total ? ' / ' + num(total) + ' vagas' + detalhe : '' })])]),
      el('div', { classe: 'muted', texto: total ? (cfg.data_limite ? 'Retardatários podem se matricular até ' + dataCurta(cfg.data_limite) + '.' : 'Sem prazo para retardatários definido.') : 'Vagas ainda não configuradas pelo diretor.' })
    ]));
    if (total) box.appendChild(barra(inscritos, total, inscritos >= total * 0.9 ? 'cheia' : ''));
    return box;
  }
  function secaoConfigTurma() {
    var s = el('section'), lista = dados.turmas_config || [];
    s.appendChild(el('h2', { texto: 'Configuração da abertura de turma' }));
    if (!lista.length) { s.appendChild(el('p', { classe: 'muted', texto: 'Nenhuma abertura de turma cadastrada para esta escola.' })); return s; }
    s.appendChild(el('p', { classe: 'sub', texto: dados.diretor ? 'Informe quantas turmas abrem juntas, as vagas de cada uma e até quando retardatários podem se matricular. Vale no CRM na hora.' : 'Entre com o PIN da escola para configurar.' }));
    lista.forEach(function (t) {
      var card = el('div', { classe: 'config-turma' });
      card.appendChild(el('strong', { texto: t.nome + ' · ' + dataCurta(t.data) + (t.hora ? ' às ' + String(t.hora).slice(0, 5) : '') }));
      if (!dados.diretor) {
        card.appendChild(el('p', { classe: 'muted', texto: (t.qtd_turmas || 1) + ' turma(s) · ' + (t.vagas_por_turma != null ? t.vagas_por_turma + ' vagas por turma' : 'vagas não definidas') + ' · retardatários até ' + (t.data_limite ? dataCurta(t.data_limite) : 'não definido') }));
        s.appendChild(card); return;
      }
      var qt = el('input', { type: 'number', min: '1', max: '20', value: t.qtd_turmas || 1 });
      var vg = el('input', { type: 'number', min: '0', max: '999', value: t.vagas_por_turma == null ? '' : t.vagas_por_turma, placeholder: 'ex.: 25' });
      var dl = el('input', { type: 'date', value: t.data_limite || '', min: t.data });
      var bt = el('button', { type: 'button', classe: 'secundario', texto: 'Salvar' });
      var st = el('span', { classe: 'muted' });
      bt.addEventListener('click', function () {
        bt.disabled = true; st.textContent = 'Salvando…';
        chamar({ acao: 'configurar_turma', evento_id: t.evento_id, qtd_turmas: qt.value, vagas_por_turma: vg.value, data_limite: dl.value })
          .then(function () { st.textContent = 'Salvo.'; carregar(); })
          .catch(function (e) { st.textContent = e.message; bt.disabled = false; });
      });
      card.appendChild(el('div', { classe: 'config-grade' }, [
        el('label', null, ['Turmas abrindo juntas', qt]), el('label', null, ['Vagas por turma', vg]), el('label', null, ['Retardatários até', dl])]));
      card.appendChild(el('div', { classe: 'config-acoes' }, [bt, st]));
      if (t.atualizado_em) card.appendChild(el('p', { classe: 'muted', texto: 'Última alteração: ' + dataHora(t.atualizado_em) }));
      s.appendChild(card);
    });
    return s;
  }

  function selo(texto, tipo) { return el('span', { classe: 'selo' + (tipo ? ' ' + tipo : ''), texto: texto }); }

  function secaoCampanha(c, turma) {
    var s = el('section');
    var ev = c.evento || {}, n = c.numeros || {}, meta = Number(c.campanha && c.campanha.meta_presentes_fora) || 50;
    s.appendChild(el('h2', { texto: (c.campanha && c.campanha.nome) || 'Campanha' }));
    s.appendChild(el('p', { classe: 'sub', texto: (turma ? 'Abertura em ' : 'Evento em ') + dataCurta(ev.data) + ' às ' + String(ev.hora || '').slice(0, 5) + '. Convites pelo WhatsApp para quem já participou de atividades da Nova Acrópole e ' + (turma ? 'ainda não é aluno.' : 'não é aluno.') }));

    var m = el('div', { classe: 'meta' });
    if (turma) { m.appendChild(metaTurma(c)); } else {
    var forasPresentes = Number(n.presentes_fora) || 0;
    var dataEvento = ev.data ? new Date(ev.data + 'T23:59:00-03:00') : null;
    var depois = dataEvento && Date.now() > dataEvento.getTime();
    m.appendChild(el('div', { classe: 'meta-topo' }, [
      el('div', null, [el('div', { classe: 'r muted', texto: depois ? 'Pessoas de fora presentes' : 'Pessoas de fora inscritas' }),
        el('div', { classe: 'meta-num' }, [num(depois ? forasPresentes : n.inscritos_fora), el('small', { texto: ' / meta de ' + meta + ' presentes' })])]),
      el('div', { classe: 'muted', texto: 'A meta conta presentes de fora; a presença vem da recepção do evento.' })
    ]));
    m.appendChild(barra(depois ? forasPresentes : n.inscritos_fora, meta));
    var vagas = Number(ev.vagas) || 0;
    if (vagas) {
      var ocup = Number(n.inscritos_total) || 0;
      m.appendChild(el('div', { classe: 'meta-topo' }, [el('span', { texto: 'Ocupação das vagas no Ulisses' }), el('strong', { texto: num(ocup) + ' de ' + num(vagas) + ' (' + pct(ocup, vagas) + ')' })]));
      m.appendChild(barra(ocup, vagas, ocup >= vagas * 0.9 ? 'cheia' : 'amarela'));
    }
    }
    s.appendChild(m);

    s.appendChild(el('div', { classe: 'cartoes' }, [
      cartao(num(n.convites_enviados), 'convites enviados', n.agendados ? num(n.agendados) + ' agendados hoje' : ''),
      cartao(num(n.entregues), 'entregues', pct(n.entregues, n.convites_enviados) + ' dos enviados'),
      cartao(num(n.responderam), 'responderam', pct(n.responderam, n.entregues) + ' dos entregues'),
      cartao(num(n.vao), turma ? 'querem entrar' : 'disseram que vão', num(n.interessados) + ' interessados'),
      cartao(num(n.inscritos_via_convite), 'inscritos após o convite', ''),
      cartao(num(n.inscritos_total), turma ? 'inscritos na turma' : 'inscritos no Ulisses', num(n.inscritos_alunos) + ' alunos · ' + num(n.inscritos_fora) + ' de fora'),
      cartao(num(n.nao_vao), turma ? 'não vão agora' : 'não podem ir', num(n.pediram_parar) + ' pediram para não receber'),
      cartao(num(n.segunda_tentativa), 'segunda tentativa', 'para quem não respondeu em 24h')
    ]));

    var dias = (c.por_dia || []).filter(function (d) { return d.convites || d.respostas || d.inscricoes; });
    if (dias.length) {
      s.appendChild(el('h3', { texto: 'Dia a dia' }));
      s.appendChild(graficoBarras(dias.map(function (d) { return dataCurta(d.dia); }), [
        { nome: 'Convites', cor: '#086357', valores: dias.map(function (d) { return d.convites; }) },
        { nome: 'Respostas', cor: '#ffca00', valores: dias.map(function (d) { return d.respostas; }) },
        { nome: 'Inscrições no Ulisses', cor: '#5b6b67', valores: dias.map(function (d) { return d.inscricoes; }) }
      ]));
    }

    if ((c.por_escola || []).length && !(turma && dados.escola_unica)) {
      s.appendChild(el('h3', { texto: 'Por escola de origem do convidado' }));
      var tot = { c: 0, r: 0, i: 0 };
      var linhas = c.por_escola.map(function (e) {
        tot.c += e.convidados; tot.r += e.responderam; tot.i += e.inscritos;
        return { celulas: [nomeEscola(e.escola), num(e.convidados), num(e.responderam), pct(e.responderam, e.convidados), num(e.inscritos)] };
      });
      linhas.push({ classe: 'total', celulas: ['Total', num(tot.c), num(tot.r), pct(tot.r, tot.c), num(tot.i)] });
      s.appendChild(tabela(['Escola', 'Convidados', 'Responderam', 'Taxa', 'Inscritos após convite'], linhas, [1, 2, 3, 4]));
    }

    s.appendChild(listaComBusca(turma ? 'Inscritos na turma' : 'Inscritos no Ulisses', c.inscritos || [], ['Nome', 'Telefone', 'Escola', 'Perfil', 'Veio do convite', 'Inscrição', 'Presença'], function (x) {
      return [nomeProprio(x.nome), x.telefone || '', nomeEscola(x.escola), x.aluno ? selo('Aluno', 'cz') : selo('De fora'),
        x.via_convite ? selo('Sim') : '', dataCurta(x.em), x.compareceu === true ? selo('Presente') : (x.compareceu === false ? selo('Faltou', 'vm') : '')];
    }, 'Nenhum inscrito ainda.', function (x) {
      return pessoa(x, [
        x.aluno ? icone('🎓', 'Aluno') : icone('🙋', 'De fora (não é aluno)'),
        x.via_convite ? icone('📩', 'Inscreveu-se depois do nosso convite') : null,
        x.em ? el('span', { classe: 'ic-data', title: 'Data da inscrição', texto: dataCurta(x.em) }) : null,
        x.compareceu === true ? icone('✅', 'Presente') : (x.compareceu === false ? icone('❌', 'Faltou') : null)
      ]);
    }, '🎓 aluno · 🙋 de fora · 📩 veio do convite · ✅ presente · ❌ faltou · 📞 toque para ver o telefone'));

    var ENTREGA = { lido: ['Lido', ''], entregue: ['Entregue', 'cz'], enviado: ['Enviado', 'cz'], falhou: ['Não entregue', 'vm'] };
    s.appendChild(listaComBusca('Pessoas contatadas', c.contatados || [], ['Nome', 'Telefone', 'Escola', 'Convite', 'Entrega', 'Respondeu', 'Situação'], function (x) {
      var e = ENTREGA[x.entrega] || [x.entrega || '', 'cz'];
      var sit = x.parar ? selo('Pediu para não receber', 'vm') : x.situacao ? selo(String(x.situacao).replace('Campanha: ', ''), /Não vai/.test(x.situacao) ? 'cz' : (/Vai/.test(x.situacao) ? '' : 'am')) : '';
      return [nomeProprio(x.nome), x.telefone || '', nomeEscola(x.escola), dataHora(x.enviado_em), selo(e[0], e[1]), x.respondeu ? 'Sim' : '', sit];
    }, 'Nenhum convite enviado ainda.', function (x) {
      var ENT = { enviado: ['✓', 'Enviado', 'ic-cinza'], entregue: ['✓✓', 'Entregue', 'ic-cinza'], lido: ['✓✓', 'Lido', 'ic-azul'], falhou: ['⚠', 'Não entregue', 'ic-verm'] };
      var en = ENT[x.entrega];
      var st = String(x.situacao || '');
      var sitIc = x.parar ? icone('🚫', 'Pediu para não receber') :
        /Não vai/.test(st) ? icone('🙅', 'Não vai') :
        /Vai ao evento|Vai/.test(st) ? icone('🎉', 'Vai ao evento') :
        /Interessado/.test(st) ? icone('⭐', 'Interessado') :
        /atendente/i.test(st) ? icone('🙋‍♂️', 'Pediu atendente') : null;
      return pessoa(x, [
        en ? icone(en[0], en[1], en[2]) : null,
        x.respondeu ? icone('💬', 'Respondeu') : null,
        sitIc
      ]);
    }, '✓ enviado · ✓✓ entregue · ✓✓ azul lido · ⚠ não entregue · 💬 respondeu · ⭐ interessado · 🎉 vai · 🙅 não vai · 🚫 pediu para parar · 📞 toque para ver o telefone'));

    var banco = c.campanha && c.campanha.banco;
    if (banco) {
      var nomesGrupo = { A: turma ? 'Já foram a uma atividade do Curso de Filosofia para Viver' : 'Já foram a um Dia Mundial da Filosofia', B: 'Último evento em 2026', C: 'Último evento em 2025', D: 'Último evento em 2023 ou 2024', E: 'Eventos mais antigos', X: 'Ex-alunos (por último)' };
      var lin = Object.keys(nomesGrupo).filter(function (g) { return banco[g] != null; }).map(function (g) { return { celulas: [nomesGrupo[g], num(banco[g])] }; });
      s.appendChild(el('h3', { texto: turma ? 'Contatos ainda a convidar para a turma' : 'Banco de contatos ainda a convidar' }));
      s.appendChild(tabela(['Grupo (na ordem de envio)', 'Pessoas'], lin, [1]));
      s.appendChild(el('p', { classe: 'nota', texto: 'Ficam fora: alunos ativos, quem pediu para não receber mensagens, quem disse não ter interesse, quem conversou com a escola nos últimos 7 dias e quem já se inscreveu. Cada número recebe no máximo um convite.' }));
    }
    return s;
  }

  function secaoEscolas(d) {
    var s = el('section');
    var umaEscola = !!dados.escola_unica;
    s.appendChild(el('h2', { texto: umaEscola ? 'Ação de matrícula da escola' : 'Ação de matrícula nas escolas' }));
    s.appendChild(el('p', { classe: 'sub', texto: 'Contatos pelo WhatsApp desde ' + dataCurta(d.desde) + '/' + String(d.desde).slice(0, 4) + ', funil atual, matrículas confirmadas no Mercúrio e vagas das próximas aberturas de turma.' }));
    var escolas = d.escolas || [];
    var tot = { c: 0, r: 0, i: 0 };
    escolas.forEach(function (e) { tot.c += e.contatados; tot.r += e.responderam; tot.i += e.inscricoes_apos_contato; });
    var hoje = new Date();
    var mesAtual = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0');
    var ant = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    var mesAnterior = ant.getFullYear() + '-' + String(ant.getMonth() + 1).padStart(2, '0');
    function rotMes(m) { var p = m.split('-'); return MESES[Number(p[1]) - 1] + '/' + p[0].slice(2); }
    var mAt = 0, mAn = 0;
    escolas.forEach(function (e) { mAt += Number((e.matriculas || {})[mesAtual] || 0); mAn += Number((e.matriculas || {})[mesAnterior] || 0); });
    s.appendChild(el('div', { classe: 'cartoes' }, [
      cartao(num(tot.c), 'pessoas contatadas', 'no período'),
      cartao(num(tot.r), 'responderam', pct(tot.r, tot.c) + ' dos contatados'),
      cartao(num(tot.i), 'inscrições após contato', 'em atividades do Ulisses'),
      cartao(num(mAn), 'matrículas em ' + rotMes(mesAnterior), 'confirmadas no Mercúrio'),
      cartao(num(mAt), 'matrículas em ' + rotMes(mesAtual), 'até hoje')
    ]));

    var semanas = d.por_semana || [];
    if (semanas.length > 1) {
      s.appendChild(el('h3', { texto: 'Semana a semana' }));
      s.appendChild(graficoBarras(semanas.map(function (w) { return dataCurta(w.semana); }), [
        { nome: 'Contatados', cor: '#086357', valores: semanas.map(function (w) { return w.contatados; }) },
        { nome: 'Responderam', cor: '#ffca00', valores: semanas.map(function (w) { return w.responderam; }) }
      ]));
    }

    var meses = {};
    escolas.forEach(function (e) { Object.keys(e.matriculas || {}).forEach(function (m) { meses[m] = 1; }); });
    var listaMeses = Object.keys(meses).sort().slice(-3);
    if (umaEscola) {
      var e1 = escolas[0] || {};
      s.appendChild(el('h3', { texto: 'Matrículas por mês' }));
      s.appendChild(tabela(['Mês', 'Matrículas'], listaMeses.map(function (m) { return { celulas: [rotMes(m), num((e1.matriculas || {})[m] || 0)] }; }), [1]));
    } else {
    s.appendChild(el('h3', { texto: 'Por escola' }));
    s.appendChild(tabela(['Escola', 'Contatados', 'Responderam', 'Taxa', 'Inscrições após contato'].concat(listaMeses.map(function (m) { return 'Matrículas ' + rotMes(m); })),
      escolas.map(function (e) {
        return { celulas: [nomeEscola(e.escola), num(e.contatados), num(e.responderam), pct(e.responderam, e.contatados), num(e.inscricoes_apos_contato)]
          .concat(listaMeses.map(function (m) { return num((e.matriculas || {})[m] || 0); })) };
      }).concat([{ classe: 'total', celulas: ['Total', num(tot.c), num(tot.r), pct(tot.r, tot.c), num(tot.i)].concat(listaMeses.map(function (m) {
        return num(escolas.reduce(function (a, e) { return a + Number((e.matriculas || {})[m] || 0); }, 0)); })) }]),
      [1, 2, 3, 4].concat(listaMeses.map(function (_, i) { return 5 + i; }))));
    }
    s.appendChild(el('p', { classe: 'nota', texto: 'Matrículas: alunos novos e reingressos que contam para a escola, conforme o Mercúrio (o mês é o da turma de abertura). "Inscrições após contato" conta quem se inscreveu numa atividade do Ulisses depois de receber mensagem nossa.' }));

    s.appendChild(el('h3', { texto: umaEscola ? 'Funil da escola (situação atual)' : 'Funil de cada escola (situação atual)' }));
    s.appendChild(tabela(['Escola'].concat(ROTULOS_FUNIL.map(function (f) { return f[1]; })),
      escolas.map(function (e) {
        return { celulas: [nomeEscola(e.escola)].concat(ROTULOS_FUNIL.map(function (f) { return num((e.funil || {})[f[0]] || 0); })) };
      }), ROTULOS_FUNIL.map(function (_, i) { return i + 1; })));

    var turmas = d.turmas || [];
    s.appendChild(el('h3', { texto: 'Aberturas de turma e aulas experimentais' }));
    if (!turmas.length) s.appendChild(el('p', { classe: 'muted', texto: 'Nenhuma cadastrada nos próximos 60 dias.' }));
    else s.appendChild(tabela(['Escola', 'Atividade', 'Data', 'Vagas no Ulisses', 'Inscritos', 'Ocupação', 'Convidados pela equipe', 'Presentes'],
      turmas.map(function (t) {
        var cap = Number(t.capacidade) || 0, ins = Number(t.inscritos) || 0;
        var oc = el('span', null, [cap ? pct(ins, cap) : '—']);
        if (cap) { var b = barra(ins, cap, ins >= cap * 0.9 ? 'cheia' : ''); b.classList.add('mini'); oc.appendChild(b); }
        var passou = t.data && new Date(t.data + 'T23:59:00-03:00') < new Date();
        return { celulas: [nomeEscola(t.filial), (t.tipo === 'Aula Inaugural' ? 'Aula experimental: ' : '') + t.nome, dataCurta(t.data) + (passou ? ' (realizada)' : ''),
          cap ? num(cap) : '—', num(ins), oc, num(t.convidados_crm), passou ? num(t.compareceram) : ''] };
      }), [3, 4, 6, 7]));
    return s;
  }

  var escolhaGrupo = {};
  function montar() {
    var secoes = document.getElementById('secoes');
    var abas = document.getElementById('abas');
    secoes.textContent = ''; abas.textContent = '';
    var lista = [];
    SIGLAS = dados.siglas || {};
    // Campanhas da mesma ação em várias escolas (Nova turma, Dia Mundial da Filosofia) viram
    // uma aba só, com a escola escolhida numa lista dentro dela — abas sem barra de rolagem (06/11).
    var grupos = [{ id: "dmf", nome: "Dia Mundial da Filosofia", re: /^dia mundial da filosofia/i, turma: false, base: "Goiânia", itens: [] },
                  { id: "turmas", nome: "Novas turmas", re: /^nova turma/i, turma: true, base: "", itens: [] }];
    (dados.campanhas || []).forEach(function (c, i) {
      var nomeC = (c.campanha && c.campanha.nome) || "Campanha";
      var g = grupos.filter(function (x) { return x.re.test(nomeC); })[0];
      if (g) { g.itens.push(c); return; }
      lista.push({ id: "c" + i, nome: nomeC, fn: function () { return secaoCampanha(c); } });
    });
    grupos.forEach(function (g) {
      if (!g.itens.length) return;
      if (g.itens.length === 1) { lista.push({ id: g.id, nome: (g.itens[0].campanha && g.itens[0].campanha.nome) || g.nome, fn: function () { return secaoCampanha(g.itens[0], g.turma); } }); return; }
      lista.push({ id: g.id, nome: g.nome, fn: function () {
        var box = el("div");
        var nomeEsc = function (c) { var n = (c.campanha && c.campanha.nome) || ""; var p = n.split(" - "); return p.length > 1 ? p.slice(1).join(" - ") : (g.base || n); };
        var atual = escolhaGrupo[g.id] || 0; if (atual >= g.itens.length) atual = 0;
        var sel = el("select", { classe: "seletor-escola", "aria-label": "Escola" });
        g.itens.forEach(function (c, i) { var o = el("option", { value: String(i), texto: nomeEsc(c) }); if (i === atual) o.selected = true; sel.appendChild(o); });
        sel.addEventListener("change", function () { escolhaGrupo[g.id] = Number(sel.value); montar(); });
        box.appendChild(el("label", { classe: "seletor-escola-rotulo" }, ["Escola ", sel]));
        box.appendChild(secaoCampanha(g.itens[atual], g.turma));
        return box;
      } });
    });
    if (dados.escolas) lista.push({ id: 'escolas', nome: 'Escolas', fn: function () { return secaoEscolas(dados.escolas); } });
    // Link de uma escola só: uma página única "Campanha" (a abertura de turma mais recente
    // + os números da escola), sem abas (pedido do usuário, 05/11).
    if (dados.escola_unica) lista = [{ id: 'campanha', nome: 'Campanha', fn: function () {
      var box = el('div');
      (dados.campanhas || []).forEach(function (c) { box.appendChild(secaoCampanha(c, /^nova turma/i.test((c.campanha && c.campanha.nome) || ''))); });
      box.appendChild(secaoConfigTurma());
      if (dados.escolas) box.appendChild(secaoEscolas(dados.escolas));
      return box;
    } }];
    if (!abaAtual || !lista.some(function (a) { return a.id === abaAtual; })) abaAtual = lista.length ? lista[0].id : null;
    if (lista.length > 1) lista.forEach(function (a) {
      var b = el('button', { type: 'button', role: 'tab', 'aria-selected': String(a.id === abaAtual), texto: a.nome });
      b.addEventListener('click', function () { abaAtual = a.id; montar(); });
      abas.appendChild(b);
    });
    abas.hidden = lista.length < 2;
    var atual = lista.filter(function (a) { return a.id === abaAtual; })[0];
    if (atual) secoes.appendChild(atual.fn());
  }

  var timerPreparo = null;
  function carregar() {
    var estado = document.getElementById('estado');
    if (!/^[a-f0-9]{64}$/.test(chave)) { estado.textContent = 'Link incompleto. Abra o endereço completo que você recebeu.'; estado.className = 'estado erro'; return; }
    estado.textContent = 'Carregando…'; estado.className = 'estado';
    chamar({ dias: dias })
      .then(function (j) {
        var res = { j: j };
        clearTimeout(timerPreparo);
        if (res.j.preparando) {
          // Primeira vez deste período: o servidor calcula em segundo plano.
          estado.textContent = res.j.mensagem || 'Os números estão sendo preparados…';
          timerPreparo = setTimeout(carregar, 30000);
          return;
        }
        dados = res.j;
        document.getElementById('rotulo').textContent = dados.rotulo || '';
        // Link de uma escola: o título é a campanha de abertura de turma e a data dela.
        if (dados.escola_unica) {
          var ct = (dados.campanhas || [])[0], evt = ct && ct.evento;
          // Escola sem abertura de turma convida para os eventos dela no Ulisses (11/11/2026).
          var ehTurma = !ct || /^nova turma/i.test((ct.campanha && ct.campanha.nome) || '');
          var titulo = ehTurma ? 'Campanha de abertura de turma' : 'Campanhas de eventos da escola';
          document.querySelector('h1').textContent = titulo;
          document.title = titulo;
          document.getElementById('rotulo').textContent = nomeEscola(dados.rotulo) + (evt && evt.data ? ' · ' + (ehTurma ? 'abertura em ' : 'próximo evento em ') + dataCurta(evt.data) + (evt.hora ? ', às ' + String(evt.hora).slice(0, 5) : '') : '');
        }
        renderizarBarraDiretor();
        var quando = dados.gerado_em ? new Date(dados.gerado_em) : new Date();
        var diaHora = function (d) { return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
        document.getElementById('atualizado').textContent = 'Números atualizados em ' + diaHora(quando) +
          (dados.ulisses_em ? ' · Inscrições do Ulisses de ' + diaHora(new Date(dados.ulisses_em)) : '');
        estado.textContent = '';
        document.getElementById('conteudo').hidden = false;
        montar();
      })
      .catch(function (e) { estado.textContent = e.message || 'Não foi possível consultar agora.'; estado.className = 'estado erro'; });
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-dias]'), function (b) {
    b.addEventListener('click', function () {
      dias = Number(b.getAttribute('data-dias'));
      Array.prototype.forEach.call(document.querySelectorAll('[data-dias]'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      carregar();
    });
  });
  document.getElementById('atualizar').addEventListener('click', carregar);
  // Atualiza sozinho a cada 5 minutos enquanto a aba estiver visível.
  setInterval(function () { if (!document.hidden && dados) carregar(); }, 5 * 60 * 1000);
  carregar();
})();
