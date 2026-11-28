import {
  getRedirectResult,
  onAuthStateChanged,
  onIdTokenChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { auth, googleProvider } from '../lib/firebase';
import {
  calculateOrderTotals,
  canTransitionPoStatus,
  canTransitionSoStatus,
  checkSoStockAvailability,
  computeInvoiceStatus,
  computeOpenArForCustomerIdr,
  convertToIdr,
  DEFAULT_MANAGER_APPROVAL_LIMIT_IDR,
  findSeededDummyAccountingTargets,
  findSeededDummyMasterTargets,
  findSeededDummyOrderTargets,
  formatFirebaseAuthErrorMessage,
  getEffectiveTaxRatePercent,
  isBuyerTopScheme,
  shouldFallbackToRedirectAuth,
  isDateInClosedPeriod,
  isEmailRegistered,
  isServiceOrderItem,
  isValidEmailFormat,
  normalizeSupplierCategories,
  normalizeUserEmail,
  pickCashBankAccountId,
  requiresDirectorApproval,
  resolveBuyerTermDays,
  resolveSupplierTermDays,
  sanitizeString,
  splitOrderSubtotalByService,
  validateBalancedJournalLines,
  validateBuyerForSalesOrder,
  validateSupplierForPayment,
  validateSupplierForPurchaseOrder,
} from '../models/erpLogic';
import {
  buildNextSequentialDocNumber,
  computeDueDateFromPaymentTerm,
  computeValidityPeriodLabel,
  ensureMandatoryPoTermsNote,
  getDefaultPoDeliveryLocation,
  getDefaultPoIncoterm,
  getDefaultQuotationTerms,
  getDefaultSalesDeliveryLocation,
  getDefaultSalesIncoterm,
  getDefaultSalesOrderTerms,
  inheritTermsFromQuotation,
  mapCustomerToPaymentTerm,
  mapSupplierToPaymentTerm,
} from '../models/orderTerms';
import { canAccessModule, hasPermission } from '../models/rbac';
import { createEmptyErpState, createInitialSeedState } from '../models/seedData';
import {
  BLUEPRINT_CONSTRAINTS,
  type AccountCategory,
  type AccountingInvoice,
  type AccountingPeriodLock,
  type AppModule,
  type AuditLog,
  type Category,
  type ChartAccount,
  type CompanySettings,
  type CurrencyCode,
  type Customer,
  type CustomerPriceTier,
  type ErpState,
  type GoodsReturn,
  type GoodsReturnItem,
  type GoodsReturnType,
  type InventoryBatch,
  type InventoryBatchStatus,
  type JournalEntry,
  type JournalEntryType,
  type JournalLine,
  type MonthlyBudget,
  type NormalBalance,
  type OrderItem,
  type PartnerVerificationStatus,
  type PoStatus,
  type Product,
  type PurchaseOrder,
  type QuotationStatus,
  type SalesOrder,
  type SalesQuotation,
  type SoStatus,
  type StockMovement,
  type Supplier,
  type Uom,
  type UserProfile,
  type UserRole,
  type VendorRfq,
  type VendorRfqQuote,
  type Warehouse,
} from '../models/types';
import {
  appendInvoicePayment,
  appendPoLog,
  createImmutableRecord,
  deleteFirestoreDoc,
  deleteFirestoreDocsInChunks,
  deleteInvoicesWithPayments,
  deletePurchaseOrdersWithLogs,
  ensureAuthenticatedUserProfile,
  markNotificationReadInFirestore,
  markSeedCompletedInFirestore,
  resetTotalDatabaseInFirestore,
  saveFirestoreDoc,
  seedFirestoreDatabaseIfNeeded,
  subscribeErpCollections,
  uploadFileToStorage,
  uploadPartnerDocument,
  uploadPodDocument,
  upsertFirestoreDocNoCreatedAt,
} from '../services/firestoreService';

export type AuthMode = 'loading' | 'unauthenticated' | 'firebase' | 'preview';

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function useErpController() {
  const [authMode, setAuthMode] = useState<AuthMode>('loading');
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [activeModule, setActiveModule] = useState<AppModule>('dashboard');
  const [state, setState] = useState<ErpState>(() => createEmptyErpState());
  const [firestoreError, setFirestoreError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const authModeRef = useRef<AuthMode>('loading');
  const hydratingSessionRef = useRef<{ uid: string; promise: Promise<boolean> } | null>(null);

  useEffect(() => {
    authModeRef.current = authMode;
  }, [authMode]);

  const REDIRECT_PENDING_KEY = 'domestiq_google_redirect_pending';

  const clearRedirectPendingFlag = () => {
    try {
      window.sessionStorage.removeItem(REDIRECT_PENDING_KEY);
    } catch {
      // ignore storage restrictions
    }
  };

  const isEmbeddedIframe = (): boolean => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  };

  const hydrateFirebaseSession = useCallback(async (user: FirebaseUser): Promise<boolean> => {
    if (hydratingSessionRef.current?.uid === user.uid) {
      return hydratingSessionRef.current.promise;
    }

    const run = (async (): Promise<boolean> => {
      setFirebaseUser(user);
      setAuthMode((prev) => (prev === 'preview' ? 'preview' : 'loading'));
      try {
        const resolvedEmail =
          user.email || user.providerData?.find((p) => p?.email)?.email || '';
        if (!resolvedEmail.trim()) {
          await signOut(auth);
          setCurrentUser(null);
          setFirebaseUser(null);
          setFirestoreError(
            'Email akun Google tidak terbaca dari sesi otentikasi. Silakan masuk ulang menggunakan akun Google utama.'
          );
          setAuthMode('unauthenticated');
          return false;
        }

        const withTimeout = async <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
          let timer: number | undefined;
          try {
            return await Promise.race([
              promise,
              new Promise<T>((_, reject) => {
                timer = window.setTimeout(() => {
                  reject(new Error(`${label} timeout setelah ${ms / 1000}s. Periksa koneksi / Firestore database ID / rules.`));
                }, ms);
              }),
            ]);
          } finally {
            if (timer !== undefined) window.clearTimeout(timer);
          }
        };

        const loadProfileWithRetry = async () => {
          try {
            await user.getIdToken();
            return await withTimeout(
              ensureAuthenticatedUserProfile({
                uid: user.uid,
                email: resolvedEmail,
                displayName: user.displayName || 'User Domestiq',
                photoURL: user.photoURL || '',
              }),
              12000,
              'Memuat profil Firestore'
            );
          } catch (firstErr) {
            await new Promise((resolve) => window.setTimeout(resolve, 600));
            try {
              await user.getIdToken(true);
            } catch {
              // continue retry attempt even if forced refresh fails
            }
            return await withTimeout(
              ensureAuthenticatedUserProfile({
                uid: user.uid,
                email: resolvedEmail,
                displayName: user.displayName || 'User Domestiq',
                photoURL: user.photoURL || '',
              }),
              12000,
              'Memuat profil Firestore (retry)'
            ).catch(() => {
              throw firstErr;
            });
          }
        };

        const profile = await loadProfileWithRetry();
        if (!profile.active) {
          await signOut(auth);
          setCurrentUser(null);
          setFirebaseUser(null);
          setFirestoreError('Akun Anda saat ini nonaktif. Hubungi Direktur PT Domestiq Hub Indonesia.');
          setAuthMode('unauthenticated');
          return false;
        }
        clearRedirectPendingFlag();
        setFirestoreError(null);
        setCurrentUser(profile);
        setAuthMode('firebase');
        setAuthBusy(false);
        if (profile.role === 'Direktur') {
          void seedFirestoreDatabaseIfNeeded(user.uid).catch((seedErr) => {
            console.warn('[Domestiq Hub] Background Firestore seed warning:', seedErr);
          });
        }
        return true;
      } catch (err) {
        const friendly = formatFirebaseAuthErrorMessage(err);
        setFirestoreError(friendly);
        setCurrentUser(null);
        setAuthMode('unauthenticated');
        return false;
      } finally {
        if (hydratingSessionRef.current?.uid === user.uid) {
          hydratingSessionRef.current = null;
        }
      }
    })();

    hydratingSessionRef.current = { uid: user.uid, promise: run };
    return run;
  }, []);

  // Check ?autostart=1 for automated preview verification & handle Firebase Auth boot + mobile redirect recovery
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      const seed = createInitialSeedState();
      setState(seed);
      setCurrentUser(seed.users[0]);
      setAuthMode('preview');
      return;
    }

    let cancelled = false;
    let redirectCheckSettled = false;
    let resumePollTimer: number | null = null;

    const bootTimeoutId = window.setTimeout(() => {
      if (cancelled) return;
      if (authModeRef.current === 'loading') {
        console.warn('[Domestiq Hub] Auth boot timeout — forcing login screen');
        redirectCheckSettled = true;
        setAuthBusy(false);
        setFirebaseUser(null);
        setCurrentUser(null);
        setAuthMode('unauthenticated');
        setFirestoreError(
          'Sesi otentikasi/profil memakan waktu terlalu lama. Kemungkinan: domain Auth, Firestore database ID, atau rules users. Coba login ulang atau mode demo.'
        );
      }
    }, 15000);

    const handleAuthUser = async (user: FirebaseUser | null) => {
      if (cancelled || authModeRef.current === 'preview') {
        return;
      }
      if (!user) {
        if (!redirectCheckSettled) {
          return;
        }
        setFirebaseUser(null);
        setCurrentUser(null);
        setAuthMode('unauthenticated');
        return;
      }
      await hydrateFirebaseSession(user);
    };

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      void handleAuthUser(user);
    });

    const unsubToken = onIdTokenChanged(auth, (user) => {
      if (user && authModeRef.current !== 'firebase' && authModeRef.current !== 'preview') {
        void handleAuthUser(user);
      }
    });

    const checkBootAuth = async () => {
      try {
        const redirectResult = await getRedirectResult(auth);
        if (cancelled || authModeRef.current === 'preview') return;
        if (redirectResult?.user) {
          redirectCheckSettled = true;
          const ok = await hydrateFirebaseSession(redirectResult.user);
          if (ok) {
            toast.success('Berhasil masuk dengan akun Google.');
          }
          return;
        }
      } catch (err) {
        if (!cancelled) {
          clearRedirectPendingFlag();
          setFirestoreError(formatFirebaseAuthErrorMessage(err));
        }
      }

      try {
        await auth.authStateReady();
      } catch {
        // ignore authStateReady errors and inspect auth.currentUser directly
      }

      if (cancelled || authModeRef.current === 'preview') return;
      redirectCheckSettled = true;

      if (auth.currentUser) {
        await hydrateFirebaseSession(auth.currentUser);
        return;
      }

      let hadPendingRedirect = false;
      try {
        hadPendingRedirect = window.sessionStorage.getItem(REDIRECT_PENDING_KEY) === '1';
      } catch {
        hadPendingRedirect = false;
      }
      if (hadPendingRedirect) {
        clearRedirectPendingFlag();
        setFirestoreError(
          'Browser mobile membatasi pengembalian sesi redirect Google (privasi/cookie lintas situs). Silakan coba "Masuk dengan Google" (popup) atau buka portal langsung di tab browser Chrome/Safari utama.'
        );
      }
      setFirebaseUser(null);
      setCurrentUser(null);
      setAuthMode('unauthenticated');
    };

    void checkBootAuth();

    const probeAuthSession = async (): Promise<boolean> => {
      if (cancelled || authModeRef.current === 'preview' || authModeRef.current === 'firebase') {
        return true;
      }
      try {
        await auth.authStateReady();
        const candidate = auth.currentUser || (await getRedirectResult(auth))?.user || null;
        if (candidate && !cancelled) {
          const ok = await hydrateFirebaseSession(candidate);
          if (ok) {
            toast.success('Berhasil masuk dengan akun Google.');
          }
          setAuthBusy(false);
          return true;
        }
      } catch {
        // ignore transient resume checks
      }
      return false;
    };

    const syncSessionOnResume = () => {
      if (cancelled || authModeRef.current === 'preview' || authModeRef.current === 'firebase') {
        return;
      }
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      if (resumePollTimer !== null) {
        window.clearInterval(resumePollTimer);
        resumePollTimer = null;
      }
      let attempts = 0;
      const runProbe = async () => {
        attempts += 1;
        const found = await probeAuthSession();
        if (found || attempts >= 12 || cancelled || authModeRef.current === 'firebase') {
          if (resumePollTimer !== null) {
            window.clearInterval(resumePollTimer);
            resumePollTimer = null;
          }
          if (!found && !cancelled && authModeRef.current === 'unauthenticated' && !auth.currentUser) {
            setAuthBusy(false);
          }
        }
      };
      void runProbe();
      resumePollTimer = window.setInterval(() => {
        void runProbe();
      }, 400);
    };

    const handleStorageSync = (ev: StorageEvent) => {
      if (!ev.key || ev.key.includes('firebase:authUser')) {
        void probeAuthSession();
      }
    };

    window.addEventListener('focus', syncSessionOnResume);
    window.addEventListener('pageshow', syncSessionOnResume);
    window.addEventListener('storage', handleStorageSync);
    document.addEventListener('visibilitychange', syncSessionOnResume);

    return () => {
      cancelled = true;
      window.clearTimeout(bootTimeoutId);
      if (resumePollTimer !== null) {
        window.clearInterval(resumePollTimer);
      }
      unsubAuth();
      unsubToken();
      window.removeEventListener('focus', syncSessionOnResume);
      window.removeEventListener('pageshow', syncSessionOnResume);
      window.removeEventListener('storage', handleStorageSync);
      document.removeEventListener('visibilitychange', syncSessionOnResume);
    };
  }, [hydrateFirebaseSession]);

  useEffect(() => {
    if (authMode !== 'firebase' || !firebaseUser || !currentUser) return;
    setState(createEmptyErpState());
    const includeUsers =
      currentUser.role === 'Direktur' || currentUser.role === 'Manager';
    const unsub = subscribeErpCollections(
      (partial) => {
        setState((prev) => ({
          ...prev,
          ...partial,
        }));
      },
      (err) => {
        setFirestoreError(formatFirebaseAuthErrorMessage(err));
        toast.error('Terjadi gangguan izin atau koneksi Firestore.');
      },
      { includeUsers, currentUserUid: firebaseUser.uid }
    );
    return () => unsub();
  }, [authMode, currentUser, firebaseUser]);

  const loginWithGoogleRedirect = useCallback(async () => {
    if (isEmbeddedIframe()) {
      const msg =
        'Portal sedang berjalan di dalam frame pratinjau sehingga Google memblokir redirect. Ketuk "Buka di Tab Browser Penuh" di bawah lalu masuk ulang.';
      setFirestoreError(msg);
      toast.error(msg);
      return;
    }
    setAuthBusy(true);
    setFirestoreError(null);
    try {
      try {
        window.sessionStorage.setItem(REDIRECT_PENDING_KEY, '1');
      } catch {
        // ignore storage errors
      }
      await signInWithRedirect(auth, googleProvider);
    } catch (err) {
      clearRedirectPendingFlag();
      const msg = formatFirebaseAuthErrorMessage(err);
      setFirestoreError(msg);
      toast.error(msg);
      setAuthBusy(false);
    }
  }, []);

  const loginWithGoogle = useCallback(async () => {
    setAuthBusy(true);
    setFirestoreError(null);
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      const signedUser = credential.user || auth.currentUser;
      if (!signedUser) {
        throw new Error('Sesi Google tidak ditemukan setelah otentikasi.');
      }
      const hydrated = await hydrateFirebaseSession(signedUser);
      if (hydrated) {
        toast.success('Berhasil masuk dengan akun Google.');
      } else {
        toast.error('Akun Google terautentikasi, namun profil Firestore gagal dimuat. Periksa pesan di halaman login.');
      }
    } catch (err) {
      if (shouldFallbackToRedirectAuth(err, isEmbeddedIframe())) {
        try {
          try {
            window.sessionStorage.setItem(REDIRECT_PENDING_KEY, '1');
          } catch {
            // ignore storage errors
          }
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectErr) {
          clearRedirectPendingFlag();
          const rMsg = formatFirebaseAuthErrorMessage(redirectErr);
          setFirestoreError(rMsg);
          toast.error(rMsg);
          return;
        }
      }
      const msg = formatFirebaseAuthErrorMessage(err);
      setFirestoreError(msg);
      toast.error(msg);
    } finally {
      setAuthBusy(false);
    }
  }, [hydrateFirebaseSession]);

  const enterPreviewMode = useCallback((role: UserRole = 'Direktur') => {
    const seed = createInitialSeedState();
    const matched = seed.users.find((u) => u.role === role) || seed.users[0];
    setState(seed);
    setCurrentUser(matched);
    setAuthMode('preview');
    toast.success(`Masuk dalam Mode Preview sebagai ${matched.role}`);
  }, []);

  const switchPreviewRole = useCallback(
    (role: UserRole) => {
      if (authMode !== 'preview') return;
      const matched = state.users.find((u) => u.role === role);
      if (matched) {
        setCurrentUser(matched);
        toast.info(`Role aktif diganti ke ${role}`);
      }
    },
    [authMode, state.users]
  );

  const selectActiveModule = useCallback(
    (mod: AppModule) => {
      if (currentUser && !canAccessModule(currentUser.role, mod)) {
        setActiveModule('dashboard');
        return;
      }
      setActiveModule(mod);
    },
    [currentUser]
  );

  useEffect(() => {
    if (currentUser && !canAccessModule(currentUser.role, activeModule)) {
      setActiveModule('dashboard');
    }
  }, [currentUser, activeModule]);

  const logout = useCallback(async () => {
    if (authMode === 'firebase') {
      await signOut(auth);
    }
    setCurrentUser(null);
    setFirebaseUser(null);
    setState(createEmptyErpState());
    setAuthMode('unauthenticated');
    setActiveModule('dashboard');
  }, [authMode]);

  const recordAudit = useCallback(
    async (
      module: string,
      action: string,
      targetId?: string,
      targetLabel?: string,
      details?: string
    ) => {
      if (!currentUser) return;
      const entry: AuditLog = {
        id: makeId('aud'),
        module: sanitizeString(module, 48),
        action: sanitizeString(action, 120),
        targetId,
        targetLabel: targetLabel ? sanitizeString(targetLabel, 160) : undefined,
        actorId: currentUser.uid,
        actorEmail: currentUser.email,
        actorRole: currentUser.role,
        details: details ? sanitizeString(details, 500) : undefined,
        createdAt: new Date().toISOString(),
      };
      setState((prev) => ({
        ...prev,
        auditLogs: [entry, ...prev.auditLogs],
      }));
      if (authMode === 'firebase') {
        await createImmutableRecord('auditLogs', entry.id, { ...entry });
      }
    },
    [authMode, currentUser]
  );

  const ensureSeedLockedInFirebase = useCallback(async () => {
    if (!currentUser || state.settings.initialSeedCompleted) return;
    setState((prev) => ({
      ...prev,
      settings: { ...prev.settings, initialSeedCompleted: true },
    }));
    if (authMode === 'firebase') {
      await markSeedCompletedInFirestore(currentUser.uid, state.settings);
    }
  }, [authMode, currentUser, state.settings]);

  const buildResolvedJournalEntry = useCallback(
    (params: {
      entryDate: string;
      journalType: JournalEntryType;
      referenceType?: string;
      referenceId?: string;
      referenceNumber?: string;
      description: string;
      rawLines: Array<{
        preferredAccountId: string;
        fallbackCode: string;
        fallbackName: string;
        debitIdr: number;
        creditIdr: number;
        memo?: string;
      }>;
      sequenceOffset?: number;
    }): JournalEntry | null => {
      if (!currentUser) return null;
      const resolvedLines: JournalLine[] = params.rawLines
        .filter((l) => Math.round(l.debitIdr) > 0 || Math.round(l.creditIdr) > 0)
        .map((l) => {
          const matched =
            state.chartOfAccounts.find((a) => a.id === l.preferredAccountId) ||
            state.chartOfAccounts.find((a) => a.code === l.fallbackCode);
          const cleanMemo = l.memo ? sanitizeString(l.memo, 160) : '';
          return {
            accountId: matched?.id || l.preferredAccountId,
            accountCode: matched?.code || l.fallbackCode,
            accountName: matched?.name || l.fallbackName,
            debitIdr: Math.max(0, Math.round(l.debitIdr)),
            creditIdr: Math.max(0, Math.round(l.creditIdr)),
            ...(cleanMemo ? { memo: cleanMemo } : {}),
          };
        });

      const validation = validateBalancedJournalLines(resolvedLines);
      if (!validation.valid) return null;

      const now = new Date().toISOString();
      const seqNum = state.journalEntries.length + 1 + (params.sequenceOffset || 0);
      return {
        id: makeId('jrn'),
        entryNumber: `JRN-${(params.entryDate || '').slice(0, 4) || '2026'}-${String(seqNum).padStart(4, '0')}`,
        entryDate: params.entryDate,
        journalType: params.journalType,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        referenceNumber: params.referenceNumber,
        description: sanitizeString(params.description, 400),
        lines: resolvedLines,
        totalDebitIdr: validation.totalDebitIdr,
        totalCreditIdr: validation.totalCreditIdr,
        status: 'Posted',
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName,
        createdAt: now,
        updatedAt: now,
      };
    },
    [currentUser, state.chartOfAccounts, state.journalEntries.length]
  );

  // =========================================================================
  // Master Data Actions
  // =========================================================================
  const saveSupplier = useCallback(
    async (
      input: Omit<Supplier, 'createdBy' | 'createdAt' | 'updatedAt'> & {
        isNew: boolean;
        nibFile?: File | null;
        npwpFile?: File | null;
        ktpDirectorFile?: File | null;
      }
    ): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'supplier:write')) {
        toast.error('Akses ditolak: Role Anda tidak memiliki izin mendaftarkan atau mengubah Supplier.');
        return false;
      }
      const cleanCode = sanitizeString(input.code, 32);
      const cleanName = sanitizeString(input.name, BLUEPRINT_CONSTRAINTS.NAME_MAX_LENGTH);
      if (cleanCode.length < 2 || cleanName.length < 2) {
        toast.error('Kode dan Nama Perusahaan Supplier wajib diisi minimal 2 karakter.');
        return false;
      }

      const now = new Date().toISOString();
      const existing = state.suppliers.find((s) => s.id === input.id);
      const isAdmin = hasPermission(currentUser.role, 'partner:approve');
      const uploadMode = authMode === 'firebase' ? 'firebase' : 'preview';

      let nibDocUrl = input.nibDocUrl ?? existing?.nibDocUrl;
      let nibFileName = input.nibFileName ?? existing?.nibFileName;
      let npwpDocUrl = input.npwpDocUrl ?? existing?.npwpDocUrl;
      let npwpFileName = input.npwpFileName ?? existing?.npwpFileName;
      let ktpDirectorDocUrl = input.ktpDirectorDocUrl ?? existing?.ktpDirectorDocUrl;
      let ktpDirectorFileName = input.ktpDirectorFileName ?? existing?.ktpDirectorFileName;

      try {
        if (input.nibFile) {
          const uploaded = await uploadPartnerDocument(input.nibFile, uploadMode);
          nibDocUrl = uploaded.url;
          nibFileName = uploaded.fileName;
        }
        if (input.npwpFile) {
          const uploaded = await uploadPartnerDocument(input.npwpFile, uploadMode);
          npwpDocUrl = uploaded.url;
          npwpFileName = uploaded.fileName;
        }
        if (input.ktpDirectorFile) {
          const uploaded = await uploadPartnerDocument(input.ktpDirectorFile, uploadMode);
          ktpDirectorDocUrl = uploaded.url;
          ktpDirectorFileName = uploaded.fileName;
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Gagal mengunggah dokumen supplier.');
        return false;
      }

      const paymentScheme = input.paymentScheme || existing?.paymentScheme || 'TOP';
      const paymentTermDays = resolveSupplierTermDays(paymentScheme, input.paymentTermDays);
      const nextStatus: PartnerVerificationStatus = isAdmin
        ? input.verificationStatus || existing?.verificationStatus || 'Verified'
        : input.isNew
          ? 'Pending'
          : existing?.verificationStatus || 'Pending';

      const supplierId = input.id || makeId('sup');
      const availableCategories = normalizeSupplierCategories(state.settings.supplierCategories);
      const supplier: Supplier = {
        id: supplierId,
        code: cleanCode,
        name: cleanName,
        vendorCategory: input.vendorCategory || existing?.vendorCategory || availableCategories[0] || 'Safety/MRO',
        nib: sanitizeString(input.nib, 40),
        npwp: sanitizeString(input.npwp, 32),
        taxStatus: input.taxStatus || existing?.taxStatus || 'PKP',
        address: sanitizeString(input.address, BLUEPRINT_CONSTRAINTS.ADDRESS_MAX_LENGTH),
        contactPerson: sanitizeString(input.contactPerson, 120),
        phone: sanitizeString(input.phone, 40),
        email: sanitizeString(input.email, 254),
        bankName: sanitizeString(input.bankName, 80),
        bankAccount: sanitizeString(input.bankAccount, 64),
        paymentScheme,
        paymentTermDays,
        defaultCurrency: input.defaultCurrency,
        ...(nibDocUrl ? { nibDocUrl, nibFileName: sanitizeString(nibFileName, 160) } : {}),
        ...(npwpDocUrl ? { npwpDocUrl, npwpFileName: sanitizeString(npwpFileName, 160) } : {}),
        ...(ktpDirectorDocUrl
          ? { ktpDirectorDocUrl, ktpDirectorFileName: sanitizeString(ktpDirectorFileName, 160) }
          : {}),
        verificationStatus: nextStatus,
        ...(isAdmin && nextStatus === 'Verified'
          ? {
              verifiedBy: existing?.verifiedBy || currentUser.uid,
              verifiedAt: existing?.verifiedAt || now,
            }
          : isAdmin && existing?.verifiedBy
            ? { verifiedBy: existing.verifiedBy, verifiedAt: existing.verifiedAt }
            : {}),
        active: nextStatus !== 'Blacklisted' && input.active,
        createdBy: existing?.createdBy || currentUser.uid,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };

      setState((prev) => ({
        ...prev,
        suppliers: input.isNew
          ? [supplier, ...prev.suppliers]
          : prev.suppliers.map((s) => (s.id === supplier.id ? { ...s, ...supplier, createdAt: s.createdAt } : s)),
      }));

      if (authMode === 'firebase') {
        const firestorePayload: Record<string, unknown> = { ...supplier };
        if (!isAdmin && !input.isNew) {
          delete firestorePayload.verificationStatus;
          delete firestorePayload.verifiedBy;
          delete firestorePayload.verifiedAt;
        }
        await saveFirestoreDoc('suppliers', supplier.id, firestorePayload, input.isNew);
      }
      await recordAudit(
        'Master Data',
        input.isNew ? 'Registrasi Supplier' : 'Update Supplier',
        supplier.id,
        supplier.name,
        `Kategori: ${supplier.vendorCategory || '-'}, Status: ${supplier.verificationStatus}`
      );
      toast.success(
        isAdmin
          ? `Supplier ${supplier.name} tersimpan (${supplier.verificationStatus}).`
          : `Supplier ${supplier.name} tersimpan dengan status Pending. Menunggu Approve Admin.`
      );
      return true;
    },
    [authMode, currentUser, recordAudit, state.settings.supplierCategories, state.suppliers]
  );

  const saveSupplierCategories = useCallback(
    async (
      nextCategories: string[],
      renameMap?: { from: string; to: string }
    ): Promise<boolean> => {
      if (
        !currentUser ||
        (!hasPermission(currentUser.role, 'master:write') &&
          !hasPermission(currentUser.role, 'supplier:write') &&
          !hasPermission(currentUser.role, 'system:settings'))
      ) {
        toast.error('Akses ditolak untuk mengubah Kategori Supplier.');
        return false;
      }
      const cleaned = nextCategories
        .map((c) => sanitizeString(c, 60).trim())
        .filter((c) => c.length >= 1);
      const deduped: string[] = [];
      const seen = new Set<string>();
      for (const c of cleaned) {
        const k = c.toLowerCase();
        if (!seen.has(k)) {
          seen.add(k);
          deduped.push(c);
        }
      }
      if (deduped.length === 0) {
        toast.error('Minimal harus tersisa 1 Kategori Supplier.');
        return false;
      }
      if (deduped.length > 50) {
        toast.error('Maksimal 50 Kategori Supplier.');
        return false;
      }

      const now = new Date().toISOString();
      const prevSettings = state.settings;
      const prevSuppliers = state.suppliers;
      const updatedSettings: CompanySettings = {
        ...state.settings,
        id: 'company',
        supplierCategories: deduped,
        updatedBy: currentUser.uid,
        updatedAt: now,
      };
      const affectedSuppliers =
        renameMap?.from && renameMap?.to && renameMap.from !== renameMap.to
          ? state.suppliers.filter((s) => (s.vendorCategory || '') === renameMap.from)
          : [];
      const nextSuppliers =
        affectedSuppliers.length > 0
          ? state.suppliers.map((s) =>
              (s.vendorCategory || '') === renameMap!.from
                ? { ...s, vendorCategory: renameMap!.to, updatedAt: now }
                : s
            )
          : state.suppliers;

      setState((prev) => ({
        ...prev,
        settings: updatedSettings,
        suppliers: nextSuppliers,
      }));
      try {
        if (authMode === 'firebase') {
          await saveFirestoreDoc(
            'settings',
            'company',
            { supplierCategories: deduped, updatedBy: currentUser.uid },
            false
          );
          for (const sup of affectedSuppliers) {
            await saveFirestoreDoc(
              'suppliers',
              sup.id,
              { vendorCategory: renameMap!.to },
              false
            );
          }
        }
        await recordAudit(
          'Master Data',
          renameMap
            ? `Ubah Kategori Supplier (${renameMap.from} -> ${renameMap.to})`
            : 'Update Kategori Supplier',
          'company',
          'Kategori Supplier',
          `${deduped.length} kategori aktif`
        );
        toast.success('Kategori Supplier diperbarui.');
        return true;
      } catch (err) {
        setState((prev) => ({ ...prev, settings: prevSettings, suppliers: prevSuppliers }));
        toast.error(err instanceof Error ? err.message : 'Gagal menyimpan Kategori Supplier.');
        return false;
      }
    },
    [authMode, currentUser, recordAudit, state.settings, state.suppliers]
  );

  const verifySupplier = useCallback(
    async (supplierId: string, status: PartnerVerificationStatus): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'partner:approve')) {
        toast.error('Hanya Admin (Direktur) yang berhak melakukan Approve / Blacklist Supplier.');
        return false;
      }
      const target = state.suppliers.find((s) => s.id === supplierId);
      if (!target) return false;
      const now = new Date().toISOString();
      const active = status !== 'Blacklisted';
      setState((prev) => ({
        ...prev,
        suppliers: prev.suppliers.map((s) =>
          s.id === supplierId
            ? {
                ...s,
                verificationStatus: status,
                verifiedBy: currentUser.uid,
                verifiedAt: now,
                active,
                updatedAt: now,
              }
            : s
        ),
      }));
      if (authMode === 'firebase') {
        await saveFirestoreDoc(
          'suppliers',
          supplierId,
          {
            verificationStatus: status,
            verifiedBy: currentUser.uid,
            verifiedAt: now,
            active,
          },
          false
        );
      }
      await recordAudit('Master Data', `Verifikasi Supplier -> ${status}`, supplierId, target.name);
      toast.success(`Status Supplier ${target.name} diperbarui menjadi ${status}.`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.suppliers]
  );

  const saveCustomer = useCallback(
    async (
      input: Omit<Customer, 'createdBy' | 'createdAt' | 'updatedAt'> & {
        isNew: boolean;
        nibFile?: File | null;
        npwpFile?: File | null;
      }
    ): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'buyer:write')) {
        toast.error('Akses ditolak: Role Anda tidak memiliki izin mendaftarkan atau mengubah Buyer.');
        return false;
      }
      const cleanCode = sanitizeString(input.code, 32);
      const cleanName = sanitizeString(input.name, BLUEPRINT_CONSTRAINTS.NAME_MAX_LENGTH);
      if (cleanCode.length < 2 || cleanName.length < 2) {
        toast.error('Kode dan Nama Perusahaan Buyer wajib diisi minimal 2 karakter.');
        return false;
      }

      const now = new Date().toISOString();
      const existing = state.customers.find((c) => c.id === input.id);
      const isAdmin = hasPermission(currentUser.role, 'partner:approve');
      const uploadMode = authMode === 'firebase' ? 'firebase' : 'preview';

      let nibDocUrl = input.nibDocUrl ?? existing?.nibDocUrl;
      let nibFileName = input.nibFileName ?? existing?.nibFileName;
      let npwpDocUrl = input.npwpDocUrl ?? existing?.npwpDocUrl;
      let npwpFileName = input.npwpFileName ?? existing?.npwpFileName;

      try {
        if (input.nibFile) {
          const uploaded = await uploadPartnerDocument(input.nibFile, uploadMode);
          nibDocUrl = uploaded.url;
          nibFileName = uploaded.fileName;
        }
        if (input.npwpFile) {
          const uploaded = await uploadPartnerDocument(input.npwpFile, uploadMode);
          npwpDocUrl = uploaded.url;
          npwpFileName = uploaded.fileName;
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Gagal mengunggah dokumen Buyer.');
        return false;
      }

      const paymentScheme = input.paymentScheme || existing?.paymentScheme || 'CBD';
      const paymentTermDays = resolveBuyerTermDays(paymentScheme);
      const cleanNib = sanitizeString(input.nib, 40);
      const cleanNpwp = sanitizeString(input.npwp, 32);

      if (isBuyerTopScheme({ paymentScheme, paymentTermDays })) {
        if (cleanNib.length < 3 || cleanNpwp.length < 3) {
          toast.error('Untuk skema TOP (tempo), nomor NIB dan NPWP Buyer wajib diisi.');
          return false;
        }
      }

      const billingAddr = sanitizeString(input.billingAddress || input.address, BLUEPRINT_CONSTRAINTS.ADDRESS_MAX_LENGTH);
      const shippingAddr = sanitizeString(input.shippingAddress || billingAddr, BLUEPRINT_CONSTRAINTS.ADDRESS_MAX_LENGTH);
      const picPurchasingName = sanitizeString(input.picPurchasingName || input.contactPerson, 120);
      const picPurchasingPhone = sanitizeString(input.picPurchasingPhone || input.phone, 40);

      const nextStatus: PartnerVerificationStatus = isAdmin
        ? input.verificationStatus || existing?.verificationStatus || 'Verified'
        : input.isNew
          ? 'Pending'
          : existing?.verificationStatus || 'Pending';

      const nextCreditLimit = isAdmin
        ? Math.max(0, Number(input.creditLimit) || 0)
        : input.isNew
          ? 0
          : existing?.creditLimit ?? 0;

      const customerId = input.id || makeId('cus');
      const customer: Customer = {
        id: customerId,
        code: cleanCode,
        name: cleanName,
        nib: cleanNib,
        npwp: cleanNpwp,
        taxStatus: input.taxStatus || existing?.taxStatus || 'PKP',
        address: billingAddr,
        billingAddress: billingAddr,
        shippingAddress: shippingAddr,
        contactPerson: picPurchasingName,
        phone: picPurchasingPhone,
        email: sanitizeString(input.email, 254),
        picPurchasingName,
        picPurchasingPhone,
        picWarehouseName: sanitizeString(input.picWarehouseName, 120),
        picWarehousePhone: sanitizeString(input.picWarehousePhone, 40),
        picFinanceName: sanitizeString(input.picFinanceName, 120),
        picFinancePhone: sanitizeString(input.picFinancePhone, 40),
        paymentScheme,
        creditLimit: nextCreditLimit,
        paymentTermDays,
        ...(nibDocUrl ? { nibDocUrl, nibFileName: sanitizeString(nibFileName, 160) } : {}),
        ...(npwpDocUrl ? { npwpDocUrl, npwpFileName: sanitizeString(npwpFileName, 160) } : {}),
        verificationStatus: nextStatus,
        ...(isAdmin && nextStatus === 'Verified'
          ? {
              verifiedBy: existing?.verifiedBy || currentUser.uid,
              verifiedAt: existing?.verifiedAt || now,
            }
          : isAdmin && existing?.verifiedBy
            ? { verifiedBy: existing.verifiedBy, verifiedAt: existing.verifiedAt }
            : {}),
        active: nextStatus !== 'Blacklisted' && input.active,
        createdBy: existing?.createdBy || currentUser.uid,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };

      setState((prev) => ({
        ...prev,
        customers: input.isNew
          ? [customer, ...prev.customers]
          : prev.customers.map((c) => (c.id === customer.id ? { ...c, ...customer, createdAt: c.createdAt } : c)),
      }));

      if (authMode === 'firebase') {
        const firestorePayload: Record<string, unknown> = { ...customer };
        if (!isAdmin && !input.isNew) {
          delete firestorePayload.creditLimit;
          delete firestorePayload.verificationStatus;
          delete firestorePayload.verifiedBy;
          delete firestorePayload.verifiedAt;
        }
        await saveFirestoreDoc('customers', customer.id, firestorePayload, input.isNew);
      }

      await recordAudit(
        'Master Data',
        input.isNew ? 'Registrasi Buyer' : 'Update Buyer',
        customer.id,
        customer.name,
        `Skema: ${paymentScheme}, Status: ${customer.verificationStatus}, Limit: ${customer.creditLimit}`
      );
      toast.success(
        isAdmin
          ? `Buyer ${customer.name} tersimpan (${customer.verificationStatus}).`
          : `Buyer ${customer.name} tersimpan (Status: Pending). Credit Limit menunggu persetujuan Admin.`
      );
      return true;
    },
    [authMode, currentUser, recordAudit, state.customers]
  );

  const approveBuyerWithCreditLimit = useCallback(
    async (
      customerId: string,
      input: { verificationStatus: PartnerVerificationStatus; creditLimit: number }
    ): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'partner:approve')) {
        toast.error('Hanya Admin (Direktur) yang berhak menyetujui Buyer dan menetapkan Credit Limit.');
        return false;
      }
      const target = state.customers.find((c) => c.id === customerId);
      if (!target) return false;
      const limit = Math.max(0, Math.round(Number(input.creditLimit) || 0));
      if (input.verificationStatus === 'Verified' && isBuyerTopScheme(target) && limit <= 0) {
        toast.error('Buyer skema TOP wajib memiliki Credit Limit > Rp 0 saat di-Approve.');
        return false;
      }
      const now = new Date().toISOString();
      const active = input.verificationStatus !== 'Blacklisted';
      setState((prev) => ({
        ...prev,
        customers: prev.customers.map((c) =>
          c.id === customerId
            ? {
                ...c,
                creditLimit: limit,
                verificationStatus: input.verificationStatus,
                verifiedBy: currentUser.uid,
                verifiedAt: now,
                active,
                updatedAt: now,
              }
            : c
        ),
      }));
      if (authMode === 'firebase') {
        await saveFirestoreDoc(
          'customers',
          customerId,
          {
            creditLimit: limit,
            verificationStatus: input.verificationStatus,
            verifiedBy: currentUser.uid,
            verifiedAt: now,
            active,
          },
          false
        );
      }
      await recordAudit(
        'Master Data',
        `Approve Buyer -> ${input.verificationStatus}`,
        customerId,
        target.name,
        `Credit Limit: Rp ${limit.toLocaleString('id-ID')}`
      );
      toast.success(`Buyer ${target.name} diperbarui (${input.verificationStatus}, Limit Rp ${limit.toLocaleString('id-ID')}).`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.customers]
  );

  const saveWarehouse = useCallback(
    async (input: Omit<Warehouse, 'createdAt' | 'updatedAt'> & { isNew: boolean }) => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:write')) {
        toast.error('Akses ditolak.');
        return;
      }
      const now = new Date().toISOString();
      const wh: Warehouse = {
        id: input.id || makeId('wh'),
        code: sanitizeString(input.code, 24),
        name: sanitizeString(input.name, 120),
        address: sanitizeString(input.address, 300),
        picName: sanitizeString(input.picName, 120),
        phone: sanitizeString(input.phone, 40),
        active: input.active,
        createdAt: now,
        updatedAt: now,
      };
      setState((prev) => ({
        ...prev,
        warehouses: input.isNew
          ? [...prev.warehouses, wh]
          : prev.warehouses.map((w) => (w.id === wh.id ? { ...w, ...wh, createdAt: w.createdAt } : w)),
      }));
      if (authMode === 'firebase') {
        await saveFirestoreDoc('warehouses', wh.id, { ...wh }, input.isNew);
      }
      await recordAudit('Master Data', input.isNew ? 'Tambah Gudang' : 'Update Gudang', wh.id, wh.name);
      toast.success(`Gudang ${wh.name} tersimpan.`);
    },
    [authMode, currentUser, recordAudit]
  );

  const saveCategory = useCallback(
    async (input: { code: string; name: string; description?: string }) => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:write')) {
        toast.error('Akses ditolak.');
        return;
      }
      const cat: Category = {
        id: makeId('cat'),
        code: sanitizeString(input.code, 24).toUpperCase(),
        name: sanitizeString(input.name, 80),
        description: sanitizeString(input.description, 240),
        createdAt: new Date().toISOString(),
      };
      setState((prev) => ({ ...prev, categories: [...prev.categories, cat] }));
      if (authMode === 'firebase') {
        await createImmutableRecord('categories', cat.id, { ...cat });
      }
      toast.success(`Kategori ${cat.name} ditambahkan.`);
    },
    [authMode, currentUser]
  );

  const saveUom = useCallback(
    async (input: { code: string; name: string }) => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:write')) {
        toast.error('Akses ditolak.');
        return;
      }
      const uom: Uom = {
        id: makeId('uom'),
        code: sanitizeString(input.code, 16).toUpperCase(),
        name: sanitizeString(input.name, 64),
        createdAt: new Date().toISOString(),
      };
      setState((prev) => ({ ...prev, uoms: [...prev.uoms, uom] }));
      if (authMode === 'firebase') {
        await createImmutableRecord('uoms', uom.id, { ...uom });
      }
      toast.success(`Satuan ${uom.code} ditambahkan.`);
    },
    [authMode, currentUser]
  );

  const saveProduct = useCallback(
    async (
      input: Omit<Product, 'createdBy' | 'createdAt' | 'updatedAt'> & {
        isNew: boolean;
        photoFile?: File | null;
      }
    ) => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:write')) {
        toast.error('Akses ditolak.');
        return;
      }
      let imageUrl = input.imageUrl || '';
      if (input.photoFile) {
        if (authMode === 'firebase') {
          imageUrl = await uploadFileToStorage('products', input.photoFile);
        } else {
          imageUrl = URL.createObjectURL(input.photoFile);
        }
      }
      const cat = state.categories.find((c) => c.id === input.categoryId);
      const now = new Date().toISOString();
      const existing = state.products.find((p) => p.id === input.id);
      const isService = Boolean(input.isService);
      const product: Product = {
        id: input.id || makeId('prd'),
        sku: sanitizeString(input.sku, BLUEPRINT_CONSTRAINTS.SKU_MAX_LENGTH),
        name: sanitizeString(input.name, BLUEPRINT_CONSTRAINTS.PRODUCT_NAME_MAX_LENGTH),
        categoryId: input.categoryId,
        categoryName: cat?.name || input.categoryName || '',
        uomCode: sanitizeString(input.uomCode, 16),
        description: sanitizeString(input.description, BLUEPRINT_CONSTRAINTS.NOTES_MAX_LENGTH),
        imageUrl,
        buyPrice: Math.max(0, Number(input.buyPrice) || 0),
        sellPrice: Math.max(0, Number(input.sellPrice) || 0),
        currency: input.currency,
        minStock: isService ? 0 : Math.max(0, Number(input.minStock) || 0),
        maxStock: isService ? 0 : Math.max(Number(input.minStock) || 0, Number(input.maxStock) || 0),
        trackSerialOrExpiry: isService ? false : Boolean(input.trackSerialOrExpiry),
        isService,
        warehouseStocks: isService ? {} : input.warehouseStocks,
        active: input.active,
        createdBy: existing?.createdBy || currentUser.uid,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      setState((prev) => ({
        ...prev,
        products: input.isNew
          ? [product, ...prev.products]
          : prev.products.map((p) => (p.id === product.id ? { ...p, ...product, createdAt: p.createdAt } : p)),
      }));
      if (authMode === 'firebase') {
        await saveFirestoreDoc('products', product.id, { ...product }, input.isNew);
      }
      await recordAudit('Master Data', input.isNew ? 'Tambah Produk' : 'Update Produk', product.id, product.sku);
      toast.success(`Produk ${product.sku} tersimpan.`);
    },
    [authMode, currentUser, recordAudit, state.categories, state.products]
  );

  const deleteProduct = useCallback(
    async (id: string) => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus produk.');
        return;
      }
      const target = state.products.find((p) => p.id === id);
      if (!target) return;
      setState((prev) => ({
        ...prev,
        products: prev.products.filter((p) => p.id !== id),
      }));
      if (authMode === 'firebase') {
        await deleteFirestoreDoc('products', id);
      }
      await ensureSeedLockedInFirebase();
      await recordAudit('Master Data', 'Hapus Produk', id, target.name, target.sku);
      toast.success(`Produk ${target.name} dihapus.`);
    },
    [authMode, currentUser, ensureSeedLockedInFirebase, recordAudit, state.products]
  );

  const deleteSupplier = useCallback(
    async (id: string) => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus supplier.');
        return;
      }
      const target = state.suppliers.find((s) => s.id === id);
      if (!target) return;
      setState((prev) => ({
        ...prev,
        suppliers: prev.suppliers.filter((s) => s.id !== id),
      }));
      if (authMode === 'firebase') {
        await deleteFirestoreDoc('suppliers', id);
      }
      await ensureSeedLockedInFirebase();
      await recordAudit('Master Data', 'Hapus Supplier', id, target.name, target.code);
      toast.success(`Supplier ${target.name} dihapus.`);
    },
    [authMode, currentUser, ensureSeedLockedInFirebase, recordAudit, state.suppliers]
  );

  const deleteCustomer = useCallback(
    async (id: string) => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus customer.');
        return;
      }
      const target = state.customers.find((c) => c.id === id);
      if (!target) return;
      setState((prev) => ({
        ...prev,
        customers: prev.customers.filter((c) => c.id !== id),
      }));
      if (authMode === 'firebase') {
        await deleteFirestoreDoc('customers', id);
      }
      await ensureSeedLockedInFirebase();
      await recordAudit('Master Data', 'Hapus Customer', id, target.name, target.code);
      toast.success(`Customer ${target.name} dihapus.`);
    },
    [authMode, currentUser, ensureSeedLockedInFirebase, recordAudit, state.customers]
  );

  const deleteWarehouse = useCallback(
    async (id: string) => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus gudang.');
        return;
      }
      const target = state.warehouses.find((w) => w.id === id);
      if (!target) return;
      setState((prev) => ({
        ...prev,
        warehouses: prev.warehouses.filter((w) => w.id !== id),
      }));
      if (authMode === 'firebase') {
        await deleteFirestoreDoc('warehouses', id);
      }
      await ensureSeedLockedInFirebase();
      await recordAudit('Master Data', 'Hapus Gudang', id, target.name, target.code);
      toast.success(`Gudang ${target.name} dihapus.`);
    },
    [authMode, currentUser, ensureSeedLockedInFirebase, recordAudit, state.warehouses]
  );

  const deleteCategory = useCallback(
    async (id: string) => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus kategori.');
        return;
      }
      const target = state.categories.find((c) => c.id === id);
      if (!target) return;
      setState((prev) => ({
        ...prev,
        categories: prev.categories.filter((c) => c.id !== id),
      }));
      if (authMode === 'firebase') {
        await deleteFirestoreDoc('categories', id);
      }
      await ensureSeedLockedInFirebase();
      await recordAudit('Master Data', 'Hapus Kategori', id, target.name, target.code);
      toast.success(`Kategori ${target.name} dihapus.`);
    },
    [authMode, currentUser, ensureSeedLockedInFirebase, recordAudit, state.categories]
  );

  const deleteUom = useCallback(
    async (id: string) => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus satuan.');
        return;
      }
      const target = state.uoms.find((u) => u.id === id);
      if (!target) return;
      setState((prev) => ({
        ...prev,
        uoms: prev.uoms.filter((u) => u.id !== id),
      }));
      if (authMode === 'firebase') {
        await deleteFirestoreDoc('uoms', id);
      }
      await ensureSeedLockedInFirebase();
      await recordAudit('Master Data', 'Hapus Satuan', id, target.code, target.name);
      toast.success(`Satuan ${target.code} dihapus.`);
    },
    [authMode, currentUser, ensureSeedLockedInFirebase, recordAudit, state.uoms]
  );

  const clearDummyMasterData = useCallback(async () => {
    if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
      toast.error('Hanya Direktur yang dapat membersihkan data dummy master.');
      return;
    }
    const targets = findSeededDummyMasterTargets(state, createInitialSeedState());
    if (targets.totalCount === 0) {
      toast.info('Tidak ada data dummy master yang tersisa.');
      return;
    }

    const prdSet = new Set(targets.productIds);
    const supSet = new Set(targets.supplierIds);
    const cusSet = new Set(targets.customerIds);
    const whSet = new Set(targets.warehouseIds);
    const catSet = new Set(targets.categoryIds);
    const uomSet = new Set(targets.uomIds);

    setState((prev) => ({
      ...prev,
      products: prev.products.filter((p) => !prdSet.has(p.id)),
      suppliers: prev.suppliers.filter((s) => !supSet.has(s.id)),
      customers: prev.customers.filter((c) => !cusSet.has(c.id)),
      warehouses: prev.warehouses.filter((w) => !whSet.has(w.id)),
      categories: prev.categories.filter((c) => !catSet.has(c.id)),
      uoms: prev.uoms.filter((u) => !uomSet.has(u.id)),
    }));

    if (authMode === 'firebase') {
      const entries: Array<{ col: string; id: string }> = [
        ...targets.productIds.map((id) => ({ col: 'products', id })),
        ...targets.supplierIds.map((id) => ({ col: 'suppliers', id })),
        ...targets.customerIds.map((id) => ({ col: 'customers', id })),
        ...targets.warehouseIds.map((id) => ({ col: 'warehouses', id })),
        ...targets.categoryIds.map((id) => ({ col: 'categories', id })),
        ...targets.uomIds.map((id) => ({ col: 'uoms', id })),
      ];
      await deleteFirestoreDocsInChunks(entries, 10);
    }

    await ensureSeedLockedInFirebase();
    await recordAudit(
      'Master Data',
      'Hapus Semua Data Dummy Master',
      'seed_cleanup',
      `${targets.totalCount} data dummy`,
      `Produk:${targets.productIds.length}, Supplier:${targets.supplierIds.length}, Customer:${targets.customerIds.length}, Gudang:${targets.warehouseIds.length}, Kategori:${targets.categoryIds.length}, Satuan:${targets.uomIds.length}`
    );
    toast.success(`${targets.totalCount} data dummy master berhasil dihapus.`);
  }, [authMode, currentUser, ensureSeedLockedInFirebase, recordAudit, state]);

  const updateUserRole = useCallback(
    async (uid: string, role: UserRole, active: boolean) => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat mengubah role pengguna.');
        return;
      }
      if (uid === currentUser.uid && (!active || role !== 'Direktur')) {
        toast.error('Tidak dapat menonaktifkan atau menurunkan role akun Anda sendiri.');
        return;
      }
      setState((prev) => ({
        ...prev,
        users: prev.users.map((u) =>
          u.uid === uid ? { ...u, role, active, updatedAt: new Date().toISOString() } : u
        ),
      }));
      if (authMode === 'firebase') {
        await saveFirestoreDoc('users', uid, { role, active }, false);
      }
      await recordAudit('System', 'Ubah Role User', uid, role, `Status aktif: ${active}`);
      toast.success('Role & status pengguna diperbarui.');
    },
    [authMode, currentUser, recordAudit]
  );

  const saveUserAccount = useCallback(
    async (input: {
      isNew: boolean;
      uid?: string;
      displayName: string;
      email: string;
      department?: string;
      role: UserRole;
      active: boolean;
    }): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat mengelola akun pengguna.');
        return false;
      }
      const cleanName = sanitizeString(input.displayName, 120);
      const cleanEmail = normalizeUserEmail(input.email);
      const cleanDept = sanitizeString(input.department, 80) || 'Umum';
      if (cleanName.length < 2) {
        toast.error('Nama lengkap pengguna minimal 2 karakter.');
        return false;
      }
      if (!isValidEmailFormat(cleanEmail)) {
        toast.error('Format email Google tidak valid.');
        return false;
      }
      if (isEmailRegistered(state.users, cleanEmail, input.isNew ? undefined : input.uid)) {
        toast.error(`Email ${cleanEmail} sudah terdaftar di sistem.`);
        return false;
      }
      if (!input.isNew && input.uid === currentUser.uid && (!input.active || input.role !== 'Direktur')) {
        toast.error('Tidak dapat menonaktifkan atau menurunkan role akun Anda sendiri.');
        return false;
      }

      const now = new Date().toISOString();
      const targetUid = input.isNew ? makeId('usr') : input.uid || '';
      if (!targetUid) return false;

      const existing = state.users.find((u) => u.uid === targetUid);
      const userRecord: UserProfile = {
        uid: targetUid,
        email: existing ? existing.email : cleanEmail,
        displayName: cleanName,
        role: input.role,
        department: cleanDept,
        active: input.active,
        photoURL: existing?.photoURL || '',
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };

      setState((prev) => ({
        ...prev,
        users: input.isNew
          ? [userRecord, ...prev.users]
          : prev.users.map((u) => (u.uid === targetUid ? { ...u, ...userRecord } : u)),
      }));

      if (authMode === 'firebase') {
        if (input.isNew) {
          await saveFirestoreDoc('users', targetUid, { ...userRecord }, true);
        } else {
          await saveFirestoreDoc(
            'users',
            targetUid,
            {
              displayName: userRecord.displayName,
              department: userRecord.department,
              role: userRecord.role,
              active: userRecord.active,
            },
            false
          );
        }
      }

      await recordAudit(
        'System',
        input.isNew ? 'Tambah User' : 'Update User',
        targetUid,
        userRecord.email,
        `Role: ${userRecord.role}, Status: ${userRecord.active ? 'Aktif' : 'Nonaktif'}`
      );
      toast.success(
        input.isNew
          ? `User ${userRecord.displayName} (${userRecord.role}) berhasil ditambahkan.`
          : `Data user ${userRecord.displayName} diperbarui.`
      );
      return true;
    },
    [authMode, currentUser, recordAudit, state.users]
  );

  const deleteUserAccount = useCallback(
    async (uid: string) => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus pengguna.');
        return;
      }
      if (uid === currentUser.uid) {
        toast.error('Tidak dapat menghapus akun yang sedang aktif digunakan.');
        return;
      }
      const target = state.users.find((u) => u.uid === uid);
      setState((prev) => ({
        ...prev,
        users: prev.users.filter((u) => u.uid !== uid),
      }));
      if (authMode === 'firebase') {
        await deleteFirestoreDoc('users', uid);
      }
      await recordAudit('System', 'Hapus User', uid, target?.email || uid);
      toast.success(`User ${target?.displayName || uid} dihapus.`);
    },
    [authMode, currentUser, recordAudit, state.users]
  );

  // =========================================================================
  // Purchase Order Actions
  // =========================================================================
  const createPurchaseOrder = useCallback(
    async (input: {
      supplierId: string;
      warehouseId: string;
      currency: CurrencyCode;
      expectedDate: string;
      notes: string;
      paymentTerm?: string;
      paymentTermCustom?: string;
      incoterm?: string;
      deliveryLocation?: string;
      termsAndConditions?: string;
      items: Array<{
        productId: string;
        qty: number;
        unitPrice: number;
        isService?: boolean;
        productName?: string;
        sku?: string;
        uomCode?: string;
      }>;
      submitImmediately?: boolean;
      attachmentFile?: File | null;
    }): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'po:create')) {
        toast.error('Role Anda tidak memiliki izin membuat Purchase Order.');
        return false;
      }
      if (input.items.length === 0 || input.items.length > BLUEPRINT_CONSTRAINTS.MAX_ORDER_ITEMS) {
        toast.error('PO harus memiliki 1-50 item.');
        return false;
      }
      const supplier = state.suppliers.find((s) => s.id === input.supplierId);
      const warehouse = state.warehouses.find((w) => w.id === input.warehouseId);
      if (!supplier || !warehouse) {
        toast.error('Supplier atau gudang tidak ditemukan.');
        return false;
      }

      const orderItems: OrderItem[] = [];
      for (const it of input.items) {
        const prod = state.products.find((p) => p.id === it.productId);
        if (!prod && !it.isService) continue;
        const isService = Boolean(it.isService || prod?.isService);
        const manualName = sanitizeString(it.productName, 180).trim();
        if (!prod && isService && !manualName) {
          toast.error('Tuliskan nama / keterangan jasa pada baris Service.');
          return false;
        }
        const rawQty = Number(it.qty);
        if (!Number.isFinite(rawQty) || rawQty < 1) {
          toast.error('Qty setiap item/jasa harus minimal 1.');
          return false;
        }
        const qty = Math.round(rawQty);
        const price = Math.max(0, Number(it.unitPrice) || 0);
        orderItems.push({
          productId: prod?.id || sanitizeString(it.productId, 128) || makeId('svc'),
          sku: prod?.sku || sanitizeString(it.sku, 40) || 'SRV-MANUAL',
          productName: prod?.name || manualName,
          uomCode: prod?.uomCode || sanitizeString(it.uomCode, 16) || 'JASA',
          qty,
          fulfilledQty: 0,
          unitPrice: price,
          lineTotal: Math.round(qty * price * 100) / 100,
          ...(isService ? { isService: true } : {}),
        });
      }
      if (orderItems.length === 0) {
        toast.error('Minimal 1 item valid harus dipilih.');
        return false;
      }

      const vendorDefaultTerm = mapSupplierToPaymentTerm(supplier);
      const paymentTerm = sanitizeString(input.paymentTerm || vendorDefaultTerm.paymentTerm, 80);
      const paymentTermCustom =
        paymentTerm === 'Custom'
          ? sanitizeString(input.paymentTermCustom || vendorDefaultTerm.paymentTermCustom, 120)
          : '';
      if (paymentTerm === 'Custom' && !paymentTermCustom) {
        toast.error('Isi keterangan Payment Term Custom.');
        return false;
      }
      const incoterm = sanitizeString(input.incoterm || getDefaultPoIncoterm(supplier), 80);
      const deliveryLocation = sanitizeString(
        input.deliveryLocation || getDefaultPoDeliveryLocation(incoterm, supplier, warehouse, state.settings),
        300
      );
      if (!deliveryLocation) {
        toast.error('Lokasi pengiriman pada Terms & Conditions wajib diisi.');
        return false;
      }
      const termsAndConditions = sanitizeString(
        ensureMandatoryPoTermsNote(input.termsAndConditions),
        2000
      );

      const totals = calculateOrderTotals(orderItems, getEffectiveTaxRatePercent(state.settings));
      const totalAmountIdr = convertToIdr(
        totals.totalAmount,
        input.currency,
        state.settings.defaultExchangeRateUsdIdr
      );
      const supCheck = validateSupplierForPurchaseOrder({
        supplier,
        totalAmountIdr,
      });
      if (!supCheck.allowed) {
        toast.error(supCheck.reason || 'Supplier belum terverifikasi untuk transaksi ini.');
        return false;
      }

      const attachmentUrls: string[] = [];
      if (input.attachmentFile) {
        if (authMode === 'firebase') {
          attachmentUrls.push(await uploadFileToStorage('po-documents', input.attachmentFile));
        } else {
          attachmentUrls.push(`local://doc/${input.attachmentFile.name}`);
        }
      }

      const now = new Date().toISOString();
      const poId = makeId('po');
      const poNumber = buildNextSequentialDocNumber(
        'PO-2026-',
        state.purchaseOrders.map((p) => p.poNumber),
        92
      );
      const status: PoStatus = input.submitImmediately ? 'Submitted' : 'Draft';
      const approvalTierRequired: 'Manager' | 'Direktur' = requiresDirectorApproval(
        totalAmountIdr,
        state.settings.managerApprovalLimitIdr ?? DEFAULT_MANAGER_APPROVAL_LIMIT_IDR
      )
        ? 'Direktur'
        : 'Manager';
      const initialLog = {
        id: makeId('log'),
        action: input.submitImmediately ? 'PO Dibuat & Diajukan Approval' : 'PO Dibuat (Draft)',
        actorId: currentUser.uid,
        actorName: currentUser.displayName,
        timestamp: now,
      };

      const newPo: PurchaseOrder = {
        id: poId,
        poNumber,
        supplierId: supplier.id,
        supplierName: supplier.name,
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        currency: input.currency,
        exchangeRate: state.settings.defaultExchangeRateUsdIdr,
        status,
        items: orderItems,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        expectedDate: input.expectedDate,
        notes: sanitizeString(input.notes, BLUEPRINT_CONSTRAINTS.NOTES_MAX_LENGTH),
        paymentTerm,
        ...(paymentTermCustom ? { paymentTermCustom } : {}),
        incoterm,
        deliveryLocation,
        termsAndConditions,
        attachmentUrls,
        approvalTierRequired,
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName,
        createdAt: now,
        updatedAt: now,
        logs: [initialLog],
      };

      setState((prev) => ({ ...prev, purchaseOrders: [newPo, ...prev.purchaseOrders] }));
      if (authMode === 'firebase') {
        const poDoc = { ...newPo };
        delete poDoc.logs;
        await saveFirestoreDoc('purchaseOrders', poId, { ...poDoc, status: 'Draft' }, true);
        if (status === 'Submitted') {
          await saveFirestoreDoc('purchaseOrders', poId, { status: 'Submitted' }, false);
        }
        await appendPoLog(poId, initialLog);
      }
      await recordAudit('Procurement', `Buat ${poNumber}`, poId, poNumber, `Status: ${status}`);
      toast.success(`${poNumber} berhasil dibuat (${status}).`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.products, state.purchaseOrders, state.settings, state.suppliers, state.warehouses]
  );

  const transitionPurchaseOrder = useCallback(
    async (poId: string, nextStatus: PoStatus, note?: string) => {
      if (!currentUser) return;
      const po = state.purchaseOrders.find((p) => p.id === poId);
      if (!po) return;

      const poTotalIdr = convertToIdr(
        po.totalAmount,
        po.currency,
        po.exchangeRate || state.settings.defaultExchangeRateUsdIdr
      );
      const needsDirector =
        po.approvalTierRequired === 'Direktur' ||
        requiresDirectorApproval(
          poTotalIdr,
          state.settings.managerApprovalLimitIdr ?? DEFAULT_MANAGER_APPROVAL_LIMIT_IDR
        );

      if (nextStatus === 'Approved by Manager') {
        if (!hasPermission(currentUser.role, 'po:approve')) {
          toast.error('Hanya Manager atau Direktur yang dapat menyetujui PO.');
          return;
        }
        if (needsDirector && !hasPermission(currentUser.role, 'director:approve')) {
          toast.error(
            `PO senilai ${poTotalIdr.toLocaleString('id-ID')} IDR melebihi batas otoritas Manager. Memerlukan persetujuan Direktur.`
          );
          return;
        }
      }
      if (nextStatus === 'Closed' && !hasPermission(currentUser.role, 'po:close')) {
        toast.error('Role Anda tidak memiliki izin menutup PO.');
        return;
      }
      if (['Submitted', 'Ordered', 'Cancelled'].includes(nextStatus) && !hasPermission(currentUser.role, 'po:create') && !hasPermission(currentUser.role, 'po:approve')) {
        toast.error('Akses ditolak untuk mengubah status PO.');
        return;
      }
      if (!canTransitionPoStatus(po.status, nextStatus)) {
        toast.error(`Transisi status dari ${po.status} ke ${nextStatus} tidak valid.`);
        return;
      }
      if (['Submitted', 'Approved by Manager', 'Ordered'].includes(nextStatus)) {
        const supplier = state.suppliers.find((s) => s.id === po.supplierId);
        if (supplier) {
          const supCheck = validateSupplierForPurchaseOrder({
            supplier,
            totalAmountIdr: poTotalIdr,
          });
          if (!supCheck.allowed) {
            toast.error(supCheck.reason || 'Supplier belum memenuhi syarat verifikasi Admin.');
            return;
          }
        }
      }

      const now = new Date().toISOString();
      const logEntry = {
        id: makeId('log'),
        action:
          nextStatus === 'Approved by Manager' && needsDirector
            ? 'Disetujui Direktur (Tier High-Value)'
            : `Status diubah ke ${nextStatus}`,
        actorId: currentUser.uid,
        actorName: currentUser.displayName,
        note: note ? sanitizeString(note, 400) : undefined,
        timestamp: now,
      };

      const approvedBy = nextStatus === 'Approved by Manager' ? currentUser.uid : po.approvedBy;
      const directorApprovedBy =
        nextStatus === 'Approved by Manager' && needsDirector
          ? currentUser.uid
          : po.directorApprovedBy;

      setState((prev) => ({
        ...prev,
        purchaseOrders: prev.purchaseOrders.map((p) =>
          p.id === poId
            ? {
                ...p,
                status: nextStatus,
                approvedBy,
                ...(directorApprovedBy ? { directorApprovedBy } : {}),
                updatedAt: now,
                logs: [...(p.logs || []), logEntry],
              }
            : p
        ),
      }));

      if (authMode === 'firebase') {
        await saveFirestoreDoc(
          'purchaseOrders',
          poId,
          {
            status: nextStatus,
            approvedBy,
            ...(directorApprovedBy ? { directorApprovedBy } : {}),
          },
          false
        );
        await appendPoLog(poId, logEntry);
      }
      await recordAudit('Procurement', `${po.poNumber} -> ${nextStatus}`, poId, po.poNumber);
      toast.success(`${po.poNumber} diperbarui ke ${nextStatus}.`);
    },
    [authMode, currentUser, recordAudit, state.purchaseOrders, state.settings.defaultExchangeRateUsdIdr, state.settings.managerApprovalLimitIdr, state.suppliers]
  );

  const deletePurchaseOrder = useCallback(
    async (poId: string) => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus Purchase Order.');
        return;
      }
      const target = state.purchaseOrders.find((p) => p.id === poId);
      if (!target) return;
      setState((prev) => ({
        ...prev,
        purchaseOrders: prev.purchaseOrders.filter((p) => p.id !== poId),
      }));
      if (authMode === 'firebase') {
        await deletePurchaseOrdersWithLogs([poId]);
      }
      await ensureSeedLockedInFirebase();
      await recordAudit('Procurement', `Hapus ${target.poNumber}`, poId, target.poNumber, target.supplierName);
      toast.success(`Purchase Order ${target.poNumber} dihapus.`);
    },
    [authMode, currentUser, ensureSeedLockedInFirebase, recordAudit, state.purchaseOrders]
  );

  const clearDummyPurchaseOrders = useCallback(async () => {
    if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
      toast.error('Hanya Direktur yang dapat menghapus PO dummy.');
      return;
    }
    const targets = findSeededDummyOrderTargets(state, createInitialSeedState());
    if (targets.poIds.length === 0) {
      toast.info('Tidak ada PO dummy yang tersisa.');
      return;
    }
    const poSet = new Set(targets.poIds);
    setState((prev) => ({
      ...prev,
      purchaseOrders: prev.purchaseOrders.filter((p) => !poSet.has(p.id)),
    }));
    if (authMode === 'firebase') {
      await deletePurchaseOrdersWithLogs(targets.poIds);
    }
    await ensureSeedLockedInFirebase();
    await recordAudit(
      'Procurement',
      'Hapus Semua PO Dummy',
      'seed_cleanup_po',
      `${targets.poIds.length} PO dummy`
    );
    toast.success(`${targets.poIds.length} Purchase Order dummy berhasil dihapus.`);
  }, [authMode, currentUser, ensureSeedLockedInFirebase, recordAudit, state]);

  // =========================================================================
  // Inventory & Goods Receipt (from PO) -> Auto AP Invoice
  // =========================================================================
  const receiveGoodsFromPo = useCallback(
    async (
      poId: string,
      receivedQuantities: Record<string, number>,
      notes: string
    ) => {
      if (!currentUser || !hasPermission(currentUser.role, 'po:receive')) {
        toast.error('Hanya Warehouse atau Direktur yang dapat melakukan Goods Receipt.');
        return;
      }
      const po = state.purchaseOrders.find((p) => p.id === poId);
      if (!po) return;
      if (!['Approved by Manager', 'Ordered', 'Partially Received'].includes(po.status)) {
        toast.error('PO harus disetujui Manager / Ordered sebelum Goods Receipt.');
        return;
      }

      const now = new Date().toISOString();
      const lockCheck = isDateInClosedPeriod(now.slice(0, 10), state.periodClosings);
      if (lockCheck.locked) {
        toast.error(`Periode akuntansi ${lockCheck.periodKey} sudah ditutup (Closed). Tidak dapat memposting Goods Receipt & AP.`);
        return;
      }
      let receivedValueSubtotal = 0;
      let receivedStockSubtotal = 0;
      let receivedServiceSubtotal = 0;
      let receivedCount = 0;
      const receivedServiceNames: string[] = [];
      const newMovements: StockMovement[] = [];
      const updatedProductsMap: Record<string, Record<string, number>> = {};

      const updatedItems = po.items.map((item) => {
        const qtyToReceive = Math.max(0, Number(receivedQuantities[item.productId] || 0));
        const remaining = Math.max(0, item.qty - item.fulfilledQty);
        const actualReceive = Math.min(remaining, qtyToReceive);

        if (actualReceive > 0) {
          receivedCount += 1;
          const lineAmt = actualReceive * item.unitPrice;
          receivedValueSubtotal += lineAmt;
          const prod = state.products.find((p) => p.id === item.productId);
          const isService = Boolean(item.isService || prod?.isService);
          if (isService) {
            receivedServiceSubtotal += lineAmt;
            if (item.productName) receivedServiceNames.push(item.productName);
          } else {
            receivedStockSubtotal += lineAmt;
            if (prod) {
              const beforeQty = prod.warehouseStocks[po.warehouseId] ?? 0;
              const afterQty = beforeQty + actualReceive;
              updatedProductsMap[prod.id] = {
                ...prod.warehouseStocks,
                [po.warehouseId]: afterQty,
              };
              newMovements.push({
                id: makeId('mov'),
                movementNumber: `GR-${Date.now().toString().slice(-6)}`,
                type: 'GOODS_RECEIPT',
                referenceType: 'PO',
                referenceId: po.id,
                referenceNumber: po.poNumber,
                productId: prod.id,
                productSku: prod.sku,
                productName: prod.name,
                warehouseId: po.warehouseId,
                warehouseName: po.warehouseName,
                quantityDelta: actualReceive,
                beforeQty,
                afterQty,
                unitCost: item.unitPrice,
                notes: sanitizeString(notes, 400) || `Goods Receipt dari ${po.poNumber}`,
                createdBy: currentUser.uid,
                createdByName: currentUser.displayName,
                createdAt: now,
              });
            }
          }
        }
        return {
          ...item,
          fulfilledQty: item.fulfilledQty + actualReceive,
        };
      });

      if (receivedCount === 0) {
        toast.error('Masukkan minimal 1 kuantitas barang/jasa yang diterima.');
        return;
      }

      const allFulfilled = updatedItems.every((it) => it.fulfilledQty >= it.qty);
      const nextStatus: PoStatus = allFulfilled ? 'Fully Received' : 'Partially Received';
      const logEntry = {
        id: makeId('log'),
        action: `Goods Receipt (${nextStatus})`,
        actorId: currentUser.uid,
        actorName: currentUser.displayName,
        note: `${receivedCount} item diterima${newMovements.length > 0 ? ` ke ${po.warehouseName}` : ' (Service / Non-Stok)'}`,
        timestamp: now,
      };

      // Auto-create AP Invoice for the received batch
      const supplier = state.suppliers.find((s) => s.id === po.supplierId);
      const effectiveTaxRate = getEffectiveTaxRatePercent(state.settings);
      const taxFactor = 1 + effectiveTaxRate / 100;
      const invoiceTotal = Math.round(receivedValueSubtotal * taxFactor * 100) / 100;
      const dueDate = new Date(Date.now() + (supplier?.paymentTermDays ?? 30) * 86400000)
        .toISOString()
        .slice(0, 10);

      const newApInvoice: AccountingInvoice = {
        id: makeId('inv_ap'),
        invoiceNumber: `INV-AP-${Date.now().toString().slice(-6)}`,
        ledgerType: 'AP',
        counterpartyId: po.supplierId,
        counterpartyName: po.supplierName,
        referenceOrderId: po.id,
        referenceOrderNumber: po.poNumber,
        currency: po.currency,
        exchangeRate: po.exchangeRate,
        totalAmount: invoiceTotal,
        paidAmount: 0,
        balanceDue: invoiceTotal,
        status: 'UNPAID',
        issueDate: now.slice(0, 10),
        dueDate,
        createdBy: currentUser.uid,
        createdAt: now,
        updatedAt: now,
        payments: [],
      };

      const fxRate = po.exchangeRate || state.settings.defaultExchangeRateUsdIdr;
      const subtotalIdr = convertToIdr(receivedValueSubtotal, po.currency, fxRate);
      const totalApIdr = convertToIdr(invoiceTotal, po.currency, fxRate);
      const taxIdr = Math.max(0, totalApIdr - subtotalIdr);
      let stockSubtotalIdr = convertToIdr(receivedStockSubtotal, po.currency, fxRate);
      let serviceSubtotalIdr = convertToIdr(receivedServiceSubtotal, po.currency, fxRate);
      if (stockSubtotalIdr + serviceSubtotalIdr !== subtotalIdr) {
        if (serviceSubtotalIdr > 0 && stockSubtotalIdr === 0) {
          serviceSubtotalIdr = subtotalIdr;
        } else {
          stockSubtotalIdr = Math.max(0, subtotalIdr - serviceSubtotalIdr);
        }
      }
      const serviceMemoSummary =
        receivedServiceNames.length > 0
          ? `${receivedServiceNames.join(', ')} (${po.poNumber})`
          : `Beban Operasional / Pengiriman (${po.poNumber})`;

      const autoJournal = buildResolvedJournalEntry({
        entryDate: now.slice(0, 10),
        journalType: 'Pembelian (AP)',
        referenceType: 'INVOICE_AP',
        referenceId: newApInvoice.id,
        referenceNumber: newApInvoice.invoiceNumber,
        description: `Goods Receipt ${po.poNumber} — ${po.supplierName || 'Supplier'}`,
        rawLines: [
          {
            preferredAccountId: 'coa_1301',
            fallbackCode: '1301',
            fallbackName: 'Persediaan Barang Dagang',
            debitIdr: stockSubtotalIdr,
            creditIdr: 0,
            memo: `Masuk stok ${po.warehouseName || ''}`,
          },
          {
            preferredAccountId: 'coa_6103',
            fallbackCode: '6103',
            fallbackName: 'Beban Ekspedisi & Pengiriman',
            debitIdr: serviceSubtotalIdr,
            creditIdr: 0,
            memo: serviceMemoSummary,
          },
          {
            preferredAccountId: 'coa_1401',
            fallbackCode: '1401',
            fallbackName: 'PPN Masukan',
            debitIdr: taxIdr,
            creditIdr: 0,
            memo: `PPN Masukan ${newApInvoice.invoiceNumber}`,
          },
          {
            preferredAccountId: 'coa_2101',
            fallbackCode: '2101',
            fallbackName: 'Hutang Usaha (AP)',
            debitIdr: 0,
            creditIdr: totalApIdr,
            memo: `Hutang ${po.supplierName || ''}`,
          },
        ],
      });

      setState((prev) => ({
        ...prev,
        products: prev.products.map((p) =>
          updatedProductsMap[p.id] ? { ...p, warehouseStocks: updatedProductsMap[p.id], updatedAt: now } : p
        ),
        purchaseOrders: prev.purchaseOrders.map((p) =>
          p.id === po.id
            ? { ...p, items: updatedItems, status: nextStatus, updatedAt: now, logs: [...(p.logs || []), logEntry] }
            : p
        ),
        stockMovements: [...newMovements, ...prev.stockMovements],
        invoices: [newApInvoice, ...prev.invoices],
        journalEntries: autoJournal ? [autoJournal, ...prev.journalEntries] : prev.journalEntries,
      }));

      if (authMode === 'firebase') {
        for (const [pid, stocks] of Object.entries(updatedProductsMap)) {
          await saveFirestoreDoc('products', pid, { warehouseStocks: stocks }, false);
        }
        for (const mov of newMovements) {
          await createImmutableRecord('stockMovements', mov.id, { ...mov });
        }
        await saveFirestoreDoc('purchaseOrders', po.id, { items: updatedItems, status: nextStatus }, false);
        await appendPoLog(po.id, logEntry);
        const invPayload = { ...newApInvoice };
        delete invPayload.payments;
        await saveFirestoreDoc('invoices', newApInvoice.id, invPayload, true);
        if (autoJournal) {
          await saveFirestoreDoc('journalEntries', autoJournal.id, { ...autoJournal }, true);
        }
      }

      await recordAudit(
        'Inventory',
        `Goods Receipt ${po.poNumber}`,
        po.id,
        po.poNumber,
        `Status PO: ${nextStatus}; AP Invoice ${newApInvoice.invoiceNumber} & Jurnal Buku Besar dibuat otomatis.`
      );
      toast.success(
        newMovements.length > 0
          ? `Goods Receipt berhasil! Stok bertambah, AP (${newApInvoice.invoiceNumber}) & Jurnal Buku Besar tercatat.`
          : `Penerimaan Service/Non-Stok berhasil! AP (${newApInvoice.invoiceNumber}) & Beban Operasional tercatat.`
      );
    },
    [authMode, buildResolvedJournalEntry, currentUser, recordAudit, state.periodClosings, state.products, state.purchaseOrders, state.settings, state.suppliers]
  );

  const issueGoods = useCallback(
    async (input: {
      productId: string;
      warehouseId: string;
      qty: number;
      notes: string;
      soId?: string;
    }) => {
      if (!currentUser || !hasPermission(currentUser.role, 'inventory:write')) {
        toast.error('Role Anda tidak memiliki izin Goods Issue.');
        return;
      }
      const prod = state.products.find((p) => p.id === input.productId);
      const wh = state.warehouses.find((w) => w.id === input.warehouseId);
      if (!prod || !wh) return;
      if (prod.isService) {
        toast.error('Item bertipe Service / Non-Stok tidak memiliki mutasi stok gudang.');
        return;
      }
      const beforeQty = prod.warehouseStocks[wh.id] ?? 0;
      const qty = Math.max(1, Number(input.qty));
      if (qty > beforeQty) {
        toast.error(`Stok tidak mencukupi di ${wh.name} (tersedia: ${beforeQty}).`);
        return;
      }
      const afterQty = beforeQty - qty;
      const now = new Date().toISOString();
      const updatedStocks = { ...prod.warehouseStocks, [wh.id]: afterQty };
      const mov: StockMovement = {
        id: makeId('mov'),
        movementNumber: `GI-${Date.now().toString().slice(-6)}`,
        type: 'GOODS_ISSUE',
        referenceType: input.soId ? 'SO' : 'MANUAL',
        referenceId: input.soId,
        productId: prod.id,
        productSku: prod.sku,
        productName: prod.name,
        warehouseId: wh.id,
        warehouseName: wh.name,
        quantityDelta: -qty,
        beforeQty,
        afterQty,
        unitCost: prod.buyPrice,
        notes: sanitizeString(input.notes, 400) || 'Goods Issue Manual',
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName,
        createdAt: now,
      };
      setState((prev) => ({
        ...prev,
        products: prev.products.map((p) => (p.id === prod.id ? { ...p, warehouseStocks: updatedStocks, updatedAt: now } : p)),
        stockMovements: [mov, ...prev.stockMovements],
      }));
      if (authMode === 'firebase') {
        await saveFirestoreDoc('products', prod.id, { warehouseStocks: updatedStocks }, false);
        await createImmutableRecord('stockMovements', mov.id, { ...mov });
      }
      await recordAudit('Inventory', `Goods Issue ${prod.sku}`, prod.id, prod.sku, `-${qty} ${prod.uomCode} dari ${wh.code}`);
      toast.success(`Goods Issue ${qty} ${prod.uomCode} ${prod.sku} berhasil.`);
    },
    [authMode, currentUser, recordAudit, state.products, state.warehouses]
  );

  const transferStock = useCallback(
    async (input: {
      productId: string;
      fromWarehouseId: string;
      toWarehouseId: string;
      qty: number;
      notes: string;
    }) => {
      if (!currentUser || !hasPermission(currentUser.role, 'inventory:write')) {
        toast.error('Role Anda tidak memiliki izin mutasi stok.');
        return;
      }
      if (input.fromWarehouseId === input.toWarehouseId) {
        toast.error('Gudang asal dan tujuan harus berbeda.');
        return;
      }
      const prod = state.products.find((p) => p.id === input.productId);
      const fromWh = state.warehouses.find((w) => w.id === input.fromWarehouseId);
      const toWh = state.warehouses.find((w) => w.id === input.toWarehouseId);
      if (!prod || !fromWh || !toWh) return;
      if (prod.isService) {
        toast.error('Item bertipe Service / Non-Stok tidak memiliki stok gudang untuk ditransfer.');
        return;
      }

      const beforeFrom = prod.warehouseStocks[fromWh.id] ?? 0;
      const beforeTo = prod.warehouseStocks[toWh.id] ?? 0;
      const qty = Math.max(1, Number(input.qty));
      if (qty > beforeFrom) {
        toast.error(`Stok di ${fromWh.name} hanya ${beforeFrom} ${prod.uomCode}.`);
        return;
      }

      const now = new Date().toISOString();
      const updatedStocks = {
        ...prod.warehouseStocks,
        [fromWh.id]: beforeFrom - qty,
        [toWh.id]: beforeTo + qty,
      };
      const mov: StockMovement = {
        id: makeId('mov'),
        movementNumber: `TRF-${Date.now().toString().slice(-6)}`,
        type: 'TRANSFER',
        referenceType: 'MANUAL',
        productId: prod.id,
        productSku: prod.sku,
        productName: prod.name,
        warehouseId: fromWh.id,
        warehouseName: fromWh.name,
        targetWarehouseId: toWh.id,
        targetWarehouseName: toWh.name,
        quantityDelta: -qty,
        beforeQty: beforeFrom,
        afterQty: beforeFrom - qty,
        notes: sanitizeString(input.notes, 400) || `Transfer ${fromWh.code} -> ${toWh.code}`,
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName,
        createdAt: now,
      };

      setState((prev) => ({
        ...prev,
        products: prev.products.map((p) => (p.id === prod.id ? { ...p, warehouseStocks: updatedStocks, updatedAt: now } : p)),
        stockMovements: [mov, ...prev.stockMovements],
      }));

      if (authMode === 'firebase') {
        await saveFirestoreDoc('products', prod.id, { warehouseStocks: updatedStocks }, false);
        await createImmutableRecord('stockMovements', mov.id, { ...mov });
      }
      await recordAudit('Inventory', `Transfer ${prod.sku}`, prod.id, prod.sku, `${qty} ${prod.uomCode}: ${fromWh.code} -> ${toWh.code}`);
      toast.success(`Transfer ${qty} ${prod.uomCode} dari ${fromWh.code} ke ${toWh.code} berhasil.`);
    },
    [authMode, currentUser, recordAudit, state.products, state.warehouses]
  );

  const recordStockOpname = useCallback(
    async (input: {
      productId: string;
      warehouseId: string;
      countedQty: number;
      notes: string;
    }) => {
      if (!currentUser || !hasPermission(currentUser.role, 'inventory:write')) {
        toast.error('Role Anda tidak memiliki izin Stock Opname.');
        return;
      }
      const prod = state.products.find((p) => p.id === input.productId);
      const wh = state.warehouses.find((w) => w.id === input.warehouseId);
      if (!prod || !wh) return;
      if (prod.isService) {
        toast.error('Item bertipe Service / Non-Stok tidak memiliki stok untuk Stock Opname.');
        return;
      }

      const beforeQty = prod.warehouseStocks[wh.id] ?? 0;
      const afterQty = Math.max(0, Number(input.countedQty) || 0);
      const delta = afterQty - beforeQty;
      const now = new Date().toISOString();
      const updatedStocks = { ...prod.warehouseStocks, [wh.id]: afterQty };

      const mov: StockMovement = {
        id: makeId('mov'),
        movementNumber: `OPN-${Date.now().toString().slice(-6)}`,
        type: 'STOCK_OPNAME',
        referenceType: 'OPNAME',
        productId: prod.id,
        productSku: prod.sku,
        productName: prod.name,
        warehouseId: wh.id,
        warehouseName: wh.name,
        quantityDelta: delta,
        beforeQty,
        afterQty,
        notes: sanitizeString(input.notes, 400) || `Penyesuaian Stock Opname (${delta >= 0 ? '+' : ''}${delta})`,
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName,
        createdAt: now,
      };

      setState((prev) => ({
        ...prev,
        products: prev.products.map((p) => (p.id === prod.id ? { ...p, warehouseStocks: updatedStocks, updatedAt: now } : p)),
        stockMovements: [mov, ...prev.stockMovements],
      }));
      if (authMode === 'firebase') {
        await saveFirestoreDoc('products', prod.id, { warehouseStocks: updatedStocks }, false);
        await createImmutableRecord('stockMovements', mov.id, { ...mov });
      }
      await recordAudit('Inventory', `Stock Opname ${prod.sku}`, prod.id, prod.sku, `${wh.code}: ${beforeQty} -> ${afterQty}`);
      toast.success(`Stock Opname ${prod.sku} di ${wh.code} diperbarui.`);
    },
    [authMode, currentUser, recordAudit, state.products, state.warehouses]
  );

  // =========================================================================
  // Sales Order & Delivery Actions
  // =========================================================================
  const createSalesOrder = useCallback(
    async (input: {
      customerId: string;
      warehouseId: string;
      currency: CurrencyCode;
      dueDate: string;
      notes: string;
      quotationId?: string;
      quotationNumber?: string;
      paymentTerm?: string;
      paymentTermCustom?: string;
      incoterm?: string;
      deliveryLocation?: string;
      termsAndConditions?: string;
      items: Array<{
        productId: string;
        qty: number;
        unitPrice: number;
        isService?: boolean;
        productName?: string;
        sku?: string;
        uomCode?: string;
      }>;
      confirmImmediately?: boolean;
    }): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'so:create')) {
        toast.error('Role Anda tidak memiliki izin membuat Sales Order.');
        return false;
      }
      const customer = state.customers.find((c) => c.id === input.customerId);
      const warehouse = state.warehouses.find((w) => w.id === input.warehouseId);
      if (!customer || !warehouse) return false;

      const orderItems: OrderItem[] = [];
      for (const it of input.items) {
        const prod = state.products.find((p) => p.id === it.productId);
        if (!prod && !it.isService) continue;
        const isService = Boolean(it.isService || prod?.isService);
        const manualName = sanitizeString(it.productName, 180).trim();
        if (!prod && isService && !manualName) {
          toast.error('Tuliskan nama / keterangan jasa pada baris Service.');
          return false;
        }
        const rawQty = Number(it.qty);
        if (!Number.isFinite(rawQty) || rawQty < 1) {
          toast.error('Qty setiap item/jasa harus minimal 1.');
          return false;
        }
        const qty = Math.round(rawQty);
        const price = Math.max(0, Number(it.unitPrice) || 0);
        orderItems.push({
          productId: prod?.id || sanitizeString(it.productId, 128) || makeId('svc'),
          sku: prod?.sku || sanitizeString(it.sku, 40) || 'SRV-MANUAL',
          productName: prod?.name || manualName,
          uomCode: prod?.uomCode || sanitizeString(it.uomCode, 16) || 'JASA',
          qty,
          fulfilledQty: 0,
          unitPrice: price,
          lineTotal: Math.round(qty * price * 100) / 100,
          ...(isService ? { isService: true } : {}),
        });
      }
      if (orderItems.length === 0) {
        toast.error('Minimal 1 item valid harus dipilih.');
        return false;
      }

      const defaultBuyerTerm = mapCustomerToPaymentTerm(customer);
      const paymentTerm = sanitizeString(input.paymentTerm || defaultBuyerTerm.paymentTerm, 80);
      const paymentTermCustom =
        paymentTerm === 'Custom'
          ? sanitizeString(input.paymentTermCustom || defaultBuyerTerm.paymentTermCustom, 120)
          : '';
      if (paymentTerm === 'Custom' && !paymentTermCustom) {
        toast.error('Isi keterangan Payment Term Custom.');
        return false;
      }
      const incoterm = sanitizeString(input.incoterm || getDefaultSalesIncoterm(), 80);
      const deliveryLocation = sanitizeString(
        input.deliveryLocation || getDefaultSalesDeliveryLocation(incoterm, customer, warehouse),
        300
      );
      if (!deliveryLocation) {
        toast.error('Lokasi pengiriman pada Terms & Conditions wajib diisi.');
        return false;
      }
      const termsAndConditions = sanitizeString(
        input.termsAndConditions || getDefaultSalesOrderTerms(),
        2000
      );

      const stockCheck = checkSoStockAvailability(orderItems, warehouse.id, state.products);
      if (input.confirmImmediately && !stockCheck.sufficient) {
        toast.error('Stok gudang belum mencukupi untuk konfirmasi langsung. Simpan sebagai Draft atau kurangi qty.');
        return false;
      }

      const totals = calculateOrderTotals(orderItems, getEffectiveTaxRatePercent(state.settings));
      const newOrderAmountIdr = convertToIdr(
        totals.totalAmount,
        input.currency,
        state.settings.defaultExchangeRateUsdIdr
      );
      const openArIdr = computeOpenArForCustomerIdr(
        state.invoices,
        customer.id,
        state.settings.defaultExchangeRateUsdIdr
      );
      const buyerCheck = validateBuyerForSalesOrder({
        customer,
        newOrderAmountIdr,
        openArIdr,
      });
      if (!buyerCheck.allowed) {
        toast.error(buyerCheck.reason || 'Buyer belum memenuhi syarat verifikasi / Credit Limit.');
        return false;
      }

      const now = new Date().toISOString();
      const soId = makeId('so');
      const soNumber = buildNextSequentialDocNumber(
        'SO-2026-',
        state.salesOrders.map((s) => s.soNumber),
        160
      );
      const status: SoStatus = input.confirmImmediately ? 'Confirmed' : 'Draft';

      const newSo: SalesOrder = {
        id: soId,
        soNumber,
        customerId: customer.id,
        customerName: customer.name,
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        currency: input.currency,
        status,
        items: orderItems,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        dueDate: input.dueDate,
        ...(input.quotationId ? { quotationId: sanitizeString(input.quotationId, 128) } : {}),
        ...(input.quotationNumber ? { quotationNumber: sanitizeString(input.quotationNumber, 48) } : {}),
        notes: sanitizeString(input.notes, BLUEPRINT_CONSTRAINTS.NOTES_MAX_LENGTH),
        paymentTerm,
        ...(paymentTermCustom ? { paymentTermCustom } : {}),
        incoterm,
        deliveryLocation,
        termsAndConditions,
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName,
        createdAt: now,
        updatedAt: now,
      };

      setState((prev) => ({ ...prev, salesOrders: [newSo, ...prev.salesOrders] }));
      if (authMode === 'firebase') {
        await saveFirestoreDoc('salesOrders', soId, { ...newSo }, true);
      }
      await recordAudit('Sales', `Buat ${soNumber}`, soId, soNumber, `Customer: ${customer.name}`);
      toast.success(`${soNumber} berhasil dibuat (${status}).`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.customers, state.invoices, state.products, state.salesOrders, state.settings, state.warehouses]
  );

  const transitionSalesOrder = useCallback(
    async (soId: string, nextStatus: SoStatus) => {
      if (!currentUser) return;
      const so = state.salesOrders.find((s) => s.id === soId);
      if (!so) return;
      if (!canTransitionSoStatus(so.status, nextStatus)) {
        toast.error(`Transisi ${so.status} -> ${nextStatus} tidak valid.`);
        return;
      }
      if (nextStatus === 'Confirmed' && !hasPermission(currentUser.role, 'so:create')) {
        toast.error('Akses ditolak.');
        return;
      }
      if (['Invoiced', 'Closed'].includes(nextStatus) && !hasPermission(currentUser.role, 'accounting:write') && !hasPermission(currentUser.role, 'so:create')) {
        toast.error('Akses ditolak.');
        return;
      }
      if (nextStatus === 'Confirmed' || nextStatus === 'Invoiced') {
        const customer = state.customers.find((c) => c.id === so.customerId);
        if (customer) {
          const newOrderAmountIdr = convertToIdr(
            so.totalAmount,
            so.currency,
            state.settings.defaultExchangeRateUsdIdr
          );
          const openArIdr = computeOpenArForCustomerIdr(
            state.invoices,
            customer.id,
            state.settings.defaultExchangeRateUsdIdr
          );
          const buyerCheck = validateBuyerForSalesOrder({
            customer,
            newOrderAmountIdr,
            openArIdr,
          });
          if (!buyerCheck.allowed) {
            toast.error(buyerCheck.reason || 'Buyer belum memenuhi syarat verifikasi / Credit Limit.');
            return;
          }
        }
      }

      const now = new Date().toISOString();
      if (nextStatus === 'Invoiced') {
        const lockCheck = isDateInClosedPeriod(now.slice(0, 10), state.periodClosings);
        if (lockCheck.locked) {
          toast.error(`Periode akuntansi ${lockCheck.periodKey} sudah ditutup (Closed). Tidak dapat menerbitkan Invoice AR & Jurnal.`);
          return;
        }
      }
      let invoiceNumber = so.invoiceNumber;
      let createdInvoice: AccountingInvoice | null = null;

      if (nextStatus === 'Invoiced' && !so.invoiceNumber) {
        invoiceNumber = `INV-AR-${Date.now().toString().slice(-6)}`;
        createdInvoice = {
          id: makeId('inv_ar'),
          invoiceNumber,
          ledgerType: 'AR',
          counterpartyId: so.customerId,
          counterpartyName: so.customerName,
          referenceOrderId: so.id,
          referenceOrderNumber: so.soNumber,
          currency: so.currency,
          exchangeRate: state.settings.defaultExchangeRateUsdIdr,
          totalAmount: so.totalAmount,
          paidAmount: 0,
          balanceDue: so.totalAmount,
          status: 'UNPAID',
          issueDate: now.slice(0, 10),
          dueDate: so.dueDate || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
          createdBy: currentUser.uid,
          createdAt: now,
          updatedAt: now,
          payments: [],
        };
      }

      const autoJournals: JournalEntry[] = [];
      if (createdInvoice) {
        const fxRate = state.settings.defaultExchangeRateUsdIdr;
        const totalArIdr = convertToIdr(so.totalAmount, so.currency, fxRate);
        const subtotalIdr = convertToIdr(so.subtotal ?? so.totalAmount, so.currency, fxRate);
        const ppnOutIdr = Math.max(0, totalArIdr - subtotalIdr);
        const { stockSubtotal: stockOrigin, serviceSubtotal: serviceOrigin } = splitOrderSubtotalByService(
          so.items,
          state.products
        );
        let stockSubtotalIdr = convertToIdr(stockOrigin, so.currency, fxRate);
        let serviceSubtotalIdr = convertToIdr(serviceOrigin, so.currency, fxRate);
        if (stockSubtotalIdr + serviceSubtotalIdr !== subtotalIdr) {
          if (serviceSubtotalIdr > 0 && stockSubtotalIdr === 0) {
            serviceSubtotalIdr = subtotalIdr;
          } else {
            stockSubtotalIdr = Math.max(0, subtotalIdr - serviceSubtotalIdr);
          }
        }

        const soServiceNames = so.items
          .filter((it) => isServiceOrderItem(it, state.products))
          .map((it) => it.productName)
          .filter(Boolean);
        const soServiceMemo =
          soServiceNames.length > 0
            ? `Jasa / Non-Stok: ${soServiceNames.join(', ')} (${so.soNumber})`
            : `Tagihan Jasa / Non-Stok (${so.soNumber})`;

        const arJournal = buildResolvedJournalEntry({
          entryDate: now.slice(0, 10),
          journalType: 'Penjualan (AR)',
          referenceType: 'INVOICE_AR',
          referenceId: createdInvoice.id,
          referenceNumber: createdInvoice.invoiceNumber,
          description: `Penagihan Penjualan ${so.soNumber} — ${so.customerName || 'Customer'}`,
          rawLines: [
            {
              preferredAccountId: 'coa_1201',
              fallbackCode: '1201',
              fallbackName: 'Piutang Usaha (AR)',
              debitIdr: totalArIdr,
              creditIdr: 0,
              memo: `Piutang ${so.customerName || ''}`,
            },
            {
              preferredAccountId: 'coa_4101',
              fallbackCode: '4101',
              fallbackName: 'Penjualan Barang Dagang',
              debitIdr: 0,
              creditIdr: stockSubtotalIdr,
              memo: `Pendapatan Penjualan ${so.soNumber}`,
            },
            {
              preferredAccountId: 'coa_4101',
              fallbackCode: '4101',
              fallbackName: 'Penjualan Barang Dagang',
              debitIdr: 0,
              creditIdr: serviceSubtotalIdr,
              memo: soServiceMemo,
            },
            {
              preferredAccountId: 'coa_2201',
              fallbackCode: '2201',
              fallbackName: 'PPN Keluaran',
              debitIdr: 0,
              creditIdr: ppnOutIdr,
              memo: `PPN Keluaran ${createdInvoice.invoiceNumber}`,
            },
          ],
        });
        if (arJournal) autoJournals.push(arJournal);

        const cogsIdr = so.items.reduce((sum, it) => {
          if (isServiceOrderItem(it, state.products)) return sum;
          const prod = state.products.find((p) => p.id === it.productId);
          if (!prod) return sum;
          return sum + it.qty * convertToIdr(prod.buyPrice, prod.currency, fxRate);
        }, 0);
        if (cogsIdr > 0) {
          const cogsJournal = buildResolvedJournalEntry({
            entryDate: now.slice(0, 10),
            journalType: 'Penjualan (AR)',
            referenceType: 'SO',
            referenceId: so.id,
            referenceNumber: so.soNumber,
            description: `Pengakuan Harga Pokok Penjualan ${so.soNumber}`,
            sequenceOffset: 1,
            rawLines: [
              {
                preferredAccountId: 'coa_5101',
                fallbackCode: '5101',
                fallbackName: 'Harga Pokok Penjualan (HPP)',
                debitIdr: cogsIdr,
                creditIdr: 0,
                memo: `HPP ${so.soNumber}`,
              },
              {
                preferredAccountId: 'coa_1301',
                fallbackCode: '1301',
                fallbackName: 'Persediaan Barang Dagang',
                debitIdr: 0,
                creditIdr: cogsIdr,
                memo: `Keluar persediaan ${so.soNumber}`,
              },
            ],
          });
          if (cogsJournal) autoJournals.push(cogsJournal);
        }
      }

      setState((prev) => ({
        ...prev,
        salesOrders: prev.salesOrders.map((s) =>
          s.id === soId ? { ...s, status: nextStatus, invoiceNumber, updatedAt: now } : s
        ),
        invoices: createdInvoice ? [createdInvoice, ...prev.invoices] : prev.invoices,
        journalEntries: autoJournals.length > 0 ? [...autoJournals, ...prev.journalEntries] : prev.journalEntries,
      }));

      if (authMode === 'firebase') {
        await saveFirestoreDoc('salesOrders', soId, { status: nextStatus, invoiceNumber }, false);
        if (createdInvoice) {
          const invPayload = { ...createdInvoice };
          delete invPayload.payments;
          await saveFirestoreDoc('invoices', createdInvoice.id, invPayload, true);
        }
        for (const jrn of autoJournals) {
          await saveFirestoreDoc('journalEntries', jrn.id, { ...jrn }, true);
        }
      }
      await recordAudit('Sales', `${so.soNumber} -> ${nextStatus}`, so.id, so.soNumber);
      toast.success(`${so.soNumber} diperbarui ke ${nextStatus}.`);
    },
    [authMode, buildResolvedJournalEntry, currentUser, recordAudit, state.customers, state.invoices, state.periodClosings, state.products, state.salesOrders, state.settings.defaultExchangeRateUsdIdr]
  );

  const deliverSalesOrder = useCallback(
    async (
      soId: string,
      deliverQuantities: Record<string, number>,
      notes: string,
      pod?: { receiverName?: string; file?: File | null }
    ) => {
      if (!currentUser || (!hasPermission(currentUser.role, 'so:deliver') && !hasPermission(currentUser.role, 'so:create'))) {
        toast.error('Role Anda tidak memiliki izin pengiriman Sales Order.');
        return;
      }
      const so = state.salesOrders.find((s) => s.id === soId);
      if (!so || !['Confirmed', 'Partially Delivered'].includes(so.status)) {
        toast.error('SO harus Confirmed sebelum pengiriman.');
        return;
      }

      const now = new Date().toISOString();
      let podImageUrl = so.podImageUrl;
      let podFileName = so.podFileName;
      const podReceiverName = sanitizeString(pod?.receiverName, 120) || so.podReceiverName;

      if (pod?.file) {
        try {
          const uploaded = await uploadPodDocument(
            pod.file,
            authMode === 'firebase' ? 'firebase' : 'preview'
          );
          podImageUrl = uploaded.url;
          podFileName = uploaded.fileName;
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Gagal mengunggah dokumen e-POD.');
          return;
        }
      }
      const podTimestamp =
        pod?.receiverName || pod?.file ? now.slice(0, 16).replace('T', ' ') : so.podTimestamp;

      const newMovements: StockMovement[] = [];
      const updatedStocksMap: Record<string, Record<string, number>> = {};
      let deliveredLineCount = 0;

      for (const item of so.items) {
        const reqQty = Math.max(0, Number(deliverQuantities[item.productId] || 0));
        const remaining = Math.max(0, item.qty - item.fulfilledQty);
        const actual = Math.min(remaining, reqQty);
        if (actual <= 0) continue;

        const prod = state.products.find((p) => p.id === item.productId);
        const isService = Boolean(item.isService || prod?.isService);
        if (!prod && !isService) continue;
        deliveredLineCount += 1;
        if (isService) continue;

        const available = prod!.warehouseStocks[so.warehouseId] ?? 0;
        if (actual > available) {
          toast.error(`Stok ${prod!.sku} di ${so.warehouseName} tidak mencukupi (tersedia: ${available}).`);
          return;
        }
        updatedStocksMap[prod!.id] = {
          ...prod!.warehouseStocks,
          [so.warehouseId]: available - actual,
        };
        newMovements.push({
          id: makeId('mov'),
          movementNumber: `GI-${Date.now().toString().slice(-6)}`,
          type: 'GOODS_ISSUE',
          referenceType: 'SO',
          referenceId: so.id,
          referenceNumber: so.soNumber,
          productId: prod!.id,
          productSku: prod!.sku,
          productName: prod!.name,
          warehouseId: so.warehouseId,
          warehouseName: so.warehouseName,
          quantityDelta: -actual,
          beforeQty: available,
          afterQty: available - actual,
          unitCost: prod!.buyPrice,
          notes: sanitizeString(notes, 400) || `Pengiriman ${so.soNumber}`,
          createdBy: currentUser.uid,
          createdByName: currentUser.displayName,
          createdAt: now,
        });
      }

      if (deliveredLineCount === 0) {
        toast.error('Masukkan minimal 1 kuantitas pengiriman.');
        return;
      }

      const updatedItems = so.items.map((item) => {
        const reqQty = Math.max(0, Number(deliverQuantities[item.productId] || 0));
        const remaining = Math.max(0, item.qty - item.fulfilledQty);
        return {
          ...item,
          fulfilledQty: item.fulfilledQty + Math.min(remaining, reqQty),
        };
      });

      const allDelivered = updatedItems.every((i) => i.fulfilledQty >= i.qty);
      const nextStatus: SoStatus = allDelivered ? 'Fully Delivered' : 'Partially Delivered';
      const podPatch = {
        ...(podImageUrl ? { podImageUrl, podFileName } : {}),
        ...(podReceiverName ? { podReceiverName } : {}),
        ...(podTimestamp ? { podTimestamp } : {}),
      };

      setState((prev) => ({
        ...prev,
        products: prev.products.map((p) =>
          updatedStocksMap[p.id] ? { ...p, warehouseStocks: updatedStocksMap[p.id], updatedAt: now } : p
        ),
        salesOrders: prev.salesOrders.map((s) =>
          s.id === so.id ? { ...s, items: updatedItems, status: nextStatus, ...podPatch, updatedAt: now } : s
        ),
        stockMovements: [...newMovements, ...prev.stockMovements],
      }));

      if (authMode === 'firebase') {
        for (const [pid, stocks] of Object.entries(updatedStocksMap)) {
          await saveFirestoreDoc('products', pid, { warehouseStocks: stocks }, false);
        }
        for (const mov of newMovements) {
          await createImmutableRecord('stockMovements', mov.id, { ...mov });
        }
        await saveFirestoreDoc('salesOrders', so.id, { items: updatedItems, status: nextStatus, ...podPatch }, false);
      }
      await recordAudit('Sales', `Pengiriman ${so.soNumber}`, so.id, so.soNumber, `Status: ${nextStatus}${podReceiverName ? `; Penerima e-POD: ${podReceiverName}` : ''}`);
      toast.success(`Pengiriman ${so.soNumber} tercatat (${nextStatus}).`);
    },
    [authMode, currentUser, recordAudit, state.products, state.salesOrders]
  );

  const deleteSalesOrder = useCallback(
    async (soId: string) => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus Sales Order.');
        return;
      }
      const target = state.salesOrders.find((s) => s.id === soId);
      if (!target) return;
      setState((prev) => ({
        ...prev,
        salesOrders: prev.salesOrders.filter((s) => s.id !== soId),
      }));
      if (authMode === 'firebase') {
        await deleteFirestoreDoc('salesOrders', soId);
      }
      await ensureSeedLockedInFirebase();
      await recordAudit('Sales', `Hapus ${target.soNumber}`, soId, target.soNumber, target.customerName);
      toast.success(`Sales Order ${target.soNumber} dihapus.`);
    },
    [authMode, currentUser, ensureSeedLockedInFirebase, recordAudit, state.salesOrders]
  );

  const clearDummySalesOrders = useCallback(async () => {
    if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
      toast.error('Hanya Direktur yang dapat menghapus SO dummy.');
      return;
    }
    const targets = findSeededDummyOrderTargets(state, createInitialSeedState());
    if (targets.soIds.length === 0) {
      toast.info('Tidak ada SO dummy yang tersisa.');
      return;
    }
    const soSet = new Set(targets.soIds);
    setState((prev) => ({
      ...prev,
      salesOrders: prev.salesOrders.filter((s) => !soSet.has(s.id)),
    }));
    if (authMode === 'firebase') {
      await deleteFirestoreDocsInChunks(
        targets.soIds.map((id) => ({ col: 'salesOrders', id })),
        10
      );
    }
    await ensureSeedLockedInFirebase();
    await recordAudit(
      'Sales',
      'Hapus Semua SO Dummy',
      'seed_cleanup_so',
      `${targets.soIds.length} SO dummy`
    );
    toast.success(`${targets.soIds.length} Sales Order dummy berhasil dihapus.`);
  }, [authMode, currentUser, ensureSeedLockedInFirebase, recordAudit, state]);

  // =========================================================================
  // Accounting & General Ledger (Buku Besar) Actions
  // =========================================================================
  const recordInvoicePayment = useCallback(
    async (
      invoiceId: string,
      input: {
        amount: number;
        paymentMethod: string;
        cashBankAccountId?: string;
        referenceNo: string;
        notes: string;
      }
    ) => {
      if (!currentUser || !hasPermission(currentUser.role, 'accounting:write')) {
        toast.error('Role Anda tidak memiliki izin pencatatan pembayaran.');
        return;
      }
      const inv = state.invoices.find((i) => i.id === invoiceId);
      if (!inv) return;
      const payAmt = Math.max(0, Number(input.amount) || 0);
      if (payAmt <= 0 || payAmt > inv.balanceDue + 0.01) {
        toast.error('Nominal pembayaran harus > 0 dan tidak melebihi sisa tagihan.');
        return;
      }

      const now = new Date().toISOString();
      const lockCheck = isDateInClosedPeriod(now.slice(0, 10), state.periodClosings);
      if (lockCheck.locked) {
        toast.error(`Periode akuntansi ${lockCheck.periodKey} sudah ditutup (Closed). Tidak dapat mencatat pembayaran.`);
        return;
      }
      const fxRate = inv.exchangeRate || state.settings.defaultExchangeRateUsdIdr;
      const payIdr = convertToIdr(payAmt, inv.currency, fxRate);

      if (inv.ledgerType === 'AP') {
        const supplier = state.suppliers.find((s) => s.id === inv.counterpartyId);
        const payCheck = validateSupplierForPayment({
          supplier,
          payAmountIdr: payIdr,
        });
        if (!payCheck.allowed) {
          toast.error(payCheck.reason || 'Pembayaran ke Supplier ditahan sebelum Approve Admin.');
          return;
        }
      }

      const newPaid = Math.min(inv.totalAmount, inv.paidAmount + payAmt);
      const { balanceDue, status } = computeInvoiceStatus(inv.totalAmount, newPaid, inv.dueDate);

      const resolvedCashAcc =
        (input.cashBankAccountId
          ? state.chartOfAccounts.find((a) => a.id === input.cashBankAccountId)
          : undefined) ||
        state.chartOfAccounts.find(
          (a) => a.id === pickCashBankAccountId(input.paymentMethod, state.chartOfAccounts)
        );
      const cashBankId =
        resolvedCashAcc?.id || pickCashBankAccountId(input.paymentMethod, state.chartOfAccounts);
      const cashBankCode =
        resolvedCashAcc?.code ||
        (cashBankId === 'coa_1101' ? '1101' : cashBankId === 'coa_1103' ? '1103' : '1102');
      const cashBankName =
        resolvedCashAcc?.name ||
        (cashBankId === 'coa_1101'
          ? 'Kas Kecil Operasional'
          : cashBankId === 'coa_1103'
            ? 'Bank BCA Operasional'
            : 'Bank Mandiri Korporat');

      const payment = {
        id: makeId('pay'),
        amount: payAmt,
        currency: inv.currency,
        exchangeRate: fxRate,
        paymentMethod: sanitizeString(input.paymentMethod, 120),
        referenceNo: sanitizeString(input.referenceNo, 80),
        notes: sanitizeString(input.notes, 300),
        recordedBy: currentUser.uid,
        recordedByName: currentUser.displayName,
        paidAt: now,
      };

      const paymentJournal = buildResolvedJournalEntry({
        entryDate: now.slice(0, 10),
        journalType: 'Kas & Bank',
        referenceType: inv.ledgerType === 'AP' ? 'PAYMENT_AP' : 'PAYMENT_AR',
        referenceId: inv.id,
        referenceNumber: payment.referenceNo || inv.invoiceNumber,
        description:
          inv.ledgerType === 'AP'
            ? `Pembayaran Hutang ${inv.invoiceNumber} ke ${inv.counterpartyName || 'Supplier'}`
            : `Penerimaan Piutang ${inv.invoiceNumber} dari ${inv.counterpartyName || 'Customer'}`,
        rawLines:
          inv.ledgerType === 'AP'
            ? [
                {
                  preferredAccountId: 'coa_2101',
                  fallbackCode: '2101',
                  fallbackName: 'Hutang Usaha (AP)',
                  debitIdr: payIdr,
                  creditIdr: 0,
                  memo: `Pembayaran ${inv.invoiceNumber}`,
                },
                {
                  preferredAccountId: cashBankId,
                  fallbackCode: cashBankCode,
                  fallbackName: cashBankName,
                  debitIdr: 0,
                  creditIdr: payIdr,
                  memo: `${payment.paymentMethod} (${payment.referenceNo})`,
                },
              ]
            : [
                {
                  preferredAccountId: cashBankId,
                  fallbackCode: cashBankCode,
                  fallbackName: cashBankName,
                  debitIdr: payIdr,
                  creditIdr: 0,
                  memo: `${payment.paymentMethod} (${payment.referenceNo})`,
                },
                {
                  preferredAccountId: 'coa_1201',
                  fallbackCode: '1201',
                  fallbackName: 'Piutang Usaha (AR)',
                  debitIdr: 0,
                  creditIdr: payIdr,
                  memo: `Pelunasan ${inv.invoiceNumber}`,
                },
              ],
      });

      setState((prev) => ({
        ...prev,
        invoices: prev.invoices.map((i) =>
          i.id === invoiceId
            ? {
                ...i,
                paidAmount: newPaid,
                balanceDue,
                status,
                updatedAt: now,
                payments: [...(i.payments || []), payment],
              }
            : i
        ),
        journalEntries: paymentJournal ? [paymentJournal, ...prev.journalEntries] : prev.journalEntries,
      }));

      if (authMode === 'firebase') {
        await saveFirestoreDoc(
          'invoices',
          invoiceId,
          { paidAmount: newPaid, balanceDue, status },
          false
        );
        await appendInvoicePayment(invoiceId, payment);
        if (paymentJournal) {
          await saveFirestoreDoc('journalEntries', paymentJournal.id, { ...paymentJournal }, true);
        }
      }
      await recordAudit(
        'Accounting',
        `Pembayaran ${inv.invoiceNumber}`,
        invoiceId,
        inv.invoiceNumber,
        `Akun: ${cashBankCode} ${cashBankName}; Nominal: ${payAmt} ${inv.currency}; Status: ${status}.`
      );
      toast.success(
        `Pembayaran ${inv.invoiceNumber} tercatat ke akun ${cashBankCode} — ${cashBankName} (${status}).`
      );
    },
    [
      authMode,
      buildResolvedJournalEntry,
      currentUser,
      recordAudit,
      state.chartOfAccounts,
      state.invoices,
      state.periodClosings,
      state.settings.defaultExchangeRateUsdIdr,
      state.suppliers,
    ]
  );

  const saveChartAccount = useCallback(
    async (input: {
      id?: string;
      isNew: boolean;
      code: string;
      name: string;
      category: AccountCategory;
      normalBalance: NormalBalance;
      openingBalanceIdr: number;
      description?: string;
      active: boolean;
    }): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'accounting:write')) {
        toast.error('Role Anda tidak memiliki izin mengelola Daftar Akun (CoA).');
        return false;
      }
      const cleanCode = sanitizeString(input.code, 24);
      const cleanName = sanitizeString(input.name, 160);
      if (cleanCode.length < 2 || cleanName.length < 2) {
        toast.error('Kode dan nama akun wajib diisi minimal 2 karakter.');
        return false;
      }
      const duplicateCode = state.chartOfAccounts.some(
        (a) => a.id !== input.id && a.code.trim().toLowerCase() === cleanCode.toLowerCase()
      );
      if (duplicateCode) {
        toast.error(`Kode akun "${cleanCode}" sudah digunakan.`);
        return false;
      }

      const now = new Date().toISOString();
      const targetId = input.isNew ? makeId('coa') : input.id || '';
      if (!targetId) return false;
      const existing = state.chartOfAccounts.find((a) => a.id === targetId);

      const account: ChartAccount = {
        id: targetId,
        code: cleanCode,
        name: cleanName,
        category: input.category,
        normalBalance: input.normalBalance,
        openingBalanceIdr: Math.round(Number(input.openingBalanceIdr) || 0),
        description: sanitizeString(input.description, 400),
        active: input.active,
        createdBy: existing?.createdBy || currentUser.uid,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };

      setState((prev) => ({
        ...prev,
        chartOfAccounts: input.isNew
          ? [...prev.chartOfAccounts, account]
          : prev.chartOfAccounts.map((a) => (a.id === targetId ? { ...a, ...account, createdAt: a.createdAt } : a)),
      }));

      if (authMode === 'firebase') {
        await saveFirestoreDoc('chartOfAccounts', targetId, { ...account }, input.isNew);
      }

      await recordAudit(
        'Accounting',
        input.isNew ? 'Tambah Akun CoA' : 'Update Akun CoA',
        targetId,
        `${account.code} ${account.name}`
      );
      toast.success(`Akun ${account.code} — ${account.name} tersimpan.`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.chartOfAccounts]
  );

  const createJournalEntry = useCallback(
    async (input: {
      entryDate: string;
      journalType: JournalEntryType;
      referenceNumber?: string;
      description: string;
      lines: Array<{ accountId: string; debitIdr: number; creditIdr: number; memo?: string }>;
    }): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'accounting:write')) {
        toast.error('Role Anda tidak memiliki izin mencatat Jurnal Umum.');
        return false;
      }
      const cleanDesc = sanitizeString(input.description, 400);
      if (cleanDesc.length < 2) {
        toast.error('Keterangan transaksi jurnal wajib diisi.');
        return false;
      }
      if (!input.entryDate || input.entryDate.length < 8) {
        toast.error('Tanggal transaksi jurnal tidak valid.');
        return false;
      }
      const lockCheck = isDateInClosedPeriod(input.entryDate, state.periodClosings);
      if (lockCheck.locked) {
        toast.error(`Periode akuntansi ${lockCheck.periodKey} sudah ditutup (Closed). Jurnal tidak dapat diposting.`);
        return false;
      }

      const resolvedLines: JournalLine[] = input.lines.map((l) => {
        const acc = state.chartOfAccounts.find((a) => a.id === l.accountId);
        const cleanMemo = l.memo ? sanitizeString(l.memo, 160) : '';
        return {
          accountId: l.accountId,
          accountCode: acc?.code || '-',
          accountName: acc?.name || '-',
          debitIdr: Math.max(0, Math.round(Number(l.debitIdr) || 0)),
          creditIdr: Math.max(0, Math.round(Number(l.creditIdr) || 0)),
          ...(cleanMemo ? { memo: cleanMemo } : {}),
        };
      });

      const validation = validateBalancedJournalLines(resolvedLines);
      if (!validation.valid) {
        toast.error(validation.error || 'Jurnal tidak seimbang.');
        return false;
      }

      const now = new Date().toISOString();
      const jrnId = makeId('jrn');
      const seq = String(state.journalEntries.length + 1).padStart(4, '0');
      const entryNumber = `JRN-${(input.entryDate || '').slice(0, 4) || '2026'}-${seq}`;
      const cleanRef = input.referenceNumber ? sanitizeString(input.referenceNumber, 48) : '';

      const entry: JournalEntry = {
        id: jrnId,
        entryNumber,
        entryDate: input.entryDate,
        journalType: input.journalType,
        referenceType: 'MANUAL',
        ...(cleanRef ? { referenceNumber: cleanRef } : {}),
        description: cleanDesc,
        lines: resolvedLines,
        totalDebitIdr: validation.totalDebitIdr,
        totalCreditIdr: validation.totalCreditIdr,
        status: 'Posted',
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName,
        createdAt: now,
        updatedAt: now,
      };

      setState((prev) => ({
        ...prev,
        journalEntries: [entry, ...prev.journalEntries],
      }));

      try {
        if (authMode === 'firebase') {
          await saveFirestoreDoc('journalEntries', jrnId, { ...entry }, true);
        }

        await recordAudit('Accounting', `Buat Jurnal ${entryNumber}`, jrnId, entryNumber, cleanDesc);
        toast.success(`Jurnal ${entryNumber} berhasil diposting ke Buku Besar.`);
        return true;
      } catch (err) {
        setState((prev) => ({
          ...prev,
          journalEntries: prev.journalEntries.filter((j) => j.id !== jrnId),
        }));
        console.error('Gagal menyimpan jurnal:', err);
        toast.error('Gagal menyimpan jurnal ke server. Pastikan nominal dan akun sudah valid.');
        return false;
      }
    },
    [authMode, currentUser, recordAudit, state.chartOfAccounts, state.journalEntries.length, state.periodClosings]
  );

  const voidJournalEntry = useCallback(
    async (entryId: string) => {
      if (!currentUser || !hasPermission(currentUser.role, 'accounting:write')) {
        toast.error('Role Anda tidak memiliki izin membatalkan (Void) jurnal.');
        return;
      }
      const target = state.journalEntries.find((j) => j.id === entryId);
      if (!target || target.status === 'Void') return;

      const lockCheck = isDateInClosedPeriod(target.entryDate, state.periodClosings);
      if (lockCheck.locked) {
        toast.error(`Periode akuntansi ${lockCheck.periodKey} sudah ditutup (Closed). Tidak dapat mem-Void jurnal.`);
        return;
      }

      const now = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        journalEntries: prev.journalEntries.map((j) =>
          j.id === entryId ? { ...j, status: 'Void', updatedAt: now } : j
        ),
      }));

      if (authMode === 'firebase') {
        await saveFirestoreDoc('journalEntries', entryId, { status: 'Void' }, false);
      }

      await recordAudit('Accounting', `Void Jurnal ${target.entryNumber}`, entryId, target.entryNumber, target.description);
      toast.success(`Jurnal ${target.entryNumber} dibatalkan (Void). Saldo Buku Besar diperbarui.`);
    },
    [authMode, currentUser, recordAudit, state.journalEntries, state.periodClosings]
  );

  const deleteJournalEntry = useCallback(
    async (entryId: string) => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus permanen dokumen jurnal.');
        return;
      }
      const target = state.journalEntries.find((j) => j.id === entryId);
      if (!target) return;

      setState((prev) => ({
        ...prev,
        journalEntries: prev.journalEntries.filter((j) => j.id !== entryId),
      }));

      if (authMode === 'firebase') {
        await deleteFirestoreDoc('journalEntries', entryId);
      }

      await ensureSeedLockedInFirebase();
      await recordAudit('Accounting', `Hapus Jurnal ${target.entryNumber}`, entryId, target.entryNumber);
      toast.success(`Jurnal ${target.entryNumber} dihapus permanen.`);
    },
    [authMode, currentUser, ensureSeedLockedInFirebase, recordAudit, state.journalEntries]
  );

  const clearDummyJournalEntries = useCallback(async () => {
    if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
      toast.error('Hanya Direktur yang dapat membersihkan jurnal dummy.');
      return;
    }
    const targetIds = findSeededDummyAccountingTargets(state, createInitialSeedState());
    if (targetIds.length === 0) {
      toast.info('Tidak ada jurnal dummy bawaan yang tersisa.');
      return;
    }
    const idSet = new Set(targetIds);
    setState((prev) => ({
      ...prev,
      journalEntries: prev.journalEntries.filter((j) => !idSet.has(j.id)),
    }));
    if (authMode === 'firebase') {
      await deleteFirestoreDocsInChunks(
        targetIds.map((id) => ({ col: 'journalEntries', id })),
        10
      );
    }
    await ensureSeedLockedInFirebase();
    await recordAudit('Accounting', 'Hapus Semua Jurnal Dummy', 'seed_cleanup_jrn', `${targetIds.length} jurnal`);
    toast.success(`${targetIds.length} jurnal dummy berhasil dihapus.`);
  }, [authMode, currentUser, ensureSeedLockedInFirebase, recordAudit, state]);

  // =========================================================================
  // System Settings & Notifications
  // =========================================================================
  const updateCompanySettings = useCallback(
    async (input: Partial<CompanySettings>) => {
      if (!currentUser || !hasPermission(currentUser.role, 'system:settings')) {
        toast.error('Akses ditolak untuk mengubah pengaturan perusahaan.');
        return;
      }
      const companyName = sanitizeString(
        input.companyName ?? state.settings.companyName,
        160
      );
      if (companyName.length < 2) {
        toast.error('Nama perusahaan minimal 2 karakter.');
        return;
      }
      const exchangeRate = Number(
        input.defaultExchangeRateUsdIdr ?? state.settings.defaultExchangeRateUsdIdr
      );
      if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
        toast.error('Kurs 1 USD harus lebih besar dari 0.');
        return;
      }
      const taxRate = Number(input.taxRatePercent ?? state.settings.taxRatePercent);
      if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
        toast.error('Tarif PPN harus antara 0% sampai 100%.');
        return;
      }

      const prevSettings = state.settings;
      const now = new Date().toISOString();
      const updated: CompanySettings = {
        ...state.settings,
        ...input,
        id: 'company',
        companyName,
        tagline: sanitizeString(input.tagline ?? state.settings.tagline, 200),
        npwp: sanitizeString(input.npwp ?? state.settings.npwp, 40),
        address: sanitizeString(input.address ?? state.settings.address, 400),
        phone: sanitizeString(input.phone ?? state.settings.phone, 40),
        email: sanitizeString(input.email ?? state.settings.email, 254),
        bankName: sanitizeString(input.bankName ?? state.settings.bankName, 120),
        bankAccountNumber: sanitizeString(
          input.bankAccountNumber ?? state.settings.bankAccountNumber,
          64
        ),
        bankAccountHolder: sanitizeString(
          input.bankAccountHolder ?? state.settings.bankAccountHolder,
          160
        ),
        managerApprovalLimitIdr: Math.max(
          0,
          Number(
            input.managerApprovalLimitIdr ??
              state.settings.managerApprovalLimitIdr ??
              DEFAULT_MANAGER_APPROVAL_LIMIT_IDR
          )
        ),
        defaultExchangeRateUsdIdr: exchangeRate,
        taxRatePercent: taxRate,
        updatedBy: currentUser.uid,
        updatedAt: now,
      };
      setState((prev) => ({ ...prev, settings: updated }));
      try {
        if (authMode === 'firebase') {
          await saveFirestoreDoc('settings', 'company', { ...updated }, false);
        }
        await recordAudit('System', 'Update Pengaturan Perusahaan', 'company', updated.companyName);
        toast.success('Pengaturan perusahaan diperbarui.');
      } catch (err) {
        setState((prev) => ({ ...prev, settings: prevSettings }));
        const msg = err instanceof Error ? err.message : 'Gagal menyimpan pengaturan perusahaan.';
        toast.error(msg);
      }
    },
    [authMode, currentUser, recordAudit, state.settings]
  );

  const markNotificationRead = useCallback(
    async (notifId: string) => {
      if (!currentUser) return;
      const notif = state.notifications.find((n) => n.id === notifId);
      if (!notif) return;
      const readBy = Array.from(new Set([...(notif.readBy || []), currentUser.uid]));
      setState((prev) => ({
        ...prev,
        notifications: prev.notifications.map((n) => (n.id === notifId ? { ...n, readBy } : n)),
      }));
      if (authMode === 'firebase') {
        await markNotificationReadInFirestore(notifId, readBy);
      }
    },
    [authMode, currentUser, state.notifications]
  );

  // =========================================================================
  // Enterprise Level-Up Actions
  // =========================================================================
  const saveCustomerContractPrices = useCallback(
    async (customerId: string, contractPrices: CustomerPriceTier[]): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'buyer:write')) {
        toast.error('Role Anda tidak memiliki izin mengelola Harga Kontrak Buyer.');
        return false;
      }
      const target = state.customers.find((c) => c.id === customerId);
      if (!target) return false;
      const cleanTiers: CustomerPriceTier[] = contractPrices
        .filter((t) => t.productId && Number(t.unitPrice) >= 0)
        .slice(0, 100)
        .map((t) => ({
          productId: t.productId,
          unitPrice: Math.max(0, Number(t.unitPrice) || 0),
          ...(t.currency ? { currency: t.currency } : {}),
          ...(t.minQty && Number(t.minQty) > 0 ? { minQty: Math.round(Number(t.minQty)) } : {}),
          ...(t.validUntil ? { validUntil: sanitizeString(t.validUntil, 32) } : {}),
        }));
      const now = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        customers: prev.customers.map((c) =>
          c.id === customerId ? { ...c, contractPrices: cleanTiers, updatedAt: now } : c
        ),
      }));
      if (authMode === 'firebase') {
        await saveFirestoreDoc('customers', customerId, { contractPrices: cleanTiers }, false);
      }
      await recordAudit(
        'Sales',
        'Update Harga Kontrak Buyer',
        customerId,
        target.name,
        `${cleanTiers.length} item kontrak`
      );
      toast.success(`Harga kontrak untuk ${target.name} tersimpan (${cleanTiers.length} item).`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.customers]
  );

  const saveSalesQuotation = useCallback(
    async (input: {
      id?: string;
      isNew: boolean;
      customerId: string;
      warehouseId: string;
      currency: CurrencyCode;
      validUntil: string;
      validityPeriod?: string;
      leadTime?: string;
      paymentTerm?: string;
      paymentTermCustom?: string;
      incoterm?: string;
      deliveryLocation?: string;
      termsAndConditions?: string;
      notes: string;
      items: Array<{
        productId: string;
        qty: number;
        unitPrice: number;
        isService?: boolean;
        productName?: string;
        sku?: string;
        uomCode?: string;
      }>;
      sendImmediately?: boolean;
    }): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'quotation:write')) {
        toast.error('Role Anda tidak memiliki izin membuat/mengubah Quotation.');
        return false;
      }
      const customer = state.customers.find((c) => c.id === input.customerId);
      const warehouse = state.warehouses.find((w) => w.id === input.warehouseId);
      if (!customer || !warehouse || input.items.length === 0) {
        toast.error('Lengkapi Buyer, Gudang, dan minimal 1 produk.');
        return false;
      }
      const orderItems: OrderItem[] = [];
      for (const it of input.items) {
        const prod = state.products.find((p) => p.id === it.productId);
        if (!prod && !it.isService) continue;
        const isService = Boolean(it.isService || prod?.isService);
        const manualName = sanitizeString(it.productName, 180).trim();
        if (!prod && isService && !manualName) {
          toast.error('Tuliskan nama / keterangan jasa pada baris Service.');
          return false;
        }
        const rawQty = Number(it.qty);
        if (!Number.isFinite(rawQty) || rawQty < 1) {
          toast.error('Qty setiap item/jasa harus minimal 1.');
          return false;
        }
        const qty = Math.round(rawQty);
        const price = Math.max(0, Number(it.unitPrice) || 0);
        orderItems.push({
          productId: prod?.id || sanitizeString(it.productId, 128) || makeId('svc'),
          sku: prod?.sku || sanitizeString(it.sku, 40) || 'SRV-MANUAL',
          productName: prod?.name || manualName,
          uomCode: prod?.uomCode || sanitizeString(it.uomCode, 16) || 'JASA',
          qty,
          fulfilledQty: 0,
          unitPrice: price,
          lineTotal: Math.round(qty * price * 100) / 100,
          ...(isService ? { isService: true } : {}),
        });
      }
      if (orderItems.length === 0) {
        toast.error('Minimal 1 item valid harus dipilih.');
        return false;
      }

      const defaultBuyerTerm = mapCustomerToPaymentTerm(customer);
      const paymentTerm = sanitizeString(input.paymentTerm || defaultBuyerTerm.paymentTerm, 80);
      const paymentTermCustom =
        paymentTerm === 'Custom'
          ? sanitizeString(input.paymentTermCustom || defaultBuyerTerm.paymentTermCustom, 120)
          : '';
      if (paymentTerm === 'Custom' && !paymentTermCustom) {
        toast.error('Isi keterangan Payment Term Custom.');
        return false;
      }
      const incoterm = sanitizeString(input.incoterm || getDefaultSalesIncoterm(), 80);
      const deliveryLocation = sanitizeString(
        input.deliveryLocation || getDefaultSalesDeliveryLocation(incoterm, customer, warehouse),
        300
      );
      if (!deliveryLocation) {
        toast.error('Lokasi pengiriman pada Terms & Conditions wajib diisi.');
        return false;
      }

      const now = new Date().toISOString();
      const validUntil = sanitizeString(input.validUntil, 32) || now.slice(0, 10);
      const validityPeriod = sanitizeString(
        input.validityPeriod || computeValidityPeriodLabel(now.slice(0, 10), validUntil),
        80
      );
      const leadTime = sanitizeString(input.leadTime || '3-5 Hari Kerja setelah PO diterima', 80);
      const termsAndConditions = sanitizeString(
        input.termsAndConditions || getDefaultQuotationTerms(),
        2000
      );

      const totals = calculateOrderTotals(orderItems, getEffectiveTaxRatePercent(state.settings));
      const qtId = input.isNew ? makeId('qt') : input.id || makeId('qt');
      const existing = state.salesQuotations.find((q) => q.id === qtId);
      const quotationNumber =
        existing?.quotationNumber ||
        buildNextSequentialDocNumber(
          'QTN-2026-',
          state.salesQuotations.map((q) => q.quotationNumber),
          1
        );
      const status: QuotationStatus = input.sendImmediately
        ? 'Sent'
        : existing?.status || 'Draft';

      const quotation: SalesQuotation = {
        id: qtId,
        quotationNumber,
        customerId: customer.id,
        customerName: customer.name,
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        currency: input.currency,
        status,
        items: orderItems,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        validUntil,
        validityPeriod,
        leadTime,
        paymentTerm,
        ...(paymentTermCustom ? { paymentTermCustom } : {}),
        incoterm,
        deliveryLocation,
        termsAndConditions,
        notes: sanitizeString(input.notes, BLUEPRINT_CONSTRAINTS.NOTES_MAX_LENGTH),
        createdBy: existing?.createdBy || currentUser.uid,
        createdByName: existing?.createdByName || currentUser.displayName,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };

      setState((prev) => ({
        ...prev,
        salesQuotations: input.isNew
          ? [quotation, ...prev.salesQuotations]
          : prev.salesQuotations.map((q) => (q.id === qtId ? { ...q, ...quotation } : q)),
      }));
      if (authMode === 'firebase') {
        await saveFirestoreDoc('salesQuotations', qtId, { ...quotation }, input.isNew);
      }
      await recordAudit(
        'Sales',
        input.isNew ? `Buat Quotation ${quotationNumber}` : `Update Quotation ${quotationNumber}`,
        qtId,
        quotationNumber,
        customer.name
      );
      toast.success(`${quotationNumber} berhasil disimpan (${status}).`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.customers, state.products, state.salesQuotations, state.settings, state.warehouses]
  );

  const updateQuotationStatus = useCallback(
    async (qtId: string, status: QuotationStatus): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'quotation:write')) {
        toast.error('Role Anda tidak memiliki izin mengubah status Quotation.');
        return false;
      }
      const qt = state.salesQuotations.find((q) => q.id === qtId);
      if (!qt) return false;
      const now = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        salesQuotations: prev.salesQuotations.map((q) =>
          q.id === qtId ? { ...q, status, updatedAt: now } : q
        ),
      }));
      if (authMode === 'firebase') {
        await saveFirestoreDoc('salesQuotations', qtId, { status }, false);
      }
      await recordAudit('Sales', `${qt.quotationNumber} -> ${status}`, qtId, qt.quotationNumber);
      toast.success(`${qt.quotationNumber} diperbarui ke ${status}.`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.salesQuotations]
  );

  const convertQuotationToSo = useCallback(
    async (qtId: string): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'so:create')) {
        toast.error('Role Anda tidak memiliki izin membuat Sales Order.');
        return false;
      }
      const qt = state.salesQuotations.find((q) => q.id === qtId);
      if (!qt) return false;
      if (qt.status === 'Converted' || qt.convertedSoId) {
        toast.info(`Quotation ${qt.quotationNumber} sudah dikonversi ke ${qt.convertedSoNumber || 'SO'}.`);
        return false;
      }
      const customer = state.customers.find((c) => c.id === qt.customerId);
      const warehouse = state.warehouses.find((w) => w.id === qt.warehouseId);
      if (!customer || !warehouse) return false;

      const newOrderAmountIdr = convertToIdr(
        qt.totalAmount,
        qt.currency,
        state.settings.defaultExchangeRateUsdIdr
      );
      const openArIdr = computeOpenArForCustomerIdr(
        state.invoices,
        customer.id,
        state.settings.defaultExchangeRateUsdIdr
      );
      const buyerCheck = validateBuyerForSalesOrder({
        customer,
        newOrderAmountIdr,
        openArIdr,
      });
      if (!buyerCheck.allowed) {
        toast.error(buyerCheck.reason || 'Buyer belum memenuhi syarat Credit Limit.');
        return false;
      }

      const now = new Date().toISOString();
      const soId = makeId('so');
      const soNumber = buildNextSequentialDocNumber(
        'SO-2026-',
        state.salesOrders.map((s) => s.soNumber),
        160
      );
      const inheritedTerms = inheritTermsFromQuotation(qt, customer, warehouse);
      const dueDate = computeDueDateFromPaymentTerm(
        inheritedTerms.paymentTerm,
        inheritedTerms.paymentTermCustom
      );

      const newSo: SalesOrder = {
        id: soId,
        soNumber,
        customerId: customer.id,
        customerName: customer.name,
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        currency: qt.currency,
        status: 'Draft',
        items: qt.items.map((it) => ({ ...it, fulfilledQty: 0 })),
        subtotal: qt.subtotal,
        taxAmount: qt.taxAmount,
        totalAmount: qt.totalAmount,
        dueDate,
        quotationId: qt.id,
        quotationNumber: qt.quotationNumber,
        notes: sanitizeString(
          `Konversi dari ${qt.quotationNumber}${qt.notes ? ` — ${qt.notes}` : ''}`,
          BLUEPRINT_CONSTRAINTS.NOTES_MAX_LENGTH
        ),
        paymentTerm: inheritedTerms.paymentTerm,
        ...(inheritedTerms.paymentTermCustom
          ? { paymentTermCustom: inheritedTerms.paymentTermCustom }
          : {}),
        incoterm: inheritedTerms.incoterm,
        deliveryLocation: sanitizeString(inheritedTerms.deliveryLocation, 300),
        termsAndConditions: sanitizeString(inheritedTerms.termsAndConditions, 2000),
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName,
        createdAt: now,
        updatedAt: now,
      };

      setState((prev) => ({
        ...prev,
        salesOrders: [newSo, ...prev.salesOrders],
        salesQuotations: prev.salesQuotations.map((q) =>
          q.id === qt.id
            ? {
                ...q,
                status: 'Converted',
                convertedSoId: soId,
                convertedSoNumber: soNumber,
                updatedAt: now,
              }
            : q
        ),
      }));

      if (authMode === 'firebase') {
        await saveFirestoreDoc('salesOrders', soId, { ...newSo }, true);
        await saveFirestoreDoc(
          'salesQuotations',
          qt.id,
          { status: 'Converted', convertedSoId: soId, convertedSoNumber: soNumber },
          false
        );
      }
      await recordAudit(
        'Sales',
        `Konversi ${qt.quotationNumber} -> ${soNumber}`,
        soId,
        soNumber,
        customer.name
      );
      toast.success(`${qt.quotationNumber} berhasil dikonversi menjadi ${soNumber} (Draft).`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.customers, state.invoices, state.salesOrders, state.salesQuotations, state.settings.defaultExchangeRateUsdIdr, state.warehouses]
  );

  const saveVendorRfq = useCallback(
    async (input: {
      id?: string;
      isNew: boolean;
      title: string;
      warehouseId: string;
      deadlineDate: string;
      notes: string;
      invitedSupplierIds: string[];
      items: Array<{ productId: string; qty: number; unitPrice: number }>;
      openImmediately?: boolean;
    }): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'rfq:write')) {
        toast.error('Role Anda tidak memiliki izin mengelola Vendor RFQ.');
        return false;
      }
      const cleanTitle = sanitizeString(input.title, 160);
      const warehouse = state.warehouses.find((w) => w.id === input.warehouseId);
      if (cleanTitle.length < 2 || !warehouse || input.items.length === 0) {
        toast.error('Judul RFQ, Gudang, dan minimal 1 produk wajib diisi.');
        return false;
      }
      const orderItems: OrderItem[] = [];
      for (const it of input.items) {
        const prod = state.products.find((p) => p.id === it.productId);
        if (!prod) continue;
        const qty = Math.max(1, Number(it.qty));
        const price = Math.max(0, Number(it.unitPrice));
        orderItems.push({
          productId: prod.id,
          sku: prod.sku,
          productName: prod.name,
          uomCode: prod.uomCode,
          qty,
          fulfilledQty: 0,
          unitPrice: price,
          lineTotal: Math.round(qty * price * 100) / 100,
          ...(prod.isService ? { isService: true } : {}),
        });
      }
      if (orderItems.length === 0) {
        toast.error('Minimal 1 item valid wajib dipilih.');
        return false;
      }
      const now = new Date().toISOString();
      const rfqId = input.isNew ? makeId('rfq') : input.id || makeId('rfq');
      const existing = state.vendorRfqs.find((r) => r.id === rfqId);
      const rfqNumber =
        existing?.rfqNumber ||
        `RFQ-2026-${String(state.vendorRfqs.length + 1).padStart(4, '0')}`;
      const rfq: VendorRfq = {
        id: rfqId,
        rfqNumber,
        title: cleanTitle,
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        deadlineDate: sanitizeString(input.deadlineDate, 32) || now.slice(0, 10),
        status: input.openImmediately ? 'Open' : existing?.status || 'Draft',
        items: orderItems,
        invitedSupplierIds: input.invitedSupplierIds.slice(0, 20),
        quotes: existing?.quotes || [],
        notes: sanitizeString(input.notes, BLUEPRINT_CONSTRAINTS.NOTES_MAX_LENGTH),
        createdBy: existing?.createdBy || currentUser.uid,
        createdByName: existing?.createdByName || currentUser.displayName,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      setState((prev) => ({
        ...prev,
        vendorRfqs: input.isNew
          ? [rfq, ...prev.vendorRfqs]
          : prev.vendorRfqs.map((r) => (r.id === rfqId ? { ...r, ...rfq } : r)),
      }));
      if (authMode === 'firebase') {
        await saveFirestoreDoc('vendorRfqs', rfqId, { ...rfq }, input.isNew);
      }
      await recordAudit('Procurement', `Simpan ${rfqNumber}`, rfqId, rfqNumber, cleanTitle);
      toast.success(`${rfqNumber} tersimpan (${rfq.status}).`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.products, state.vendorRfqs, state.warehouses]
  );

  const submitVendorRfqQuote = useCallback(
    async (
      rfqId: string,
      quote: Omit<VendorRfqQuote, 'supplierName' | 'submittedAt'>
    ): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'rfq:write')) {
        toast.error('Role Anda tidak memiliki izin mencatat penawaran vendor.');
        return false;
      }
      const rfq = state.vendorRfqs.find((r) => r.id === rfqId);
      const supplier = state.suppliers.find((s) => s.id === quote.supplierId);
      if (!rfq || !supplier) return false;
      const now = new Date().toISOString();
      const newQuote: VendorRfqQuote = {
        supplierId: supplier.id,
        supplierName: supplier.name,
        currency: quote.currency,
        unitPrices: quote.unitPrices,
        leadTimeDays: Math.max(0, Math.round(Number(quote.leadTimeDays) || 0)),
        notes: sanitizeString(quote.notes, 300),
        submittedAt: now,
      };
      const updatedQuotes = [
        ...rfq.quotes.filter((q) => q.supplierId !== supplier.id),
        newQuote,
      ];
      const invited = rfq.invitedSupplierIds.includes(supplier.id)
        ? rfq.invitedSupplierIds
        : [...rfq.invitedSupplierIds, supplier.id];
      const nextStatus = rfq.status === 'Draft' ? 'Open' : rfq.status;

      setState((prev) => ({
        ...prev,
        vendorRfqs: prev.vendorRfqs.map((r) =>
          r.id === rfqId
            ? { ...r, invitedSupplierIds: invited, quotes: updatedQuotes, status: nextStatus, updatedAt: now }
            : r
        ),
      }));
      if (authMode === 'firebase') {
        await saveFirestoreDoc(
          'vendorRfqs',
          rfqId,
          { invitedSupplierIds: invited, quotes: updatedQuotes, status: nextStatus },
          false
        );
      }
      await recordAudit(
        'Procurement',
        `Input Penawaran Vendor ${rfq.rfqNumber}`,
        rfqId,
        supplier.name
      );
      toast.success(`Penawaran dari ${supplier.name} tercatat di ${rfq.rfqNumber}.`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.suppliers, state.vendorRfqs]
  );

  const awardRfqToPo = useCallback(
    async (rfqId: string, supplierId: string): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'po:create')) {
        toast.error('Role Anda tidak memiliki izin menerbitkan PO dari RFQ.');
        return false;
      }
      const rfq = state.vendorRfqs.find((r) => r.id === rfqId);
      const supplier = state.suppliers.find((s) => s.id === supplierId);
      if (!rfq || !supplier) return false;
      const quote = rfq.quotes.find((q) => q.supplierId === supplierId);
      if (!quote) {
        toast.error('Supplier belum memiliki penawaran pada RFQ ini.');
        return false;
      }

      const orderItems: OrderItem[] = rfq.items.map((it) => {
        const price = Math.max(0, Number(quote.unitPrices[it.productId] ?? it.unitPrice));
        return {
          ...it,
          fulfilledQty: 0,
          unitPrice: price,
          lineTotal: Math.round(it.qty * price * 100) / 100,
        };
      });
      const totals = calculateOrderTotals(orderItems, getEffectiveTaxRatePercent(state.settings));
      const totalAmountIdr = convertToIdr(
        totals.totalAmount,
        quote.currency,
        state.settings.defaultExchangeRateUsdIdr
      );
      const supCheck = validateSupplierForPurchaseOrder({
        supplier,
        totalAmountIdr,
      });
      if (!supCheck.allowed) {
        toast.error(supCheck.reason || 'Supplier belum terverifikasi Admin.');
        return false;
      }

      const now = new Date().toISOString();
      const poId = makeId('po');
      const poNumber = buildNextSequentialDocNumber(
        'PO-2026-',
        state.purchaseOrders.map((p) => p.poNumber),
        92
      );
      const warehouse = state.warehouses.find((w) => w.id === rfq.warehouseId);
      const vendorTerm = mapSupplierToPaymentTerm(supplier);
      const incoterm = getDefaultPoIncoterm(supplier);
      const deliveryLocation = getDefaultPoDeliveryLocation(
        incoterm,
        supplier,
        warehouse,
        state.settings
      );
      const expectedDate = new Date(Date.now() + Math.max(1, quote.leadTimeDays) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const approvalTierRequired: 'Manager' | 'Direktur' = requiresDirectorApproval(
        totalAmountIdr,
        state.settings.managerApprovalLimitIdr ?? DEFAULT_MANAGER_APPROVAL_LIMIT_IDR
      )
        ? 'Direktur'
        : 'Manager';
      const initialLog = {
        id: makeId('log'),
        action: `PO Dibuat dari Award ${rfq.rfqNumber}`,
        actorId: currentUser.uid,
        actorName: currentUser.displayName,
        timestamp: now,
      };
      const newPo: PurchaseOrder = {
        id: poId,
        poNumber,
        supplierId: supplier.id,
        supplierName: supplier.name,
        warehouseId: rfq.warehouseId,
        warehouseName: rfq.warehouseName,
        currency: quote.currency,
        exchangeRate: state.settings.defaultExchangeRateUsdIdr,
        status: 'Draft',
        items: orderItems,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        expectedDate,
        notes: sanitizeString(
          `Award dari ${rfq.rfqNumber} (Lead time ${quote.leadTimeDays} hari)`,
          BLUEPRINT_CONSTRAINTS.NOTES_MAX_LENGTH
        ),
        paymentTerm: vendorTerm.paymentTerm,
        ...(vendorTerm.paymentTermCustom ? { paymentTermCustom: vendorTerm.paymentTermCustom } : {}),
        incoterm,
        deliveryLocation: sanitizeString(deliveryLocation, 300),
        termsAndConditions: sanitizeString(ensureMandatoryPoTermsNote(), 2000),
        attachmentUrls: [],
        approvalTierRequired,
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName,
        createdAt: now,
        updatedAt: now,
        logs: [initialLog],
      };

      setState((prev) => ({
        ...prev,
        purchaseOrders: [newPo, ...prev.purchaseOrders],
        vendorRfqs: prev.vendorRfqs.map((r) =>
          r.id === rfqId
            ? {
                ...r,
                status: 'Awarded',
                awardedSupplierId: supplier.id,
                awardedPoId: poId,
                awardedPoNumber: poNumber,
                updatedAt: now,
              }
            : r
        ),
      }));

      if (authMode === 'firebase') {
        const poDoc = { ...newPo };
        delete poDoc.logs;
        await saveFirestoreDoc('purchaseOrders', poId, poDoc, true);
        await appendPoLog(poId, initialLog);
        await saveFirestoreDoc(
          'vendorRfqs',
          rfqId,
          {
            status: 'Awarded',
            awardedSupplierId: supplier.id,
            awardedPoId: poId,
            awardedPoNumber: poNumber,
          },
          false
        );
      }
      await recordAudit(
        'Procurement',
        `Award ${rfq.rfqNumber} -> ${poNumber}`,
        poId,
        poNumber,
        `Pemenang: ${supplier.name}`
      );
      toast.success(`${rfq.rfqNumber} dimenangkan oleh ${supplier.name}. ${poNumber} (Draft) telah dibuat.`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.purchaseOrders, state.settings, state.suppliers, state.vendorRfqs, state.warehouses]
  );

  const saveGoodsReturn = useCallback(
    async (input: {
      returnType: GoodsReturnType;
      referenceOrderId: string;
      returnDate: string;
      reason: string;
      items: Array<{ productId: string; qty: number; reason?: string }>;
    }): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'return:write')) {
        toast.error('Role Anda tidak memiliki izin mencatat Retur Barang.');
        return false;
      }
      const cleanReason = sanitizeString(input.reason, 400);
      if (cleanReason.length < 2 || input.items.length === 0) {
        toast.error('Alasan retur dan minimal 1 item retur wajib diisi.');
        return false;
      }

      let refNumber = '';
      let counterpartyId = '';
      let counterpartyName = '';
      let warehouseId = '';
      let warehouseName = '';
      let currency: CurrencyCode = 'IDR';
      let sourceItems: OrderItem[] = [];

      if (input.returnType === 'PURCHASE_RETURN') {
        const po = state.purchaseOrders.find((p) => p.id === input.referenceOrderId);
        if (!po) return false;
        refNumber = po.poNumber;
        counterpartyId = po.supplierId;
        counterpartyName = po.supplierName || '-';
        warehouseId = po.warehouseId;
        warehouseName = po.warehouseName || '';
        currency = po.currency;
        sourceItems = po.items;
      } else {
        const so = state.salesOrders.find((s) => s.id === input.referenceOrderId);
        if (!so) return false;
        refNumber = so.soNumber;
        counterpartyId = so.customerId;
        counterpartyName = so.customerName || '-';
        warehouseId = so.warehouseId;
        warehouseName = so.warehouseName || '';
        currency = so.currency;
        sourceItems = so.items;
      }

      const retItems: GoodsReturnItem[] = input.items
        .filter((it) => Number(it.qty) > 0)
        .map((it) => {
          const src = sourceItems.find((s) => s.productId === it.productId);
          const prod = state.products.find((p) => p.id === it.productId);
          const qty = Math.max(1, Number(it.qty));
          const unitPrice = src?.unitPrice ?? prod?.sellPrice ?? 0;
          return {
            productId: it.productId,
            sku: src?.sku || prod?.sku || '-',
            productName: src?.productName || prod?.name || '-',
            uomCode: src?.uomCode || prod?.uomCode || 'Unit',
            qty,
            unitPrice,
            lineTotal: Math.round(qty * unitPrice * 100) / 100,
            ...(it.reason ? { reason: sanitizeString(it.reason, 160) } : {}),
          };
        });

      if (retItems.length === 0) {
        toast.error('Masukkan minimal 1 kuantitas retur > 0.');
        return false;
      }

      const subtotal = retItems.reduce((s, i) => s + i.lineTotal, 0);
      const effectiveTaxRate = getEffectiveTaxRatePercent(state.settings);
      const taxAmount = Math.round(subtotal * (effectiveTaxRate / 100) * 100) / 100;
      const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100;
      const now = new Date().toISOString();
      const retId = makeId('ret');
      const returnNumber = `RET-${input.returnType === 'PURCHASE_RETURN' ? 'PB' : 'PJ'}-${String(
        state.goodsReturns.length + 1
      ).padStart(4, '0')}`;

      const goodsReturn: GoodsReturn = {
        id: retId,
        returnNumber,
        returnType: input.returnType,
        status: 'Pending',
        referenceOrderId: input.referenceOrderId,
        referenceOrderNumber: refNumber,
        counterpartyId,
        counterpartyName,
        warehouseId,
        warehouseName,
        currency,
        returnDate: sanitizeString(input.returnDate, 32) || now.slice(0, 10),
        items: retItems,
        subtotal,
        taxAmount,
        totalAmount,
        reason: cleanReason,
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName,
        createdAt: now,
        updatedAt: now,
      };

      setState((prev) => ({
        ...prev,
        goodsReturns: [goodsReturn, ...prev.goodsReturns],
      }));
      if (authMode === 'firebase') {
        await saveFirestoreDoc('goodsReturns', retId, { ...goodsReturn }, true);
      }
      await recordAudit(
        input.returnType === 'PURCHASE_RETURN' ? 'Procurement' : 'Sales',
        `Ajukan Retur ${returnNumber}`,
        retId,
        returnNumber,
        `Ref ${refNumber} — ${cleanReason}`
      );
      toast.success(`Dokumen Retur ${returnNumber} tersimpan (Pending Approval Finance/Manager).`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.goodsReturns.length, state.products, state.purchaseOrders, state.salesOrders, state.settings]
  );

  const completeGoodsReturn = useCallback(
    async (returnId: string): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'accounting:write')) {
        toast.error('Penyelesaian & posting akuntansi Retur hanya oleh Finance, Manager, atau Direktur.');
        return false;
      }
      const ret = state.goodsReturns.find((r) => r.id === returnId);
      if (!ret || ret.status !== 'Pending') return false;

      const lockCheck = isDateInClosedPeriod(ret.returnDate, state.periodClosings);
      if (lockCheck.locked) {
        toast.error(`Periode akuntansi ${lockCheck.periodKey} sudah ditutup (Closed). Tidak dapat memproses retur.`);
        return false;
      }

      const now = new Date().toISOString();
      const updatedStocksMap: Record<string, Record<string, number>> = {};
      const newMovements: StockMovement[] = [];
      let returnedCogsIdr = 0;
      const fxRate = state.settings.defaultExchangeRateUsdIdr;

      for (const item of ret.items) {
        if (isServiceOrderItem(item, state.products)) continue;
        const prod = state.products.find((p) => p.id === item.productId);
        if (!prod) continue;
        const baseStocks = updatedStocksMap[prod.id] || prod.warehouseStocks;
        const beforeQty = baseStocks[ret.warehouseId] ?? 0;

        if (ret.returnType === 'PURCHASE_RETURN' && item.qty > beforeQty) {
          toast.error(`Stok ${prod.sku} di ${ret.warehouseName || ret.warehouseId} tidak cukup untuk retur (${beforeQty} tersedia).`);
          return false;
        }
        const delta = ret.returnType === 'PURCHASE_RETURN' ? -item.qty : item.qty;
        const afterQty = Math.max(0, beforeQty + delta);
        updatedStocksMap[prod.id] = {
          ...baseStocks,
          [ret.warehouseId]: afterQty,
        };
        returnedCogsIdr += item.qty * convertToIdr(prod.buyPrice, prod.currency, fxRate);

        newMovements.push({
          id: makeId('mov'),
          movementNumber: `${ret.returnType === 'PURCHASE_RETURN' ? 'RPO' : 'RSO'}-${Date.now().toString().slice(-6)}`,
          type: ret.returnType === 'PURCHASE_RETURN' ? 'GOODS_ISSUE' : 'GOODS_RECEIPT',
          referenceType: ret.returnType,
          referenceId: ret.id,
          referenceNumber: ret.returnNumber,
          productId: prod.id,
          productSku: prod.sku,
          productName: prod.name,
          warehouseId: ret.warehouseId,
          warehouseName: ret.warehouseName,
          quantityDelta: delta,
          beforeQty,
          afterQty,
          unitCost: prod.buyPrice,
          notes: `${ret.returnNumber} (${ret.referenceOrderNumber}): ${ret.reason}`,
          createdBy: currentUser.uid,
          createdByName: currentUser.displayName,
          createdAt: now,
        });
      }

      // Adjust linked open AP/AR invoice if present and unpaid balance >= return amount
      const ledgerTarget = ret.returnType === 'PURCHASE_RETURN' ? 'AP' : 'AR';
      const linkedInv = state.invoices.find(
        (inv) =>
          inv.ledgerType === ledgerTarget &&
          (inv.referenceOrderId === ret.referenceOrderId ||
            inv.referenceOrderNumber === ret.referenceOrderNumber) &&
          inv.balanceDue > 0
      );
      let updatedInv: AccountingInvoice | null = null;
      if (linkedInv) {
        const deduct = Math.min(linkedInv.balanceDue, ret.totalAmount);
        const newTotal = Math.max(linkedInv.paidAmount, Math.round((linkedInv.totalAmount - deduct) * 100) / 100);
        const computed = computeInvoiceStatus(newTotal, linkedInv.paidAmount, linkedInv.dueDate);
        updatedInv = {
          ...linkedInv,
          totalAmount: newTotal,
          balanceDue: computed.balanceDue,
          status: computed.status,
          updatedAt: now,
        };
      }

      const subtotalIdr = convertToIdr(ret.subtotal, ret.currency, fxRate);
      const taxIdr = convertToIdr(ret.taxAmount, ret.currency, fxRate);
      const totalIdr = convertToIdr(ret.totalAmount, ret.currency, fxRate);
      const { stockSubtotal: retStockOrigin, serviceSubtotal: retServiceOrigin } = splitOrderSubtotalByService(
        ret.items,
        state.products
      );
      let retStockSubtotalIdr = convertToIdr(retStockOrigin, ret.currency, fxRate);
      let retServiceSubtotalIdr = convertToIdr(retServiceOrigin, ret.currency, fxRate);
      if (retStockSubtotalIdr + retServiceSubtotalIdr !== subtotalIdr) {
        if (retServiceSubtotalIdr > 0 && retStockSubtotalIdr === 0) {
          retServiceSubtotalIdr = subtotalIdr;
        } else {
          retStockSubtotalIdr = Math.max(0, subtotalIdr - retServiceSubtotalIdr);
        }
      }

      const reversalJournals: JournalEntry[] = [];
      if (ret.returnType === 'PURCHASE_RETURN') {
        const jrn = buildResolvedJournalEntry({
          entryDate: ret.returnDate,
          journalType: 'Pembelian (AP)',
          referenceType: 'PURCHASE_RETURN',
          referenceId: ret.id,
          referenceNumber: ret.returnNumber,
          description: `Debit Note Retur Pembelian ${ret.returnNumber} (${ret.referenceOrderNumber}) — ${ret.counterpartyName}`,
          rawLines: [
            {
              preferredAccountId: 'coa_2101',
              fallbackCode: '2101',
              fallbackName: 'Hutang Usaha (AP)',
              debitIdr: totalIdr,
              creditIdr: 0,
              memo: `Koreksi Hutang ${ret.returnNumber}`,
            },
            {
              preferredAccountId: 'coa_1301',
              fallbackCode: '1301',
              fallbackName: 'Persediaan Barang Dagang',
              debitIdr: 0,
              creditIdr: retStockSubtotalIdr,
              memo: `Retur stok ${ret.referenceOrderNumber}`,
            },
            {
              preferredAccountId: 'coa_6103',
              fallbackCode: '6103',
              fallbackName: 'Beban Ekspedisi & Pengiriman',
              debitIdr: 0,
              creditIdr: retServiceSubtotalIdr,
              memo: `Koreksi Beban Operasional / Pengiriman ${ret.returnNumber}`,
            },
            {
              preferredAccountId: 'coa_1401',
              fallbackCode: '1401',
              fallbackName: 'PPN Masukan',
              debitIdr: 0,
              creditIdr: taxIdr,
              memo: `Koreksi PPN Masukan ${ret.returnNumber}`,
            },
          ],
        });
        if (jrn) reversalJournals.push(jrn);
      } else {
        const jrn = buildResolvedJournalEntry({
          entryDate: ret.returnDate,
          journalType: 'Penjualan (AR)',
          referenceType: 'SALES_RETURN',
          referenceId: ret.id,
          referenceNumber: ret.returnNumber,
          description: `Credit Note Retur Penjualan ${ret.returnNumber} (${ret.referenceOrderNumber}) — ${ret.counterpartyName}`,
          rawLines: [
            {
              preferredAccountId: 'coa_4101',
              fallbackCode: '4101',
              fallbackName: 'Penjualan Barang Dagang',
              debitIdr: subtotalIdr,
              creditIdr: 0,
              memo: `Retur Penjualan ${ret.returnNumber}`,
            },
            {
              preferredAccountId: 'coa_2201',
              fallbackCode: '2201',
              fallbackName: 'PPN Keluaran',
              debitIdr: taxIdr,
              creditIdr: 0,
              memo: `Koreksi PPN Keluaran ${ret.returnNumber}`,
            },
            {
              preferredAccountId: 'coa_1201',
              fallbackCode: '1201',
              fallbackName: 'Piutang Usaha (AR)',
              debitIdr: 0,
              creditIdr: totalIdr,
              memo: `Koreksi Piutang ${ret.counterpartyName}`,
            },
          ],
        });
        if (jrn) reversalJournals.push(jrn);

        if (returnedCogsIdr > 0) {
          const cogsRev = buildResolvedJournalEntry({
            entryDate: ret.returnDate,
            journalType: 'Penjualan (AR)',
            referenceType: 'SALES_RETURN_COGS',
            referenceId: ret.id,
            referenceNumber: ret.returnNumber,
            description: `Pembalikan HPP Retur Penjualan ${ret.returnNumber}`,
            sequenceOffset: 1,
            rawLines: [
              {
                preferredAccountId: 'coa_1301',
                fallbackCode: '1301',
                fallbackName: 'Persediaan Barang Dagang',
                debitIdr: returnedCogsIdr,
                creditIdr: 0,
                memo: `Masuk kembali persediaan ${ret.returnNumber}`,
              },
              {
                preferredAccountId: 'coa_5101',
                fallbackCode: '5101',
                fallbackName: 'Harga Pokok Penjualan (HPP)',
                debitIdr: 0,
                creditIdr: returnedCogsIdr,
                memo: `Reversal HPP ${ret.returnNumber}`,
              },
            ],
          });
          if (cogsRev) reversalJournals.push(cogsRev);
        }
      }

      setState((prev) => ({
        ...prev,
        products: prev.products.map((p) =>
          updatedStocksMap[p.id] ? { ...p, warehouseStocks: updatedStocksMap[p.id], updatedAt: now } : p
        ),
        stockMovements: [...newMovements, ...prev.stockMovements],
        invoices: updatedInv
          ? prev.invoices.map((i) => (i.id === updatedInv!.id ? updatedInv! : i))
          : prev.invoices,
        journalEntries:
          reversalJournals.length > 0
            ? [...reversalJournals, ...prev.journalEntries]
            : prev.journalEntries,
        goodsReturns: prev.goodsReturns.map((r) =>
          r.id === returnId
            ? { ...r, status: 'Completed', completedBy: currentUser.uid, updatedAt: now }
            : r
        ),
      }));

      if (authMode === 'firebase') {
        for (const [pid, stocks] of Object.entries(updatedStocksMap)) {
          await saveFirestoreDoc('products', pid, { warehouseStocks: stocks }, false);
        }
        for (const mov of newMovements) {
          await createImmutableRecord('stockMovements', mov.id, { ...mov });
        }
        if (updatedInv) {
          await saveFirestoreDoc(
            'invoices',
            updatedInv.id,
            {
              totalAmount: updatedInv.totalAmount,
              balanceDue: updatedInv.balanceDue,
              status: updatedInv.status,
            },
            false
          );
        }
        for (const jrn of reversalJournals) {
          await saveFirestoreDoc('journalEntries', jrn.id, { ...jrn }, true);
        }
        await saveFirestoreDoc(
          'goodsReturns',
          returnId,
          { status: 'Completed', completedBy: currentUser.uid },
          false
        );
      }

      await recordAudit(
        'Accounting',
        `Selesaikan Retur ${ret.returnNumber}`,
        returnId,
        ret.returnNumber,
        `Stok & Jurnal Pembalik diposting${updatedInv ? `; Invoice ${updatedInv.invoiceNumber} disesuaikan` : ''}`
      );
      toast.success(`Retur ${ret.returnNumber} selesai! Stok, Invoice & Jurnal Buku Besar telah disesuaikan.`);
      return true;
    },
    [authMode, buildResolvedJournalEntry, currentUser, recordAudit, state.goodsReturns, state.invoices, state.periodClosings, state.products, state.settings.defaultExchangeRateUsdIdr]
  );

  const cancelGoodsReturn = useCallback(
    async (returnId: string): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'return:write')) {
        toast.error('Akses ditolak.');
        return false;
      }
      const ret = state.goodsReturns.find((r) => r.id === returnId);
      if (!ret || ret.status !== 'Pending') return false;
      const now = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        goodsReturns: prev.goodsReturns.map((r) =>
          r.id === returnId ? { ...r, status: 'Cancelled', updatedAt: now } : r
        ),
      }));
      if (authMode === 'firebase') {
        await saveFirestoreDoc('goodsReturns', returnId, { status: 'Cancelled' }, false);
      }
      await recordAudit('Inventory', `Batalkan Retur ${ret.returnNumber}`, returnId, ret.returnNumber);
      toast.info(`Retur ${ret.returnNumber} dibatalkan.`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.goodsReturns]
  );

  const saveInventoryBatch = useCallback(
    async (input: {
      id?: string;
      isNew: boolean;
      productId: string;
      warehouseId: string;
      batchNumber: string;
      serialNumber?: string;
      qty: number;
      warrantyUntil?: string;
      expiryDate?: string;
      status: InventoryBatchStatus;
      notes?: string;
    }): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'inventory:write')) {
        toast.error('Role Anda tidak memiliki izin mengelola Batch / Serial.');
        return false;
      }
      const prod = state.products.find((p) => p.id === input.productId);
      const wh = state.warehouses.find((w) => w.id === input.warehouseId);
      const cleanBatch = sanitizeString(input.batchNumber, 64);
      if (!prod || !wh || cleanBatch.length < 2) {
        toast.error('Produk, Gudang, dan Nomor Batch (min 2 karakter) wajib diisi.');
        return false;
      }
      const now = new Date().toISOString();
      const batId = input.isNew ? makeId('bat') : input.id || makeId('bat');
      const existing = state.inventoryBatches.find((b) => b.id === batId);
      const batch: InventoryBatch = {
        id: batId,
        productId: prod.id,
        productSku: prod.sku,
        productName: prod.name,
        warehouseId: wh.id,
        warehouseName: wh.name,
        batchNumber: cleanBatch,
        ...(input.serialNumber ? { serialNumber: sanitizeString(input.serialNumber, 80) } : {}),
        qty: Math.max(0, Number(input.qty) || 0),
        ...(input.warrantyUntil ? { warrantyUntil: sanitizeString(input.warrantyUntil, 32) } : {}),
        ...(input.expiryDate ? { expiryDate: sanitizeString(input.expiryDate, 32) } : {}),
        status: input.status,
        ...(input.notes ? { notes: sanitizeString(input.notes, 400) } : {}),
        createdBy: existing?.createdBy || currentUser.uid,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      setState((prev) => ({
        ...prev,
        inventoryBatches: input.isNew
          ? [batch, ...prev.inventoryBatches]
          : prev.inventoryBatches.map((b) => (b.id === batId ? { ...b, ...batch } : b)),
      }));
      if (authMode === 'firebase') {
        await saveFirestoreDoc('inventoryBatches', batId, { ...batch }, input.isNew);
      }
      await recordAudit('Inventory', `Simpan Batch ${cleanBatch}`, batId, prod.sku);
      toast.success(`Batch ${cleanBatch} (${prod.sku}) tersimpan.`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.inventoryBatches, state.products, state.warehouses]
  );

  const deleteInventoryBatch = useCallback(
    async (batchId: string) => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus catatan batch.');
        return;
      }
      const target = state.inventoryBatches.find((b) => b.id === batchId);
      if (!target) return;
      setState((prev) => ({
        ...prev,
        inventoryBatches: prev.inventoryBatches.filter((b) => b.id !== batchId),
      }));
      if (authMode === 'firebase') {
        await deleteFirestoreDoc('inventoryBatches', batchId);
      }
      await recordAudit('Inventory', `Hapus Batch ${target.batchNumber}`, batchId, target.batchNumber);
      toast.success(`Batch ${target.batchNumber} dihapus.`);
    },
    [authMode, currentUser, recordAudit, state.inventoryBatches]
  );

  const togglePeriodClosing = useCallback(
    async (periodKey: string, lock: boolean, notes?: string): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'period:close')) {
        toast.error('Role Anda tidak memiliki izin melakukan Tutup Buku Periode.');
        return false;
      }
      if (!/^\d{4}-\d{2}$/.test(periodKey)) {
        toast.error('Format periode harus YYYY-MM.');
        return false;
      }
      const now = new Date().toISOString();
      const docId = `per_${periodKey.replace('-', '_')}`;
      const record: AccountingPeriodLock = {
        id: docId,
        periodKey,
        locked: lock,
        ...(notes ? { notes: sanitizeString(notes, 400) } : {}),
        lockedBy: currentUser.uid,
        lockedByName: currentUser.displayName,
        lockedAt: now,
        updatedAt: now,
      };
      setState((prev) => {
        const exists = prev.periodClosings.some((p) => p.periodKey === periodKey || p.id === docId);
        return {
          ...prev,
          periodClosings: exists
            ? prev.periodClosings.map((p) =>
                p.periodKey === periodKey || p.id === docId ? record : p
              )
            : [record, ...prev.periodClosings],
        };
      });
      if (authMode === 'firebase') {
        await upsertFirestoreDocNoCreatedAt('periodClosings', docId, { ...record });
      }
      await recordAudit(
        'Accounting',
        lock ? `Tutup Buku Periode ${periodKey}` : `Buka Kunci Periode ${periodKey}`,
        docId,
        periodKey,
        notes
      );
      toast.success(
        lock
          ? `Periode ${periodKey} resmi DITUTUP (Locked). Transaksi mundur kini diblokir.`
          : `Kunci periode ${periodKey} dibuka.`
      );
      return true;
    },
    [authMode, currentUser, recordAudit]
  );

  const saveBudget = useCallback(
    async (input: {
      periodKey: string;
      targetRevenueIdr: number;
      maxCogsIdr: number;
      maxOpexIdr: number;
      notes?: string;
    }): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'budget:write')) {
        toast.error('Role Anda tidak memiliki izin mengatur Budget Bulanan.');
        return false;
      }
      if (!/^\d{4}-\d{2}$/.test(input.periodKey)) {
        toast.error('Format periode budget harus YYYY-MM.');
        return false;
      }
      const now = new Date().toISOString();
      const docId = `bdg_${input.periodKey.replace('-', '_')}`;
      const budget: MonthlyBudget = {
        id: docId,
        periodKey: input.periodKey,
        targetRevenueIdr: Math.max(0, Math.round(Number(input.targetRevenueIdr) || 0)),
        maxCogsIdr: Math.max(0, Math.round(Number(input.maxCogsIdr) || 0)),
        maxOpexIdr: Math.max(0, Math.round(Number(input.maxOpexIdr) || 0)),
        ...(input.notes ? { notes: sanitizeString(input.notes, 400) } : {}),
        updatedBy: currentUser.uid,
        updatedAt: now,
      };
      setState((prev) => {
        const exists = prev.budgets.some((b) => b.periodKey === input.periodKey || b.id === docId);
        return {
          ...prev,
          budgets: exists
            ? prev.budgets.map((b) =>
                b.periodKey === input.periodKey || b.id === docId ? budget : b
              )
            : [budget, ...prev.budgets],
        };
      });
      if (authMode === 'firebase') {
        await upsertFirestoreDocNoCreatedAt('budgets', docId, { ...budget });
      }
      await recordAudit('Accounting', `Simpan Budget ${input.periodKey}`, docId, input.periodKey);
      toast.success(`Target & Budget periode ${input.periodKey} tersimpan.`);
      return true;
    },
    [authMode, currentUser, recordAudit]
  );

  const updateInvoiceTaxNumber = useCallback(
    async (invoiceId: string, taxInvoiceNumber: string): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'accounting:write')) {
        toast.error('Role Anda tidak memiliki izin mencatat Nomor Faktur Pajak.');
        return false;
      }
      const inv = state.invoices.find((i) => i.id === invoiceId);
      if (!inv) return false;
      const cleanTaxNo = sanitizeString(taxInvoiceNumber, 48);
      const now = new Date().toISOString();
      const linkedSo = inv.referenceOrderId
        ? state.salesOrders.find((s) => s.id === inv.referenceOrderId)
        : undefined;

      setState((prev) => ({
        ...prev,
        invoices: prev.invoices.map((i) =>
          i.id === invoiceId ? { ...i, taxInvoiceNumber: cleanTaxNo, updatedAt: now } : i
        ),
        salesOrders: linkedSo
          ? prev.salesOrders.map((s) =>
              s.id === linkedSo.id ? { ...s, taxInvoiceNumber: cleanTaxNo, updatedAt: now } : s
            )
          : prev.salesOrders,
      }));
      if (authMode === 'firebase') {
        await saveFirestoreDoc('invoices', invoiceId, { taxInvoiceNumber: cleanTaxNo }, false);
        if (linkedSo) {
          await saveFirestoreDoc('salesOrders', linkedSo.id, { taxInvoiceNumber: cleanTaxNo }, false);
        }
      }
      await recordAudit(
        'Accounting',
        `Update Faktur Pajak ${inv.invoiceNumber}`,
        invoiceId,
        cleanTaxNo
      );
      toast.success(`Nomor Faktur Pajak ${inv.invoiceNumber} diperbarui.`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.invoices, state.salesOrders]
  );

  const deleteGoodsReturn = useCallback(
    async (returnId: string): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus riwayat retur.');
        return false;
      }
      const target = state.goodsReturns.find((r) => r.id === returnId);
      if (!target) return false;
      setState((prev) => ({
        ...prev,
        goodsReturns: prev.goodsReturns.filter((r) => r.id !== returnId),
      }));
      if (authMode === 'firebase') {
        await deleteFirestoreDoc('goodsReturns', returnId);
      }
      await recordAudit(
        target.returnType === 'PURCHASE_RETURN' ? 'Purchase Order' : 'Sales Order',
        `Hapus Riwayat Retur ${target.returnNumber}`,
        returnId,
        target.returnNumber
      );
      toast.success(`Riwayat retur ${target.returnNumber} dihapus permanen.`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.goodsReturns]
  );

  const deleteVendorRfq = useCallback(
    async (rfqId: string): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus data Vendor RFQ.');
        return false;
      }
      const target = state.vendorRfqs.find((r) => r.id === rfqId);
      if (!target) return false;
      setState((prev) => ({
        ...prev,
        vendorRfqs: prev.vendorRfqs.filter((r) => r.id !== rfqId),
      }));
      if (authMode === 'firebase') {
        await deleteFirestoreDoc('vendorRfqs', rfqId);
      }
      await recordAudit('Purchase Order', `Hapus RFQ ${target.rfqNumber}`, rfqId, target.rfqNumber);
      toast.success(`RFQ ${target.rfqNumber} dihapus permanen.`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.vendorRfqs]
  );

  const deleteSalesQuotation = useCallback(
    async (quotationId: string): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus data Sales Quotation.');
        return false;
      }
      const target = state.salesQuotations.find((q) => q.id === quotationId);
      if (!target) return false;
      setState((prev) => ({
        ...prev,
        salesQuotations: prev.salesQuotations.filter((q) => q.id !== quotationId),
      }));
      if (authMode === 'firebase') {
        await deleteFirestoreDoc('salesQuotations', quotationId);
      }
      await recordAudit(
        'Sales Order',
        `Hapus Quotation ${target.quotationNumber}`,
        quotationId,
        target.quotationNumber
      );
      toast.success(`Quotation ${target.quotationNumber} dihapus permanen.`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.salesQuotations]
  );

  const deleteStockMovement = useCallback(
    async (movementId: string): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus riwayat mutasi stok.');
        return false;
      }
      const target = state.stockMovements.find((m) => m.id === movementId);
      if (!target) return false;
      setState((prev) => ({
        ...prev,
        stockMovements: prev.stockMovements.filter((m) => m.id !== movementId),
      }));
      if (authMode === 'firebase') {
        await deleteFirestoreDoc('stockMovements', movementId);
      }
      await recordAudit(
        'Inventory',
        `Hapus Riwayat Stok ${target.referenceNumber || target.productName}`,
        movementId,
        target.productName
      );
      toast.success(`Riwayat mutasi stok (${target.productName}) dihapus permanen.`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.stockMovements]
  );

  const deleteChartAccount = useCallback(
    async (accountId: string): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus Akun Buku Besar (CoA).');
        return false;
      }
      const target = state.chartOfAccounts.find((a) => a.id === accountId);
      if (!target) return false;
      setState((prev) => ({
        ...prev,
        chartOfAccounts: prev.chartOfAccounts.filter((a) => a.id !== accountId),
      }));
      if (authMode === 'firebase') {
        await deleteFirestoreDoc('chartOfAccounts', accountId);
      }
      await recordAudit('Accounting', `Hapus Akun CoA ${target.code}`, accountId, target.name);
      toast.success(`Akun ${target.code} — ${target.name} dihapus permanen.`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.chartOfAccounts]
  );

  const deleteInvoice = useCallback(
    async (invoiceId: string): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus record Invoice AP/AR.');
        return false;
      }
      const target = state.invoices.find((i) => i.id === invoiceId);
      if (!target) return false;
      setState((prev) => ({
        ...prev,
        invoices: prev.invoices.filter((i) => i.id !== invoiceId),
      }));
      if (authMode === 'firebase') {
        await deleteInvoicesWithPayments([invoiceId]);
      }
      await recordAudit(
        'Accounting',
        `Hapus Invoice ${target.invoiceNumber}`,
        invoiceId,
        target.counterpartyName
      );
      toast.success(`Invoice ${target.invoiceNumber} dihapus permanen.`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.invoices]
  );

  const deletePeriodClosing = useCallback(
    async (periodId: string): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus catatan tutup periode.');
        return false;
      }
      const target = state.periodClosings.find((p) => p.id === periodId);
      if (!target) return false;
      setState((prev) => ({
        ...prev,
        periodClosings: prev.periodClosings.filter((p) => p.id !== periodId),
      }));
      if (authMode === 'firebase') {
        await deleteFirestoreDoc('periodClosings', periodId);
      }
      await recordAudit(
        'Accounting',
        `Hapus Record Periode ${target.periodKey}`,
        periodId,
        target.periodKey
      );
      toast.success(`Record closing periode ${target.periodKey} dihapus.`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.periodClosings]
  );

  const deleteBudget = useCallback(
    async (budgetId: string): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus target budget.');
        return false;
      }
      const target = state.budgets.find((b) => b.id === budgetId);
      if (!target) {
        toast.error('Target budget periode tersebut belum tersimpan di database.');
        return false;
      }
      setState((prev) => ({
        ...prev,
        budgets: prev.budgets.filter((b) => b.id !== budgetId),
      }));
      if (authMode === 'firebase') {
        await deleteFirestoreDoc('budgets', budgetId);
      }
      await recordAudit(
        'Accounting',
        `Hapus Target Budget ${target.periodKey}`,
        budgetId,
        target.periodKey
      );
      toast.success(`Target budget periode ${target.periodKey} dihapus.`);
      return true;
    },
    [authMode, currentUser, recordAudit, state.budgets]
  );

  const deleteAuditLog = useCallback(
    async (logId: string): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus riwayat audit.');
        return false;
      }
      setState((prev) => ({
        ...prev,
        auditLogs: prev.auditLogs.filter((l) => l.id !== logId),
      }));
      if (authMode === 'firebase') {
        await deleteFirestoreDoc('auditLogs', logId);
      }
      toast.success('Entri Audit Trail dihapus permanen.');
      return true;
    },
    [authMode, currentUser]
  );

  const deleteNotification = useCallback(
    async (notifId: string): Promise<boolean> => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus notifikasi sistem.');
        return false;
      }
      setState((prev) => ({
        ...prev,
        notifications: prev.notifications.filter((n) => n.id !== notifId),
      }));
      if (authMode === 'firebase') {
        await deleteFirestoreDoc('notifications', notifId);
      }
      toast.success('Notifikasi sistem dihapus permanen.');
      return true;
    },
    [authMode, currentUser]
  );

  // =========================================================================
  // Bulk Action Handlers (List Multi-Select Operations)
  // =========================================================================
  const bulkDeleteFlatCollection = useCallback(
    async <K extends keyof ErpState>(
      stateKey: K,
      firestoreCol: string,
      ids: string[],
      auditModule: string,
      label: string
    ): Promise<number> => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error(`Hanya Direktur yang dapat menghapus massal ${label}.`);
        return 0;
      }
      const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
      if (uniqueIds.length === 0) return 0;
      const idSet = new Set(uniqueIds);
      setState((prev) => {
        const list = prev[stateKey];
        if (!Array.isArray(list)) return prev;
        return {
          ...prev,
          [stateKey]: (list as unknown as Array<{ id: string }>).filter((item) => !idSet.has(item.id)),
        };
      });
      if (authMode === 'firebase') {
        await deleteFirestoreDocsInChunks(
          uniqueIds.map((id) => ({ col: firestoreCol, id })),
          10
        );
      }
      await ensureSeedLockedInFirebase();
      await recordAudit(auditModule, `Hapus Massal ${label}`, 'bulk_delete', `${uniqueIds.length} ${label}`);
      toast.success(`${uniqueIds.length} ${label} dihapus permanen.`);
      return uniqueIds.length;
    },
    [authMode, currentUser, ensureSeedLockedInFirebase, recordAudit]
  );

  const bulkDeletePurchaseOrders = useCallback(
    async (poIds: string[]): Promise<number> => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus massal Purchase Order.');
        return 0;
      }
      const uniqueIds = Array.from(new Set(poIds)).filter((id) =>
        state.purchaseOrders.some((p) => p.id === id)
      );
      if (uniqueIds.length === 0) return 0;
      const idSet = new Set(uniqueIds);
      setState((prev) => ({
        ...prev,
        purchaseOrders: prev.purchaseOrders.filter((p) => !idSet.has(p.id)),
      }));
      if (authMode === 'firebase') {
        await deletePurchaseOrdersWithLogs(uniqueIds);
      }
      await ensureSeedLockedInFirebase();
      await recordAudit('Procurement', 'Hapus Massal Purchase Order', 'bulk_po', `${uniqueIds.length} PO`);
      toast.success(`${uniqueIds.length} Purchase Order dihapus permanen.`);
      return uniqueIds.length;
    },
    [authMode, currentUser, ensureSeedLockedInFirebase, recordAudit, state.purchaseOrders]
  );

  const bulkApprovePurchaseOrders = useCallback(
    async (poIds: string[]): Promise<number> => {
      if (!currentUser || !hasPermission(currentUser.role, 'po:approve')) {
        toast.error('Hanya Manager atau Direktur yang dapat menyetujui PO secara massal.');
        return 0;
      }
      const uniqueIds = Array.from(new Set(poIds));
      let approvedCount = 0;
      let skippedCount = 0;
      const now = new Date().toISOString();
      const updatedMap = new Map<string, PurchaseOrder>();

      for (const poId of uniqueIds) {
        const po = state.purchaseOrders.find((p) => p.id === poId);
        if (!po || !canTransitionPoStatus(po.status, 'Approved by Manager')) {
          skippedCount += 1;
          continue;
        }
        const poTotalIdr = convertToIdr(
          po.totalAmount,
          po.currency,
          po.exchangeRate || state.settings.defaultExchangeRateUsdIdr
        );
        const needsDirector =
          po.approvalTierRequired === 'Direktur' ||
          requiresDirectorApproval(
            poTotalIdr,
            state.settings.managerApprovalLimitIdr ?? DEFAULT_MANAGER_APPROVAL_LIMIT_IDR
          );
        if (needsDirector && !hasPermission(currentUser.role, 'director:approve')) {
          skippedCount += 1;
          continue;
        }
        const supplier = state.suppliers.find((s) => s.id === po.supplierId);
        if (supplier) {
          const supCheck = validateSupplierForPurchaseOrder({ supplier, totalAmountIdr: poTotalIdr });
          if (!supCheck.allowed) {
            skippedCount += 1;
            continue;
          }
        }
        const logEntry = {
          id: makeId('log'),
          action: needsDirector
            ? 'Disetujui Massal Direktur (Tier High-Value)'
            : 'Disetujui Massal ke Approved by Manager',
          actorId: currentUser.uid,
          actorName: currentUser.displayName,
          timestamp: now,
        };
        const approvedBy = currentUser.uid;
        const directorApprovedBy = needsDirector ? currentUser.uid : po.directorApprovedBy;
        updatedMap.set(poId, {
          ...po,
          status: 'Approved by Manager',
          approvedBy,
          ...(directorApprovedBy ? { directorApprovedBy } : {}),
          updatedAt: now,
          logs: [...(po.logs || []), logEntry],
        });
        if (authMode === 'firebase') {
          await saveFirestoreDoc(
            'purchaseOrders',
            poId,
            {
              status: 'Approved by Manager',
              approvedBy,
              ...(directorApprovedBy ? { directorApprovedBy } : {}),
            },
            false
          );
          await appendPoLog(poId, logEntry);
        }
        approvedCount += 1;
      }

      if (updatedMap.size > 0) {
        setState((prev) => ({
          ...prev,
          purchaseOrders: prev.purchaseOrders.map((p) => updatedMap.get(p.id) || p),
        }));
        await recordAudit('Procurement', 'Approve Massal PO', 'bulk_approve_po', `${approvedCount} PO`);
      }

      if (approvedCount > 0) {
        toast.success(
          skippedCount > 0
            ? `${approvedCount} PO disetujui. ${skippedCount} PO dilewati karena status/otoritas tidak memenuhi syarat.`
            : `${approvedCount} Purchase Order berhasil disetujui.`
        );
      } else {
        toast.info('Tidak ada PO terpilih yang memenuhi syarat persetujuan.');
      }
      return approvedCount;
    },
    [authMode, currentUser, recordAudit, state.purchaseOrders, state.settings.defaultExchangeRateUsdIdr, state.settings.managerApprovalLimitIdr, state.suppliers]
  );

  const bulkDeleteSalesOrders = useCallback(
    (ids: string[]) => bulkDeleteFlatCollection('salesOrders', 'salesOrders', ids, 'Sales', 'Sales Order'),
    [bulkDeleteFlatCollection]
  );

  const bulkConfirmSalesOrders = useCallback(
    async (soIds: string[]): Promise<number> => {
      if (!currentUser || !hasPermission(currentUser.role, 'so:create')) {
        toast.error('Role Anda tidak memiliki izin mengonfirmasi Sales Order.');
        return 0;
      }
      let confirmedCount = 0;
      let skippedCount = 0;
      for (const soId of Array.from(new Set(soIds))) {
        const so = state.salesOrders.find((s) => s.id === soId);
        if (!so || so.status !== 'Draft') {
          skippedCount += 1;
          continue;
        }
        await transitionSalesOrder(soId, 'Confirmed');
        confirmedCount += 1;
      }
      if (confirmedCount === 0 && skippedCount > 0) {
        toast.info('Hanya Sales Order berstatus Draft yang dapat dikonfirmasi massal.');
      }
      return confirmedCount;
    },
    [currentUser, state.salesOrders, transitionSalesOrder]
  );

  const bulkDeleteQuotations = useCallback(
    (ids: string[]) => bulkDeleteFlatCollection('salesQuotations', 'salesQuotations', ids, 'Sales Order', 'Sales Quotation'),
    [bulkDeleteFlatCollection]
  );

  const bulkUpdateQuotationStatuses = useCallback(
    async (ids: string[], status: QuotationStatus): Promise<number> => {
      if (!currentUser || !hasPermission(currentUser.role, 'so:create')) {
        toast.error('Akses ditolak untuk memperbarui status Quotation.');
        return 0;
      }
      const uniqueIds = Array.from(new Set(ids));
      const now = new Date().toISOString();
      const updatedIds = new Set<string>();
      for (const qId of uniqueIds) {
        const q = state.salesQuotations.find((x) => x.id === qId);
        if (!q || q.status === 'Converted' || q.status === status) continue;
        updatedIds.add(qId);
        if (authMode === 'firebase') {
          await saveFirestoreDoc('salesQuotations', qId, { status }, false);
        }
      }
      if (updatedIds.size === 0) {
        toast.info('Tidak ada Quotation non-Converted yang diperbarui.');
        return 0;
      }
      setState((prev) => ({
        ...prev,
        salesQuotations: prev.salesQuotations.map((q) =>
          updatedIds.has(q.id) ? { ...q, status, updatedAt: now } : q
        ),
      }));
      await recordAudit('Sales Order', `Update Massal Quotation -> ${status}`, 'bulk_qt', `${updatedIds.size} quotation`);
      toast.success(`${updatedIds.size} Quotation diperbarui ke ${status}.`);
      return updatedIds.size;
    },
    [authMode, currentUser, recordAudit, state.salesQuotations]
  );

  const bulkDeleteGoodsReturns = useCallback(
    (ids: string[]) => bulkDeleteFlatCollection('goodsReturns', 'goodsReturns', ids, 'Inventory', 'Riwayat Retur'),
    [bulkDeleteFlatCollection]
  );

  const bulkCompleteGoodsReturns = useCallback(
    async (ids: string[]): Promise<number> => {
      if (!currentUser || !hasPermission(currentUser.role, 'return:write')) {
        toast.error('Role Anda tidak memiliki izin memproses retur.');
        return 0;
      }
      let done = 0;
      for (const retId of Array.from(new Set(ids))) {
        const ret = state.goodsReturns.find((r) => r.id === retId);
        if (!ret || ret.status !== 'Pending') continue;
        const ok = await completeGoodsReturn(retId);
        if (ok) done += 1;
      }
      if (done === 0) {
        toast.info('Tidak ada retur berstatus Pending yang dapat diselesaikan.');
      }
      return done;
    },
    [completeGoodsReturn, currentUser, state.goodsReturns]
  );

  const bulkCancelGoodsReturns = useCallback(
    async (ids: string[]): Promise<number> => {
      if (!currentUser || !hasPermission(currentUser.role, 'return:write')) {
        toast.error('Akses ditolak.');
        return 0;
      }
      const uniqueIds = Array.from(new Set(ids));
      const now = new Date().toISOString();
      const updated = new Set<string>();
      for (const retId of uniqueIds) {
        const ret = state.goodsReturns.find((r) => r.id === retId);
        if (!ret || ret.status !== 'Pending') continue;
        updated.add(retId);
        if (authMode === 'firebase') {
          await saveFirestoreDoc('goodsReturns', retId, { status: 'Cancelled' }, false);
        }
      }
      if (updated.size === 0) {
        toast.info('Hanya retur berstatus Pending yang dapat dibatalkan.');
        return 0;
      }
      setState((prev) => ({
        ...prev,
        goodsReturns: prev.goodsReturns.map((r) =>
          updated.has(r.id) ? { ...r, status: 'Cancelled', updatedAt: now } : r
        ),
      }));
      await recordAudit('Inventory', 'Batalkan Massal Retur', 'bulk_cancel_ret', `${updated.size} retur`);
      toast.info(`${updated.size} retur dibatalkan.`);
      return updated.size;
    },
    [authMode, currentUser, recordAudit, state.goodsReturns]
  );

  const bulkDeleteVendorRfqs = useCallback(
    (ids: string[]) => bulkDeleteFlatCollection('vendorRfqs', 'vendorRfqs', ids, 'Purchase Order', 'Vendor RFQ'),
    [bulkDeleteFlatCollection]
  );

  const bulkDeleteProducts = useCallback(
    (ids: string[]) => bulkDeleteFlatCollection('products', 'products', ids, 'Master Data', 'Produk'),
    [bulkDeleteFlatCollection]
  );

  const bulkDeleteSuppliers = useCallback(
    (ids: string[]) => bulkDeleteFlatCollection('suppliers', 'suppliers', ids, 'Master Data', 'Supplier'),
    [bulkDeleteFlatCollection]
  );

  const bulkVerifySuppliers = useCallback(
    async (ids: string[], status: PartnerVerificationStatus): Promise<number> => {
      if (!currentUser || !hasPermission(currentUser.role, 'partner:approve')) {
        toast.error('Hanya Admin (Direktur) yang berhak memverifikasi supplier secara massal.');
        return 0;
      }
      const uniqueIds = Array.from(new Set(ids));
      const now = new Date().toISOString();
      const active = status !== 'Blacklisted';
      const updated = new Set<string>();
      for (const sId of uniqueIds) {
        const target = state.suppliers.find((s) => s.id === sId);
        if (!target) continue;
        updated.add(sId);
        if (authMode === 'firebase') {
          await saveFirestoreDoc(
            'suppliers',
            sId,
            { verificationStatus: status, verifiedBy: currentUser.uid, verifiedAt: now, active },
            false
          );
        }
      }
      if (updated.size === 0) return 0;
      setState((prev) => ({
        ...prev,
        suppliers: prev.suppliers.map((s) =>
          updated.has(s.id)
            ? { ...s, verificationStatus: status, verifiedBy: currentUser.uid, verifiedAt: now, active, updatedAt: now }
            : s
        ),
      }));
      await recordAudit('Master Data', `Verifikasi Massal Supplier -> ${status}`, 'bulk_sup_verify', `${updated.size} supplier`);
      toast.success(`${updated.size} supplier diperbarui menjadi ${status}.`);
      return updated.size;
    },
    [authMode, currentUser, recordAudit, state.suppliers]
  );

  const bulkDeleteCustomers = useCallback(
    (ids: string[]) => bulkDeleteFlatCollection('customers', 'customers', ids, 'Master Data', 'Buyer / Customer'),
    [bulkDeleteFlatCollection]
  );

  const bulkDeleteUsers = useCallback(
    async (uids: string[]): Promise<number> => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus pengguna.');
        return 0;
      }
      const deletable = Array.from(new Set(uids)).filter((uid) => uid && uid !== currentUser.uid);
      if (deletable.length === 0) {
        toast.error('Tidak ada akun selain akun aktif yang dipilih.');
        return 0;
      }
      const idSet = new Set(deletable);
      setState((prev) => ({
        ...prev,
        users: prev.users.filter((u) => !idSet.has(u.uid)),
      }));
      if (authMode === 'firebase') {
        await deleteFirestoreDocsInChunks(
          deletable.map((id) => ({ col: 'users', id })),
          10
        );
      }
      await recordAudit('System', 'Hapus Massal User', 'bulk_users', `${deletable.length} user`);
      toast.success(`${deletable.length} user dihapus.`);
      return deletable.length;
    },
    [authMode, currentUser, recordAudit]
  );

  const bulkDeleteStockMovements = useCallback(
    (ids: string[]) => bulkDeleteFlatCollection('stockMovements', 'stockMovements', ids, 'Inventory', 'Riwayat Mutasi Stok'),
    [bulkDeleteFlatCollection]
  );

  const bulkDeleteInventoryBatches = useCallback(
    (ids: string[]) => bulkDeleteFlatCollection('inventoryBatches', 'inventoryBatches', ids, 'Inventory', 'Batch / Serial'),
    [bulkDeleteFlatCollection]
  );

  const bulkDeleteChartAccounts = useCallback(
    (ids: string[]) => bulkDeleteFlatCollection('chartOfAccounts', 'chartOfAccounts', ids, 'Accounting', 'Akun CoA'),
    [bulkDeleteFlatCollection]
  );

  const bulkVoidJournalEntries = useCallback(
    async (entryIds: string[]): Promise<number> => {
      if (!currentUser || !hasPermission(currentUser.role, 'accounting:write')) {
        toast.error('Role Anda tidak memiliki izin mem-Void jurnal.');
        return 0;
      }
      const now = new Date().toISOString();
      const updatedIds = new Set<string>();
      let lockedSkipped = 0;

      for (const entryId of Array.from(new Set(entryIds))) {
        const target = state.journalEntries.find((j) => j.id === entryId);
        if (!target || target.status === 'Void') continue;
        const lockCheck = isDateInClosedPeriod(target.entryDate, state.periodClosings);
        if (lockCheck.locked) {
          lockedSkipped += 1;
          continue;
        }
        updatedIds.add(entryId);
        if (authMode === 'firebase') {
          await saveFirestoreDoc('journalEntries', entryId, { status: 'Void' }, false);
        }
      }

      if (updatedIds.size > 0) {
        setState((prev) => ({
          ...prev,
          journalEntries: prev.journalEntries.map((j) =>
            updatedIds.has(j.id) ? { ...j, status: 'Void', updatedAt: now } : j
          ),
        }));
        await recordAudit('Accounting', 'Void Massal Jurnal', 'bulk_void_jrn', `${updatedIds.size} jurnal`);
        toast.success(
          lockedSkipped > 0
            ? `${updatedIds.size} jurnal di-Void. ${lockedSkipped} jurnal periode tertutup dilewati.`
            : `${updatedIds.size} jurnal berhasil dibatalkan (Void).`
        );
      } else {
        toast.info(
          lockedSkipped > 0
            ? 'Semua jurnal terpilih berada di periode akuntansi tertutup.'
            : 'Tidak ada jurnal berstatus Posted yang dipilih.'
        );
      }
      return updatedIds.size;
    },
    [authMode, currentUser, recordAudit, state.journalEntries, state.periodClosings]
  );

  const bulkDeleteJournalEntries = useCallback(
    (ids: string[]) => bulkDeleteFlatCollection('journalEntries', 'journalEntries', ids, 'Accounting', 'Jurnal Akuntansi'),
    [bulkDeleteFlatCollection]
  );

  const bulkDeleteInvoices = useCallback(
    async (invoiceIds: string[]): Promise<number> => {
      if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
        toast.error('Hanya Direktur yang dapat menghapus massal Invoice AP/AR.');
        return 0;
      }
      const uniqueIds = Array.from(new Set(invoiceIds)).filter((id) =>
        state.invoices.some((i) => i.id === id)
      );
      if (uniqueIds.length === 0) return 0;
      const idSet = new Set(uniqueIds);
      setState((prev) => ({
        ...prev,
        invoices: prev.invoices.filter((i) => !idSet.has(i.id)),
      }));
      if (authMode === 'firebase') {
        await deleteInvoicesWithPayments(uniqueIds);
      }
      await recordAudit('Accounting', 'Hapus Massal Invoice AP/AR', 'bulk_inv', `${uniqueIds.length} invoice`);
      toast.success(`${uniqueIds.length} Invoice dihapus permanen.`);
      return uniqueIds.length;
    },
    [authMode, currentUser, recordAudit, state.invoices]
  );

  const bulkMarkNotificationsRead = useCallback(
    async (notifIds: string[]): Promise<number> => {
      if (!currentUser) return 0;
      const targetIds = new Set(notifIds);
      const toMark = state.notifications.filter(
        (n) => targetIds.has(n.id) && !(n.readBy || []).includes(currentUser.uid)
      );
      if (toMark.length === 0) {
        toast.info('Notifikasi terpilih sudah berstatus dibaca.');
        return 0;
      }
      const updatedReadMap = new Map<string, string[]>();
      for (const n of toMark) {
        const readBy = Array.from(new Set([...(n.readBy || []), currentUser.uid]));
        updatedReadMap.set(n.id, readBy);
        if (authMode === 'firebase') {
          await markNotificationReadInFirestore(n.id, readBy);
        }
      }
      setState((prev) => ({
        ...prev,
        notifications: prev.notifications.map((n) =>
          updatedReadMap.has(n.id) ? { ...n, readBy: updatedReadMap.get(n.id)! } : n
        ),
      }));
      toast.success(`${toMark.length} notifikasi ditandai sudah dibaca.`);
      return toMark.length;
    },
    [authMode, currentUser, state.notifications]
  );

  const bulkDeleteNotifications = useCallback(
    (ids: string[]) => bulkDeleteFlatCollection('notifications', 'notifications', ids, 'System', 'Notifikasi'),
    [bulkDeleteFlatCollection]
  );

  const bulkDeleteAuditLogs = useCallback(
    (ids: string[]) => bulkDeleteFlatCollection('auditLogs', 'auditLogs', ids, 'System', 'Audit Log'),
    [bulkDeleteFlatCollection]
  );

  const resetTotalDatabase = useCallback(async (): Promise<boolean> => {
    if (!currentUser || !hasPermission(currentUser.role, 'master:users')) {
      toast.error('Hanya Direktur yang berhak mengosongkan seluruh database.');
      return false;
    }
    try {
      if (authMode === 'firebase') {
        await resetTotalDatabaseInFirestore(currentUser.uid, state.settings);
      }
      setState((prev) => ({
        ...createEmptyErpState(),
        users: prev.users,
        settings: {
          ...prev.settings,
          id: 'company',
          initialSeedCompleted: true,
        },
      }));
      toast.success('Seluruh database transaksi, master, gudang, & akuntansi berhasil dikosongkan total.');
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengosongkan database total.');
      return false;
    }
  }, [authMode, currentUser, state.settings]);

  return {
    authMode,
    authBusy,
    currentUser,
    activeModule,
    setActiveModule: selectActiveModule,
    state,
    firestoreError,
    loginWithGoogle,
    loginWithGoogleRedirect,
    enterPreviewMode,
    switchPreviewRole,
    logout,
    saveSupplier,
    saveSupplierCategories,
    verifySupplier,
    saveCustomer,
    approveBuyerWithCreditLimit,
    saveCustomerContractPrices,
    saveWarehouse,
    saveCategory,
    saveUom,
    saveProduct,
    deleteProduct,
    deleteSupplier,
    deleteCustomer,
    deleteWarehouse,
    deleteCategory,
    deleteUom,
    clearDummyMasterData,
    updateUserRole,
    saveUserAccount,
    deleteUserAccount,
    createPurchaseOrder,
    transitionPurchaseOrder,
    deletePurchaseOrder,
    clearDummyPurchaseOrders,
    receiveGoodsFromPo,
    issueGoods,
    transferStock,
    recordStockOpname,
    createSalesOrder,
    transitionSalesOrder,
    deliverSalesOrder,
    deleteSalesOrder,
    clearDummySalesOrders,
    recordInvoicePayment,
    saveChartAccount,
    createJournalEntry,
    voidJournalEntry,
    deleteJournalEntry,
    clearDummyJournalEntries,
    updateCompanySettings,
    markNotificationRead,
    saveSalesQuotation,
    updateQuotationStatus,
    convertQuotationToSo,
    deleteSalesQuotation,
    saveVendorRfq,
    submitVendorRfqQuote,
    awardRfqToPo,
    deleteVendorRfq,
    saveGoodsReturn,
    completeGoodsReturn,
    cancelGoodsReturn,
    deleteGoodsReturn,
    saveInventoryBatch,
    deleteInventoryBatch,
    deleteStockMovement,
    deleteChartAccount,
    deleteInvoice,
    togglePeriodClosing,
    deletePeriodClosing,
    saveBudget,
    deleteBudget,
    updateInvoiceTaxNumber,
    deleteAuditLog,
    deleteNotification,
    bulkDeletePurchaseOrders,
    bulkApprovePurchaseOrders,
    bulkDeleteSalesOrders,
    bulkConfirmSalesOrders,
    bulkDeleteQuotations,
    bulkUpdateQuotationStatuses,
    bulkDeleteGoodsReturns,
    bulkCompleteGoodsReturns,
    bulkCancelGoodsReturns,
    bulkDeleteVendorRfqs,
    bulkDeleteProducts,
    bulkDeleteSuppliers,
    bulkVerifySuppliers,
    bulkDeleteCustomers,
    bulkDeleteUsers,
    bulkDeleteStockMovements,
    bulkDeleteInventoryBatches,
    bulkDeleteChartAccounts,
    bulkVoidJournalEntries,
    bulkDeleteJournalEntries,
    bulkDeleteInvoices,
    bulkMarkNotificationsRead,
    bulkDeleteNotifications,
    bulkDeleteAuditLogs,
    resetTotalDatabase,
  };
}
export type ErpController = ReturnType<typeof useErpController>;
