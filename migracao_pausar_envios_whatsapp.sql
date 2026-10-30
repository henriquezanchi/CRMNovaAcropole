-- Pausa todos os envios automáticos de WhatsApp (30/10/2026).
-- Motivo: a Meta baniu as contas do WhatsApp Business do portfólio
-- "Aletheia Arquitetura Educacional" (Nova Acrópole e Semperia). Enquanto a
-- análise não sair, nada pode sair sozinho — nem acumular tentativa em cima da
-- conta bloqueada, nem disparar de uma vez quando ela voltar.
-- Nenhum agendamento é apagado. Para religar: o mesmo bloco com active := true.
do $$
declare
  nome text;
begin
  foreach nome in array array[
    'reengajar-janela-fechando',
    'whatsapp-reenviar-falhas',
    'parabens-aniversario-diario',
    'avisar-aniversario-ativos-diario',
    'lembrete-evento-confirmado-diario',
    'pesquisa-noshow-evento-diaria',
    'resumo-diario-admin',
    'resumo-semanal-chefe-todas-filiais'
  ] loop
    perform cron.alter_job(job_id := j.jobid, active := false)
      from cron.job j where j.jobname = nome;
  end loop;
end $$;
