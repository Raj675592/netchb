import { MongoClient, ObjectId, type Collection, type Document } from 'mongodb';

let client: MongoClient | undefined;
let collectionPromise: Promise<Collection<Document>> | undefined;

export async function getEntriesCollection(): Promise<Collection<Document>> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error('MongoDB is not configured. Add MONGODB_URI to .env and restart the app.');
  if (!collectionPromise) {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    collectionPromise = client.connect().then(connected => {
      const database = connected.db(process.env.MONGODB_DB?.trim() || 'sefer_entry_workbench');
      return database.collection('entries');
    }).catch(error => {
      collectionPromise = undefined;
      client = undefined;
      throw error;
    });
  }
  return collectionPromise;
}

export function parseEntryId(value: string): ObjectId | null {
  return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

export function mongoErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.includes('MongoDB is not configured')) return error.message;
  return 'Could not reach MongoDB. Check MONGODB_URI, network access, and database permissions.';
}
