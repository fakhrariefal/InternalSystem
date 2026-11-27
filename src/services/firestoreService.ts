import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, handleFirestoreError, OperationType, storage } from '../lib/firebase';
import { sanitizeAuthProfileFields } from '../models/erpLogic';
import { normalizeUserRole } from '../models/rbac';
import { createEmptyErpState } from '../models/seedData';
import type {
  AccountingInvoice,
  AccountingPeriodLock,
  AppNotification,
  AuditLog,
  Category,
  ChartAccount,
  CompanySettings,
  Customer,
  ErpState,
  GoodsReturn,
  InventoryBatch,
  InvoicePayment,
  JournalEntry,
  MonthlyBudget,
  OrderLog,
  Product,
  PurchaseOrder,
  SalesOrder,
  SalesQuotation,
  StockMovement,
  Supplier,
  Uom,
  UserProfile,
  VendorRfq,
  Warehouse,
} from '../models/types';

function stripUndefinedValue(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map(stripUndefinedValue).filter((item) => item !== undefined);
  }
  if (val && typeof val === 'object') {
    const proto = Object.getPrototypeOf(val);
    if (proto === Object.prototype || proto === null) {
      return stripUndefined(val as Record<string, unknown>);
    }
  }
  return val;
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      clean[k] = stripUndefinedValue(v);
    }
  }
  return clean;
}

const TIMESTAMP_FIELDS = new Set(['createdAt', 'updatedAt', 'timestamp', 'paidAt']);

function convertTimestampValue(key: string, v: unknown): unknown {
  if (v instanceof Timestamp) {
    return v.toDate().toISOString();
  }
  if ((v === null || v === undefined) && TIMESTAMP_FIELDS.has(key)) {
    return new Date().toISOString();
  }
  if (Array.isArray(v)) {
    return v.map((item) =>
      item && typeof item === 'object' && !(item instanceof Timestamp)
        ? convertTimestamps(item as Record<string, unknown>)
        : item instanceof Timestamp
        ? item.toDate().toISOString()
        : item
    );
  }
  if (v && typeof v === 'object') {
    const proto = Object.getPrototypeOf(v);
    if (proto === Object.prototype || proto === null) {
      return convertTimestamps(v as Record<string, unknown>);
    }
  }
  return v;
}

function convertTimestamps<T>(raw: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = convertTimestampValue(k, v);
  }
  return out as T;
}

export async function uploadFileToStorage(
  folder: 'products' | 'po-documents' | 'company' | 'partner-docs' | 'pod-docs',
  file: File
): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageRef = ref(storage, `${folder}/${Date.now()}_${safeName}`);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
}

const ALLOWED_PARTNER_DOC_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca file dokumen.'));
    reader.readAsDataURL(file);
  });
}

async function compressImageToDataUrl(file: File): Promise<string> {
  const rawDataUrl = await readFileAsDataUrl(file);
  if (rawDataUrl.length <= 180000) return rawDataUrl;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1200;
      let width = img.width;
      let height = img.height;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(rawDataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const compressed = canvas.toDataURL('image/jpeg', 0.72);
      resolve(compressed);
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
}

export async function uploadPartnerDocument(
  file: File,
  mode: 'firebase' | 'preview',
  folder: 'partner-docs' | 'pod-docs' = 'partner-docs'
): Promise<{ url: string; fileName: string }> {
  const mime = (file.type || '').toLowerCase();
  const extAllowed = /\.(pdf|jpe?g|png|webp)$/i.test(file.name);
  if (!ALLOWED_PARTNER_DOC_MIMES.has(mime) && !extAllowed) {
    throw new Error('Format file harus PDF, JPG, atau PNG.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error(`Ukuran file "${file.name}" melebihi batas maksimum 5 MB.`);
  }

  if (mode === 'preview') {
    const url = mime.startsWith('image/')
      ? await compressImageToDataUrl(file)
      : URL.createObjectURL(file);
    return { url, fileName: file.name };
  }

  try {
    const storageUrl = await uploadFileToStorage(folder, file);
    return { url: storageUrl, fileName: file.name };
  } catch {
    if (mime.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(file.name)) {
      const compressed = await compressImageToDataUrl(file);
      if (compressed.length <= 280000) {
        return { url: compressed, fileName: file.name };
      }
      throw new Error(`Gambar "${file.name}" terlalu besar untuk disimpan. Perkecil resolusi gambar (< 200 KB).`);
    }
    if (file.size <= 200 * 1024) {
      const dataUrl = await readFileAsDataUrl(file);
      if (dataUrl.length <= 290000) {
        return { url: dataUrl, fileName: file.name };
      }
    }
    throw new Error(
      `Upload file "${file.name}" gagal (Storage tidak tersedia & ukuran PDF > 200 KB). Gunakan file PDF <= 200 KB atau format JPG/PNG.`
    );
  }
}

export async function uploadPodDocument(
  file: File,
  mode: 'firebase' | 'preview'
): Promise<{ url: string; fileName: string }> {
  return uploadPartnerDocument(file, mode, 'pod-docs');
}

export async function ensureAuthenticatedUserProfile(params: {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
}): Promise<UserProfile> {
  const userPath = `users/${params.uid}`;
  const { emailLower, displayName, photoURL } = sanitizeAuthProfileFields({
    email: params.email,
    displayName: params.displayName,
    photoURL: params.photoURL,
  });
  try {
    const refDoc = doc(db, 'users', params.uid);
    const snap = await getDoc(refDoc);
    if (snap.exists()) {
      const profile = convertTimestamps<UserProfile>(snap.data({ serverTimestamps: 'estimate' }));
      const normalizedRole = normalizeUserRole(profile.role);
      if ((profile.role as string) !== normalizedRole) {
        try {
          await updateDoc(refDoc, {
            role: normalizedRole,
            updatedAt: serverTimestamp(),
          });
        } catch (roleUpdateErr) {
          console.warn('[Domestiq Hub] Role normalization update skipped:', roleUpdateErr);
        }
      }
      return {
        ...profile,
        uid: profile.uid || params.uid,
        email: profile.email || emailLower,
        displayName: profile.displayName || displayName,
        active: profile.active !== false,
        role: normalizedRole,
      };
    }

    // Check if Direktur pre-registered this user by email before first Google login
    if (emailLower) {
      let invitedSnap = await getDocs(
        query(collection(db, 'users'), where('email', '==', emailLower))
      );
      if (invitedSnap.empty && params.email.trim() && params.email.trim() !== emailLower) {
        try {
          invitedSnap = await getDocs(
            query(collection(db, 'users'), where('email', '==', params.email.trim()))
          );
        } catch {
          // ignore fallback case lookup errors
        }
      }
      if (!invitedSnap.empty) {
        const preDoc = invitedSnap.docs[0];
        const preData = preDoc.data() as Record<string, unknown>;
        const preRole = normalizeUserRole(preData.role as string);
        const preActive = typeof preData.active === 'boolean' ? preData.active : true;
        const claimedSanitized = sanitizeAuthProfileFields({
          email: emailLower,
          displayName: (preData.displayName as string) || displayName,
          photoURL,
        });
        const profilePayload = {
          uid: params.uid,
          email: emailLower,
          displayName: claimedSanitized.displayName,
          role: preRole,
          department: ((preData.department as string) || 'Umum').slice(0, 80),
          active: preActive,
          photoURL: claimedSanitized.photoURL,
          claimedFromUserId: preDoc.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        await setDoc(refDoc, profilePayload);
        if (preDoc.id !== params.uid) {
          try {
            await deleteDoc(doc(db, 'users', preDoc.id));
          } catch (cleanupErr) {
            console.warn('[Domestiq Hub] Pre-invited user cleanup skipped:', cleanupErr);
          }
        }
        return {
          ...profilePayload,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }
    }

    const isBootstrap = emailLower === 'fakhrariefal@domestiqhub.com';
    const role: UserProfile['role'] = isBootstrap ? 'Direktur' : 'Viewer';
    const profilePayload = {
      uid: params.uid,
      email: emailLower,
      displayName,
      role,
      department: isBootstrap ? 'Direksi & Sistem' : 'Umum',
      active: true,
      photoURL,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(refDoc, profilePayload);
    return {
      ...profilePayload,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function seedFirestoreDatabaseIfNeeded(actorUid: string): Promise<void> {
  try {
    const setRef = doc(db, 'settings', 'company');
    const setSnap = await getDoc(setRef);

    if (setSnap.exists()) {
      if (setSnap.data()?.initialSeedCompleted === true) {
        return;
      }
      await updateDoc(setRef, {
        initialSeedCompleted: true,
        updatedBy: actorUid,
        updatedAt: serverTimestamp(),
      });
      return;
    }

    const empty = createEmptyErpState();
    await setDoc(
      setRef,
      stripUndefined({
        ...empty.settings,
        id: 'company',
        initialSeedCompleted: true,
        updatedBy: actorUid,
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'seed_initial_data');
  }
}

export function subscribeErpCollections(
  onUpdate: (partial: Partial<ErpState>) => void,
  onError: (err: Error) => void,
  options?: { includeUsers?: boolean; currentUserUid?: string }
): Unsubscribe {
  const unsubs: Unsubscribe[] = [];

  const listen = <T>(
    colName: string,
    key: keyof ErpState,
    orderField?: string
  ) => {
    const colRef = collection(db, colName);
    const q = orderField ? query(colRef, orderBy(orderField, 'desc')) : colRef;
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) =>
          convertTimestamps<T>(d.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>)
        );
        onUpdate({ [key]: items } as Partial<ErpState>);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, colName);
        } catch (wrapped) {
          onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    );
    unsubs.push(unsub);
  };

  if (options?.includeUsers) {
    const usersUnsub = onSnapshot(
      collection(db, 'users'),
      (snap) => {
        const items = snap.docs.map((d) => {
          const usr = convertTimestamps<UserProfile>(
            d.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>
          );
          return { ...usr, role: normalizeUserRole(usr.role) };
        });
        onUpdate({ users: items });
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'users');
        } catch (wrapped) {
          onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    );
    unsubs.push(usersUnsub);
  } else if (options?.currentUserUid) {
    const selfUsersQuery = query(
      collection(db, 'users'),
      where('uid', '==', options.currentUserUid)
    );
    const selfUsersUnsub = onSnapshot(
      selfUsersQuery,
      (snap) => {
        const items = snap.docs.map((d) => {
          const usr = convertTimestamps<UserProfile>(
            d.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>
          );
          return { ...usr, role: normalizeUserRole(usr.role) };
        });
        onUpdate({ users: items });
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'users');
        } catch (wrapped) {
          onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    );
    unsubs.push(selfUsersUnsub);
  }
  listen<Supplier>('suppliers', 'suppliers');
  listen<Customer>('customers', 'customers');
  listen<Warehouse>('warehouses', 'warehouses');
  listen<Category>('categories', 'categories');
  listen<Uom>('uoms', 'uoms');
  listen<Product>('products', 'products');
  listen<SalesOrder>('salesOrders', 'salesOrders', 'createdAt');
  listen<SalesQuotation>('salesQuotations', 'salesQuotations', 'createdAt');
  listen<VendorRfq>('vendorRfqs', 'vendorRfqs', 'createdAt');
  listen<GoodsReturn>('goodsReturns', 'goodsReturns', 'createdAt');
  listen<InventoryBatch>('inventoryBatches', 'inventoryBatches', 'createdAt');
  listen<AccountingPeriodLock>('periodClosings', 'periodClosings', 'periodKey');
  listen<MonthlyBudget>('budgets', 'budgets', 'periodKey');
  listen<StockMovement>('stockMovements', 'stockMovements', 'createdAt');
  listen<ChartAccount>('chartOfAccounts', 'chartOfAccounts');
  listen<JournalEntry>('journalEntries', 'journalEntries', 'createdAt');
  listen<AuditLog>('auditLogs', 'auditLogs', 'createdAt');
  const notifUnsub = onSnapshot(
    query(collection(db, 'notifications'), orderBy('createdAt', 'desc')),
    (snap) => {
      const items = snap.docs.map((d) => {
        const n = convertTimestamps<AppNotification>(
          d.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>
        );
        return n.targetRoles
          ? { ...n, targetRoles: n.targetRoles.map((r) => normalizeUserRole(r)) }
          : n;
      });
      onUpdate({ notifications: items });
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'notifications');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
  unsubs.push(notifUnsub);

  const poUnsub = onSnapshot(
    query(collection(db, 'purchaseOrders'), orderBy('createdAt', 'desc')),
    async (snap) => {
      try {
        const pos = await Promise.all(
          snap.docs.map(async (d) => {
            const po = convertTimestamps<PurchaseOrder>(
              d.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>
            );
            const logsSnap = await getDocs(
              query(collection(db, 'purchaseOrders', d.id, 'logs'), orderBy('timestamp', 'asc'))
            );
            po.logs = logsSnap.docs.map((ld) =>
              convertTimestamps<OrderLog>(
                ld.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>
              )
            );
            return po;
          })
        );
        onUpdate({ purchaseOrders: pos });
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.LIST, 'purchaseOrders');
        } catch (wrapped) {
          onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'purchaseOrders');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
  unsubs.push(poUnsub);

  const invUnsub = onSnapshot(
    query(collection(db, 'invoices'), orderBy('createdAt', 'desc')),
    async (snap) => {
      try {
        const invs = await Promise.all(
          snap.docs.map(async (d) => {
            const inv = convertTimestamps<AccountingInvoice>(
              d.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>
            );
            const paySnap = await getDocs(
              query(collection(db, 'invoices', d.id, 'payments'), orderBy('paidAt', 'asc'))
            );
            inv.payments = paySnap.docs.map((pd) =>
              convertTimestamps<InvoicePayment>(
                pd.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>
              )
            );
            return inv;
          })
        );
        onUpdate({ invoices: invs });
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.LIST, 'invoices');
        } catch (wrapped) {
          onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'invoices');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
  unsubs.push(invUnsub);

  const settingsUnsub = onSnapshot(
    doc(db, 'settings', 'company'),
    (snap) => {
      if (snap.exists()) {
        onUpdate({
          settings: convertTimestamps<CompanySettings>(
            snap.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>
          ),
        });
      }
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, 'settings/company');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
  unsubs.push(settingsUnsub);

  return () => {
    unsubs.forEach((u) => u());
  };
}

export async function saveFirestoreDoc(
  colName: string,
  docId: string,
  payload: Record<string, unknown>,
  isNew: boolean
): Promise<void> {
  const path = `${colName}/${docId}`;
  try {
    const refDoc = doc(db, colName, docId);
    if (isNew) {
      await setDoc(
        refDoc,
        stripUndefined({
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    } else {
      const clean = stripUndefined(payload);
      delete clean.id;
      delete clean.createdBy;
      delete clean.createdAt;
      await updateDoc(refDoc, {
        ...clean,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
  }
}

export async function upsertFirestoreDocNoCreatedAt(
  colName: 'periodClosings' | 'budgets',
  docId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const path = `${colName}/${docId}`;
  try {
    const clean = stripUndefined(payload);
    delete clean.createdAt;
    await setDoc(doc(db, colName, docId), {
      ...clean,
      id: docId,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteFirestoreDoc(colName: string, docId: string): Promise<void> {
  const path = `${colName}/${docId}`;
  try {
    await deleteDoc(doc(db, colName, docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function deleteFirestoreDocsInChunks(
  entries: Array<{ col: string; id: string }>,
  chunkSize: number = 10
): Promise<void> {
  try {
    for (let i = 0; i < entries.length; i += chunkSize) {
      const batch = writeBatch(db);
      const slice = entries.slice(i, i + chunkSize);
      for (const entry of slice) {
        batch.delete(doc(db, entry.col, entry.id));
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'batch_delete');
  }
}

export async function deletePurchaseOrdersWithLogs(poIds: string[]): Promise<void> {
  try {
    const refsToDelete: Array<ReturnType<typeof doc>> = [];
    for (const poId of poIds) {
      const logsSnap = await getDocs(collection(db, 'purchaseOrders', poId, 'logs'));
      for (const ld of logsSnap.docs) {
        refsToDelete.push(ld.ref);
      }
      refsToDelete.push(doc(db, 'purchaseOrders', poId));
    }
    for (let i = 0; i < refsToDelete.length; i += 10) {
      const batch = writeBatch(db);
      for (const refDoc of refsToDelete.slice(i, i + 10)) {
        batch.delete(refDoc);
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'purchaseOrders');
  }
}

export async function deleteInvoicesWithPayments(invoiceIds: string[]): Promise<void> {
  try {
    const refsToDelete: Array<ReturnType<typeof doc>> = [];
    for (const invoiceId of invoiceIds) {
      const paySnap = await getDocs(collection(db, 'invoices', invoiceId, 'payments'));
      for (const pd of paySnap.docs) {
        refsToDelete.push(pd.ref);
      }
      refsToDelete.push(doc(db, 'invoices', invoiceId));
    }
    for (let i = 0; i < refsToDelete.length; i += 10) {
      const batch = writeBatch(db);
      for (const refDoc of refsToDelete.slice(i, i + 10)) {
        batch.delete(refDoc);
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'invoices');
  }
}

export async function resetTotalDatabaseInFirestore(
  actorUid: string,
  currentSettings: CompanySettings
): Promise<void> {
  try {
    const poSnap = await getDocs(collection(db, 'purchaseOrders'));
    if (!poSnap.empty) {
      await deletePurchaseOrdersWithLogs(poSnap.docs.map((d) => d.id));
    }

    const invSnap = await getDocs(collection(db, 'invoices'));
    if (!invSnap.empty) {
      await deleteInvoicesWithPayments(invSnap.docs.map((d) => d.id));
    }

    const flatCollections = [
      'salesOrders',
      'salesQuotations',
      'vendorRfqs',
      'goodsReturns',
      'inventoryBatches',
      'periodClosings',
      'budgets',
      'stockMovements',
      'journalEntries',
      'chartOfAccounts',
      'products',
      'suppliers',
      'customers',
      'warehouses',
      'categories',
      'uoms',
      'notifications',
      'auditLogs',
    ];

    const entries: Array<{ col: string; id: string }> = [];
    const snaps = await Promise.all(
      flatCollections.map(async (colName) => ({
        colName,
        snap: await getDocs(collection(db, colName)),
      }))
    );
    for (const { colName, snap } of snaps) {
      for (const d of snap.docs) {
        entries.push({ col: colName, id: d.id });
      }
    }
    if (entries.length > 0) {
      await deleteFirestoreDocsInChunks(entries, 10);
    }

    await setDoc(
      doc(db, 'settings', 'company'),
      stripUndefined({
        ...currentSettings,
        id: 'company',
        initialSeedCompleted: true,
        updatedBy: actorUid,
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'reset_total_database');
  }
}

export async function markSeedCompletedInFirestore(
  actorUid: string,
  companySettings: CompanySettings
): Promise<void> {
  const path = 'settings/company';
  try {
    const refDoc = doc(db, 'settings', 'company');
    const snap = await getDoc(refDoc);
    if (snap.exists()) {
      if (snap.data()?.initialSeedCompleted === true) return;
      await updateDoc(refDoc, {
        initialSeedCompleted: true,
        updatedBy: actorUid,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(
        refDoc,
        stripUndefined({
          ...companySettings,
          id: 'company',
          initialSeedCompleted: true,
          updatedBy: actorUid,
          updatedAt: serverTimestamp(),
        })
      );
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function markNotificationReadInFirestore(
  notifId: string,
  readBy: string[]
): Promise<void> {
  const path = `notifications/${notifId}`;
  try {
    await updateDoc(doc(db, 'notifications', notifId), { readBy });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function appendPoLog(poId: string, log: OrderLog): Promise<void> {
  const path = `purchaseOrders/${poId}/logs/${log.id}`;
  try {
    await setDoc(
      doc(db, 'purchaseOrders', poId, 'logs', log.id),
      stripUndefined({
        ...log,
        timestamp: serverTimestamp(),
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function appendInvoicePayment(
  invoiceId: string,
  payment: InvoicePayment
): Promise<void> {
  const path = `invoices/${invoiceId}/payments/${payment.id}`;
  try {
    await setDoc(
      doc(db, 'invoices', invoiceId, 'payments', payment.id),
      stripUndefined({
        ...payment,
        paidAt: serverTimestamp(),
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function createImmutableRecord(
  colName: 'stockMovements' | 'auditLogs' | 'notifications' | 'categories' | 'uoms',
  docId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const path = `${colName}/${docId}`;
  try {
    await setDoc(
      doc(db, colName, docId),
      stripUndefined({
        ...payload,
        createdAt: serverTimestamp(),
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}
