// Compartilhado entre sugerir-resposta-whatsapp e classificar-resposta-
// convite — bug real corrigido (2026-10-01, achado pelo usuário com
// exemplo real): o atendente tinha prometido "uma outra oportunidade na
// próxima quinta" (sem data exata) numa mensagem anterior da conversa; o
// lead respondeu "Sim" hoje (uma quinta-feira, 01/10) confirmando essa
// promessa — e a IA, só com "Hoje é 2026-10-01" como âncora, teve que
// CALCULAR de cabeça que dia era "a próxima quinta" e errou feio: disse
// "05/10" (uma SEGUNDA-feira), quando a quinta-feira seguinte a hoje é
// 08/10. As datas da tabela `eventos` estavam corretas o tempo todo — o
// erro era só o cálculo de dia-da-semana que a IA fazia na cabeça, tarefa
// clássica de "matemática simples" em que LLMs erram com frequência.
//
// Mesmo princípio de sempre (nunca deixar a IA CALCULAR/inventar um fato
// que o código já pode entregar pronto, 100% confiável): em vez de só
// mandar "hoje é AAAA-MM-DD" e torcer pro modelo acertar a subtração de
// dias da semana, montamos a tabela dos próximos dias JÁ CALCULADA (dia
// da semana + data), e instruímos a IA a só CONSULTAR essa tabela — nunca
// calcular "quinta que vem"/"semana que vem"/etc. por conta própria.
const DIAS_SEMANA_PT = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

export function montarTabelaDiasSemana(hojeISO: string, dias = 14): string {
    // T12:00:00Z (meio-dia UTC) evita que o fuso horário vire a data pro
    // dia anterior/seguinte ao fazer getUTCDay() — hojeISO já vem no fuso
    // de Brasília (America/Sao_Paulo), então só precisamos de um horário
    // "seguro" dentro do mesmo dia civil em qualquer fuso.
    const hoje = new Date(`${hojeISO}T12:00:00Z`);
    const diaSemanaHoje = DIAS_SEMANA_PT[hoje.getUTCDay()];

    const linhas: string[] = [];
    for (let i = 1; i <= dias; i++) {
        const d = new Date(hoje);
        d.setUTCDate(d.getUTCDate() + i);
        const diaSemana = DIAS_SEMANA_PT[d.getUTCDay()];
        const dataISO = d.toISOString().slice(0, 10);
        const [ano, mes, dia] = dataISO.split("-");
        const dataBR = `${dia}/${mes}/${ano}`;
        // i=7 é sempre o mesmo dia da semana de hoje (7 dias se repetem) —
        // é exatamente o caso mais comum e mais arriscado de calcular de
        // cabeça: "a próxima <dia da semana de hoje>" a partir de hoje.
        const marca = i === 7 ? ` ← é isso que "a próxima ${diaSemana}"/"${diaSemana} que vem" significa a partir de hoje` : "";
        linhas.push(`${diaSemana}, ${dataBR} (${dataISO})${marca}`);
    }

    return `Hoje é ${diaSemanaHoje}, ${hojeISO}. Calendário dos próximos ${dias} dias, JÁ CALCULADO — use esta tabela pra QUALQUER referência de dia da semana (ex: "próxima quinta", "sexta que vem", "semana que vem", inclusive uma promessa vaga feita numa mensagem ANTERIOR da conversa, tipo "teremos outra oportunidade na próxima quinta", que o lead só confirmou agora com um "sim"). NUNCA calcule dia da semana de cabeça — é fácil errar por alguns dias, use SEMPRE a linha certa desta tabela:\n${linhas.join("\n")}`;
}
