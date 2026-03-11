import path from 'path';
import { gunzipSync } from 'zlib';
import protobuf from 'protobufjs';

const PROTO_PATH = path.join(__dirname, '..', 'proto', 'notestore.proto');

let _root: protobuf.Root | null = null;

function getRoot(): protobuf.Root {
  if (_root) return _root;
  _root = protobuf.loadSync(PROTO_PATH);
  return _root;
}

export interface ParsedNote {
  noteText: string;
  attributeRuns: AttributeRun[];
}

export interface AttributeRun {
  length: number;
  paragraphStyle?: {
    styleType: number;
    alignment?: number;
    indentAmount?: number;
    checklist?: { uuid: Buffer; done: number };
    blockQuote?: number;
  };
  font?: { fontName?: string; pointSize?: number; fontHints?: number };
  fontWeight?: number;
  underlined?: number;
  strikethrough?: number;
  superscript?: number;
  link?: string;
  attachmentInfo?: { attachmentIdentifier?: string; typeUti?: string };
}

export function parseNoteData(data: Buffer): ParsedNote {
  // Decompress if gzip
  let buf: Buffer;
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    buf = gunzipSync(data);
  } else {
    buf = data;
  }

  const root = getRoot();
  const NoteStoreProto = root.lookupType('notestore.NoteStoreProto');

  const message = NoteStoreProto.decode(buf) as unknown as {
    document: {
      version: number;
      note: {
        noteText: string;
        attributeRun: Array<{
          length: number;
          paragraphStyle?: {
            styleType?: number;
            alignment?: number;
            indentAmount?: number;
            checklist?: { uuid: Buffer; done: number };
            blockQuote?: number;
          };
          font?: { fontName?: string; pointSize?: number; fontHints?: number };
          fontWeight?: number;
          underlined?: number;
          strikethrough?: number;
          superscript?: number;
          link?: string;
          attachmentInfo?: { attachmentIdentifier?: string; typeUti?: string };
        }>;
      };
    };
  };

  const note = message.document.note;

  return {
    noteText: note.noteText,
    attributeRuns: note.attributeRun.map((run) => ({
      length: run.length,
      paragraphStyle: run.paragraphStyle
        ? {
            styleType: run.paragraphStyle.styleType ?? -1,
            alignment: run.paragraphStyle.alignment,
            indentAmount: run.paragraphStyle.indentAmount,
            checklist: run.paragraphStyle.checklist,
            blockQuote: run.paragraphStyle.blockQuote,
          }
        : undefined,
      font: run.font,
      fontWeight: run.fontWeight,
      underlined: run.underlined,
      strikethrough: run.strikethrough,
      superscript: run.superscript,
      link: run.link,
      attachmentInfo: run.attachmentInfo,
    })),
  };
}
