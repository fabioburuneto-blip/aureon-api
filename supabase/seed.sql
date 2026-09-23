-- =============================================================================
-- Dados de exemplo (fictícios) para testar o site público.
--
--   /demo              → layout luxo
--   /demo-classico     → layout classico
--   /demo-urbano       → layout urbano
--   /demo-minimalista  → layout minimalista
--
-- Idempotente: apaga e recria as barbearias demo (com tudo que for delas).
-- As imagens (/demo/...) são servidas pela pasta web/public/demo do site.
-- =============================================================================

delete from public.barbearias
 where slug in ('demo', 'demo-classico', 'demo-urbano', 'demo-minimalista');

do $$
declare
  v        record;
  v_id     uuid;
  v_prof   uuid;
  v_dia    int;
begin
  for v in
    select * from (values
      ('demo', 'luxo', 'elegante',
        '#1A1A1A', '#C9A24D', '#0E0E0E', '#F5F1E8', '/demo/logo-luxo.png',
        'A arte do corte clássico',
        'Tradição, precisão e um atendimento sem pressa no coração de Pinheiros.'),
      ('demo-classico', 'classico', 'classica',
        '#3B2A20', '#9E2B25', '#F3EBDD', '#2A1E17', '/demo/logo-classico.png',
        'Navalha, toalha quente e boa conversa',
        'Uma barbearia à moda antiga, feita para quem valoriza o ritual.'),
      ('demo-urbano', 'urbano', 'impacto',
        '#1E1E1E', '#E4FF3A', '#111111', '#FFFFFF', '/demo/logo-urbano.png',
        'Corte de respeito',
        'Fade, navalhado e barba na régua. Chega mais.'),
      ('demo-minimalista', 'minimalista', 'moderna',
        '#ECEBE6', '#1F1F1F', '#FAFAF7', '#1A1A1A', '/demo/logo-minimalista.png',
        'Cortes precisos. Sem excesso.',
        'Agende em segundos e seja atendido no horário.')
    ) as t(slug, layout, fontes, primaria, destaque, fundo, texto, logo, titulo, subtitulo)
  loop
    insert into public.barbearias
      (slug, nome, whatsapp, endereco, cidade, instagram, horario_funcionamento, tema)
    values (
      v.slug,
      'Navalha & Co.',
      '11999990000',
      'Rua dos Pinheiros, 1234 — Pinheiros',
      'São Paulo - SP',
      '@navalhaeco.demo',
      '{
        "0": {"aberto": false, "abre": null,    "fecha": null},
        "1": {"aberto": false, "abre": null,    "fecha": null},
        "2": {"aberto": true,  "abre": "09:00", "fecha": "20:00"},
        "3": {"aberto": true,  "abre": "09:00", "fecha": "20:00"},
        "4": {"aberto": true,  "abre": "09:00", "fecha": "20:00"},
        "5": {"aberto": true,  "abre": "09:00", "fecha": "20:00"},
        "6": {"aberto": true,  "abre": "08:00", "fecha": "17:00"}
      }'::jsonb,
      jsonb_build_object(
        'layout',         v.layout,
        'cor_primaria',   v.primaria,
        'cor_destaque',   v.destaque,
        'cor_fundo',      v.fundo,
        'cor_texto',      v.texto,
        'par_fontes',     v.fontes,
        'logo_url',       v.logo,
        'foto_capa_url',  '/demo/capa.jpg',
        'galeria',        jsonb_build_array(
                            '/demo/galeria-1.jpg', '/demo/galeria-2.jpg', '/demo/galeria-3.jpg',
                            '/demo/galeria-4.jpg', '/demo/galeria-5.jpg', '/demo/galeria-6.jpg'),
        'titulo_hero',    v.titulo,
        'subtitulo_hero', v.subtitulo,
        'texto_sobre',    'A Navalha & Co. nasceu da vontade de resgatar o ritual da barbearia: '
                          || 'tempo para conversar, toalha quente, navalha afiada e acabamento impecável. '
                          || E'\n\n'
                          || 'Nossa equipe une técnicas clássicas às tendências atuais para entregar '
                          || 'um corte que combina com você — do social ao degradê mais ousado. '
                          || 'Café passado na hora e cerveja gelada por conta da casa.'
      )
    )
    returning id into v_id;

    insert into public.servicos (barbearia_id, nome, descricao, preco, duracao_min, ordem) values
      (v_id, 'Corte',          'Tesoura e/ou máquina, lavagem e finalização com pomada.',        55, 30, 1),
      (v_id, 'Barba',          'Toalha quente, navalha e hidratação com óleo de barba.',         45, 30, 2),
      (v_id, 'Corte + Barba',  'O combo completo, com toalha quente e massagem facial.',          90, 60, 3),
      (v_id, 'Pigmentação',    'Preenchimento de falhas na barba ou no cabelo.',                  40, 30, 4),
      (v_id, 'Sobrancelha',    'Alinhamento na navalha.',                                         20, 15, 5),
      (v_id, 'Pezinho',        'Acabamento do contorno entre um corte e outro.',                  20, 15, 6),
      (v_id, 'Hidratação',     'Tratamento para cabelo ou barba ressecados.',                     40, 30, 7),
      (v_id, 'Corte infantil', 'Para os pequenos de até 10 anos, com paciência de sobra.',        45, 30, 8),
      (v_id, 'Platinado',      'Descoloração global com matização. Consulte antes pelo WhatsApp.', 220, 120, 9);

    insert into public.profissionais (barbearia_id, nome, foto_url, ordem) values
      (v_id, 'Rafael Nogueira', '/demo/equipe-1.jpg', 1),
      (v_id, 'Diego Almeida',   '/demo/equipe-2.jpg', 2),
      (v_id, 'Thiago Moura',    '/demo/equipe-3.jpg', 3);

    -- Grade de atendimento coerente com horario_funcionamento (ter a sáb)
    for v_prof in select p.id from public.profissionais p where p.barbearia_id = v_id loop
      for v_dia in 2..5 loop
        insert into public.disponibilidade (barbearia_id, profissional_id, dia_semana, hora_inicio, hora_fim)
        values (v_id, v_prof, v_dia, '09:00', '12:00'),
               (v_id, v_prof, v_dia, '13:00', '20:00');
      end loop;
      insert into public.disponibilidade (barbearia_id, profissional_id, dia_semana, hora_inicio, hora_fim)
      values (v_id, v_prof, 6, '08:00', '17:00');
    end loop;
  end loop;
end $$;
