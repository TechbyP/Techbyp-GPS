import { collection, doc, getDoc, getDocs, orderBy, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { OrderDraft } from '../types';

const COLLECTION = 'orders';

export const orderAdminService = {
  async listOrdersByOwner(ownerId: string) {
    const ref = collection(db, COLLECTION);
    const q = query(ref, where('ownerId', '==', ownerId), orderBy('updatedAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })) as OrderDraft[];
  },

  async listAllOrders() {
    const ref = collection(db, COLLECTION);
    const q = query(ref, orderBy('updatedAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })) as OrderDraft[];
  },

  async getOrder(orderId: string) {
    const ref = doc(collection(db, COLLECTION), orderId);
    const snapshot = await getDoc(ref);
    return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as OrderDraft) : null;
  },

  async assignOrder(orderId: string, assignee: { id: string; name: string }) {
    const ref = doc(collection(db, COLLECTION), orderId);
    await updateDoc(ref, {
      assignedToId: assignee.id,
      assignedToName: assignee.name,
      assignedAt: new Date().toISOString(),
      status: 'in_progress',
      updatedAt: new Date().toISOString()
    });
  },

  async updateOrderFields(orderId: string, fields: NonNullable<OrderDraft['fields']>, status?: OrderDraft['status']) {
    const ref = doc(collection(db, COLLECTION), orderId);
    const payload: Record<string, any> = {
      fields,
      updatedAt: new Date().toISOString()
    };
    if (status) payload.status = status;
    await updateDoc(ref, payload);
  },

  async updateOrderSourceFields(
    orderId: string,
    sourceFields: NonNullable<OrderDraft['sourceFields']>,
    fields: NonNullable<OrderDraft['fields']>
  ) {
    const ref = doc(collection(db, COLLECTION), orderId);
    await updateDoc(ref, {
      sourceFields,
      fields,
      updatedAt: new Date().toISOString()
    });
  }
};
