/* Teaching-mode connection log: Google account ID + times only. No IP addresses, names, emails or classroom content.
   Rows older than 90 days are deleted daily. Block comments only, so this still works if pasted onto a single line.
   sessions.id = random UUID (not the join code); teacher_id / user_id = Google account ID ("sub");
   times are ms since epoch (UTC); participants has one row per connection. */
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, teacher_id TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER);
CREATE TABLE IF NOT EXISTS participants (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, joined_at INTEGER NOT NULL, left_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_participants_joined ON participants(joined_at);
CREATE INDEX IF NOT EXISTS idx_participants_user ON participants(user_id);
CREATE INDEX IF NOT EXISTS idx_participants_session ON participants(session_id);
