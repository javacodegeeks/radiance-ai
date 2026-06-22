import { MongoClient, Db } from 'mongodb';

const URI     = `mongodb://${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD}@${process.env.MONGO_HOST}:${process.env.MONGO_PORT}`;
const DB_NAME = process.env.MONGO_DB_NAME!;

let client: MongoClient | null = null;

export async function getDb(): Promise<Db> {
  if (!client) {
    client = new MongoClient(URI, { maxPoolSize: 20, serverSelectionTimeoutMS: 5000 });
    await client.connect();
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
