/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Film, Clock, Armchair, QrCode, Smartphone, CheckCircle2, 
  AlertCircle, ShieldCheck, Ticket, Calendar, MapPin, ChevronRight, 
  RotateCcw, Sparkles, Lock, Check, X, Bell, Volume2, VolumeX, 
  ChefHat, PlusCircle, DollarSign, RefreshCw, Trash2
} from 'lucide-react';
import { ref, onValue, off } from 'firebase/database';
import { db } from './firebase';


interface Seat {
  id: string;
  row: string;
  number: number;
  status: 'available' | 'reserved' | 'booked' | 'selected';
}

interface OrderItem {
  name: string;
  qty: number;
  price: number;
}

interface Order {
  id: string;
  seat: string;
  hall: string;
  items: OrderItem[];
  paymentType: 'digital' | 'cash';
  totalAmount: number;
  status: 'new' | 'preparing' | 'delivered';
  timestamp: number;
}

export default function App() {
  // Navigation View: 'ticket' or 'kds'
  const [activeView, setActiveView] = useState<'ticket' | 'kds'>('ticket');

  // ==================== TICKET COUNTER STATE ====================
  const [demoOverride, setDemoOverride] = useState<'auto' | 'open' | 'closed'>('auto');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [countdown, setCountdown] = useState({ hours: 0, minutes: 0, seconds: 0 });

  const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  const [seats, setSeats] = useState<Seat[]>([]);
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [mobileNumber, setMobileNumber] = useState('');
  const [confirmedTicket, setConfirmedTicket] = useState<{
    id: string;
    seats: string[];
    total: number;
    mobile: string;
    timestamp: string;
  } | null>(null);

  // ==================== CANTEEN KDS STATE ====================
  const [shiftStarted, setShiftStarted] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const [filterHall, setFilterHall] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showQrModal, setShowQrModal] = useState(false);
  const [showCustomerSimulator, setShowCustomerSimulator] = useState(false);

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
  const channelRef = useRef<BroadcastChannel | null>(null);

  // Initialize Seats
  useEffect(() => {
    const initialSeats: Seat[] = [];
    rows.forEach((row, rowIndex) => {
      for (let num = 1; num <= 19; num++) {
        const id = `${row}-${num}`;
        let status: Seat['status'] = 'available';
        const rand = (rowIndex * 19 + num) % 7;
        if (rand === 2 || rand === 5) {
          status = 'booked';
        } else if (rand === 4) {
          status = 'reserved';
        }
        initialSeats.push({ id, row, number: num, status });
      }
    });
    setSeats(initialSeats);
  }, []);

  // Initialize KDS BroadcastChannel & sample orders
  useEffect(() => {
    try {
      const bc = new BroadcastChannel('cinema_orders');
      channelRef.current = bc;
      bc.onmessage = (event) => {
        if (event.data && event.data.type === 'NEW_ORDER') {
          const newOrder: Order = event.data.order;
          addNewOrder(newOrder);
        }
      };
    } catch (e) {
      console.log('BroadcastChannel error:', e);
    }

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'event_cinemas_latest_order' && e.newValue) {
        try {
          const orderData = JSON.parse(e.newValue);
          addNewOrder(orderData);
        } catch (err) {
          console.error(err);
        }
      }
    };
    window.addEventListener('storage', handleStorage);

    const initialOrders: Order[] = [
      {
        id: 'ORD-8492',
        seat: 'F-12',
        hall: 'Hall 1 / Screen 1',
        items: [
          { name: 'Super Combo (Popcorn + Large Coke)', qty: 1, price: 450 },
          { name: 'Chilled Coke (500ml)', qty: 2, price: 150 }
        ],
        paymentType: 'digital',
        totalAmount: 750,
        status: 'new',
        timestamp: Date.now() - 1000 * 60 * 2
      },
      {
        id: 'ORD-8493',
        seat: 'B-04',
        hall: 'Hall 2 / Screen 2',
        items: [
          { name: 'Cheese Nachos Supreme', qty: 1, price: 380 },
          { name: 'Bottled Mineral Water', qty: 2, price: 50 }
        ],
        paymentType: 'cash',
        totalAmount: 480,
        status: 'preparing',
        timestamp: Date.now() - 1000 * 60 * 5
      }
    ];
    setOrders(initialOrders);

    return () => {
      if (channelRef.current) channelRef.current.close();
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // Live clock & countdown
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);

      const target = new Date(now);
      target.setHours(24, 0, 0, 0);
      const diffMs = target.getTime() - now.getTime();
      const hrs = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diffMs % (1000 * 60)) / 1000);
      setCountdown({ hours: hrs, minutes: mins, seconds: secs });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Audio Chime Logic
  const initAudio = () => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      if (ctx.state === 'suspended') ctx.resume();
      setShiftStarted(true);
      setSoundEnabled(true);
      playChime();
    } catch (e) {
      console.error(e);
      setShiftStarted(true);
      setSoundEnabled(true);
    }
  };

  const playChime = () => {
    if (!soundEnabled) return;
    try {
      const ctx = audioCtxRef.current || new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(1046.5, now);
      gain1.gain.setValueAtTime(0.3, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.6);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(783.99, now + 0.2);
      gain2.gain.setValueAtTime(0.4, now + 0.2);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.2);
      osc2.stop(now + 0.9);
    } catch (e) {
      console.error(e);
    }
  };

  const playSuccessChime = () => {
    try {
      const ctx = audioCtxRef.current || new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.1);
      osc.frequency.setValueAtTime(783.99, now + 0.2);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.5);
    } catch (e) {
      console.error(e);
    }
  };

  const addNewOrder = (order: Order) => {
    setOrders(prev => [order, ...prev]);
    playChime();
  };

  const simulateTestOrder = () => {
    const randomSeats = ['A-08', 'C-14', 'E-02', 'G-11', 'K-05', 'B-19', 'F-03'];
    const randomHalls = ['Hall 1 / Screen 1', 'Hall 2 / Screen 2', 'Hall 3 / IMAX Screen'];
    const combos = [
      { name: 'Super Combo (Popcorn + Large Coke)', price: 450 },
      { name: 'Nachos with Salsa & Cheese', price: 380 },
      { name: 'Caramel Popcorn Tub', price: 350 },
      { name: 'Chilled Coke (500ml)', price: 150 }
    ];

    const selectedCombo = combos[Math.floor(Math.random() * combos.length)];
    const isDigital = Math.random() > 0.4;
    const qty = Math.floor(Math.random() * 2) + 1;
    const total = selectedCombo.price * qty;

    const newOrder: Order = {
      id: `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
      seat: randomSeats[Math.floor(Math.random() * randomSeats.length)],
      hall: randomHalls[Math.floor(Math.random() * randomHalls.length)],
      items: [{ name: selectedCombo.name, qty: qty, price: selectedCombo.price }],
      paymentType: isDigital ? 'digital' : 'cash',
      totalAmount: total,
      status: 'new',
      timestamp: Date.now()
    };

    addNewOrder(newOrder);
    localStorage.setItem('event_cinemas_latest_order', JSON.stringify(newOrder));
  };

  const updateOrderStatus = (id: string, newStatus: 'preparing' | 'delivered') => {
    if (newStatus === 'delivered') {
      playSuccessChime();
      setOrders(prev => prev.filter(o => o.id !== id));
      setCompletedCount(c => c + 1);
    } else {
      setOrders(prev => prev.map(o => o.id === id ? { ...o, status: newStatus } : o));
    }
  };

  // Time check for ticket counter (12:00 AM to 3:00 PM)
  const isCounterOpen = () => {
    if (demoOverride === 'open') return true;
    if (demoOverride === 'closed') return false;

    const hours = currentTime.getHours();
    const minutes = currentTime.getMinutes();
    const totalMinutes = hours * 60 + minutes;
    return totalMinutes >= 0 && totalMinutes <= 15 * 60;
  };

  const openStatus = isCounterOpen();
  const ticketPrice = 250;

  const handleSeatClick = (seat: Seat) => {
    if (!openStatus) return;
    if (seat.status === 'booked' || seat.status === 'reserved') return;

    setSeats(prev => prev.map(s => {
      if (s.id === seat.id) {
        const newStatus = s.status === 'selected' ? 'available' : 'selected';
        return { ...s, status: newStatus };
      }
      return s;
    }));

    setSelectedSeatIds(prev => {
      if (prev.includes(seat.id)) {
        return prev.filter(id => id !== seat.id);
      } else {
        return [...prev, seat.id];
      }
    });
  };

  const handleConfirmBooking = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mobileNumber || mobileNumber.length < 10) {
      alert('Please enter a valid mobile number.');
      return;
    }

    const ticketId = `#EC-TKT-${Math.floor(1000 + Math.random() * 9000)}`;
    const total = selectedSeatIds.length * ticketPrice;

    setSeats(prev => prev.map(s => {
      if (selectedSeatIds.includes(s.id)) {
        return { ...s, status: 'booked' };
      }
      return s;
    }));

    setConfirmedTicket({
      id: ticketId,
      seats: [...selectedSeatIds],
      total,
      mobile: mobileNumber,
      timestamp: currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    setSelectedSeatIds([]);
    setShowCheckoutModal(false);
  };

  const activeOrdersCount = orders.filter(o => o.status === 'new' || o.status === 'preparing').length;
  const totalCashToCollect = orders
    .filter(o => o.paymentType === 'cash' && (o.status === 'new' || o.status === 'preparing'))
    .reduce((sum, o) => sum + o.totalAmount, 0);

  const filteredOrders = orders.filter(o => {
    if (filterHall !== 'all' && o.hall !== filterHall) return false;
    if (filterStatus !== 'all' && o.status !== filterStatus) return false;
    return true;
  });

  const getRelativeTime = (timestamp: number) => {
    const diffSec = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSec < 45) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin === 1) return '1m ago';
    if (diffMin < 60) return `${diffMin}m ago`;
    return `${Math.floor(diffMin / 60)}h ago`;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none pb-20">
      
      {/* UNIFIED MASTER NAVIGATION HEADER */}
      <header className="sticky top-0 z-50 bg-slate-900 border-b border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-red-600 to-amber-500 rounded-xl flex items-center justify-center text-white font-black shadow-lg">
            EC
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white">Event Cinemas, Lalbandi-7</h1>
            <div className="text-[10px] text-slate-400">Gole Complex · Unified Management Portal</div>
          </div>
        </div>

        {/* APP MODE SWITCHER TABS */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveView('ticket')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all ${activeView === 'ticket' ? 'bg-red-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
          >
            <Ticket className="w-4 h-4" />
            🎫 Online Ticket Counter
          </button>
          <button
            onClick={() => {
              setActiveView('kds');
              if (!shiftStarted) setShiftStarted(true);
            }}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all ${activeView === 'kds' ? 'bg-amber-500 text-slate-950 shadow-lg' : 'text-slate-400 hover:text-white'}`}
          >
            <ChefHat className="w-4 h-4" />
            🍳 Canteen KDS
            {activeOrdersCount > 0 && (
              <span className="w-5 h-5 bg-red-600 text-white rounded-full text-[10px] flex items-center justify-center font-mono">
                {activeOrdersCount}
              </span>
            )}
          </button>
        </div>

        {/* LIVE CLOCK & STATUS */}
        <div className="flex items-center gap-3">
          <div className="text-xs font-mono text-slate-300 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
            {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </div>
      </header>

      {/* ==================== VIEW 1: ONLINE TICKET COUNTER ==================== */}
      {activeView === 'ticket' && (
        <div className="flex-1 flex flex-col">
          {/* SUB-HEADER */}
          <div className="bg-slate-900/50 border-b border-slate-800/80 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${openStatus ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></span>
              <span className="font-medium text-slate-300">
                {openStatus ? 'Ticket Counter: ONLINE (12:00 AM - 3:00 PM)' : 'Ticket Counter: CLOSED'}
              </span>
            </div>

            {/* DEMO OVERRIDE SWITCH */}
            <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 px-1 font-semibold">Demo Override:</span>
              {(['auto', 'open', 'closed'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setDemoOverride(mode)}
                  className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded transition-colors ${demoOverride === mode ? 'bg-red-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {/* DIGITAL TICKET SUCCESS MODAL */}
          {confirmedTicket && (
            <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-xl flex items-center justify-center p-4 overflow-y-auto">
              <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl max-w-sm w-full p-6 shadow-2xl relative text-center">
                <div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center mx-auto mb-4 text-emerald-400">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                
                <div className="text-[11px] font-mono text-emerald-400 uppercase tracking-widest font-bold mb-1">
                  Booking Confirmed Successfully
                </div>
                <h2 className="text-2xl font-black text-white mb-1 font-mono tracking-wide">
                  {confirmedTicket.id}
                </h2>
                <p className="text-xs text-slate-400 mb-6">
                  Event Cinemas, Lalbandi-7 · Gole Complex
                </p>

                <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 space-y-3 text-left mb-6 font-mono text-xs">
                  <div className="flex justify-between border-b border-slate-800/80 pb-2">
                    <span className="text-slate-400">Screen:</span>
                    <span className="text-white font-bold">Hall 1 / Screen 1</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-800/80 pb-2">
                    <span className="text-slate-400">Showtime:</span>
                    <span className="text-amber-400 font-bold">03:30 PM (Evening)</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-800/80 pb-2">
                    <span className="text-slate-400">Seats:</span>
                    <span className="text-red-400 font-bold">{confirmedTicket.seats.join(', ')}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-800/80 pb-2">
                    <span className="text-slate-400">Mobile:</span>
                    <span className="text-white">{confirmedTicket.mobile}</span>
                  </div>
                  <div className="flex justify-between pt-1">
                    <span className="text-slate-400">Total Paid:</span>
                    <span className="text-emerald-400 font-bold text-sm">Rs. {confirmedTicket.total}</span>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-xl w-36 h-36 mx-auto flex items-center justify-center shadow-inner mb-6 border-2 border-slate-800">
                  <div className="grid grid-cols-6 gap-1 w-full h-full bg-slate-950 p-1.5 rounded">
                    {Array.from({ length: 36 }).map((_, i) => (
                      <div key={i} className={`${(i % 3 === 0 || i % 2 === 0) ? 'bg-white' : 'bg-slate-950'} rounded-xs`}></div>
                    ))}
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 mb-6">Show QR code to entrance gate staff for verification.</p>

                <button
                  onClick={() => setConfirmedTicket(null)}
                  className="w-full py-3 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-xl shadow transition-colors"
                >
                  Book Another Ticket
                </button>
              </div>
            </div>
          )}

          {!openStatus ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <div className="max-w-md bg-slate-900 border border-red-500/30 rounded-2xl p-8 shadow-2xl">
                <div className="w-16 h-16 bg-red-500/10 border border-red-500/30 rounded-full flex items-center justify-center mx-auto mb-5 text-red-500">
                  <Lock className="w-8 h-8" />
                </div>
                <div className="text-xs font-mono uppercase tracking-widest text-red-400 mb-2 font-bold">
                  Online Counter Closed
                </div>
                <h2 className="text-2xl font-bold text-white mb-4">Booking Window Closed</h2>
                <p className="text-slate-300 text-sm mb-6 leading-relaxed">
                  Online advance booking is closed for today. Reopens at 12:00 AM. Remaining evening show tickets are available directly at the Gole Complex Box Office Counter.
                </p>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 mb-6">
                  <div className="text-[10px] uppercase text-slate-400 font-semibold mb-2">Next Counter Opening in:</div>
                  <div className="flex justify-center gap-3 font-mono font-bold text-2xl text-amber-400">
                    <div className="bg-slate-900 px-3 py-2 rounded-lg border border-slate-800">
                      {String(countdown.hours).padStart(2, '0')}<span className="text-[10px] text-slate-500 block">HOURS</span>
                    </div>
                    <div className="bg-slate-900 px-3 py-2 rounded-lg border border-slate-800">
                      {String(countdown.minutes).padStart(2, '0')}<span className="text-[10px] text-slate-500 block">MINS</span>
                    </div>
                    <div className="bg-slate-900 px-3 py-2 rounded-lg border border-slate-800">
                      {String(countdown.seconds).padStart(2, '0')}<span className="text-[10px] text-slate-500 block">SECS</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setDemoOverride('open')}
                  className="text-xs text-slate-400 hover:text-white underline transition-colors"
                >
                  [Presenter Mode: Force Open Counter]
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col p-4 max-w-4xl mx-auto w-full">
              <div className="mb-6 text-center">
                <div className="w-3/4 mx-auto h-3 bg-gradient-to-r from-transparent via-red-600 to-transparent rounded-full shadow-lg shadow-red-600/50 mb-2"></div>
                <span className="text-[11px] font-mono uppercase tracking-widest text-slate-400 font-bold">
                  CINEMA SCREEN THIS WAY
                </span>
              </div>

              {/* SEAT LEGEND */}
              <div className="flex flex-wrap items-center justify-center gap-4 mb-6 bg-slate-900/60 p-3 rounded-xl border border-slate-800 text-[11px]">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-slate-800 border border-slate-700 rounded-sm"></div>
                  <span className="text-slate-300">Available (Rs. 250)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-amber-500/20 border border-amber-500/40 rounded-sm"></div>
                  <span className="text-slate-300">Reserved / Locked</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-red-950/40 border border-red-900/30 rounded-sm opacity-60"></div>
                  <span className="text-slate-300">Booked (Sold Out)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-[#E50914] rounded-sm shadow shadow-red-500/50"></div>
                  <span className="text-slate-300 font-bold text-white">Selected</span>
                </div>
              </div>

              <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 overflow-x-auto shadow-2xl mb-20">
                <div className="min-w-[640px] space-y-2">
                  {rows.map(row => {
                    const rowSeats = seats.filter(s => s.row === row);
                    return (
                      <div key={row} className="flex items-center justify-center gap-1.5">
                        <span className="w-6 text-center font-mono font-bold text-xs text-slate-400">{row}</span>
                        <div className="flex items-center gap-1">
                          {rowSeats.map((seat, idx) => {
                            const isSelected = seat.status === 'selected';
                            const isBooked = seat.status === 'booked';
                            const isReserved = seat.status === 'reserved';

                            let btnClass = "w-7 h-7 rounded-md text-[10px] font-mono font-bold transition-all flex items-center justify-center ";
                            if (isSelected) {
                              btnClass += "bg-[#E50914] text-white shadow-lg shadow-red-500/40 ring-2 ring-red-400 scale-105 z-10";
                            } else if (isBooked) {
                              btnClass += "bg-red-950/40 text-red-900 border border-red-900/30 cursor-not-allowed opacity-50";
                            } else if (isReserved) {
                              btnClass += "bg-amber-500/20 text-amber-300/70 border border-amber-500/30 cursor-not-allowed";
                            } else {
                              btnClass += "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 hover:border-slate-500";
                            }

                            return (
                              <React.Fragment key={seat.id}>
                                <button
                                  onClick={() => handleSeatClick(seat)}
                                  disabled={isBooked || isReserved}
                                  className={btnClass}
                                >
                                  {seat.number}
                                </button>
                                {idx === 9 && <div className="w-6"></div>}
                              </React.Fragment>
                            );
                          })}
                        </div>
                        <span className="w-6 text-center font-mono font-bold text-xs text-slate-400">{row}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* STICKY BOTTOM CHECKOUT BAR */}
          {selectedSeatIds.length > 0 && (
            <div className="fixed bottom-0 inset-x-0 z-40 bg-slate-900/95 backdrop-blur-md border-t border-red-500/40 p-4 shadow-2xl flex items-center justify-between max-w-4xl mx-auto">
              <div>
                <div className="text-[11px] text-slate-400 font-mono">
                  Selected ({selectedSeatIds.length} Seats): <span className="text-white font-bold">{selectedSeatIds.join(', ')}</span>
                </div>
                <div className="text-lg font-black text-white font-mono">
                  Rs. {selectedSeatIds.length * ticketPrice}
                </div>
              </div>
              <button
                onClick={() => setShowCheckoutModal(true)}
                className="px-6 py-3 bg-[#E50914] hover:bg-red-700 text-white font-bold text-sm rounded-xl shadow-lg flex items-center gap-2"
              >
                <span>Book {selectedSeatIds.length} Seats</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* CHECKOUT MODAL */}
          {showCheckoutModal && (
            <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
                <button onClick={() => setShowCheckoutModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white p-1">
                  <X className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-bold text-white mb-4">Complete Ticket Payment</h2>
                <form onSubmit={handleConfirmBooking} className="space-y-4">
                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs font-mono space-y-1.5">
                    <div className="flex justify-between text-slate-400"><span>Seats:</span><span className="text-white font-bold">{selectedSeatIds.join(', ')}</span></div>
                    <div className="flex justify-between text-slate-400"><span>Total:</span><span className="text-emerald-400 font-bold">Rs. {selectedSeatIds.length * ticketPrice}</span></div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Mobile Number</label>
                    <input
                      type="tel"
                      placeholder="e.g. 9812345678"
                      value={mobileNumber}
                      onChange={e => setMobileNumber(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-red-600"
                      required
                    />
                  </div>
                  <div className="bg-white p-4 rounded-xl text-center space-y-2">
                    <div className="text-xs font-bold text-slate-900">Scan via Fonepay / Mobile Banking</div>
                    <div className="w-32 h-32 bg-slate-950 mx-auto rounded-lg flex items-center justify-center p-2">
                      <div className="grid grid-cols-5 gap-1 w-full h-full bg-white p-1 rounded">
                        {Array.from({ length: 25 }).map((_, i) => (<div key={i} className={`${i % 2 === 0 ? 'bg-slate-950' : 'bg-white'}`}></div>))}
                      </div>
                    </div>
                  </div>
                  <button type="submit" className="w-full py-3 bg-[#E50914] hover:bg-red-700 text-white font-bold text-sm rounded-xl shadow-lg">
                    Confirm Booking & Generate Pass
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== VIEW 2: CANTEEN KDS ==================== */}
      {activeView === 'kds' && (
        <div className="flex-1 flex flex-col">
          {!shiftStarted && (
            <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center">
              <div className="max-w-xl bg-slate-900 border border-amber-500/30 rounded-2xl p-8 shadow-2xl">
                <ChefHat className="w-12 h-12 text-amber-400 mx-auto mb-4 animate-bounce" />
                <h1 className="text-2xl font-bold text-white mb-2">Start Canteen Shift</h1>
                <p className="text-slate-400 text-sm mb-6">Tap below to enable sound chimes and open the KDS display.</p>
                <button
                  onClick={initAudio}
                  className="w-full py-4 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-base shadow-lg"
                >
                  🔔 TAP TO START SHIFT & ENABLE SOUND
                </button>
              </div>
            </div>
          )}

          {/* KDS HEADER CONTROLS */}
          <div className="bg-slate-900/60 border-b border-slate-800 px-6 py-3 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-xl">
                <span className="text-xs text-slate-400 font-semibold">Active:</span>
                <span className="font-mono font-bold text-amber-400">{activeOrdersCount}</span>
                <span className="text-slate-700">|</span>
                <span className="text-xs text-slate-400 font-semibold">Cash Collect:</span>
                <span className="font-mono font-bold text-amber-300">Rs. {totalCashToCollect}</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                className={`p-2 rounded-lg border ${soundEnabled ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'bg-slate-800 text-slate-400'}`}
              >
                {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setShowQrModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700"
              >
                <QrCode className="w-4 h-4 text-amber-400" />
                Staff QR
              </button>
              <button
                onClick={() => setShowCustomerSimulator(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow"
              >
                <Smartphone className="w-4 h-4" />
                Simulate Order
              </button>
              <button
                onClick={simulateTestOrder}
                className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg shadow"
              >
                <PlusCircle className="w-4 h-4" />
                + Test Order
              </button>
            </div>
          </div>

          {/* KDS FILTER BAR */}
          <div className="bg-slate-900/40 border-b border-slate-800 px-6 py-2.5 flex items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Halls:</span>
              {['all', 'Hall 1 / Screen 1', 'Hall 2 / Screen 2'].map(h => (
                <button
                  key={h}
                  onClick={() => setFilterHall(h)}
                  className={`px-2.5 py-1 rounded ${filterHall === h ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'}`}
                >
                  {h === 'all' ? 'All' : h}
                </button>
              ))}
            </div>
          </div>

          {/* KDS ORDERS GRID */}
          <main className="flex-1 p-6 overflow-y-auto">
            {filteredOrders.length === 0 ? (
              <div className="h-80 flex flex-col items-center justify-center text-center p-8 bg-slate-900/30 border border-dashed border-slate-800 rounded-2xl">
                <ChefHat className="w-12 h-12 text-slate-700 mb-3 animate-pulse" />
                <h3 className="text-lg font-bold text-slate-300 mb-1">No Active Orders</h3>
                <p className="text-slate-500 text-xs mb-4">Click "+ Test Order" to test incoming chimes.</p>
                <button onClick={simulateTestOrder} className="px-4 py-2 bg-amber-500 text-slate-950 font-bold text-xs rounded-xl">
                  + Test Order
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredOrders.map(order => {
                  const isNew = order.status === 'new';
                  return (
                    <div 
                      key={order.id}
                      className={`bg-slate-900 border-2 rounded-2xl shadow-xl overflow-hidden flex flex-col ${isNew ? 'border-amber-500 ring-2 ring-amber-500/20' : 'border-slate-800'}`}
                    >
                      <div className={`p-4 flex items-center justify-between border-b ${isNew ? 'bg-amber-500/10 border-amber-500/30' : 'bg-slate-950/60 border-slate-800'}`}>
                        <div>
                          <div className="text-[10px] font-mono text-slate-400">{order.id}</div>
                          <div className="text-3xl font-black text-white font-mono mt-0.5">SEAT {order.seat}</div>
                        </div>
                        <div className="text-right">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                            {order.hall}
                          </span>
                          <div className="text-[10px] text-slate-400 mt-1 font-mono">{getRelativeTime(order.timestamp)}</div>
                        </div>
                      </div>

                      <div className="p-3 border-b border-slate-800/80 bg-slate-950/40">
                        {order.paymentType === 'digital' ? (
                          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-1.5 text-emerald-400 text-[11px] font-bold flex justify-between">
                            <span>✅ FONEPAY PAID</span>
                            <span className="font-mono">Rs. {order.totalAmount}</span>
                          </div>
                        ) : (
                          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-1.5 text-amber-300 text-[11px] font-bold flex justify-between">
                            <span>💵 COLLECT CASH</span>
                            <span className="font-mono">Rs. {order.totalAmount}</span>
                          </div>
                        )}
                      </div>

                      <div className="p-4 flex-1 space-y-2">
                        <div className="text-[10px] uppercase font-semibold text-slate-400">Items:</div>
                        <ul className="space-y-1.5">
                          {order.items.map((item, i) => (
                            <li key={i} className="flex justify-between text-xs text-slate-200 bg-slate-950/50 p-2 rounded-lg border border-slate-800/50">
                              <span><strong className="text-amber-400 font-mono">{item.qty}x</strong> {item.name}</span>
                              <span className="font-mono text-slate-400">Rs. {item.price * item.qty}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="p-4 bg-slate-950 border-t border-slate-800 flex gap-2">
                        {order.status === 'new' && (
                          <button
                            onClick={() => updateOrderStatus(order.id, 'preparing')}
                            className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow"
                          >
                            Mark Preparing
                          </button>
                        )}
                        <button
                          onClick={() => updateOrderStatus(order.id, 'delivered')}
                          className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow"
                        >
                          Mark Delivered
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </main>

          {/* STAFF QR MODAL */}
          {showQrModal && (
            <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
              <div className="bg-slate-900 border border-amber-500/30 rounded-2xl max-w-sm w-full p-6 text-center relative shadow-2xl">
                <button onClick={() => setShowQrModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">✕</button>
                <h3 className="text-lg font-bold text-white mb-1">Staff Canteen & KDS QR Code</h3>
                <p className="text-[11px] text-slate-400 mb-4">Scan this QR code behind the counter to open KDS & Ticket Counter instantly.</p>
                
                {/* Generated QR Code Poster Artifact Image */}
                <div className="bg-slate-950 p-2 rounded-xl border border-amber-500/30 mb-4 overflow-hidden">
                  <img 
                    src="/src/assets/images/canteen_staff_qr_code_1794182055710.jpg" 
                    alt="Event Cinemas Lalbandi Staff QR Code" 
                    className="w-full h-auto rounded-lg shadow-inner"
                    referrerPolicy="no-referrer"
                  />
                </div>

                <div className="text-[10px] text-amber-400 font-mono mb-4 bg-amber-500/10 py-1.5 px-2 rounded border border-amber-500/20 truncate">
                  {window.location.origin}
                </div>

                <button onClick={() => setShowQrModal(false)} className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs rounded-xl">Close</button>
              </div>
            </div>
          )}

          {/* CUSTOMER SIMULATOR MODAL */}
          {showCustomerSimulator && (
            <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 relative">
                <button onClick={() => setShowCustomerSimulator(false)} className="absolute top-4 right-4 text-slate-400">✕</button>
                <h3 className="text-lg font-bold text-white mb-4">Simulate Customer Order</h3>
                <form onSubmit={e => {
                  e.preventDefault();
                  const total = simCart.reduce((a, c) => a + c.price * c.qty, 0);
                  const newOrd: Order = {
                    id: `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
                    seat: simSeat,
                    hall: simHall,
                    items: [...simCart],
                    paymentType: simPayment,
                    totalAmount: total,
                    status: 'new',
                    timestamp: Date.now()
                  };
                  addNewOrder(newOrd);
                  localStorage.setItem('event_cinemas_latest_order', JSON.stringify(newOrd));
                  setShowCustomerSimulator(false);
                }} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Seat Number</label>
                    <input type="text" value={simSeat} onChange={e => setSimSeat(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm" required />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Payment Method</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setSimPayment('digital')} className={`py-2 rounded-xl text-xs font-bold ${simPayment === 'digital' ? 'bg-emerald-600 text-white' : 'bg-slate-950 text-slate-400'}`}>Fonepay Paid</button>
                      <button type="button" onClick={() => setSimPayment('cash')} className={`py-2 rounded-xl text-xs font-bold ${simPayment === 'cash' ? 'bg-amber-500 text-slate-950' : 'bg-slate-950 text-slate-400'}`}>Cash at Seat</button>
                    </div>
                  </div>
                  <button type="submit" className="w-full py-3 bg-amber-500 text-slate-950 font-bold text-xs rounded-xl">
                    Dispatch Order 🚀
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
