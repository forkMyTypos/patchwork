-- Teaching-mode connection log: Google account ID + times only. No IP addresses, names, emails or classroom content. Rows older than 90 days are deleted daily.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,          -- teaching session id (random UUID, not the join code)
  teacher_id TEXT NOT NULL,     -- teacher's Google account ID ("sub")
  started_at INTEGER NOT NULL,  -- ms since epoch (UTC)
  ended_at INTEGER
);
CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,        -- Google account ID ("sub")
  role TEXT NOT NULL,           -- 'teacher' | 'student'
  joined_at INTEGER NOT NULL,   -- one row per connection
  left_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_participants_joined ON participants(joined_at);
CREATE INDEX IF NOT EXISTS idx_participants_user ON participants(user_id);
CREATE INDEX IF NOT EXISTS idx_participants_session ON participants(session_id);
