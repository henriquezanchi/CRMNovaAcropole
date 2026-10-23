// Organização por sinais registrados e evidências da análise automática; não autoriza envios.
(function (raiz) {
    'use strict';
    const campos = {
        apoio_escola: { nao: 'Sem pedido de apoio', presenca: 'Conferir presença', acolhimento: 'Acolher após visita', inscricao: 'Auxiliar inscrição', cadastro: 'Conferir cadastro', outro: 'Outro apoio combinado' },
        relacao: { desconhecida: 'A confirmar', interessado: 'Ainda não é aluno', visitante: 'Já visitou a escola', ativo: 'Aluno ativo', antigo: 'Antigo aluno' },
        inscricao: { nao_iniciada: 'Inscrição não iniciada', solicitada: 'Pessoa pediu inscrição', dados_pendentes: 'Faltam dados para conferir', aguardando_registro: 'Aguardando registro no sistema', conferida: 'Cadastro conferido na fonte informada' },
        fonte_registro: { desconhecida: 'Ainda não conferido', mercurio: 'Mercúrio', mercury: 'Mercury', escola: 'Responsável da escola' },
        origem: { desconhecida: 'A confirmar', ulisses: 'Ulisses / evento', ex_aluno: 'Histórico de aluno', instagram: 'Instagram', indicacao: 'Indicação', outro: 'Outra origem' },
        entrada: { desconhecida: 'A confirmar', base_existente: 'Base existente', espontanea: 'Procura espontânea', ativa: 'Prospecção ativa' },
        intencao: { desconhecida: 'Ainda não sabemos', conhecer: 'Quer conhecer', participar: 'Quer participar em data definida', inscrever: 'Quer se inscrever', depois: 'Prefere outra ocasião', nao: 'Não tem interesse agora' },
        contato: { verificar: 'Conferir antes de abordar', permitido: 'Contato combinado', pausado: 'Pausar contato', nao_contatar: 'Não contatar' },
        experiencia: { desconhecida: 'Não informada', positiva: 'Positiva, conforme relato', mista: 'Mista, conforme relato', negativa: 'Negativa, conforme relato' },
        proximo: { nenhum: 'Sem próximo passo', responder: 'Responder dúvida/pedido', convidar: 'Fazer convite', confirmar: 'Confirmar presença', ouvir: 'Ouvir após a visita', inscrever: 'Auxiliar inscrição', conferir: 'Conferir registro oficial', retornar: 'Retornar na data combinada' },
    };
    function normalizar(valor) {
        const dado = valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
        const resultado = {};
        Object.keys(campos).forEach(chave => { resultado[chave] = Object.hasOwn(campos[chave], dado[chave]) ? dado[chave] : Object.keys(campos[chave])[0]; });
        ['responsavel', 'proxima_em', 'pausa_ate', 'nota', 'atualizado_em', 'atualizado_por', 'intencao_atualizado_em', 'intencao_atualizado_por', 'preferencia_contato_em', 'preferencia_contato_por', 'referencia_registro', 'conferido_em', 'pedido_escola'].forEach(chave => { resultado[chave] = typeof dado[chave] === 'string' ? dado[chave] : ''; });
        resultado.revisao = Number.isSafeInteger(dado.revisao) && dado.revisao >= 0 ? dado.revisao : 0;
        return resultado;
    }
    function impedimento(valor, agora = Date.now()) {
        const dado = normalizar(valor);
        if (dado.contato === 'nao_contatar') return 'Pedido de não contato';
        if (dado.contato === 'pausado') {
            if (!dado.pausa_ate || !Number.isFinite(Date.parse(dado.pausa_ate)) || Date.parse(dado.pausa_ate) > agora) return 'Contato pausado';
            return 'Pausa terminou: confirmar preferência antes de campanha';
        }
        if (dado.contato !== 'permitido') return 'Preferência de contato ainda não conferida';
        if (dado.intencao === 'nao' || dado.intencao === 'depois') return 'Interesse atual não autoriza campanha';
        return '';
    }
    function prioridade(lead, agora = Date.now()) {
        let tags=lead.tags;try { if(typeof tags==='string')tags=JSON.parse(tags); }catch{ tags=[]; }
        if(Array.isArray(tags)&&tags.includes('Contato em conferência'))return {nivel:9,motivo:'Contato em conferência: conferir a identidade antes de abordar',campanha:false};
        const dado = normalizar(lead.acompanhamento);
        if (dado.relacao === 'ativo') return { nivel: 9, motivo: 'Aluno ativo: não incluir em captação', campanha: false };
        if (dado.contato === 'pausado' && dado.pausa_ate && Number.isFinite(Date.parse(dado.pausa_ate)) && Date.parse(dado.pausa_ate) <= agora) return { nivel: 0, motivo: 'Pausa terminou: rever preferência individualmente', campanha: false };
        if (dado.contato === 'permitido' && ['solicitada', 'dados_pendentes', 'aguardando_registro'].includes(dado.inscricao)) return { nivel: 1, motivo: 'Inscrição precisa de acompanhamento', campanha: false };
        const motivo = impedimento(dado, agora);
        if (motivo) return { nivel: 9, motivo, campanha: false };
        const vencido = dado.proxima_em && Number.isFinite(Date.parse(dado.proxima_em)) && Date.parse(dado.proxima_em) <= agora;
        if (vencido) return { nivel: 0, motivo: 'Compromisso de atendimento vencido', campanha: false };
        if (dado.proxima_em && Date.parse(dado.proxima_em) > agora) return { nivel: 8, motivo: 'Aguardar a data combinada', campanha: false };
        if (dado.intencao === 'inscrever' || dado.proximo === 'responder') return { nivel: 1, motivo: 'Pedido de ajuda ou inscrição', campanha: false };
        if (dado.intencao === 'participar') return { nivel: 2, motivo: 'Interesse explícito em participar', campanha: true };
        if (dado.intencao === 'conhecer') return { nivel: 3, motivo: 'Quer conhecer a escola', campanha: true };
        return { nivel: 4, motivo: 'Conferir contexto e interesse', campanha: false };
    }
    // Proximidade é evidência registrada, nunca uma probabilidade prevista.
    function proximidade(lead, agora = Date.now()) {
        const dado = normalizar(lead.acompanhamento);
        let tags = [];
        try { tags = Array.isArray(lead.tags) ? lead.tags : JSON.parse(lead.tags || '[]'); } catch (_) {}
        if (!Array.isArray(tags)) tags = [];
        const resultado = (grupo, ordem, rotulo, motivo, acao) => ({ grupo, ordem, rotulo, motivo, acao });
        if (dado.inscricao === 'conferida' && dado.fonte_registro !== 'desconhecida' && dado.referencia_registro.trim() && Number.isFinite(Date.parse(dado.conferido_em)))
            return resultado('conferidos', 9, 'Cadastro conferido', 'Há fonte, referência e data de conferência.', 'Acompanhar o acolhimento como aluno; cadastro não comprova pagamento.');
        if (dado.relacao === 'ativo' || tags.some(t => ['Ativo', 'Aluno Ativo'].includes(t)) || lead.funil_agencia === 'Matriculados')
            return resultado('fora', 9, 'Já indicado como aluno', 'Relação, tag ou coluna informa que já é aluno.', 'Conferir o cadastro na fonte oficial, sem nova abordagem de captação.');
        if (dado.contato === 'nao_contatar' || tags.includes('Não Contatar'))
            return resultado('momento', 8, 'Não contatar', 'Há um pedido de não contato registrado.', 'Respeitar a preferência; verificar pendências apenas internamente.');
        if (dado.contato === 'pausado' || ['nao', 'depois'].includes(dado.intencao))
            return resultado('momento', 8, 'Respeitar o momento', dado.contato === 'pausado' ? 'Contato pausado.' : campos.intencao[dado.intencao], 'Retomar somente conforme a combinação registrada.');
        if (['solicitada', 'dados_pendentes', 'aguardando_registro'].includes(dado.inscricao))
            return resultado('inscricao', 0, 'Inscrição em andamento', campos.inscricao[dado.inscricao], dado.inscricao === 'aguardando_registro' ? 'Conferir o registro com a escola ou no sistema.' : 'Conferir o que falta para concluir, sem repetir pedidos de dados.');
        if (dado.intencao === 'inscrever')
            return resultado('decididos', 1, 'Quer se inscrever', 'A intenção de matrícula foi registrada pela equipe.', 'Ajudar com dúvidas e próximos passos da inscrição.');
        if (dado.relacao === 'visitante' && dado.experiencia === 'positiva')
            return resultado('visita', 2, 'Visitou e relatou boa experiência', 'Visita e relato positivo registrados; ainda sem decisão de matrícula.', 'Ouvir se deseja continuar e quais dúvidas ficaram.');
        if (dado.intencao === 'participar')
            return resultado('participar', 3, 'Quer participar', 'Interesse em uma atividade com data definida registrado.', 'Conferir a confirmação, a presença e depois ouvir a experiência.');
        if (dado.intencao === 'conhecer')
            return resultado('conhecer', 4, 'Quer conhecer', 'Interesse em conhecer a escola registrado.', 'Conversar sobre uma oportunidade adequada, sem pressa.');
        const analise = lead.analise_funil?.resultado;
        if (analise?.intencao?.pretende === true && analise.intencao.trecho)
            return resultado('evento', 3, 'Pretende se inscrever em evento', 'Intenção de inscrição em evento identificada na conversa; não é pedido de matrícula.', 'Consultar o evento e o que foi combinado antes de acompanhar a inscrição.');
        if (analise?.continuidade?.aceitou === true && analise.continuidade.trecho)
            return resultado('conversa', 4, 'Aceitou conversar ou receber informações', 'Aceitação identificada automaticamente na conversa; ainda sem intenção de matrícula comprovada.', 'Ler o contexto e responder ao pedido específico; isso não autoriza campanhas.');
        return resultado('qualificar', 5, 'Interesse a confirmar', dado.relacao === 'visitante' ? 'Já visitou; falta registrar a intenção atual.' : 'Ainda não há intenção atual registrada.', 'Conferir a conversa e registrar o que a pessoa realmente declarou.');
    }
    function atendimentoDiario(lead, agora = Date.now()) {
        const dado = normalizar(lead.acompanhamento);
        // Conferência interna continua necessária, mesmo sem permissão para abordar.
        if (dado.inscricao === 'aguardando_registro' || dado.proximo === 'conferir')
            return { grupo: 'interno', rotulo: 'Conferir com a escola ou no sistema', ordem: 0 };
        if (impedimento(dado, agora) || ['momento','fora','conferidos'].includes(proximidade(lead, agora).grupo))
            return { grupo: 'revisar', rotulo: 'Rever contexto antes de qualquer contato', ordem: 5 };
        if (dado.proxima_em && Number.isFinite(Date.parse(dado.proxima_em))) {
            const data = Date.parse(dado.proxima_em);
            const inicio = new Date(agora); inicio.setHours(0, 0, 0, 0);
            const fim = new Date(inicio); fim.setDate(fim.getDate() + 1);
            if (data < inicio.getTime()) return { grupo: 'atrasados', rotulo: 'Retorno combinado em dia anterior', ordem: 1 };
            if (data < fim.getTime()) return { grupo: 'hoje', rotulo: data > agora ? 'Retorno hoje: aguardar o horário' : 'Retorno combinado para hoje', ordem: 2 };
            return { grupo: 'futuro', rotulo: 'Aguardar a data combinada', ordem: 6 };
        }
        if (dado.proximo === 'responder' || dado.intencao === 'inscrever')
            return { grupo: 'pedidos', rotulo: 'Pedido registrado sem retorno agendado', ordem: 3 };
        return { grupo: 'organizar', rotulo: 'Definir o próximo passo', ordem: 4 };
    }
    // Encaminhamento explicável; não atribui responsável nem autoriza mensagens.
    function trabalhoEspecializado(lead, agora = Date.now()) {
        const dado = normalizar(lead.acompanhamento);
        let tags = [];
        try { tags = Array.isArray(lead.tags) ? lead.tags : JSON.parse(lead.tags || '[]'); } catch (_) {}
        if (!Array.isArray(tags)) tags = [];
        const resultado = (frente, objetivo, proximo) => ({ frente, objetivo, proximo });
        if (tags.includes('Contato em conferência') || tags.includes('Histórico em conferência'))
            return resultado('Conferência de identidade', 'Resolver a divergência antes de usar o histórico para qualificar.', 'Conferir as fontes e os vínculos; preservar os bloqueios existentes.');
        if (dado.contato === 'nao_contatar' || tags.includes('Não Contatar'))
            return resultado('Respeitar pedido de não contato', 'Manter a preferência registrada.', 'Resolver eventuais pendências apenas internamente.');
        if (dado.contato === 'pausado' || ['nao', 'depois'].includes(dado.intencao))
            return resultado('Acompanhamento em pausa', 'Respeitar o momento declarado.', dado.pausa_ate ? 'Consultar o prazo da pausa e o combinado antes de retomar.' : 'Aguardar uma combinação válida para retomar.');
        if (dado.inscricao === 'aguardando_registro' || dado.proximo === 'conferir')
            return resultado('Conferência com a escola', 'Resolver a pendência de registro na fonte autorizada.', 'Conferir internamente antes de pedir novamente informações ao interessado.');
        const sinal = proximidade(lead, agora);
        if (['fora', 'conferidos'].includes(sinal.grupo))
            return resultado('Acolhimento de aluno', 'Encaminhar a necessidade atual à escola.', 'Conferir o vínculo e o responsável local; cadastro não comprova pagamento.');
        if (['inscricao', 'decididos'].includes(sinal.grupo))
            return resultado('Apoio à matrícula', 'Ajudar a concluir o pedido explícito de matrícula.', 'Identificar a dúvida ou pendência real e orientar o próximo passo com a escola.');
        if (dado.proximo === 'ouvir' || sinal.grupo === 'visita')
            return resultado('Acolhimento após visita', 'Entender a experiência relatada e as dúvidas.', 'Ouvir sem presumir satisfação, retorno ou matrícula.');
        if (['evento', 'participar'].includes(sinal.grupo))
            return resultado('Acompanhamento de evento', 'Ajudar com a atividade identificada na conversa.', 'Conferir evento, data e inscrição oficial; intenção e RSVP não comprovam inscrição nem presença.');
        if (dado.relacao === 'antigo' || dado.origem === 'ex_aluno')
            return resultado('Acolhimento de antigo aluno', 'Entender o momento atual sem presumir desejo de retorno.', 'Ler o contexto e acolher antes de propor uma oportunidade.');
        if (['conversa', 'conhecer'].includes(sinal.grupo))
            return resultado('Informações iniciais', 'Responder ao que a pessoa pediu sobre a escola ou atividade.', 'Entregar a informação específica com dados reais, sem antecipar confirmação de presença.');
        return resultado('Qualificação inicial', 'Identificar o pedido e o interesse atual.', 'Consultar o histórico disponível; ausência de informação não significa desinteresse.');
    }
    function validar(valor) {
        if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error('Registro inválido.');
        Object.keys(campos).forEach(chave => { if (!Object.hasOwn(campos[chave], valor[chave])) throw new Error('Escolha uma opção válida para ' + chave + '.'); });
        const dado = normalizar(valor);
        if (dado.nota.length > 600 || dado.responsavel.length > 120) throw new Error('Resuma a observação e o responsável.');
        ['proxima_em', 'pausa_ate'].forEach(chave => { if (dado[chave] && !Number.isFinite(Date.parse(dado[chave]))) throw new Error('Data inválida.'); });
        if (dado.proximo !== 'nenhum' && (!dado.responsavel.trim() || !dado.proxima_em)) throw new Error('Defina responsável e data do próximo passo.');
        if (dado.proxima_em && dado.proximo === 'nenhum') throw new Error('Escolha o próximo passo para essa data.');
        if (dado.contato === 'nao_contatar' && ['convidar', 'confirmar', 'retornar'].includes(dado.proximo)) throw new Error('Respeite o pedido de não contato.');
        if (dado.apoio_escola !== 'nao' && (!dado.pedido_escola.trim() || !dado.responsavel.trim())) throw new Error('Para encaminhar à escola, descreva o apoio necessário e indique o responsável pelo acompanhamento.');
        if (dado.pedido_escola.length > 300) throw new Error('Resuma o pedido visível para a escola em até 300 caracteres.');
        if (dado.referencia_registro.length > 160) throw new Error('Resuma a referência de conferência.');
        if (dado.conferido_em && !Number.isFinite(Date.parse(dado.conferido_em))) throw new Error('Data de conferência inválida.');
        if (dado.inscricao === 'conferida' && (dado.fonte_registro === 'desconhecida' || !dado.referencia_registro.trim() || !dado.conferido_em)) throw new Error('Informe fonte, referência e data da conferência.');
        return dado;
    }
    function textoBusca(valor) { return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
    function selecionarFila(leads, opcoes = {}, agora = Date.now()) {
        const filtro = opcoes.filtro || 'todos';
        const busca = textoBusca(opcoes.busca);
        const responsavel = textoBusca(opcoes.responsavel);
        return leads.map(lead => ({ lead, prioridade: prioridade(lead, agora) })).filter(item => {
            const dado = normalizar(item.lead.acompanhamento);
            if (busca && !textoBusca([item.lead.pessoaNome, item.lead.pessoaIdentificador, dado.responsavel].join(' ')).includes(busca)) return false;
            if (opcoes.somenteMeus && (!responsavel || textoBusca(dado.responsavel) !== responsavel)) return false;
            if (filtro === 'todos') return true;
            if (filtro === 'dia:pendentes') return ['interno', 'atrasados', 'hoje', 'pedidos'].includes(atendimentoDiario(item.lead, agora).grupo);
            if (filtro.startsWith('dia:')) return atendimentoDiario(item.lead, agora).grupo === filtro.slice(4);
            const sinal = proximidade(item.lead, agora);
            if (filtro === 'proximos') return ['inscricao', 'decididos', 'visita'].includes(sinal.grupo);
            if (filtro.startsWith('sinal:')) return sinal.grupo === filtro.slice(6);
            if (filtro === 'retornos') return item.prioridade.nivel <= 1;
            if (filtro === 'restritos') return item.prioridade.nivel >= 8;
            if (filtro === 'inscricoes') return ['solicitada', 'dados_pendentes', 'aguardando_registro'].includes(dado.inscricao);
            if (filtro === 'sem_responsavel') return !dado.responsavel.trim();
            return dado.origem === filtro;
        }).sort((a, b) => (filtro.startsWith('dia:') ? atendimentoDiario(a.lead, agora).ordem - atendimentoDiario(b.lead, agora).ordem : 0) || (filtro === 'proximos' || filtro.startsWith('sinal:') ? proximidade(a.lead, agora).ordem - proximidade(b.lead, agora).ordem : 0) || a.prioridade.nivel - b.prioridade.nivel || (a.lead.acompanhamento?.proxima_em || '9999').localeCompare(b.lead.acompanhamento?.proxima_em || '9999') || String(a.lead.pessoaIdentificador).localeCompare(String(b.lead.pessoaIdentificador)));
    }
    function resumir(leads, agora = Date.now()) {
        const resultado = { total: leads.length, atencao: 0, inscricoes: 0, semResponsavel: 0, preferenciaPendente: 0, cadastrosConferidos: 0 };
        leads.forEach(lead => {
            const dado = normalizar(lead.acompanhamento);
            if (prioridade(lead, agora).nivel <= 1) resultado.atencao++;
            if (['solicitada', 'dados_pendentes', 'aguardando_registro'].includes(dado.inscricao)) resultado.inscricoes++;
            if (!dado.responsavel.trim()) resultado.semResponsavel++;
            if (dado.contato === 'verificar') resultado.preferenciaPendente++;
            if (dado.inscricao === 'conferida') resultado.cadastrosConferidos++;
        });
        return resultado;
    }
    function sugerirConversa(valor, agora = Date.now()) {
        const dado = normalizar(valor);
        const bloqueio = impedimento(dado, agora);
        if (bloqueio) return { orientacao: bloqueio + '. Confira o contexto antes de iniciar uma conversa.', texto: '' };
        if (dado.relacao === 'ativo') return { orientacao: 'Aluno ativo: confira a necessidade de atendimento, sem convite de captação.', texto: '' };
        if (dado.intencao === 'nao' || dado.intencao === 'depois') return { orientacao: 'Respeite o momento declarado. Retome apenas se houver combinação válida.', texto: '' };
        if (dado.proxima_em && Date.parse(dado.proxima_em) > agora) return { orientacao: 'Aguarde o retorno combinado. Não é necessário mandar outra mensagem agora.', texto: '' };
        if (dado.inscricao === 'aguardando_registro' || dado.proximo === 'conferir') return { orientacao: 'Confira o registro com a escola ou no sistema antes de perguntar ao interessado.', texto: '' };
        if (dado.proximo === 'confirmar' || dado.proximo === 'convidar') return { orientacao: 'Abra a atividade na Agenda. Confira proposta, data, horário, local e condições antes de preparar o convite; peça uma resposta clara.', texto: '' };
        if (dado.proximo === 'ouvir') return { orientacao: 'Ouça a experiência sem presumir satisfação ou interesse em matrícula.', texto: 'Olá! Como foi a atividade para você? O que fez sentido e ficou alguma dúvida? Gostaria de participar de outra oportunidade ou prefere outro momento?' };
        if (dado.inscricao === 'solicitada' || dado.inscricao === 'dados_pendentes' || dado.intencao === 'inscrever') return { orientacao: 'Ajude na inscrição sem solicitar documentos por um canal inadequado. Confirme o que realmente falta com a escola.', texto: 'Olá! Posso ajudar a dar continuidade à sua inscrição? Ficou alguma dúvida sobre os próximos passos?' };
        if (dado.relacao === 'antigo' || dado.origem === 'ex_aluno') return { orientacao: 'Acolha o momento atual sem pedir detalhes íntimos ou presumir vontade de retornar.', texto: 'Olá, [nome]! Aqui é [atendente], da Nova Acrópole [escola]. Faz um tempo que não conversamos e quis saber como você está. Como têm sido as coisas por aí?' };
        if (dado.origem === 'ulisses') return { orientacao: 'Identifique-se e confira o evento real antes de contextualizar. Inscrição antiga não comprova interesse atual.', texto: 'Olá, [nome]! Tudo bem por aí? Sou [atendente], da Nova Acrópole [escola]. Encontrei seu contato entre as pessoas que se inscreveram em uma atividade nossa e quis passar para saber como você está.' };
        return { orientacao: 'Identifique quem fala e a escola; pergunte se a pessoa deseja conversar, sem afirmar que já houve interesse.', texto: 'Olá! Aqui é da escola. Podemos conversar sobre nossas atividades abertas? Se preferir não receber contato, pode nos avisar.' };
    }
    raiz.AcompanhamentoModelo = Object.freeze({ campos, normalizar, validar, prioridade, proximidade, atendimentoDiario, impedimento, selecionarFila, resumir, sugerirConversa, trabalhoEspecializado });
})(globalThis);
