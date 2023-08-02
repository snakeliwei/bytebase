ALTER TABLE vcs DROP CONSTRAINT vcs_type_check;
ALTER TABLE vcs ADD CONSTRAINT vcs_type_check CHECK (type IN ('GITLAB', 'GITHUB', 'BITBUCKET', 'AZURE_DEVOPS'));

ALTER TABLE sheet DROP CONSTRAINT sheet_source_check;
ALTER TABLE sheet ADD CONSTRAINT sheet_source_check CHECK (source IN ('BYTEBASE', 'GITLAB', 'GITHUB', 'BITBUCKET', 'AZURE_DEVOPS', 'BYTEBASE_ARTIFACT'));