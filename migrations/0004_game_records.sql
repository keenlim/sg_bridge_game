-- migrations/0004_game_records.sql
CREATE TABLE IF NOT EXISTS game_records (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id              TEXT    NOT NULL,
  group_id             TEXT,
  played_at            INTEGER NOT NULL,
  telegram_id          INTEGER NOT NULL,
  role                 TEXT    NOT NULL CHECK(role IN ('bidder','partner','opposition')),
  won                  INTEGER NOT NULL CHECK(won IN (0,1)),
  bid_level            INTEGER NOT NULL,
  bid_suit             TEXT    NOT NULL,
  tricks_won           INTEGER NOT NULL,
  partner_telegram_id  INTEGER,
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_game_records_telegram ON game_records(telegram_id);
CREATE INDEX IF NOT EXISTS idx_game_records_group    ON game_records(group_id);
CREATE INDEX IF NOT EXISTS idx_game_records_game     ON game_records(game_id);
