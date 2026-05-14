import React, { useState, useEffect, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { 
  Search, 
  User, 
  ShieldCheck, 
  History, 
  Plus, 
  Minus,
  Edit2,
  LogOut, 
  CheckCircle2, 
  AlertCircle,
  AlertTriangle,
  FileSignature,
  Trash2,
  Package,
  ChevronRight,
  HardHat,
  Download,
  Settings,
  Smartphone,
  UserPlus,
  Shield,
  Bell,
  Mail,
  Upload
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import SignatureCanvas from 'react-signature-canvas';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  orderBy, 
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  increment,
  serverTimestamp,
  getDocFromServer,
  getDocsFromServer,
  writeBatch,
  limit
} from './localSQLite/sqliteStore';
import { onAuthStateChanged, User as LocalUser } from './localSQLite/auth';
import { db, auth, loginAsLocalAdmin, logout, createSecondaryUser, signInWithEmailAndPassword, sendPasswordResetEmail } from './database';
import emailjs from '@emailjs/browser';
import * as XLSX from 'xlsx';

// Error Handling Spec
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface DatabaseErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleDatabaseError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: DatabaseErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Database Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Utility to extract size from EPP name if missing
const extractSize = (name: string): string => {
  if (!name) return '';
  
  // 1. Look for numbers or size labels inside parentheses - HIGHEST PRIORITY as per user request
  // Example: "BOTAS NEGRO (44) DE SEGURIDAD" -> "44"
  const parenMatch = name.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const content = parenMatch[1].trim();
    // Only return if it's a short string (likely a size)
    if (content.length <= 5) return content.toUpperCase();
  }

  // 2. Look for explicit "Talla" or similar
  const tallaMatch = name.match(/talla[:\s]+(\w+)/i);
  if (tallaMatch) return tallaMatch[1];
  
  // 3. Look for size labels at the end or surrounded by spaces
  const labelMatch = name.match(/\b(S|M|L|XL|XXL|XXXL|ÚNICA|UNICA)\b/i);
  if (labelMatch) return labelMatch[1].toUpperCase();
  
  return '';
};

// Error Boundary Component
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let displayMessage = "Ha ocurrido un error inesperado.";
      try {
        if (this.state.error?.message) {
          const parsed = JSON.parse(this.state.error.message);
          if (parsed.error && parsed.error.includes('insufficient permissions')) {
            displayMessage = "Error de permisos: No tienes autorización para realizar esta acción o ver estos datos. Asegúrate de estar en la lista de usuarios autorizados.";
          } else if (parsed.error && parsed.error.includes('the client is offline')) {
            displayMessage = "Error de conexión: No se pudo conectar con la base de datos SQLite. Verifica que el servidor local esté iniciado.";
          } else {
            displayMessage = `Error: ${parsed.error || this.state.error.message}`;
          }
        }
      } catch (e) {
        displayMessage = this.state.error?.message || displayMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center border border-red-100">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">¡Ups! Algo salió mal</h2>
            <p className="text-slate-600 mb-6 text-sm">{displayMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-indigo-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-indigo-700 transition-colors"
            >
              Recargar Aplicación
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Types
interface Employee {
  id: string;
  fullName: string;
  department: string;
  position: string;
}

interface EPP {
  id: string;
  name: string;
  category: string;
  size?: string;
  stock: number;
  quantity?: number;
  selectionId?: string;
}

interface AuthorizedUser {
  id?: string;
  email: string;
  role: 'admin' | 'user';
  name?: string;
}

interface DeliveryItem {
  eppId: string;
  eppName: string;
  eppSize?: string;
  quantity: number;
}

interface Delivery {
  id?: string;
  employeeId: string;
  employeeName: string;
  items: DeliveryItem[];
  type: 'nuevo' | 'reemplazo';
  date: any;
  signature: string;
}

// --- MOCK DATE FOR TESTING ---
const MOCK_DATE_ENABLED = false;
const getNow = () => MOCK_DATE_ENABLED ? new Date('2026-10-15T12:00:00') : new Date();
// -----------------------------

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<LocalUser | null>(null);
  const [loading, setLoading] = useState(true);
  
  const getDate = (date: any) => {
    if (!date) return Date.now() + 10000; // Put pending server timestamps at the top
    if (date && typeof date.toDate === 'function') return date.toDate().getTime();
    if (date instanceof Date) return date.getTime();
    if (typeof date === 'string') {
      const parts = date.split('/');
      if (parts.length >= 3) {
        const d = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const yearAndTime = parts[2].split(',');
        const y = parseInt(yearAndTime[0].trim(), 10);
        if (yearAndTime.length > 1) {
          const timeStr = yearAndTime[1].trim();
          const timeParts = timeStr.match(/(\d+):(\d+):(\d+)\s*(a\.m\.|p\.m\.|am|pm)?/i);
          if (timeParts) {
            let hh = parseInt(timeParts[1], 10);
            const mm = parseInt(timeParts[2], 10);
            const ss = parseInt(timeParts[3], 10);
            const ampm = timeParts[4]?.toLowerCase();
            if (ampm && (ampm.includes('p')) && hh < 12) hh += 12;
            if (ampm && (ampm.includes('a')) && hh === 12) hh = 0;
            const parsed = new Date(y, m, d, hh, mm, ss);
            if (!isNaN(parsed.getTime())) return parsed.getTime();
          }
        }
        const parsed = new Date(y, m, d);
        if (!isNaN(parsed.getTime())) return parsed.getTime();
      }
      const parsed = new Date(date);
      if (!isNaN(parsed.getTime())) return parsed.getTime();
    }
    return 0;
  };

  const isDifferentDay = (t1: number, t2: number) => {
    const d1 = new Date(t1);
    const d2 = new Date(t2);
    return d1.getFullYear() !== d2.getFullYear() ||
           d1.getMonth() !== d2.getMonth() ||
           d1.getDate() !== d2.getDate();
  };

  const [activeTab, setActiveTab] = useState<'delivery' | 'history' | 'setup' | 'alerts'>('delivery');
  const [fullEppCatalog, setFullEppCatalog] = useState<EPP[]>([]);
  const [isPreloadingCatalog, setIsPreloadingCatalog] = useState(false);

  // Background catalog loader for fuzzy search
  const preloadCatalog = async () => {
    if (fullEppCatalog.length > 0 || isPreloadingCatalog) return;
    setIsPreloadingCatalog(true);
    try {
      console.log("Preloading EPP catalog for local search index...");
      const q = query(collection(db, 'epp_catalog'), limit(5000));
      const snap = await getDocs(q);
      const items = snap.docs.map(d => ({ ...d.data(), id: d.id } as EPP));
      setFullEppCatalog(items);
      console.log(`Index preloaded with ${items.length} items.`);
    } catch (err) {
      console.error("Error preloading catalog:", err);
    } finally {
      setIsPreloadingCatalog(false);
    }
  };

  useEffect(() => {
    if (user && activeTab === 'setup') {
      preloadCatalog();
    }
  }, [user, activeTab]);

  // Internal Alerts Logging (Fallback for email)
  const saveAlertToDatabase = async (employee: Employee, items: any[], warnings: string[]) => {
    try {
      await addDoc(collection(db, 'alerts'), {
        employeeId: employee.id,
        employeeName: employee.fullName,
        warnings,
        items,
        date: MOCK_DATE_ENABLED ? getNow() : serverTimestamp(),
        status: 'pendiente'
      });
      console.log('Internal alert logged successfully');
    } catch (error) {
      console.error('Error logging internal alert:', error);
    }
  };

  // Email Notification Helper
  const sendAdminNotification = async (employee: Employee, items: any[], warnings: string[]) => {
    const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID;
    const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
    const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;
    const adminEmail = import.meta.env.VITE_ADMIN_EMAIL || 'w.medinaconsorcio@gmail.com';

    if (!serviceId || !templateId || !publicKey) {
      console.warn('EmailJS configuration missing. Notification not sent.');
      return;
    }

    try {
      const templateParams = {
        to_email: adminEmail,
        employee_name: employee.fullName,
        employee_id: employee.id,
        items_delivered: items.map(i => `${i.eppName} (Talla: ${i.eppSize}, Cant: ${i.quantity})`).join(', '),
        alerts: warnings.join('\n'),
        timestamp: new Date().toLocaleString()
      };

      await emailjs.send(serviceId, templateId, templateParams, publicKey);
      console.log('Admin notification sent successfully');
    } catch (error) {
      console.error('Error sending admin notification:', error);
    }
  };

  // Delivery State
  const [searchId, setSearchId] = useState('');
  const [employeeSearchResults, setEmployeeSearchResults] = useState<Employee[]>([]);
  const [foundEmployee, setFoundEmployee] = useState<Employee | null>(null);
  const [searchEppId, setSearchEppId] = useState('');
  const [eppSearchResults, setEppSearchResults] = useState<EPP[]>([]);
  const [selectedEpps, setSelectedEpps] = useState<EPP[]>([]);
  
  // Catalog State
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [eppCatalog, setEppCatalog] = useState<EPP[]>([]);
  const [catalogSearchTerm, setCatalogSearchTerm] = useState('');
  const [eppSearchTerm, setEppSearchTerm] = useState('');
  const [showAllEmployees, setShowAllEmployees] = useState(false);
  const [showAllEpp, setShowAllEpp] = useState(false);
  const [isAddingEmployee, setIsAddingEmployee] = useState(false);
  const [isAddingEpp, setIsAddingEpp] = useState(false);
  const [newEmployee, setNewEmployee] = useState({ id: '', fullName: '', department: '', position: '' });
  const [newEpp, setNewEpp] = useState({ id: '', name: '', category: '', size: '', stock: 0 });
  const [editingEpp, setEditingEpp] = useState<EPP | null>(null);
  const [newStockValue, setNewStockValue] = useState<number>(0);
  const [deliveryType, setDeliveryType] = useState<'nuevo' | 'reemplazo'>('nuevo');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [authorizedUsers, setAuthorizedUsers] = useState<AuthorizedUser[]>([]);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const [isClearingCatalogModal, setIsClearingCatalogModal] = useState(false);
  const [newUser, setNewUser] = useState<AuthorizedUser & { password?: string }>({ email: '', role: 'user', name: '', password: '' });
  const [userActionLoading, setUserActionLoading] = useState(false);
  const [isEmailLogin, setIsEmailLogin] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isDbEmpty, setIsDbEmpty] = useState(false);
  const [systemAlerts, setSystemAlerts] = useState<any[]>([]);
  const itemToEditRef = useRef<EPP | null>(null);

  const isAdmin = authorizedUsers.some(u => u.email.toLowerCase() === user?.email?.toLowerCase() && u.role === 'admin') || user?.email?.toLowerCase() === 'elniger26@gmail.com';
  const isAuthorized = authorizedUsers.some(u => u.email.toLowerCase() === user?.email?.toLowerCase()) || user?.email?.toLowerCase() === 'elniger26@gmail.com';

  useEffect(() => {
    if (!isAdmin) return;
    const q = query(collection(db, 'alerts'), orderBy('date', 'desc'), limit(50));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const alertsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setSystemAlerts(alertsData);
    }, (error) => {
      handleDatabaseError(error, OperationType.GET, 'alerts');
    });
    return () => unsubscribe();
  }, [isAdmin]);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleAddUser = async () => {
    if (!newUser.email || !newUser.role) return;
    const cleanEmail = newUser.email.trim().toLowerCase();
    setUserActionLoading(true);
    try {
      if (newUser.password) {
        try {
          await createSecondaryUser(cleanEmail, newUser.password);
        } catch (authErr: any) {
          // If the email is already in use in local auth, we can still proceed to add them to the authorized list.
          if (authErr.code !== 'auth/email-already-in-use') {
            throw authErr;
          }
          console.log("User already exists in local auth, proceeding to authorize in SQLite.");
        }
      }
      
      await setDoc(doc(db, 'authorized_users', cleanEmail), {
        email: cleanEmail,
        role: newUser.role,
        name: newUser.name || '',
        createdAt: serverTimestamp()
      });
      
      setIsAddingUser(false);
      setNewUser({ email: '', role: 'user', name: '', password: '' });
      alert("Usuario agregado/autorizado correctamente");
    } catch (err: any) {
      console.error("Error adding user:", err);
      handleDatabaseError(err, OperationType.WRITE, `authorized_users/${cleanEmail}`);
      let message = (err as Error).message;
      if (err.code === 'auth/operation-not-allowed') {
        message = "No se pudo crear la cuenta local. Verifica la contraseña o vuelve a intentarlo.";
      } else if (err.code === 'auth/email-already-in-use') {
        message = "Este correo ya está registrado en el sistema de autenticación.";
      } else if (err.code === 'auth/weak-password') {
        message = "La contraseña es demasiado débil. Debe tener al menos 6 caracteres.";
      } else if (err.code === 'auth/invalid-email') {
        message = "El formato del correo electrónico no es válido.";
      }
      alert("Error al agregar usuario: " + message);
    } finally {
      setUserActionLoading(false);
    }
  };

  const [userToDelete, setUserToDelete] = useState<AuthorizedUser | null>(null);
  const [deliveryWarning, setDeliveryWarning] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [employeeAlerts, setEmployeeAlerts] = useState<{ boots?: Date; general?: Date } | null>(null);

  const confirmDeleteUser = async () => {
    if (!userToDelete || !userToDelete.id) return;
    setUserActionLoading(true);
    try {
      await deleteDoc(doc(db, 'authorized_users', userToDelete.id));
      alert("Usuario eliminado correctamente");
      setUserToDelete(null);
    } catch (err) {
      handleDatabaseError(err, OperationType.DELETE, `authorized_users/${userToDelete.id}`);
      alert("Error al eliminar usuario. Verifica tus permisos.");
    } finally {
      setUserActionLoading(false);
    }
  };

  const handleDeleteUser = (user: AuthorizedUser) => {
    if (user.email === auth.currentUser?.email) {
      alert("No puedes eliminarte a ti mismo");
      return;
    }
    setUserToDelete(user);
  };

  const handleToggleRole = async (userToUpdate: AuthorizedUser) => {
    if (userToUpdate.email === user?.email) return;
    const newRole = userToUpdate.role === 'admin' ? 'user' : 'admin';
    try {
      if (!userToUpdate.id) return;
      await updateDoc(doc(db, 'authorized_users', userToUpdate.id), {
        role: newRole
      });
    } catch (err) {
      handleDatabaseError(err, OperationType.UPDATE, `authorized_users/${userToUpdate.id}`);
      alert("Error al actualizar rol. Verifica tus permisos.");
    }
  };
  
  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    }
  };

  // History State
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [historySearchTerm, setHistorySearchTerm] = useState('');

  // Regex for EPP detection
  const bootsRegex = /\b(botas?|bot[ií]n(es)?|bota)/i;
  const glovesRegex = /\b(guantes?|guante)/i;

  // Pre-process deliveries to add alert info
  const deliveriesWithAlerts = React.useMemo(() => {
    // Sort all deliveries by employee and then by date to find previous deliveries
    const sorted = [...deliveries].sort((a, b) => {
      if (a.employeeId !== b.employeeId) return a.employeeId.localeCompare(b.employeeId);
      const dateA = getDate(a.date);
      const dateB = getDate(b.date);
      return dateA - dateB; // Ascending for easier "previous" lookup
    });

    const alertMap = new Map<string, { boots?: Date; gloves?: Date; general?: Date; duplicate?: { name: string; date: Date } }>();
    
    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i];
      const currDate = getDate(current.date);
      
      const alerts: { boots?: Date; gloves?: Date; general?: Date; duplicate?: { name: string; date: Date } } = {};
      
      // 1. Check for exact same EPP repeat (Duplicate)
      if (current.items) {
        for (const currItem of current.items) {
          let lastSame = null;
          for (let j = i - 1; j >= 0 && sorted[j].employeeId === current.employeeId; j--) {
            if (sorted[j].items?.some((prevItem: any) => prevItem.eppId === currItem.eppId)) {
              lastSame = sorted[j];
              break;
            }
          }
          
          if (lastSame) {
            const lastDate = getDate(lastSame.date);
            const diffDays = (currDate - lastDate) / (1000 * 60 * 60 * 24);
            if (diffDays < 45) { // Any repeat within 45 days (including same day)
              alerts.duplicate = { name: currItem.eppName, date: new Date(lastDate) };
              break;
            }
          }
        }
      }

      // 2. Boots alert (< 180 days)
      const isDeliveringBoots = current.items && current.items.some((item: any) => bootsRegex.test(item.eppName));
      if (isDeliveringBoots) {
        let lastBoots = null;
        for (let j = i - 1; j >= 0 && sorted[j].employeeId === current.employeeId; j--) {
          if (sorted[j].items && sorted[j].items.some((item: any) => bootsRegex.test(item.eppName))) {
            lastBoots = sorted[j];
            break;
          }
        }
        
        if (lastBoots) {
          const lastBootsDate = getDate(lastBoots.date);
          const diffBootsDays = (currDate - lastBootsDate) / (1000 * 60 * 60 * 24);
          if (diffBootsDays < 180) {
            alerts.boots = new Date(lastBootsDate);
          }
        }
      }

      // 3. Gloves alert (< 45 days)
      const isDeliveringGloves = current.items && current.items.some((item: any) => glovesRegex.test(item.eppName));
      if (isDeliveringGloves) {
        let lastGloves = null;
        for (let j = i - 1; j >= 0 && sorted[j].employeeId === current.employeeId; j--) {
          if (sorted[j].items && sorted[j].items.some((item: any) => glovesRegex.test(item.eppName))) {
            lastGloves = sorted[j];
            break;
          }
        }
        
        if (lastGloves) {
          const lastGlovesDate = getDate(lastGloves.date);
          const diffGlovesDays = (currDate - lastGlovesDate) / (1000 * 60 * 60 * 24);
          if (diffGlovesDays < 45) {
            alerts.gloves = new Date(lastGlovesDate);
          }
        }
      }

      // 4. General frequency alert (Any EPP < 45 days, different day) - Only if not already alerted
      const prev = i > 0 && sorted[i-1].employeeId === current.employeeId ? sorted[i-1] : null;
      if (prev) {
        const prevDate = getDate(prev.date);
        const diffDays = (currDate - prevDate) / (1000 * 60 * 60 * 24);
        if (isDifferentDay(currDate, prevDate) && diffDays < 45 && !alerts.duplicate && !alerts.gloves) {
          alerts.general = new Date(prevDate);
        }
      }
      
      if (Object.keys(alerts).length > 0 && current.id) {
        alertMap.set(current.id, alerts);
      }
    }
    
    return deliveries.map(d => ({
      ...d,
      alerts: d.id ? alertMap.get(d.id) : undefined
    })).sort((a, b) => getDate(b.date) - getDate(a.date));
  }, [deliveries]);

  const flattenedDeliveries = React.useMemo(() => {
    const flattened: any[] = [];
    deliveriesWithAlerts.forEach(delivery => {
      if ((delivery as any).items && (delivery as any).items.length > 0) {
        (delivery as any).items.forEach((item: any, index: number) => {
          flattened.push({
            ...delivery,
            flattenedItem: item,
            flattenedId: `${delivery.id}-${index}`
          });
        });
      } else {
        // Soporte para entregas antiguas sin array de items
        flattened.push({
          ...delivery,
          flattenedItem: {
            eppName: (delivery as any).eppName,
            eppSize: (delivery as any).eppSize,
            quantity: 1
          },
          flattenedId: delivery.id
        });
      }
    });
    return flattened;
  }, [deliveriesWithAlerts]);

  const filteredDeliveries = flattenedDeliveries.filter(delivery => {
    const term = historySearchTerm.toLowerCase();
    const item = delivery.flattenedItem;
    const itemMatch = item.eppName.toLowerCase().includes(term) || 
                     (item.eppSize && item.eppSize.toLowerCase().includes(term));
    
    return (
      delivery.employeeName.toLowerCase().includes(term) ||
      delivery.employeeId.toLowerCase().includes(term) ||
      itemMatch
    );
  });

  // Signature Ref
  const sigCanvas = useRef<SignatureCanvas | null>(null);
  const sigContainerRef = useRef<HTMLDivElement>(null);
  const historyImportInputRef = useRef<HTMLInputElement | null>(null);
  const catalogFetchSeq = useRef(0);

  // Resize signature canvas on window resize
  useEffect(() => {
    const handleResize = () => {
      if (sigCanvas.current && sigContainerRef.current) {
        const canvas = sigCanvas.current.getCanvas();
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width = sigContainerRef.current.offsetWidth * ratio;
        canvas.height = sigContainerRef.current.offsetHeight * ratio;
        canvas.getContext('2d')?.scale(ratio, ratio);
        sigCanvas.current.clear(); // Clear to avoid distortion
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize(); // Initial call
    return () => window.removeEventListener('resize', handleResize);
  }, [activeTab]); // Re-run when tab changes to ensure container is visible

  const exportToExcel = (data: any[], fileName: string, sheetName: string) => {
    try {
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      XLSX.writeFile(wb, `${fileName}_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (error) {
      console.error("Error exporting to Excel:", error);
      alert("Error al exportar a Excel");
    }
  };

  const exportDeliveriesExcel = () => {
    const data = filteredDeliveries.map(d => {
      const date = d.date?.toDate ? d.date.toDate().toLocaleDateString() : 'Reciente';
      const time = d.date?.toDate ? d.date.toDate().toLocaleTimeString() : '-';
      const item = d.flattenedItem;
      
      let alertText = '-';
      if (d.alerts) {
        const alerts = [];
        if (d.alerts.duplicate && d.alerts.duplicate.name === item.eppName) alerts.push(`REPETIDO: ${item.eppName}`);
        if (d.alerts.boots && bootsRegex.test(item.eppName)) alerts.push('BOTAS');
        if (d.alerts.gloves && glovesRegex.test(item.eppName)) alerts.push('GUANTES');
        if (d.alerts.general) alerts.push('FRECUENCIA');
        if (alerts.length > 0) alertText = alerts.join(' / ');
      }

      return {
        'Fecha': date,
        'Hora': time,
        'ID Empleado': d.employeeId,
        'Nombre Empleado': d.employeeName,
        'Equipo': item.eppName,
        'Talla': item.eppSize || extractSize(item.eppName) || '-',
        'Cantidad': item.quantity || 1,
        'Tipo': d.type.toUpperCase(),
        'Alerta': alertText
      };
    });
    exportToExcel(data, 'entregas_epp', 'Entregas');
  };

  const exportCatalogExcel = () => {
    const data = eppCatalog.map(item => ({
      'ID/Código': item.id,
      'Nombre de Equipo': item.name,
      'Categoría': item.category || '-',
      'Stock Actual': item.stock || 0,
      'Talla': item.size || '-'
    }));
    exportToExcel(data, 'catalogo_epp', 'Catálogo');
  };

  const exportAlertsExcel = () => {
    const data = systemAlerts.map(alert => {
      const date = alert.date?.toDate ? alert.date.toDate().toLocaleDateString() : '-';
      const time = alert.date?.toDate ? alert.date.toDate().toLocaleTimeString() : '-';
      const alertsText = (alert.warnings || []).join(' | ');
      return {
        'Fecha': date,
        'Hora': time,
        'Empleado': alert.employeeName,
        'ID Empleado': alert.employeeId,
        'Alertas Detectadas': alertsText,
        'Estado': (alert.status || 'pendiente').toUpperCase()
      };
    });
    exportToExcel(data, 'alertas_sistema', 'Alertas');
  };

  const readImportCell = (row: Record<string, any>, labels: string[]) => {
    const normalize = (value: string) => value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');

    const normalizedRow = new Map<string, any>();
    Object.entries(row).forEach(([key, value]) => {
      normalizedRow.set(normalize(key), value);
    });

    for (const label of labels) {
      const value = normalizedRow.get(normalize(label));
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return value;
      }
    }
    return '';
  };

  const parseImportedDate = (dateValue: any, timeValue: any) => {
    let date: Date | null = null;

    if (typeof dateValue === 'number') {
      const parsed = XLSX.SSF.parse_date_code(dateValue);
      if (parsed) {
        date = new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, Math.floor(parsed.S || 0));
      }
    } else if (dateValue instanceof Date) {
      date = dateValue;
    } else if (dateValue) {
      const text = String(dateValue).trim();
      const slashMatch = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})(.*)$/);
      if (slashMatch) {
        const day = Number(slashMatch[1]);
        const month = Number(slashMatch[2]) - 1;
        const year = Number(slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3]);
        date = new Date(year, month, day);
      } else {
        const parsed = new Date(text);
        if (!isNaN(parsed.getTime())) date = parsed;
      }
    }

    if (!date || isNaN(date.getTime())) date = new Date();

    if (timeValue !== undefined && timeValue !== null && String(timeValue).trim() !== '') {
      if (typeof timeValue === 'number') {
        const totalSeconds = Math.round(timeValue * 24 * 60 * 60);
        date.setHours(Math.floor(totalSeconds / 3600), Math.floor((totalSeconds % 3600) / 60), totalSeconds % 60, 0);
      } else {
        const timeText = String(timeValue).trim();
        const match = timeText.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|am|pm)?/i);
        if (match) {
          let hours = Number(match[1]);
          const minutes = Number(match[2]);
          const seconds = Number(match[3] || 0);
          const meridian = match[4]?.toLowerCase() || '';
          if (meridian.includes('p') && hours < 12) hours += 12;
          if (meridian.includes('a') && hours === 12) hours = 0;
          date.setHours(hours, minutes, seconds, 0);
        }
      }
    }

    return date;
  };

  const handleImportHistoryExcel = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setIsSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });

      if (rows.length === 0) {
        setErrorMessage('El archivo no contiene filas para importar.');
        return;
      }

      const deliveryGroups = new Map<string, Delivery>();
      const employeesToUpsert = new Map<string, Employee>();
      const eppsToUpsert = new Map<string, Partial<EPP> & { id: string }>();

      rows.forEach((row, index) => {
        const employeeId = String(readImportCell(row, ['ID Empleado', 'Empleado ID', 'Cedula', 'Cédula', 'Ficha', 'employeeId']) || '').trim();
        const employeeName = String(readImportCell(row, ['Nombre Empleado', 'Empleado', 'Nombre', 'Colaborador', 'employeeName']) || '').trim();
        const eppIdRaw = String(readImportCell(row, ['ID EPP', 'Codigo EPP', 'Código EPP', 'Codigo', 'Código', 'Item', 'eppId']) || '').trim();
        const eppName = String(readImportCell(row, ['Equipo', 'EPP', 'Articulo', 'Artículo', 'Descripcion', 'Descripción', 'Description', 'eppName']) || '').trim();
        const eppSize = String(readImportCell(row, ['Talla', 'Size', 'eppSize']) || '').trim();
        const quantityValue = readImportCell(row, ['Cantidad', 'Cant.', 'Cant', 'Quantity']);
        const quantity = Math.max(1, Number.parseInt(String(quantityValue || '1'), 10) || 1);
        const importedType = String(readImportCell(row, ['Tipo', 'Tipo Entrega', 'type']) || 'nuevo').toLowerCase();
        const type: 'nuevo' | 'reemplazo' = importedType.includes('reem') ? 'reemplazo' : 'nuevo';
        const signature = String(readImportCell(row, ['Firma', 'Signature', 'signature']) || '').trim();
        const date = parseImportedDate(
          readImportCell(row, ['Fecha', 'Date', 'Fecha Entrega']),
          readImportCell(row, ['Hora', 'Time']),
        );

        if (!employeeId || !employeeName || !eppName) {
          console.warn('Fila de historial omitida por datos incompletos:', index + 2, row);
          return;
        }

        const eppId = eppIdRaw || eppName.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || `EPP-${index + 1}`;
        const groupKey = [
          date.toISOString(),
          employeeId.toLowerCase(),
          employeeName.toLowerCase(),
          type,
          signature.slice(0, 30)
        ].join('|');

        if (!deliveryGroups.has(groupKey)) {
          deliveryGroups.set(groupKey, {
            id: `import-${date.getTime()}-${employeeId}-${deliveryGroups.size + 1}`.replace(/[^a-zA-Z0-9-_]/g, '-'),
            employeeId,
            employeeName,
            items: [],
            type,
            date,
            signature
          });
        }

        deliveryGroups.get(groupKey)!.items.push({
          eppId,
          eppName,
          eppSize: eppSize || extractSize(eppName) || '',
          quantity
        });

        employeesToUpsert.set(employeeId, {
          id: employeeId,
          fullName: employeeName,
          department: String(readImportCell(row, ['Departamento', 'Department']) || '-'),
          position: String(readImportCell(row, ['Cargo', 'Posición', 'Position']) || '-')
        });

        eppsToUpsert.set(eppId, {
          id: eppId,
          name: eppName,
          size: eppSize || extractSize(eppName) || '',
          category: String(readImportCell(row, ['Categoria', 'Categoría', 'Category']) || 'Importado')
        });
      });

      const importedDeliveries = Array.from(deliveryGroups.values()).filter(delivery => delivery.items.length > 0);
      if (importedDeliveries.length === 0) {
        setErrorMessage('No se detectaron entregas válidas. Revisa columnas como Fecha, ID Empleado, Nombre Empleado, Equipo y Cantidad.');
        return;
      }

      const operations: Array<{ kind: 'delivery' | 'employee' | 'epp'; id: string; data: any }> = [
        ...importedDeliveries.map(delivery => ({ kind: 'delivery' as const, id: delivery.id!, data: delivery })),
        ...Array.from(employeesToUpsert.values()).map(employee => ({ kind: 'employee' as const, id: employee.id, data: employee })),
        ...Array.from(eppsToUpsert.values()).map(epp => ({ kind: 'epp' as const, id: epp.id, data: epp })),
      ];

      for (let i = 0; i < operations.length; i += 300) {
        const batch = writeBatch(db);
        operations.slice(i, i + 300).forEach(operation => {
          if (operation.kind === 'delivery') {
            batch.set(doc(db, 'deliveries', operation.id), operation.data, { merge: true });
          } else if (operation.kind === 'employee') {
            batch.set(doc(db, 'employees', operation.id), operation.data, { merge: true });
          } else {
            batch.set(doc(db, 'epp_catalog', operation.id), operation.data, { merge: true });
          }
        });
        await batch.commit();
      }

      setDeliveries(prev => {
        const existingIds = new Set(prev.map(delivery => delivery.id));
        const fresh = importedDeliveries.filter(delivery => !existingIds.has(delivery.id));
        return [...fresh, ...prev].sort((a, b) => getDate(b.date) - getDate(a.date));
      });
      setFullEppCatalog([]);
      setSuccessMessage(`Historial importado: ${importedDeliveries.length} entregas, ${employeesToUpsert.size} empleados y ${eppsToUpsert.size} equipos consolidados.`);
      setTimeout(() => setSuccessMessage(''), 5000);
    } catch (err) {
      console.error('Error importing history:', err);
      setErrorMessage('Error al importar el historial: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSearchEmployee = async () => {
    if (!searchId.trim()) return;
    setErrorMessage('');
    setEmployeeSearchResults([]);
    try {
      const term = searchId.trim();
      const termUpper = term.toUpperCase();
      const termCapitalized = term.charAt(0).toUpperCase() + term.slice(1).toLowerCase();

      const exactEmployeeDoc = await getDocFromServer(doc(db, 'employees', term));
      const exactEmployeeDocUpper = termUpper !== term ? await getDocFromServer(doc(db, 'employees', termUpper)) : null;
      if (exactEmployeeDoc.exists() || exactEmployeeDocUpper?.exists()) {
        const employee = (exactEmployeeDoc.exists() ? exactEmployeeDoc.data() : exactEmployeeDocUpper?.data()) as Employee;
        setFoundEmployee(employee);
        setEmployeeSearchResults([]);
        setErrorMessage('');
        return;
      }
      
      const employeeQueries = [
        query(collection(db, 'employees'), where('id', '>=', termUpper), where('id', '<=', termUpper + '\uf8ff'), limit(10)),
        query(collection(db, 'employees'), where('fullName', '>=', termUpper), where('fullName', '<=', termUpper + '\uf8ff'), limit(10)),
        query(collection(db, 'employees'), where('fullName', '>=', termCapitalized), where('fullName', '<=', termCapitalized + '\uf8ff'), limit(10))
      ];

      const snapshots = (await Promise.allSettled(employeeQueries.map(q => getDocs(q))))
        .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
        .map(result => result.value);
      const allResults = snapshots.flatMap(s => s.docs.map(doc => doc.data() as Employee));
      
      // Filter unique by ID
      const uniqueResults: Employee[] = [];
      const seenIds = new Set<string>();
      for (const item of allResults) {
        if (!seenIds.has(item.id)) {
          uniqueResults.push(item);
          seenIds.add(item.id);
        }
      }

      setEmployeeSearchResults(uniqueResults);
      
      if (uniqueResults.length === 1) {
        setFoundEmployee(uniqueResults[0]);
        setErrorMessage('');
        setEmployeeSearchResults([]);
      } else if (uniqueResults.length > 1) {
        setFoundEmployee(null);
        setErrorMessage('');
      } else {
        setFoundEmployee(null);
        setErrorMessage('Empleado no encontrado');
      }
    } catch (err) {
      console.error('Error searching employee:', err);
      setFoundEmployee(null);
      setErrorMessage('No se pudo buscar el empleado. Intente nuevamente.');
    }
  };

  const handleSearchEpp = async () => {
    if (!searchEppId.trim()) return;
    setErrorMessage('');
    setEppSearchResults([]);
    try {
      const term = searchEppId.trim();
      const termUpper = term.toUpperCase();
      
      // 1. Try exact ID match first
      const exactDoc = await getDocFromServer(doc(db, 'epp_catalog', term));
      const exactDocUpper = await getDocFromServer(doc(db, 'epp_catalog', termUpper));
      
      let exactMatch: EPP | null = null;
      if (exactDoc.exists()) {
        exactMatch = { ...exactDoc.data(), id: exactDoc.id } as EPP;
      } else if (exactDocUpper.exists()) {
        exactMatch = { ...exactDocUpper.data(), id: exactDocUpper.id } as EPP;
      }

      if (exactMatch) {
        setEppSearchResults([exactMatch]);
        setErrorMessage('');
        return;
      }

      const termCapitalized = term.charAt(0).toUpperCase() + term.slice(1).toLowerCase();
      const allQueries = [
        query(collection(db, 'epp_catalog'), where('id', '>=', termUpper), where('id', '<=', termUpper + '\uf8ff'), limit(20)),
        query(collection(db, 'epp_catalog'), where('name', '>=', termUpper), where('name', '<=', termUpper + '\uf8ff'), limit(20)),
        query(collection(db, 'epp_catalog'), where('name', '>=', termCapitalized), where('name', '<=', termCapitalized + '\uf8ff'), limit(20))
      ];
      
      const snapshots = (await Promise.allSettled(allQueries.map(q => getDocs(q))))
        .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
        .map(result => result.value);
      const allResults = snapshots.flatMap(s => s.docs.map(doc => ({ ...(doc.data() as any), id: doc.id } as EPP)));
      
      // Filter unique and prioritize
      const resultsMap = new Map<string, EPP>();
      if (exactMatch) resultsMap.set(exactMatch.id, exactMatch);
      allResults.forEach(item => {
        if (!resultsMap.has(item.id)) resultsMap.set(item.id, item);
      });

      // 3. Fallback: Local Fuzzy Search (Substring/Suffix match for IDs and Names)
      // This allows matching "last digits" as requested by user
      if (resultsMap.size < 10 && fullEppCatalog.length > 0) {
        const fuzzyResults = fullEppCatalog.filter(item => {
          const idStr = String(item.id).toUpperCase();
          const nameStr = String(item.name || "").toUpperCase();
          const idMatch = idStr.includes(termUpper);
          const nameMatch = nameStr.includes(termUpper);
          return idMatch || nameMatch;
        });

        fuzzyResults.forEach(item => {
          if (!resultsMap.has(item.id)) resultsMap.set(item.id, item);
        });
      }

      const finalResults = Array.from(resultsMap.values());
      setEppSearchResults(finalResults);
      
      if (finalResults.length === 0) {
        setErrorMessage('Equipo no encontrado. Verifique el código o nombre.');
      } else {
        setErrorMessage('');
      }
    } catch (err) {
      console.error('Error searching EPP:', err);
      setErrorMessage('No se pudo buscar el EPP. Intente nuevamente.');
    }
  };

  useEffect(() => {
    if (user) {
      const unsubscribe = onSnapshot(collection(db, 'authorized_users'), (snapshot) => {
        setAuthorizedUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AuthorizedUser)));
      }, (error) => {
        handleDatabaseError(error, OperationType.LIST, 'authorized_users');
      });
      return () => unsubscribe();
    }
  }, [user]);

  // Auto-search Employee
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchId.trim()) {
        handleSearchEmployee();
      } else {
        setFoundEmployee(null);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [searchId]);

  // Auto-search EPP
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchEppId.trim()) {
        handleSearchEpp();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [searchEppId]);

  // Fetch employee history for alerts when selected
  useEffect(() => {
    const fetchEmployeeAlerts = async () => {
      if (!foundEmployee) {
        setEmployeeAlerts(null);
        return;
      }

      try {
        const qHistory = query(
          collection(db, 'deliveries'),
          where('employeeId', '==', foundEmployee.id),
          orderBy('date', 'desc'),
          limit(20)
        );
        
        const historySnapshot = await getDocs(qHistory);
        const history = historySnapshot.docs.map(doc => {
          const data = doc.data() as Delivery;
          let dateObj: Date;
          if (data.date && typeof data.date.toDate === 'function') {
            dateObj = data.date.toDate();
          } else if (data.date instanceof Date) {
            dateObj = data.date;
          } else {
            dateObj = getNow();
          }
          return { ...data, date: dateObj } as Delivery;
        });

        const sixMonthsAgo = getNow();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const fortyFiveDaysAgo = getNow();
        fortyFiveDaysAgo.setDate(fortyFiveDaysAgo.getDate() - 45);

        const alerts: { boots?: Date; general?: Date } = {};

        const isDeliveringBoots = selectedEpps.some(epp => bootsRegex.test(epp.name));
        const isDeliveringGloves = selectedEpps.some(epp => glovesRegex.test(epp.name));

        // Check boots only if delivering boots
        if (isDeliveringBoots) {
          const lastBoots = history.find(d => 
            d.items && d.items.some((item: any) => bootsRegex.test(item.eppName))
          );
          if (lastBoots && lastBoots.date > sixMonthsAgo) {
            alerts.boots = lastBoots.date;
          }
        }

        // Check general frequency (45 days) for items being delivered
        // This includes gloves and any other item that might have been delivered before
        selectedEpps.forEach(epp => {
          const lastSameEpp = history.find(d => 
            d.items && d.items.some((item: any) => item.eppId === epp.id)
          );
          
          // If it's the same exact EPP, check 45 days
          if (lastSameEpp && lastSameEpp.date > fortyFiveDaysAgo) {
            if (!alerts.general || lastSameEpp.date > alerts.general) {
              alerts.general = lastSameEpp.date;
            }
          }
          
          // Special case for gloves category if not already caught by exact ID
          if (glovesRegex.test(epp.name)) {
            const lastGloves = history.find(d => 
              d.items && d.items.some((item: any) => glovesRegex.test(item.eppName))
            );
            if (lastGloves && lastGloves.date > fortyFiveDaysAgo) {
              if (!alerts.general || lastGloves.date > alerts.general) {
                alerts.general = lastGloves.date;
              }
            }
          }
        });

        setEmployeeAlerts(Object.keys(alerts).length > 0 ? alerts : null);
      } catch (err) {
        console.error("Error fetching employee alerts:", err);
      }
    };

    fetchEmployeeAlerts();
  }, [foundEmployee, deliveries, selectedEpps]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    // Test connection to SQLite
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check the local SQLite API.");
        }
      }
    };
    testConnection();

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      // Check if database is empty
      const checkDb = async () => {
        try {
          const empSnap = await getDocs(query(collection(db, 'employees'), limit(1)));
          const eppSnap = await getDocs(query(collection(db, 'epp_catalog'), limit(1)));
          setIsDbEmpty(empSnap.empty && eppSnap.empty);
        } catch (err) {
          console.error("Error checking DB status:", err);
        }
      };
      checkDb();

      // Fetch Deliveries (Keep this real-time as it's usually fewer items or we can limit it)
      const q = query(collection(db, 'deliveries'), orderBy('date', 'desc'), limit(100));
      const unsubscribeDeliveries = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
        const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Delivery));
        setDeliveries(items);
      }, (error) => {
        handleDatabaseError(error, OperationType.LIST, 'deliveries');
      });

      return () => {
        unsubscribeDeliveries();
      };
    }
  }, [user]);

  // Separate effect for Catalog data to avoid loading 2500+ items at once
  useEffect(() => {
    if (user && activeTab === 'setup') {
      const timer = window.setTimeout(() => {
        fetchCatalogData();
      }, 250);

      return () => window.clearTimeout(timer);
    }
  }, [user, activeTab, catalogSearchTerm, eppSearchTerm, showAllEmployees, showAllEpp]);

  const handleClearCatalog = async () => {
    setIsSubmitting(true);
    setIsLoadingCatalog(true);
    setEppCatalog([]); 
    setFullEppCatalog([]); // Clear fuzzy search index too
    setEppSearchTerm(''); 
    
    try {
      const currentUser = auth.currentUser;
      console.log("Iniciando vaciado del catálogo por:", currentUser?.email);

      let totalDeleted = 0;
      let hasMore = true;
      let iterations = 0;

      while (hasMore && iterations < 30) {
        iterations++;
        const batchQuery = query(collection(db, 'epp_catalog'), limit(450));
        const snap = await getDocs(batchQuery); 
        
        if (snap.empty) {
          hasMore = false;
          break;
        }
        
        const batch = writeBatch(db);
        snap.docs.forEach(d => {
          batch.delete(d.ref);
          totalDeleted++;
        });
        
        await batch.commit();
        await new Promise(r => setTimeout(r, 400));
      }
      
      setSuccessMessage(`Catálogo vaciado exitosamente. Se eliminaron ${totalDeleted} artículos.`);
      setIsClearingCatalogModal(false);
      await fetchCatalogData();
      setFullEppCatalog([]); // Trigger re-index on next search
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      console.error("ERROR CRÍTICO AL VACIAR:", err);
      setErrorMessage("Error al vaciar catálogo: " + (err as Error).message);
    } finally {
      setIsSubmitting(false);
      setIsLoadingCatalog(false);
    }
  };

  const clearDeliveryHistory = async () => {
    setIsSubmitting(true);
    try {
      console.log("Iniciando vaciado del historial...");
      
      let totalDeleted = 0;
      let hasMore = true;
      let iterations = 0;

      // Loop to handle large catalog cleanup in small batches
      while (hasMore && iterations < 50) {
        iterations++;
        const q = query(collection(db, 'deliveries'), limit(450));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
          hasMore = false;
          break;
        }

        const batch = writeBatch(db);
        snapshot.docs.forEach((doc) => {
          batch.delete(doc.ref);
          totalDeleted++;
        });

        await batch.commit();
        // Brief pause to avoid overwhelming
        await new Promise(r => setTimeout(r, 300));
      }

      // Also optionally clear alerts if we want a full reset
      let alertsDeleted = 0;
      hasMore = true;
      iterations = 0;
      while (hasMore && iterations < 50) {
        iterations++;
        const qAlerts = query(collection(db, 'alerts'), limit(450));
        const snapAlerts = await getDocs(qAlerts);
        if (snapAlerts.empty) {
          hasMore = false;
          break;
        }
        const batch = writeBatch(db);
        snapAlerts.docs.forEach(doc => {
          batch.delete(doc.ref);
          alertsDeleted++;
        });
        await batch.commit();
        await new Promise(r => setTimeout(r, 300));
      }
      
      setSuccessMessage(`Historial vaciado con éxito: ${totalDeleted} entregas y ${alertsDeleted} alertas eliminadas.`);
      setIsClearingHistory(false);
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      console.error("Error clearing history:", err);
      setErrorMessage('Error al reiniciar el historial: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSubmitting(false);
    }
  };

  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);

  const withCatalogTimeout = async <T,>(
    promise: Promise<T>,
    message = 'La sincronizacion tardo demasiado. Intente refrescar nuevamente.'
  ): Promise<T> => {
    let timeoutId: number | undefined;

    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeoutId = window.setTimeout(() => reject(new Error(message)), 10000);
        })
      ]);
    } finally {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    }
  };

  const fetchCatalogData = async () => {
    const fetchSeq = ++catalogFetchSeq.current;
    setIsLoadingCatalog(true);
    try {
      const term = eppSearchTerm.trim();
      const termUpper = term.toUpperCase();
      const termLower = term.toLowerCase();
      const termCapitalized = term.charAt(0).toUpperCase() + term.slice(1).toLowerCase();
      let nextEmployees: Employee[] | null = null;
      let nextEppCatalog: EPP[] | null = null;

      // Employees
      if (catalogSearchTerm.trim()) {
        const empTerm = catalogSearchTerm.trim();
        const empTermUpper = empTerm.toUpperCase();
        const empTermCap = empTerm.charAt(0).toUpperCase() + empTerm.slice(1).toLowerCase();
        
        const q1 = query(collection(db, 'employees'), where('id', '>=', empTermUpper), where('id', '<=', empTermUpper + '\uf8ff'), limit(50));
        const q2 = query(collection(db, 'employees'), where('fullName', '>=', empTermCap), where('fullName', '<=', empTermCap + '\uf8ff'), limit(50));
        
        const [s1, s2] = await withCatalogTimeout(Promise.all([getDocs(q1), getDocs(q2)]));
        const empResults: Employee[] = [];
        const seenEmpIds = new Set<string>();
        [...s1.docs, ...s2.docs].forEach(doc => {
          const d = doc.data() as Employee;
          if (!seenEmpIds.has(d.id)) {
            empResults.push(d);
            seenEmpIds.add(d.id);
          }
        });
        nextEmployees = empResults;
      } else {
        const q = query(collection(db, 'employees'), limit(showAllEmployees ? 5000 : 50));
        const s = await withCatalogTimeout(getDocs(q));
        nextEmployees = s.docs.map(d => d.data() as Employee);
      }

      // EPP
      if (term) {
        let eppResults: EPP[] = [];
        const seenEppIds = new Set<string>();

        // Priority 1: Exact/Prefix ID
        const eq1 = query(collection(db, 'epp_catalog'), where('id', '>=', termUpper), where('id', '<=', termUpper + '\uf8ff'), limit(50));
        const eq2 = query(collection(db, 'epp_catalog'), where('id', '>=', term), where('id', '<=', term + '\uf8ff'), limit(50));
        
        const [es1, es2] = await withCatalogTimeout(Promise.all([getDocs(eq1), getDocs(eq2)]));
        [...es1.docs, ...es2.docs].forEach(doc => {
          const d = { ...doc.data(), id: doc.id } as EPP;
          if (!seenEppIds.has(d.id)) {
            eppResults.push(d);
            seenEppIds.add(d.id);
          }
        });

        // Priority 2: Name match if few results
        if (eppResults.length < 20) {
          const nq1 = query(collection(db, 'epp_catalog'), where('name', '>=', termUpper), where('name', '<=', termUpper + '\uf8ff'), limit(50));
          const nq2 = query(collection(db, 'epp_catalog'), where('name', '>=', termLower), where('name', '<=', termLower + '\uf8ff'), limit(50));
          const nq3 = query(collection(db, 'epp_catalog'), where('name', '>=', termCapitalized), where('name', '<=', termCapitalized + '\uf8ff'), limit(50));
          
          const [ns1, ns2, ns3] = await withCatalogTimeout(Promise.all([getDocs(nq1), getDocs(nq2), getDocs(nq3)]));
          [...ns1.docs, ...ns2.docs, ...ns3.docs].forEach(doc => {
            const d = { ...doc.data(), id: doc.id } as EPP;
            if (!seenEppIds.has(d.id)) {
              eppResults.push(d);
              seenEppIds.add(d.id);
            }
          });
        }

        // Priority 3: Local Substring Search (allows searching by numbers anywhere in ID/Name)
        if (eppResults.length < 50 && fullEppCatalog.length > 0) {
          const localMatch = fullEppCatalog.filter(item => {
            const idStr = String(item.id).toUpperCase();
            const nameStr = String(item.name || "").toUpperCase();
            const categoryStr = String(item.category || "").toUpperCase();
            return idStr.includes(termUpper) || nameStr.includes(termUpper) || categoryStr.includes(termUpper);
          });
          
          localMatch.forEach(item => {
            if (!seenEppIds.has(item.id)) {
              eppResults.push(item);
              seenEppIds.add(item.id);
            }
          });
        }

        nextEppCatalog = eppResults.slice(0, 100);
      } else {
        const q = query(collection(db, 'epp_catalog'), limit(showAllEpp ? 5000 : 100));
        // Force server fetch to see the truly cleared state
        const s = await withCatalogTimeout(getDocsFromServer(q));
        const fetched = s.docs.map(doc => ({ ...doc.data(), id: doc.id } as EPP));
        console.log(`Fetch Catálogo (Servidor): ${fetched.length} items encontrados.`);
        nextEppCatalog = fetched;
      }

      if (fetchSeq !== catalogFetchSeq.current) return;
      if (nextEmployees) setEmployees(nextEmployees);
      if (nextEppCatalog) setEppCatalog(nextEppCatalog);
    } catch (error) {
      if (fetchSeq !== catalogFetchSeq.current) return;
      console.error("Error fetching data:", error);
    } finally {
      if (fetchSeq === catalogFetchSeq.current) {
        setIsLoadingCatalog(false);
      }
    }
  };


  const clearSignature = () => {
    sigCanvas.current?.clear();
  };
  const selectedQuantityByEppId = React.useMemo(() => {
    const totals = new Map<string, number>();
    selectedEpps.forEach(epp => {
      totals.set(epp.id, (totals.get(epp.id) || 0) + (epp.quantity || 1));
    });
    return totals;
  }, [selectedEpps]);

  const getReservedQuantityForOtherSelections = (eppId: string, currentIndex?: number) => {
    return selectedEpps.reduce((total, epp, index) => {
      if (epp.id !== eppId || index === currentIndex) return total;
      return total + (epp.quantity || 1);
    }, 0);
  };

  const validateSelectedStock = () => {
    for (const epp of selectedEpps) {
      const totalRequested = selectedQuantityByEppId.get(epp.id) || 0;
      if (totalRequested > (epp.stock || 0)) {
        return `No hay stock suficiente para "${epp.name}". Stock: ${epp.stock || 0}, solicitado: ${totalRequested}.`;
      }
    }
    return '';
  };

  const handleSaveDelivery = async () => {
    if (!foundEmployee || selectedEpps.length === 0) {
      setErrorMessage('Por favor seleccione un colaborador y al menos un artículo');
      return;
    }

    const stockError = validateSelectedStock();
    if (stockError) {
      setErrorMessage(stockError);
      return;
    }

    if (sigCanvas.current?.isEmpty()) {
      setErrorMessage('Por favor firme la recepción');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    
    try {
      const canvas = sigCanvas.current?.getCanvas();
      if (!canvas) {
        throw new Error('No se pudo acceder al panel de firma');
      }
      const signatureData = canvas.toDataURL('image/png');

      // 1. Alerta por frecuencia de entrega
      const now = getNow();
      const sixMonthsAgo = getNow();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const fortyFiveDaysAgo = getNow();
      fortyFiveDaysAgo.setDate(fortyFiveDaysAgo.getDate() - 45);

      const qHistory = query(
        collection(db, 'deliveries'),
        where('employeeId', '==', foundEmployee.id),
        orderBy('date', 'desc'),
        limit(50)
      );
      
      let historySnapshot;
      try {
        historySnapshot = await getDocs(qHistory);
      } catch (queryErr) {
        console.error("Error querying history:", queryErr);
        // If index is missing or other error, we proceed but log it
        historySnapshot = { docs: [] } as any;
      }

      const deliveryHistory = (historySnapshot.docs || []).map(doc => {
        const data = doc.data() as Delivery;
        let dateObj: Date;
        if (data.date && typeof data.date.toDate === 'function') {
          dateObj = data.date.toDate();
        } else if (data.date instanceof Date) {
          dateObj = data.date;
        } else {
          dateObj = getNow();
        }
        return { ...data, date: dateObj } as Delivery;
      });

      const isDeliveringBoots = selectedEpps.some(epp => bootsRegex.test(epp.name));
      const isDeliveringGloves = selectedEpps.some(epp => glovesRegex.test(epp.name));
      const warnings: string[] = [];

      // Check 0: Same EPP repeat (Duplicate) - Even same day
      selectedEpps.forEach(epp => {
        const lastSameEpp = deliveryHistory.find(d => 
          d.items && d.items.some((item: any) => item.eppId === epp.id)
        );
        if (lastSameEpp) {
          const lastDate = lastSameEpp.date.getTime();
          const diffDays = Math.floor(Math.abs(now.getTime() - lastDate) / (1000 * 60 * 60 * 24));
          
          if (diffDays < 45) {
            const dateStr = lastSameEpp.date.toLocaleString();
            warnings.push(`⚠️ REPETICIÓN DE EQUIPO: El artículo "${epp.name}" ya fue entregado a este colaborador el ${dateStr} (${diffDays === 0 ? 'HOY MISMO' : `hace ${diffDays} días`}). El periodo mínimo es de 45 días.`);
          }
        }
      });

      // Check 1: Boots < 6 months
      if (isDeliveringBoots) {
        const lastBootsDelivery = deliveryHistory.find(d => 
          d.items && d.items.some((item: any) => bootsRegex.test(item.eppName))
        );
        
        if (lastBootsDelivery && lastBootsDelivery.date > sixMonthsAgo) {
          const diffTime = Math.abs(now.getTime() - lastBootsDelivery.date.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          const diffMonths = Math.floor(diffDays / 30);
          
          const timeMsg = diffDays === 0 ? 'HOY MISMO' : `hace solo ${diffMonths} meses y ${diffDays % 30} días`;
          warnings.push(`⚠️ ALERTA DE BOTAS: Este colaborador recibió botas ${timeMsg} (${lastBootsDelivery.date.toLocaleDateString()}). El periodo recomendado es de 6 meses.`);
        }
      }

      // Check 1.5: Gloves < 45 days
      if (isDeliveringGloves) {
        const lastGlovesDelivery = deliveryHistory.find(d => 
          d.items && d.items.some((item: any) => glovesRegex.test(item.eppName))
        );
        
        if (lastGlovesDelivery && lastGlovesDelivery.date > fortyFiveDaysAgo) {
          const diffTime = Math.abs(now.getTime() - lastGlovesDelivery.date.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          const timeMsg = diffDays === 0 ? 'HOY MISMO' : `hace solo ${diffDays} días`;
          warnings.push(`⚠️ ALERTA DE GUANTES: Este colaborador recibió guantes ${timeMsg} (${lastGlovesDelivery.date.toLocaleDateString()}). El periodo recomendado es de 45 días.`);
        }
      }

      // Check 2: Any EPP < 1.5 months (45 days) - Only if not already alerted by Check 0 or 1.5
      if (deliveryHistory.length > 0 && warnings.length === 0) {
        const lastDelivery = deliveryHistory[0];
        if (lastDelivery.date > fortyFiveDaysAgo) {
          const diffTime = Math.abs(now.getTime() - lastDelivery.date.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          warnings.push(`⚠️ ALERTA DE FRECUENCIA: Este colaborador recibió EPP hace muy poco (${diffDays === 0 ? 'HOY MISMO' : `${diffDays} días`}, el ${lastDelivery.date.toLocaleDateString()}). El periodo mínimo recomendado es de 1.5 meses (45 días).`);
        }
      }

      // Check 3: Stock warning
      const lowStockItems = selectedEpps.filter(epp => (epp.stock - (epp.quantity || 1)) <= 10);
      if (lowStockItems.length > 0) {
        lowStockItems.forEach(item => {
          const remaining = item.stock - (item.quantity || 1);
          warnings.push(`⚠️ ALERTA DE STOCK: El artículo "${item.name}" tiene poco stock (${remaining} unidades restantes).`);
        });
      }

      if (warnings.length > 0) {
        setDeliveryWarning({
          message: warnings.join('\n\n'),
          onConfirm: () => executeSaveDelivery(signatureData, warnings)
        });
        setIsSubmitting(false);
        return;
      }

      await executeSaveDelivery(signatureData);
    } catch (err) {
      console.error("Error in handleSaveDelivery:", err);
      setErrorMessage('Error al procesar la entrega: ' + (err instanceof Error ? err.message : String(err)));
      setIsSubmitting(false);
    }
  };

  const executeSaveDelivery = async (signatureData: string, warnings?: string[]) => {
    setIsSubmitting(true);
    setDeliveryWarning(null);
    setErrorMessage('');

    try {
      if (!foundEmployee) return;

      // 2. Alerta por stock bajo (quedan 10 o menos)
      const lowStockItems = selectedEpps.filter(epp => (epp.stock - (epp.quantity || 1)) <= 10);
      
      const deliveryData: Omit<Delivery, 'id'> = {
        employeeId: foundEmployee.id,
        employeeName: foundEmployee.fullName,
        items: selectedEpps.map(epp => ({
          eppId: epp.id,
          eppName: epp.name,
          eppSize: epp.size || extractSize(epp.name) || '',
          quantity: epp.quantity || 1
        })),
        type: deliveryType,
        date: MOCK_DATE_ENABLED ? getNow() : serverTimestamp(),
        signature: signatureData || ''
      };

      const deliveryId = `delivery-${Date.now()}-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
      const batch = writeBatch(db);
      batch.set(doc(db, 'deliveries', deliveryId), deliveryData);

      const stockUpdates = new Map<string, { name: string; quantity: number }>();
      selectedEpps.forEach(epp => {
        const current = stockUpdates.get(epp.id) || { name: epp.name, quantity: 0 };
        current.quantity += epp.quantity || 1;
        stockUpdates.set(epp.id, current);
      });

      stockUpdates.forEach((item, eppId) => {
        batch.update(doc(db, 'epp_catalog', eppId), {
          stock: increment(-item.quantity)
        });
      });

      await batch.commit();

      // Send notification to admin ONLY if there are alerts (warnings)
      if (warnings && warnings.length > 0) {
        // 1. Try email (if configured)
        sendAdminNotification(foundEmployee, deliveryData.items, warnings);
        // 2. Always log internally to SQLite
        saveAlertToDatabase(foundEmployee, deliveryData.items, warnings);
      }
      setDeliveries(prev => [{ ...deliveryData, id: deliveryId }, ...prev]);
      setFullEppCatalog(prev => prev.map(item => {
        const update = stockUpdates.get(item.id);
        return update ? { ...item, stock: Math.max(0, (item.stock || 0) - update.quantity) } : item;
      }));
      setEppCatalog(prev => prev.map(item => {
        const update = stockUpdates.get(item.id);
        return update ? { ...item, stock: Math.max(0, (item.stock || 0) - update.quantity) } : item;
      }));

      setSuccessMessage('Entrega registrada con éxito');
      setFoundEmployee(null);
      setSearchId('');
      setSelectedEpps([]);
      setSearchEppId('');
      setDeliveryType('nuevo');
      sigCanvas.current?.clear();
      
      // Switch to history tab to show the new record
      setTimeout(() => {
        setSuccessMessage('');
        setActiveTab('history');
      }, 1500);
    } catch (err) {
      handleDatabaseError(err, OperationType.CREATE, 'deliveries');
      setErrorMessage('Error al guardar la entrega. Por favor intente de nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper to seed data (for testing/initial setup)
  const seedInitialData = async () => {
    try {
      // Sample Employees
      const employees = [
        { id: '1001', fullName: 'Juan Pérez', department: 'Producción', position: 'Operador A' },
        { id: '1002', fullName: 'María García', department: 'Mantenimiento', position: 'Técnico Senior' },
        { id: '1003', fullName: 'Carlos Rodríguez', department: 'Logística', position: 'Almacenero' }
      ];
      for (const emp of employees) {
        await setDoc(doc(db, 'employees', emp.id), emp);
      }

      // Sample EPP
      const epps = [
        { id: 'EPP01', name: 'Casco de Seguridad', category: 'Protección Cabeza', size: 'M', stock: 50 },
        { id: 'EPP02', name: 'Lentes de Protección', category: 'Protección Visual', size: 'Única', stock: 100 },
        { id: 'EPP03', name: 'Guantes de Nitrilo', category: 'Protección Manos', size: 'L', stock: 200 },
        { id: 'EPP04', name: 'Botas Punta de Acero', category: 'Calzado', size: '42', stock: 30 }
      ];
      for (const epp of epps) {
        await setDoc(doc(db, 'epp_catalog', epp.id), epp);
      }

      // Authorized Users
      const admins = [
        { email: 'elniger26@gmail.com', role: 'admin', name: 'Admin Principal' },
        { email: 'wilsonmedinarosario1986@gmail.com', role: 'admin', name: 'Wilson Medina' },
        { email: 'wilson.medina@dpworld.com', role: 'admin', name: 'Wilson Medina DP' }
      ];
      for (const admin of admins) {
        const id = admin.email.toLowerCase();
        await setDoc(doc(db, 'authorized_users', id), admin);
      }

      alert('Datos de prueba y administradores cargados correctamente');
    } catch (err) {
      handleDatabaseError(err, OperationType.WRITE, 'seed_data');
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
    } catch (err: any) {
      console.error("Login error:", err);
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setAuthError('Correo o contraseña incorrectos');
      } else {
        setAuthError('Error al iniciar sesión. Intente de nuevo.');
      }
    }
  };

  const handleForgotPassword = async () => {
    if (!loginEmail) {
      setAuthError('Por favor, ingresa tu correo electrónico primero.');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, loginEmail);
      alert(`La cuenta ${loginEmail} existe. En SQLite local, un administrador debe asignar una nueva contraseña desde la gestión de usuarios.`);
    } catch (err: any) {
      console.error("Reset password error:", err);
      if (err.code === 'auth/user-not-found') {
        setAuthError('No se encontró una cuenta con este correo.');
      } else {
        setAuthError('Error al validar la cuenta local.');
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (user && !isAuthorized) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center"
        >
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-10 h-10 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Acceso No Autorizado</h1>
          <p className="text-slate-500 mb-8">Su correo ({user.email}) no tiene permisos para acceder a este sistema. Contacte al administrador.</p>
          <button 
            onClick={logout}
            className="w-full flex items-center justify-center gap-3 bg-slate-100 text-slate-700 font-semibold py-3 px-4 rounded-xl hover:bg-slate-200 transition-colors shadow-sm"
          >
            Cerrar Sesión
          </button>
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center"
        >
          <div className="flex justify-center mb-8">
            <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mx-auto">
              <ShieldCheck className="w-10 h-10 text-indigo-600" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Entrega de EPP</h1>
          <p className="text-slate-500 mb-8">Inicie sesión para gestionar la entrega de equipos de protección personal.</p>
          
          {!isEmailLogin ? (
            <div className="space-y-4">
              <button 
                onClick={loginAsLocalAdmin}
                className="w-full flex items-center justify-center gap-3 bg-white border border-slate-200 text-slate-700 font-semibold py-3 px-4 rounded-xl hover:bg-slate-50 transition-colors shadow-sm"
              >
                <Shield className="w-5 h-5 text-indigo-600" />
                Entrar como administrador local
              </button>
              <button 
                onClick={() => setIsEmailLogin(true)}
                className="w-full flex items-center justify-center gap-3 bg-slate-100 text-slate-700 font-semibold py-3 px-4 rounded-xl hover:bg-slate-200 transition-colors"
              >
                <Smartphone className="w-5 h-5" />
                Usar Correo y Contraseña
              </button>
            </div>
          ) : (
            <form onSubmit={handleEmailLogin} className="space-y-4 text-left">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Correo Electrónico</label>
                <input 
                  type="email" 
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  placeholder="ejemplo@correo.com"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Contraseña</label>
                <input 
                  type="password" 
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  placeholder="••••••••"
                />
                <div className="mt-2 text-right">
                  <button 
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-indigo-600 text-xs hover:underline font-medium"
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                </div>
              </div>
              
              {authError && (
                <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 p-3 rounded-lg">
                  <AlertCircle className="w-4 h-4" />
                  {authError}
                </div>
              )}

              <button 
                type="submit"
                className="w-full bg-indigo-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-indigo-700 transition-colors shadow-md"
              >
                Iniciar Sesión
              </button>
              
              <button 
                type="button"
                onClick={() => setIsEmailLogin(false)}
                className="w-full text-slate-400 text-sm hover:text-slate-600 transition-colors"
              >
                Volver a opciones de inicio
              </button>
            </form>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="bg-indigo-600 p-2 rounded-lg">
                <HardHat className="text-white w-5 h-5" />
              </div>
            </div>
            <h1 className="text-xl font-bold tracking-tight hidden sm:block">Entrega de EPP</h1>
          </div>
          
          <nav className="flex items-center gap-1 sm:gap-4">
            <button 
              onClick={() => setActiveTab('delivery')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'delivery' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Nueva Entrega</span>
            </button>
            <button 
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'history' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              <History className="w-4 h-4" />
              <span className="hidden sm:inline">Historial</span>
            </button>
            {isAdmin && (
              <button 
                onClick={() => setActiveTab('alerts')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'alerts' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                <Bell className="w-4 h-4" />
                <span className="hidden sm:inline">Alertas</span>
              </button>
            )}
            {isAdmin && (
              <button 
                onClick={() => setActiveTab('setup')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'setup' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline">Admin</span>
              </button>
            )}
            <div className="h-6 w-px bg-slate-200 mx-2 hidden sm:block"></div>
            <div className="hidden md:flex flex-col items-end mr-2">
              <span className="text-xs font-semibold text-slate-900 leading-none">{user?.displayName || 'Admin'}</span>
              <span className="text-[10px] text-slate-500 leading-none mt-1">{user?.email}</span>
            </div>
            <button 
              onClick={logout}
              className="p-2 text-slate-400 hover:text-red-600 transition-colors"
              title="Cerrar Sesión"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </nav>
        </div>
      </header>
      
      {MOCK_DATE_ENABLED && (
        <div className="bg-amber-500 text-white py-2 px-4 text-center text-xs font-bold flex items-center justify-center gap-2 shadow-inner">
          <AlertTriangle className="w-4 h-4" />
          MODO DE PRUEBA ACTIVO: Simulando fecha 15 de Octubre, 2026 (Para validar alertas de frecuencia)
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 sm:pb-8">
        {isDbEmpty && isAdmin && activeTab !== 'setup' && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3">
              <AlertCircle className="text-amber-600 w-6 h-6" />
              <div>
                <p className="text-amber-900 font-bold text-sm">Base de datos vacía</p>
                <p className="text-amber-700 text-xs">No se encontraron empleados ni equipos. Si acabas de configurar la app, ve a la pestaña Admin para cargar datos iniciales.</p>
              </div>
            </div>
            <button 
              onClick={() => setActiveTab('setup')}
              className="bg-amber-600 text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-amber-700 transition-colors whitespace-nowrap"
            >
              Ir a Configuración
            </button>
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          {activeTab === 'delivery' && (
            <motion.div 
              key="delivery"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-8"
            >
              {/* Search & Employee Info */}
              <div className="lg:col-span-1 space-y-6">
                {deferredPrompt && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-indigo-600 text-white rounded-2xl p-6 shadow-lg flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="bg-white/20 p-2 rounded-xl">
                        <Smartphone className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="font-bold text-sm">Instalar Aplicación</p>
                        <p className="text-[10px] opacity-80">Acceso rápido desde tu pantalla de inicio</p>
                      </div>
                    </div>
                    <button 
                      onClick={handleInstallClick}
                      className="bg-white text-indigo-600 text-xs font-bold px-4 py-2 rounded-lg shadow-sm hover:bg-indigo-50 transition-colors"
                    >
                      Instalar
                    </button>
                  </motion.div>
                )}

                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                  <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Search className="w-5 h-5 text-indigo-600" />
                    Buscar Empleado
                  </h2>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="ID o Nombre del Empleado"
                      value={searchId}
                      onChange={(e) => {
                        setSearchId(e.target.value);
                        setErrorMessage('');
                      }}
                      onKeyPress={(e) => e.key === 'Enter' && handleSearchEmployee()}
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                    />
                    <button 
                      onClick={handleSearchEmployee}
                      className="bg-indigo-600 text-white p-2 rounded-xl hover:bg-indigo-700 transition-colors"
                    >
                      <Search className="w-5 h-5" />
                    </button>
                  </div>

                  {employeeSearchResults.length > 0 && (
                    <div className="mt-4 space-y-2 max-h-40 overflow-y-auto border border-slate-100 rounded-xl p-2 bg-slate-50">
                      <p className="text-[10px] font-bold text-slate-400 uppercase px-2">Resultados encontrados:</p>
                      {employeeSearchResults.map(emp => (
                        <button
                          key={emp.id}
                          onClick={() => {
                            setFoundEmployee(emp);
                            setEmployeeSearchResults([]);
                            setSearchId(emp.id);
                          }}
                          className="w-full text-left p-2 hover:bg-white rounded-lg transition-colors text-sm flex justify-between items-center"
                        >
                          <span>{emp.fullName}</span>
                          <span className="text-xs text-slate-400 font-mono">{emp.id}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  
                  {errorMessage && (
                    <div className="mt-4 flex items-center gap-2 text-red-600 text-sm bg-red-50 p-3 rounded-lg">
                      <AlertCircle className="w-4 h-4" />
                      {errorMessage}
                    </div>
                  )}
                </div>

                {foundEmployee && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={`bg-white rounded-2xl shadow-sm border p-6 overflow-hidden relative transition-all duration-300 ${employeeAlerts ? 'border-amber-500 ring-4 ring-amber-50/50' : 'border-slate-200'}`}
                  >
                    <div className={`absolute top-0 right-0 w-24 h-24 rounded-bl-full -mr-8 -mt-8 opacity-50 ${employeeAlerts ? 'bg-amber-100' : 'bg-indigo-50'}`}></div>
                    
                    <div className="flex justify-between items-start mb-4">
                      <h2 className="text-lg font-semibold flex items-center gap-2">
                        <User className={`w-5 h-5 ${employeeAlerts ? 'text-amber-600' : 'text-indigo-600'}`} />
                        Datos del Empleado
                      </h2>
                      {employeeAlerts && (
                        <div className="bg-rose-600 text-white px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 shadow-lg shadow-rose-200 animate-bounce">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          ALERTA ACTIVA
                        </div>
                      )}
                    </div>

                    <div className="space-y-4 relative z-10">
                      <div>
                        <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Nombre Completo</p>
                        <p className="text-slate-900 font-semibold">{foundEmployee.fullName}</p>
                      </div>
                      <div className="grid grid-cols-1 gap-4">
                        <div>
                          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Posición</p>
                          <p className="text-slate-700 text-sm">{foundEmployee.department}</p>
                        </div>
                      </div>

                      {employeeAlerts && (
                        <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-xl space-y-2">
                          {employeeAlerts.boots && (
                            <div className="flex items-start gap-2 text-amber-800 text-xs">
                              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                              <p><strong>Botas:</strong> Recibidas el {employeeAlerts.boots.toLocaleDateString()} (Hace menos de 6 meses).</p>
                            </div>
                          )}
                          {employeeAlerts.general && (
                            <div className="flex items-start gap-2 text-amber-800 text-xs">
                              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                              <p><strong>Frecuencia:</strong> Última entrega el {employeeAlerts.general.toLocaleDateString()} (Hace menos de 45 días).</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </div>

              {/* Delivery Form */}
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                  <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-indigo-600" />
                    Detalles de la Entrega
                  </h2>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Código o Nombre de Equipo (EPP)</label>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          placeholder="Ingrese código o nombre"
                          value={searchEppId}
                          onChange={(e) => {
                            setSearchEppId(e.target.value);
                            setErrorMessage('');
                          }}
                          onKeyPress={(e) => e.key === 'Enter' && handleSearchEpp()}
                          className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                        <button 
                          onClick={handleSearchEpp}
                          className="bg-indigo-600 text-white p-2 rounded-xl hover:bg-indigo-700 transition-colors"
                        >
                          <Search className="w-5 h-5" />
                        </button>
                      </div>

                      {errorMessage && (
                        <div className="mt-4 flex items-center gap-2 text-red-600 text-sm bg-red-50 p-3 rounded-lg">
                          <AlertCircle className="w-4 h-4" />
                          {errorMessage}
                        </div>
                      )}

                      {eppSearchResults.length > 0 && (
                        <div className="mt-4 space-y-2 max-h-40 overflow-y-auto border border-slate-100 rounded-xl p-2 bg-slate-50">
                          <p className="text-[10px] font-bold text-slate-400 uppercase px-2">Equipos encontrados:</p>
                          {eppSearchResults.map(item => {
                            const isExactIdMatch = item.id.toUpperCase() === searchEppId.trim().toUpperCase();
                            const reserved = selectedQuantityByEppId.get(item.id) || 0;
                            const availableStock = Math.max(0, (item.stock || 0) - reserved);
                            return (
                              <button
                                key={item.id}
                                onClick={() => {
                                  if (availableStock <= 0) {
                                    setErrorMessage(`No hay stock disponible para: ${item.name}`);
                                    setTimeout(() => setErrorMessage(''), 3000);
                                    return;
                                  }
                                  const newItem = { 
                                    ...item, 
                                    quantity: 1, 
                                    size: extractSize(item.name) || item.size || '',
                                    selectionId: `${item.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` 
                                  };
                                  setSelectedEpps(prev => [...prev, newItem]);
                                  setEppSearchResults([]);
                                  setSearchEppId('');
                                }}
                                disabled={availableStock <= 0}
                                className={`w-full text-left p-3 rounded-xl transition-all border border-transparent flex justify-between items-center group ${
                                  availableStock <= 0 
                                    ? 'bg-slate-100 opacity-60 cursor-not-allowed' 
                                    : isExactIdMatch 
                                      ? 'bg-indigo-50 border-indigo-200' 
                                      : 'hover:bg-white hover:border-indigo-100 hover:shadow-sm'
                                }`}
                              >
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <p className={`font-bold ${availableStock <= 0 ? 'text-slate-400' : 'text-slate-800'}`}>{item.name}</p>
                                    {isExactIdMatch && (
                                      <span className="text-[9px] bg-indigo-600 text-white px-1.5 py-0.5 rounded font-bold uppercase">ID Exacto</span>
                                    )}
                                  {(extractSize(item.name) || item.size) && (
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                                      availableStock <= 0 ? 'bg-slate-200 text-slate-400' : 'bg-indigo-100 text-indigo-700'
                                    }`}>
                                      Talla: {extractSize(item.name) || item.size}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] text-slate-500 font-mono">Código: {item.id}</p>
                              </div>
                              <div className="text-right">
                                <p className={`text-xs font-bold ${availableStock <= 5 ? 'text-red-500' : 'text-slate-600'}`}>
                                  Disponible: {availableStock}
                                </p>
                                {reserved > 0 && <p className="text-[9px] text-slate-400">Reservado: {reserved}</p>}
                                <Plus className={`w-4 h-4 ml-auto transition-transform group-hover:scale-125 ${availableStock <= 0 ? 'text-slate-300' : 'text-indigo-600'}`} />
                              </div>
                            </button>
                          );
                        })}
                        </div>
                      )}

                      {selectedEpps.length > 0 && (
                        <div className="mt-4 space-y-2">
                          <p className="text-[10px] font-bold text-slate-400 uppercase px-2">Equipos Seleccionados:</p>
                          {selectedEpps.map((epp, index) => (
                            <div key={epp.selectionId || `epp-${index}`} className="flex items-center justify-between p-4 bg-white rounded-2xl border border-indigo-100 shadow-sm group hover:border-indigo-300 transition-all">
                              <div className="flex items-center gap-4">
                                <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                                  <Package className="w-5 h-5" />
                                </div>
                                <div>
                                  <div className="flex flex-col">
                                    <div className="flex items-center gap-2">
                                      <p className="text-slate-900 font-bold leading-tight">{epp.name}</p>
                                      <div className="flex items-center gap-1 shrink-0">
                                        <span className="text-[9px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase">
                                          Talla:
                                        </span>
                                        <input
                                          type="text"
                                          value={epp.size || ''}
                                          onChange={(e) => {
                                            const val = e.target.value.toUpperCase();
                                            setSelectedEpps(prev => prev.map((item, i) => 
                                              i === index ? { ...item, size: val } : item
                                            ));
                                          }}
                                          onFocus={(e) => e.target.select()}
                                          placeholder="-"
                                          className="w-14 text-[10px] font-bold bg-white border border-slate-200 text-slate-700 px-1 py-0.5 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 text-center"
                                        />
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 mt-1">
                                      <p className="text-slate-400 text-[9px] font-medium uppercase tracking-wider">{epp.category}</p>
                                      <span className="w-1 h-1 bg-slate-200 rounded-full"></span>
                                      <p className={`text-[9px] font-bold ${((epp.stock || 0) - getReservedQuantityForOtherSelections(epp.id, index)) <= 5 ? 'text-rose-600' : ((epp.stock || 0) - getReservedQuantityForOtherSelections(epp.id, index)) <= 10 ? 'text-amber-600' : 'text-indigo-600'}`}>
                                        Disponible: {Math.max(0, (epp.stock || 0) - getReservedQuantityForOtherSelections(epp.id, index))}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedEpps(prev => prev.map((e, i) => 
                                        i === index ? { ...e, quantity: Math.max(1, (e.quantity || 1) - 1) } : e
                                      ));
                                    }}
                                    className="p-1 hover:bg-white rounded-md transition-colors text-slate-500"
                                  >
                                    <Minus className="w-3 h-3" />
                                  </button>
                                  <span className="w-6 text-center text-xs font-bold text-slate-700">
                                    {epp.quantity || 1}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const maxForThisSelection = Math.max(1, (epp.stock || 0) - getReservedQuantityForOtherSelections(epp.id, index));
                                      if ((epp.quantity || 1) >= maxForThisSelection) {
                                        setErrorMessage(`No hay más stock disponible`);
                                        setTimeout(() => setErrorMessage(''), 3000);
                                        return;
                                      }
                                      setSelectedEpps(prev => prev.map((e, i) => 
                                        i === index ? { ...e, quantity: (e.quantity || 1) + 1 } : e
                                      ));
                                    }}
                                    className="p-1 hover:bg-white rounded-md transition-colors text-slate-500"
                                  >
                                    <Plus className="w-3 h-3" />
                                  </button>
                                </div>
                                <button 
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setSelectedEpps(prev => prev.filter((_, i) => i !== index));
                                  }}
                                  className="text-rose-500 hover:text-white p-2.5 hover:bg-rose-500 rounded-xl transition-all flex-shrink-0 border border-rose-100 hover:border-rose-600 shadow-sm active:scale-95"
                                  title="Eliminar"
                                >
                                  <Trash2 className="w-5 h-5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {searchEppId.trim() && eppSearchResults.length === 0 && selectedEpps.length === 0 && (
                        <p className="mt-2 text-xs text-slate-400 italic">Buscando equipo...</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Tipo de Entrega</label>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => setDeliveryType('nuevo')}
                          className={`flex-1 py-2 px-4 rounded-xl text-sm font-medium border transition-all ${deliveryType === 'nuevo' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                        >
                          Nuevo
                        </button>
                        <button 
                          onClick={() => setDeliveryType('reemplazo')}
                          className={`flex-1 py-2 px-4 rounded-xl text-sm font-medium border transition-all ${deliveryType === 'reemplazo' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                        >
                          Reemplazo
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mb-8">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                        <FileSignature className="w-4 h-4" />
                        Firma de Recepción
                      </label>
                      <button 
                        onClick={clearSignature}
                        className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        Limpiar
                      </button>
                    </div>
                    <div ref={sigContainerRef} className="border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50 overflow-hidden h-48">
                      <SignatureCanvas 
                        ref={sigCanvas}
                        canvasProps={{
                          className: "w-full h-full cursor-crosshair",
                          style: { touchAction: 'none' }
                        }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="text-sm text-slate-500">
                      Fecha: {getNow().toLocaleDateString()}
                    </div>
                    <button 
                      onClick={handleSaveDelivery}
                      disabled={isSubmitting || !foundEmployee || selectedEpps.length === 0}
                      className={`flex items-center gap-2 px-8 py-3 rounded-xl font-semibold transition-all shadow-md ${isSubmitting || !foundEmployee || selectedEpps.length === 0 ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95'}`}
                    >
                      {isSubmitting ? 'Guardando...' : 'Confirmar Entrega'}
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  {successMessage && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-6 flex items-center gap-2 text-emerald-600 text-sm bg-emerald-50 p-4 rounded-xl border border-emerald-100"
                    >
                      <CheckCircle2 className="w-5 h-5" />
                      {successMessage}
                    </motion.div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'alerts' && isAdmin && (
            <motion.div 
              key="alerts"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Bell className="w-5 h-5 text-amber-600" />
                    Log de Alertas del Sistema
                  </h2>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={exportAlertsExcel}
                      className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold hover:bg-emerald-100 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Exportar Excel
                    </button>
                    <span className="text-xs font-medium bg-amber-50 text-amber-600 px-3 py-1 rounded-full">
                      {systemAlerts.filter(a => a.status === 'pendiente').length} Pendientes
                    </span>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Fecha/Hora</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Empleado</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Alertas Detectadas</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Estado</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {systemAlerts.map((alert) => (
                        <tr key={alert.id} className={`hover:bg-slate-50 transition-colors ${alert.status === 'pendiente' ? 'bg-amber-50/30' : ''}`}>
                          <td className="px-6 py-4 text-sm text-slate-500">
                            {new Date(getDate(alert.date)).toLocaleString()}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="font-bold text-slate-900">{alert.employeeName}</span>
                              <span className="text-xs text-slate-400 font-mono">ID: {alert.employeeId}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="space-y-1">
                              {alert.warnings.map((w: string, i: number) => (
                                <div key={i} className="text-xs text-amber-700 flex items-start gap-1">
                                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                                  <span>{w}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full ${
                              alert.status === 'pendiente' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400'
                            }`}>
                              {alert.status}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              {alert.status === 'pendiente' && (
                                <button 
                                  onClick={async () => {
                                    try {
                                      await updateDoc(doc(db, 'alerts', alert.id), { status: 'revisado' });
                                    } catch (err) {
                                      console.error("Error updating alert status:", err);
                                    }
                                  }}
                                  className="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition-colors"
                                  title="Marcar como revisado"
                                >
                                  <CheckCircle2 className="w-4 h-4" />
                                </button>
                              )}
                              <a 
                                href={`mailto:w.medinaconsorcio@gmail.com?subject=ALERTA EPP: ${alert.employeeName}&body=Empleado: ${alert.employeeName} (ID: ${alert.employeeId})%0D%0AFecha: ${new Date(getDate(alert.date)).toLocaleString()}%0D%0A%0D%0AAlertas:%0D%0A${alert.warnings.join('%0D%0A')}`}
                                className="p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors"
                                title="Enviar por correo manualmente"
                              >
                                <Mail className="w-4 h-4" />
                              </a>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {systemAlerts.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                            No hay alertas registradas en el sistema.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'history' && (
            <motion.div 
              key="history"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <History className="w-5 h-5 text-indigo-600" />
                    Histórico de Entregas
                  </h2>
                  <span className="text-xs font-medium bg-slate-100 text-slate-500 px-2 py-1 rounded-full">
                    {filteredDeliveries.length} registros
                  </span>
                </div>
                
                <div className="flex items-center gap-2">
                  <input
                    ref={historyImportInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={handleImportHistoryExcel}
                  />
                  <div className="relative flex-1 md:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text"
                      placeholder="Buscar en historial..."
                      value={historySearchTerm}
                      onChange={(e) => setHistorySearchTerm(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                    />
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => historyImportInputRef.current?.click()}
                      disabled={isSubmitting}
                      className="flex items-center gap-2 bg-indigo-50 text-indigo-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-indigo-100 transition-all shadow-sm border border-indigo-100 disabled:opacity-50"
                    >
                      <Upload className="w-4 h-4" />
                      Importar Excel
                    </button>
                  )}
                  <button 
                    onClick={exportDeliveriesExcel}
                    className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-emerald-700 transition-all shadow-sm"
                  >
                    <Download className="w-4 h-4" />
                    Exportar Excel
                  </button>
                  {isAdmin && (
                    <button 
                      onClick={() => setIsClearingHistory(true)}
                      className="flex items-center gap-2 bg-rose-50 text-rose-600 px-4 py-2 rounded-xl text-sm font-medium hover:bg-rose-100 transition-all shadow-sm border border-rose-100"
                    >
                      <Trash2 className="w-4 h-4" />
                      Vaciar Historial
                    </button>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50 text-slate-400 text-xs uppercase tracking-wider">
                      <th className="px-6 py-4 font-medium">Fecha</th>
                      <th className="px-6 py-4 font-medium">Hora</th>
                      <th className="px-6 py-4 font-medium">Empleado</th>
                      <th className="px-6 py-4 font-medium">Alerta (Actual vs Anterior)</th>
                      <th className="px-6 py-4 font-medium">Equipo</th>
                      <th className="px-6 py-4 font-medium">Talla</th>
                      <th className="px-6 py-4 font-medium text-center">Cant.</th>
                      <th className="px-6 py-4 font-medium">Tipo</th>
                      <th className="px-6 py-4 font-medium">Firma</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredDeliveries.map((delivery) => (
                      <tr key={delivery.flattenedId} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 text-sm text-slate-500">
                          {delivery.date?.toDate ? delivery.date.toDate().toLocaleDateString() : 'Reciente'}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-500">
                          {delivery.date?.toDate ? delivery.date.toDate().toLocaleTimeString() : '-'}
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm font-semibold text-slate-900">{delivery.employeeName}</div>
                          <div className="text-xs text-slate-400">ID: {delivery.employeeId}</div>
                        </td>
                        <td className="px-6 py-4">
                          {delivery.alerts ? (
                            <div className="flex flex-col gap-2">
                              {delivery.alerts.duplicate && delivery.alerts.duplicate.name === delivery.flattenedItem.eppName && (
                                <div className="flex flex-col border-l-2 border-indigo-200 pl-2">
                                  <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-black flex items-center gap-1 w-fit">
                                    <AlertCircle className="w-3 h-3" />
                                    REPETIDO: {delivery.alerts.duplicate.name}
                                  </span>
                                  <div className="flex flex-col text-[9px] mt-0.5">
                                    <span className="text-indigo-600 font-bold">Actual: {new Date(getDate(delivery.date)).toLocaleDateString()}</span>
                                    <span className="text-slate-400">Anterior: {delivery.alerts.duplicate.date.toLocaleDateString()}</span>
                                  </div>
                                </div>
                              )}
                              {delivery.alerts.boots && bootsRegex.test(delivery.flattenedItem.eppName) && (
                                <div className="flex flex-col border-l-2 border-rose-200 pl-2">
                                  <span className="text-[10px] bg-rose-50 text-rose-700 px-2 py-0.5 rounded font-black flex items-center gap-1 w-fit">
                                    <AlertCircle className="w-3 h-3" />
                                    BOTAS
                                  </span>
                                  <div className="flex flex-col text-[9px] mt-0.5">
                                    <span className="text-rose-600 font-bold">Actual: {new Date(getDate(delivery.date)).toLocaleDateString()}</span>
                                    <span className="text-slate-400">Anterior: {(() => {
                                      const d = delivery.alerts.boots;
                                      if (d instanceof Date) return d.toLocaleDateString();
                                      if (d && typeof d.toDate === 'function') return d.toDate().toLocaleDateString();
                                      return '';
                                    })()}</span>
                                  </div>
                                </div>
                              )}
                              {delivery.alerts.gloves && glovesRegex.test(delivery.flattenedItem.eppName) && (
                                <div className="flex flex-col border-l-2 border-indigo-200 pl-2">
                                  <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-black flex items-center gap-1 w-fit">
                                    <AlertCircle className="w-3 h-3" />
                                    GUANTES
                                  </span>
                                  <div className="flex flex-col text-[9px] mt-0.5">
                                    <span className="text-indigo-600 font-bold">Actual: {new Date(getDate(delivery.date)).toLocaleDateString()}</span>
                                    <span className="text-slate-400">Anterior: {(() => {
                                      const d = delivery.alerts.gloves;
                                      if (d instanceof Date) return d.toLocaleDateString();
                                      if (d && typeof d.toDate === 'function') return d.toDate().toLocaleDateString();
                                      return '';
                                    })()}</span>
                                  </div>
                                </div>
                              )}
                              {delivery.alerts.general && (
                                <div className="flex flex-col border-l-2 border-amber-200 pl-2">
                                  <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded font-black flex items-center gap-1 w-fit">
                                    <AlertCircle className="w-3 h-3" />
                                    FRECUENCIA
                                  </span>
                                  <div className="flex flex-col text-[9px] mt-0.5">
                                    <span className="text-amber-600 font-bold">Actual: {new Date(getDate(delivery.date)).toLocaleDateString()}</span>
                                    <span className="text-slate-400">Anterior: {(() => {
                                      const d = delivery.alerts.general;
                                      if (d instanceof Date) return d.toLocaleDateString();
                                      if (d && typeof d.toDate === 'function') return d.toDate().toLocaleDateString();
                                      return '';
                                    })()}</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-300">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700 font-medium">
                          {delivery.flattenedItem.eppName}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-500">
                          {delivery.flattenedItem.eppSize || extractSize(delivery.flattenedItem.eppName) || '-'}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-500 text-center font-bold text-indigo-600">
                          {delivery.flattenedItem.quantity || 1}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${delivery.type === 'nuevo' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
                            {delivery.type.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <img src={delivery.signature} alt="Firma" className="h-8 object-contain opacity-70 hover:opacity-100 transition-opacity" />
                        </td>
                      </tr>
                    ))}
                    {filteredDeliveries.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-6 py-12 text-center text-slate-400">
                          No se han registrado entregas aún.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {activeTab === 'setup' && (
            <motion.div 
              key="setup"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-4xl mx-auto space-y-8"
            >
              {/* Data Seeding Card */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
                <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Package className="w-8 h-8 text-indigo-600" />
                </div>
                <h2 className="text-xl font-bold mb-2">Configuración Inicial</h2>
                <p className="text-slate-500 mb-6">
                  Cargue datos de ejemplo para probar el sistema rápidamente.
                </p>
                <button 
                  onClick={seedInitialData}
                  className="bg-indigo-600 text-white font-semibold py-2 px-6 rounded-xl hover:bg-indigo-700 transition-all shadow-md active:scale-95"
                >
                  Cargar Datos de Prueba
                </button>
              </div>

              {/* Bulk Import Section */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <Plus className="w-6 h-6 text-indigo-600" />
                  Importación Masiva (Copiar y Pegar desde Excel)
                </h2>
                <p className="text-slate-500 text-sm mb-6">
                  Copie sus datos de Excel y péguelos aquí. El sistema intentará identificar las columnas automáticamente.
                </p>

                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">Pegar Datos de Empleados</label>
                    <textarea 
                      placeholder="ID	Nombre	Posición"
                      className="w-full h-32 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                      id="bulk-employees"
                    ></textarea>
                    <button 
                      onClick={async () => {
                        const textarea = document.getElementById('bulk-employees') as HTMLTextAreaElement;
                        const text = textarea.value.trim();
                        if (!text) {
                          alert('Por favor, pegue algunos datos primero.');
                          return;
                        }

                        const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
                        let count = 0;
                        let errors = 0;
                        
                        // Use batches for efficiency (max 500 per batch)
                        const chunks = [];
                        for (let i = 0; i < lines.length; i += 400) {
                          chunks.push(lines.slice(i, i + 400));
                        }

                        for (const chunk of chunks) {
                          const batch = writeBatch(db);
                          let batchCount = 0;

                          for (const line of chunk) {
                            let parts: string[] = [];
                            if (line.includes('\t')) {
                              parts = line.split('\t');
                            } else if (line.includes(';')) {
                              parts = line.split(';');
                            } else if (line.includes('|')) {
                              parts = line.split('|');
                            } else if (line.includes(',') && line.split(',').length >= 2) {
                              parts = line.split(',');
                            } else if (line.split(/\s{2,}/).length >= 2) {
                              parts = line.split(/\s{2,}/);
                            } else {
                              // Fallback: split by first space if only 1 part found
                              const firstSpace = line.trim().indexOf(' ');
                              if (firstSpace > 0) {
                                parts = [line.trim().substring(0, firstSpace), line.trim().substring(firstSpace + 1)];
                              }
                            }
                            
                            const cleanParts = parts.map(p => p.trim());
                            if (
                              cleanParts[0]?.toLowerCase() === 'id' || 
                              cleanParts[0]?.toLowerCase() === 'item' ||
                              cleanParts[1]?.toLowerCase() === 'nombre' ||
                              cleanParts[1]?.toLowerCase() === 'description'
                            ) continue;

                            if (cleanParts.length >= 2) {
                              const id = cleanParts[0];
                              const fullName = cleanParts[1];
                              const dept = cleanParts[2];
                              const pos = cleanParts[3];

                              if (id && fullName) {
                                const employeeData: any = {
                                  id,
                                  fullName,
                                  updatedAt: serverTimestamp()
                                };
                                
                                if (dept) employeeData.department = dept;
                                if (pos) employeeData.position = pos;
                                else if (!dept) employeeData.position = 'Operador'; // Default if nothing provided

                                batch.set(doc(db, 'employees', id), employeeData, { merge: true });
                                batchCount++;
                              }
                            }
                          }

                          if (batchCount > 0) {
                            try {
                              await batch.commit();
                              count += batchCount;
                            } catch (err) {
                              console.error('Error committing batch:', err);
                              errors += batchCount;
                            }
                          }
                        }

                        if (count > 0) {
                          alert(`Éxito: Se han importado ${count} empleados.${errors > 0 ? ` (${errors} errores)` : ''}`);
                          textarea.value = '';
                          fetchCatalogData(); // Refresh view
                        } else {
                          alert('No se detectaron datos válidos.');
                        }
                      }}
                      className="mt-2 bg-slate-800 text-white text-sm font-medium py-2 px-4 rounded-lg hover:bg-slate-900 transition-colors"
                    >
                      Importar Empleados
                    </button>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">Pegar Catálogo de EPP</label>
                    <textarea 
                      placeholder="Ej: CAU-15-MI-000044	GUANTES SAMURAI...	GUANTE	100	M"
                      className="w-full h-32 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                      id="bulk-epp"
                    ></textarea>
                    <button 
                      onClick={async () => {
                        const textarea = document.getElementById('bulk-epp') as HTMLTextAreaElement;
                        const text = textarea.value.trim();
                        if (!text) {
                          alert('Por favor, pegue algunos datos primero.');
                          return;
                        }

                        const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
                        let count = 0;
                        let errors = 0;

                        const chunks = [];
                        for (let i = 0; i < lines.length; i += 400) {
                          chunks.push(lines.slice(i, i + 400));
                        }

                        for (const chunk of chunks) {
                          const batch = writeBatch(db);
                          let batchCount = 0;

                          for (const line of chunk) {
                            let parts: string[] = [];
                            if (line.includes('\t')) {
                              parts = line.split('\t');
                            } else if (line.includes(';')) {
                              parts = line.split(';');
                            } else if (line.includes('|')) {
                              parts = line.split('|');
                            } else if (line.includes(',') && line.split(',').length >= 2) {
                              parts = line.split(',');
                            } else if (line.split(/\s{2,}/).length >= 2) {
                              parts = line.split(/\s{2,}/);
                            } else {
                              // Fallback: split by first space if only 1 part found
                              const firstSpace = line.trim().indexOf(' ');
                              if (firstSpace > 0) {
                                parts = [line.trim().substring(0, firstSpace), line.trim().substring(firstSpace + 1)];
                              }
                            }
                            
                            const cleanParts = parts.map(p => p.trim());
                            const headerMatch = (
                              cleanParts[0]?.toLowerCase() === 'id' || 
                              cleanParts[0]?.toLowerCase() === 'item' || 
                              cleanParts[1]?.toLowerCase() === 'nombre' ||
                              cleanParts[1]?.toLowerCase() === 'description' ||
                              cleanParts[3]?.toLowerCase().startsWith('cantid')
                            );
                            if (headerMatch) continue;

                            if (cleanParts.length >= 2) {
                              const id = cleanParts[0].toUpperCase();
                              const name = cleanParts[1];
                              
                              if (id && name) {
                                const eppData: any = {
                                  id,
                                  name,
                                  updatedAt: serverTimestamp()
                                };

                                if (cleanParts[2]) eppData.category = cleanParts[2];
                                
                                const stockFromParts = cleanParts[3];
                                if (stockFromParts !== undefined && stockFromParts !== '') {
                                  const sVal = parseInt(stockFromParts);
                                  if (!isNaN(sVal)) eppData.stock = sVal;
                                }

                                const sizeFromParts = cleanParts[4] || '0';
                                eppData.size = sizeFromParts;
                                
                                batch.set(doc(db, 'epp_catalog', id), eppData, { merge: true });
                                batchCount++;
                              }
                            }
                          }

                          if (batchCount > 0) {
                            try {
                              await batch.commit();
                              count += batchCount;
                            } catch (err) {
                              console.error('Error committing batch:', err);
                              errors += batchCount;
                            }
                          }
                        }

                        if (count > 0) {
                          alert(`Éxito: Se han importado ${count} equipos.${errors > 0 ? ` (${errors} errores)` : ''}`);
                          textarea.value = '';
                          setFullEppCatalog([]); // Reset fuzzy index
                          fetchCatalogData(); // Refresh view
                        } else {
                          alert('No se detectaron datos válidos.');
                        }
                      }}
                      className="mt-2 bg-slate-800 text-white text-sm font-medium py-2 px-4 rounded-lg hover:bg-slate-900 transition-colors"
                    >
                      Importar EPP
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-6">
                <h3 className="text-amber-800 font-semibold mb-2 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  Instrucciones de Pegado
                </h3>
                <ul className="text-amber-700 text-sm list-disc list-inside space-y-1">
                  <li>En Excel, seleccione sus datos (incluyendo o no encabezados).</li>
                  <li>Presione Ctrl+C (Copiar).</li>
                  <li>Haga clic en el cuadro de texto arriba y presione Ctrl+V (Pegar).</li>
                  <li>Asegúrese de que el orden sea: <b>ID | Nombre | Departamento | Posición</b> para empleados.</li>
                  <li>Para EPP el orden debe ser: <b>Item (Ej: CAU-15-MI-000044) | Description | Categoria | CANTID. | Talla</b>.</li>
                </ul>
              </div>

              <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                      <User className="w-5 h-5 text-indigo-600" />
                      Empleados Registrados
                    </h3>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setIsAddingEmployee(true)}
                        className="p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                        title="Agregar Empleado"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                      {!showAllEmployees && !catalogSearchTerm && (
                        <button 
                          onClick={() => setShowAllEmployees(true)}
                          className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-1 rounded hover:bg-indigo-100 transition-colors"
                        >
                          Cargar todos
                        </button>
                      )}
                      <input 
                        type="text" 
                        placeholder="Buscar por ID o Nombre..."
                        value={catalogSearchTerm}
                        onChange={(e) => setCatalogSearchTerm(e.target.value)}
                        className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1 outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr>
                          <th className="p-2 font-semibold">ID</th>
                          <th className="p-2 font-semibold">Nombre</th>
                          <th className="p-2 font-semibold">Posición</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {employees.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="p-4 text-center text-slate-400">No hay empleados (use el filtro para buscar)</td>
                          </tr>
                        ) : (
                          employees.map(emp => (
                            <tr key={emp.id}>
                              <td className="p-2 font-mono text-xs">{emp.id}</td>
                              <td className="p-2">{emp.fullName}</td>
                              <td className="p-2 text-slate-500">{emp.department}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  {!showAllEmployees && employees.length === 50 && !catalogSearchTerm && (
                    <p className="mt-2 text-[10px] text-slate-400 text-center italic">Mostrando solo 50 resultados. Use el buscador o haga clic en "Cargar todos".</p>
                  )}
                </div>

                {/* New Employee Modal */}
                <AnimatePresence>
                  {isAddingEmployee && (
                    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full"
                      >
                        <h3 className="text-xl font-bold mb-6">Agregar Nuevo Empleado</h3>
                        
                        <div className="space-y-4 mb-8">
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">ID / Nómina</label>
                            <input 
                              type="text" 
                              value={newEmployee.id}
                              onChange={(e) => setNewEmployee({...newEmployee, id: e.target.value})}
                              placeholder="Ej: 000030"
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Nombre Completo</label>
                            <input 
                              type="text" 
                              value={newEmployee.fullName}
                              onChange={(e) => setNewEmployee({...newEmployee, fullName: e.target.value})}
                              placeholder="Nombre del empleado"
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            />
                          </div>
                          <div className="grid grid-cols-1 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">Posición</label>
                              <input 
                                type="text" 
                                value={newEmployee.department}
                                onChange={(e) => setNewEmployee({...newEmployee, department: e.target.value})}
                                placeholder="Puesto / Posición"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="flex gap-3">
                          <button 
                            onClick={() => {
                              setIsAddingEmployee(false);
                              setNewEmployee({ id: '', fullName: '', department: '', position: '' });
                            }}
                            className="flex-1 py-3 px-4 rounded-xl text-slate-600 font-medium hover:bg-slate-50 transition-colors"
                          >
                            Cancelar
                          </button>
                          <button 
                            onClick={async () => {
                              if (!newEmployee.id || !newEmployee.fullName) {
                                alert('ID y Nombre son obligatorios');
                                return;
                              }
                              try {
                                // Check if ID already exists
                                const existingDoc = await getDocs(query(collection(db, 'employees'), where('id', '==', newEmployee.id)));
                                if (!existingDoc.empty) {
                                  alert('Este ID de empleado ya existe');
                                  return;
                                }
                                await setDoc(doc(db, 'employees', newEmployee.id), newEmployee);
                                setIsAddingEmployee(false);
                                setNewEmployee({ id: '', fullName: '', department: '', position: '' });
                                fetchCatalogData();
                              } catch (err) {
                                console.error("Error adding employee:", err);
                              }
                            }}
                            className="flex-1 bg-indigo-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-indigo-700 transition-colors"
                          >
                            Guardar
                          </button>
                        </div>
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>

                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                      <HardHat className="w-5 h-5 text-indigo-600" />
                      Catálogo de EPP
                    </h3>
                    <div className="flex items-center gap-2">
                       <button 
                         onClick={exportCatalogExcel}
                         className="p-1.5 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 transition-colors"
                         title="Exportar a Excel"
                       >
                         <Download className="w-4 h-4" />
                       </button>
                       <button 
                         onClick={() => fetchCatalogData()}
                         className="p-1.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
                         title="Refrescar datos"
                       >
                         <History className="w-4 h-4" />
                       </button>
                      <button 
                        onClick={() => setIsAddingEpp(true)}
                        className="p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                        title="Agregar EPP"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                      {!showAllEpp && !eppSearchTerm && (
                        <button 
                          onClick={() => setShowAllEpp(true)}
                          className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-1 rounded hover:bg-indigo-100 transition-colors"
                        >
                          Cargar todos
                        </button>
                      )}
                      <input 
                        type="text" 
                        placeholder="Buscar por ID o Nombre..."
                        value={eppSearchTerm}
                        onChange={(e) => setEppSearchTerm(e.target.value)}
                        className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1 outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                  {isLoadingCatalog && eppCatalog.length > 0 && (
                    <p className="mb-2 text-[10px] text-indigo-500">Actualizando catalogo...</p>
                  )}
                  <div className="max-h-96 overflow-y-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr>
                          <th className="p-2 font-semibold">Código del Item</th>
                          <th className="p-2 font-semibold">Nombre</th>
                          <th className="p-2 font-semibold">Categoría</th>
                          <th className="p-2 font-semibold">Stock unidades</th>
                          <th className="p-2 font-semibold">Talla</th>
                          <th className="p-2 font-semibold text-right">Acción</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {isLoadingCatalog && eppCatalog.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="p-8 text-center text-slate-400">
                              <div className="flex flex-col items-center gap-2">
                                <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                                <p className="text-xs">Sincronizando...</p>
                              </div>
                            </td>
                          </tr>
                        ) : eppCatalog.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="p-8 text-center text-slate-400 italic">El catálogo está vacío. pulse "Refrescar" si persiste.</td>
                          </tr>
                        ) : (
                          eppCatalog.map(item => (
                            <tr key={item.id} className="hover:bg-slate-50 transition-colors border-b border-slate-50/50">
                              <td className="p-3 font-mono text-xs whitespace-nowrap uppercase font-bold text-slate-700 bg-slate-50/30 border-r border-slate-100">{item.id}</td>
                              <td className="p-3 min-w-[200px] max-w-[300px] leading-snug font-medium text-slate-800">{item.name}</td>
                              <td className="p-3 text-slate-500 text-xs">{item.category}</td>
                              <td className="p-3">
                                <input 
                                  type="number"
                                  defaultValue={item.stock || 0}
                                  onBlur={async (e) => {
                                    const newVal = parseInt(e.target.value);
                                    const validVal = isNaN(newVal) ? 0 : newVal;
                                    if (validVal !== (item.stock || 0)) {
                                      try {
                                        await updateDoc(doc(db, 'epp_catalog', item.id), { stock: validVal });
                                      } catch (err) {
                                        console.error("Error updating stock:", err);
                                      }
                                    }
                                  }}
                                  className={`w-14 bg-white border border-slate-200 rounded-lg px-2 py-1 text-[10px] focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-semibold ${item.stock <= 5 ? 'text-red-500' : 'text-slate-600'}`}
                                />
                              </td>
                              <td className="p-3">
                                <input 
                                  type="text"
                                  defaultValue={item.size || '0'}
                                  onBlur={async (e) => {
                                    const newVal = e.target.value.trim() || '0';
                                    if (newVal !== (item.size || '0')) {
                                      try {
                                        await updateDoc(doc(db, 'epp_catalog', item.id), { size: newVal });
                                      } catch (err) {
                                        console.error("Error updating size:", err);
                                      }
                                    }
                                  }}
                                  className="w-14 bg-white border border-slate-200 rounded-lg px-2 py-1 text-[10px] focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                />
                              </td>
                              <td className="p-3 text-right">
                                <div className="flex justify-end gap-1">
                                  <button 
                                    onClick={() => {
                                      setEditingEpp(item);
                                      setNewStockValue(item.stock || 0);
                                      itemToEditRef.current = item;
                                    }}
                                    className="text-indigo-600 hover:bg-indigo-50 p-1.5 rounded-lg transition-colors"
                                    title="Editar EPP"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button 
                                    onClick={async () => {
                                      if (confirm('¿Eliminar este equipo del catálogo?')) {
                                        try {
                                          await deleteDoc(doc(db, 'epp_catalog', item.id));
                                          setFullEppCatalog([]); // Reset fuzzy index
                                          fetchCatalogData();
                                        } catch (err) {
                                          console.error(err);
                                        }
                                      }
                                    }}
                                    className="text-rose-400 hover:text-rose-600 hover:bg-rose-50 p-1.5 rounded-lg transition-colors"
                                    title="Eliminar"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  {!showAllEpp && eppCatalog.length === 50 && !eppSearchTerm && (
                    <p className="mt-2 text-[10px] text-slate-400 text-center italic">Mostrando solo 50 resultados. Use el buscador o haga clic en "Cargar todos".</p>
                  )}
                </div>

                {/* New EPP Modal */}
                <AnimatePresence>
                  {isAddingEpp && (
                    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full"
                      >
                        <h3 className="text-xl font-bold mb-6">Agregar Nuevo EPP</h3>
                        
                        <div className="space-y-4 mb-8">
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">ID / Código (Original de Excel)</label>
                            <input 
                              type="text" 
                              value={newEpp.id}
                              onChange={(e) => {
                                setNewEpp({...newEpp, id: e.target.value});
                              }}
                              placeholder="Ej: CAU-15-MI-000044"
                              className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Nombre del Equipo</label>
                            <input 
                              type="text" 
                              value={newEpp.name}
                              onChange={(e) => setNewEpp({...newEpp, name: e.target.value})}
                              placeholder="Nombre del EPP"
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            />
                          </div>
                          <div className="grid grid-cols-3 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">Categoría</label>
                              <input 
                                type="text" 
                                value={newEpp.category}
                                onChange={(e) => setNewEpp({...newEpp, category: e.target.value})}
                                placeholder="Ej: Protección"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">Talla</label>
                              <input 
                                type="text" 
                                value={newEpp.size}
                                onChange={(e) => setNewEpp({...newEpp, size: e.target.value})}
                                placeholder="Ej: L, 42, etc"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">Stock</label>
                              <input 
                                type="number" 
                                value={newEpp.stock}
                                onChange={(e) => setNewEpp({...newEpp, stock: parseInt(e.target.value) || 0})}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="flex gap-3">
                          <button 
                            onClick={() => {
                              setIsAddingEpp(false);
                              setNewEpp({ id: '', name: '', category: '', size: '', stock: 0 });
                            }}
                            className="flex-1 py-3 px-4 rounded-xl text-slate-600 font-medium hover:bg-slate-50 transition-colors"
                          >
                            Cancelar
                          </button>
                          <button 
                            onClick={async () => {
                              const cleanId = newEpp.id.trim().toUpperCase();
                              const cleanName = newEpp.name.trim();
                              const cleanCategory = newEpp.category.trim() || 'Sin categoría';
                              const cleanSize = newEpp.size.trim().toUpperCase() || extractSize(cleanName) || '0';
                              const cleanStock = Math.max(0, Number(newEpp.stock) || 0);

                              if (!cleanId || !cleanName) {
                                alert('ID y Nombre son obligatorios');
                                return;
                              }
                              try {
                                const existingDoc = await getDocFromServer(doc(db, 'epp_catalog', cleanId));
                                if (existingDoc.exists()) {
                                  alert('Este ID de equipo ya existe');
                                  return;
                                }

                                const eppToSave: EPP = {
                                  id: cleanId,
                                  name: cleanName,
                                  category: cleanCategory,
                                  size: cleanSize,
                                  stock: cleanStock
                                };

                                await setDoc(doc(db, 'epp_catalog', cleanId), eppToSave);
                                setIsAddingEpp(false);
                                setNewEpp({ id: '', name: '', category: '', size: '', stock: 0 });
                                setFullEppCatalog([]); // Reset fuzzy index
                                setEppCatalog(prev => {
                                  const withoutDuplicate = prev.filter(item => item.id !== cleanId);
                                  return [eppToSave, ...withoutDuplicate];
                                });
                                fetchCatalogData();
                              } catch (err) {
                                console.error("Error adding EPP:", err);
                                const message = err instanceof Error ? err.message : String(err);
                                setErrorMessage(`Error al agregar EPP: ${message}`);
                                alert(`Error al agregar EPP: ${message}`);
                              }
                            }}
                            className="flex-1 bg-indigo-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-indigo-700 transition-colors"
                          >
                            Guardar
                          </button>
                        </div>
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>

                {/* Stock Edit Modal */}
                <AnimatePresence>
                  {editingEpp && (
                    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="bg-white rounded-3xl shadow-2xl p-8 max-w-sm w-full"
                      >
                         <h3 className="text-xl font-bold mb-2">Editar EPP</h3>
                         <p className="text-slate-500 text-sm mb-6">{editingEpp.name}</p>
                         
                         <div className="space-y-4 mb-6">
                           <div>
                             <label className="block text-sm font-medium text-slate-700 mb-2">Código Item (ID)</label>
                             <input 
                               type="text" 
                               value={editingEpp.id}
                               onChange={(e) => {
                                 const nextId = e.target.value.trim().toUpperCase();
                                 setEditingEpp(prev => prev ? {...prev, id: nextId} : null);
                               }}
                               placeholder="Ej: CAU-15-MI-000044"
                               className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                             />
                           </div>
                           <div>
                             <label className="block text-sm font-medium text-slate-700 mb-2">Categoría</label>
                             <input 
                               type="text" 
                               value={editingEpp.category || ''}
                               onChange={(e) => setEditingEpp({...editingEpp, category: e.target.value})}
                               placeholder="Ej: Protección Visual"
                               className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                             />
                           </div>
                           <div>
                             <label className="block text-sm font-medium text-slate-700 mb-2">Cantidad en Stock</label>
                             <input 
                               type="number" 
                               value={newStockValue}
                               onChange={(e) => setNewStockValue(parseInt(e.target.value) || 0)}
                               className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-lg font-semibold"
                             />
                           </div>
                           <div>
                             <label className="block text-sm font-medium text-slate-700 mb-2">Talla</label>
                             <input 
                               type="text" 
                               value={editingEpp.size || extractSize(editingEpp.name) || ''}
                               onChange={(e) => setEditingEpp({...editingEpp, size: e.target.value.toUpperCase()})}
                               placeholder="Ej: L, 42, etc"
                               className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                             />
                           </div>
                         </div>

                         <div className="flex gap-3">
                           <button 
                             onClick={() => setEditingEpp(null)}
                             className="flex-1 py-3 px-4 rounded-xl text-slate-600 font-medium hover:bg-slate-50 transition-colors"
                           >
                             Cancelar
                           </button>
                           <button 
                             onClick={async () => {
                               try {
                                 const originalId = itemToEditRef.current?.id;
                                 const newId = editingEpp.id;

                                 if (originalId && newId !== originalId) {
                                   // ID changed, need to create new doc and delete old one
                                   const dataToSave = {
                                     ...editingEpp,
                                     stock: newStockValue,
                                     size: editingEpp.size || '',
                                     category: editingEpp.category || '',
                                     updatedAt: serverTimestamp()
                                   };
                                   await setDoc(doc(db, 'epp_catalog', newId), dataToSave);
                                   await deleteDoc(doc(db, 'epp_catalog', originalId));
                                 } else {
                                   // Regular update
                                   const eppRef = doc(db, 'epp_catalog', editingEpp.id);
                                   await updateDoc(eppRef, { 
                                     stock: newStockValue,
                                     size: editingEpp.size || '',
                                     category: editingEpp.category || ''
                                   });
                                 }
                                 setEditingEpp(null);
                                 fetchCatalogData();
                               } catch (err) {
                                 console.error("Error updating EPP:", err);
                               }
                             }}
                             className="flex-1 bg-indigo-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-indigo-700 transition-colors"
                           >
                             Guardar
                           </button>
                         </div>
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>

                {/* Data Maintenance Section */}
                <div className="mt-12 pt-12 border-t border-slate-200">
                  <h2 className="text-2xl font-bold text-slate-900 mb-2">Mantenimiento de Datos</h2>
                  <p className="text-slate-500 mb-8">Acciones críticas para la gestión de la base de datos</p>

                  <div className="space-y-6">
                    <div className="bg-rose-50 border border-rose-100 rounded-3xl p-8 flex flex-col md:flex-row items-center justify-between gap-6">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-rose-100 flex items-center justify-center text-rose-600">
                          <Package className="w-8 h-8" />
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-rose-900">Vaciar Catálogo de EPP</h3>
                          <p className="text-rose-700/70 text-sm">Elimina todos los artículos del catálogo. Útil para cargar una lista nueva desde Excel sin duplicados de códigos antiguos.</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => setIsClearingCatalogModal(true)}
                        disabled={isSubmitting}
                        className="bg-rose-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-rose-700 transition-all shadow-lg shadow-rose-200 whitespace-nowrap"
                      >
                        {isSubmitting ? 'Procesando...' : 'Vaciar Catálogo'}
                      </button>
                    </div>

                    <div className="bg-rose-50 border border-rose-100 rounded-3xl p-8 flex flex-col md:flex-row items-center justify-between gap-6">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-rose-100 flex items-center justify-center text-rose-600">
                          <Trash2 className="w-8 h-8" />
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-rose-900">Reiniciar Historial de Entregas</h3>
                          <p className="text-rose-700/70 text-sm">Esta acción eliminará permanentemente todos los registros de entregas realizados hasta ahora.</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => setIsClearingHistory(true)}
                        className="bg-rose-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-rose-700 transition-all shadow-lg shadow-rose-200 whitespace-nowrap"
                      >
                        Reiniciar Historial
                      </button>
                    </div>
                  </div>
                </div>

                {/* Clear History Confirmation Modal */}
                <AnimatePresence>
                  {isClearingHistory && (
                    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full"
                      >
                        <div className="w-16 h-16 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mb-6 mx-auto">
                          <AlertTriangle className="w-10 h-10" />
                        </div>
                        <h3 className="text-2xl font-bold text-center mb-2">¿Estás seguro?</h3>
                        <p className="text-slate-500 text-center mb-8">
                          Esta acción es **irreversible**. Se eliminarán todos los registros de entregas, firmas y alertas del historial.
                        </p>
                        
                        <div className="flex gap-3">
                          <button 
                            onClick={() => setIsClearingHistory(false)}
                            className="flex-1 py-4 px-4 rounded-2xl text-slate-600 font-bold hover:bg-slate-50 transition-colors"
                            disabled={isSubmitting}
                          >
                            Cancelar
                          </button>
                          <button 
                            onClick={clearDeliveryHistory}
                            disabled={isSubmitting}
                            className="flex-1 bg-rose-600 text-white font-bold py-4 px-4 rounded-2xl hover:bg-rose-700 transition-all flex items-center justify-center gap-2"
                          >
                            {isSubmitting ? (
                              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                              <>
                                <Trash2 className="w-5 h-5" />
                                Sí, Reiniciar
                              </>
                            )}
                          </button>
                        </div>
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>

                {/* Clear Catalog Confirmation Modal */}
                <AnimatePresence>
                  {isClearingCatalogModal && (
                    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full"
                      >
                        <div className="w-16 h-16 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mb-6 mx-auto">
                          <AlertTriangle className="w-10 h-10" />
                        </div>
                        <h3 className="text-2xl font-bold text-center mb-2">Peligro: Vaciar Catálogo</h3>
                        <p className="text-slate-500 text-center mb-8">
                          ¿De verdad quieres **ELIMINAR TODO EL CATÁLOGO** de EPP? Esta acción borrará todos los productos registrados permanentemente.
                        </p>
                        
                        <div className="flex gap-3">
                          <button 
                            onClick={() => setIsClearingCatalogModal(false)}
                            className="flex-1 py-4 px-4 rounded-2xl text-slate-600 font-bold hover:bg-slate-50 transition-colors"
                            disabled={isSubmitting}
                          >
                            Cancelar
                          </button>
                          <button 
                            onClick={handleClearCatalog}
                            disabled={isSubmitting}
                            className="flex-1 py-4 px-4 rounded-2xl bg-rose-600 text-white font-bold hover:bg-rose-700 transition-all shadow-lg shadow-rose-200"
                          >
                            {isSubmitting ? 'Vaciando...' : 'Sí, Borrar Todo'}
                          </button>
                        </div>
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>

                {/* Corregir Datos Section */}
                <div className="mt-8 bg-indigo-50 border border-indigo-100 rounded-3xl p-8 flex flex-col md:flex-row items-center justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-indigo-100 flex items-center justify-center text-indigo-600">
                      <Package className="w-8 h-8" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-indigo-900">Corregir Datos (Talla a Stock)</h3>
                      <p className="text-indigo-700/70 text-sm">Mueve los valores de 'Talla' a 'Stock' y reinicia la talla a '0' para todo el catálogo.</p>
                    </div>
                  </div>
                  <button 
                    onClick={async () => {
                      if (!confirm("Esto intercambiará la Talla por el Stock y pondrá todas las tallas en 0. ¿Deseas continuar?")) return;
                      setIsSubmitting(true);
                      try {
                        const snap = await getDocs(collection(db, 'epp_catalog'));
                        const batch = writeBatch(db);
                        snap.docs.forEach(d => {
                          const data = d.data();
                          const currentSize = data.size || '0';
                          const numericSize = parseInt(currentSize);
                          batch.update(d.ref, {
                            stock: isNaN(numericSize) ? 0 : numericSize,
                            size: '0'
                          });
                        });
                        await batch.commit();
                        alert("Datos corregidos con éxito.");
                        fetchCatalogData();
                      } catch (err) {
                        console.error("Error fixing data:", err);
                        alert("Error al corregir datos.");
                      } finally {
                        setIsSubmitting(false);
                      }
                    }}
                    disabled={isSubmitting}
                    className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 whitespace-nowrap"
                  >
                    {isSubmitting ? 'Procesando...' : 'Corregir Catálogo'}
                  </button>
                </div>

                {/* User Management Section */}
                <div className="mt-12 pt-12 border-t border-slate-200">
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">Gestión de Usuarios</h2>
                      <p className="text-slate-500">Control de acceso y permisos</p>
                    </div>
                    <button 
                      onClick={() => setIsAddingUser(true)}
                      className="bg-indigo-600 text-white px-6 py-3 rounded-2xl font-semibold flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
                    >
                      <UserPlus className="w-5 h-5" />
                      Nuevo Usuario
                    </button>
                  </div>

                  <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Usuario</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Rol</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Acciones</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {authorizedUsers.map((user) => (
                            <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold">
                                    {user.email[0].toUpperCase()}
                                  </div>
                                  <span className="font-medium text-slate-700">{user.email}</span>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                                  user.role === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                                }`}>
                                  {user.role === 'admin' ? <Shield className="w-3 h-3" /> : <User className="w-3 h-3" />}
                                  {user.role}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  <button 
                                    onClick={() => handleToggleRole(user)}
                                    disabled={user.email === auth.currentUser?.email}
                                    className="p-2 text-slate-400 hover:text-indigo-600 transition-colors disabled:opacity-30"
                                    title="Cambiar Rol"
                                  >
                                    <ShieldCheck className="w-5 h-5" />
                                  </button>
                                  <button 
                                    onClick={() => handleDeleteUser(user)}
                                    disabled={user.email === auth.currentUser?.email}
                                    className="p-2 text-slate-400 hover:text-rose-600 transition-colors disabled:opacity-30"
                                    title="Eliminar"
                                  >
                                    <Trash2 className="w-5 h-5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Add User Modal */}
                <AnimatePresence>
                  {isAddingUser && (
                    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full"
                      >
                        <h3 className="text-2xl font-bold mb-6">Nuevo Usuario Autorizado</h3>
                        
                        <div className="space-y-4 mb-8">
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">Correo Electrónico</label>
                            <input 
                              type="email" 
                              value={newUser.email}
                              onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                              placeholder="ejemplo@correo.com"
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">Contraseña (Opcional para crear cuenta)</label>
                            <input 
                              type="password" 
                              value={newUser.password}
                              onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                              placeholder="Mínimo 6 caracteres"
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            />
                            <p className="text-[10px] text-slate-400 mt-1">Si se proporciona, se creará una cuenta de acceso por correo/contraseña.</p>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">Rol</label>
                            <select 
                              value={newUser.role}
                              onChange={(e) => setNewUser({...newUser, role: e.target.value as 'admin' | 'user'})}
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            >
                              <option value="user">Usuario (Solo Entrega)</option>
                              <option value="admin">Administrador (Acceso Total)</option>
                            </select>
                          </div>
                        </div>

                        <div className="flex gap-3">
                          <button 
                            onClick={() => setIsAddingUser(false)}
                            className="flex-1 py-3 px-4 rounded-xl text-slate-600 font-medium hover:bg-slate-50 transition-colors"
                          >
                            Cancelar
                          </button>
                          <button 
                            onClick={handleAddUser}
                            disabled={userActionLoading || !newUser.email}
                            className="flex-1 bg-indigo-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50"
                          >
                            {userActionLoading ? 'Guardando...' : 'Autorizar'}
                          </button>
                        </div>
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Modales Globales */}
        <AnimatePresence>
          {deliveryWarning && (
            <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full"
              >
                <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <AlertCircle className="w-8 h-8 text-amber-600" />
                </div>
                <h3 className="text-2xl font-bold mb-2 text-center text-slate-900">Advertencia de Entrega</h3>
                <p className="text-slate-600 text-center mb-8 leading-relaxed whitespace-pre-line">
                  {deliveryWarning.message}
                  <br /><br />
                  <span className="font-bold text-slate-900">¿Desea continuar con la entrega?</span>
                </p>
                
                <div className="flex gap-3">
                  <button 
                    onClick={() => {
                      setDeliveryWarning(null);
                      setIsSubmitting(false);
                    }}
                    className="flex-1 py-3 px-4 rounded-xl text-slate-600 font-medium hover:bg-slate-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={deliveryWarning.onConfirm}
                    className="flex-1 bg-indigo-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
                  >
                    Continuar
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {userToDelete && (
            <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full"
              >
                <div className="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Trash2 className="w-8 h-8 text-rose-600" />
                </div>
                <h3 className="text-2xl font-bold mb-2 text-center">¿Eliminar Usuario?</h3>
                <p className="text-slate-500 text-center mb-8">
                  ¿Estás seguro de que deseas eliminar a <span className="font-bold text-slate-900">{userToDelete.email}</span>? 
                  Esta acción no se puede deshacer.
                </p>
                
                <div className="flex gap-3">
                  <button 
                    onClick={() => setUserToDelete(null)}
                    disabled={userActionLoading}
                    className="flex-1 py-3 px-4 rounded-xl text-slate-600 font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={confirmDeleteUser}
                    disabled={userActionLoading}
                    className="flex-1 bg-rose-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-rose-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {userActionLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Eliminando...
                      </>
                    ) : 'Eliminar'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>

      {/* Mobile Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-3 flex items-center justify-around sm:hidden z-50">
        <button 
          onClick={() => setActiveTab('delivery')}
          className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'delivery' ? 'text-indigo-600' : 'text-slate-400'}`}
        >
          <Plus className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Entrega</span>
        </button>
        <button 
          onClick={() => setActiveTab('history')}
          className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'history' ? 'text-indigo-600' : 'text-slate-400'}`}
        >
          <History className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Historial</span>
        </button>
        {isAdmin && (
          <button 
            onClick={() => setActiveTab('alerts')}
            className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'alerts' ? 'text-indigo-600' : 'text-slate-400'}`}
          >
            <Bell className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Alertas</span>
          </button>
        )}
        {isAdmin && (
          <button 
            onClick={() => setActiveTab('setup')}
            className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'setup' ? 'text-indigo-600' : 'text-slate-400'}`}
          >
            <Settings className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Admin</span>
          </button>
        )}
        <button 
          onClick={logout}
          className="flex flex-col items-center gap-1 text-slate-400"
        >
          <LogOut className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Salir</span>
        </button>
      </div>
    </div>
  );
}



