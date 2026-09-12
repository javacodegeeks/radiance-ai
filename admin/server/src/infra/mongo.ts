import { MongoClient, Db } from 'mongodb';

const URI     = `mongodb://${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD}@${process.env.MONGO_HOST}:${process.env.MONGO_PORT}`;
const DB_NAME = process.env.MONGO_DB_NAME!;

let client: MongoClient | null = null;

export async function getDb(): Promise<Db> {
  if (!client) {
    console.log(`[mongo] Connecting to ${process.env.MONGO_HOST}:${process.env.MONGO_PORT}/${DB_NAME}…`);
    const pendingClient = new MongoClient(URI, { maxPoolSize: 20, serverSelectionTimeoutMS: 5000 });
    try {
      await pendingClient.connect();
    } catch (err) {
      console.error(`[mongo] Connection to ${process.env.MONGO_HOST}:${process.env.MONGO_PORT} failed`, err);
      throw err;
    }
    client = pendingClient;
    console.log(`[mongo] Connected to ${process.env.MONGO_HOST}:${process.env.MONGO_PORT}`);
  }
  return client.db(DB_NAME);
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    console.log('[mongo] Connection closed');
  }
}
