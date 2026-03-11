import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

const MODEL_FILENAME = 'nomic-embed-text-v1.5.Q8_0.gguf';
const MODEL_URL = `https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/${MODEL_FILENAME}`;
const PROJECT_ROOT = path.resolve(__dirname, '..');
const MODELS_DIR = path.join(PROJECT_ROOT, 'data', 'models');
const MODEL_PATH = path.join(MODELS_DIR, MODEL_FILENAME);
const EMBEDDING_DIMS = 768;

// node-llama-cpp is ESM-only, so we dynamically import it
async function getLlamaModule() {
  return await import('node-llama-cpp');
}

// Singleton instances - reuse across calls
let llamaInstance: any = null;
let modelInstance: any = null;
let embeddingContextInstance: any = null;

async function getEmbeddingContext() {
  if (embeddingContextInstance) return embeddingContextInstance;

  const { getLlama } = await getLlamaModule();
  llamaInstance = await getLlama();
  modelInstance = await llamaInstance.loadModel({ modelPath: MODEL_PATH });
  embeddingContextInstance = await modelInstance.createEmbeddingContext();

  return embeddingContextInstance;
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const request = (url.startsWith('https') ? https : http).get(url, (response) => {
      // Handle redirects
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(destPath);
        downloadFile(response.headers.location, destPath).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;
      let lastLogPercent = -10;

      response.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0) {
          const percent = Math.floor((downloadedBytes / totalBytes) * 100);
          if (percent >= lastLogPercent + 10) {
            console.error(`Downloading model... ${percent}% (${Math.floor(downloadedBytes / 1024 / 1024)}MB / ${Math.floor(totalBytes / 1024 / 1024)}MB)`);
            lastLogPercent = percent;
          }
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });
    });

    request.on('error', (err) => {
      file.close();
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

/**
 * Downloads the embedding model if it doesn't already exist locally.
 */
export async function ensureModel(): Promise<void> {
  if (fs.existsSync(MODEL_PATH)) {
    return;
  }

  console.error(`Model not found at ${MODEL_PATH}`);
  console.error(`Downloading ${MODEL_FILENAME} from Hugging Face...`);

  fs.mkdirSync(MODELS_DIR, { recursive: true });

  const tmpPath = MODEL_PATH + '.tmp';
  try {
    await downloadFile(MODEL_URL, tmpPath);
    fs.renameSync(tmpPath, MODEL_PATH);
    console.error('Model download complete.');
  } catch (err) {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    throw err;
  }
}

/**
 * L2-normalize a vector to unit length.
 */
function l2Normalize(vec: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);

  if (norm > 0) {
    const result = new Float32Array(vec.length);
    for (let i = 0; i < vec.length; i++) {
      result[i] = vec[i] / norm;
    }
    return result;
  }
  return vec;
}

/**
 * Generate an embedding for a single text string.
 * Applies the appropriate task prefix for nomic-embed-text.
 */
export async function embedText(
  text: string,
  taskType: 'document' | 'query'
): Promise<Float32Array> {
  const prefix = taskType === 'document' ? 'search_document: ' : 'search_query: ';
  // Truncate to ~1800 chars to stay within 512 token context
  const truncated = text.length > 1800 ? text.substring(0, 1800) : text;
  const prefixedText = prefix + truncated;

  const context = await getEmbeddingContext();
  const embedding = await context.getEmbeddingFor(prefixedText);
  const vector: Float32Array = embedding.vector;

  return l2Normalize(vector);
}

/**
 * Convert a Float32Array embedding to a little-endian f32 Buffer
 * suitable for sqlite-vec storage.
 */
export function embeddingToBuffer(embedding: Float32Array): Buffer {
  const buffer = Buffer.alloc(EMBEDDING_DIMS * 4);
  for (let i = 0; i < embedding.length; i++) {
    buffer.writeFloatLE(embedding[i], i * 4);
  }
  return buffer;
}

/**
 * Generate embeddings for multiple texts. Processes sequentially
 * since the embedding context is shared.
 */
export async function embedTexts(
  texts: string[],
  taskType: 'document' | 'query'
): Promise<Float32Array[]> {
  const results: Float32Array[] = [];
  for (const text of texts) {
    results.push(await embedText(text, taskType));
  }
  return results;
}
