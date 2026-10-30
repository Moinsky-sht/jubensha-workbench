CREATE TABLE activity(seq INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, job_id TEXT, type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX activity_project ON activity(project_id,seq);
CREATE TRIGGER activity_job_insert AFTER INSERT ON jobs BEGIN
 INSERT INTO activity(project_id,job_id,type,payload,created_at) VALUES(NEW.project_id,NEW.id,'job',json_object('status',NEW.status),NEW.updated_at);
END;
CREATE TRIGGER activity_job_status AFTER UPDATE OF status ON jobs WHEN NEW.status != OLD.status BEGIN
 INSERT INTO activity(project_id,job_id,type,payload,created_at) VALUES(NEW.project_id,NEW.id,'job',json_object('status',NEW.status),NEW.updated_at);
END;
CREATE TRIGGER activity_message AFTER INSERT ON messages BEGIN
 INSERT INTO activity(project_id,job_id,type,payload,created_at) VALUES((SELECT project_id FROM conversations WHERE id=NEW.conversation_id),NEW.job_id,'message',json_object('conversationId',NEW.conversation_id),NEW.created_at);
END;
CREATE TRIGGER activity_project AFTER UPDATE OF revision ON projects WHEN NEW.revision != OLD.revision BEGIN
 INSERT INTO activity(project_id,type,payload,created_at) VALUES(NEW.id,'revision',json_object('revision',NEW.revision),NEW.updated_at);
END;
CREATE TABLE story_candidates(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,job_id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,adopted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE story_summaries(project_id TEXT NOT NULL,revision INTEGER NOT NULL,mode TEXT NOT NULL,content TEXT NOT NULL,PRIMARY KEY(project_id,revision,mode));
