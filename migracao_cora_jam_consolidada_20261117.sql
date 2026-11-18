-- Feito direto na Cora em 17/11/2026 com o banco fora do ar (pedido do usuário): cobranças do Setor
-- Universitário (cobranca-5) e do Setor Oeste (cobranca-8) canceladas; a do Jardim América (cobranca-6)
-- trocada por uma só com as três somadas (R$ 2.494,88, só Pix, vencimento 17/11/2026).
update cobrancas_cora set status = 'CANCELLED', atualizado_em = now()
 where ambiente = 'producao' and cora_invoice_id in ('inv_FgNyT90VLQQKAnlLT3wCnXw', 'inv_WOCSeBGvTLuA5XZfsmws5g');

update cobrancas_cora set
  cora_invoice_id = 'inv_CT2Ihi3NRAmaecogVVTr90A', status = 'OPEN', erro = null,
  valor_centavos = 249488, vencimento = '2026-11-18', enviada_em = null, lembrete_em = null,
  descricao = 'Trabalho de contatos - Novembro/2026 (Jardim América + Setor Universitário + Setor Oeste)',
  pix_emv = '00020101021226810014br.gov.bcb.pix2559qrcode.cora.com.br/v1/cobv/093d88862dcd44099a79ca205554ebf85204000053039865802BR5925ALETHEIA ARQUITETURA DE S6007GOIANIA62070503***630438F8',
  boleto_url = 'https://storage.googleapis.com/download/storage/v1/b/cora_production_exporter_bankslip_storage/o/cobranca-qrcode-a7a12910-82bc-4ab9-8cc7-b5de42a146f9.png?generation=1795004927323410&alt=media',
  mensagem = E'Olá! Tudo bem?\n\nChegou o período de faturamento do trabalho de contatos da Nova Acrópole, desta vez reunindo as três escolas numa cobrança só.\n\n*Como é calculado*\nO valor é fixo, de acordo com o número de membros ativos de cada escola: R$ 4,96 por membro.\n• Jardim América: 240 membros × R$ 4,96 = R$ 1.190,40\n• Setor Universitário: 230 membros × R$ 4,96 = R$ 1.140,80\n• Setor Oeste: 33 membros × R$ 4,96 = R$ 163,68\n*Total: R$ 2.494,88*\n\nA cobrança das matrículas novas será enviada separadamente.\n\n*Pagamento por Pix* (vencimento 18/11/2026)\nPix copia e cola:\n00020101021226810014br.gov.bcb.pix2559qrcode.cora.com.br/v1/cobv/093d88862dcd44099a79ca205554ebf85204000053039865802BR5925ALETHEIA ARQUITETURA DE S6007GOIANIA62070503***630438F8\n\nQR Code do Pix: https://storage.googleapis.com/download/storage/v1/b/cora_production_exporter_bankslip_storage/o/cobranca-qrcode-a7a12910-82bc-4ab9-8cc7-b5de42a146f9.png?generation=1795004927323410&alt=media\n\nQualquer dúvida, estou à disposição.',
  atualizado_em = now()
 where ambiente = 'producao' and cora_invoice_id = 'inv_IoSPDfiYQpSvnQcYe90rH7A';

insert into log_atividade (filial, acao, autor, detalhes)
values ('Goiânia - Jardim América', 'cobranca_cora_consolidada', 'Claude (pedido do usuário)',
        '{"nova": "inv_CT2Ihi3NRAmaecogVVTr90A", "intermediaria_cancelada": "inv_IR3r7h591QP6YUCIijhmcGQ", "valor_centavos": 249488, "canceladas": ["inv_FgNyT90VLQQKAnlLT3wCnXw","inv_WOCSeBGvTLuA5XZfsmws5g","inv_IoSPDfiYQpSvnQcYe90rH7A"]}'::jsonb);
