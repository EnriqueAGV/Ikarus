import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Private file storage for patient records, in a Supabase Storage bucket
// that only the server (service role) reaches. Files arrive here already
// encrypted by the app.

export type FileStore = {
  put(path: string, bytes: Uint8Array): Promise<void>;
  get(path: string): Promise<Uint8Array>;
};

const BUCKET = "records";
let bucketReady: Promise<void> | null = null;

function ensureBucket() {
  bucketReady ??= (async () => {
    const storage = createSupabaseAdminClient().storage;
    const { data } = await storage.getBucket(BUCKET);
    if (data) return;
    const { error } = await storage.createBucket(BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) throw error;
  })().catch((err) => {
    bucketReady = null;
    throw err;
  });
  return bucketReady;
}

const supabaseStore: FileStore = {
  async put(path, bytes) {
    await ensureBucket();
    const { error } = await createSupabaseAdminClient()
      .storage.from(BUCKET)
      .upload(path, bytes, { contentType: "application/octet-stream", upsert: false });
    if (error) throw error;
  },
  async get(path) {
    const { data, error } = await createSupabaseAdminClient().storage.from(BUCKET).download(path);
    if (error || !data) throw error ?? new Error(`missing file ${path}`);
    return new Uint8Array(await data.arrayBuffer());
  },
};

let current: FileStore = supabaseStore;

export const fileStore = () => current;

// Tests keep files in memory instead.
export function setFileStore(store: FileStore) {
  current = store;
}

export function memoryFileStore(): FileStore & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async put(path, bytes) {
      if (files.has(path)) throw new Error("exists");
      files.set(path, bytes);
    },
    async get(path) {
      const bytes = files.get(path);
      if (!bytes) throw new Error(`missing file ${path}`);
      return bytes;
    },
  };
}
