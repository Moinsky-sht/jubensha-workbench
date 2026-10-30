CREATE TABLE model_health(connection_id TEXT PRIMARY KEY,status TEXT NOT NULL,checked_at TEXT NOT NULL,error TEXT NOT NULL,duration INTEGER NOT NULL DEFAULT 0);
CREATE TABLE retrieval_chunks(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,entity_id TEXT NOT NULL,kind TEXT NOT NULL,block_id TEXT,title TEXT NOT NULL,content TEXT NOT NULL,content_hash TEXT NOT NULL,model TEXT NOT NULL,dimensions INTEGER NOT NULL,embedding BLOB,updated_at TEXT NOT NULL);
CREATE INDEX retrieval_project ON retrieval_chunks(project_id,model,dimensions);
CREATE TABLE retrieval_state(project_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL);
CREATE TABLE retrieval_usage(id TEXT PRIMARY KEY,project_id TEXT,operation TEXT NOT NULL,model TEXT NOT NULL,input_tokens INTEGER,duration INTEGER NOT NULL,created_at TEXT NOT NULL);
ALTER TABLE retrieval_state ADD COLUMN fingerprint TEXT NOT NULL DEFAULT '';
