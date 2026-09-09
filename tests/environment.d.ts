declare global {
  namespace Cloudflare {
    interface Env {
      TEST_DB: D1Database;
      TEST_BUCKET: R2Bucket;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
