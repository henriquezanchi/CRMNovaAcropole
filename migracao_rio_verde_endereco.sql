-- Endereço de Rio Verde informado pelo usuário (18/11/2026): cadastro da filial e instrução do robô da campanha.
update filiais set endereco = 'R. Ernesto Tito, 594 - Qd 03 Lt 16 - Vila Baylão, Rio Verde - GO, 75906-441'
 where nome = 'Rio Verde';
update campanhas_whatsapp
   set config = jsonb_set(config, '{instrucoes}', to_jsonb(replace(config->>'instrucoes',
       '- Endereço: não está cadastrado. Se perguntarem, diga que vai confirmar e já passa.',
       '- Local: a própria escola de Rio Verde, R. Ernesto Tito, 594 - Qd 03 Lt 16 - Vila Baylão, Rio Verde/GO, CEP 75906-441.')))
 where slug = 'turma-rio-verde-2026';
select (select endereco from filiais where nome='Rio Verde') endereco,
       (select config->>'instrucoes' like '%Ernesto Tito%' from campanhas_whatsapp where slug='turma-rio-verde-2026') robo;
