const MIN_CHUNK_SIZE = 500;
const MAX_CHUNK_SIZE = 1200;

export function chunkText(content: string): string[] {
  const paragraphs = content.split('\n\n').filter((p) => p.length > 0);
  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (current === '') {
      current = paragraph;
    } else if (current.length + paragraph.length + 2 < MAX_CHUNK_SIZE) {
      current += '\n\n' + paragraph;
    } else {
      if (current.length >= MIN_CHUNK_SIZE) {
        chunks.push(current);
      }
      current = paragraph;
    }

    if (current.length >= MAX_CHUNK_SIZE) {
      chunks.push(current);
      current = '';
    }
  }

  // Handle last chunk
  if (current !== '') {
    if (current.length >= MIN_CHUNK_SIZE) {
      chunks.push(current);
    } else if (chunks.length > 0) {
      chunks[chunks.length - 1] += '\n\n' + current;
    } else {
      chunks.push(current); // single small note
    }
  }

  return chunks;
}
