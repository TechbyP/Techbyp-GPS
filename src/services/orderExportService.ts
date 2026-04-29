import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

export interface OrderExportLog {
  id: string;
  orderId: string;
  templateId: string;
  templateVersion: string;
  status: 'generated' | 'sent' | 'error';
  createdAt: string;
  createdAtServer?: unknown;
  createdBy: string;
  fileName: string;
}

const COLLECTION = 'order_exports';

export const orderExportService = {
  async createExportLog(log: OrderExportLog) {
    const ref = doc(collection(db, COLLECTION), log.id);
    await setDoc(ref, {
      ...log,
      createdAtServer: serverTimestamp()
    });
  }
};
