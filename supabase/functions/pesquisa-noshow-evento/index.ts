// Edge Function: pesquisa-noshow-evento — pedido do usuário (2026-10-01,
// avaliação de conversão): "perguntar o motivo quando alguém confirma e
// não aparece, sem constranger... podemos fazer uma pesquisa bem curta,
// mas que revele isso sem constranger?".
//
// Design da pergunta (o "como" é a parte que mais importa aqui):
// - Abre normalizando a falta ("imprevistos acontecem") — nunca cobra
//   satisfação, nunca soa como "por que você não veio".
// - Múltipla escolha numerada, não um campo aberto — responder "2" é
//   muito mais fácil (e honesto) do que ter que ESCREVER uma
//   justificativa. Um campo aberto pressiona a pessoa a construir uma
//   desculpa; uma lista já pronta não.
// - Inclui opções NEUTRAS de propósito, inclusive uma que é literalmente
//   "mudei de ideia" — isso é o que mais importa: dar uma saída honrosa
//   pra quem simplesmente não quis ir (foi ao cinema, cansou, etc.) sem
//   precisar admitir isso como uma falha — a pessoa nunca é levada a se
//   sentir cobrada.
// - Sempre com "prefiro não dizer" como última opção, sem pedido de
//   justificativa — ninguém é obrigado a se explicar.
//
// NUNCA ENVIADA por quem recusou claramente ("Convite: Sem Interesse")
// nem por quem já confirmou NOVAMENTE pra outro evento (focar energia
// em quem genuinamente sumiu, não reabrir a ferida de quem já disse não
// de forma clara noutro contexto).
//
// A resposta do lead cai no fluxo NORMAL de conversa (mensagens_whatsapp)
// — de propósito SEM um classificador novo por IA: já temos
// sugerir-resposta-whatsapp cobrindo qualquer resposta recebida, e
// forçar uma 3ª categorização aqui seria complexidade desnecessária pra
// um recurso que é, no fundo, só 1 pergunta. O SDR lê a resposta (ou a
// sugestão de IA já ajuda a responder) e, se achar relevante, anota no
// Resumo/Anotações do lead manualmente.
//
// Chamada por pg_cron 1x/dia (migracao_agendamento_pesquisa_noshow.sql).
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const TAMANHO_LOTE = 5;
// Só considera eventos dos últimos N dias — sem isso, a 1ª execução
// depois de rodar a migração encontraria TODO o histórico de no-shows
// antigos de uma vez (milhares de mensagens de uma pergunta que já não
// faz sentido pra um evento de meses atrás).
const JANELA_DIAS_EVENTO_PASSADO = 3;

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    if (req.method !== "POST") return json({ ok: false, erro: "method_not_allowed" }, 405);

    const hojeISO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const limiteISO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() - JANELA_DIAS_EVENTO_PASSADO * 24 * 60 * 60 * 1000));

    const { data: eventosRecentes, error: erroEventos } = await supabaseAdmin
        .from("eventos")
        .select("id, nome")
        .lt("data", hojeISO)
        .gte("data", limiteISO);
    if (erroEventos) return json({ ok: false, erro: "falha_buscar_eventos", detalhe: erroEventos.message }, 500);
    if (!eventosRecentes || eventosRecentes.length === 0) return json({ ok: true, processados: 0, motivo: "nenhum_evento_recente" });

    const mapaEventos = new Map(eventosRecentes.map((e: any) => [e.id, e]));
    const idsEventos = eventosRecentes.map((e: any) => e.id);

    const { data: candidatos, error: erroCandidatos } = await supabaseAdmin
        .from("evento_leads")
        .select("id, evento_id, pessoaIdentificador")
        .in("evento_id", idsEventos)
        .eq("resposta_convite", "confirmado")
        .eq("compareceu", false)
        .is("pesquisa_noshow_enviada_em", null);
    if (erroCandidatos) return json({ ok: false, erro: "falha_buscar_candidatos", detalhe: erroCandidatos.message }, 500);
    if (!candidatos || candidatos.length === 0) return json({ ok: true, processados: 0, motivo: "nenhum_noshow_pendente" });

    const idsLead = [...new Set(candidatos.map((c: any) => c.pessoaIdentificador))];
    const { data: leads } = await supabaseAdmin
        .from("leads_inscricoes")
        .select('pessoaIdentificador, pessoaNome, como_prefere_ser_chamado, tags')
        .in("pessoaIdentificador", idsLead);
    const mapaLeads = new Map((leads || []).map((l: any) => [String(l.pessoaIdentificador), l]));

    const urlWhatsappSend = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-send`;
    const authServiceRole = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;

    let enviados = 0, falharam = 0, pulados = 0;
    for (let i = 0; i < candidatos.length; i += TAMANHO_LOTE) {
        const lote = candidatos.slice(i, i + TAMANHO_LOTE);
        await Promise.all(lote.map(async (c: any) => {
            const lead = mapaLeads.get(String(c.pessoaIdentificador));
            const evento = mapaEventos.get(c.evento_id);
            if (!lead || !evento) { pulados++; return; }

            // Nunca manda pra quem já recusou claramente contato noutro
            // contexto — focar em quem genuinamente só sumiu.
            let tags: string[] = [];
            try {
                const parsed = typeof lead.tags === "string" ? JSON.parse(lead.tags) : lead.tags;
                if (Array.isArray(parsed)) tags = parsed;
            } catch { /* tags malformada — segue normal, não bloqueia */ }
            if (tags.includes("Convite: Sem Interesse")) { pulados++; return; }

            const nome = lead.como_prefere_ser_chamado || (lead.pessoaNome || "").split(" ")[0] || "";
            const texto = `Oi${nome ? `, ${nome}` : ""}! Vimos que você não conseguiu vir na "${evento.nome}" — imprevistos acontecem, super normal! 😊\n\nSó pra gente te entender melhor (sem compromisso nenhum, é rapidinho): o que rolou?\n\n1️⃣ Surgiu algo de última hora\n2️⃣ Esqueci / perdi a hora\n3️⃣ Tive dificuldade pra chegar (trânsito, transporte, etc.)\n4️⃣ Pensei melhor e decidi não ir dessa vez\n5️⃣ Prefiro não dizer\n\nPode responder só com o número 😉`;

            // Marca ANTES de saber o resultado — nunca reenvia pra sempre
            // se a chamada falhar.
            await supabaseAdmin.from("evento_leads").update({ pesquisa_noshow_enviada_em: new Date().toISOString() }).eq("id", c.id);

            try {
                const resp = await fetch(urlWhatsappSend, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: authServiceRole },
                    body: JSON.stringify({ pessoaIdentificador: c.pessoaIdentificador, tipo: "texto", texto, atendenteNome: "Pesquisa automática", origemEnvio: "campanha" }),
                });
                const data = await resp.json();
                if (data?.ok) enviados++; else falharam++;
            } catch {
                falharam++;
            }
        }));
        if (i + TAMANHO_LOTE < candidatos.length) await new Promise((r) => setTimeout(r, 400));
    }

    return json({ ok: true, processados: candidatos.length, enviados, falharam, pulados });
});
