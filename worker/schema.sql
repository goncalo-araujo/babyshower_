-- =============================================================
-- Baby Shower App — D1 SQLite Schema
-- Apply with: wrangler d1 execute babyshower-db --file=./schema.sql
-- =============================================================

CREATE TABLE IF NOT EXISTS items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT    NOT NULL CHECK(length(title) > 0),
  description  TEXT    NOT NULL DEFAULT '',
  image_url    TEXT    NOT NULL DEFAULT '',
  product_url  TEXT    NOT NULL DEFAULT '',
  price_total  REAL    NOT NULL DEFAULT 0.0 CHECK(price_total >= 0),
  price_raised REAL    NOT NULL DEFAULT 0.0 CHECK(price_raised >= 0),
  is_funded    INTEGER NOT NULL DEFAULT 0 CHECK(is_funded IN (0,1)),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_generic   INTEGER NOT NULL DEFAULT 0 CHECK(is_generic IN (0,1)),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contributions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id          INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  contributor_name TEXT    NOT NULL CHECK(length(contributor_name) > 0),
  amount           REAL    NOT NULL CHECK(amount > 0),
  message          TEXT    NOT NULL DEFAULT '',
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Index for fast contribution lookups by item
CREATE INDEX IF NOT EXISTS idx_contributions_item_id ON contributions(item_id);

-- Chat rate limiting: tracks message count per IP per day
CREATE TABLE IF NOT EXISTS chat_rate_limit (
  ip         TEXT    NOT NULL,
  day        TEXT    NOT NULL,  -- ISO date: '2025-04-12'
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, day)
);

-- Seed example items (remove or replace these with real gifts via the admin panel)
INSERT INTO items (title, description, image_url, product_url, price_total)
VALUES
  (
    'Monitor para bebé',
    'Monitor para ver-mos a Luísa com vídeo, áudio bidirecional, e visão noturna.',
    'https://m.media-amazon.com/images/I/61XEU3LtQVL._AC_SL1500_.jpg',
    'https://www.amazon.es/dp/B0BZYJWCMS?ref=cm_sw_r_cso_wa_mwn_ct_EKZFTSG6J2TDN69A232X&ref_=cm_sw_r_cso_wa_mwn_ct_EKZFTSG6J2TDN69A232X&social_share=cm_sw_r_cso_wa_mwn_ct_EKZFTSG6J2TDN69A232X&th=1',
    63.99
  ),
  (
    'Base Isofix para cadeira auto',
    'Base Isofix para cadeira auto, garante a segurança e estabilidade do assento da Luísa no carro.',
    'https://m.media-amazon.com/images/I/51+8BME1t2L._AC_SX679_.jpg',
    'https://www.cybex-online.com/pt/pt/p/10101236.html?gad_source=1&gad_campaignid=17338781032&gbraid=0AAAAABuIWqsuAdUcjxjoNFMCxjXioH6bM&gclid=EAIaIQobChMIrfWo7oPjkgMVtan9BR0nfANxEAQYAiABEgJHxfD_BwE',
    229.95
  ),
  (
    'Espelho retrovisor para assento de bebé',
    'Espelho retrovisor para assento de bebé, permite ao condutor ver a Luisinha enquanto conduz.',
    'https://m.media-amazon.com/images/I/81c8zqDEnrL._AC_SL1500_.jpg',
    'https://www.amazon.es/dp/B0D9PWJG9V?_encoding=UTF8&psc=1&ref_=cm_sw_r_cp_ud_dp_VZP212XJ3CPYYB6HP88V_1',
    9.99
  ),
  (
    'Marsúpio para bebé',
    'Marsúpio para bebé Ergobaby, confortável e seguro para transportar-mos a Luisinha.',
    'https://m.media-amazon.com/images/I/71FmyFM+VEL._AC_SL1500_.jpg',
    'https://amzn.eu/d/0dlCUVRI',
    137.13
  ),

  (
    'Cadeira Zest Plus Chicco 6 meses até aos 40Kg',
    'Cadeira adaptável, confortável e segura para a Luísa enquanto cresce.',
    'https://m.media-amazon.com/images/I/61HtpUlQMDL._AC_SL1500_.jpg',
    'https://www.amazon.es/dp/B0DKFXQ14M?_encoding=UTF8&psc=1&ref_=cm_sw_r_cp_ud_dp_C6DCV3QDYK6450A7SJC6',
    76.49
  ),
  (
    'Ginásio para bebé',
    'Ginásio para bebé, com várias atividades para estimular o desenvolvimento da Luísa.',
    'https://m.media-amazon.com/images/I/81e9Yy65YAL._AC_SL1500_.jpg',
    'hhttps://www.amazon.es/dp/B0DMR1LB4F?_encoding=UTF8&psc=1&ref_=cm_sw_r_cp_ud_dp_0DKVE9TTACHZDSE5DC6M',
    53.99
  ),
  (
    'Ninho para bebé',
    'Ninho para bebé, confortável e seguro para a Luísa dormir e descansar.',
    'https://m.media-amazon.com/images/I/71uU1X8xOIL._AC_SL1500_.jpg',
    'https://www.amazon.es/dp/B0CQKDDBRG?_encoding=UTF8&psc=1&ref_=cm_sw_r_cp_ud_dp_98TXFTDG4GZPB50T5XSX',
    37.95
  ),
  (
    'Colchão para troca de fraldas',
    'Colchão para troca de fraldas, confortável e com tema selva para a troca de fraldas da Luísa.',
    'https://m.media-amazon.com/images/I/61ZxByAR0qL._AC_SL1500_.jpg',
    'https://www.amazon.es/dp/B0DZ2TXV84?ref_=cm_sw_r_cp_ud_dp_M5N2D8E0BP7FNR90H21N',
    24.99
  ),
  (
    'Banheira Stokke com suporte',
    'Banheira Stokke com suporte, confortável e segura para a Luísa tomar o banhinho.',
    'https://m.media-amazon.com/images/I/61ul71md6WL._AC_SL1500_.jpg',
    'https://www.amazon.es/dp/B0CTJ2JWJJ?ref_=cm_sw_r_cp_ud_dp_S047BJTQ2WF3FZGYAS7M',
    138.00
  ),
  (
    'Malinha para troca de fraldas',
    'Mala para trocar-mos as fraldas da Luísa quando saímos de casa, com vários compartimentos para organizar tudo.',
    'https://m.media-amazon.com/images/I/61AvR5hWJAS._AC_SX679_.jpg',
    'https://www.amazon.es/dp/B098NN4QZC?ref_=cm_sw_r_cp_ud_dp_JM962E8BWQT6YFT42RZS',
    44.98
  ),
  (
    'Vestidos de dormir para bebé',
    '3 Vestidos de dormir para bebé, confortáveis para a Luísa dormir.',
    'https://m.media-amazon.com/images/I/91NF9nLaYqL._AC_SX679_PIbundle-3,TopRight,0,0_SH20_.jpg',
    'https://www.amazon.es/dp/B0D1YB9KYR?ref_=cm_sw_r_cp_ud_dp_VMXX2JTETE4T6QXKXTXX',
    27.99
  );
