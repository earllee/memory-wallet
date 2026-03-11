import path from 'path';
import os from 'os';

const Database = require('better-sqlite3');
import type BetterSqlite3 from 'better-sqlite3';

const CORE_DATA_EPOCH_OFFSET = 978307200;

const NOTESTORE_PATH = path.join(
  os.homedir(),
  'Library',
  'Group Containers',
  'group.com.apple.notes',
  'NoteStore.sqlite'
);

const NOTES_QUERY = `
SELECT
    ZICCLOUDSYNCINGOBJECT.Z_PK as apple_id,
    ZICCLOUDSYNCINGOBJECT.ZTITLE1 as title,
    ZICNOTEDATA.ZDATA as data,
    COALESCE(ZICCLOUDSYNCINGOBJECT.ZCREATIONDATE3,
             ZICCLOUDSYNCINGOBJECT.ZCREATIONDATE1, 0) as created_at,
    COALESCE(ZICCLOUDSYNCINGOBJECT.ZMODIFICATIONDATE1, 0) as modified_at,
    folder.ZTITLE2 as folder
FROM ZICCLOUDSYNCINGOBJECT
LEFT JOIN ZICNOTEDATA
    ON ZICNOTEDATA.ZNOTE = ZICCLOUDSYNCINGOBJECT.Z_PK
LEFT JOIN ZICCLOUDSYNCINGOBJECT as folder
    ON folder.Z_PK = ZICCLOUDSYNCINGOBJECT.ZFOLDER
WHERE ZICCLOUDSYNCINGOBJECT.ZMODIFICATIONDATE1 > ?
    AND ZICCLOUDSYNCINGOBJECT.ZMARKEDFORDELETION != 1
    AND ZICCLOUDSYNCINGOBJECT.ZISPASSWORDPROTECTED != 1
    AND ZICNOTEDATA.ZDATA IS NOT NULL
ORDER BY ZICCLOUDSYNCINGOBJECT.ZMODIFICATIONDATE1 DESC
`;

export interface AppleNote {
  appleId: number;
  title: string;
  data: Buffer;
  createdAt: number;
  modifiedAt: number;
  folder: string | null;
}

export function readAppleNotes(daysLookback: number = 180): AppleNote[] {
  const db: BetterSqlite3.Database = new Database(NOTESTORE_PATH, { readonly: true });

  try {
    const nowUnix = Math.floor(Date.now() / 1000);
    const cutoffCoreData = (nowUnix - daysLookback * 86400) - CORE_DATA_EPOCH_OFFSET;

    const rows = db.prepare(NOTES_QUERY).all(cutoffCoreData) as {
      apple_id: number;
      title: string;
      data: Buffer;
      created_at: number;
      modified_at: number;
      folder: string | null;
    }[];

    return rows.map((row) => ({
      appleId: row.apple_id,
      title: row.title || '',
      data: row.data,
      createdAt: Math.floor(row.created_at + CORE_DATA_EPOCH_OFFSET),
      modifiedAt: Math.floor(row.modified_at + CORE_DATA_EPOCH_OFFSET),
      folder: row.folder,
    }));
  } finally {
    db.close();
  }
}
