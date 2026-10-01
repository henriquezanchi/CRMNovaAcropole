// Edge Function: lembrete-evento-confirmado — pedido do usuário
// (2026-10-01, avaliação de conversão): achamos que 66,4% de quem
// CONFIRMA presença num evento gratuito não aparece — a hipótese mais
// provável não é desinteresse (a pessoa já disse "sim"), é esquecimento/
// fricção de agenda, já que o evento é de graça. Um lembrete automático
// no dia anterior ataca exatamente isso.
//
// Mesmo princípio de sempre: 100% determinístico (quem recebe o
// lembrete é decidido por regra fixa — evento_leads.resposta_convite =
// 'confirmado' + evento acontece amanhã), nenhuma IA envolvida — isto é
// só um lembrete factual, não precisa de "inteligência" nenhuma.
//
// Chamada por pg_cron 1x/dia (migracao_agendamento_lembrete_evento.sql),
// de manhã (10h Brasília) — dá um dia inteiro de antecedência mesmo pra
// evento à noite.
//
// LIMITAÇÃO CONHECIDA, documentada (mesmo caso já visto em
// lembrete-scraper): manda como texto LIVRE, que só entrega se o
// destinatário tiver mandado mensagem nas últimas 24h — sem template
// aprovado dedicado, quem confirmou presença há muitos dias e não
// voltou a falar com a gente pode não receber o lembrete de verdade
// (erro 131047, best-effort, nunca trava o resto do lote). Se a taxa de
// entrega real se mostrar baixa, o próximo passo é criar um template
// aprovado só pra isso.
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { linkMapsDaFilial } from "../_shared/filiaisInfo.ts";

const TAMANHO_LOTE = 5;

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    if (req.method !== "POST") return json({ ok: false, erro: "method_not_allowed" }, 405);

    const amanhaISO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + 24 * 60 * 60 * 1000));

    const { data: eventosAmanha, error: erroEventos } = await supabaseAdmin
        .from("eventos")
        .select("id, nome, hora, filial")
        .eq("ativo", true)
        .eq("data", amanhaISO);
    if (erroEventos) return json({ ok: false, erro: "falha_buscar_eventos", detalhe: erroEventos.message }, 500);
    if (!eventosAmanha || eventosAmanha.length === 0) return json({ ok: true, processados: 0, motivo: "nenhum_evento_amanha" });

    const mapaEventos = new Map(eventosAmanha.map((e: any) => [e.id, e]));
    const idsEventos = eventosAmanha.map((e: any) => e.id);

    const { data: candidatos, error: erroCandidatos } = await supabaseAdmin
        .from("evento_leads")
        .select("id, evento_id, pessoaIdentificador")
        .in("evento_id", idsEventos)
        .eq("resposta_convite", "confirmado")
        .is("lembrete_enviado_em", null);
    if (erroCandidatos) return json({ ok: false, erro: "falha_buscar_candidatos", detalhe: erroCandidatos.message }, 500);
    if (!candidatos || candidatos.length === 0) return json({ ok: true, processados: 0, motivo: "nenhum_confirmado_pendente" });

    const idsLead = [...new Set(candidatos.map((c: any) => c.pessoaIdentificador))];
    const { data: leads } = await supabaseAdmin
        .from("leads_inscricoes")
        .select('pessoaIdentificador, pessoaNome, como_prefere_ser_chamado, filial')
        .in("pessoaIdentificador", idsLead);
    const mapaLeads = new Map((leads || []).map((l: any) => [String(l.pessoaIdentificador), l]));

    const filiaisUnicas = [...new Set((leads || []).map((l: any) => l.filial).filter(Boolean))];
    const { data: filiais } = filiaisUnicas.length > 0
        ? await supabaseAdmin.from("filiais").select("nome, nome_com_preposicao, endereco, link_maps_ulisses").in("nome", filiaisUnicas)
        : { data: [] as any[] };
    const mapaFiliais = new Map((filiais || []).map((f: any) => [f.nome, f]));

    const urlWhatsappSend = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-send`;
    const authServiceRole = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;

    let enviados = 0, falharam = 0, semLead = 0;
    for (let i = 0; i < candidatos.length; i += TAMANHO_LOTE) {
        const lote = candidatos.slice(i, i + TAMANHO_LOTE);
        await Promise.all(lote.map(async (c: any) => {
            const lead = mapaLeads.get(String(c.pessoaIdentificador));
            const evento = mapaEventos.get(c.evento_id);
            if (!lead || !evento) { semLead++; return; }

            const nome = lead.como_prefere_ser_chamado || (lead.pessoaNome || "").split(" ")[0] || "";
            const filialInfo = mapaFiliais.get(lead.filial) || {};
            const filialFalada = filialInfo.nome_com_preposicao ? `na Nova Acrópole ${filialInfo.nome_com_preposicao}` : `na Nova Acrópole${lead.filial ? ` ${lead.filial}` : ""}`;
            // Pedido do usuário (2026-10-01): "quando colocar o endereço,
            // coloque sempre o link da localização do google maps" — texto
            // livre, sem link clicável separado, então o link entra como
            // uma frase própria logo depois do endereço.
            const endereco = filialInfo.endereco ? ` — ${filialInfo.endereco}` : "";
            const linkMapsTxt = linkMapsDaFilial(filialInfo);
            const linkMaps = linkMapsTxt ? `\nLocalização: ${linkMapsTxt}` : "";
            const horaTxt = evento.hora ? ` às ${String(evento.hora).slice(0, 5)}` : "";

            const texto = `Oi${nome ? `, ${nome}` : ""}! Passando só pra lembrar: amanhã é o dia da "${evento.nome}"${horaTxt}, aqui ${filialFalada}${endereco}.${linkMaps}\nTe esperamos! 🙏`;

            // Marca ANTES de saber o resultado — nunca reenvia pra sempre
            // se a chamada falhar (mesmo princípio do resto do projeto).
            await supabaseAdmin.from("evento_leads").update({ lembrete_enviado_em: new Date().toISOString() }).eq("id", c.id);

            try {
                const resp = await fetch(urlWhatsappSend, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: authServiceRole },
                    body: JSON.stringify({ pessoaIdentificador: c.pessoaIdentificador, tipo: "texto", texto, atendenteNome: "Lembrete automático", origemEnvio: "campanha" }),
                });
                const data = await resp.json();
                if (data?.ok) enviados++; else falharam++;
            } catch {
                falharam++;
            }
        }));
        if (i + TAMANHO_LOTE < candidatos.length) await new Promise((r) => setTimeout(r, 400));
    }

    return json({ ok: true, processados: candidatos.length, enviados, falharam, sem_lead_ou_evento: semLead });
});
