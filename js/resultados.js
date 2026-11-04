// Painel de resultados para dirigentes (resultados.html). A chave de acesso vem
// no fragmento do link (#chave), nunca vai para o servidor de arquivos; a Edge
// Function painel-resultados confere a chave e o escopo. Todo texto vindo do
// servidor entra como texto (textContent), nunca como HTML.
(function () {
  'use strict';
  var URL_API = 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/painel-resultados';
  var chave = (location.hash || '').replace(/^#/, '').trim();
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

  function listaComBusca(titulo, itens, colunas, linhaDe, vazio) {
    var cont = el('details', { open: 'open' });
    cont.appendChild(el('summary', { texto: titulo + ' (' + num(itens.length) + ')' }));
    var entrada = el('input', { type: 'search', placeholder: 'Buscar por nome, telefone ou escola', 'aria-label': 'Buscar' });
    var info = el('span', { classe: 'muted' });
    cont.appendChild(el('div', { classe: 'busca' }, [entrada, info]));
    var area = el('div'); cont.appendChild(area);
    function desenhar() {
      var q = entrada.value.trim().toLowerCase();
      var filtrados = itens.filter(function (x) { return !q || [x.nome, x.telefone, x.escola].join(' ').toLowerCase().indexOf(q) >= 0; });
      area.textContent = '';
      if (!filtrados.length) { area.appendChild(el('p', { classe: 'muted', texto: vazio })); info.textContent = ''; return; }
      var mostrar = filtrados.slice(0, 300);
      area.appendChild(tabela(colunas, mostrar.map(function (x) { return { celulas: linhaDe(x) }; })));
      info.textContent = filtrados.length > 300 ? 'Mostrando 300 de ' + num(filtrados.length) + '. Use a busca para encontrar alguém.' : '';
    }
    entrada.addEventListener('input', desenhar);
    desenhar();
    return cont;
  }

  function selo(texto, tipo) { return el('span', { classe: 'selo' + (tipo ? ' ' + tipo : ''), texto: texto }); }

  function secaoCampanha(c) {
    var s = el('section');
    var ev = c.evento || {}, n = c.numeros || {}, meta = Number(c.campanha && c.campanha.meta_presentes_fora) || 50;
    s.appendChild(el('h2', { texto: (c.campanha && c.campanha.nome) || 'Campanha' }));
    s.appendChild(el('p', { classe: 'sub', texto: 'Evento em ' + dataCurta(ev.data) + ' às ' + String(ev.hora || '').slice(0, 5) + '. Convites pelo WhatsApp para quem já participou de atividades da Nova Acrópole e não é aluno.' }));

    var m = el('div', { classe: 'meta' });
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
    s.appendChild(m);

    s.appendChild(el('div', { classe: 'cartoes' }, [
      cartao(num(n.convites_enviados), 'convites enviados', n.agendados ? num(n.agendados) + ' agendados hoje' : ''),
      cartao(num(n.entregues), 'entregues', pct(n.entregues, n.convites_enviados) + ' dos enviados'),
      cartao(num(n.responderam), 'responderam', pct(n.responderam, n.entregues) + ' dos entregues'),
      cartao(num(n.vao), 'disseram que vão', num(n.interessados) + ' interessados'),
      cartao(num(n.inscritos_via_convite), 'inscritos após o convite', ''),
      cartao(num(n.inscritos_total), 'inscritos no Ulisses', num(n.inscritos_alunos) + ' alunos · ' + num(n.inscritos_fora) + ' de fora'),
      cartao(num(n.nao_vao), 'não podem ir', num(n.pediram_parar) + ' pediram para não receber'),
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

    if ((c.por_escola || []).length) {
      s.appendChild(el('h3', { texto: 'Por escola de origem do convidado' }));
      var tot = { c: 0, r: 0, i: 0 };
      var linhas = c.por_escola.map(function (e) {
        tot.c += e.convidados; tot.r += e.responderam; tot.i += e.inscritos;
        return { celulas: [nomeEscola(e.escola), num(e.convidados), num(e.responderam), pct(e.responderam, e.convidados), num(e.inscritos)] };
      });
      linhas.push({ classe: 'total', celulas: ['Total', num(tot.c), num(tot.r), pct(tot.r, tot.c), num(tot.i)] });
      s.appendChild(tabela(['Escola', 'Convidados', 'Responderam', 'Taxa', 'Inscritos após convite'], linhas, [1, 2, 3, 4]));
    }

    s.appendChild(listaComBusca('Inscritos no Ulisses', c.inscritos || [], ['Nome', 'Telefone', 'Escola', 'Perfil', 'Veio do convite', 'Inscrição', 'Presença'], function (x) {
      return [nomeProprio(x.nome), x.telefone || '', nomeEscola(x.escola), x.aluno ? selo('Aluno', 'cz') : selo('De fora'),
        x.via_convite ? selo('Sim') : '', dataCurta(x.em), x.compareceu === true ? selo('Presente') : (x.compareceu === false ? selo('Faltou', 'vm') : '')];
    }, 'Nenhum inscrito ainda.'));

    var ENTREGA = { lido: ['Lido', ''], entregue: ['Entregue', 'cz'], enviado: ['Enviado', 'cz'], falhou: ['Não entregue', 'vm'] };
    s.appendChild(listaComBusca('Pessoas contatadas', c.contatados || [], ['Nome', 'Telefone', 'Escola', 'Convite', 'Entrega', 'Respondeu', 'Situação'], function (x) {
      var e = ENTREGA[x.entrega] || [x.entrega || '', 'cz'];
      var sit = x.parar ? selo('Pediu para não receber', 'vm') : x.situacao ? selo(String(x.situacao).replace('Campanha: ', ''), /Não vai/.test(x.situacao) ? 'cz' : (/Vai/.test(x.situacao) ? '' : 'am')) : '';
      return [nomeProprio(x.nome), x.telefone || '', nomeEscola(x.escola), dataHora(x.enviado_em), selo(e[0], e[1]), x.respondeu ? 'Sim' : '', sit];
    }, 'Nenhum convite enviado ainda.'));

    var banco = c.campanha && c.campanha.banco;
    if (banco) {
      var nomesGrupo = { A: 'Já foram a um Dia Mundial da Filosofia', B: 'Último evento em 2026', C: 'Último evento em 2025', D: 'Último evento em 2023 ou 2024', E: 'Eventos mais antigos', X: 'Ex-alunos (por último)' };
      var lin = Object.keys(nomesGrupo).filter(function (g) { return banco[g] != null; }).map(function (g) { return { celulas: [nomesGrupo[g], num(banco[g])] }; });
      s.appendChild(el('h3', { texto: 'Banco de contatos ainda a convidar' }));
      s.appendChild(tabela(['Grupo (na ordem de envio)', 'Pessoas'], lin, [1]));
      s.appendChild(el('p', { classe: 'nota', texto: 'Ficam fora: alunos ativos, quem pediu para não receber mensagens, quem disse não ter interesse, quem conversou com a escola nos últimos 7 dias e quem já se inscreveu. Cada número recebe no máximo um convite.' }));
    }
    return s;
  }

  function secaoEscolas(d) {
    var s = el('section');
    s.appendChild(el('h2', { texto: 'Ação de matrícula nas escolas' }));
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

    s.appendChild(el('h3', { texto: 'Por escola' }));
    var meses = {};
    escolas.forEach(function (e) { Object.keys(e.matriculas || {}).forEach(function (m) { meses[m] = 1; }); });
    var listaMeses = Object.keys(meses).sort().slice(-3);
    s.appendChild(tabela(['Escola', 'Contatados', 'Responderam', 'Taxa', 'Inscrições após contato'].concat(listaMeses.map(function (m) { return 'Matrículas ' + rotMes(m); })),
      escolas.map(function (e) {
        return { celulas: [nomeEscola(e.escola), num(e.contatados), num(e.responderam), pct(e.responderam, e.contatados), num(e.inscricoes_apos_contato)]
          .concat(listaMeses.map(function (m) { return num((e.matriculas || {})[m] || 0); })) };
      }).concat([{ classe: 'total', celulas: ['Total', num(tot.c), num(tot.r), pct(tot.r, tot.c), num(tot.i)].concat(listaMeses.map(function (m) {
        return num(escolas.reduce(function (a, e) { return a + Number((e.matriculas || {})[m] || 0); }, 0)); })) }]),
      [1, 2, 3, 4].concat(listaMeses.map(function (_, i) { return 5 + i; }))));
    s.appendChild(el('p', { classe: 'nota', texto: 'Matrículas: alunos novos e reingressos que contam para a escola, conforme o Mercúrio (o mês é o da turma de abertura). "Inscrições após contato" conta quem se inscreveu numa atividade do Ulisses depois de receber mensagem nossa.' }));

    s.appendChild(el('h3', { texto: 'Funil de cada escola (situação atual)' }));
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

  function montar() {
    var secoes = document.getElementById('secoes');
    var abas = document.getElementById('abas');
    secoes.textContent = ''; abas.textContent = '';
    var lista = [];
    (dados.campanhas || []).forEach(function (c, i) { lista.push({ id: 'c' + i, nome: (c.campanha && c.campanha.nome) || 'Campanha', fn: function () { return secaoCampanha(c); } }); });
    if (dados.escolas) lista.push({ id: 'escolas', nome: 'Escolas', fn: function () { return secaoEscolas(dados.escolas); } });
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

  function carregar() {
    var estado = document.getElementById('estado');
    if (!/^[a-f0-9]{64}$/.test(chave)) { estado.textContent = 'Link incompleto. Abra o endereço completo que você recebeu.'; estado.className = 'estado erro'; return; }
    estado.textContent = 'Carregando…'; estado.className = 'estado';
    fetch(URL_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chave: chave, dias: dias }), cache: 'no-store', referrerPolicy: 'no-referrer' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.j && res.j.erro || 'Não foi possível consultar.');
        dados = res.j;
        document.getElementById('rotulo').textContent = dados.rotulo || '';
        document.getElementById('atualizado').textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
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
