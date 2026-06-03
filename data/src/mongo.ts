import { MongoClient, Db } from 'mongodb';

let client: MongoClient | null = null;
let db: Db | null = null;

const MONGO_HOST = process.env.MONGO_HOST || 'localhost';
const MONGO_PORT = process.env.MONGO_PORT || '27017';
const MONGO_USER = process.env.MONGO_USER || 'mongo';
const MONGO_PASSWORD = process.env.MONGO_PASSWORD || 'mongo';
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'obf';

const MONGO_URI = `mongodb://${MONGO_USER}:${MONGO_PASSWORD}@${MONGO_HOST}:${MONGO_PORT}`;

export async function getDb(): Promise<Db> {
  if (!client) {
    client = new MongoClient(MONGO_URI, {
      maxPoolSize: 20,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });

    await client.connect();
    console.log(`✅ Connected to MongoDB at ${MONGO_HOST}:${MONGO_PORT} as ${MONGO_USER}`);
  }

  if (!db) {
    db = client.db(MONGO_DB_NAME);
  }

  return db;
}

export function getMongoClient(): MongoClient {
  if (!client) {
    throw new Error('MongoDB client not initialized. Call getMongoDb() first.');
  }
  return client;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('🔌 MongoDB connection closed');
  }
}