import { createHash } from "node:crypto";

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function isValidEmbedding(embedding: number[], expectedDimensions: number): boolean {
  return (
    embedding.length > 0 &&
    embedding.length === expectedDimensions &&
    embedding.every(Number.isFinite)
  );
}

export function assertValidEmbedding(embedding: number[], expectedDimensions: number): void {
  if (embedding.length === 0) {
    throw new Error("Embedding provider returned an empty vector");
  }
  if (embedding.length !== expectedDimensions) {
    throw new Error(`Embedding has ${embedding.length} dimensions; expected ${expectedDimensions}`);
  }
  if (!embedding.every(Number.isFinite)) {
    throw new Error("Embedding contains non-finite values");
  }
}

export function serializeEmbedding(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

/**
 * Deserialize embedding from storage (handles BLOB and legacy JSON TEXT).
 */
export function deserializeEmbedding(data: Buffer | string): number[] {
  try {
    if (Buffer.isBuffer(data)) {
      const floats = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
      return Array.from(floats);
    }
    return JSON.parse(data) as number[];
  } catch {
    return [];
  }
}
