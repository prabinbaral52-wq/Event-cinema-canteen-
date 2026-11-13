/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Bell, Volume2, VolumeX, Clock, ChefHat, PlusCircle,
  QrCode, Smartphone, DollarSign, CheckCircle2,
  Film, Check, X, Copy, Database, Wifi, AlertTriangle
} from 'lucide-react';
import QRCode from 'qrcode';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  onValue,
  ref as rtdbRef,
  set as rtdbSet,
  update as rtdbUpdate,
} from 'firebase/database';
import { db, rtdb, firebaseConfig, handleFirestoreError, OperationType, testFirestoreConnection } from './firebase';

interface OrderItem {
  name: string;
  qty: number;
  price: number;
}

interface Order {
  id: string;
  orderCode: string;
  seat: string;
  hall: string;
  items: OrderItem[];
  paymentType: 'digital' | 'cash';
  totalAmount: number;
  status: 'new' | 'preparing' | 'delivered';
  source?: string;
  backend: 'firestore' | 'rtdb' | 'both';
  timestamp: number;
}

function sanitizeSeat(raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  return (cleaned || 'A-01').slice(0, 16);
}

function sanitizeHall(raw: string): string {
  const cleaned = raw.trim();
  return (cleaned || 'Hall 1 / Screen 1').slice(0, 48);
}

function normalizeItems(rawItems: unknown): OrderItem[] {
  if (!Array.isArray(rawItems)) return [];
  return rawItems.slice(0, 20).map((item) => {
    if (typeof item === 'string') {
      return { name: item, qty: 1, price: 0 };
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      return {
        name: String(obj.name ?? obj.title ?? obj.item ?? 'Snack Item'),
        qty: Math.max(1, Number(obj.qty ?? obj.quantity ?? 1)),
        price: Math.max(0, Number(obj.price ?? obj.amount ?? 0)),
      };
    }
    return { name: 'Snack Item', qty: 1, price: 0 };
  });
}

function normalizePaymentType(raw: Record<string, unknown>): 'digital' | 'cash' {
  const val = String(raw.paymentType ?? raw.paymentMethod ?? raw.payment ?? '').toLowerCase();
  if (val.includes('cash')) return 'cash';
  return 'digital';
}

function normalizeStatus(raw: unknown): 'new' | 'preparing' | 'delivered' {
  const val = String(raw ?? 'new').toLowerCase();
  if (val === 'delivered' || val === 'completed') return 'delivered';
  if (val === 'preparing') return 'preparing';
  return 'new';
}

function parseTimestamp(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

export default function App() {
  const [shiftStarted, setShiftStarted] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const [filterHall, setFilterHall] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showQrModal, setShowQrModal] = useState(false);
  const [showFirebaseModal, setShowFirebaseModal] = useState(false);
  const [showCustomerSimulator, setShowCustomerSimulator] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [firestoreOnline, setFirestoreOnline] = useState<boolean | null>(null);
  const [rtdbOnline, setRtdbOnline] = useState<boolean | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [copiedTab, setCopiedTab] = useState<'rtdb' | 'firestore' | null>(null);
  const [snippetMode, setSnippetMode] = useState<'rtdb' | 'firestore'>('firestore');
  const [submittingOrder, setSubmittingOrder] = useState(false);

  // Customer simulator form state
  const [simSeat, setSimSeat] = useState('F-12');
  const [simHall, setSimHall] = useState('Hall 1 / Screen 1');
  const [simPayment, setSimPayment] = useState<'digital' | 'cash'>('digital');
  const [simCart, setSimCart] = useState<OrderItem[]>([
    { name: 'Super Combo (Popcorn + Large Coke)', qty: 1, price: 450 },
    { name: 'Chilled Ice-Cold Coke (500ml)', qty: 2, price: 150 },
    { name: 'Caramel Popcorn Large', qty: 1, price: 350 }
  ]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(soundEnabled);
  const firestoreOrdersRef = useRef<Map<string, Order>>(new Map());
  const rtdbOrdersRef = useRef<Map<string, Order>>(new Map());
  const initialHydratedRef = useRef(false);
  const knownOrderIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  // Live digital clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Generate real scannable QR code for the Staff KDS URL
  useEffect(() => {
    QRCode.toDataURL(window.location.href, {
      width: 320,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error('QR generation failed:', err));
  }, []);

  // Web Audio Chime Synthesis (Two-tone kitchen bell)
  const playChime = () => {
    if (!soundEnabledRef.current) return;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;

      // Tone 1: High Bell (C6 ~ 1046.5 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(1046.5, now);
      gain1.gain.setValueAtTime(0.35, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.6);

      // Tone 2: Lower Bell / Gong (G5 ~ 783.99 Hz)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(783.99, now + 0.18);
      gain2.gain.setValueAtTime(0.45, now + 0.18);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.95);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.18);
      osc2.stop(now + 0.95);
    } catch (e) {
      console.error('Playback chime error:', e);
    }
  };

  const playSuccessChime = () => {
    if (!soundEnabledRef.current) return;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.09);
      osc.frequency.setValueAtTime(783.99, now + 0.18);
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.45);
    } catch (e) {
      console.error(e);
    }
  };

  const initAudio = () => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      setShiftStarted(true);
      setSoundEnabled(true);
      soundEnabledRef.current = true;
      playChime();
    } catch (e) {
      console.error('AudioContext error:', e);
      setShiftStarted(true);
      setSoundEnabled(true);
    }
  };

  const mergeAndPublishOrders = () => {
    const merged = new Map<string, Order>();

    firestoreOrdersRef.current.forEach((order, id) => {
      merged.set(id, order);
    });

    rtdbOrdersRef.current.forEach((order, id) => {
      const existing = merged.get(id);
      if (existing) {
        merged.set(id, { ...order, ...existing, backend: 'both' });
      } else {
        merged.set(id, order);
      }
    });

    const activeList: Order[] = [];
    let deliveredTotal = 0;
    let hasBrandNewOrder = false;

    merged.forEach((order) => {
      if (order.status === 'delivered') {
        deliveredTotal += 1;
        knownOrderIdsRef.current.add(order.id);
        return;
      }

      if (initialHydratedRef.current && !knownOrderIdsRef.current.has(order.id) && order.status === 'new') {
        hasBrandNewOrder = true;
      }
      knownOrderIdsRef.current.add(order.id);
      activeList.push(order);
    });

    activeList.sort((a, b) => b.timestamp - a.timestamp);
    setOrders(activeList);
    setCompletedCount(deliveredTotal);

    if (!initialHydratedRef.current) {
      initialHydratedRef.current = true;
    } else if (hasBrandNewOrder) {
      playChime();
    }
  };

  // Real-time Firebase Listeners (Firestore + Realtime Database on event-cinema) + BroadcastChannel
  useEffect(() => {
    testFirestoreConnection().then((ok) => setFirestoreOnline(ok));

    const ordersPath = 'orders';
    const q = query(
      collection(db, ordersPath),
      where('status', 'in', ['new', 'preparing', 'delivered'])
    );

    const unsubscribeFirestore = onSnapshot(
      q,
      (snapshot) => {
        setFirestoreOnline(true);
        const nextMap = new Map<string, Order>();
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          nextMap.set(docSnap.id, {
            id: docSnap.id,
            orderCode: String(data.orderCode || docSnap.id),
            seat: String(data.seat || data.seatNumber || 'A-01'),
            hall: String(data.hall || data.screen || 'Hall 1 / Screen 1'),
            items: normalizeItems(data.items),
            paymentType: normalizePaymentType(data),
            totalAmount: Number(data.totalAmount ?? data.total ?? 0),
            status: normalizeStatus(data.status),
            source: data.source ? String(data.source) : undefined,
            backend: 'firestore',
            timestamp: parseTimestamp(data.createdAt ?? data.timestamp),
          });
        });
        firestoreOrdersRef.current = nextMap;
        mergeAndPublishOrders();
      },
      (error) => {
        setFirestoreOnline(false);
        setSyncNotice(`Firestore listener: ${error.message}`);
        try {
          handleFirestoreError(error, OperationType.LIST, ordersPath);
        } catch {
          // Structured error logged by handleFirestoreError
        }
      }
    );

    const unsubscribeRtdb = onValue(
      rtdbRef(rtdb, 'orders'),
      (snapshot) => {
        setRtdbOnline(true);
        const nextMap = new Map<string, Order>();
        const raw = snapshot.val();
        if (raw && typeof raw === 'object') {
          Object.entries(raw as Record<string, unknown>).forEach(([key, val]) => {
            if (!val || typeof val !== 'object') return;
            const data = val as Record<string, unknown>;
            nextMap.set(key, {
              id: key,
              orderCode: String(data.orderCode || key),
              seat: String(data.seat || data.seatNumber || 'A-01'),
              hall: String(data.hall || data.screen || 'Hall 1 / Screen 1'),
              items: normalizeItems(data.items),
              paymentType: normalizePaymentType(data),
              totalAmount: Number(data.totalAmount ?? data.total ?? 0),
              status: normalizeStatus(data.status),
              source: data.source ? String(data.source) : undefined,
              backend: 'rtdb',
              timestamp: parseTimestamp(data.createdAt ?? data.timestamp),
            });
          });
        }
        rtdbOrdersRef.current = nextMap;
        mergeAndPublishOrders();
      },
      (error) => {
        setRtdbOnline(false);
        console.debug('Realtime DB optional listener unavailable:', error.message);
      }
    );

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('cinema_orders');
      bc.onmessage = async (event) => {
        if (event.data && event.data.type === 'NEW_ORDER' && event.data.order) {
          const incoming = event.data.order;
          const docId = `ord-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
          await writeOrderToFirebase(docId, {
            orderCode: String(incoming.id || `ORD-${Math.floor(1000 + Math.random() * 9000)}`),
            seat: sanitizeSeat(String(incoming.seat || 'F-12')),
            hall: sanitizeHall(String(incoming.hall || 'Hall 1 / Screen 1')),
            items:
              Array.isArray(incoming.items) && incoming.items.length > 0
                ? incoming.items.slice(0, 20)
                : [{ name: 'Combo Order', qty: 1, price: Number(incoming.totalAmount || 250) }],
            paymentType: incoming.paymentType === 'cash' ? 'cash' : 'digital',
            totalAmount: Number(incoming.totalAmount || 0),
            source: 'customer_qr',
          });
        }
      };
    } catch (e) {
      console.log('BroadcastChannel unavailable:', e);
    }

    return () => {
      unsubscribeFirestore();
      unsubscribeRtdb();
      if (bc) bc.close();
    };
  }, []);

  const writeOrderToFirebase = async (
    docId: string,
    payload: {
      orderCode: string;
      seat: string;
      hall: string;
      items: OrderItem[];
      paymentType: 'digital' | 'cash';
      totalAmount: number;
      source: 'customer_qr' | 'kds_simulator' | 'kds_test';
    }
  ) => {
    const cleanItems = payload.items.slice(0, 20).map((item) => ({
      name: String(item.name).trim().slice(0, 100) || 'Snack Item',
      qty: Math.max(1, Math.min(50, Math.round(Number(item.qty) || 1))),
      price: Math.max(0, Math.min(50000, Number(item.price) || 0)),
    }));

    const cleanOrderCode = /^ORD-[A-Z0-9-]+$/.test(payload.orderCode)
      ? payload.orderCode.slice(0, 24)
      : `ORD-${Math.floor(1000 + Math.random() * 9000)}`;

    const cleanSeat = sanitizeSeat(payload.seat);
    const cleanHall = sanitizeHall(payload.hall);
    const cleanTotal = Math.max(0, Math.min(100000, Number(payload.totalAmount) || 0));

    let wroteAny = false;
    let lastError: unknown = null;

    // 1. Write to Firestore
    try {
      await setDoc(doc(db, 'orders', docId), {
        orderCode: cleanOrderCode,
        seat: cleanSeat,
        hall: cleanHall,
        items: cleanItems,
        paymentType: payload.paymentType,
        totalAmount: cleanTotal,
        status: 'new',
        source: payload.source,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      wroteAny = true;
    } catch (error) {
      lastError = error;
      try {
        handleFirestoreError(error, OperationType.CREATE, `orders/${docId}`);
      } catch {
        // Logged by handleFirestoreError
      }
    }

    // 2. Write to Realtime Database (so RTDB-only Customer Apps stay synced too)
    try {
      await rtdbSet(rtdbRef(rtdb, `orders/${docId}`), {
        orderCode: cleanOrderCode,
        seat: cleanSeat,
        hall: cleanHall,
        items: cleanItems,
        paymentType: payload.paymentType,
        totalAmount: cleanTotal,
        status: 'new',
        source: payload.source,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      wroteAny = true;
    } catch (error) {
      lastError = lastError || error;
    }

    if (!wroteAny && lastError) {
      setSyncNotice(
        `Could not write order to Firebase (${lastError instanceof Error ? lastError.message : String(lastError)}). Check Firestore/RTDB rules in project "${firebaseConfig.projectId}".`
      );
    } else {
      setSyncNotice(null);
    }
  };

  const simulateTestOrder = async () => {
    const randomSeats = ['A-08', 'C-14', 'E-02', 'G-11', 'K-05', 'B-19', 'F-03'];
    const randomHalls = ['Hall 1 / Screen 1', 'Hall 2 / Screen 2', 'Hall 3 / IMAX Screen'];
    const combos = [
      { name: 'Super Combo (Popcorn + Large Coke)', price: 450 },
      { name: 'Nachos with Salsa & Cheese', price: 380 },
      { name: 'Caramel Popcorn Tub', price: 350 },
      { name: 'Chilled Coke (500ml)', price: 150 },
      { name: 'Hot Dog Deluxe + Sprite', price: 420 },
      { name: 'Samosa Platter + Masala Tea', price: 250 }
    ];

    const selectedCombo = combos[Math.floor(Math.random() * combos.length)];
    const isDigital = Math.random() > 0.4;
    const qty = Math.floor(Math.random() * 2) + 1;
    const total = selectedCombo.price * qty;
    const orderCode = `ORD-${Math.floor(1000 + Math.random() * 9000)}`;
    const docId = `ord-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    setSubmittingOrder(true);
    try {
      await writeOrderToFirebase(docId, {
        orderCode,
        seat: randomSeats[Math.floor(Math.random() * randomSeats.length)],
        hall: randomHalls[Math.floor(Math.random() * randomHalls.length)],
        items: [{ name: selectedCombo.name, qty, price: selectedCombo.price }],
        paymentType: isDigital ? 'digital' : 'cash',
        totalAmount: total,
        source: 'kds_test',
      });
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleCustomOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const total = simCart.reduce((acc, item) => acc + item.price * item.qty, 0);
    const orderCode = `ORD-${Math.floor(1000 + Math.random() * 9000)}`;
    const docId = `ord-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    setSubmittingOrder(true);
    try {
      await writeOrderToFirebase(docId, {
        orderCode,
        seat: simSeat,
        hall: simHall,
        items: simCart,
        paymentType: simPayment,
        totalAmount: total,
        source: 'kds_simulator',
      });
      setShowCustomerSimulator(false);
    } finally {
      setSubmittingOrder(false);
    }
  };

  const updateOrderStatus = async (order: Order, newStatus: 'preparing' | 'delivered') => {
    let updated = false;

    if (order.backend === 'firestore' || order.backend === 'both') {
      try {
        await updateDoc(doc(db, 'orders', order.id), {
          status: newStatus,
          updatedAt: serverTimestamp(),
        });
        updated = true;
      } catch (error) {
        try {
          handleFirestoreError(error, OperationType.UPDATE, `orders/${order.id}`);
        } catch {
          // Logged by handleFirestoreError
        }
      }
    }

    if (order.backend === 'rtdb' || order.backend === 'both') {
      try {
        await rtdbUpdate(rtdbRef(rtdb, `orders/${order.id}`), {
          status: newStatus,
          updatedAt: Date.now(),
        });
        updated = true;
      } catch (error) {
        console.error('RTDB status update failed:', error);
      }
    }

    if (updated && newStatus === 'delivered') {
      playSuccessChime();
    }
  };

  const activeOrdersCount = orders.length;
  const totalCashToCollect = orders
    .filter((o) => o.paymentType === 'cash')
    .reduce((sum, o) => sum + o.totalAmount, 0);

  const filteredOrders = orders.filter((o) => {
    if (filterHall !== 'all' && o.hall !== filterHall) return false;
    if (filterStatus !== 'all' && o.status !== filterStatus) return false;
    return true;
  });

  const getRelativeTime = (timestamp: number) => {
    const diffSec = Math.max(0, Math.floor((currentTime.getTime() - timestamp) / 1000));
    if (diffSec < 45) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin === 1) return '1m ago';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    return `${diffHr}h ago`;
  };

  const isAnyBackendConnected = firestoreOnline === true || rtdbOnline === true;

  const rtdbSenderSnippet = `<!-- Paste in Customer App (index.html) for Realtime Database -->
<script type="module">
  import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
  import { getDatabase, ref, push, set } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";

  const firebaseConfig = ${JSON.stringify(firebaseConfig, null, 4)};

  const app = initializeApp(firebaseConfig);
  const rtdb = getDatabase(app);

  // Call this when Customer taps "Confirm Order"
  export async function sendOrderToCanteen({ seat, hall, items, paymentType, totalAmount }) {
    const newOrderRef = push(ref(rtdb, "orders"));
    const orderCode = "ORD-" + Math.floor(1000 + Math.random() * 9000);
    await set(newOrderRef, {
      orderCode,
      seat: String(seat).toUpperCase(),
      hall: String(hall),
      items, // [{ name: "Super Combo", qty: 1, price: 450 }]
      paymentType, // "digital" or "cash"
      totalAmount: Number(totalAmount),
      status: "new",
      source: "customer_qr",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    return orderCode;
  }
</script>`;

  const firestoreSenderSnippet = `<!-- Paste in Customer App (index.html) for Cloud Firestore -->
<script type="module">
  import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
  import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

  const firebaseConfig = ${JSON.stringify(firebaseConfig, null, 4)};

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app, "${firebaseConfig.firestoreDatabaseId}");

  // Call this when Customer taps "Confirm Order"
  export async function sendOrderToCanteen({ seat, hall, items, paymentType, totalAmount }) {
    const orderId = "ord-" + Date.now() + "-" + Math.floor(100 + Math.random() * 900);
    const orderCode = "ORD-" + Math.floor(1000 + Math.random() * 9000);
    await setDoc(doc(db, "orders", orderId), {
      orderCode,
      seat: String(seat).toUpperCase(),
      hall: String(hall),
      items, // [{ name: "Super Combo", qty: 1, price: 450 }]
      paymentType, // "digital" or "cash"
      totalAmount: Number(totalAmount),
      status: "new",
      source: "customer_qr",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return orderCode;
  }
</script>`;

  const handleCopySnippet = async (mode: 'rtdb' | 'firestore') => {
    try {
      await navigator.clipboard.writeText(mode === 'rtdb' ? rtdbSenderSnippet : firestoreSenderSnippet);
      setCopiedTab(mode);
      setTimeout(() => setCopiedTab(null), 2500);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none">
      {/* SHIFT START OVERLAY */}
      {!shiftStarted && (
        <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-xl bg-slate-900 border border-amber-500/30 rounded-2xl p-8 shadow-2xl shadow-amber-500/10">
            <div className="w-20 h-20 bg-amber-500/10 border border-amber-500/30 rounded-full flex items-center justify-center mx-auto mb-6 text-amber-400">
              <Film className="w-10 h-10" />
            </div>
            <div className="text-xs uppercase tracking-widest text-amber-400 font-semibold mb-2">
              Event Cinemas, Lalbandi-7 · Concession KDS
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white mb-3">
              Staff Kitchen Display System
            </h1>
            <p className="text-slate-400 text-sm mb-8 leading-relaxed">
              Connected to Firebase project <span className="text-amber-300 font-mono">{firebaseConfig.projectId}</span> with zero login barrier. Tap below to start your shift and enable automatic bell chimes whenever a customer order arrives.
            </p>
            <button
              onClick={initAudio}
              className="w-full py-4 px-6 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-lg rounded-xl shadow-lg shadow-amber-500/20 transition-all transform active:scale-95 flex items-center justify-center gap-3 cursor-pointer"
            >
              <Bell className="w-6 h-6 animate-bounce" />
              TAP TO START SHIFT &amp; ENABLE SOUND
            </button>
          </div>
        </div>
      )}

      {/* HEADER BAR */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-500 rounded-lg flex items-center justify-center text-slate-950 font-black shadow-md shrink-0">
            EC
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg font-bold tracking-tight text-white whitespace-nowrap">
                Event Cinemas, Lalbandi-7
              </h1>
              <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono whitespace-nowrap">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isAnyBackendConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                  }`}
                />
                {firebaseConfig.projectId.toUpperCase()}
              </span>
            </div>
            <div className="text-xs text-slate-400">Concession Counter Kitchen Display (Receiver)</div>
          </div>
        </div>

        {/* METRICS BAR */}
        <div className="flex items-center gap-4 bg-slate-950 border border-slate-800 px-4 py-2 rounded-xl tabular-nums">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Active:</span>
            <span className="text-lg font-mono font-bold text-amber-400">{activeOrdersCount}</span>
          </div>
          <div className="h-4 w-px bg-slate-800" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Completed:</span>
            <span className="text-lg font-mono font-bold text-emerald-400">{completedCount}</span>
          </div>
          <div className="h-4 w-px bg-slate-800" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Cash Collect:</span>
            <span className="text-lg font-mono font-bold text-amber-300">
              Rs. {totalCashToCollect.toLocaleString()}
            </span>
          </div>
        </div>

        {/* CONTROLS */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="text-sm font-mono tabular-nums text-slate-300 bg-slate-950 px-3 py-2 rounded-lg border border-slate-800 whitespace-nowrap">
            {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>

          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2 rounded-lg border transition-all cursor-pointer ${
              soundEnabled
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
            title={soundEnabled ? 'Sound Enabled' : 'Sound Muted'}
          >
            {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>

          <button
            onClick={() => setShowFirebaseModal(true)}
            className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-300 text-xs font-semibold rounded-lg border border-emerald-500/30 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Database className="w-4 h-4 text-emerald-400" />
            Customer App Sync
          </button>

          <button
            onClick={() => setShowQrModal(true)}
            className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <QrCode className="w-4 h-4 text-amber-400" />
            Staff QR Code
          </button>

          <button
            onClick={() => setShowCustomerSimulator(true)}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Smartphone className="w-4 h-4" />
            Simulate Customer Order
          </button>

          <button
            onClick={simulateTestOrder}
            disabled={submittingOrder}
            className="flex items-center gap-2 px-3 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 text-xs font-bold rounded-lg shadow transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            + Simulate Test Order
          </button>
        </div>
      </header>

      {/* SYNC NOTICE BANNER IF ANY */}
      {syncNotice && (
        <div className="bg-amber-950/70 border-b border-amber-500/40 px-6 py-2.5 flex items-center justify-between text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{syncNotice}</span>
          </div>
          <button onClick={() => setSyncNotice(null)} className="text-amber-300 hover:text-white font-semibold cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* FILTER BAR */}
      <div className="bg-slate-900/60 border-b border-slate-800/80 px-6 py-3 flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Hall Filter:</span>
          <div className="flex flex-wrap items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            {['all', 'Hall 1 / Screen 1', 'Hall 2 / Screen 2', 'Hall 3 / IMAX Screen'].map((hall) => (
              <button
                key={hall}
                onClick={() => setFilterHall(hall)}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                  filterHall === hall
                    ? 'bg-amber-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {hall === 'all' ? 'All Halls' : hall}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Status:</span>
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            {['all', 'new', 'preparing'].map((st) => (
              <button
                key={st}
                onClick={() => setFilterStatus(st)}
                className={`px-3 py-1 text-xs font-medium rounded uppercase transition-colors whitespace-nowrap cursor-pointer ${
                  filterStatus === st
                    ? 'bg-amber-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* MAIN ORDERS GRID */}
      <main className="flex-1 p-6 overflow-y-auto">
        {filteredOrders.length === 0 ? (
          <div className="h-96 flex flex-col items-center justify-center text-center p-8 bg-slate-900/30 border border-dashed border-slate-800 rounded-2xl">
            <ChefHat className="w-16 h-16 text-slate-700 mb-4" />
            <h2 className="text-xl font-bold text-slate-300 mb-2">No Active Canteen Orders</h2>
            <p className="text-slate-500 text-sm max-w-md mb-6">
              Listening live on <span className="text-slate-300 font-mono">{firebaseConfig.projectId}</span> (Firestore &amp; Realtime Database) for incoming customer orders. Click &ldquo;+ Simulate Test Order&rdquo; above to test the bell and card feed.
            </p>
            <button
              onClick={simulateTestOrder}
              disabled={submittingOrder}
              className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl transition-all cursor-pointer"
            >
              + Simulate Test Order Now
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredOrders.map((order) => {
              const isNew = order.status === 'new';
              const isPreparing = order.status === 'preparing';

              return (
                <div
                  key={order.id}
                  className={`relative flex flex-col bg-slate-900 border-2 rounded-2xl shadow-xl transition-all overflow-hidden ${
                    isNew
                      ? 'border-amber-500 shadow-amber-500/20 ring-4 ring-amber-500/15'
                      : isPreparing
                      ? 'border-yellow-400/80 shadow-yellow-400/10'
                      : 'border-slate-800'
                  }`}
                >
                  {/* CARD HEADER: HUGE SEAT & SCREEN */}
                  <div
                    className={`p-4 flex items-center justify-between border-b ${
                      isNew
                        ? 'bg-amber-500/10 border-amber-500/30'
                        : isPreparing
                        ? 'bg-yellow-500/10 border-yellow-500/30'
                        : 'bg-slate-950/60 border-slate-800'
                    }`}
                  >
                    <div>
                      <div className="text-xs uppercase font-mono tabular-nums tracking-widest text-slate-400">
                        {order.orderCode}
                      </div>
                      <div className="text-3xl font-black text-white tracking-tight font-mono mt-0.5">
                        SEAT {order.seat}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 text-slate-200 border border-slate-700 whitespace-nowrap">
                        <Film className="w-3.5 h-3.5 text-amber-400" />
                        {order.hall}
                      </span>
                      <div className="text-xs text-slate-400 mt-1.5 font-mono tabular-nums flex items-center justify-end gap-1">
                        <Clock className="w-3 h-3" />
                        {getRelativeTime(order.timestamp)}
                      </div>
                    </div>
                  </div>

                  {/* PAYMENT STATUS BADGE (High Contrast) */}
                  <div className="px-4 py-3 border-b border-slate-800/80 bg-slate-950/40">
                    {order.paymentType === 'digital' ? (
                      <div className="flex items-center justify-between gap-2 bg-emerald-500/15 border border-emerald-500/40 rounded-xl px-3 py-2 text-emerald-300 text-xs font-bold">
                        <span className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          FONEPAY / MOBILE PAID
                        </span>
                        <span className="font-mono tabular-nums text-emerald-200 shrink-0">
                          Rs. {order.totalAmount}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2 bg-amber-500/15 border border-amber-500/40 rounded-xl px-3 py-2 text-amber-300 text-xs font-bold">
                        <span className="flex items-center gap-1.5">
                          <DollarSign className="w-4 h-4 text-amber-400 shrink-0" />
                          COLLECT CASH AT SEAT
                        </span>
                        <span className="font-mono tabular-nums text-amber-200 shrink-0">
                          Rs. {order.totalAmount}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* ITEMS TO PACK */}
                  <div className="p-4 flex-1 space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                      Items to Pack:
                    </div>
                    <ul className="space-y-2">
                      {order.items.map((item, idx) => (
                        <li
                          key={idx}
                          className="flex items-start justify-between gap-3 bg-slate-950/50 p-2.5 rounded-xl border border-slate-800/60"
                        >
                          <div className="flex items-start gap-2.5">
                            <span className="w-7 h-6 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono tabular-nums font-bold text-xs flex items-center justify-center shrink-0">
                              {item.qty}x
                            </span>
                            <span className="text-sm font-medium text-slate-100 leading-tight">
                              {item.name}
                            </span>
                          </div>
                          <span className="text-xs font-mono tabular-nums text-slate-400 shrink-0">
                            Rs. {item.price * item.qty}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* ACTION BUTTONS */}
                  <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center gap-2">
                    {order.status === 'new' && (
                      <button
                        onClick={() => updateOrderStatus(order, 'preparing')}
                        className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                      >
                        <ChefHat className="w-4 h-4" />
                        Mark Preparing
                      </button>
                    )}
                    {order.status === 'preparing' && (
                      <button
                        onClick={() => updateOrderStatus(order, 'delivered')}
                        className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Mark Tray Delivered
                      </button>
                    )}
                    <button
                      onClick={() => updateOrderStatus(order, 'delivered')}
                      className="py-2.5 px-3 bg-slate-800 hover:bg-emerald-600 hover:text-white text-slate-300 text-xs font-semibold rounded-xl border border-slate-700 transition-all cursor-pointer"
                      title="Quick Deliver"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* FIREBASE CUSTOMER SENDER SYNC MODAL */}
      {showFirebaseModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl max-w-2xl w-full p-6 shadow-2xl relative my-8">
            <button
              onClick={() => setShowFirebaseModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-emerald-500/15 border border-emerald-500/30 rounded-xl flex items-center justify-center text-emerald-400">
                <Wifi className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Event Cinema Firebase Bridge (Receiver Active)</h2>
                <p className="text-slate-400 text-xs">
                  Listening on project <span className="font-mono text-emerald-300">{firebaseConfig.projectId}</span> via both Realtime Database &amp; Firestore.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 text-xs font-mono">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                <div className="text-slate-400 text-[10px] uppercase mb-1">Realtime Database</div>
                <div className={rtdbOnline ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                  {rtdbOnline ? 'Connected (orders/)' : rtdbOnline === false ? 'Permission / Offline' : 'Connecting...'}
                </div>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                <div className="text-slate-400 text-[10px] uppercase mb-1">Cloud Firestore</div>
                <div className={firestoreOnline ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                  {firestoreOnline ? 'Connected (orders)' : firestoreOnline === false ? 'Permission / Offline' : 'Connecting...'}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                <button
                  onClick={() => setSnippetMode('rtdb')}
                  className={`px-3 py-1 text-xs font-semibold rounded cursor-pointer ${
                    snippetMode === 'rtdb' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Realtime DB (Sender)
                </button>
                <button
                  onClick={() => setSnippetMode('firestore')}
                  className={`px-3 py-1 text-xs font-semibold rounded cursor-pointer ${
                    snippetMode === 'firestore' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Firestore (Sender)
                </button>
              </div>

              <button
                onClick={() => handleCopySnippet(snippetMode)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                {copiedTab === snippetMode ? 'Copied!' : 'Copy Customer Snippet'}
              </button>
            </div>

            <pre className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-72 leading-relaxed">
              {snippetMode === 'rtdb' ? rtdbSenderSnippet : firestoreSenderSnippet}
            </pre>

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setShowFirebaseModal(false)}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs rounded-xl cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STAFF QR CODE MODAL (REAL SCANNABLE QR) */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-amber-500/30 rounded-2xl max-w-sm w-full p-6 text-center relative shadow-2xl">
            <button
              onClick={() => setShowQrModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/30 rounded-full flex items-center justify-center mx-auto mb-4 text-amber-400">
              <QrCode className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-white mb-1">Staff Canteen QR Code</h2>
            <p className="text-slate-400 text-xs mb-4">
              Place behind the concession counter. Staff scan this to open the live KDS instantly with zero login.
            </p>

            <div className="bg-white p-4 rounded-2xl border-2 border-amber-500/40 mb-4 inline-block shadow-inner">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Scannable QR Code for Event Cinemas Canteen KDS"
                  className="w-56 h-56 mx-auto rounded"
                />
              ) : (
                <div className="w-56 h-56 flex items-center justify-center text-slate-900 text-xs font-mono">
                  Generating QR...
                </div>
              )}
            </div>

            <div className="text-xs text-amber-400 font-mono mb-4 bg-amber-500/10 py-2 px-3 rounded-lg border border-amber-500/20 truncate">
              {window.location.href}
            </div>

            <button
              onClick={() => setShowQrModal(false)}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs rounded-xl transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* CUSTOMER SIMULATOR MODAL */}
      {showCustomerSimulator && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative my-8">
            <button
              onClick={() => setShowCustomerSimulator(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-indigo-600/20 border border-indigo-500/30 rounded-xl flex items-center justify-center text-indigo-400">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Customer Phone Ordering Simulator</h2>
                <p className="text-slate-400 text-xs">
                  Sends a real order through Firebase ({firebaseConfig.projectId}) to trigger the KDS bell
                </p>
              </div>
            </div>

            <form onSubmit={handleCustomOrderSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Seat Number</label>
                  <input
                    type="text"
                    value={simSeat}
                    onChange={(e) => setSimSeat(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-amber-500"
                    maxLength={16}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Hall / Screen</label>
                  <select
                    value={simHall}
                    onChange={(e) => setSimHall(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                  >
                    <option>Hall 1 / Screen 1</option>
                    <option>Hall 2 / Screen 2</option>
                    <option>Hall 3 / IMAX Screen</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Payment Method</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setSimPayment('digital')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      simPayment === 'digital'
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    Fonepay Digital Paid
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimPayment('cash')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      simPayment === 'cash'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    Pay Cash at Seat
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Items in Cart</label>
                <div className="space-y-2 bg-slate-950 p-3 rounded-xl border border-slate-800 max-h-40 overflow-y-auto">
                  {simCart.map((item, i) => (
                    <div key={i} className="flex justify-between items-center text-xs text-slate-300">
                      <span>
                        {item.qty}x {item.name}
                      </span>
                      <span className="font-mono tabular-nums">Rs. {item.price * item.qty}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="text-sm font-bold text-white">
                  Total:{' '}
                  <span className="text-amber-400 font-mono tabular-nums">
                    Rs. {simCart.reduce((acc, c) => acc + c.price * c.qty, 0)}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCustomerSimulator(false)}
                    className="px-4 py-2 bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingOrder}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 text-xs font-bold rounded-xl shadow cursor-pointer"
                  >
                    {submittingOrder ? 'Sending...' : 'Place Live Order'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
