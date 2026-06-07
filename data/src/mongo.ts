import { MongoClient, Db } from 'mongodb';

let client: MongoClient | null = null;
let db: Db | null = null;
let connectPromise: Promise<void> | null = null;

const MONGO_HOST = process.env.MONGO_HOST || 'localhost';
const MONGO_PORT = process.env.MONGO_PORT || '27017';
const MONGO_USER = process.env.MONGO_USER || 'mongo';
const MONGO_PASSWORD = process.env.MONGO_PASSWORD || 'mongo';
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'obf';

const MONGO_URI = `mongodb://${MONGO_USER}:${MONGO_PASSWORD}@${MONGO_HOST}:${MONGO_PORT}`;
const MONGO_RECONNECT_ATTEMPTS = 3;
const MONGO_RECONNECT_DELAY_MS = 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setupClientListeners(clientInstance: MongoClient): void {
  clientInstance.on('close', () => {
    console.warn('MongoDB connection closed unexpectedly. Reconnecting will be attempted on next getDb() call.');
    client = null;
    db = null;
  });

  clientInstance.on('error', (err) => {
    console.error('MongoDB client error:', err);
  });
}

async function createClient(): Promise<void> {
  if (connectPromise) {
    return connectPromise;
  }

  client = new MongoClient(MONGO_URI, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });

  setupClientListeners(client);

  connectPromise = client.connect()
    .then(() => {
      console.log(`Connected to MongoDB at ${MONGO_HOST}:${MONGO_PORT} as ${MONGO_USER}`);
    })
    .catch((err) => {
      client = null;
      db = null;
      throw err;
    })
    .finally(() => {
      connectPromise = null;
    });

  return connectPromise;
}

async function isClientConnected(): Promise<boolean> {
  if (!client) {
    return false;
  }

  const topology = (client as any).topology;
  if (topology?.isConnected && typeof topology.isConnected === 'function') {
    return topology.isConnected();
  }

  try {
    await client.db(MONGO_DB_NAME).command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

async function connectWithRetry(): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MONGO_RECONNECT_ATTEMPTS; attempt += 1) {
    try {
      await createClient();
      return;
    } catch (err) {
      lastError = err;
      if (attempt < MONGO_RECONNECT_ATTEMPTS) {
        console.warn(`MongoDB connect attempt ${attempt} failed. Retrying in ${MONGO_RECONNECT_DELAY_MS}ms...`, err);
        await delay(MONGO_RECONNECT_DELAY_MS);
      }
    }
  }

  throw lastError;
}

async function reconnectClient(): Promise<void> {
  if (client) {
    try {
      await client.close();
    } catch (err) {
      console.warn('Error closing stale MongoDB client before reconnecting:', err);
    }
  }

  client = null;
  db = null;
  await connectWithRetry();
}

export async function getDb(): Promise<Db> {
  if (!client) {
    await connectWithRetry();
  } else if (!(await isClientConnected())) {
    console.warn('MongoDB client disconnected. Reconnecting...');
    await reconnectClient();
  }

  if (!client) {
    throw new Error('MongoDB client could not be established.');
  }

  if (!db) {
    db = client.db(MONGO_DB_NAME);
  }

  return db;
}

export function getMongoClient(): MongoClient {
  if (!client) {
    throw new Error('MongoDB client not initialized. Call getDb() first.');
  }
  return client;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    connectPromise = null;
    console.log('MongoDB connection closed');
  }
}