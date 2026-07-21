DELETE FROM colaboradores_acesso WHERE LOWER(email)='a0002958@ems.com.br' AND LOWER(login)<>'a0002958';
DELETE FROM colaboradores_acesso WHERE LOWER(email)='d0047303@ems.com.br' AND LOWER(login)<>'d0047303';
DELETE FROM colaboradores_acesso WHERE LOWER(email)='j0050526@ems.com.br' AND LOWER(login)<>'j0050526';
DELETE FROM colaboradores_acesso WHERE LOWER(email)='r0041868@ems.com.br' AND LOWER(login)<>'r0041868';
DELETE FROM colaboradores_acesso WHERE LOWER(email)='m0043497@ems.com.br' AND LOWER(login)<>'m0043497';
DELETE FROM colaboradores_acesso WHERE LOWER(email)='f0059410@ems.com.br' AND LOWER(login)<>'f0059410';

INSERT INTO colaboradores_acesso(id,login,email,nome,consultor_id,ativo,atualizado_em)
VALUES('ac-a0002958','a0002958','a0002958@ems.com.br','ALESSANDRA FREITAS SA',(SELECT id FROM consultores WHERE ativo=1 AND UPPER(TRIM(nome))='ALESSANDRA FREITAS SA' ORDER BY CASE WHEN origem='PAINEL_EQUIPE' THEN 0 ELSE 1 END LIMIT 1),1,CURRENT_TIMESTAMP)
ON CONFLICT(login) DO UPDATE SET email=excluded.email,nome=excluded.nome,consultor_id=COALESCE(excluded.consultor_id,colaboradores_acesso.consultor_id),ativo=1,atualizado_em=CURRENT_TIMESTAMP;

INSERT INTO colaboradores_acesso(id,login,email,nome,consultor_id,ativo,atualizado_em)
VALUES('ac-d0047303','d0047303','d0047303@ems.com.br','DENYSE CRISTINA VIANA VELOSO ARAUJO',(SELECT id FROM consultores WHERE ativo=1 AND UPPER(TRIM(nome))='DENYSE CRISTINA VIANA VELOSO ARAUJO' ORDER BY CASE WHEN origem='PAINEL_EQUIPE' THEN 0 ELSE 1 END LIMIT 1),1,CURRENT_TIMESTAMP)
ON CONFLICT(login) DO UPDATE SET email=excluded.email,nome=excluded.nome,consultor_id=COALESCE(excluded.consultor_id,colaboradores_acesso.consultor_id),ativo=1,atualizado_em=CURRENT_TIMESTAMP;

INSERT INTO colaboradores_acesso(id,login,email,nome,consultor_id,ativo,atualizado_em)
VALUES('ac-j0050526','j0050526','j0050526@ems.com.br','JOAO DIEGO FERREIRA DE OLIVEIRA',(SELECT id FROM consultores WHERE ativo=1 AND UPPER(TRIM(nome))='JOAO DIEGO FERREIRA DE OLIVEIRA' ORDER BY CASE WHEN origem='PAINEL_EQUIPE' THEN 0 ELSE 1 END LIMIT 1),1,CURRENT_TIMESTAMP)
ON CONFLICT(login) DO UPDATE SET email=excluded.email,nome=excluded.nome,consultor_id=COALESCE(excluded.consultor_id,colaboradores_acesso.consultor_id),ativo=1,atualizado_em=CURRENT_TIMESTAMP;

INSERT INTO colaboradores_acesso(id,login,email,nome,consultor_id,ativo,atualizado_em)
VALUES('ac-r0041868','r0041868','r0041868@ems.com.br','RAIMUNDA MARTINS GOMES CARNEIRO',(SELECT id FROM consultores WHERE ativo=1 AND UPPER(TRIM(nome))='RAIMUNDA MARTINS GOMES CARNEIRO' ORDER BY CASE WHEN origem='PAINEL_EQUIPE' THEN 0 ELSE 1 END LIMIT 1),1,CURRENT_TIMESTAMP)
ON CONFLICT(login) DO UPDATE SET email=excluded.email,nome=excluded.nome,consultor_id=COALESCE(excluded.consultor_id,colaboradores_acesso.consultor_id),ativo=1,atualizado_em=CURRENT_TIMESTAMP;

INSERT INTO colaboradores_acesso(id,login,email,nome,consultor_id,ativo,atualizado_em)
VALUES('ac-m0043497','m0043497','m0043497@ems.com.br','MAURICIO BARROS DE AGUIAR',(SELECT id FROM consultores WHERE ativo=1 AND UPPER(TRIM(nome))='MAURICIO BARROS DE AGUIAR' ORDER BY CASE WHEN origem='PAINEL_EQUIPE' THEN 0 ELSE 1 END LIMIT 1),1,CURRENT_TIMESTAMP)
ON CONFLICT(login) DO UPDATE SET email=excluded.email,nome=excluded.nome,consultor_id=COALESCE(excluded.consultor_id,colaboradores_acesso.consultor_id),ativo=1,atualizado_em=CURRENT_TIMESTAMP;

INSERT INTO colaboradores_acesso(id,login,email,nome,consultor_id,ativo,atualizado_em)
VALUES('ac-f0059410','f0059410','f0059410@ems.com.br','FRANCISCO CORTEZ FILHO',(SELECT id FROM consultores WHERE ativo=1 AND UPPER(TRIM(nome))='FRANCISCO CORTEZ FILHO' ORDER BY CASE WHEN origem='PAINEL_EQUIPE' THEN 0 ELSE 1 END LIMIT 1),1,CURRENT_TIMESTAMP)
ON CONFLICT(login) DO UPDATE SET email=excluded.email,nome=excluded.nome,consultor_id=COALESCE(excluded.consultor_id,colaboradores_acesso.consultor_id),ativo=1,atualizado_em=CURRENT_TIMESTAMP;
